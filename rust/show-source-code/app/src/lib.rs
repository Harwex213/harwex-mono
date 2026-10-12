//! show-code-source: a yarn + TypeScript monorepo as one zoomable canvas. Packages are boxes,
//! files are cards with their code, dependencies are arrows.

mod canvas;
mod highlight;
mod imports;
pub mod jobs;
pub mod scene;
pub mod theme;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::Arc;
use std::time::Instant;

use egui::{pos2, Pos2, Rect, Vec2};

pub use imports::TsStatus;
use jobs::{Jobs, UiCallback};
use scene::{CardText, Scene};

#[derive(Debug, Clone)]
pub struct AppOptions {
    pub project: PathBuf,
    /// Tests: no timings on screen, nothing that depends on the wall clock.
    pub deterministic: bool,
    /// Ask tsserver for file-level imports after the package graph is shown.
    pub tsserver: bool,
    /// Keep resolved imports between runs (under the system temp dir).
    pub import_cache: bool,
}

impl Default for AppOptions {
    fn default() -> Self {
        AppOptions { project: PathBuf::from("."), deterministic: false, tsserver: true, import_cache: true }
    }
}

pub enum Phase {
    Loading,
    Failed(String),
    Ready,
}

/// World point at the canvas center and screen pixels per world unit.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Camera {
    pub center: Pos2,
    pub zoom: f32,
}

impl Camera {
    pub fn to_screen(&self, view: Rect, p: Pos2) -> Pos2 {
        view.center() + (p - self.center) * self.zoom
    }

    pub fn to_world(&self, view: Rect, p: Pos2) -> Pos2 {
        self.center + (p - view.center()) / self.zoom
    }

    pub fn rect_to_screen(&self, view: Rect, r: Rect) -> Rect {
        Rect::from_min_max(self.to_screen(view, r.min), self.to_screen(view, r.max))
    }

    /// The world rect that `view` shows.
    pub fn visible(&self, view: Rect) -> Rect {
        Rect::from_min_max(self.to_world(view, view.min), self.to_world(view, view.max))
    }
}

/// A camera change that waits for the first frame that knows the canvas size.
#[derive(Debug, Clone)]
pub enum ViewRequest {
    Fit,
    /// Fill the view with one package.
    Package(String),
    At(Camera),
}

pub const MIN_ZOOM: f32 = 0.0002;
pub const MAX_ZOOM: f32 = 6.0;

pub struct State {
    pub options: AppOptions,
    pub jobs: Jobs,
    pub phase: Phase,
    pub scene: Option<Scene>,
    pub camera: Camera,
    pub ts: TsStatus,
    pub view_request: Option<ViewRequest>,
    /// The canvas rect of the last frame.
    pub view: Rect,
    /// `(package, card)` under the pointer.
    pub hovered: Option<(usize, usize)>,
    /// Card texts read so far, by `(package, card)`.
    pub texts: HashMap<(usize, usize), Arc<CardText>>,
    /// Cards whose text a worker reads now or already read.
    requested: HashSet<(usize, usize)>,
    /// Cards the last frame wanted text for; read after the frame.
    pub(crate) want_text: Vec<(usize, usize)>,
    /// Source files found so far, while discovery runs.
    pub progress: Arc<AtomicUsize>,
    /// Stops the tsserver job when the app goes away.
    cancel: Arc<AtomicBool>,
}

/// Cards whose text one frame may ask for. More would only queue disk reads for cards that
/// scroll away before they are read.
const TEXT_REQUESTS_PER_FRAME: usize = 1500;
/// Texts kept before the cache starts over. The cards on screen ask again on the next frame.
const MAX_TEXTS: usize = 30_000;

impl State {
    pub fn is_idle(&self) -> bool {
        self.jobs.is_idle()
    }

    pub fn request_view(&mut self, r: ViewRequest) {
        self.view_request = Some(r);
    }

    fn apply_view_request(&mut self) {
        let Some(req) = self.view_request.take() else { return };
        let Some(scene) = &self.scene else {
            self.view_request = Some(req);
            return;
        };
        // The HUD covers the top band and the hint bar the bottom one; fit between them.
        let room = Rect::from_min_max(self.view.min + Vec2::new(24.0, 124.0), self.view.max - Vec2::new(24.0, 48.0));
        let fit = |r: Rect, view: Rect| {
            let zoom = (room.width() / r.width()).min(room.height() / r.height()).clamp(MIN_ZOOM, MAX_ZOOM);
            // Center `r` in `room`, not in the whole view.
            Camera { center: r.center() - (room.center() - view.center()) / zoom, zoom }
        };
        let label_band = |r: Rect| Rect::from_min_max(r.min - Vec2::new(0.0, 48.0), r.max);
        self.camera = match req {
            ViewRequest::Fit => fit(scene.bounds.expand(40.0), self.view),
            ViewRequest::Package(name) => match scene.packages.iter().find(|p| p.name == name) {
                Some(p) => fit(label_band(p.rect), self.view),
                None => self.camera,
            },
            ViewRequest::At(c) => c,
        };
    }

