//! Open workspaces in eframe storage: which roots were open, the active one, and the layout and
//! open files of each project, keyed by canonical root.
//!
//! Keys:
//! - `open_projects`: one canonical root per line, in open order.
//! - `active_project`: the active root.
//! - `project_state`: one line per known project: `root \t layout \t active file \t files...`.
//!   Closed projects stay, so a project opened again gets its layout back.
//! - `languages_off`: roots whose language servers the user stopped (Stop Language Servers),
//!   one per line. They stay off when the project opens again.
//! - `recent_projects`: the Recent Projects of the project selector, one root per line, newest
//!   first (`projects_popup.rs`).
//! - `last_folder` and `tool_windows`: the active root and its layout. Older versions wrote only
//!   these; they are still read as the fallback, and `tool_windows` is the layout of a project
//!   that has none saved.

use std::collections::HashMap;
use std::path::PathBuf;

use crate::layout::Layout;
use crate::state::AppState;
use crate::tabs::TabContent;
use crate::workspace::Workspace;

pub const STORAGE_LAST_FOLDER: &str = "last_folder";
pub const STORAGE_LAYOUT: &str = "tool_windows";
pub const STORAGE_OPEN_PROJECTS: &str = "open_projects";
pub const STORAGE_ACTIVE_PROJECT: &str = "active_project";
pub const STORAGE_PROJECT_STATE: &str = "project_state";
pub const STORAGE_RECENT_PROJECTS: &str = "recent_projects";
pub const STORAGE_LANGUAGES_OFF: &str = "languages_off";
/// Projects remembered in `project_state`; the oldest closed ones drop out first.
const MAX_SAVED: usize = 50;

/// What a project restores when it opens again.
#[derive(Clone, Debug, PartialEq)]
pub struct SavedWorkspace {
    pub layout: Layout,
    /// Open editor files, in tab order. Canonical.
    pub files: Vec<PathBuf>,
    pub active_file: Option<PathBuf>,
    /// Stop Language Servers is on for the project. Stored under its own key.
    pub langs_off: bool,
}

impl SavedWorkspace {
    pub fn of(ws: &Workspace) -> SavedWorkspace {
        let files = ws
            .tabs
            .list
            .iter()
            .filter_map(|t| match &t.content {
                TabContent::Editor(e) => Some(e.path.clone()),
                TabContent::Custom(_) => None,
            })
            .collect();
        SavedWorkspace { layout: ws.layout, files, active_file: ws.tabs.active_editor().map(|e| e.path.clone()), langs_off: ws.langs.is_off() }
    }

    fn to_line(&self, root: &std::path::Path) -> String {
        let active = self.active_file.as_ref().map(|p| p.display().to_string()).unwrap_or_default();
        let mut parts = vec![root.display().to_string(), self.layout.to_storage(), active];
        parts.extend(self.files.iter().map(|p| p.display().to_string()));
        parts.join("\t")
    }

    fn from_line(line: &str) -> Option<(PathBuf, SavedWorkspace)> {
        let mut parts = line.split('\t');
        let root = PathBuf::from(parts.next().filter(|r| !r.is_empty())?);
        let layout = Layout::from_storage(parts.next()?)?;
        let active_file = parts.next().filter(|a| !a.is_empty()).map(PathBuf::from);
        let files = parts.filter(|p| !p.is_empty()).map(PathBuf::from).collect();
        Some((root, SavedWorkspace { layout, files, active_file, langs_off: false }))
    }
}

/// What `IdeApp::create` reopens.
#[derive(Debug, Default, PartialEq)]
pub struct Restore {
    pub roots: Vec<PathBuf>,
    pub active: Option<PathBuf>,
}

