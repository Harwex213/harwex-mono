//! Git UI entry points. The app shell calls these hooks; the Git UI phase replaces the bodies
//! (and adds sibling modules under `app/src/git/`) without touching the shell.
//!
//! Data the shell already keeps fresh: `state.git` (repo handle, branch, status map; refreshed
//! after file changes and `.git` changes). Call `state.refresh_git()` after any git write.

use egui::{Context, Ui};
use ide_editor::EditorAction;

use crate::state::AppState;
use crate::tabs::TabId;

// Owned by the "changes" agent: commit window, diff tabs, editor-side git (gutter, blame).
pub mod changes;
pub mod diff;
pub mod editor_git;
// Owned by the "history" agent: log, branches popup, push/update/stash, conflicts.
pub mod branches;
pub mod conflicts;
pub mod log;
pub mod remote;

/// Git UI state. Each sub-module owns its own state struct.
#[derive(Default)]
pub struct GitUi {
    pub changes: changes::ChangesUi,
    pub editor: editor_git::EditorGitUi,
    pub log: log::LogUi,
    pub branches: branches::BranchesUi,
    pub remote: remote::RemoteUi,
    pub conflicts: conflicts::ConflictsUi,
}

impl GitUi {
    /// A debounced reload (log filter, re-blame) has not started yet.
    pub fn has_pending_debounce(&self, tabs: &crate::tabs::Tabs) -> bool {
        self.log.filter_pending() || self.editor.blame_pending(tabs)
    }
}

/// Top bar: the branch button was clicked. `anchor` is the button's bottom-left corner.
pub fn branch_button_clicked(state: &mut AppState, anchor: egui::Pos2) {
    branches::open_popup(state, anchor);
}

/// Top bar: Update Project (pull).
pub fn update_project_clicked(state: &mut AppState) {
    remote::open_update_dialog(state);
}

/// Top bar: Commit. Usually shows the Commit tool window.
pub fn commit_clicked(state: &mut AppState) {
    state.layout.show(crate::layout::ToolWindow::Commit);
}

/// Top bar: Push.
pub fn push_clicked(state: &mut AppState) {
    remote::open_push_dialog(state);
}

/// Body of the left "Commit" tool window.
pub fn commit_tool_window(state: &mut AppState, ui: &mut Ui) {
    changes::tool_window(state, ui);
}

/// Body of the bottom "Git" (log) tool window.
pub fn log_tool_window(state: &mut AppState, ui: &mut Ui) {
    log::tool_window(state, ui);
}

/// Editor context-menu actions under "Git >". `tab` is the editor tab they came from.
pub fn on_editor_action(state: &mut AppState, tab: TabId, action: &EditorAction) {
    editor_git::on_editor_action(state, tab, action);
}

/// A click on a gutter change bar (line is 0-based).
pub fn on_gutter_click(state: &mut AppState, tab: TabId, line: usize) {
    editor_git::on_gutter_click(state, tab, line);
}

/// A click in the blame annotation column.
pub fn on_annotation_click(state: &mut AppState, tab: TabId, line: usize) {
    editor_git::on_annotation_click(state, tab, line);
}

/// Every frame, after the panels: popups, dialogs, modal windows.
pub fn show_windows(state: &mut AppState, ctx: &Context) {
    changes::show_windows(state, ctx);
    editor_git::show_windows(state, ctx);
    branches::show_windows(state, ctx);
    remote::show_windows(state, ctx);
    conflicts::show_windows(state, ctx);
    log::show_windows(state, ctx);
}

/// After the shell refreshed `state.git` (status and branch).
pub fn on_git_refreshed(state: &mut AppState) {
    changes::on_git_refreshed(state);
    log::on_git_refreshed(state);
    conflicts::on_git_refreshed(state);
}
