//! One open project of the window: its tabs, tree, git, language servers, terminals and tool
//! window layout. `AppState` holds every open `Workspace`; one is active and drawn, the others
//! keep running in the background (jobs, watchers, servers, shells).
//!
//! `state.ws` is the workspace "in context": the active one while a frame draws, and the job's
//! own one while a job callback runs (`AppState::with_ws` swaps it in). So `state.ws.tabs` in a
//! callback is always the tabs of the workspace that started the job.

use std::cell::Cell;
use std::collections::HashMap;
use std::hash::Hash;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use egui::Id;
use ide_editor::Position;

use crate::find::FindInFiles;
use crate::git::GitUi;
use crate::jobs::Jobs;
use crate::lang::Languages;
use crate::layout::Layout;
use crate::nav::Navigation;
use crate::search::{FileIndex, SearchEverywhere};
use crate::state::{AppCommand, GitInfo, Project};
use crate::tabs::{TabId, Tabs};
use crate::tree::ProjectTree;
use crate::watcher::Watcher;

/// Stable for the life of the window; never reused after a close.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct WorkspaceId(pub u64);

/// One row of `AppState::workspaces()`, for the project selector.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkspaceInfo {
    pub id: WorkspaceId,
    /// The folder name, or "Opening..." while the project loads, or "" for an empty window.
    pub name: String,
    /// Canonical; `None` until the project loaded.
    pub root: Option<PathBuf>,
    pub is_active: bool,
}

pub struct Workspace {
    pub id: WorkspaceId,
    pub project: Option<Project>,
    /// The folder an "Opening project" job loads into this workspace, as requested.
    pub pending_root: Option<PathBuf>,
    pub tabs: Tabs,
    pub tree: ProjectTree,
    pub breadcrumbs: crate::breadcrumbs::Breadcrumbs,
    pub git: GitInfo,
    pub git_ui: GitUi,
    /// Language servers by language, with the project's `.harwex/ide.toml`.
    pub langs: Languages,
    pub nav: Navigation,
    /// Detection cache and request generation of the diagnostics layer.
    pub diagnostics: crate::diagnostics::DiagnosticsState,
    /// The bottom Find window: Find Usages and Find in Files result tabs.
    pub find_window: crate::find_window::FindWindow,
    pub find: FindInFiles,
    pub search: SearchEverywhere,
    pub index: FileIndex,
    pub layout: Layout,
    pub terminals: crate::terminal::Terminals,
    pub watcher: Option<Watcher>,
    /// Requests from places that cannot borrow `AppState` mutably (custom tabs).
    pub commands: Vec<AppCommand>,
    /// A dirty tab waiting for "Save / Don't Save / Cancel".
    pub confirm_close: Option<TabId>,
    /// Paths being loaded on a worker, with the position to reveal once the tab exists.
    pub(crate) opening: HashMap<PathBuf, Option<Position>>,
    /// The Project tree's Cut/Copy mark and file operation dialogs.
    pub tree_ops: crate::tree_menu::TreeOps,
    /// "Save" in the close-project prompt: the workspace closes once its last save landed.
    pub(crate) close_when_saved: bool,
    /// The saved layout and open files were applied (`AppState::restore_saved`).
    pub(crate) restored: bool,
    /// True while this workspace is the active one. Server progress of a background workspace
    /// asks for no repaint (`Languages`' repaint hook reads it).
    pub(crate) visible: Arc<AtomicBool>,
}

impl Workspace {
    /// `jobs` is the window's handle; the workspace keeps clones tagged with its id, so results
    /// of its long-lived workers (language servers, linters) come back to it.
    pub(crate) fn new(id: WorkspaceId, jobs: &Jobs, ctx: &egui::Context, terminal: Option<crate::app::TerminalCommand>, layout: Layout) -> Workspace {
        let jobs = jobs.for_ws(Some(id));
        let repaint_ctx = ctx.clone();
        let visible = Arc::new(AtomicBool::new(false));
        let shown = visible.clone();
        let langs = Languages::new(
            jobs,
            Arc::new(move || {
                if shown.load(Ordering::Relaxed) {
                    repaint_ctx.request_repaint();
                }
            }),
        );
        let mut terminals = crate::terminal::Terminals::default();
        terminals.command = terminal;
        Workspace {
            id,
            project: None,
            pending_root: None,
            tabs: Tabs::default(),
            tree: ProjectTree::default(),
            breadcrumbs: Default::default(),
            git: GitInfo::default(),
            git_ui: GitUi::default(),
            langs,
            nav: Navigation::default(),
            diagnostics: Default::default(),
            find_window: Default::default(),
            find: FindInFiles::default(),
            search: SearchEverywhere::default(),
            index: FileIndex::default(),
            layout,
            terminals,
            watcher: None,
            commands: Vec::new(),
            confirm_close: None,
            opening: HashMap::new(),
            tree_ops: Default::default(),
            close_when_saved: false,
            restored: false,
            visible,
        }
    }

