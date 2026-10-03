//! `AppState`: everything the UI shows, owned by the UI thread. Workers never touch it directly;
//! they send closures through `Jobs` that run here at the start of a frame.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};

use ide_editor::{Document, EditorTheme, GutterMark, Position};
use ide_git::{ChangeKind, FileChange, LineChangeKind, Repo};

use crate::find::FindInFiles;
use crate::git::GitUi;
use crate::jobs::{Jobs, UiCallback};
use crate::layout::Layout;
use crate::lang::{IdeConfig, Languages};
use crate::nav::{self, NavPoint, Navigation, UsagesView};
use crate::notifications::Notifications;
use crate::search::{FileIndex, SearchEverywhere};
use crate::tabs::{CustomTab, EditorTab, TabContent, TabId, Tabs};
use crate::testhook::TestScript;
use crate::theme;
use crate::tree::ProjectTree;
use crate::watcher::{FsBatch, Watcher};

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
    pub refreshing: bool,
    refresh_queued: bool,
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
    pub jobs: Jobs,
    inbox: Receiver<UiCallback>,
    pub notifications: Notifications,
    pub project: Option<Project>,
    next_generation: u64,
    pub tabs: Tabs,
    pub tree: ProjectTree,
    pub breadcrumbs: crate::breadcrumbs::Breadcrumbs,
    pub git: GitInfo,
    #[allow(dead_code)] // Extension surface for the Git UI phase.
    pub git_ui: GitUi,
    /// Language servers by language, with the project's `.harwex/ide.toml`.
    pub langs: Languages,
    pub nav: Navigation,
    /// Detection cache and request generation of the diagnostics layer.
    pub diagnostics: crate::diagnostics::DiagnosticsState,
    pub usages: UsagesView,
    pub find: FindInFiles,
    pub search: SearchEverywhere,
    pub index: FileIndex,
    pub layout: Layout,
    pub terminals: crate::terminal::Terminals,
    pub watcher: Option<Watcher>,
    pub timings: Timings,
    pub test: Option<TestScript>,
    pub editor_theme: EditorTheme,
    pub commands: Vec<AppCommand>,
    /// A dirty tab waiting for "Save / Don't Save / Cancel".
    pub confirm_close: Option<TabId>,
    /// Paths being loaded on a worker, with the position to reveal once the tab exists.
    opening: HashMap<PathBuf, Option<Position>>,
    /// Start a file watcher for each opened project.
    pub watch_files: bool,
    /// Snapshot tests: no durations or clocks in the UI (see `AppOptions::deterministic`).
    pub deterministic: bool,
    /// The status bar's memory indicator and its sampling thread.
    pub memory: crate::memory::MemoryMonitor,
    /// Trash, Finder and the clipboard. Tests record the calls instead.
    pub platform: std::sync::Arc<dyn crate::fileops::Platform>,
    /// The Project tree's Cut/Copy mark and file operation dialogs.
    pub tree_ops: crate::tree_menu::TreeOps,
}

impl AppState {
    pub fn new(ctx: egui::Context, start: Instant) -> AppState {
        let (jobs, inbox) = Jobs::new(ctx.clone());
        let repaint_ctx = ctx.clone();
        let langs = Languages::new(jobs.clone(), std::sync::Arc::new(move || repaint_ctx.request_repaint()));
        AppState {
            ctx,
            jobs,
            inbox,
            notifications: Notifications::default(),
            project: None,
            next_generation: 0,
            tabs: Tabs::default(),
            tree: ProjectTree::default(),
            breadcrumbs: Default::default(),
            git: GitInfo::default(),
            git_ui: GitUi::default(),
            langs,
            nav: Navigation::default(),
            diagnostics: Default::default(),
            usages: UsagesView::default(),
            find: FindInFiles::default(),
            search: SearchEverywhere::default(),
            index: FileIndex::default(),
            layout: Layout::default(),
            terminals: Default::default(),
            watcher: None,
            timings: Timings { start, quiet: false },
            test: None,
            editor_theme: theme::T.editor.clone(),
            commands: Vec::new(),
            confirm_close: None,
            opening: HashMap::new(),
            watch_files: true,
            deterministic: false,
            memory: Default::default(),
            platform: std::sync::Arc::new(crate::fileops::SystemPlatform),
            tree_ops: Default::default(),
        }
    }

