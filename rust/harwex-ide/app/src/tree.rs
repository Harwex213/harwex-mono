//! Project tree. Directories load lazily on a worker when first expanded. Ignored files are
//! hidden through the `ignore` crate, which reads `.gitignore` files of parent directories too.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Instant;

use egui::{pos2, vec2, Color32, Rect, ScrollArea, Sense, Ui};
use ide_git::ChangeKind;

use crate::state::{AppState, GitInfo};
use crate::icons::{self, Icon};
use crate::theme;

#[derive(Clone, Debug)]
pub struct Entry {
    pub path: PathBuf,
    pub name: String,
    pub is_dir: bool,
}

#[derive(Default)]
pub struct ProjectTree {
    dirs: HashMap<PathBuf, Vec<Entry>>,
    loading: HashSet<PathBuf>,
    expanded: HashSet<PathBuf>,
    pub selected: Option<PathBuf>,
    /// Set once, for the timings log.
    pub root_load_ms: Option<f64>,
    scroll_to_selected: bool,
}

/// Lists one directory: dirs first, then files, case-insensitive, like IDEA.
pub fn list_dir(dir: &Path) -> Vec<Entry> {
    let walker = ignore::WalkBuilder::new(dir)
        .max_depth(Some(1))
        .hidden(false)
        .git_global(true)
        .git_ignore(true)
        .git_exclude(true)
        .parents(true)
        .filter_entry(|e| e.file_name() != ".git")
        .build();
    let mut out: Vec<Entry> = walker
        .filter_map(Result::ok)
        .filter(|e| e.depth() == 1)
        .map(|e| {
            let is_dir = e.file_type().is_some_and(|t| t.is_dir())
                || (e.path_is_symlink() && e.path().is_dir());
            Entry { name: e.file_name().to_string_lossy().into_owned(), path: e.into_path(), is_dir }
        })
        .collect();
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    out
}

impl ProjectTree {
    pub fn clear(&mut self) {
        *self = ProjectTree::default();
    }

    pub fn is_loaded(&self, dir: &Path) -> bool {
        self.dirs.contains_key(dir)
    }

    pub fn set_dir(&mut self, dir: PathBuf, entries: Vec<Entry>) {
        self.loading.remove(&dir);
        self.dirs.insert(dir, entries);
    }

    /// Selects a file and expands its parents, e.g. for "Select Opened File".
    #[allow(dead_code)] // Extension surface for the Git UI phase.
    pub fn reveal(&mut self, root: &Path, path: &Path) {
        let mut p = path.parent();
        while let Some(dir) = p {
            if !dir.starts_with(root) {
                break;
            }
            self.expanded.insert(dir.to_path_buf());
            p = dir.parent();
        }
        self.selected = Some(path.to_path_buf());
        self.scroll_to_selected = true;
    }
}

/// Starts loading `dir` on a worker unless it is already loading.
pub fn load_dir(state: &mut AppState, dir: PathBuf) {
    if !state.tree.loading.insert(dir.clone()) {
        return;
    }
    let generation = state.project_generation();
    let started = Instant::now();
    let d = dir.clone();
    state.jobs.spawn_quiet(
        move || {
            let entries = list_dir(&d);
            (entries, started.elapsed())
        },
        move |state, (entries, took)| {
            if state.project_generation() != generation {
                return;
            }
            if state.project.as_ref().is_some_and(|p| p.root == dir) && state.tree.root_load_ms.is_none() {
                let ms = took.as_secs_f64() * 1000.0;
                state.tree.root_load_ms = Some(ms);
                state.timings.log(format!("project tree root listed in {ms:.1} ms ({} entries)", entries.len()));
            }
            state.tree.set_dir(dir, entries);
        },
    );
}

struct Row<'a> {
    depth: usize,
    entry: &'a Entry,
    expanded: bool,
}

fn flatten<'a>(tree: &'a ProjectTree, dir: &Path, depth: usize, out: &mut Vec<Row<'a>>, missing: &mut Vec<PathBuf>) {
    let Some(entries) = tree.dirs.get(dir) else {
        missing.push(dir.to_path_buf());
        return;
    };
    for e in entries {
        let expanded = e.is_dir && tree.expanded.contains(&e.path);
        out.push(Row { depth, entry: e, expanded });
        if expanded {
            flatten(tree, &e.path, depth + 1, out, missing);
        }
    }
}

pub enum TreeEvent {
    Open(PathBuf),
}

