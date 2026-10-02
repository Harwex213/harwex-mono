//! Project tree. Directories load lazily on a worker when first expanded. Ignored files are
//! hidden through the `ignore` crate, which reads `.gitignore` files of parent directories too.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Instant;

use egui::{pos2, vec2, Color32, FontId, RichText, ScrollArea, Sense, Shape, Stroke, Ui};
use ide_git::ChangeKind;

use crate::state::{AppState, GitInfo};
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
    let name = state.project.as_ref().map(|p| p.name.clone()).unwrap_or_default();
    ui.horizontal(|ui| {
        ui.label(RichText::new(name).strong());
        ui.label(RichText::new(root.display().to_string()).weak().size(11.0));
    });

    let scroll_requested = std::mem::take(&mut state.tree.scroll_to_selected);
    let mut rows = Vec::new();
    let mut missing = Vec::new();
    flatten(&state.tree, &root, 0, &mut rows, &mut missing);
    let row_h = 20.0;
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
                painter.rect_filled(rect, 0.0, theme::SELECTION_INACTIVE);
            } else if resp.hovered() {
                painter.rect_filled(rect, 0.0, theme::HOVER);
            }
            let x = rect.min.x + 6.0 + row.depth as f32 * 16.0;
            let cy = rect.center().y;
            if row.entry.is_dir {
                let c = theme::TEXT_DIM;
                let pts = if row.expanded {
                    vec![pos2(x, cy - 2.0), pos2(x + 8.0, cy - 2.0), pos2(x + 4.0, cy + 3.0)]
                } else {
                    vec![pos2(x + 2.0, cy - 4.0), pos2(x + 7.0, cy), pos2(x + 2.0, cy + 4.0)]
                };
                painter.add(Shape::convex_polygon(pts, c, Stroke::NONE));
            }
            let color = name_color(git, &row.entry.path, row.entry.is_dir);
            let icon_x = x + 12.0;
            draw_icon(painter, pos2(icon_x, cy), row.entry);
            painter.text(
                pos2(icon_x + 14.0, cy),
                egui::Align2::LEFT_CENTER,
                &row.entry.name,
                FontId::proportional(13.0),
                color,
            );
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

fn draw_icon(painter: &egui::Painter, center: egui::Pos2, entry: &Entry) {
    if entry.is_dir {
        let r = egui::Rect::from_center_size(center, vec2(12.0, 9.0));
        painter.rect_filled(r, 1.5, Color32::from_rgb(0x87, 0x93, 0x9A));
        return;
    }
    let ext = entry.name.rsplit('.').next().unwrap_or("");
    let color = match ext {
        "ts" | "tsx" | "mts" | "cts" => Color32::from_rgb(0x3E, 0x86, 0xC6),
        "js" | "jsx" | "mjs" | "cjs" => Color32::from_rgb(0xD8, 0xB6, 0x3B),
        "rs" => Color32::from_rgb(0xC6, 0x6B, 0x3E),
        "json" => Color32::from_rgb(0x9A, 0x9A, 0x55),
        "css" | "scss" => Color32::from_rgb(0x6E, 0x58, 0xB8),
        "md" => Color32::from_rgb(0x6A, 0x9F, 0xB5),
        _ => Color32::from_gray(140),
    };
    let r = egui::Rect::from_center_size(center, vec2(9.0, 11.0));
    painter.rect_filled(r, 1.0, color);
}

pub fn name_color(git: &GitInfo, path: &Path, is_dir: bool) -> Color32 {
    if is_dir {
        return if git.dirty_dirs.contains(path) { theme::GIT_MODIFIED } else { theme::TEXT };
    }
    match git.status.get(path) {
        Some(kind) => change_color(*kind),
        None => theme::TEXT,
    }
}

pub fn change_color(kind: ChangeKind) -> Color32 {
    match kind {
        ChangeKind::Added => theme::GIT_ADDED,
        ChangeKind::Modified | ChangeKind::TypeChange => theme::GIT_MODIFIED,
        ChangeKind::Renamed => theme::GIT_RENAMED,
        ChangeKind::Deleted => theme::GIT_DELETED,
        ChangeKind::Untracked => theme::GIT_UNTRACKED,
        ChangeKind::Conflicted => theme::GIT_CONFLICT,
    }
}