    /// True when no background work is pending: no job thread, no callback waiting for the
    /// UI thread, no language server request in the queue, no git refresh. Tests step frames until
    /// this holds. Long-lived threads (file watcher, terminals) do not count.
    pub fn is_idle(&self) -> bool {
        self.jobs.in_flight() == 0 && self.langs.queued() == 0 && !self.git.refreshing && !self.index.building && !self.has_pending_debounce()
    }

    /// Work that waits for a quiet period before it starts: language server sync and gutter marks
    /// after an edit, the log filter, re-blame, the hover request.
    pub fn has_pending_debounce(&self) -> bool {
        let workdir = self.git.repo.as_ref().map(|r| r.workdir().to_path_buf());
        let editors = self.tabs.editors().any(|e| {
            let version = e.doc.version();
            let ts = e.lsp_version.is_some_and(|v| v != version);
            let marks = workdir.as_ref().is_some_and(|w| e.path.starts_with(w)) && (e.marks_in_flight || e.marks_for != Some(version));
            ts || marks || e.problems.pending(version)
        });
        editors || self.git_ui.has_pending_debounce(&self.tabs) || self.nav.hover.is_waiting()
    }

    /// Runs the callbacks that workers sent since the last frame.
    pub fn drain_inbox(&mut self) {
        // Collect first: a callback may spawn jobs whose replies must wait for the next frame,
        // or this loop could run forever.
        let pending: Vec<UiCallback> = self.inbox.try_iter().collect();
        let n = pending.len();
        for f in pending {
            f(self);
        }
        self.jobs.delivered(n);
    }

    /// Changes whenever a different folder opens. Callbacks compare it to drop stale results.
    pub fn project_generation(&self) -> u64 {
        self.project.as_ref().map_or(0, |p| p.generation)
    }