/// The Project tool window body.
pub fn show(state: &mut AppState, ui: &mut Ui) -> Option<TreeEvent> {
    let Some(root) = state.project.as_ref().map(|p| p.root.clone()) else {
        ui.label("No folder open");
        return None;
    };
    let t = &theme::T;
    let name = state.project.as_ref().map(|p| p.name.clone()).unwrap_or_default();
    // The root row, like IDEA: always expanded, the name and the full path.
    let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), t.space.row_h), Sense::hover());
    {
        let painter = ui.painter();
        let cy = rect.center().y;
        let x = rect.min.x + 4.0;
        icons::paint(painter, Rect::from_center_size(pos2(x + 6.0, cy), vec2(12.0, 12.0)), Icon::ChevronDown, t.text_dim);
        icons::folder(painter, pos2(x + 22.0, cy), 15.0);
        let g = painter.layout_no_wrap(name.clone(), t.semibold(t.font.ui), t.text);
        let name_w = g.size().x;
        painter.galley(pos2(x + 34.0, cy - g.size().y / 2.0), g, t.text);
        painter.with_clip_rect(rect.intersect(ui.clip_rect())).text(pos2(x + 34.0 + name_w + 8.0, cy), egui::Align2::LEFT_CENTER, root.display().to_string(), t.tiny_font(), t.text_dim);
    }
    let r = ui.interact(rect, ui.id().with("tree-root"), Sense::hover());
    crate::util::label_widget(&r, egui::WidgetType::Label, name.clone());
    crate::util::label_widget(&ui.interact(Rect::from_min_size(rect.right_top(), vec2(0.0, 0.0)), ui.id().with("tree-root-path"), Sense::hover()), egui::WidgetType::Label, root.display().to_string());

    let scroll_requested = std::mem::take(&mut state.tree.scroll_to_selected);
    let mut rows = Vec::new();
    let mut missing = Vec::new();
    flatten(&state.tree, &root, 0, &mut rows, &mut missing);
    let row_h = t.space.row_h;
    let mut toggle: Option<PathBuf> = None;
    let mut select: Option<PathBuf> = None;
    let mut event = None;
    let scroll_target = if scroll_requested {
        state.tree.selected.as_ref().and_then(|s| rows.iter().position(|r| &r.entry.path == s))
    } else {
        None
    };
    let mut area = ScrollArea::both().auto_shrink([false, false]).id_salt("project-tree");
    if let Some(i) = scroll_target {
        area = area.vertical_scroll_offset((i as f32 * row_h - ui.available_height() / 2.0).max(0.0));
    }
    let git = &state.git;
    let selected = state.tree.selected.as_deref();
    area.show_rows(ui, row_h, rows.len(), |ui, range| {
        for row in &rows[range] {
            let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width().max(260.0), row_h), Sense::click());
            let rel = row.entry.path.strip_prefix(&root).unwrap_or(&row.entry.path);
            crate::util::label_selectable(&resp, rel.display().to_string(), selected == Some(row.entry.path.as_path()));
            let painter = ui.painter();
            if selected == Some(row.entry.path.as_path()) {
                painter.rect_filled(rect, t.radius.row, t.selection_inactive);
            } else if resp.hovered() {
                painter.rect_filled(rect, t.radius.row, t.hover);
            }
            // Children sit one indent right of the root's chevron.
            let x = rect.min.x + 4.0 + (row.depth + 1) as f32 * t.space.indent;
            let cy = rect.center().y;
            if row.entry.is_dir {
                let chevron = if row.expanded { Icon::ChevronDown } else { Icon::ChevronRight };
                icons::paint(painter, Rect::from_center_size(pos2(x + 6.0, cy), vec2(12.0, 12.0)), chevron, t.text_dim);
            }
            let color = name_color(git, &row.entry.path, row.entry.is_dir);
            let icon_c = pos2(x + 22.0, cy);
            if row.entry.is_dir {
                icons::folder(painter, icon_c, 15.0);
            } else {
                icons::file(painter, icon_c, 14.0, &row.entry.name);
            }
            painter.text(pos2(x + 34.0, cy), egui::Align2::LEFT_CENTER, &row.entry.name, t.ui_font(), color);
            if resp.clicked() {
                select = Some(row.entry.path.clone());
                if row.entry.is_dir {
                    toggle = Some(row.entry.path.clone());
                }
            }
            if resp.double_clicked() && !row.entry.is_dir {
                event = Some(TreeEvent::Open(row.entry.path.clone()));
            }
        }
    });
    if let Some(s) = select {
        state.tree.selected = Some(s);
    }
    if let Some(dir) = toggle {
        if !state.tree.expanded.remove(&dir) {
            state.tree.expanded.insert(dir);
        }
    }
    for dir in missing {
        load_dir(state, dir);
    }
    event
}

pub fn name_color(git: &GitInfo, path: &Path, is_dir: bool) -> Color32 {
    if is_dir {
        return if git.dirty_dirs.contains(path) { theme::T.git_modified } else { theme::T.text };
    }
    match git.status.get(path) {
        Some(kind) => change_color(*kind),
        None => theme::T.text,
    }
}

pub fn change_color(kind: ChangeKind) -> Color32 {
    match kind {
        ChangeKind::Added => theme::T.git_added,
        ChangeKind::Modified | ChangeKind::TypeChange => theme::T.git_modified,
        ChangeKind::Renamed => theme::T.git_renamed,
        ChangeKind::Deleted => theme::T.git_deleted,
        ChangeKind::Untracked => theme::T.git_untracked,
        ChangeKind::Conflicted => theme::T.git_conflict,
    }
}
