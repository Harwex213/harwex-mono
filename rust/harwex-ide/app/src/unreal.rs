//! Unreal Engine projects in the UI (tasks 085, 086): the editor banner that offers
//! "Generate compile_commands.json (UnrealBuildTool)", its confirmation, the UBT job, and the
//! project and engine in the status bar.
//!
//! An opened folder may hold several Unreal projects. Detection is per file: the active C/C++
//! file's folder is looked up on a worker once (`lang::unreal::project_dir`, never a scan of the
//! tree), and each project folder is detected once (`lang::unreal::detect`, with its own
//! `[unreal.projects."<folder>"]` settings). `refresh` detects the known projects again after
//! each `apply_ide_config` and when a `.uproject`, an engine's `Build.version` or a list of
//! installed engines changes (the workspace watcher, plus `ExternalWatch` for files outside the
//! opened folder).
//!
//! The banner belongs to the active file's project and names it. The action never runs on its
//! own: the user presses the button and confirms a dialog that shows the command and every
//! place it writes. Each run is a labelled, cancellable job of one project; a second run with
//! the same engine is refused, because UBT locks the engine. On success only that project's
//! clangd restarts.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use egui::{Context, Frame, Modal, RichText};

use crate::jobs::{Cancel, Jobs};
use crate::lang::unreal::{self, UnrealProject};
use crate::lang::LangId;
use crate::state::AppState;
use crate::theme;

/// The button and job label.
pub const ACTION: &str = "Generate compile_commands.json (UnrealBuildTool)";
/// The title of the hint for a folder with several `.uproject` files.
pub const CHOICE_TITLE: &str = "Several .uproject files";
/// The title of the refusal while UBT runs with the same engine.
pub const BUSY_TITLE: &str = "UnrealBuildTool is busy";

/// One UBT run.
pub struct Run {
    pub cancel: Cancel,
    /// UBT's last output line.
    pub progress: Option<String>,
    /// The engine root: UBT locks it, so one run per engine.
    pub engine: PathBuf,
}

/// Per workspace.
#[derive(Default)]
pub struct UnrealState {
    /// The detected projects by folder.
    pub projects: BTreeMap<PathBuf, UnrealProject>,
    /// A file's folder -> its project folder, `None` outside every project. Filled per file.
    dirs: HashMap<PathBuf, Option<PathBuf>>,
    /// Folders whose lookup runs now.
    pending: HashSet<PathBuf>,
    /// The project whose confirmation dialog is open.
    pub confirm: Option<PathBuf>,
    /// Running UBT jobs by project folder.
    pub runs: BTreeMap<PathBuf, Run>,
    /// "Not now" in the banner, per project, until the folder is opened again.
    pub dismissed: HashSet<PathBuf>,
    /// Projects whose several-`.uproject` hint was shown.
    choice_hinted: HashSet<PathBuf>,
    /// Drops lookup and detection answers that a newer refresh replaced.
    detect_gen: u64,
    /// Watches the engine files outside the opened folder.
    external: Option<ExternalWatch>,
    /// The engine roots `external` was set up for (`None`: never set up).
    watched_engines: Option<Vec<PathBuf>>,
    /// Lookups and refreshes run so far, for tests.
    pub lookups: usize,
}

impl UnrealState {
    /// The project of a file whose folder was looked up already.
    pub fn project_of(&self, file: &Path) -> Option<&UnrealProject> {
        let dir = self.dirs.get(file.parent()?)?.as_ref()?;
        self.projects.get(dir)
    }

    /// The lookup of the file's folder has finished (with or without a project).
    pub fn looked_up(&self, file: &Path) -> bool {
        file.parent().is_some_and(|d| self.dirs.contains_key(d))
    }

    pub fn is_running(&self, project: &Path) -> bool {
        self.runs.contains_key(project)
    }
}

