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
    /// The lead row of the selection: the keyboard caret, and the one row of a single selection.
    pub selected: Option<PathBuf>,
    /// Every selected row in tree order while several are selected. It counts only while it
    /// holds `selected`, so code that sets `selected` alone gets a single selection.
    multi: Vec<PathBuf>,
    /// The fixed end of a Shift range (Shift+click, Shift+arrows).
    anchor: Option<PathBuf>,
    /// A plain press on a row of a multi-selection keeps the selection until the release (so a
    /// drag moves every selected row); the release without a drag selects only this row.
    press_pending: Option<PathBuf>,
    /// Set once, for the timings log.
    pub root_load_ms: Option<f64>,
    scroll_to: Option<ScrollMode>,
    /// The vertical scroll offset drawn last frame.
    view_offset: f32,
    /// The horizontal scroll offset drawn last frame.
    scroll_x: f32,
    /// The scroll content width: the widest row drawn since the row count last changed. It
    /// grows as wider rows scroll into view, so no frame measures every row of a big tree.
    content_w: f32,
    /// The row count `content_w` belongs to. An expand, a collapse or a reload starts it over.
    content_rows: usize,
    /// The content was wider than the viewport last frame (a horizontal scrollbar shows).
    h_overflow: bool,
    /// Give the tree keyboard focus the next time it is drawn.
    focus_pending: bool,
    /// Excluded folders (`[project] excluded`), absolute. Drawn dimmed with their content.
    pub excluded: Vec<PathBuf>,
    /// The row being dragged, while a drag runs.
    pub drag: Option<TreeDrag>,
}