    pub fn open_project(&mut self, path: PathBuf) {
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
            move |state, res: Result<(PathBuf, Option<Repo>, IdeConfig), String>| match res {
                Ok((root, repo, config)) => state.install_project(root, repo, config),
                Err(e) => state.notifications.error("Cannot open folder", e),
            },
        );
    }

    fn install_project(&mut self, root: PathBuf, repo: Option<Repo>, config: IdeConfig) {
        // Closing the tabs below would drop unsaved edits without a prompt.
        let dirty: Vec<String> = self.tabs.list.iter().filter(|t| t.is_dirty()).map(|t| t.title()).collect();
        if !dirty.is_empty() {
            self.notifications.warn("Folder not opened", format!("Save or close the modified files first: {}.", dirty.join(", ")));
            return;
        }
        let ids: Vec<TabId> = self.tabs.list.iter().map(|t| t.id).collect();
        for id in ids {
            self.close_tab(id, true);
        }
        self.next_generation += 1;
        let generation = self.next_generation;
        let name = root.file_name().map_or_else(|| root.display().to_string(), |n| n.to_string_lossy().into_owned());
        self.ctx.send_viewport_cmd(egui::ViewportCommand::Title(format!("{name} - harwex-ide")));
        self.project = Some(Project { root: root.clone(), name, generation });
        self.tree.clear();
        self.breadcrumbs = Default::default();
        self.index = FileIndex::default();
        self.search.reset();
        self.find.reset();
        self.usages = UsagesView::default();
        self.nav.reset();
        self.diagnostics.reset();
        self.opening.clear();
        self.watcher = None;
        self.git = GitInfo { repo, ..Default::default() };
        self.apply_ide_config(config);
        // Dialogs and filters of the old repository must not act on the new one.
        self.git_ui = GitUi::default();
        self.tree_ops = Default::default();
        crate::tree::load_dir(self, root.clone());
        crate::search::rebuild_index(self);
        self.refresh_git();
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
                    Ok(w) => state.watcher = Some(w),
                    Err(e) => state.notifications.warn("File watching is off", e.to_string()),
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
        let diagnostics_changed = config.diagnostics != self.langs.config.diagnostics || config.languages != self.langs.config.languages;
        for (_, e) in self.tabs.editors_mut() {
            if e.lang.is_some_and(|l| !config.enabled(l)) {
                e.lang = None;
                e.lsp_version = None;
            }
            if diagnostics_changed {
                e.problems.reset();
            }
        }
        if diagnostics_changed {
            self.diagnostics.reset();
        }
        self.memory.set_interval(config.memory_interval);
        if let Some(root) = self.project.as_ref().map(|p| p.root.clone()) {
            let excluded = config.excluded_paths(&root);
            if excluded != self.tree.excluded {
                self.tree.excluded = excluded;
                crate::search::rebuild_index(self);
            }
        }
        self.langs.configure(config);
    }

    /// The active editor's file and caret, for navigation history.
    pub fn current_point(&self) -> Option<NavPoint> {
        self.tabs.active_editor().map(|e| NavPoint { path: e.path.clone(), pos: e.view.cursor() })
    }

    /// Opens a file (on a worker) and reveals `pos`. `record` pushes the current place onto the
    /// back stack, which is what jumps do and what Back/Forward must not do.
    pub fn open_location(&mut self, path: &Path, pos: Option<Position>, record: bool) {
        if record {
            if let Some(cur) = self.current_point() {
                if cur.path != path || Some(cur.pos) != pos {
                    self.nav.push_back(cur);
                }
            }
        }
        if let Some(id) = self.tabs.editor_by_path(path) {
            self.activate_editor(id, pos);
            return;
        }
        if let Some(slot) = self.opening.get_mut(path) {
            *slot = pos;
            return;
        }
        self.opening.insert(path.to_path_buf(), pos);
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
                let pos = state.opening.remove(&requested).flatten();
                match doc {
                    Ok(doc) => {
                        if let Some(id) = state.tabs.editor_by_path(&canonical) {
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
        self.tabs.activate(id);
        if let Some(e) = self.tabs.editor_mut(id) {
            if let Some(p) = pos {
                e.view.reveal(p);
            }
            e.view.request_focus();
            let path = e.path.clone();
            self.search.touch(&path);
            self.tree.selected = Some(path);
        }
    }

    fn add_editor_tab(&mut self, path: PathBuf, doc: Document, pos: Option<Position>) {
        let mut tab = EditorTab::new(path.clone(), doc);
        if let Ok(lang) = self.langs.lang_for(&path) {
            // The first open file of a language starts its server (rule 5).
            self.langs.bridge(lang).open(&path, tab.doc.text());
            tab.lang = Some(lang);
            tab.lsp_version = Some(tab.doc.version());
        }
        if let Some(p) = pos {
            tab.view.reveal(p);
        }
        tab.view.request_focus();
        self.tabs.add(TabContent::Editor(Box::new(tab)));
        self.search.touch(&path);
        self.tree.selected = Some(path);
    }

    /// Closes a tab. A dirty tab asks first unless `force`.
    pub fn close_tab(&mut self, id: TabId, force: bool) {
        let Some(tab) = self.tabs.get(id) else { return };
        if tab.is_dirty() && !force {
            self.tabs.activate(id);
            self.confirm_close = Some(id);
            return;
        }
        let Some(tab) = self.tabs.remove(id) else { return };
        match tab.content {
            TabContent::Editor(e) => {
                if let Some(lang) = e.lang {
                    self.langs.bridge(lang).close(&e.path);
                }
                if e.problems.plan.as_ref().is_some_and(|p| p.oxlint.is_some() || p.eslint.is_some()) {
                    self.langs.lint.close(&e.path);
                }
            }
            TabContent::Custom(mut c) => {
                let mut commands = Vec::new();
                let mut env = TabEnv {
                    jobs: &self.jobs,
                    notifications: &mut self.notifications,
                    project: self.project.as_ref(),
                    git: &self.git,
                    commands: &mut commands,
                    tab_id: id,
                    editor_theme: &self.editor_theme,
                };
                c.on_close(&mut env);
                self.commands.extend(commands);
            }
        }
        if let Some(e) = self.tabs.active_editor_mut() {
            e.view.request_focus();
        }
    }

    /// Writes the tab's text on a worker. `then_close` closes the tab once the write succeeded.
    pub fn save_tab(&mut self, id: TabId, then_close: bool) {
        let Some(e) = self.tabs.editor_mut(id) else { return };
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
                let Some(e) = state.tabs.editor_mut(id) else { return };
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
        let ids: Vec<TabId> = self.tabs.editors_mut().filter(|(_, e)| e.doc.is_dirty() && !e.read_only).map(|(id, _)| id).collect();
        for id in ids {
            self.save_tab(id, false);
        }
    }

    /// Re-reads git status and the branch on a worker, and recomputes every gutter. Call after
    /// any git write (commit, checkout, rollback).
    pub fn refresh_git(&mut self) {
        self.refresh_git_inner(true);
    }

    fn refresh_git_inner(&mut self, invalidate_marks: bool) {
        if invalidate_marks {
            for (_, e) in self.tabs.editors_mut() {
                e.invalidate_marks();
            }
        }
        let Some(repo) = self.git.repo.clone() else { return };
        if self.git.refreshing {
            self.git.refresh_queued = true;
            return;
        }
        self.git.refreshing = true;
        let generation = self.project_generation();
        let started = Instant::now();
        self.jobs.spawn(
            "Refreshing git status",
            move || {
                let status = repo.status();
                let branches = repo.branches();
                (status, branches, started.elapsed())
            },
            move |state, (status, branches, took)| {
                if state.project_generation() != generation {
                    return;
                }
                state.git.refreshing = false;
                let ms = took.as_secs_f64() * 1000.0;
                if state.git.status_ms.is_none() {
                    state.timings.log(format!("git status + branch in {ms:.1} ms"));
                }
                state.git.status_ms = Some(ms);
                match status {
                    Ok(changes) => state.apply_status(changes),
                    Err(e) => state.notifications.log_only(crate::notifications::Level::Warning, "git status failed", e.to_string()),
                }
                if let Ok(b) = branches {
                    state.git.detached = b.detached;
                    state.git.branch = match (b.current, b.head) {
                        (Some(name), _) if !b.detached => Some(name),
                        (_, Some(oid)) => Some(oid.to_string()[..8].to_string()),
                        (name, None) => name,
                    };
                }
                crate::git::on_git_refreshed(state);
                if std::mem::take(&mut state.git.refresh_queued) {
                    state.refresh_git_inner(false);
                }
            },
        );
    }

    fn apply_status(&mut self, changes: Vec<FileChange>) {
        let Some(workdir) = self.git.repo.as_ref().map(|r| r.workdir().to_path_buf()) else { return };
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
        self.git.status = status;
        self.git.dirty_dirs = dirs;
        self.git.changes = changes;
    }

    /// Starts gutter recomputation for tabs whose text rested for 300 ms since the last edit.
    pub fn schedule_gutter(&mut self) {
        let Some(repo) = self.git.repo.clone() else { return };
        let workdir = repo.workdir().to_path_buf();
        let mut wake: Option<Duration> = None;
        let mut due = Vec::new();
        for (id, e) in self.tabs.editors_mut() {
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
            let Some(e) = self.tabs.editor_mut(id) else { continue };
            e.marks_in_flight = true;
            let version = e.doc.version();
            e.marks_for = Some(version);
            let text = e.doc.text();
            let path = e.path.clone();
            let repo = repo.clone();
            self.jobs.spawn_quiet(
                move || repo.line_changes(&path, &text),
                move |state, res| {
                    let Some(e) = state.tabs.editor_mut(id) else { return };
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
            if self.tree.is_loaded(p) {
                reload.insert(p.clone());
            }
            if let Some(parent) = p.parent() {
                if self.tree.is_loaded(parent) {
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
                            state.tree.set_dir(dir, entries);
                        }
                    }
                },
            );
        }
        // Open, unmodified editors follow the disk, like IDEA.
        let changed: Vec<(TabId, PathBuf)> = self
            .tabs
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
                        let Some(e) = state.tabs.editor_mut(id) else { return };
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
        if let Some(root) = self.project.as_ref().map(|p| p.root.clone()) {
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
        self.refresh_git_inner(batch.git_changed);
    }

    pub fn run_commands(&mut self) {
        for cmd in std::mem::take(&mut self.commands) {
            match cmd {
                AppCommand::OpenLocation { path, pos } => self.open_location(&path, pos, true),
                AppCommand::CloseTab(id) => self.close_tab(id, false),
                AppCommand::OpenCustomTab(tab) => {
                    self.tabs.open_custom(tab);
                }
                AppCommand::RefreshGit => self.refresh_git(),
            }
        }
    }

    /// Shows the native folder picker without blocking the UI thread.
    pub fn pick_folder(&mut self) {
        let dialog = rfd::AsyncFileDialog::new().set_title("Open Folder");
        let dialog = match &self.project {
            Some(p) => dialog.set_directory(p.root.parent().unwrap_or(&p.root)),
            None => dialog,
        };
        let fut = dialog.pick_folder();
        self.jobs.spawn_quiet(
            move || crate::util::block_on(fut).map(|h| h.path().to_path_buf()),
            |state, picked| {
                if let Some(p) = picked {
                    state.open_project(p);
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
