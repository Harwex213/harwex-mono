//! `AppState`: everything the UI shows, owned by the UI thread. Workers never touch it directly;
//! they send closures through `Jobs` that run here at the start of a frame.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};

use ide_editor::{Document, EditorTheme, GutterMark, Position};
use ide_git::{ChangeKind, FileChange, LineChangeKind, Repo};

use crate::git::GitUi;
use crate::jobs::{Jobs, Posted};
use crate::lang::IdeConfig;
use crate::layout::Layout;
use crate::nav::{self, NavPoint};
use crate::notifications::Notifications;
use crate::search::FileIndex;
use crate::tabs::{CustomTab, EditorTab, TabContent, TabId};
use crate::testhook::TestScript;
use crate::theme;
use crate::watcher::FsBatch;
use crate::workspace::{Workspace, WorkspaceId, WorkspaceInfo};

pub struct Project {
    /// Canonical.
    pub root: PathBuf,
    pub name: String,
    pub generation: u64,
}

/// Git data the shell keeps fresh for the tree, the top bar and the Git UI.
#[derive(Default)]
pub struct GitInfo {
    pub repo: Option<Repo>,
    /// Current branch, or a short hash when detached. `None` before the first refresh.
    pub branch: Option<String>,
    pub detached: bool,
    /// Combined HEAD-vs-worktree kind per absolute path, as IDEA colors file names.
    pub status: HashMap<PathBuf, ChangeKind>,
    /// The raw status, for the Commit tool window.
    pub changes: Vec<FileChange>,
    /// Directories that contain a change, colored like a modified file.
    pub dirty_dirs: HashSet<PathBuf>,
    /// Full and path-limited status runs (`git/refresh.rs`).
    pub refresh: crate::git::refresh::RefreshState,
    pub status_ms: Option<f64>,
}

/// Requests from places that cannot borrow `AppState` mutably (custom tabs).
#[allow(dead_code)] // Extension surface for the Git UI phase.
pub enum AppCommand {
    OpenLocation { path: PathBuf, pos: Option<Position> },
    CloseTab(TabId),
    OpenCustomTab(Box<dyn CustomTab>),
    RefreshGit,
}

/// What a custom tab gets while drawing.
#[allow(dead_code)] // Extension surface for the Git UI phase.
pub struct TabEnv<'a> {
    pub jobs: &'a Jobs,
    pub notifications: &'a mut Notifications,
    pub project: Option<&'a Project>,
    pub git: &'a GitInfo,
    pub commands: &'a mut Vec<AppCommand>,
    pub tab_id: TabId,
    pub editor_theme: &'a EditorTheme,
    /// The editor tab of `CustomTab::shared_editor`'s file, lent while the tab draws.
    pub editor: Option<(TabId, &'a mut crate::tabs::EditorTab)>,
}

/// Timing lines go to stderr and to the Notifications log, so a run can be measured.
pub struct Timings {
    pub start: Instant,
    /// Tests silence the log; their failures print state instead.
    pub quiet: bool,
}

impl Timings {
    pub fn log(&self, msg: impl AsRef<str>) {
        if self.quiet {
            return;
        }
        eprintln!("[harwex-ide +{:>7.1} ms] {}", self.start.elapsed().as_secs_f64() * 1000.0, msg.as_ref());
    }
}

pub struct AppState {
    pub ctx: egui::Context,
    /// Tagged with the workspace in context (`Jobs::for_ws`).
    pub jobs: Jobs,
    inbox: Receiver<Posted>,
    /// Window-level: toasts and the log of every workspace.
    pub notifications: Notifications,
    /// The workspace in context: the active one while a frame draws, the job's own one while
    /// its callback runs (`with_ws`). See `workspace.rs`.
    pub ws: Workspace,
    /// Every other open workspace, in no particular order (`workspaces()` sorts by id).
    others: Vec<Workspace>,
    active: WorkspaceId,
    next_ws: u64,
    /// Nesting of `with_ws`. At 0, `ws` is the active workspace.
    depth: u32,
    next_generation: u64,
    pub timings: Timings,
    pub test: Option<TestScript>,
    pub editor_theme: EditorTheme,
    /// Start a file watcher for each opened project.
    pub watch_files: bool,
    /// Snapshot tests: no durations or clocks in the UI (see `AppOptions::deterministic`).
    pub deterministic: bool,
    /// The status bar's memory indicator and its sampling thread.
    pub memory: crate::memory::MemoryMonitor,
    /// Trash, Finder and the clipboard. Tests record the calls instead.
    pub platform: std::sync::Arc<dyn crate::fileops::Platform>,
    /// `HARWEX_IDE_INPUT_LOG`: the input recorder (`inputlog.rs`).
    pub input_log: Option<crate::inputlog::InputLog>,
    /// The primary click chain of the frame. Widgets ask it for double clicks (`clicks.rs`).
    pub clicks: crate::clicks::Clicks,
    /// The shell of new terminal tabs, for every workspace (`AppOptions::terminal`).
    pub terminal_command: Option<crate::app::TerminalCommand>,
    /// The layout a project without a saved one starts with.
    pub default_layout: Layout,
    /// Layout and open files per canonical root, from app storage and closed workspaces.
    pub saved: HashMap<PathBuf, crate::persist::SavedWorkspace>,
    /// A workspace with unsaved files waiting for "Save / Don't Save / Cancel" before it closes.
    pub confirm_close_ws: Option<WorkspaceId>,
    /// The title bar's project selector and the Recent Projects list (`projects_popup.rs`).
    pub projects: crate::projects_popup::ProjectsUi,
    /// Terminal tabs per project (`terminal_store.rs`). `None`: tabs are not persisted.
    pub terminal_store: Option<crate::terminal_store::TerminalStore>,
    /// Find in Files history (queries, masks, directories) per canonical root; app storage.
    pub find_history: HashMap<PathBuf, crate::find::FindHistory>,
}