    /// Zooms by `factor` keeping the world point under `anchor` (screen) in place.
    pub fn zoom_at(&mut self, anchor: Pos2, factor: f32) {
        let world = self.camera.to_world(self.view, anchor);
        self.camera.zoom = (self.camera.zoom * factor).clamp(MIN_ZOOM, MAX_ZOOM);
        self.camera.center = world - (anchor - self.view.center()) / self.camera.zoom;
    }

    /// Shows `scene` as if discovery had produced it (tests build synthetic ones).
    pub fn set_scene(&mut self, scene: Scene) {
        self.scene_loaded(scene);
    }

    /// Starts reading the texts the last frame asked for.
    fn read_wanted_texts(&mut self) {
        let mut want = std::mem::take(&mut self.want_text);
        want.retain(|id| !self.requested.contains(id));
        want.truncate(TEXT_REQUESTS_PER_FRAME);
        let Some(scene) = &self.scene else { return };
        if want.is_empty() {
            return;
        }
        if self.texts.len() + want.len() > MAX_TEXTS {
            self.texts.clear();
            self.requested.clear();
        }
        let jobs: Vec<((usize, usize), PathBuf)> = want.iter().map(|&(p, c)| ((p, c), scene.packages[p].cards[c].path.clone())).collect();
        self.requested.extend(want);
        self.jobs.spawn(
            "read card text",
            move |_| jobs.into_iter().map(|(id, path)| (id, Arc::new(CardText::read(&path, scene::PREVIEW_LINES)))).collect::<Vec<_>>(),
            |s, texts| s.texts.extend(texts),
        );
    }

    fn scene_loaded(&mut self, scene: Scene) {
        self.texts.clear();
        self.requested.clear();
        if !self.options.deterministic {
            eprintln!(
                "[show-code-source] {} packages, {} files, {} dependency edges; discover {:.0} ms, layout {:.0} ms",
                scene.packages.len(),
                scene.file_count,
                scene.edges.len(),
                scene.timings.discover_ms,
                scene.timings.layout_ms
            );
        }
        self.scene = Some(scene);
        self.phase = Phase::Ready;
        if self.view_request.is_none() {
            self.view_request = Some(ViewRequest::Fit);
        }
        if self.options.tsserver {
            imports::start(self);
        } else {
            self.ts = TsStatus::Off("tsserver disabled".into());
        }
    }
}

pub struct App {
    state: State,
    rx: Receiver<UiCallback>,
}

impl App {
    pub fn create(ctx: &egui::Context, options: AppOptions) -> App {
        theme::install(ctx);
        let (jobs, rx) = Jobs::new(ctx.clone());
        let mut state = State {
            options,
            jobs,
            phase: Phase::Loading,
            scene: None,
            camera: Camera { center: pos2(0.0, 0.0), zoom: 1.0 },
            ts: TsStatus::Waiting,
            view_request: None,
            view: Rect::from_min_size(Pos2::ZERO, Vec2::new(1280.0, 800.0)),
            hovered: None,
            texts: HashMap::new(),
            requested: HashSet::new(),
            want_text: Vec::new(),
            progress: Arc::default(),
            cancel: Arc::default(),
        };
        load(&mut state);
        App { state, rx }
    }

    pub fn state(&self) -> &State {
        &self.state
    }

    pub fn state_mut(&mut self) -> &mut State {
        &mut self.state
    }

    fn drain(&mut self) {
        while let Ok(cb) = self.rx.try_recv() {
            cb(&mut self.state);
            self.state.jobs.callback_done();
        }
    }
}

fn load(state: &mut State) {
    let start_dir = state.options.project.clone();
    let progress = state.progress.clone();
    state.jobs.spawn(
        "discover",
        move |_| {
            let start = Instant::now();
            if !start_dir.is_dir() {
                return Err(format!("not a folder: {}", start_dir.display()));
            }
            let root = scs_workspace::find_root(&start_dir);
            let options = scs_workspace::Options { progress: Some(progress), ..Default::default() };
            let ws = scs_workspace::discover(&root, &options).map_err(|e| e.to_string())?;
            let discover_ms = start.elapsed().as_secs_f64() * 1000.0;
            Ok::<_, String>(scene::build(ws, discover_ms))
        },
        |s, r| match r {
            Ok(scene) => s.scene_loaded(scene),
            Err(e) => s.phase = Phase::Failed(e),
        },
    );
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.drain();
        egui::CentralPanel::default().frame(egui::Frame::NONE.fill(theme::T.canvas_bg)).show(ctx, |ui| {
            canvas::show(ui, &mut self.state);
        });
        self.state.read_wanted_texts();
        if matches!(self.state.phase, Phase::Loading) && !self.state.options.deterministic {
            // The file counter moves without events.
            ctx.request_repaint_after(std::time::Duration::from_millis(100));
        }
    }
}

impl Drop for App {
    fn drop(&mut self) {
        self.state.cancel.store(true, Ordering::SeqCst);
    }
}