/// The active editor's C/C++ file, when it may belong to an Unreal project.
fn active_cpp_file(state: &AppState) -> Option<PathBuf> {
    let e = state.ws.tabs.active_editor()?;
    // Files outside the opened folder (engine headers) get `None` from the lookup's walk.
    (LangId::for_path(&e.path) == Some(LangId::Cpp)).then(|| e.path.clone())
}

/// The project of the active C/C++ file, once its lookup finished.
pub fn active_project(state: &AppState) -> Option<&UnrealProject> {
    state.ws.unreal.project_of(&active_cpp_file(state)?)
}

/// The status bar part for the active file: "Game2 · UE 5.8".
pub fn status_label(state: &AppState) -> Option<String> {
    let p = active_project(state)?;
    Some(format!("{} · {}", p.name, p.engine_label().unwrap_or_else(|| "no engine".into())))
}

fn top(state: &AppState) -> Option<PathBuf> {
    state.ws.project.as_ref().map(|p| p.root.clone())
}

/// Looks up the active C/C++ file's project on a worker, once per folder. Called every frame.
fn tick(state: &mut AppState) {
    let Some(file) = active_cpp_file(state) else { return };
    let Some(dir) = file.parent().map(Path::to_path_buf) else { return };
    let u = &state.ws.unreal;
    if u.dirs.contains_key(&dir) || u.pending.contains(&dir) {
        return;
    }
    let Some(top) = top(state) else { return };
    let cfg = state.ws.langs.config.unreal.clone();
    let known: HashSet<PathBuf> = u.projects.keys().cloned().collect();
    let gen = u.detect_gen;
    state.ws.unreal.pending.insert(dir.clone());
    state.ws.unreal.lookups += 1;
    state.jobs.spawn_quiet(
        move || {
            let project = unreal::project_dir(&file, &top);
            let found = project.as_ref().filter(|p| !known.contains(*p)).and_then(|p| unreal::detect(p, &cfg.for_project(&unreal::rel_key(p, &top))));
            (project, found)
        },
        move |state, (project, found)| {
            if state.ws.unreal.detect_gen != gen {
                return;
            }
            state.ws.unreal.pending.remove(&dir);
            state.ws.unreal.dirs.insert(dir, project);
            if let Some(p) = found {
                detected(state, p);
            }
            watch_engines(state);
        },
    );
}

/// A newly detected project: the log line, the one-time several-`.uproject` hint.
fn detected(state: &mut AppState, p: UnrealProject) {
    let engine = match &p.engine {
        Ok(e) => format!("engine {} ({})", e.root.display(), e.version.as_deref().unwrap_or("unknown version")),
        Err(e) => e.clone(),
    };
    state.timings.log(format!("Unreal project {} in {}: {engine}, database {}", p.name, p.root.display(), if p.has_db { "present" } else { "missing" }));
    if let Some(hint) = p.choice_hint() {
        if state.ws.unreal.choice_hinted.insert(p.root.clone()) {
            state.notifications.info(CHOICE_TITLE, hint);
        }
    }
    state.ws.unreal.projects.insert(p.root.clone(), p);
}

/// Detects every known project again on a worker. `files_moved`: a `.uproject` appeared or
/// went away, so the folders are looked up again too. Called after each `apply_ide_config`.
pub fn refresh(state: &mut AppState, files_moved: bool) {
    let Some(top) = top(state) else { return };
    let u = &mut state.ws.unreal;
    u.detect_gen += 1;
    u.pending.clear();
    if files_moved {
        u.dirs.clear();
    }
    let mut known: Vec<PathBuf> = u.projects.keys().cloned().collect();
    known.extend(u.dirs.values().flatten().cloned());
    known.sort();
    known.dedup();
    if known.is_empty() {
        return;
    }
    u.lookups += 1;
    let gen = u.detect_gen;
    let cfg = state.ws.langs.config.unreal.clone();
    state.jobs.spawn_quiet(
        move || known.into_iter().map(|dir| (dir.clone(), unreal::detect(&dir, &cfg.for_project(&unreal::rel_key(&dir, &top))))).collect::<Vec<_>>(),
        move |state, found| {
            if state.ws.unreal.detect_gen != gen {
                return;
            }
            // A lookup that finished meanwhile may have added a project; it stays.
            for (dir, p) in found {
                match p {
                    Some(p) if state.ws.unreal.projects.get(&dir) == Some(&p) => {}
                    Some(p) => detected(state, p),
                    None => {
                        state.ws.unreal.projects.remove(&dir);
                    }
                }
            }
            watch_engines(state);
        },
    );
}