impl AppState {
    pub fn new(ctx: egui::Context, start: Instant) -> AppState {
        let (jobs, inbox) = Jobs::new(ctx.clone());
        let first = WorkspaceId(1);
        let ws = Workspace::new(first, &jobs, &ctx, None, Layout::default());
        let mut state = AppState {
            ctx,
            jobs,
            inbox,
            notifications: Notifications::default(),
            ws,
            others: Vec::new(),
            active: first,
            next_ws: 2,
            depth: 0,
            next_generation: 0,
            timings: Timings { start, quiet: false },
            test: None,
            editor_theme: theme::T.editor.clone(),
            watch_files: true,
            deterministic: false,
            memory: Default::default(),
            platform: std::sync::Arc::new(crate::fileops::SystemPlatform),
            input_log: None,
            clicks: Default::default(),
            terminal_command: None,
            default_layout: Layout::default(),
            saved: HashMap::new(),
            confirm_close_ws: None,
            projects: Default::default(),
            terminal_store: None,
            find_history: HashMap::new(),
        };
        state.ws.visible.store(true, std::sync::atomic::Ordering::Relaxed);
        state.enter_context();
        state
    }

    /// True when no background work is pending in any workspace: no job thread, no callback
    /// waiting for the UI thread, no language server request in the queue, no git refresh.
    /// Tests step frames until this holds. Long-lived threads (file watcher, terminals) do not
    /// count.
    pub fn is_idle(&self) -> bool {
        self.jobs.in_flight() == 0 && self.all_ws().all(Workspace::is_idle)
    }

    /// Work in the active workspace that waits for a quiet period (`Workspace::has_pending_debounce`).
    pub fn has_pending_debounce(&self) -> bool {
        self.ws.has_pending_debounce()
    }

    /// Runs the callbacks that workers sent since the last frame, each with its own workspace in
    /// context. Callbacks of a closed workspace are dropped.
    pub fn drain_inbox(&mut self) {
        // Collect first: a callback may spawn jobs whose replies must wait for the next frame,
        // or this loop could run forever.
        let pending: Vec<Posted> = self.inbox.try_iter().collect();
        let n = pending.len();
        for (ws, f) in pending {
            match ws {
                None => f(self),
                Some(id) => {
                    self.with_ws(id, f);
                }
            }
        }
        self.jobs.delivered(n);
    }

    /// Changes whenever a different folder opens. Callbacks compare it to drop stale results.
    pub fn project_generation(&self) -> u64 {
        self.ws.project.as_ref().map_or(0, |p| p.generation)
    }

    // -----------------------------------------------------------------------------------------
    // Workspaces

    /// Every open workspace: the one in context first, then the others.
    pub fn all_ws(&self) -> impl Iterator<Item = &Workspace> {
        std::iter::once(&self.ws).chain(self.others.iter())
    }

    /// Every open workspace, mutable: the one in context first, then the others.
    pub fn all_ws_mut(&mut self) -> impl Iterator<Item = &mut Workspace> {
        std::iter::once(&mut self.ws).chain(self.others.iter_mut())
    }

    /// The active (drawn) workspace's id.
    pub fn active_id(&self) -> WorkspaceId {
        self.active
    }

    /// The open workspaces in open order, for the project selector.
    pub fn workspaces(&self) -> Vec<WorkspaceInfo> {
        let mut out: Vec<WorkspaceInfo> = self.all_ws().map(|w| w.info(self.active)).collect();
        out.sort_by_key(|w| w.id);
        out
    }

    pub fn workspace(&self, id: WorkspaceId) -> Option<&Workspace> {
        self.all_ws().find(|w| w.id == id)
    }

