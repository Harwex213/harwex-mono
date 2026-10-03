//! Project tree. Directories load lazily on a worker when first expanded. Ignored files are
//! hidden through the `ignore` crate, which reads `.gitignore` files of parent directories too.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Instant;

use egui::{pos2, vec2, Color32, Id, Key, Rect, ScrollArea, Sense, Ui};
use ide_git::ChangeKind;

use crate::state::{AppState, GitInfo};
use crate::tree_menu::{MenuInfo, Target, TreeCommand};
use crate::icons;
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
    scroll_to: Option<ScrollMode>,
    /// The vertical scroll offset drawn last frame.
    view_offset: f32,
    /// Give the tree keyboard focus the next time it is drawn.
    focus_pending: bool,
    /// Excluded folders (`[project] excluded`), absolute. Drawn dimmed with their content.
    pub excluded: Vec<PathBuf>,
    /// The row being dragged, while a drag runs.
    pub drag: Option<TreeDrag>,
}

/// A drag of a tree row (drag and drop to move, Alt to copy).
#[derive(Clone, Debug)]
pub struct TreeDrag {
    pub path: PathBuf,
    pub is_dir: bool,
    /// The collapsed folder under the pointer and when the pointer reached it (input time).
    hover: Option<(PathBuf, f64)>,
}

/// Hovering a collapsed folder this long during a drag expands it.
pub const DRAG_EXPAND_SECS: f64 = 0.8;
/// The band at the top and bottom of the tree that scrolls during a drag.
const DRAG_SCROLL_BAND: f32 = 24.0;
/// The pointer moves this far from the press before a press becomes a drag (egui's click
/// distance, so a press is either a click or a drag, never both).
const DRAG_START_DIST: f32 = 6.0;

