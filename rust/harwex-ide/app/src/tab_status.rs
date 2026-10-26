//! Editor tab titles in the file's git status color (task 124), like IDEA's file status colors.
//!
//! The git part reads `ws.git.status`, which `apply_status` rebuilds once per status change.
//! The ignored part comes from `tree::ignored_below`, checked on a worker once per tab path and
//! again after a `.gitignore` change.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use egui::Color32;

use crate::state::AppState;
use crate::tabs::{Tab, TabContent};

/// Per workspace: whether the file of each open tab is git-ignored.
#[derive(Default)]
pub struct TabIgnored {
    /// The last answer per path. It stays while a newer check runs, so a `.gitignore` change
    /// does not blink the color.
    flags: HashMap<PathBuf, bool>,
    /// Paths checked since the last `.gitignore` change.
    fresh: HashSet<PathBuf>,
    loading: HashSet<PathBuf>,
    /// Bumped by `forget`: a check started before it is dropped.
    generation: u64,
    /// Worker checks started, for tests.
    pub checks: u64,
}

impl TabIgnored {
    /// `None` until a worker has checked `path`.
    pub fn is_ignored(&self, path: &Path) -> Option<bool> {
        self.flags.get(path).copied()
    }

    /// A `.gitignore` changed: every open tab is checked again.
    pub fn forget(&mut self) {
        self.fresh.clear();
        self.loading.clear();
        self.generation += 1;
    }
}

/// The file a tab colors by: an editor's file, a custom tab's `file_path` (diff, merge, image).
fn tab_file(tab: &Tab) -> Option<std::borrow::Cow<'_, Path>> {
    match &tab.content {
        TabContent::Editor(e) => Some(std::borrow::Cow::Borrowed(e.path.as_path())),
        TabContent::Custom(c) => c.file_path().map(std::borrow::Cow::Owned),
    }
}

/// The title color of `tab` in the active workspace; `None` keeps the normal title color.
pub fn color(state: &AppState, tab: &Tab) -> Option<Color32> {
    let path = tab_file(tab)?;
    let ignored = state.settings.global.files.show_ignored && state.ws.tab_ignored.is_ignored(&path) == Some(true);
    crate::tree::status_color(&state.ws.git, &path, false, ignored)
}

/// The title colors of the active workspace's tabs, in strip order.
pub fn colors(state: &AppState) -> Vec<Option<Color32>> {
    state.ws.tabs.list.iter().map(|t| color(state, t)).collect()
}

/// Starts one worker check for the open tab files of the project that were not checked yet.
/// Called every frame before the strip draws; it does no disk work on the UI thread.
pub fn request(state: &mut AppState) {
    if !state.settings.global.files.show_ignored {
        return;
    }
    let Some(root) = state.ws.project.as_ref().map(|p| p.root.clone()) else { return };
    let ti = &state.ws.tab_ignored;
    let mut todo: Vec<PathBuf> = Vec::new();
    for tab in &state.ws.tabs.list {
        let Some(path) = tab_file(tab) else { continue };
        if path.starts_with(&root) && !ti.fresh.contains(path.as_ref()) && !ti.loading.contains(path.as_ref()) && !todo.iter().any(|p| p == path.as_ref()) {
            todo.push(path.into_owned());
        }
    }
    if todo.is_empty() {
        return;
    }
    let ti = &mut state.ws.tab_ignored;
    ti.loading.extend(todo.iter().cloned());
    ti.checks += 1;
    let generation = ti.generation;
    let project = state.project_generation();
    state.jobs.spawn_quiet(
        move || todo.into_iter().map(|p| {
            let ignored = crate::tree::ignored_below(&root, &p).last().copied().unwrap_or(false);
            (p, ignored)
        }).collect::<Vec<_>>(),
        move |state, answers| {
            if state.ws.tab_ignored.generation != generation {
                return;
            }
            if state.project_generation() != project {
                for (p, _) in &answers {
                    state.ws.tab_ignored.loading.remove(p);
                }
                return;
            }
            let open: HashSet<PathBuf> = state.ws.tabs.list.iter().filter_map(|t| tab_file(t).map(|p| p.into_owned())).collect();
            let ti = &mut state.ws.tab_ignored;
            for (p, ignored) in answers {
                ti.loading.remove(&p);
                ti.fresh.insert(p.clone());
                ti.flags.insert(p, ignored);
            }
            // Closed tabs leave no entries behind.
            ti.flags.retain(|p, _| open.contains(p));
            ti.fresh.retain(|p| open.contains(p));
        },
    );
}

/// A `.gitignore` in a watcher batch may change which tab files are ignored: check them again.
pub fn on_fs_batch(state: &mut AppState, paths: &HashSet<PathBuf>) {
    if paths.iter().any(|p| p.file_name().is_some_and(|n| n == ".gitignore")) {
        state.ws.tab_ignored.forget();
    }
}