    pub fn workspace_mut(&mut self, id: WorkspaceId) -> Option<&mut Workspace> {
        if self.ws.id == id {
            return Some(&mut self.ws);
        }
        self.others.iter_mut().find(|w| w.id == id)
    }

    /// Runs `f` with workspace `id` in context (`state.ws` is that workspace inside `f`).
    /// `None` when the workspace was closed. Do not keep references across the call.
    pub fn with_ws<R>(&mut self, id: WorkspaceId, f: impl FnOnce(&mut AppState) -> R) -> Option<R> {
        let prev = self.ws.id;
        if prev == id {
            return Some(f(self));
        }
        self.swap_in(id)?;
        self.depth += 1;
        let r = f(self);
        self.depth -= 1;
        if self.depth == 0 {
            self.swap_in(self.active);
        } else if self.swap_in(prev).is_none() {
            // `f` closed the outer workspace; the active one takes the context.
            self.swap_in(self.active);
        }
        Some(r)
    }

    /// Puts workspace `id` into `self.ws`. `None` when no such workspace is open.
    fn swap_in(&mut self, id: WorkspaceId) -> Option<()> {
        if self.ws.id != id {
            let i = self.others.iter().position(|w| w.id == id)?;
            std::mem::swap(&mut self.ws, &mut self.others[i]);
        }
        self.enter_context();
        Some(())
    }

    /// The jobs tag and the egui id salt follow the workspace in context.
    fn enter_context(&mut self) {
        self.jobs.set_workspace(Some(self.ws.id));
        crate::workspace::set_salt(self.ws.ui_salt());
    }

    fn add_workspace(&mut self) -> WorkspaceId {
        let id = WorkspaceId(self.next_ws);
        self.next_ws += 1;
        let ws = Workspace::new(id, &self.jobs, &self.ctx, self.terminal_command.clone(), self.default_layout);
        self.others.push(ws);
        id
    }

    /// Opens `root` as a workspace and makes it active. A workspace that already shows (or is
    /// loading) the same root is activated instead. An empty window (a blank workspace) takes the
    /// project itself. Canonicalizing runs on a worker: when `root` turns out to be another
    /// spelling of an open root, the new workspace closes again and the open one is activated.
    pub fn open_workspace(&mut self, root: PathBuf) -> WorkspaceId {
        let open = self.all_ws().find(|w| w.project.as_ref().is_some_and(|p| p.root == root) || w.pending_root.as_ref() == Some(&root)).map(|w| w.id);
        if let Some(id) = open {
            self.activate(id);
            return id;
        }
        let id = if self.workspace(self.active).is_some_and(Workspace::is_blank) { self.active } else { self.add_workspace() };
        self.activate(id);
        if let (Some(saved), Some(ws)) = (self.saved.get(&root).cloned(), self.workspace_mut(id)) {
            ws.layout = saved.layout;
        }
        self.with_ws(id, |state| state.load_project(root));
        id
    }

    /// Makes `id` the drawn workspace. False when it is not open.
    pub fn activate(&mut self, id: WorkspaceId) -> bool {
        if self.workspace(id).is_none() {
            return false;
        }
        if id == self.active {
            return true;
        }
        // Favourite branches are app storage for every repository; they live in the active
        // workspace's Git UI and move along.
        let favorites = self
            .workspace_mut(self.active)
            .map(|w| {
                w.visible.store(false, std::sync::atomic::Ordering::Relaxed);
                std::mem::take(&mut w.git_ui.window.favorites)
            })
            .unwrap_or_default();
        self.active = id;
        if let Some(ws) = self.workspace_mut(id) {
            ws.visible.store(true, std::sync::atomic::Ordering::Relaxed);
            ws.git_ui.window.favorites = favorites;
            if let Some(e) = ws.tabs.active_editor_mut() {
                e.view.request_focus();
            }
        }
        if self.depth == 0 {
            self.swap_in(id);
        }
        self.update_title();
        self.ctx.request_repaint();
        true
    }

    fn update_title(&self) {
        let title = match self.workspace(self.active).and_then(|w| w.project.as_ref()) {
            Some(p) => format!("{} - harwex-ide", p.name),
            None => "harwex-ide".into(),
        };
        self.ctx.send_viewport_cmd(egui::ViewportCommand::Title(title));
    }

    /// Closes workspace `id`. With unsaved files it is activated and asks first
    /// (`confirm_close_ws`), like closing a dirty tab.
    pub fn close_workspace(&mut self, id: WorkspaceId) {
        let Some(ws) = self.workspace(id) else { return };
        if ws.tabs.list.iter().any(|t| t.is_dirty()) {
            self.activate(id);
            self.confirm_close_ws = Some(id);
            return;
        }
        self.close_workspace_now(id);
    }

