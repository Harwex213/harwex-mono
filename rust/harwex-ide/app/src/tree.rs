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
    let mut area = ScrollArea::both().auto_shrink([false, false]).id_salt("project-tree");
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
    let out = area.show_rows(ui, pitch, rows.len(), |ui, range| {
        for row in &rows[range] {
            let (hit, resp) = ui.allocate_exact_size(vec2(ui.available_width().max(260.0), pitch), Sense::click());
            let rect = Rect::from_min_size(hit.min, vec2(hit.width(), row_h));
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
            } else if ui.rect_contains_pointer(hit) {
                painter.rect_filled(rect, t.radius.row, t.tree_hover);
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
            if (resp.is_pointer_button_down_on() || resp.clicked()) && !on_chevron {
                select = Some(row.entry.path.clone());
            }
            if resp.clicked() {
                take_focus = true;
                if on_chevron && !resp.double_clicked() {
                    toggle = Some(row.entry.path.clone());
                }
            }
            if resp.double_clicked() && !on_chevron {
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
