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
//!
//! A database can also be out of date (task 102): a build input is newer than it, or the
//! active file's module has no entry in it. `check_db` runs `lang::unreal::check_db` on a
//! worker after each detection, after a UBT run, on a `*.Build.cs`/`*.Target.cs`/database
//! change and when the active file enters another module; the JSON is parsed once per mtime.
//! The banner then names the reason and offers the same Generate button.
//!
//! Task 120: the database can be regenerated at any time, also while it looks fresh and after
//! "Not now". The Unreal part of the status bar opens a menu (Regenerate or Stop, Restart
//! clangd, the database's age and entry count), and each project row in Settings › Frameworks
//! has a Regenerate button. Every entry goes through `request_generate`, so the same
//! confirmation dialog, the one-run-per-engine rule and the running banner apply.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use egui::{Context, Frame, Modal, RichText};

use crate::jobs::{Cancel, Jobs};
use crate::lang::unreal::{self, DbCheck, Module, Stale, UnrealProject};
use crate::lang::LangId;
use crate::state::AppState;
use crate::theme;

/// The button and job label.
pub const ACTION: &str = "Generate compile_commands.json (UnrealBuildTool)";
/// The title of the hint for a folder with several `.uproject` files.
pub const CHOICE_TITLE: &str = "Several .uproject files";
/// The title of the refusal while UBT runs with the same engine.
pub const BUSY_TITLE: &str = "UnrealBuildTool is busy";
/// The menu item and the Settings button that run UBT again.
pub const REGENERATE: &str = "Regenerate compile_commands.json (UnrealBuildTool)";
/// The menu item while UBT runs for the project.
pub const STOP: &str = "Stop UnrealBuildTool";
pub const RESTART_CLANGD: &str = "Restart clangd";

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
    /// A file's folder -> its module, for folders inside a project. Filled per file.
    modules: HashMap<PathBuf, Option<Module>>,
    /// Folders whose module lookup runs now.
    modules_pending: HashSet<PathBuf>,
    /// The last database check per project folder.
    dbs: HashMap<PathBuf, DbCheck>,
    /// The generation of each project's newest check; older answers are dropped.
    db_gen: HashMap<PathBuf, u64>,
    /// The module folder of the active file at the last frame, to recheck on a module change.
    active_module: Option<PathBuf>,
    /// Database checks started so far, for tests.
    pub db_checks: usize,
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

    /// Why the database of the file's project is out of date for this file, once its checks
    /// finished. `None` without a database: the "no database" banner covers that.
    pub fn stale_for(&self, file: &Path) -> Option<Stale> {
        let p = self.project_of(file)?;
        let check = self.dbs.get(&p.root)?;
        let module = self.modules.get(file.parent()?).and_then(Option::as_ref);
        unreal::stale(check, module)
    }
}

/// What a project's database looks like after its last check.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DbInfo {
    /// No check has finished yet.
    Checking,
    Missing,
    Present { mtime: std::time::SystemTime, entries: usize },
}

impl DbInfo {
    /// "compile_commands.json: 12 entries, generated 3 min ago".
    pub fn text(&self) -> String {
        match self {
            DbInfo::Checking => "Checking compile_commands.json…".into(),
            DbInfo::Missing => "No compile_commands.json yet".into(),
            DbInfo::Present { mtime, entries } => {
                let n = if *entries == 1 { "1 entry".to_string() } else { format!("{entries} entries") };
                format!("compile_commands.json: {n}, generated {}", age_text(*mtime))
            }
        }
    }
}

/// "just now", "5 min ago", "3 h ago", "2 days ago". A relative age needs no time zone.
pub fn age_text(t: std::time::SystemTime) -> String {
    let secs = std::time::SystemTime::now().duration_since(t).map_or(0, |d| d.as_secs());
    match secs {
        0..60 => "just now".into(),
        60..3600 => format!("{} min ago", secs / 60),
        3600..86400 => format!("{} h ago", secs / 3600),
        _ if secs < 2 * 86400 => "1 day ago".into(),
        _ => format!("{} days ago", secs / 86400),
    }
}