    /// Closes workspace `id` without asking: unsaved edits are lost. Its terminals and language
    /// servers stop. Closing the last workspace leaves a blank one (the welcome screen).
    pub fn close_workspace_now(&mut self, id: WorkspaceId) {
        if self.workspace(id).is_none() {
            return;
        }
        if self.confirm_close_ws == Some(id) {
            self.confirm_close_ws = None;
        }
        if self.ws.id == id && self.others.is_empty() {
            self.add_workspace();
        }
        if self.active == id {
            // The previous workspace in open order, else the next one.
            let mut ids: Vec<WorkspaceId> = self.all_ws().map(|w| w.id).filter(|&w| w != id).collect();
            ids.sort();
            let next = ids.iter().rev().find(|&&w| w < id).or_else(|| ids.first()).copied().expect("another workspace");
            self.activate(next);
        }
        let mut closed = if self.ws.id == id {
            // Only inside a callback of the closing workspace: the active one takes the context.
            let i = self.others.iter().position(|w| w.id == self.active).unwrap_or(0);
            let closed = std::mem::replace(&mut self.ws, self.others.remove(i));
            self.enter_context();
            closed
        } else {
            let i = self.others.iter().position(|w| w.id == id).expect("open workspace");
            self.others.remove(i)
        };
        self.remember(&closed);
        crate::terminal::save_closed(self, &closed);
        closed.shutdown();
    }

    /// Stops every workspace's shells and servers and waits for the servers to exit. Called on
    /// app exit.
    pub fn shutdown_all(&mut self) {
        for w in std::iter::once(&mut self.ws).chain(self.others.iter_mut()) {
            w.terminals.kill_all();
            w.langs.shutdown();
        }
    }

    /// Keeps the layout and open files of `ws` for the next time its root opens.
    pub(crate) fn remember(&mut self, ws: &Workspace) {
        if let Some(p) = &ws.project {
            self.saved.insert(p.root.clone(), crate::persist::SavedWorkspace::of(ws));
        }
    }

    /// Per-frame work of every workspace, the active one first: commands from custom tabs,
    /// debounced language server sync, diagnostics, gutter marks, a pending close.
    pub fn tick_workspaces(&mut self) {
        let mut ids: Vec<WorkspaceId> = self.all_ws().map(|w| w.id).collect();
        ids.sort_by_key(|&id| id != self.active);
        for id in ids {
            self.with_ws(id, |s| {
                s.run_commands();
                crate::nav::sync_lsp_debounced(s);
                crate::diagnostics::schedule(s);
                s.schedule_gutter();
                crate::terminal::tick(s);
                crate::find_window::tick(s);
                crate::git::diff::tick(s);
                if s.ws.close_when_saved && !s.ws.tabs.editors().any(|e| e.saving) {
                    s.ws.close_when_saved = false;
                    // A failed save keeps the file dirty; then the workspace stays open.
                    if !s.ws.tabs.list.iter().any(|t| t.is_dirty()) {
                        s.close_workspace_now(s.ws.id);
                    }
                }
            });
        }
    }

    // -----------------------------------------------------------------------------------------
    // Project

    /// Loads the folder `path` into the workspace in context (it must be blank).
    fn load_project(&mut self, path: PathBuf) {
        self.ws.pending_root = Some(path.clone());
        self.jobs.spawn(
            "Opening project",
            move || {
                let root = std::fs::canonicalize(&path).map_err(|e| format!("{}: {e}", path.display()))?;
                if !root.is_dir() {
                    return Err(format!("{} is not a folder", root.display()));
                }
                let repo = Repo::discover(&root).ok();
                let config = IdeConfig::load(&root);
                Ok((root, repo, config))
            },
            move |state, res: Result<(PathBuf, Option<Repo>, IdeConfig), String>| {
                state.ws.pending_root = None;
                match res {
                    Ok((root, repo, config)) => {
                        let id = state.ws.id;
                        let twin = state.all_ws().find(|w| w.id != id && w.project.as_ref().is_some_and(|p| p.root == root)).map(|w| w.id);
                        match twin {
                            Some(open) => {
                                // Another spelling of a root that is open already.
                                let was_active = state.active == id;
                                if state.ws.is_blank() {
                                    state.close_workspace_now(id);
                                }
                                if was_active {
                                    state.activate(open);
                                }
                            }
                            None => state.install_project(root, repo, config),
                        }
                    }
                    Err(e) => state.notifications.error("Cannot open folder", e),
                }
            },
        );
    }