/// A drag of tree rows (drag and drop to move, Alt to copy): the pressed row, or every
/// selected row when the pressed row is part of the selection.
#[derive(Clone, Debug)]
pub struct TreeDrag {
    pub paths: Vec<PathBuf>,
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

/// Where a drop of `srcs` onto a row lands: the row's folder, or the parent of a file row.
/// `None` when the drop is refused (one of the items itself or one of its descendants).
pub fn drop_dir(srcs: &[PathBuf], row: &Path, row_is_dir: bool) -> Option<PathBuf> {
    let dir = if row_is_dir { row.to_path_buf() } else { row.parent()?.to_path_buf() };
    (!srcs.iter().any(|s| dir.starts_with(s))).then_some(dir)
}

/// The paths an operation on several items acts on: no duplicates, and no item inside another
/// selected folder (the folder carries it along). The order stays.
pub fn top_level(paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for p in paths {
        if !paths.iter().any(|q| q != p && p.starts_with(q)) && !out.contains(p) {
            out.push(p.clone());
        }
    }
    out
}

/// The rows from `anchor` to `to`, both included, in tree order. Only `to` when the anchor is
/// not a visible row.
fn row_range(rows: &[Row], anchor: Option<&Path>, to: &Path) -> Vec<PathBuf> {
    let b = rows.iter().position(|r| r.entry.path == to);
    let a = anchor.and_then(|a| rows.iter().position(|r| r.entry.path == a)).or(b);
    match (a, b) {
        (Some(a), Some(b)) => rows[a.min(b)..=a.max(b)].iter().map(|r| r.entry.path.clone()).collect(),
        _ => vec![to.to_path_buf()],
    }
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

    /// The horizontal scroll offset drawn last frame.
    pub fn scroll_x(&self) -> f32 {
        self.scroll_x
    }

    /// Whether a row was wider than the viewport last frame, so the tree scrolls sideways.
    pub fn overflows(&self) -> bool {
        self.h_overflow
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
        for p in &mut self.multi {
            if let Some(m) = moved(p) {
                *p = m;
            }
        }
        if let Some(a) = self.anchor.as_ref().and_then(moved) {
            self.anchor = Some(a);
        }
        self.dirs.retain(|d, _| !d.starts_with(old));
    }

    /// Every selected path: the multi-selection, or the lead row alone.
    pub fn selection(&self) -> Vec<PathBuf> {
        match &self.selected {
            Some(lead) if self.multi.len() > 1 && self.multi.contains(lead) => self.multi.clone(),
            Some(lead) => vec![lead.clone()],
            None => Vec::new(),
        }
    }

    /// How many rows are selected.
    pub fn selection_len(&self) -> usize {
        match &self.selected {
            Some(lead) if self.multi.len() > 1 && self.multi.contains(lead) => self.multi.len(),
            Some(_) => 1,
            None => 0,
        }
    }

    pub fn is_selected(&self, path: &Path) -> bool {
        match &self.selected {
            Some(lead) if self.multi.len() > 1 && self.multi.contains(lead) => self.multi.iter().any(|p| p == path),
            Some(lead) => lead == path,
            None => false,
        }
    }

    /// Selects one row; it becomes the anchor of the next Shift range.
    pub fn select_one(&mut self, path: PathBuf) {
        self.multi.clear();
        self.anchor = Some(path.clone());
        self.selected = Some(path);
    }

    /// Selects `paths` (in tree order) with `lead` as the caret. Tests and Cmd+A use it.
    pub fn select_many(&mut self, paths: Vec<PathBuf>, lead: PathBuf) {
        if self.anchor.as_ref().is_none_or(|a| !paths.contains(a)) {
            self.anchor = Some(lead.clone());
        }
        self.multi = paths;
        if !self.multi.contains(&lead) {
            self.multi.push(lead.clone());
        }
        self.selected = Some(lead);
    }

    /// Cmd+click: adds the row to the selection or takes it out. The row becomes the anchor.
    pub fn toggle_selected(&mut self, path: PathBuf) {
        let mut cur = self.selection();
        if let Some(i) = cur.iter().position(|p| *p == path) {
            cur.remove(i);
            match cur.last().cloned() {
                Some(lead) => {
                    self.multi = cur;
                    self.selected = Some(lead);
                }
                None => {
                    self.multi.clear();
                    self.selected = None;
                }
            }
        } else {
            cur.push(path.clone());
            self.multi = cur;
            self.selected = Some(path.clone());
        }
        self.anchor = Some(path);
    }

    /// Drops `path` and everything under it from the selection (after a delete or a move away).
    pub fn deselect_under(&mut self, path: &Path) {
        self.multi.retain(|p| !p.starts_with(path));
        if self.selected.as_ref().is_some_and(|s| s.starts_with(path)) {
            self.selected = self.multi.last().cloned().or_else(|| path.parent().map(Path::to_path_buf));
        }
    }

    /// Whether a listed entry is a folder (`false` for paths the tree has not listed).
    pub fn entry_is_dir(&self, path: &Path) -> bool {
        path.parent().and_then(|p| self.dirs.get(p)).and_then(|entries| entries.iter().find(|e| e.path == path)).is_some_and(|e| e.is_dir)
    }

    /// The selected folder, or the folder of the selected file.
    pub fn selected_dir(&self) -> Option<PathBuf> {
        let sel = self.selected.as_ref()?;
        if self.entry_is_dir(sel) {
            Some(sel.clone())
        } else {
            sel.parent().map(Path::to_path_buf)
        }
    }

    pub fn is_excluded(&self, path: &Path) -> bool {
        self.excluded.iter().any(|e| path.starts_with(e))
    }

    /// Expands the parents of `path` up to `root`.
    pub fn expand_to(&mut self, root: &Path, path: &Path) {
        let mut p = path.parent();
        while let Some(dir) = p {
            if !dir.starts_with(root) {
                break;
            }
            self.expanded.insert(dir.to_path_buf());
            p = dir.parent();
        }
    }

    /// Selects a file and expands its parents, e.g. for "Select Opened File".
    pub fn reveal(&mut self, root: &Path, path: &Path) {
        self.expand_to(root, path);
        self.select_one(path.to_path_buf());
        self.scroll_to = Some(ScrollMode::Center);
    }
}

/// Starts loading `dir` on a worker unless it is already loading.
pub fn load_dir(state: &mut AppState, dir: PathBuf) {
    if !state.ws.tree.loading.insert(dir.clone()) {
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
            if state.ws.project.as_ref().is_some_and(|p| p.root == dir) && state.ws.tree.root_load_ms.is_none() {
                let ms = took.as_secs_f64() * 1000.0;
                state.ws.tree.root_load_ms = Some(ms);
                state.timings.log(format!("project tree root listed in {ms:.1} ms ({} entries)", entries.len()));
            }
            state.ws.tree.set_dir(dir, entries);
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

/// A row press, applied after the rows are drawn.
enum Press {
    One(PathBuf),
    Toggle(PathBuf),
    /// The range in tree order and the pressed row (the new lead).
    Range(Vec<PathBuf>, PathBuf),
    Pending(PathBuf),
}

pub enum TreeEvent {
    Open(PathBuf),
}

/// The focus id of the tree. The tree "has focus" (blue selection, arrow keys) while egui's
/// keyboard focus is on this id.
pub fn focus_id() -> Id {
    crate::workspace::wid("project-tree")
}

pub fn has_focus(ctx: &egui::Context) -> bool {
    ctx.memory(|m| m.has_focus(focus_id()))
}

/// "Select Opened File" (the header button, Alt+F1): expands the tree down to the active tab's
/// file, selects its row, scrolls it into view and gives the tree the focus.
pub fn select_opened_file(state: &mut AppState) {
    if let Some(file) = crate::breadcrumbs::active_file(state) {
        select_path(state, &file);
    }
}

/// Select In > Project View for any file or folder of the project: opens the Project window,
/// expands the parents, selects and scrolls to the row, and gives the tree the focus. The root
/// itself has no row; it only opens the window.
pub fn select_path(state: &mut AppState, path: &Path) {
    let Some(root) = state.ws.project.as_ref().map(|p| p.root.clone()) else { return };
    if !path.starts_with(&root) {
        return;
    }
    state.ws.layout.show(crate::layout::ToolWindow::Project);
    if path != root {
        state.ws.tree.reveal(&root, path);
    }
    state.ws.tree.focus_pending = true;
}

/// What the keyboard asked for this frame, applied after the rows are drawn.
#[derive(Default)]
struct KeyOutcome {
    select: Option<PathBuf>,
    /// Shift+arrows and Cmd+A: the new selection in tree order and its lead row.
    many: Option<(Vec<PathBuf>, PathBuf)>,
    toggle: Option<PathBuf>,
    open: Option<PathBuf>,
    to_editor: bool,
    command: Option<TreeCommand>,
}

/// The file operation keys while the tree (or a breadcrumb, `breadcrumbs::take_keys`) has focus. macOS turns ⌘X, ⌘C and ⌘V into Cut,
/// Copy and Paste events with no key event (⌘V only when the clipboard holds text), so both
/// forms count. ⇧⌘C arrives as a Copy event with Shift held.
pub fn command_keys(ctx: &egui::Context, cut_pending: bool) -> Option<TreeCommand> {
    use egui::Modifiers as M;
    ctx.input_mut(|i| {
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
fn keyboard(ui: &Ui, rows: &[Row], selected: Option<&Path>, anchor: Option<&Path>, cut_pending: bool) -> KeyOutcome {
    let mut out = KeyOutcome { command: command_keys(ui.ctx(), cut_pending), ..Default::default() };
    let none = egui::Modifiers::NONE;
    // Before the plain arrows: consume_key ignores an extra Shift.
    let (shift_up, shift_down, all) = ui.input_mut(|i| (i.consume_key(egui::Modifiers::SHIFT, Key::ArrowUp), i.consume_key(egui::Modifiers::SHIFT, Key::ArrowDown), i.consume_key(egui::Modifiers::COMMAND, Key::A)));
    if all && !rows.is_empty() {
        let lead = selected.filter(|s| rows.iter().any(|r| r.entry.path == *s)).map_or_else(|| rows[0].entry.path.clone(), Path::to_path_buf);
        out.many = Some((rows.iter().map(|r| r.entry.path.clone()).collect(), lead));
    }
    if shift_up || shift_down {
        let cur = selected.and_then(|s| rows.iter().position(|r| r.entry.path == s));
        let next = match cur {
            Some(i) if shift_up => i.checked_sub(1),
            Some(i) => (i + 1 < rows.len()).then_some(i + 1),
            None => (!rows.is_empty()).then_some(0),
        };
        if let Some(n) = next {
            let to = rows[n].entry.path.clone();
            let anchor = anchor.or(selected);
            out.many = Some((row_range(rows, anchor, &to), to));
        }
    }
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
    let Some(root) = state.ws.project.as_ref().map(|p| p.root.clone()) else {
        ui.label("No folder open");
        return None;
    };
    let t = &theme::T;
    let name = state.ws.project.as_ref().map(|p| p.name.clone()).unwrap_or_default();
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

    if std::mem::take(&mut state.ws.tree.focus_pending) {
        ui.memory_mut(|m| m.request_focus(focus_id()));
    }
    let focused = ui.memory(|m| m.has_focus(focus_id()));
    if focused {
        // The arrows and Escape belong to the tree, not to egui's focus navigation.
        ui.memory_mut(|m| m.set_focus_lock_filter(focus_id(), egui::EventFilter { tab: false, horizontal_arrows: true, vertical_arrows: true, escape: true }));
    }

    // Escape cancels a drag before the tree's keys see it.
    if state.ws.tree.drag.is_some() && ui.input_mut(|i| i.consume_key(egui::Modifiers::NONE, Key::Escape)) {
        state.ws.tree.drag = None;
    }
    // A double click is press 2 of the app's click chain (`clicks.rs`), not egui's count.
    let clicks = state.clicks;
    let mut rows = Vec::new();
    let mut missing = Vec::new();
    flatten(&state.ws.tree, &root, 0, &mut rows, &mut missing);
    // An open context menu needs Escape and the arrows itself.
    let menu_open = ui.ctx().is_context_menu_open();
    let keys = if focused && !menu_open { keyboard(ui, &rows, state.ws.tree.selected.as_deref(), state.ws.tree.anchor.as_deref(), state.ws.tree_ops.has_cut()) } else { KeyOutcome::default() };
    // A key command acts on the selected rows; the root when no visible row is selected.
    let key_target = keys.command.map(|c| {
        let sel = state.ws.tree.selection();
        let mut targets: Vec<Target> = rows.iter().filter(|r| sel.contains(&r.entry.path)).map(|r| Target { path: r.entry.path.clone(), is_dir: r.entry.is_dir }).collect();
        if targets.is_empty() {
            targets.push(Target { path: root.clone(), is_dir: true });
        }
        (c, targets)
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
    let key_lead = keys.select.as_deref().or(keys.many.as_ref().map(|m| m.1.as_path()));
    let scroll_mode = key_lead.map(|_| ScrollMode::Nearest).or(state.ws.tree.scroll_to);
    let target_path = key_lead.or(state.ws.tree.selected.as_deref());
    // Deep or long rows scroll sideways. A mouse drag belongs to drag and drop, not to
    // scrolling; the wheel and the trackpad still scroll.
    let mut area = ScrollArea::both().auto_shrink([false, false]).drag_to_scroll(false).id_salt("project-tree");
    // The viewport: rows take clicks and paint their highlight across its width only.
    let viewport = ui.available_rect_before_wrap();
    let mut scroll_done = false;
    if let Some(mode) = scroll_mode {
        match target_path.and_then(|s| rows.iter().position(|r| r.entry.path == s)) {
            Some(i) => {
                // Sideways, like IDEA: the start of the name comes into view, not its far end.
                // The row is drawn this frame, so the content is at least as wide as the row.
                let icon_x = icon_left(&rows[i]);
                let (off_x, view_w) = (state.ws.tree.scroll_x, viewport.width());
                if icon_x < off_x || icon_x + REVEAL_NAME_W > off_x + view_w {
                    let row_w = ui.fonts(|f| row_width(f, &rows[i]));
                    area = area.horizontal_scroll_offset((icon_x - t.space.indent).min(row_w - view_w).max(0.0));
                }
                let (top, view, off) = (i as f32 * pitch, ui.available_height(), state.ws.tree.view_offset);
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
    let git = &state.ws.git;
    let ops = &state.ws.tree_ops;
    let tree = &state.ws.tree;
    let mut menu_cmd: Option<(TreeCommand, Vec<Target>)> = None;
    let key_select = keys.select.as_deref();
    let sel_len = tree.selection_len();
    ui.spacing_mut().item_spacing.y = 0.0;
    let (pointer, released, down, alt, now, pressed, mods) = ui.input(|i| (i.pointer.latest_pos(), i.pointer.primary_released(), i.pointer.primary_down(), i.modifiers.alt, i.time, i.pointer.primary_pressed(), i.modifiers));
    // What a row press asks for, applied after the rows are drawn.
    let mut press: Option<Press> = None;
    let dragging = state.ws.tree.drag.clone();
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
    let mut content_w = if rows.len() == tree.content_rows { tree.content_w } else { 0.0 };
    let out = area.show_rows(ui, pitch, rows.len(), |ui, range| {
        // egui's clip margin would show the scrolled content in the island padding.
        let clip = ui.clip_rect();
        ui.set_clip_rect(Rect::from_x_y_ranges(clip.x_range().intersection(viewport.x_range()), clip.y_range()));
        // Only the drawn rows are measured; the width keeps the widest row seen so far.
        content_w = ui.fonts(|f| rows[range.clone()].iter().map(|r| row_width(f, r)).fold(content_w, f32::max));
        let row_w = ui.available_width().max(content_w);
        // During a drag the row under the pointer decides the target before any row paints,
        // so the target folder row can show the outline wherever it is drawn.
        let target_dir = &mut drop_target;
        if let (Some(drag), Some(p)) = (&dragging, pointer) {
            let top = ui.cursor().min.y;
            let clip = ui.clip_rect();
            if clip.contains(p) && p.y >= top {
                let idx = range.start + ((p.y - top) / pitch) as usize;
                if let Some(r) = rows.get(idx).filter(|_| idx < range.end) {
                    match drop_dir(&drag.paths, &r.entry.path, r.entry.is_dir) {
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
            // The row is as wide as the content, so it scrolls sideways; it takes clicks and
            // paints its highlight on the visible part only (`hit`, exactly the viewport wide).
            let (_, full) = ui.allocate_space(vec2(row_w, pitch));
            let hit = crate::git::branch_tree::visible_part(full, viewport);
            let resp = ui.interact(hit, crate::workspace::wid(("tree-row", &row.entry.path)), Sense::click_and_drag());
            let rect = Rect::from_min_size(hit.min, vec2(hit.width(), row_h));
            if probe {
                hit_rows.push(crate::testhook::tree_hits::HitRow { path: row.entry.path.clone(), is_dir: row.entry.is_dir, rect: hit, id: resp.id });
            }
            let rel = row.entry.path.strip_prefix(&root).unwrap_or(&row.entry.path);
            let is_selected = match key_select {
                Some(s) => s == row.entry.path,
                None => tree.is_selected(&row.entry.path),
            };
            crate::util::label_selectable(&resp, rel.display().to_string(), is_selected);
            // Children sit one indent right of the root's chevron. The indent, the icon and the
            // name scroll with the content; the highlight stays on the visible part.
            let x = full.min.x + 4.0 + (row.depth + 1) as f32 * t.space.indent;
            let cy = rect.center().y;
            let chevron_c = pos2(x + 6.0, cy);
            // The chevron cell: one indent wide, the full row height, ending before the icon.
            // It is not a widget of its own: the row takes every click and checks the x, so the
            // row has no zone where a click or a double click lands on a different widget.
            let chevron_cell = row.entry.is_dir.then(|| Rect::from_min_max(pos2(x + 15.0 - t.space.indent, hit.min.y), pos2(x + 15.0, hit.max.y)));
            if let Some(cell) = chevron_cell {
                let r = ui.interact(cell, crate::workspace::wid(("tree-chevron", &row.entry.path)), Sense::hover());
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
                    // A row of a multi-selection drags the whole selection.
                    let paths = if sel_len > 1 && tree.is_selected(&row.entry.path) { top_level(&tree.selection()) } else { vec![row.entry.path.clone()] };
                    drag_start = Some(TreeDrag { paths, hover: None });
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
            if pressed && (resp.is_pointer_button_down_on() || resp.clicked()) && !on_chevron {
                // Cmd toggles the row, Shift selects the range from the anchor, a plain press
                // on a row of a multi-selection waits for the release.
                press = Some(if mods.command {
                    Press::Toggle(row.entry.path.clone())
                } else if mods.shift {
                    Press::Range(row_range(&rows, tree.anchor.as_deref().or(tree.selected.as_deref()), &row.entry.path), row.entry.path.clone())
                } else if sel_len > 1 && tree.is_selected(&row.entry.path) {
                    Press::Pending(row.entry.path.clone())
                } else {
                    Press::One(row.entry.path.clone())
                });
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
            // Right-click selects the row too, like IDEA; on a row of a multi-selection it keeps
            // the selection, and the menu acts on all of it.
            let in_multi = sel_len > 1 && tree.is_selected(&row.entry.path);
            if resp.secondary_clicked() {
                if !in_multi {
                    select = Some(row.entry.path.clone());
                }
                take_focus = true;
            }
            resp.context_menu(|ui| {
                let targets: Vec<Target> = if in_multi {
                    tree.selection().into_iter().map(|p| Target { is_dir: tree.entry_is_dir(&p), path: p }).collect()
                } else {
                    vec![Target { path: row.entry.path.clone(), is_dir: row.entry.is_dir }]
                };
                let changed = |t: &Target| if t.is_dir { git.dirty_dirs.contains(&t.path) } else { git.status.get(&t.path).is_some_and(|k| *k != ChangeKind::Untracked) };
                let info = MenuInfo {
                    can_paste: ops.clip.is_some(),
                    excluded: tree.excluded.contains(&targets[0].path),
                    has_changes: targets.iter().any(changed),
                    has_repo: git.repo.is_some(),
                    count: targets.len(),
                };
                if let Some(cmd) = crate::tree_menu::menu(ui, &targets[0], &info) {
                    menu_cmd = Some((cmd, targets));
                }
            });
        }
    });
    let row_count = rows.len();
    state.ws.tree.view_offset = out.state.offset.y;
    state.ws.tree.scroll_x = out.state.offset.x;
    state.ws.tree.content_w = content_w;
    state.ws.tree.content_rows = row_count;
    state.ws.tree.h_overflow = out.content_size.x > out.inner_rect.width() + 0.5;
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
        let node = ui.interact(if outline.is_positive() { outline } else { Rect::from_min_size(out.inner_rect.min, vec2(0.0, 0.0)) }, crate::workspace::wid("tree-drop-target"), Sense::hover());
        crate::util::label_widget(&node, egui::WidgetType::Other, format!("Drop target {rel}"));
    }
    let mut drop: Option<(Vec<PathBuf>, PathBuf, bool)> = None;
    if let Some(start) = drag_start {
        state.ws.tree.drag = Some(start);
        state.ws.tree.press_pending = None;
    } else if let Some(drag) = state.ws.tree.drag.as_mut() {
        if released || !down {
            if let Some(dir) = drop_target.take() {
                drop = Some((drag.paths.clone(), dir, alt));
            }
            state.ws.tree.drag = None;
        } else {
            // Hovering a collapsed folder expands it after a moment.
            match (&drag_hover, &drag.hover) {
                (Some(h), Some((p, since))) if h == p => {
                    if now - since >= DRAG_EXPAND_SECS {
                        state.ws.tree.expanded.insert(h.clone());
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
                drag_ghost(ui.ctx(), p, &drag.paths);
            }
        }
    }
    if let Some(h) = state.test.as_mut().and_then(|t| t.tree_hits.as_mut()) {
        h.rows = hit_rows;
    }
    if scroll_done {
        state.ws.tree.scroll_to = None;
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
    let tree = &mut state.ws.tree;
    let pressed_row = press.is_some();
    match press {
        Some(Press::Toggle(p)) => tree.toggle_selected(p),
        Some(Press::Range(paths, lead)) => tree.select_many(paths, lead),
        Some(Press::Pending(p)) => {
            // The lead moves, the selection stays until the release.
            tree.selected = Some(p.clone());
            tree.press_pending = Some(p);
        }
        Some(Press::One(p)) => {
            tree.press_pending = None;
            tree.select_one(p);
        }
        None => {}
    }
    // A release ends a pending press; no drag started, so the row alone stays selected. egui
    // reports no click for a long press, so the release counts, not the click.
    if (released || !down) && !pressed_row {
        if let Some(p) = tree.press_pending.take() {
            if tree.drag.is_none() {
                tree.select_one(p);
            }
        }
    }
    if let Some(s) = select.or(keys.select) {
        tree.select_one(s);
    }
    if let Some((paths, lead)) = keys.many {
        tree.select_many(paths, lead);
    }
    if let Some(dir) = toggle {
        if !state.ws.tree.expanded.remove(&dir) {
            state.ws.tree.expanded.insert(dir);
        }
    }
    if keys.to_editor {
        if let Some(e) = state.ws.tabs.active_editor_mut() {
            e.view.request_focus();
        } else {
            ui.memory_mut(|m| m.surrender_focus(focus_id()));
        }
    }
    for dir in missing {
        load_dir(state, dir);
    }
    if let Some((srcs, dir, copy)) = drop {
        crate::tree_menu::drop_into(state, srcs, dir, copy);
    }
    if let Some((cmd, targets)) = menu_cmd.or(key_target) {
        crate::tree_menu::run(state, cmd, targets);
        // The menu took the focus. Commands that open no dialog, search or terminal hand it
        // back; a dialog keeps it for its text box.
        let stays = matches!(
            cmd,
            TreeCommand::Cut | TreeCommand::Copy | TreeCommand::CancelCut | TreeCommand::Paste | TreeCommand::CopyAbsPath | TreeCommand::CopyProjectPath | TreeCommand::OpenInFinder | TreeCommand::ReloadFromDisk | TreeCommand::Exclude | TreeCommand::CancelExclusion | TreeCommand::GitHistory
        );
        if stays && state.ws.tree_ops.dialog.is_none() {
            state.ws.tree.focus_pending = true;
        }
    }
    event
}

/// Revealing a row scrolls sideways unless at least this much of its name shows.
const REVEAL_NAME_W: f32 = 48.0;

/// The x of a row's icon, from the left edge of the scroll content.
fn icon_left(row: &Row) -> f32 {
    4.0 + (row.depth + 1) as f32 * theme::T.space.indent + 14.0
}

/// The width a row needs in the scroll content: indent, chevron, icon, name and a margin.
fn row_width(fonts: &egui::text::Fonts, row: &Row) -> f32 {
    let t = &theme::T;
    let name_w = fonts.layout_no_wrap(row.entry.name.clone(), t.ui_font(), t.text).size().x;
    4.0 + (row.depth + 1) as f32 * t.space.indent + 34.0 + name_w + 8.0
}

/// The item name ("N items" for several) that follows the pointer during a drag.
fn drag_ghost(ctx: &egui::Context, pointer: egui::Pos2, paths: &[PathBuf]) {
    let t = &theme::T;
    let painter = ctx.layer_painter(egui::LayerId::new(egui::Order::Tooltip, crate::workspace::wid("tree-drag-ghost")));
    let name = match paths {
        [one] => one.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        many => format!("{} items", many.len()),
    };
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