    /// No project, none loading and no tab: a new project may load into it.
    pub fn is_blank(&self) -> bool {
        self.project.is_none() && self.pending_root.is_none() && self.tabs.list.is_empty()
    }

    pub fn info(&self, active: WorkspaceId) -> WorkspaceInfo {
        let name = match (&self.project, &self.pending_root) {
            (Some(p), _) => p.name.clone(),
            (None, Some(_)) => "Opening...".into(),
            (None, None) => String::new(),
        };
        WorkspaceInfo { id: self.id, name, root: self.project.as_ref().map(|p| p.root.clone()), is_active: self.id == active }
    }

    /// The salt of every egui id this workspace draws. It follows the project root, so egui's
    /// persisted memory (panel sizes, scroll offsets) comes back for the same project after a
    /// restart, whatever its `WorkspaceId`.
    pub fn ui_salt(&self) -> Id {
        match &self.project {
            Some(p) => Id::new(("workspace", &p.root)),
            None => Id::new(("workspace-blank", self.id.0)),
        }
    }

    /// Process ids this workspace started and still runs: terminal shells, language servers,
    /// linters. Their child trees belong to them too. Cheap; never waits on a server.
    pub fn owned_pids(&self) -> Vec<u32> {
        let mut pids: Vec<u32> = self.terminals.shell_pids().collect();
        pids.extend(self.langs.pids());
        pids
    }

    /// True when no git refresh, index build, language request or debounce is pending.
    pub fn is_idle(&self) -> bool {
        self.langs.queued() == 0 && !self.git.refresh.busy() && !self.index.building && !self.has_pending_debounce()
    }

    /// Work that waits for a quiet period before it starts: language server sync and gutter marks
    /// after an edit, the log filter, re-blame, the hover request, the terminal tabs' save.
    pub fn has_pending_debounce(&self) -> bool {
        let workdir = self.git.repo.as_ref().map(|r| r.workdir().to_path_buf());
        let editors = self.tabs.editors().any(|e| {
            let version = e.doc.version();
            let ts = e.lsp_version.is_some_and(|v| v != version);
            let marks = workdir.as_ref().is_some_and(|w| e.path.starts_with(w)) && (e.marks_in_flight || e.marks_for != Some(version));
            ts || marks || e.problems.pending(version)
        });
        editors || self.git_ui.has_pending_debounce(&self.tabs) || self.nav.hover.is_waiting() || self.terminals.save_pending() || self.find.has_pending_debounce() || self.find_window.is_pending()
    }

    /// Stops what this workspace runs: terminal shells and language servers (on a worker, so
    /// the UI thread does not wait). The file watcher stops when the workspace drops.
    pub(crate) fn shutdown(&mut self) {
        self.terminals.kill_all();
        self.langs.shutdown_detached();
    }
}

thread_local! {
    /// `ui_salt` of the workspace in context. Only the UI thread draws, so a thread-local is
    /// enough; `AppState` updates it whenever the workspace in context changes.
    static SALT: Cell<Id> = Cell::new(Id::new("workspace-none"));
}

/// The egui id for `source` inside the workspace in context. Every absolute id a workspace draws
/// (popups, modals, panels, rows) goes through this, so focus, scroll and popups of one project
/// never leak into another.
pub fn wid(source: impl Hash) -> Id {
    SALT.with(|s| s.get()).with(source)
}

/// The salt of the workspace in context (`ui.push_id` around its panels).
pub fn salt() -> Id {
    SALT.with(|s| s.get())
}

pub(crate) fn set_salt(id: Id) {
    SALT.with(|s| s.set(id));
}