    fn install_project(&mut self, root: PathBuf, repo: Option<Repo>, config: IdeConfig) {
        self.next_generation += 1;
        let generation = self.next_generation;
        let name = root.file_name().map_or_else(|| root.display().to_string(), |n| n.to_string_lossy().into_owned());
        self.ws.project = Some(Project { root: root.clone(), name, generation });
        // The egui id salt follows the root.
        self.enter_context();
        if self.ws.id == self.active {
            self.update_title();
        }
        self.ws.tree.clear();
        self.ws.breadcrumbs = Default::default();
        self.ws.index = FileIndex::default();
        self.ws.search.reset();
        self.ws.find.reset();
        self.ws.find_window.reset();
        self.ws.nav.reset();
        self.ws.diagnostics.reset();
        self.ws.opening.clear();
        self.ws.watcher = None;
        // The Console sink goes on before anything clones the handle into a worker.
        let repo = repo.map(|r| crate::git::console::attach(r, &self.jobs, generation));
        self.ws.git = GitInfo { repo, ..Default::default() };
        // Stop Language Servers survives a restart; set before any file of the project opens.
        self.ws.langs.set_off(self.saved.get(&root).is_some_and(|s| s.langs_off));
        self.apply_ide_config(config);
        // Dialogs and filters of another repository must not act on this one. Favourite
        // branches are app storage for every repository, not state of this one.
        let favorites = std::mem::take(&mut self.ws.git_ui.window.favorites);
        self.ws.git_ui = GitUi::default();
        self.ws.git_ui.window.favorites = favorites;
        self.ws.tree_ops = Default::default();
        crate::tree::load_dir(self, root.clone());
        crate::search::rebuild_index(self);
        self.refresh_git();
        crate::terminal::restore(self, root.clone());
        self.restore_saved(&root);
        if !self.watch_files {
            return;
        }
        let jobs = self.jobs.clone();
        self.jobs.spawn_quiet(
            move || crate::watcher::start(&root, jobs, generation),
            move |state, res| {
                if state.project_generation() != generation {
                    return;
                }
                match res {
                    Ok(w) => state.ws.watcher = Some(w),
                    Err(e) => state.notifications.warn("File watching is off", e.to_string()),
                }
            },
        );
    }

    /// Applies the saved layout and reopens the saved files of `root`, once per workspace.
    fn restore_saved(&mut self, root: &Path) {
        if std::mem::replace(&mut self.ws.restored, true) {
            return;
        }
        let Some(saved) = self.saved.get(root).cloned() else { return };
        self.ws.layout = saved.layout;
        if saved.files.is_empty() {
            return;
        }
        let generation = self.project_generation();
        let files = crate::tabs::restore_set(saved.files, saved.active_file.as_deref());
        let active = saved.active_file;
        self.jobs.spawn(
            "Reopening files",
            move || files.into_iter().filter_map(|p| Document::open(&p).ok().map(|d| (p, d))).collect::<Vec<_>>(),
            move |state, docs| {
                if state.project_generation() != generation {
                    return;
                }
                for (path, doc) in docs {
                    if state.ws.tabs.editor_by_path(&path).is_none() {
                        state.add_editor_tab(path, doc, None);
                    }
                }
                if let Some(id) = active.and_then(|a| state.ws.tabs.editor_by_path(&a)) {
                    state.activate_editor(id, None);
                }
            },
        );
    }

    /// Applies `.harwex/ide.toml` (defaults when there is none). Open tabs of a language that
    /// is turned off now stop talking to its server.
    pub fn apply_ide_config(&mut self, config: IdeConfig) {
        for w in &config.warnings {
            self.notifications.warn("Project settings", w.clone());
        }
        if let Some(src) = &config.source {
            let langs: Vec<&str> = crate::lang::LangId::ALL.into_iter().filter(|l| config.enabled(*l)).map(|l| l.key()).collect();
            self.timings.log(format!("{}: languages {langs:?}", src.display()));
        }
        let diagnostics_changed = config.diagnostics != self.ws.langs.config.diagnostics || config.languages != self.ws.langs.config.languages;
        for (_, e) in self.ws.tabs.editors_mut() {
            if e.lang.is_some_and(|l| !config.enabled(l)) {
                e.lang = None;
                e.lsp_version = None;
            }
            if diagnostics_changed {
                e.problems.reset();
            }
        }
        if diagnostics_changed {
            self.ws.diagnostics.reset();
        }
        self.memory.set_interval(config.memory_interval);
        if let Some(root) = self.ws.project.as_ref().map(|p| p.root.clone()) {
            let excluded = config.excluded_paths(&root);
            if excluded != self.ws.tree.excluded {
                self.ws.tree.excluded = excluded;
                crate::search::rebuild_index(self);
            }
        }
        self.ws.langs.configure(config);
    }

    /// The active editor's file and caret, for navigation history.
    pub fn current_point(&self) -> Option<NavPoint> {
        self.ws.tabs.active_editor().map(|e| NavPoint { path: e.path.clone(), pos: e.view.cursor() })
    }