/// Detects the projects again when one of their inputs changed in the opened folder.
pub fn on_fs_batch(state: &mut AppState, paths: &HashSet<PathBuf>) {
    if paths.iter().any(|p| unreal::is_detection_input(p)) {
        refresh(state, paths.iter().any(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("uproject"))));
    }
}

/// Watches the engine files outside the opened folder: each engine's `Build.version` and the
/// lists of installed engines. Dropping it stops watching.
struct ExternalWatch {
    _inner: notify::RecommendedWatcher,
}

/// Sets the external watch up again when the set of engines changed. Off without the file
/// watcher (all tests).
fn watch_engines(state: &mut AppState) {
    if !state.watch_files {
        return;
    }
    let mut engines: Vec<unreal::Engine> = state.ws.unreal.projects.values().filter_map(|p| p.engine.clone().ok()).collect();
    engines.sort_by(|a, b| a.root.cmp(&b.root));
    engines.dedup_by(|a, b| a.root == b.root);
    let roots: Vec<PathBuf> = engines.iter().map(|e| e.root.clone()).collect();
    if state.ws.unreal.watched_engines.as_ref() == Some(&roots) {
        return;
    }
    state.ws.unreal.watched_engines = Some(roots);
    let jobs = state.jobs.clone();
    let top = top(state);
    state.jobs.spawn_quiet(
        move || start_external(unreal::external_watch_dirs(engines.iter()).into_iter().filter(|d| top.as_ref().is_none_or(|t| !d.starts_with(t))).collect(), jobs),
        |state, watch| state.ws.unreal.external = watch,
    );
}

/// Blocking (FSEvents setup): call it on a worker.
fn start_external(dirs: Vec<PathBuf>, jobs: Jobs) -> Option<ExternalWatch> {
    if dirs.is_empty() {
        return None;
    }
    // One refresh in flight however many events arrive.
    let posted = Arc::new(AtomicBool::new(false));
    let mut inner = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(ev) = res else { return };
        if matches!(ev.kind, notify::EventKind::Access(_)) || !ev.paths.iter().any(|p| unreal::is_detection_input(p)) {
            return;
        }
        if !posted.swap(true, Ordering::SeqCst) {
            let posted = posted.clone();
            jobs.post(move |state| {
                posted.store(false, Ordering::SeqCst);
                refresh(state, false);
            });
        }
    })
    .ok()?;
    for d in &dirs {
        let _ = notify::Watcher::watch(&mut inner, d, notify::RecursiveMode::NonRecursive);
    }
    Some(ExternalWatch { _inner: inner })
}

/// The project that runs UBT with this engine now, if any.
fn engine_busy<'a>(state: &'a AppState, engine: &Path) -> Option<&'a Path> {
    state.ws.unreal.runs.iter().find(|(_, r)| r.engine == engine).map(|(dir, _)| dir.as_path())
}

/// Whether the banner shows now, and for which project.
fn banner_project(state: &AppState) -> Option<&UnrealProject> {
    let p = active_project(state)?;
    let u = &state.ws.unreal;
    (u.is_running(&p.root) || !p.has_db && !u.dismissed.contains(&p.root)).then_some(p)
}