/// The state of one project for the status bar menu and Settings › Frameworks.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Status {
    pub name: String,
    /// UBT runs for this project now.
    pub running: bool,
    /// Whether a run may start now, or why not.
    pub can: Result<(), String>,
    pub db: DbInfo,
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

/// Why the active file's database is out of date, if it is.
pub fn active_stale(state: &AppState) -> Option<Stale> {
    state.ws.unreal.stale_for(&active_cpp_file(state)?)
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
    if let Some(project) = u.dirs.get(&dir) {
        let Some(project) = project else { return };
        match u.modules.get(&dir) {
            Some(module) => {
                let module_dir = module.as_ref().map(|m| &m.dir);
                if module_dir != u.active_module.as_ref() {
                    // The active file entered another module: the database may lack it.
                    let (project, module_dir) = (project.clone(), module_dir.cloned());
                    state.ws.unreal.active_module = module_dir;
                    check_db(state, &project);
                }
            }
            None if !u.modules_pending.contains(&dir) => {
                let project = project.clone();
                look_up_module(state, file, dir, project);
            }
            None => {}
        }
        return;
    }
    if u.pending.contains(&dir) {
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
            let module = project.as_ref().and_then(|p| unreal::module_of(&file, p));
            (project, found, module)
        },
        move |state, (project, found, module)| {
            if state.ws.unreal.detect_gen != gen {
                return;
            }
            state.ws.unreal.pending.remove(&dir);
            if project.is_some() {
                state.ws.unreal.modules.insert(dir.clone(), module);
            }
            state.ws.unreal.dirs.insert(dir, project);
            if let Some(p) = found {
                let root = p.root.clone();
                detected(state, p);
                check_db(state, &root);
            }
            watch_engines(state);
        },
    );
}

/// Looks up the module of a folder whose project is known (after a `*.Build.cs` change).
fn look_up_module(state: &mut AppState, file: PathBuf, dir: PathBuf, project: PathBuf) {
    state.ws.unreal.modules_pending.insert(dir.clone());
    let gen = state.ws.unreal.detect_gen;
    state.jobs.spawn_quiet(
        move || unreal::module_of(&file, &project),
        move |state, module| {
            state.ws.unreal.modules_pending.remove(&dir);
            if state.ws.unreal.detect_gen == gen {
                state.ws.unreal.modules.insert(dir, module);
            }
        },
    );
}

/// Checks a project's database on a worker. The parsed database is reused while its mtime
/// stays the same.
fn check_db(state: &mut AppState, root: &Path) {
    let u = &mut state.ws.unreal;
    let Some(p) = u.projects.get(root).cloned() else { return };
    let prev = u.dbs.get(root).and_then(|c| c.index.clone());
    let gen = u.db_gen.entry(root.to_path_buf()).or_default();
    *gen += 1;
    let gen = *gen;
    u.db_checks += 1;
    let root = root.to_path_buf();
    state.jobs.spawn_quiet(
        move || unreal::check_db(&p, prev),
        move |state, check| {
            if state.ws.unreal.db_gen.get(&root) != Some(&gen) {
                return;
            }
            if let Some(why) = unreal::stale(&check, None) {
                state.timings.log(format!("Unreal database of {} is out of date: {}", root.display(), why.reason()));
            }
            state.ws.unreal.dbs.insert(root, check);
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
        u.modules.clear();
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
                        state.ws.unreal.dbs.remove(&dir);
                    }
                }
            }
            // The database may have been written or its inputs changed meanwhile.
            let roots: Vec<PathBuf> = state.ws.unreal.projects.keys().cloned().collect();
            for root in roots {
                check_db(state, &root);
            }
            watch_engines(state);
        },
    );
}