    /// Opens a file (on a worker) and reveals `pos`. `record` pushes the current place onto the
    /// back stack, which is what jumps do and what Back/Forward must not do.
    pub fn open_location(&mut self, path: &Path, pos: Option<Position>, record: bool) {
        if record {
            if let Some(cur) = self.current_point() {
                if cur.path != path || Some(cur.pos) != pos {
                    self.ws.nav.push_back(cur);
                }
            }
        }
        if let Some(id) = self.ws.tabs.editor_by_path(path) {
            self.activate_editor(id, pos);
            return;
        }
        if let Some(slot) = self.ws.opening.get_mut(path) {
            *slot = pos;
            return;
        }
        self.ws.opening.insert(path.to_path_buf(), pos);
        let requested = path.to_path_buf();
        let generation = self.project_generation();
        self.jobs.spawn(
            format!("Opening {}", path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default()),
            move || {
                let canonical = std::fs::canonicalize(&requested).unwrap_or_else(|_| requested.clone());
                let doc = Document::open(&canonical);
                (requested, canonical, doc)
            },
            move |state, (requested, canonical, doc)| {
                if state.project_generation() != generation {
                    return;
                }
                let pos = state.ws.opening.remove(&requested).flatten();
                match doc {
                    Ok(doc) => {
                        if let Some(id) = state.ws.tabs.editor_by_path(&canonical) {
                            state.activate_editor(id, pos);
                        } else {
                            state.add_editor_tab(canonical, doc, pos);
                        }
                    }
                    Err(e) => state.notifications.error(format!("Cannot open {}", requested.display()), e.to_string()),
                }
            },
        );
    }

    fn activate_editor(&mut self, id: TabId, pos: Option<Position>) {
        self.ws.tabs.activate(id);
        if let Some(e) = self.ws.tabs.editor_mut(id) {
            if let Some(p) = pos {
                e.view.reveal(p);
            }
            e.view.request_focus();
            let path = e.path.clone();
            self.ws.search.touch(&path);
            self.ws.tree.selected = Some(path);
        }
    }

    fn add_editor_tab(&mut self, path: PathBuf, doc: Document, pos: Option<Position>) {
        // A diff that edits this file without a tab hands over its unsaved document: one buffer.
        let doc = crate::git::diff::adopt_hidden(self, &path).unwrap_or(doc);
        let mut tab = EditorTab::new(path.clone(), doc);
        if let Ok(lang) = self.ws.langs.lang_for(&path) {
            // The first open file of a language starts its server (rule 5).
            self.ws.langs.bridge(lang).open(&path, tab.doc.text());
            tab.lang = Some(lang);
            tab.lsp_version = Some(tab.doc.version());
        }
        if let Some(p) = pos {
            tab.view.reveal(p);
        }
        tab.view.request_focus();
        self.ws.tabs.add(TabContent::Editor(Box::new(tab)));
        self.ws.search.touch(&path);
        self.ws.tree.selected = Some(path);
        crate::tabs::enforce_limit(self);
    }

    /// Closes a tab. A dirty tab asks first unless `force`.
    pub fn close_tab(&mut self, id: TabId, force: bool) {
        let Some(tab) = self.ws.tabs.get(id) else { return };
        if tab.is_dirty() && !force {
            self.ws.tabs.activate(id);
            self.ws.confirm_close = Some(id);
            return;
        }
        let Some(tab) = self.ws.tabs.remove(id) else { return };
        match tab.content {
            TabContent::Editor(e) => {
                if let Some(lang) = e.lang {
                    self.ws.langs.bridge(lang).close(&e.path);
                }
                if e.problems.plan.as_ref().is_some_and(|p| p.oxlint.is_some() || p.eslint.is_some()) {
                    self.ws.langs.lint.close(&e.path);
                }
            }
            TabContent::Custom(mut c) => {
                let mut commands = Vec::new();
                let mut env = TabEnv {
                    jobs: &self.jobs,
                    notifications: &mut self.notifications,
                    project: self.ws.project.as_ref(),
                    git: &self.ws.git,
                    commands: &mut commands,
                    tab_id: id,
                    editor_theme: &self.editor_theme,
                    editor: None,
                };
                c.on_close(&mut env);
                self.ws.commands.extend(commands);
            }
        }
        if let Some(e) = self.ws.tabs.active_editor_mut() {
            e.view.request_focus();
        }
    }

    /// A tab that Close Unmodified keeps: unsaved edits, or a file with git changes (IDEA).
    pub fn tab_modified(&self, tab: &crate::tabs::Tab) -> bool {
        tab.is_dirty() || tab.editor().is_some_and(|e| self.ws.git.status.contains_key(&e.path))
    }