/// Where a drop of `src` onto a row lands: the row's folder, or the parent of a file row.
/// `None` when the drop is refused (the item itself or one of its descendants).
pub fn drop_dir(src: &Path, row: &Path, row_is_dir: bool) -> Option<PathBuf> {
    let dir = if row_is_dir { row.to_path_buf() } else { row.parent()?.to_path_buf() };
    (!dir.starts_with(src)).then_some(dir)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ScrollMode {
    Center,
    Nearest,
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

    pub fn is_expanded(&self, dir: &Path) -> bool {
        self.expanded.contains(dir)
    }

    /// The vertical scroll offset drawn last frame.
    pub fn view_offset(&self) -> f32 {
        self.view_offset
    }

    pub fn set_expanded(&mut self, dir: &Path, expanded: bool) {
        if expanded {
            self.expanded.insert(dir.to_path_buf());
        } else {
            self.expanded.remove(dir);
        }
    }

    /// Gives the tree the keyboard focus the next time it is drawn (after a dialog closes).
    pub fn focus_pending(&mut self) {
        self.focus_pending = true;
    }

    /// After a move: expanded folders, the selection and cached listings under `old` follow.
    pub fn rekey(&mut self, old: &Path, new: &Path) {
        let moved = |p: &PathBuf| crate::fileops::moved_path(p, old, new);
        self.expanded = self.expanded.iter().map(|p| moved(p).unwrap_or_else(|| p.clone())).collect();
        if let Some(sel) = self.selected.as_ref().and_then(moved) {
            self.selected = Some(sel);
        }
        self.dirs.retain(|d, _| !d.starts_with(old));
    }

    /// The selected folder, or the folder of the selected file.
    pub fn selected_dir(&self) -> Option<PathBuf> {
        let sel = self.selected.as_ref()?;
        let is_dir = sel.parent().and_then(|p| self.dirs.get(p)).and_then(|entries| entries.iter().find(|e| &e.path == sel)).is_some_and(|e| e.is_dir);
        if is_dir {
            Some(sel.clone())
        } else {
            sel.parent().map(Path::to_path_buf)
        }
    }

    pub fn is_excluded(&self, path: &Path) -> bool {
        self.excluded.iter().any(|e| path.starts_with(e))
    }

    /// Selects a file and expands its parents, e.g. for "Select Opened File".
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
        self.scroll_to = Some(ScrollMode::Center);
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

/// The focus id of the tree. The tree "has focus" (blue selection, arrow keys) while egui's
/// keyboard focus is on this id.
pub fn focus_id() -> Id {
    Id::new("project-tree")
}

pub fn has_focus(ctx: &egui::Context) -> bool {
    ctx.memory(|m| m.has_focus(focus_id()))
}

/// "Select Opened File" (the header button, Alt+F1): expands the tree down to the active tab's
/// file, selects its row, scrolls it into view and gives the tree the focus.
pub fn select_opened_file(state: &mut AppState) {
    let Some(root) = state.project.as_ref().map(|p| p.root.clone()) else { return };
    let Some(file) = crate::breadcrumbs::active_file(state) else { return };
    if !file.starts_with(&root) {
        return;
    }
    state.layout.show(crate::layout::ToolWindow::Project);
    state.tree.reveal(&root, &file);
    state.tree.focus_pending = true;
}

/// What the keyboard asked for this frame, applied after the rows are drawn.
#[derive(Default)]
struct KeyOutcome {
    select: Option<PathBuf>,
    toggle: Option<PathBuf>,
    open: Option<PathBuf>,
    to_editor: bool,
    command: Option<TreeCommand>,
}

/// The file operation keys while the tree has focus. macOS turns ⌘X, ⌘C and ⌘V into Cut,
/// Copy and Paste events with no key event (⌘V only when the clipboard holds text), so both
/// forms count. ⇧⌘C arrives as a Copy event with Shift held.
fn command_keys(ui: &Ui, cut_pending: bool) -> Option<TreeCommand> {
    use egui::Modifiers as M;
    ui.input_mut(|i| {
        let shift = i.modifiers.shift;
        let mut from_event = None;
        i.events.retain(|e| match e {
            egui::Event::Cut => {
                from_event = Some(TreeCommand::Cut);
                false
            }
            egui::Event::Copy => {
                from_event = Some(if shift { TreeCommand::CopyAbsPath } else { TreeCommand::Copy });
                false
            }
            egui::Event::Paste(_) => {
                from_event = Some(TreeCommand::Paste);
                false
            }
            _ => true,
        });
        if from_event.is_some() {
            return from_event;
        }
        // Most specific first: consume_key ignores an extra Shift or Alt.
        let cmd_shift = M::COMMAND | M::SHIFT;
        if i.consume_key(cmd_shift, Key::C) {
            Some(TreeCommand::CopyAbsPath)
        } else if i.consume_key(M::COMMAND, Key::C) {
            Some(TreeCommand::Copy)
        } else if i.consume_key(M::COMMAND, Key::X) {
            Some(TreeCommand::Cut)
        } else if i.consume_key(M::COMMAND, Key::V) {
            Some(TreeCommand::Paste)
        } else if i.consume_key(M::ALT, Key::C) {
            Some(TreeCommand::CopyProjectPath)
        } else if i.consume_key(M::COMMAND, Key::Period) {
            Some(TreeCommand::NewFile)
        } else if i.consume_key(M::SHIFT, Key::F6) || i.consume_key(M::ALT, Key::Num2) {
            Some(TreeCommand::Rename)
        } else if i.consume_key(M::ALT, Key::F7) {
            Some(TreeCommand::FindUsages)
        } else if i.consume_key(M::COMMAND, Key::Backspace) || i.consume_key(M::NONE, Key::Backspace) || i.consume_key(M::NONE, Key::Delete) {
            Some(TreeCommand::Delete)
        } else if cut_pending && i.consume_key(M::NONE, Key::Escape) {
            Some(TreeCommand::CancelCut)
        } else {
            None
        }
    })
}

/// Arrow keys, Enter and Escape while the tree has focus, like IDEA: Up and Down move the
/// selection, Right expands (or steps into the folder), Left collapses (or goes to the parent).
fn keyboard(ui: &Ui, rows: &[Row], selected: Option<&Path>, cut_pending: bool) -> KeyOutcome {
    let mut out = KeyOutcome { command: command_keys(ui, cut_pending), ..Default::default() };
    let none = egui::Modifiers::NONE;
    let (up, down, left, right, enter, escape) = ui.input_mut(|i| {
        (
            i.consume_key(none, Key::ArrowUp),
            i.consume_key(none, Key::ArrowDown),
            i.consume_key(none, Key::ArrowLeft),
            i.consume_key(none, Key::ArrowRight),
            i.consume_key(none, Key::Enter),
            i.consume_key(none, Key::Escape),
        )
    });
    out.to_editor = escape;
    if rows.is_empty() {
        return out;
    }
    let cur = selected.and_then(|s| rows.iter().position(|r| r.entry.path == s));
    let Some(i) = cur else {
        if up || down {
            out.select = Some(rows[0].entry.path.clone());
        }
        return out;
    };
    let row = &rows[i];
    if up && i > 0 {
        out.select = Some(rows[i - 1].entry.path.clone());
    } else if down && i + 1 < rows.len() {
        out.select = Some(rows[i + 1].entry.path.clone());
    } else if right && row.entry.is_dir {
        if !row.expanded {
            out.toggle = Some(row.entry.path.clone());
        } else if rows.get(i + 1).is_some_and(|n| n.depth > row.depth) {
            out.select = Some(rows[i + 1].entry.path.clone());
        }
    } else if left {
        if row.expanded {
            out.toggle = Some(row.entry.path.clone());
        } else if let Some(parent) = rows[..i].iter().rev().find(|r| r.depth < row.depth) {
            out.select = Some(parent.entry.path.clone());
        }
    } else if enter {
        if row.entry.is_dir {
            out.toggle = Some(row.entry.path.clone());
        } else {
            out.open = Some(row.entry.path.clone());
        }
    }
    out
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
        icons::tree_chevron(painter, pos2(x + 6.0, cy), true, t.tree_chevron);
        icons::folder(painter, pos2(x + 22.0, cy), 15.0);
        let g = painter.layout_no_wrap(name.clone(), t.semibold(t.font.ui), t.text);
        let name_w = g.size().x;
        painter.galley(pos2(x + 34.0, cy - g.size().y / 2.0), g, t.text);
        painter.with_clip_rect(rect.intersect(ui.clip_rect())).text(pos2(x + 34.0 + name_w + 8.0, cy), egui::Align2::LEFT_CENTER, root.display().to_string(), t.tiny_font(), t.text_dim);
    }
    let r = ui.interact(rect, ui.id().with("tree-root"), Sense::hover());
    crate::util::label_widget(&r, egui::WidgetType::Label, name.clone());
    crate::util::label_widget(&ui.interact(Rect::from_min_size(rect.right_top(), vec2(0.0, 0.0)), ui.id().with("tree-root-path"), Sense::hover()), egui::WidgetType::Label, root.display().to_string());

    if std::mem::take(&mut state.tree.focus_pending) {
        ui.memory_mut(|m| m.request_focus(focus_id()));
    }
    let focused = ui.memory(|m| m.has_focus(focus_id()));
    if focused {
        // The arrows and Escape belong to the tree, not to egui's focus navigation.
        ui.memory_mut(|m| m.set_focus_lock_filter(focus_id(), egui::EventFilter { tab: false, horizontal_arrows: true, vertical_arrows: true, escape: true }));
    }

    // Escape cancels a drag before the tree's keys see it.
    if state.tree.drag.is_some() && ui.input_mut(|i| i.consume_key(egui::Modifiers::NONE, Key::Escape)) {
        state.tree.drag = None;
    }
    // A double click is press 2 of the app's click chain (`clicks.rs`), not egui's count.
    let clicks = state.clicks;
    let mut rows = Vec::new();
    let mut missing = Vec::new();
    flatten(&state.tree, &root, 0, &mut rows, &mut missing);
    // An open context menu needs Escape and the arrows itself.
    let menu_open = ui.ctx().is_context_menu_open();
    let keys = if focused && !menu_open { keyboard(ui, &rows, state.tree.selected.as_deref(), state.tree_ops.has_cut()) } else { KeyOutcome::default() };
    // A key command acts on the selected row; the root when nothing is selected.
    let key_target = keys.command.map(|c| {
        let sel = state.tree.selected.clone().filter(|s| s.starts_with(&root));
        let target = match sel.and_then(|s| rows.iter().find(|r| r.entry.path == s)) {
            Some(r) => Target { path: r.entry.path.clone(), is_dir: r.entry.is_dir },
            None => Target { path: root.clone(), is_dir: true },
        };
        (c, target)
    });
    let row_h = t.space.row_h;
    // Each row owns the spacing below it, so a click between two painted rows still hits one.
    let pitch = row_h + ui.spacing().item_spacing.y;
    let mut toggle: Option<PathBuf> = keys.toggle;
    let mut select: Option<PathBuf> = None;
    let mut take_focus = false;
    let mut event = keys.open.map(TreeEvent::Open);

    // Scroll the selected row into view: centered for "Select Opened File", by the least
    // distance for the arrow keys. The row can be missing while its folders still load.
    let scroll_mode = keys.select.as_ref().map(|_| ScrollMode::Nearest).or(state.tree.scroll_to);
    let target_path = keys.select.as_deref().or(state.tree.selected.as_deref());
    // Rows are exactly the viewport wide, so there is nothing to scroll sideways. A mouse drag
    // belongs to drag and drop, not to scrolling; the wheel and the trackpad still scroll.
    let mut area = ScrollArea::vertical().auto_shrink([false, false]).drag_to_scroll(false).id_salt("project-tree");
    let mut scroll_done = false;
    if let Some(mode) = scroll_mode {
        match target_path.and_then(|s| rows.iter().position(|r| r.entry.path == s)) {
            Some(i) => {
                let (top, view, off) = (i as f32 * pitch, ui.available_height(), state.tree.view_offset);
                let visible = top >= off && top + pitch <= off + view;
                let new = match mode {
                    _ if visible => None,
                    ScrollMode::Center => Some(top - view / 2.0 + pitch / 2.0),
                    ScrollMode::Nearest if top < off => Some(top),
                    ScrollMode::Nearest => Some(top + pitch - view),
                };
                if let Some(y) = new {
                    area = area.vertical_scroll_offset(y.max(0.0));
                }
                scroll_done = true;
            }
            // Nothing is loading any more, so the file is not in the tree (an ignored file).
            None if missing.is_empty() => scroll_done = true,
            None => {}
        }
    }
    let git = &state.git;
    let ops = &state.tree_ops;
    let tree = &state.tree;
    let mut menu_cmd: Option<(TreeCommand, Target)> = None;
    let selected = keys.select.as_deref().or(state.tree.selected.as_deref());
    ui.spacing_mut().item_spacing.y = 0.0;
    let (pointer, released, down, alt, now) = ui.input(|i| (i.pointer.latest_pos(), i.pointer.primary_released(), i.pointer.primary_down(), i.modifiers.alt, i.time));
    let dragging = state.tree.drag.clone();
    let mut drag_start: Option<TreeDrag> = None;
    // The folder a drop would go into, and its row rect when that row is drawn.
    let mut drop_target: Option<PathBuf> = None;
    let mut outline = Rect::NOTHING;
    let mut drag_refused = false;
    let mut drag_hover: Option<PathBuf> = None;
    let probe = state.test.as_ref().is_some_and(|t| t.tree_hits.is_some());
    let recording = state.input_log.is_some() && ui.input(|i| i.pointer.any_pressed() || i.pointer.any_released());
    let mut record: Option<String> = None;
    let mut hit_rows = Vec::new();
    let out = area.show_rows(ui, pitch, rows.len(), |ui, range| {
        // During a drag the row under the pointer decides the target before any row paints,
        // so the target folder row can show the outline wherever it is drawn.
        let target_dir = &mut drop_target;
        if let (Some(drag), Some(p)) = (&dragging, pointer) {
            let top = ui.cursor().min.y;
            let clip = ui.clip_rect();
            if clip.contains(p) && p.y >= top {
                let idx = range.start + ((p.y - top) / pitch) as usize;
                if let Some(r) = rows.get(idx).filter(|_| idx < range.end) {
                    match drop_dir(&drag.path, &r.entry.path, r.entry.is_dir) {
                        Some(dir) => *target_dir = Some(dir),
                        None => drag_refused = true,
                    }
                    if r.entry.is_dir && !r.expanded {
                        drag_hover = Some(r.entry.path.clone());
                    }
                }
            }
            // Near the top or bottom edge the tree scrolls, faster closer to the edge.
            if let Some(dy) = [(clip.min.y, -1.0), (clip.max.y, 1.0)].into_iter().find_map(|(edge, dir)| {
                let d = (p.y - edge).abs();
                (clip.x_range().contains(p.x) && d < DRAG_SCROLL_BAND).then_some(dir * (DRAG_SCROLL_BAND - d + 4.0) * 0.5)
            }) {
                ui.scroll_with_delta(vec2(0.0, -dy));
                ui.ctx().request_repaint();
            }
        }
        for row in &rows[range] {
            // The row id follows the path, not the row's position: an open context menu belongs
            // to its row and closes when that row is no longer drawn (`util::close_orphaned_context_menu`),
            // instead of moving to whatever row takes the position after a scroll or a reload.
            let (_, hit) = ui.allocate_space(vec2(ui.available_width(), pitch));
            let resp = ui.interact(hit, Id::new(("tree-row", &row.entry.path)), Sense::click_and_drag());
            let rect = Rect::from_min_size(hit.min, vec2(hit.width(), row_h));
            if probe {
                hit_rows.push(crate::testhook::tree_hits::HitRow { path: row.entry.path.clone(), is_dir: row.entry.is_dir, rect: hit, id: resp.id });
            }
            let rel = row.entry.path.strip_prefix(&root).unwrap_or(&row.entry.path);
            let is_selected = selected == Some(row.entry.path.as_path());
            crate::util::label_selectable(&resp, rel.display().to_string(), is_selected);
            // Children sit one indent right of the root's chevron.
            let x = rect.min.x + 4.0 + (row.depth + 1) as f32 * t.space.indent;
            let cy = rect.center().y;
            let chevron_c = pos2(x + 6.0, cy);
            // The chevron cell: one indent wide, the full row height, ending before the icon.
            // It is not a widget of its own: the row takes every click and checks the x, so the
            // row has no zone where a click or a double click lands on a different widget.
            let chevron_cell = row.entry.is_dir.then(|| Rect::from_min_max(pos2(x + 15.0 - t.space.indent, hit.min.y), pos2(x + 15.0, hit.max.y)));
            if let Some(cell) = chevron_cell {
                let r = ui.interact(cell, Id::new(("tree-chevron", &row.entry.path)), Sense::hover());
                crate::util::label_widget(&r, egui::WidgetType::Button, format!("{} {}", if row.expanded { "Collapse" } else { "Expand" }, rel.display()));
            }
            let painter = ui.painter();
            if is_selected {
                painter.rect_filled(rect, t.radius.row, if focused { t.tree_selection } else { t.tree_selection_inactive });
            } else if dragging.is_none() && ui.rect_contains_pointer(hit) {
                painter.rect_filled(rect, t.radius.row, t.tree_hover);
            }
            if target_dir.as_deref() == Some(row.entry.path.as_path()) {
                outline = rect;
            }
            // A press that moves a few points becomes a drag of this row.
            if dragging.is_none() && resp.dragged() {
                let moved = ui.input(|i| i.pointer.press_origin().zip(i.pointer.latest_pos()).is_some_and(|(a, b)| a.distance(b) >= DRAG_START_DIST));
                if moved {
                    drag_start = Some(TreeDrag { path: row.entry.path.clone(), is_dir: row.entry.is_dir, hover: None });
                }
            }
            if row.entry.is_dir {
                icons::tree_chevron(painter, chevron_c, row.expanded, t.tree_chevron);
            }
            let color = if ops.is_cut(&row.entry.path) {
                t.tree_cut
            } else if tree.is_excluded(&row.entry.path) {
                t.tree_excluded
            } else {
                name_color(git, &row.entry.path, row.entry.is_dir)
            };
            let icon_c = pos2(x + 22.0, cy);
            if row.entry.is_dir {
                icons::folder(painter, icon_c, 15.0);
            } else {
                icons::file(painter, icon_c, 14.0, &row.entry.name);
            }
            painter.text(pos2(x + 34.0, cy), egui::Align2::LEFT_CENTER, &row.entry.name, t.ui_font(), color);
            // Like IDEA: a press outside the chevron cell selects (egui reports no click for a
            // long press), a click on the chevron cell toggles at once, a double click anywhere
            // toggles a folder or opens a file. On the chevron cell the first click of a double
            // click already toggled, so the second one does nothing.
            let on_chevron = chevron_cell.zip(resp.interact_pointer_pos()).is_some_and(|(c, p)| c.contains(p));
            let double = clicks.double(&resp);
            if (resp.is_pointer_button_down_on() || resp.clicked()) && !on_chevron {
                select = Some(row.entry.path.clone());
            }
            if resp.clicked() {
                take_focus = true;
                if on_chevron && !double {
                    toggle = Some(row.entry.path.clone());
                }
            }
            if recording && (resp.contains_pointer() || resp.is_pointer_button_down_on() || resp.clicked()) {
                let name = row.entry.name.as_str();
                let (hovered, down_on, clicked, egui_double) = (resp.hovered(), resp.is_pointer_button_down_on(), resp.clicked(), crate::clicks::egui_double(&resp));
                record = Some(format!("row {name:?} hovered={hovered} down_on={down_on} clicked={clicked} press={} double={double} egui_double={egui_double} on_chevron={on_chevron} dragged={}", clicks.press_count(), resp.dragged()));
            }
            if double && !on_chevron {
                if row.entry.is_dir {
                    toggle = Some(row.entry.path.clone());
                } else {
                    event = Some(TreeEvent::Open(row.entry.path.clone()));
                }
            }
            // Right-click selects the row too, like IDEA.
            if resp.secondary_clicked() {
                select = Some(row.entry.path.clone());
                take_focus = true;
            }
            resp.context_menu(|ui| {
                let target = Target { path: row.entry.path.clone(), is_dir: row.entry.is_dir };
                let info = MenuInfo {
                    can_paste: ops.clip.is_some(),
                    excluded: tree.excluded.contains(&target.path),
                    has_changes: if target.is_dir { git.dirty_dirs.contains(&target.path) } else { git.status.get(&target.path).is_some_and(|k| *k != ChangeKind::Untracked) },
                    has_repo: git.repo.is_some(),
                };
                if let Some(cmd) = crate::tree_menu::menu(ui, &target, &info) {
                    menu_cmd = Some((cmd, target));
                }
            });
        }
    });
    state.tree.view_offset = out.state.offset.y;
    if let Some(log) = state.input_log.as_mut() {
        if recording {
            let hit = ui.ctx().viewport(|v| v.hits.click.map(|w| w.id));
            let toggled = toggle.as_ref().map(|p| p.display().to_string());
            log.tree(format_args!("{} hits.click={hit:?} select={:?} toggle={toggled:?}", record.as_deref().unwrap_or("no row under the pointer"), select.as_ref().and_then(|p| p.file_name())));
        }
    }
    if let Some(dir) = &drop_target {
        // The root row sits above the scroll area and a scrolled-out folder is not drawn:
        // those drops have no outline.
        if outline.is_positive() {
            ui.painter().with_clip_rect(out.inner_rect).rect_stroke(outline, t.radius.row, egui::Stroke::new(1.5_f32, t.drop_target_border), egui::StrokeKind::Inside);
        }
        // A hover-only node, so tests (and screen readers) see where a drop would land.
        let rel = dir.strip_prefix(&root).ok().filter(|r| !r.as_os_str().is_empty()).map_or(name.clone(), |r| r.display().to_string());
        let node = ui.interact(if outline.is_positive() { outline } else { Rect::from_min_size(out.inner_rect.min, vec2(0.0, 0.0)) }, Id::new("tree-drop-target"), Sense::hover());
        crate::util::label_widget(&node, egui::WidgetType::Other, format!("Drop target {rel}"));
    }
    let mut drop: Option<(PathBuf, PathBuf, bool)> = None;
    if let Some(start) = drag_start {
        state.tree.drag = Some(start);
    } else if let Some(drag) = state.tree.drag.as_mut() {
        if released || !down {
            if let Some(dir) = drop_target.take() {
                drop = Some((drag.path.clone(), dir, alt));
            }
            state.tree.drag = None;
        } else {
            // Hovering a collapsed folder expands it after a moment.
            match (&drag_hover, &drag.hover) {
                (Some(h), Some((p, since))) if h == p => {
                    if now - since >= DRAG_EXPAND_SECS {
                        state.tree.expanded.insert(h.clone());
                        drag.hover = None;
                    } else {
                        ui.ctx().request_repaint_after(std::time::Duration::from_secs_f64(DRAG_EXPAND_SECS - (now - since)));
                    }
                }
                (Some(h), _) => {
                    drag.hover = Some((h.clone(), now));
                    ui.ctx().request_repaint_after(std::time::Duration::from_secs_f64(DRAG_EXPAND_SECS));
                }
                (None, _) => drag.hover = None,
            }
            let refused = drag_refused || drop_target.is_none();
            ui.ctx().set_cursor_icon(if refused {
                egui::CursorIcon::NotAllowed
            } else if alt {
                egui::CursorIcon::Copy
            } else {
                egui::CursorIcon::Grabbing
            });
            if let Some(p) = pointer {
                drag_ghost(ui.ctx(), p, &drag.path);
            }
        }
    }
    if let Some(h) = state.test.as_mut().and_then(|t| t.tree_hits.as_mut()) {
        h.rows = hit_rows;
    }
    if scroll_done {
        state.tree.scroll_to = None;
    }
    // Keep the focus id alive, so the arrow keys keep working after a click.
    ui.interact(out.inner_rect, focus_id(), Sense::focusable_noninteractive());
    // egui drops the focus of a widget when a press lands outside it. The focus widget above
    // never counts as hovered, so a press on a row would drop the focus until the release, and
    // the selection would flash grey. Take the focus back on the press itself.
    let pressed_on_tree = ui.input(|i| if i.pointer.any_pressed() { i.pointer.press_origin() } else { None }).is_some_and(|p| out.inner_rect.contains(p) && ui.ctx().layer_id_at(p) == Some(ui.layer_id()));
    if take_focus || pressed_on_tree {
        ui.memory_mut(|m| m.request_focus(focus_id()));
    }
    if let Some(s) = select.or(keys.select) {
        state.tree.selected = Some(s);
    }
    if let Some(dir) = toggle {
        if !state.tree.expanded.remove(&dir) {
            state.tree.expanded.insert(dir);
        }
    }
    if keys.to_editor {
        if let Some(e) = state.tabs.active_editor_mut() {
            e.view.request_focus();
        } else {
            ui.memory_mut(|m| m.surrender_focus(focus_id()));
        }
    }
    for dir in missing {
        load_dir(state, dir);
    }
    if let Some((src, dir, copy)) = drop {
        crate::tree_menu::drop_into(state, src, dir, copy);
    }
    if let Some((cmd, target)) = menu_cmd.or(key_target) {
        crate::tree_menu::run(state, cmd, target);
        // The menu took the focus. Commands that open no dialog, search or terminal hand it
        // back; a dialog keeps it for its text box.
        let stays = matches!(
            cmd,
            TreeCommand::Cut | TreeCommand::Copy | TreeCommand::CancelCut | TreeCommand::Paste | TreeCommand::CopyAbsPath | TreeCommand::CopyProjectPath | TreeCommand::OpenInFinder | TreeCommand::ReloadFromDisk | TreeCommand::Exclude | TreeCommand::CancelExclusion | TreeCommand::GitHistory
        );
        if stays && state.tree_ops.dialog.is_none() {
            state.tree.focus_pending = true;
        }
    }
    event
}

/// The item name that follows the pointer during a drag.
fn drag_ghost(ctx: &egui::Context, pointer: egui::Pos2, path: &Path) {
    let t = &theme::T;
    let painter = ctx.layer_painter(egui::LayerId::new(egui::Order::Tooltip, Id::new("tree-drag-ghost")));
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let galley = painter.layout_no_wrap(name, t.ui_font(), t.text_bright);
    let rect = Rect::from_min_size(pointer + vec2(14.0, 10.0), galley.size() + vec2(16.0, 8.0));
    painter.rect(rect, t.radius.row, t.popup_bg, egui::Stroke::new(1.0_f32, t.popup_border), egui::StrokeKind::Inside);
    painter.galley(rect.min + vec2(8.0, 4.0), galley, t.text_bright);
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