/// Detects the projects again when one of their inputs changed in the opened folder, and
/// checks a database again when its build inputs or the database itself changed.
pub fn on_fs_batch(state: &mut AppState, paths: &HashSet<PathBuf>) {
    if paths.iter().any(|p| unreal::is_detection_input(p)) {
        // `refresh` checks every database too.
        refresh(state, paths.iter().any(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("uproject"))));
        return;
    }
    let database = |p: &Path| p.file_name().is_some_and(|n| n == "compile_commands.json") && p.parent().is_some_and(|d| d.ends_with(unreal::DB_DIR));
    let changed: Vec<&PathBuf> = paths.iter().filter(|p| unreal::is_build_input(p) || database(p)).collect();
    if changed.is_empty() {
        return;
    }
    // A new or moved `*.Build.cs` moves module borders: look the modules up again.
    if changed.iter().any(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.ends_with(".Build.cs"))) {
        state.ws.unreal.modules.clear();
        state.ws.unreal.active_module = None;
    }
    let roots: Vec<PathBuf> = state.ws.unreal.projects.keys().filter(|r| changed.iter().any(|p| p.starts_with(r))).cloned().collect();
    for root in roots {
        check_db(state, &root);
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

/// The state of a detected project, `None` for an unknown folder.
pub fn status_of(state: &AppState, dir: &Path) -> Option<Status> {
    let u = &state.ws.unreal;
    let p = u.projects.get(dir)?;
    let db = match u.dbs.get(dir) {
        None => DbInfo::Checking,
        Some(DbCheck { index: None, .. }) => DbInfo::Missing,
        Some(DbCheck { index: Some(i), .. }) => DbInfo::Present { mtime: i.mtime, entries: i.entries },
    };
    Some(Status { name: p.name.clone(), running: u.is_running(dir), can: can_generate(state, dir), db })
}

/// Whether UBT may start for the project now: the engine and the target are known, and no
/// other run uses the same engine. A project that runs already counts as busy.
pub fn can_generate(state: &AppState, dir: &Path) -> Result<(), String> {
    let p = state.ws.unreal.projects.get(dir).ok_or_else(|| "The project is not detected.".to_string())?;
    let cmd = p.command()?;
    match engine_busy(state, &cmd.engine) {
        Some(other) if other == dir => Err("UnrealBuildTool is running for this project.".into()),
        Some(other) => {
            let other = state.ws.unreal.projects.get(other).map_or_else(|| other.display().to_string(), |o| o.name.clone());
            Err(format!("UnrealBuildTool is writing the database of {other} with the same engine, and it locks the engine."))
        }
        None => Ok(()),
    }
}

/// Opens the confirmation dialog for a run. Every entry (banner, status bar menu, Settings)
/// goes through here, so UBT never starts without the confirmation. A busy engine is refused
/// with a toast.
pub fn request_generate(state: &mut AppState, dir: &Path) {
    if state.ws.unreal.is_running(dir) || refuse_busy(state, dir) {
        return;
    }
    state.ws.unreal.confirm = Some(dir.to_path_buf());
}

/// Stops the project's UBT run, if one runs.
pub fn stop(state: &mut AppState, dir: &Path) {
    if let Some(r) = state.ws.unreal.runs.get(dir) {
        r.cancel.cancel();
    }
}

/// The project that runs UBT with this engine now, if any.
fn engine_busy<'a>(state: &'a AppState, engine: &Path) -> Option<&'a Path> {
    state.ws.unreal.runs.iter().find(|(_, r)| r.engine == engine).map(|(dir, _)| dir.as_path())
}

/// Whether the banner shows now, for which project, and why its database is out of date.
fn banner_project(state: &AppState) -> Option<(&UnrealProject, Option<Stale>)> {
    let p = active_project(state)?;
    let u = &state.ws.unreal;
    let stale = if p.has_db { active_stale(state) } else { None };
    (u.is_running(&p.root) || (!p.has_db || stale.is_some()) && !u.dismissed.contains(&p.root)).then_some((p, stale))
}