    /// A close action of the tab menu on tab `id`. Each tab closes through `close_tab`, in
    /// strip order, so a dirty tab asks like Cmd+W and the closed tabs go to Cmd+Shift+T.
    pub fn close_tabs(&mut self, id: TabId, scope: crate::tabs::CloseScope) {
        let ids = self.ws.tabs.close_targets(id, scope, |t| self.tab_modified(t));
        let then_activate = (scope == crate::tabs::CloseScope::Others).then_some(id);
        self.ws.close_batch = Some(crate::tabs::CloseBatch { queue: ids.into(), then_activate });
        self.advance_close_batch();
    }

    /// Closes the batch's next tabs until one asks "Save changes?" or the batch is done.
    pub fn advance_close_batch(&mut self) {
        while self.ws.confirm_close.is_none() {
            let Some(batch) = self.ws.close_batch.as_mut() else { return };
            if let Some(id) = batch.queue.pop_front() {
                self.close_tab(id, false);
                continue;
            }
            let keep = batch.then_activate;
            self.ws.close_batch = None;
            if let Some(id) = keep {
                self.ws.tabs.activate(id);
                if let Some(e) = self.ws.tabs.editor_mut(id) {
                    e.view.request_focus();
                }
            }
        }
    }

    /// Writes the tab's text on a worker. `then_close` closes the tab once the write succeeded.
    pub fn save_tab(&mut self, id: TabId, then_close: bool) {
        let Some(e) = self.ws.tabs.editor_mut(id) else { return };
        if e.read_only {
            // The view ignores edits, so there is nothing to write.
            return;
        }
        if !e.doc.is_dirty() || e.saving {
            if then_close && !e.doc.is_dirty() {
                self.close_tab(id, true);
            }
            return;
        }
        e.saving = true;
        let (text, token) = e.doc.save_snapshot();
        let path = e.path.clone();
        self.jobs.spawn_quiet(
            move || std::fs::write(&path, text).map_err(|err| format!("{}: {err}", path.display())),
            move |state, res| {
                let Some(e) = state.ws.tabs.editor_mut(id) else { return };
                e.saving = false;
                match res {
                    Ok(()) => {
                        e.doc.mark_saved(token);
                        // IDEA checks again on save; servers that read the disk see it now.
                        e.problems.force = true;
                        if then_close {
                            state.close_tab(id, false);
                        }
                    }
                    Err(err) => state.notifications.error("Save failed", err),
                }
            },
        );
    }

    pub fn save_all(&mut self) {
        let ids: Vec<TabId> = self.ws.tabs.editors_mut().filter(|(_, e)| e.doc.is_dirty() && !e.read_only).map(|(id, _)| id).collect();
        for id in ids {
            self.save_tab(id, false);
        }
        crate::git::diff::save_hidden_all(self);
    }

    /// Re-reads the whole git status and the branch on a worker, and recomputes every gutter.
    /// A git write that knows its paths uses `git::refresh::write_done` instead.
    pub fn refresh_git(&mut self) {
        crate::git::refresh::full(self);
    }

    pub(crate) fn apply_status(&mut self, changes: Vec<FileChange>) {
        let Some(workdir) = self.ws.git.repo.as_ref().map(|r| r.workdir().to_path_buf()) else { return };
        let mut status = HashMap::with_capacity(changes.len());
        let mut dirs = HashSet::new();
        for c in &changes {
            let abs = workdir.join(&c.path);
            let mut p = abs.parent();
            while let Some(d) = p {
                if !d.starts_with(&workdir) || !dirs.insert(d.to_path_buf()) {
                    break;
                }
                p = d.parent();
            }
            status.insert(abs, c.kind());
        }
        self.ws.git.status = status;
        self.ws.git.dirty_dirs = dirs;
        self.ws.git.changes = changes;
    }

    /// Starts gutter recomputation for tabs whose text rested for 300 ms since the last edit.
    pub fn schedule_gutter(&mut self) {
        let Some(repo) = self.ws.git.repo.clone() else { return };
        let workdir = repo.workdir().to_path_buf();
        let mut wake: Option<Duration> = None;
        let mut due = Vec::new();
        for (id, e) in self.ws.tabs.editors_mut() {
            if e.marks_in_flight || e.marks_for == Some(e.doc.version()) || !e.path.starts_with(&workdir) {
                continue;
            }
            let rest = e.last_edit.elapsed();
            let debounce = Duration::from_millis(300);
            // A fresh tab (never computed) does not wait.
            if e.marks_for.is_some() && rest < debounce {
                let left = debounce - rest;
                wake = Some(wake.map_or(left, |w| w.min(left)));
                continue;
            }
            due.push(id);
        }
        for id in due {
            let Some(e) = self.ws.tabs.editor_mut(id) else { continue };
            e.marks_in_flight = true;
            let version = e.doc.version();
            e.marks_for = Some(version);
            let text = e.doc.text();
            let path = e.path.clone();
            let repo = repo.clone();
            self.jobs.spawn_quiet(
                move || repo.line_changes(&path, &text),
                move |state, res| {
                    let Some(e) = state.ws.tabs.editor_mut(id) else { return };
                    e.marks_in_flight = false;
                    if let Ok(changes) = res {
                        e.marks = to_marks(&changes);
                    }
                },
            );
        }
        if let Some(w) = wake {
            self.ctx.request_repaint_after(w);
        }
    }