/// The bar above the editor. A panel, like the git operation banner, so it pushes the editor
/// down instead of covering it.
pub fn banner(state: &mut AppState, ctx: &Context) {
    tick(state);
    let Some(p) = banner_project(state) else { return };
    let dir = p.root.clone();
    let run = state.ws.unreal.runs.get(&dir);
    let running = run.is_some();
    let ready = p.command();
    let text = match run {
        Some(r) => match &r.progress {
            Some(line) => format!("{}: UnrealBuildTool is writing compile_commands.json: {line}", p.name),
            None => format!("{}: UnrealBuildTool is writing compile_commands.json…", p.name),
        },
        None => match &ready {
            Ok(_) => match p.engine.as_ref().ok().and_then(|e| e.version.clone()) {
                Some(v) => format!("{}: no compile database for clangd yet (Unreal Engine {v}).", p.name),
                None => format!("{}: no compile database for clangd yet.", p.name),
            },
            Err(why) => format!("{}: {why}", p.name),
        },
    };
    let (mut generate, mut stop, mut dismiss) = (false, false, false);
    egui::TopBottomPanel::top(crate::workspace::wid("unreal-banner")).frame(Frame::NONE.fill(theme::T.banner_bg).inner_margin(egui::Margin::symmetric(10, 4))).show(ctx, |ui| {
        ui.horizontal(|ui| {
            if running {
                // The status bar shows the job with its time; the banner adds UBT's output.
                if ui.button("Stop").clicked() {
                    stop = true;
                }
            } else {
                if ui.add_enabled(ready.is_ok(), egui::Button::new(ACTION)).clicked() {
                    generate = true;
                }
                if ui.button("Not now").clicked() {
                    dismiss = true;
                }
            }
            ui.add(egui::Label::new(RichText::new(text).color(theme::T.text_bright)).truncate());
        });
    });
    if generate && !refuse_busy(state, &dir) {
        state.ws.unreal.confirm = Some(dir.clone());
    }
    if dismiss {
        state.ws.unreal.dismissed.insert(dir.clone());
    }
    if stop {
        if let Some(r) = state.ws.unreal.runs.get(&dir) {
            r.cancel.cancel();
        }
    }
}

/// Refuses a run while UBT runs with the same engine for another project. True: refused.
fn refuse_busy(state: &mut AppState, dir: &Path) -> bool {
    let Some(p) = state.ws.unreal.projects.get(dir) else { return true };
    let Ok(engine) = &p.engine else { return false };
    let Some(other) = engine_busy(state, &engine.root) else { return false };
    let other = state.ws.unreal.projects.get(other).map(|o| o.name.clone()).unwrap_or_else(|| other.display().to_string());
    let body = format!(
        "UnrealBuildTool is writing the database of {other} with the same engine ({}), and it locks the engine. Generate it for {} after that run ends.",
        engine.root.display(),
        p.name
    );
    state.notifications.warn(BUSY_TITLE, body);
    true
}

/// The confirmation dialog.
pub fn show(state: &mut AppState, ctx: &Context) {
    let Some(dir) = state.ws.unreal.confirm.clone() else { return };
    let Some(cmd) = state.ws.unreal.projects.get(&dir).and_then(|p| p.command().ok()) else {
        state.ws.unreal.confirm = None;
        return;
    };
    let name = state.ws.unreal.projects.get(&dir).map(|p| p.name.clone()).unwrap_or_default();
    let rel = top(state).map(|t| unreal::rel_key(&dir, &t)).unwrap_or_default();
    let keep_engine = state.ws.langs.config.unreal.for_project(&rel).index_engine;
    let t = &theme::T;
    let mut choice = None;
    let m = Modal::new(crate::workspace::wid("unreal-generate-confirm")).show(ctx, |ui| {
        ui.set_width(560.0);
        ui.label(RichText::new(format!("{ACTION}?")).strong().color(t.text_bright));
        ui.add_space(4.0);
        ui.label(format!("UnrealBuildTool runs this command for {name}. It can take several minutes:"));
        ui.add(egui::Label::new(RichText::new(cmd.display()).monospace().color(t.text)).wrap());
        ui.add_space(4.0);
        ui.label(format!("UnrealBuildTool writes the full database into {}.", cmd.output_dir.display()));
        let scope = if keep_engine {
            "It keeps the engine's files too (index_engine = true), so clangd indexes the whole engine."
        } else {
            "It keeps only this project's files; clangd indexes engine files when you open them."
        };
        ui.label(format!("clangd reads {}. {scope}", cmd.database.display()));
        ui.label(RichText::new(format!("UnrealBuildTool also writes build state into the project's Intermediate folder. With a source-built engine it also writes generated files under {}.", cmd.engine.join("Engine/Intermediate").display())).color(t.warning));
        ui.add_space(6.0);
        ui.horizontal(|ui| {
            if ui.button("Generate").clicked() {
                choice = Some(true);
            }
            if ui.button("Cancel").clicked() {
                choice = Some(false);
            }
        });
    });
    if m.should_close() && choice.is_none() {
        choice = Some(false);
    }
    match choice {
        Some(true) => {
            state.ws.unreal.confirm = None;
            if !refuse_busy(state, &dir) {
                generate(state, dir, cmd, keep_engine);
            }
        }
        Some(false) => state.ws.unreal.confirm = None,
        None => {}
    }
}