/// The bar above the editor. A panel, like the git operation banner, so it pushes the editor
/// down instead of covering it.
pub fn banner(state: &mut AppState, ctx: &Context) {
    tick(state);
    let Some((p, stale)) = banner_project(state) else { return };
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
            Ok(_) if p.has_db => format!("{}: compile database is out of date ({}).", p.name, stale.as_ref().map(Stale::reason).unwrap_or_default()),
            Ok(_) => match p.engine.as_ref().ok().and_then(|e| e.version.clone()) {
                Some(v) => format!("{}: no compile database for clangd yet (Unreal Engine {v}).", p.name),
                None => format!("{}: no compile database for clangd yet.", p.name),
            },
            Err(why) => format!("{}: {why}", p.name),
        },
    };
    let (mut generate, mut stop_run, mut dismiss) = (false, false, false);
    egui::TopBottomPanel::top(crate::workspace::wid("unreal-banner")).frame(Frame::NONE.fill(theme::T.banner_bg).inner_margin(egui::Margin::symmetric(10, 4))).show(ctx, |ui| {
        ui.horizontal(|ui| {
            if running {
                // The status bar shows the job with its time; the banner adds UBT's output.
                if ui.button("Stop").clicked() {
                    stop_run = true;
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
    if generate {
        request_generate(state, &dir);
    }
    if dismiss {
        state.ws.unreal.dismissed.insert(dir.clone());
    }
    if stop_run {
        stop(state, &dir);
    }
}

fn menu_open_id() -> egui::Id {
    crate::workspace::wid("unreal-status-menu-open")
}

/// Whether the status bar menu is open, for tests.
pub fn menu_open(ctx: &Context) -> bool {
    ctx.data(|d| d.get_temp::<bool>(menu_open_id())).unwrap_or(false)
}

/// The status bar text of a C/C++ file of an Unreal project ("clangd 22.1 · Game2 · UE 5.8").
/// A press opens the project's menu. A11y: `Unreal project <name>`, the text as its value.
pub fn status_item(state: &mut AppState, ui: &mut egui::Ui, text: &str) {
    let t = &theme::T;
    let Some(dir) = active_project(state).map(|p| p.root.clone()) else { return };
    let Some(status) = status_of(state, &dir) else { return };
    let ctx = ui.ctx().clone();
    let galley = ui.painter().layout_no_wrap(text.to_string(), t.small_font(), t.text_dim);
    let (rect, resp) = ui.allocate_exact_size(galley.size(), egui::Sense::click());
    let open = menu_open(&ctx);
    if resp.hovered() || open {
        ui.painter().rect_filled(rect.expand2(egui::vec2(4.0, 2.0)), t.radius.button, t.hover_on_window);
    }
    ui.painter().galley(rect.min, galley, t.text_dim);
    let value = text.to_string();
    resp.widget_info(|| egui::WidgetInfo { current_text_value: Some(value.clone()), ..egui::WidgetInfo::labeled(egui::WidgetType::Button, true, format!("Unreal project {}", status.name)) });
    if crate::clicks::pressed(&resp) {
        ctx.data_mut(|d| d.insert_temp(menu_open_id(), !open));
        return;
    }
    if !open {
        resp.on_hover_text("Press for the compile database actions");
        return;
    }
    match status_menu(&ctx, rect, &status) {
        Some(MenuChoice::Regenerate) => request_generate(state, &dir),
        Some(MenuChoice::Stop) => stop(state, &dir),
        Some(MenuChoice::RestartClangd) => {
            state.timings.log(format!("{RESTART_CLANGD} for {}", dir.display()));
            restart_clangd(state, &dir);
        }
        None => return,
    }
    ctx.data_mut(|d| d.insert_temp(menu_open_id(), false));
}

enum MenuChoice {
    Regenerate,
    Stop,
    RestartClangd,
}

const MENU_W: f32 = 380.0;

/// The menu above the status bar item, its right edge at the item's right edge.
fn status_menu(ctx: &Context, anchor: egui::Rect, status: &Status) -> Option<MenuChoice> {
    let t = &theme::T;
    let frame = Frame::popup(&ctx.style()).fill(t.popup_bg).stroke(egui::Stroke::new(1.0_f32, t.popup_border)).corner_radius(t.radius.popup).inner_margin(egui::Margin::same(6)).shadow(t.popup_shadow());
    let pos = egui::pos2((anchor.right() + 4.0).min(ctx.screen_rect().right() - 4.0), anchor.top() - 6.0);
    let mut choice = None;
    let area = egui::Area::new(crate::workspace::wid("unreal-status-menu")).order(egui::Order::Foreground).fixed_pos(pos).pivot(egui::Align2::RIGHT_BOTTOM).constrain(true).default_size(egui::vec2(MENU_W, 90.0)).show(ctx, |ui| {
        frame.show(ui, |ui| {
            ui.set_width(MENU_W);
            ui.visuals_mut().button_frame = false;
            ui.style_mut().wrap_mode = Some(egui::TextWrapMode::Truncate);
            ui.with_layout(egui::Layout::top_down_justified(egui::Align::LEFT), |ui| {
                if status.running {
                    if ui.button(STOP).clicked() {
                        choice = Some(MenuChoice::Stop);
                    }
                } else {
                    let r = ui.add_enabled(status.can.is_ok(), egui::Button::new(REGENERATE));
                    let r = match &status.can {
                        Err(why) => r.on_disabled_hover_text(why),
                        Ok(()) => r,
                    };
                    if r.clicked() {
                        choice = Some(MenuChoice::Regenerate);
                    }
                }
                if ui.button(RESTART_CLANGD).clicked() {
                    choice = Some(MenuChoice::RestartClangd);
                }
                ui.separator();
                ui.add_enabled(false, egui::Label::new(RichText::new(status.db.text()).size(t.font.small)));
            });
        });
    });
    let menu = area.response.rect;
    let pressed_outside = ctx.input(|i| i.pointer.any_pressed() && i.pointer.interact_pos().is_some_and(|p| !menu.contains(p) && !anchor.contains(p)));
    let escape = ctx.input_mut(|i| i.consume_key(egui::Modifiers::NONE, egui::Key::Escape));
    if choice.is_none() && (pressed_outside || escape) {
        ctx.data_mut(|d| d.insert_temp(menu_open_id(), false));
    }
    choice
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
pub fn restart_clangd(state: &mut AppState, dir: &Path) {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    #[test]
    fn database_info_text() {
        let ago = |s: u64| SystemTime::now() - Duration::from_secs(s);
        assert_eq!(age_text(ago(5)), "just now");
        assert_eq!(age_text(ago(125)), "2 min ago");
        assert_eq!(age_text(ago(3 * 3600 + 10)), "3 h ago");
        assert_eq!(age_text(ago(86400 + 10)), "1 day ago");
        assert_eq!(age_text(ago(5 * 86400)), "5 days ago");
        // A clock that went back reads as now.
        assert_eq!(age_text(SystemTime::now() + Duration::from_secs(60)), "just now");
        assert_eq!(DbInfo::Present { mtime: ago(0), entries: 1 }.text(), "compile_commands.json: 1 entry, generated just now");
        assert_eq!(DbInfo::Present { mtime: ago(600), entries: 12 }.text(), "compile_commands.json: 12 entries, generated 10 min ago");
        assert_eq!(DbInfo::Missing.text(), "No compile_commands.json yet");
    }

    #[test]
    fn index_counts_entries() {
        let text = r#"[{"file": "/p/A.cpp", "directory": "/p"}, {"file": "B.cpp", "directory": "/p"}, {"directory": "/p"}]"#;
        assert_eq!(unreal::DbIndex::parse(text, SystemTime::UNIX_EPOCH).entries, 2);
        assert_eq!(unreal::DbIndex::parse("not json", SystemTime::UNIX_EPOCH).entries, 0);
    }
}