    pub fn on_fs_batch(&mut self, batch: FsBatch) {
        if std::env::var_os("HARWEX_DEBUG_FS").is_some() {
            let sample: Vec<_> = batch.paths.iter().take(3).collect();
            self.timings.log(format!("fs batch: {} paths, git {}, structure {} {sample:?}", batch.paths.len(), batch.git_changed, batch.structure_changed));
        }
        // Directory listings.
        let mut reload: HashSet<PathBuf> = HashSet::new();
        for p in &batch.paths {
            if self.ws.tree.is_loaded(p) {
                reload.insert(p.clone());
            }
            if let Some(parent) = p.parent() {
                if self.ws.tree.is_loaded(parent) {
                    reload.insert(parent.to_path_buf());
                }
            }
        }
        for dir in reload {
            let generation = self.project_generation();
            let d = dir.clone();
            self.jobs.spawn_quiet(
                move || if d.is_dir() { Some(crate::tree::list_dir(&d)) } else { None },
                move |state, entries| {
                    if state.project_generation() == generation {
                        if let Some(entries) = entries {
                            state.ws.tree.set_dir(dir, entries);
                        }
                    }
                },
            );
        }
        // Open, unmodified editors follow the disk, like IDEA.
        let changed: Vec<(TabId, PathBuf)> = self
            .ws.tabs
            .editors_mut()
            .filter(|(_, e)| batch.paths.contains(&e.path) && !e.doc.is_dirty() && !e.saving)
            .map(|(id, e)| (id, e.path.clone()))
            .collect();
        for (id, path) in changed {
            self.jobs.spawn_quiet(
                move || std::fs::read(&path).ok(),
                move |state, bytes| {
                    let Some(bytes) = bytes else { return };
                    let tracked;
                    {
                        let Some(e) = state.ws.tabs.editor_mut(id) else { return };
                        if e.doc.is_dirty() || !e.doc.reload_from_bytes(&bytes) {
                            return;
                        }
                        e.invalidate_marks();
                        tracked = e.lsp_version.is_some();
                    }
                    if tracked {
                        nav::flush_lsp(state, id);
                    }
                },
            );
        }
        if let Some(root) = self.ws.project.as_ref().map(|p| p.root.clone()) {
            if batch.paths.contains(&root.join(crate::lang::config::CONFIG_PATH)) {
                let generation = self.project_generation();
                self.jobs.spawn_quiet(
                    move || IdeConfig::load(&root),
                    move |state, config| {
                        if state.project_generation() == generation {
                            state.apply_ide_config(config);
                        }
                    },
                );
            }
        }
        if batch.structure_changed {
            crate::search::rebuild_index(self);
        }
        // A `.git` change is compared with the last stamp; file changes refresh only their paths.
        if batch.git_changed {
            crate::git::refresh::git_dir_changed(self);
        }
        crate::git::refresh::paths(self, batch.paths.into_iter().collect(), false);
    }

    pub fn run_commands(&mut self) {
        for cmd in std::mem::take(&mut self.ws.commands) {
            match cmd {
                AppCommand::OpenLocation { path, pos } => self.open_location(&path, pos, true),
                AppCommand::CloseTab(id) => self.close_tab(id, false),
                AppCommand::OpenCustomTab(tab) => {
                    self.ws.tabs.open_custom(tab);
                }
                AppCommand::RefreshGit => self.refresh_git(),
            }
        }
    }

    /// Shows the native folder picker without blocking the UI thread.
    /// The picker goes through `state.platform`, so tests answer it without a dialog.
    pub fn pick_folder(&mut self) {
        let start = self.ws.project.as_ref().map(|p| p.root.parent().unwrap_or(&p.root).to_path_buf());
        let fut = self.platform.pick_folder(start.as_deref());
        self.jobs.window().spawn_quiet(
            move || crate::util::block_on(fut),
            |state, picked| {
                if let Some(p) = picked {
                    state.open_workspace(p);
                }
            },
        );
    }
}

pub fn to_marks(changes: &[ide_git::LineChange]) -> Vec<(usize, GutterMark)> {
    let mut out = Vec::new();
    for c in changes {
        match c.kind {
            LineChangeKind::Added => out.extend(c.lines.clone().map(|l| (l, GutterMark::Added))),
            LineChangeKind::Modified => out.extend(c.lines.clone().map(|l| (l, GutterMark::Modified))),
            LineChangeKind::Deleted => out.push((c.lines.start, GutterMark::Deleted)),
        }
    }
    out
}