/// Starts UBT for one project on a labelled, cancellable job.
fn generate(state: &mut AppState, dir: PathBuf, cmd: unreal::GenerateCommand, keep_engine: bool) {
    if state.ws.unreal.is_running(&dir) {
        return;
    }
    state.timings.log(format!("{ACTION}: {}", cmd.display()));
    let jobs = state.jobs.clone();
    let engine = cmd.engine.clone();
    let (d, d2) = (dir.clone(), dir.clone());
    let cancel = state.jobs.spawn_cancellable(
        ACTION,
        move || {
            let flag = crate::jobs::current_cancel();
            // One banner update in flight at a time, carrying the newest line, however much
            // UBT prints.
            let latest = Arc::new(Mutex::new(String::new()));
            let posted = Arc::new(AtomicBool::new(false));
            unreal::run_generate(&cmd, keep_engine, &flag, |line| {
                let line = line.trim();
                if line.is_empty() {
                    return;
                }
                *crate::lang::lock(&latest) = line.chars().take(200).collect();
                if !posted.swap(true, Ordering::SeqCst) {
                    let (latest, posted, d) = (latest.clone(), posted.clone(), d.clone());
                    jobs.post(move |state| {
                        posted.store(false, Ordering::SeqCst);
                        if let Some(r) = state.ws.unreal.runs.get_mut(&d) {
                            r.progress = Some(crate::lang::lock(&latest).clone());
                        }
                    });
                }
            })
        },
        move |state, res: Result<unreal::Generated, String>| {
            state.ws.unreal.runs.remove(&d2);
            match res {
                Ok(g) => {
                    let body = format!("{} of {} files in {} ({:.1} s). clangd restarted with it.", g.kept, g.total, g.database.display(), g.took.as_secs_f64());
                    state.timings.log(format!("compile_commands.json generated: {body}"));
                    state.notifications.info("compile_commands.json generated", body);
                    restart_clangd(state, &d2);
                    refresh(state, false);
                }
                Err(e) if crate::progress::is_cancel_text(&e) => state.timings.log(e),
                Err(e) => state.notifications.error("UnrealBuildTool failed", e),
            }
        },
    );
    state.ws.unreal.runs.insert(dir, Run { cancel, progress: None, engine });
}

/// Only the project's clangd stops; its open files (and engine headers it served) go to a
/// fresh one, which finds the new database. Other projects keep their servers.
fn restart_clangd(state: &mut AppState, dir: &Path) {
    let mut docs = Vec::new();
    for (_, e) in state.ws.tabs.editors_mut() {
        if e.lang == Some(LangId::Cpp) {
            if e.path.starts_with(dir) {
                e.problems.recheck();
            }
            e.lsp_version = Some(e.doc.version());
            docs.push((e.path.clone(), e.doc.text()));
        }
    }
    state.ws.langs.bridge(LangId::Cpp).restart_root(dir, docs);
}