/// Reads the saved projects into `state.saved` and returns the roots to reopen.
pub fn load(state: &mut AppState, storage: &dyn eframe::Storage) -> Restore {
    if let Some(layout) = storage.get_string(STORAGE_LAYOUT).and_then(|t| Layout::from_storage(&t)) {
        state.default_layout = layout;
        state.ws.layout = layout;
    }
    if let Some(text) = storage.get_string(STORAGE_PROJECT_STATE) {
        state.saved = text.lines().filter_map(SavedWorkspace::from_line).collect::<HashMap<_, _>>();
    }
    for root in storage.get_string(STORAGE_LANGUAGES_OFF).unwrap_or_default().lines().filter(|l| !l.is_empty()) {
        let layout = state.default_layout;
        state.saved.entry(PathBuf::from(root)).or_insert_with(|| SavedWorkspace { layout, files: Vec::new(), active_file: None, langs_off: false }).langs_off = true;
    }
    let last = storage.get_string(STORAGE_LAST_FOLDER).filter(|l| !l.is_empty()).map(PathBuf::from);
    let roots: Vec<PathBuf> = match storage.get_string(STORAGE_OPEN_PROJECTS) {
        Some(text) => text.lines().filter(|l| !l.is_empty()).map(PathBuf::from).collect(),
        None => last.clone().into_iter().collect(),
    };
    let active = storage.get_string(STORAGE_ACTIVE_PROJECT).filter(|a| !a.is_empty()).map(PathBuf::from).or(last);
    let recent = storage.get_string(STORAGE_RECENT_PROJECTS).unwrap_or_default();
    state.projects.recent = recent.lines().filter(|l| !l.is_empty()).map(PathBuf::from).collect();
    // Storage from before the Recent list: the open projects start it.
    for root in &roots {
        if !state.projects.recent.contains(root) {
            state.projects.recent.push(root.clone());
        }
    }
    Restore { roots, active }
}

pub fn save(state: &mut AppState, storage: &mut dyn eframe::Storage) {
    let open: Vec<(PathBuf, SavedWorkspace)> = {
        let mut ws: Vec<&Workspace> = state.all_ws().collect();
        ws.sort_by_key(|w| w.id);
        ws.into_iter().filter_map(|w| w.project.as_ref().map(|p| (p.root.clone(), SavedWorkspace::of(w)))).collect()
    };
    let roots: Vec<String> = open.iter().map(|(r, _)| r.display().to_string()).collect();
    storage.set_string(STORAGE_OPEN_PROJECTS, roots.join("\n"));
    let recent: Vec<String> = state.projects.recent.iter().map(|r| r.display().to_string()).collect();
    storage.set_string(STORAGE_RECENT_PROJECTS, recent.join("\n"));
    let active = state.workspace(state.active_id());
    if let Some(p) = active.and_then(|w| w.project.as_ref()) {
        storage.set_string(STORAGE_LAST_FOLDER, p.root.display().to_string());
        storage.set_string(STORAGE_ACTIVE_PROJECT, p.root.display().to_string());
    }
    if let Some(w) = active {
        storage.set_string(STORAGE_LAYOUT, w.layout.to_storage());
    }
    // Open projects go last, so they survive the cut.
    let open_roots: Vec<PathBuf> = open.iter().map(|(r, _)| r.clone()).collect();
    let mut lines: Vec<String> = state.saved.iter().filter(|(r, _)| !open_roots.contains(r)).map(|(r, s)| s.to_line(r)).collect();
    lines.sort();
    let keep = MAX_SAVED.saturating_sub(open.len());
    if lines.len() > keep {
        lines.drain(..lines.len() - keep);
    }
    for (root, saved) in open {
        lines.push(saved.to_line(&root));
        state.saved.insert(root, saved);
    }
    storage.set_string(STORAGE_PROJECT_STATE, lines.join("\n"));
    let mut off: Vec<String> = state.saved.iter().filter(|(_, s)| s.langs_off).map(|(r, _)| r.display().to_string()).collect();
    off.sort();
    storage.set_string(STORAGE_LANGUAGES_OFF, off.join("\n"));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::ToolWindow;

    #[test]
    fn saved_workspace_line_round_trip() {
        let s = SavedWorkspace {
            layout: Layout { left: Some(ToolWindow::Commit), bottom: None },
            files: vec![PathBuf::from("/p/a.rs"), PathBuf::from("/p/b c.rs")],
            active_file: Some(PathBuf::from("/p/b c.rs")),
            langs_off: false,
        };
        let (root, back) = SavedWorkspace::from_line(&s.to_line(std::path::Path::new("/p"))).expect("parses");
        assert_eq!(root, PathBuf::from("/p"));
        assert_eq!(back, s);
        let none = SavedWorkspace { layout: Layout::default(), files: vec![], active_file: None, langs_off: false };
        assert_eq!(SavedWorkspace::from_line(&none.to_line(std::path::Path::new("/q"))).map(|(_, s)| s), Some(none));
        assert!(SavedWorkspace::from_line("").is_none());
    }
}
