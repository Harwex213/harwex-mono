//! Commit tool window: change tree with checkboxes, message, Amend, Commit / Commit and Push.
//!
//! The tree has IDEA's staging-area groups: Staged (HEAD vs index), Unstaged (index vs
//! worktree) and Unversioned Files. A partly staged file has a row in Staged and in Unstaged.
//! Rows drag between the groups: onto Staged stages, onto Unstaged unstages.
//!
//! The tree is flattened into rows once per status change (or collapse click), and only the
//! visible rows are drawn, so thousands of changed files cost the same per frame as ten.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::ops::Range;
use std::path::{Path, PathBuf};

use egui::{pos2, vec2, Align2, Context, CursorIcon, Key, LayerId, Modal, Modifiers, Order, Rect, RichText, ScrollArea, Sense, Shape, Stroke, Ui};
use ide_git::{ChangeKind, FileChange};

use crate::icons::CheckState;
use crate::state::AppState;
use crate::theme;
use crate::tree::change_color;

const ROW_H: f32 = 20.0;
const MESSAGE_ID: &str = "commit-message";

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Group {
    Staged,
    Unstaged,
    Unversioned,
}

impl Group {
    pub const ALL: [Group; 3] = [Group::Staged, Group::Unstaged, Group::Unversioned];

    pub fn title(self) -> &'static str {
        match self {
            Group::Staged => "Staged",
            Group::Unstaged => "Unstaged",
            Group::Unversioned => "Unversioned Files",
        }
    }

    /// Like IDEA: what is staged is meant to be committed; the rest waits for a tick.
    fn checked_by_default(self) -> bool {
        self == Group::Staged
    }

    /// The groups a status entry shows in. Conflicts stay in Unstaged: they are resolved
    /// through the merge tab, and staging marks them resolved.
    fn of(e: &FileChange) -> impl Iterator<Item = Group> {
        let untracked = e.is_untracked();
        let conflicted = e.kind() == ChangeKind::Conflicted;
        let staged = !untracked && !conflicted && e.staged.is_some();
        let unstaged = !untracked && (conflicted || e.unstaged.is_some());
        [(Group::Staged, staged), (Group::Unstaged, unstaged), (Group::Unversioned, untracked)].into_iter().filter(|(_, on)| *on).map(|(g, _)| g)
    }
}

/// A file row's identity: the same path can sit in Staged and in Unstaged.
type ItemKey = (PathBuf, Group);

/// One file in one group.
#[derive(Clone, Copy)]
struct Item {
    entry: usize,
    group: Group,
}

enum RowKind {
    Group,
    Dir(String),
    File(usize),
}

struct Row {
    kind: RowKind,
    group: Group,
    depth: u16,
    /// Collapse key: group name plus directory path.
    key: String,
    /// Range in `ChangesUi::order` covered by this row (one item for a file row).
    span: Range<usize>,
    collapsed: bool,
}

enum Confirm {
    Rollback(Vec<PathBuf>),
    Delete(Vec<PathBuf>),
}

/// Rows being dragged to another group.
struct Drag {
    items: Vec<ItemKey>,
    /// Which groups the items come from, so the per-frame drop check is O(1).
    from: [bool; 3],
}

#[derive(Default)]
pub struct ChangesUi {
    /// Current status entries, sorted by path.
    entries: Vec<FileChange>,
    /// Entries per group, in entry order. Rows index into this.
    items: Vec<Item>,
    /// Checkbox per item.
    checked: Vec<bool>,
    /// Checkbox state by item, so a refresh keeps what the user ticked.
    check_memory: HashMap<ItemKey, bool>,
    /// Item indices in display (depth-first) order; group and dir rows cover a contiguous span.
    order: Vec<usize>,
    /// Checked counts over `order`, for O(1) tri-state of a directory.
    prefix: Vec<u32>,
    /// Files with at least one checked row.
    checked_files: usize,
    rows: Vec<Row>,
    rows_dirty: bool,
    collapsed: HashSet<String>,
    selected: HashSet<ItemKey>,
    /// Last clicked row, the anchor for Shift+click.
    anchor: Option<usize>,
    drag: Option<Drag>,
    pub message: String,
    amend: bool,
    /// Message to put back when Amend is unticked; the amended message it replaced it with.
    amend_restore: Option<(String, String)>,
    committing: bool,
    confirm: Option<Confirm>,
    focus_message: bool,
}

impl ChangesUi {
    pub fn is_amend(&self) -> bool {
        self.amend
    }

    pub fn is_committing(&self) -> bool {
        self.committing
    }

    /// Paths selected in the tree (click, Cmd+click, Shift+click).
    pub fn selected_paths(&self) -> Vec<PathBuf> {
        let v: BTreeSet<PathBuf> = self.selected.iter().map(|(p, _)| p.clone()).collect();
        v.into_iter().collect()
    }

    pub fn has_confirm_dialog(&self) -> bool {
        self.confirm.is_some()
    }

    /// A drag of rows is in progress.
    pub fn is_dragging(&self) -> bool {
        self.drag.is_some()
    }

    /// Paths with a row in `group`, sorted.
    pub fn group_paths(&self, group: Group) -> Vec<PathBuf> {
        self.items.iter().filter(|it| it.group == group).map(|it| self.entries[it.entry].path.clone()).collect()
    }

    /// Whether the row of `path` in `group` is ticked (`None` when there is no such row).
    pub fn is_checked(&self, path: &Path, group: Group) -> Option<bool> {
        let entry = self.entries.binary_search_by(|e| e.path.as_path().cmp(path)).ok()?;
        self.item_of(entry, group).map(|i| self.checked[i])
    }

    /// The checkbox state and the muted count text ("2 files") of the group or directory row
    /// with the a11y label `label`, among the rows shown now.
    pub fn row_state(&self, label: &str) -> Option<(CheckState, String)> {
        let row = self.rows.iter().find(|r| !matches!(r.kind, RowKind::File(_)) && self.row_label(r) == label)?;
        Some((self.tri(&row.span), count_label(row.span.len())))
    }

    /// The item of `entry` in `group`. Items are in entry order, so this is a binary search.
    fn item_of(&self, entry: usize, group: Group) -> Option<usize> {
        let start = self.items.partition_point(|it| it.entry < entry);
        (start..self.items.len()).take_while(|&i| self.items[i].entry == entry).find(|&i| self.items[i].group == group)
    }

    fn key(&self, item: usize) -> ItemKey {
        let it = self.items[item];
        (self.entries[it.entry].path.clone(), it.group)
    }

    fn set_entries(&mut self, mut changes: Vec<FileChange>) {
        changes.sort_by(|a, b| a.path.cmp(&b.path));
        if changes == self.entries && !self.rows.is_empty() {
            return;
        }
        // Remember the current boxes before the items go away.
        for i in 0..self.items.len() {
            let c = self.checked[i];
            self.check_memory.insert(self.key(i), c);
        }
        self.items = changes.iter().enumerate().flat_map(|(entry, e)| Group::of(e).map(move |group| Item { entry, group })).collect();
        let present: HashSet<ItemKey> = self.items.iter().map(|it| (changes[it.entry].path.clone(), it.group)).collect();
        self.check_memory.retain(|k, _| present.contains(k));
        self.selected.retain(|k| present.contains(k));
        // A row new to its group starts with the group's default: newly staged files are ticked.
        self.checked = self.items.iter().map(|it| self.check_memory.get(&(changes[it.entry].path.clone(), it.group)).copied().unwrap_or(it.group.checked_by_default())).collect();
        self.entries = changes;
        self.rows_dirty = true;
    }

    fn rebuild(&mut self) {
        self.rows_dirty = false;
        self.rows.clear();
        self.order.clear();
        for group in Group::ALL {
            let files: Vec<usize> = (0..self.items.len()).filter(|&i| self.items[i].group == group).collect();
            // Staged and Unstaged stay visible while empty: each is a drop target.
            if files.is_empty() && (group == Group::Unversioned || self.items.is_empty()) {
                continue;
            }
            let mut root = DirNode::default();
            for i in files {
                let path = &self.entries[self.items[i].entry].path;
                let mut node = &mut root;
                if let Some(parent) = path.parent() {
                    for comp in parent.components() {
                        node = node.dirs.entry(comp.as_os_str().to_string_lossy().into_owned()).or_default();
                    }
                }
                node.files.push(i);
            }
            let key = group.title().to_string();
            let collapsed = self.collapsed.contains(&key);
            let row = self.rows.len();
            let start = self.order.len();
            self.rows.push(Row { kind: RowKind::Group, group, depth: 0, key: key.clone(), span: 0..0, collapsed });
            self.emit(&root, group, &key, 1, collapsed);
            self.rows[row].span = start..self.order.len();
        }
        self.recount();
    }

    /// Appends rows for `node`'s children. When `hidden`, files still go into `order` (so the
    /// collapsed parent's span and tri-state stay right) but no rows are added.
    fn emit(&mut self, node: &DirNode, group: Group, key: &str, depth: u16, hidden: bool) {
        for (name, child) in &node.dirs {
            // Compress chains of single-directory parents into "a/b/c", like IDEA.
            let mut label = name.clone();
            let mut child = child;
            while child.files.is_empty() && child.dirs.len() == 1 {
                let (n, c) = child.dirs.iter().next().expect("one child");
                label.push('/');
                label.push_str(n);
                child = c;
            }
            let child_key = format!("{key}/{label}");
            let collapsed = self.collapsed.contains(&child_key);
            let start = self.order.len();
            let row = if hidden {
                None
            } else {
                self.rows.push(Row { kind: RowKind::Dir(label), group, depth, key: child_key.clone(), span: 0..0, collapsed });
                Some(self.rows.len() - 1)
            };
            self.emit(child, group, &child_key, depth + 1, hidden || collapsed);
            if let Some(r) = row {
                self.rows[r].span = start..self.order.len();
            }
        }
        let mut files = node.files.clone();
        files.sort_by_cached_key(|&i| file_name(&self.entries[self.items[i].entry].path));
        for i in files {
            let at = self.order.len();
            self.order.push(i);
            if !hidden {
                self.rows.push(Row { kind: RowKind::File(i), group, depth, key: String::new(), span: at..at + 1, collapsed: false });
            }
        }
    }

    fn recount(&mut self) {
        self.prefix.clear();
        self.prefix.reserve(self.order.len() + 1);
        let mut n = 0u32;
        self.prefix.push(0);
        for &i in &self.order {
            n += u32::from(self.checked[i]);
            self.prefix.push(n);
        }
        let mut files = vec![false; self.entries.len()];
        for (it, &c) in self.items.iter().zip(&self.checked) {
            files[it.entry] |= c;
        }
        self.checked_files = files.iter().filter(|&&c| c).count();
    }

    fn tri(&self, span: &Range<usize>) -> CheckState {
        let (Some(a), Some(b)) = (self.prefix.get(span.start), self.prefix.get(span.end)) else { return CheckState::Unchecked };
        let n = (b - a) as usize;
        if n == 0 {
            CheckState::Unchecked
        } else if n == span.len() {
            CheckState::Checked
        } else {
            CheckState::Partial
        }
    }

    fn set_checked(&mut self, span: Range<usize>, on: bool) {
        for k in span {
            if let Some(&i) = self.order.get(k) {
                self.checked[i] = on;
            }
        }
        self.recount();
    }

    /// Paths with a ticked row, sorted.
    pub fn checked_paths(&self) -> Vec<PathBuf> {
        let v: BTreeSet<PathBuf> = self.items.iter().zip(&self.checked).filter(|(_, &c)| c).map(|(it, _)| self.entries[it.entry].path.clone()).collect();
        v.into_iter().collect()
    }

    /// What a commit takes: `(whole, staged_only)`. A ticked Unstaged or Unversioned row commits
    /// the worktree file. A ticked Staged row of a partly staged file commits its index version
    /// only, unless its Unstaged row is ticked too. A fully staged file is the same either way,
    /// so it goes the plain `--only` route.
    pub fn commit_selection(&self) -> (Vec<PathBuf>, Vec<PathBuf>) {
        let mut whole = BTreeSet::new();
        let mut staged = BTreeSet::new();
        for (it, &c) in self.items.iter().zip(&self.checked) {
            if c {
                let e = &self.entries[it.entry];
                if it.group == Group::Staged && e.unstaged.is_some() {
                    staged.insert(e.path.clone());
                } else {
                    whole.insert(e.path.clone());
                }
            }
        }
        let staged_only = staged.into_iter().filter(|p| !whole.contains(p)).collect();
        (whole.into_iter().collect(), staged_only)
    }

    fn entry(&self, path: &Path) -> Option<&FileChange> {
        self.entries.binary_search_by(|e| e.path.as_path().cmp(path)).ok().map(|i| &self.entries[i])
    }

    /// Items an action on `row` applies to: the selection if the row is part of it.
    fn target_items(&self, row: &Row) -> Vec<usize> {
        match row.kind {
            RowKind::File(i) => {
                if self.selected.len() > 1 && self.selected.contains(&self.key(i)) {
                    (0..self.items.len()).filter(|&j| self.selected.contains(&self.key(j))).collect()
                } else {
                    vec![i]
                }
            }
            _ => self.order[row.span.clone()].to_vec(),
        }
    }

    /// Paths of `items`, sorted and without repeats.
    fn paths_of(&self, items: &[usize]) -> Vec<PathBuf> {
        let v: BTreeSet<PathBuf> = items.iter().map(|&i| self.entries[self.items[i].entry].path.clone()).collect();
        v.into_iter().collect()
    }

    /// What a drop of the dragged rows onto `target` does: the paths to stage or unstage.
    /// Rows already in `target` are skipped, so a drop on their own group does nothing.
    fn drop_paths(&self, target: Group) -> Option<(DropOp, Vec<PathBuf>)> {
        if !self.can_drop(target) {
            return None;
        }
        let drag = self.drag.as_ref()?;
        let op = if target == Group::Staged { DropOp::Stage } else { DropOp::Unstage };
        let v: BTreeSet<PathBuf> = drag.items.iter().filter(|(_, g)| drop_source(target, *g)).map(|(p, _)| p.clone()).collect();
        Some((op, v.into_iter().collect()))
    }

    /// Whether a drop on `target` would stage or unstage something.
    fn can_drop(&self, target: Group) -> bool {
        self.drag.as_ref().is_some_and(|d| Group::ALL.iter().zip(d.from).any(|(&g, has)| has && drop_source(target, g)))
    }

    /// The a11y label of a row. Directory labels name their group, because the same directory
    /// can show in several groups. A file is its path; the Staged row of a partly staged file
    /// gets " in Staged", so both rows of that file have their own label.
    fn row_label(&self, row: &Row) -> String {
        match &row.kind {
            RowKind::Group => format!("{} group", row.group.title()),
            RowKind::Dir(_) => format!("Directory {} in {}", row.key.split_once('/').map_or(row.key.as_str(), |(_, d)| d), row.group.title()),
            RowKind::File(i) => {
                let e = &self.entries[self.items[*i].entry];
                if row.group == Group::Staged && self.is_partly_staged(e) {
                    format!("{} in Staged", e.path.display())
                } else {
                    e.path.display().to_string()
                }
            }
        }
    }

    fn is_partly_staged(&self, e: &FileChange) -> bool {
        Group::of(e).count() == 2
    }

    /// The hover text of a file row. For a partly staged file it says what a commit takes.
    fn file_tooltip(&self, item: usize) -> String {
        let e = &self.entries[self.items[item].entry];
        let path = e.path.display();
        if !self.is_partly_staged(e) {
            return path.to_string();
        }
        let ticked = |g: Group| self.item_of(self.items[item].entry, g).is_some_and(|i| self.checked[i]);
        let takes = if ticked(Group::Unstaged) {
            "Commit takes the whole file from disk"
        } else if ticked(Group::Staged) {
            "Commit takes the staged part only"
        } else {
            "Not in the commit"
        };
        format!("{path}\nPartly staged. {takes}.")
    }
}

/// Rows of `from` dropped on `target` change the index: onto Staged they are staged, onto
/// Unstaged a Staged row is unstaged. Everything else (the same group, Unversioned) does nothing.
fn drop_source(target: Group, from: Group) -> bool {
    match target {
        Group::Staged => from != Group::Staged,
        Group::Unstaged => from == Group::Staged,
        Group::Unversioned => false,
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum DropOp {
    Stage,
    Unstage,
}

#[derive(Default)]
struct DirNode {
    dirs: BTreeMap<String, DirNode>,
    files: Vec<usize>,
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default()
}

fn count_label(n: usize) -> String {
    format!("{n} file{}", if n == 1 { "" } else { "s" })
}

enum Event {
    Toggle(usize),
    Check(Range<usize>, bool),
    Select { row: usize, cmd: bool, shift: bool },
    SelectIfNot(usize),
    Diff(PathBuf),
    Jump(PathBuf),
    Rollback(Vec<PathBuf>),
    Delete(Vec<PathBuf>),
    Stage(Vec<PathBuf>),
    Unstage(Vec<PathBuf>),
    ExpandAll(bool),
    Refresh,
    DragStart(usize),
    Drop(Option<Group>),
}

pub fn tool_window(state: &mut AppState, ui: &mut Ui) {
    if state.ws.git.repo.is_none() {
        ui.label(RichText::new("The project is not under git.").color(theme::T.text_dim));
        return;
    }
    if state.ws.git_ui.changes.rows_dirty {
        state.ws.git_ui.changes.rebuild();
    }
    let mut events = Vec::new();
    let mut commit: Option<bool> = None;

    egui::TopBottomPanel::bottom(crate::workspace::wid("commit-message-panel"))
        .resizable(true)
        .default_height(170.0)
        .height_range(110.0..=500.0)
        .frame(egui::Frame::NONE.fill(theme::T.island_bg).inner_margin(egui::Margin::symmetric(0, 6)))
        .show_inside(ui, |ui| {
            commit = message_area(state, ui);
        });

    let clicks = state.clicks;
    let c = &state.ws.git_ui.changes;
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = 2.0;
        use crate::icons::Icon;
        use crate::layout::{icon_button, icon_button_enabled};
        if icon_button(ui, Icon::Refresh, "Refresh", "Refresh").clicked() {
            events.push(Event::Refresh);
        }
        let sel = c.selected_paths();
        let has_sel = !sel.is_empty();
        if icon_button_enabled(ui, has_sel, Icon::Rollback, "Rollback", "Rollback selected files").clicked() {
            events.push(Event::Rollback(sel.iter().filter(|p| c.entry(p).is_some_and(|e| !e.is_untracked())).cloned().collect()));
        }
        if icon_button_enabled(ui, sel.len() == 1, Icon::Diff, "Diff", "Show Diff").clicked() {
            events.push(Event::Diff(sel[0].clone()));
        }
        ui.add_space(6.0);
        if icon_button(ui, Icon::ExpandAll, "Expand All", "Expand All").clicked() {
            events.push(Event::ExpandAll(true));
        }
        if icon_button(ui, Icon::CollapseAll, "Collapse All", "Collapse All").clicked() {
            events.push(Event::ExpandAll(false));
        }
        ui.add_space(6.0);
        ui.label(RichText::new(format!("{} of {} selected", c.checked_files, c.entries.len())).size(theme::T.font.tiny).color(theme::T.text_dim));
    });

    if c.entries.is_empty() {
        ui.add_space(20.0);
        ui.vertical_centered(|ui| ui.label(RichText::new("No changes").color(theme::T.text_dim)));
    } else {
        draw_tree(c, clicks, ui, &mut events);
    }

    for e in events {
        handle(state, e);
    }
    if let Some(push) = commit {
        start_commit(state, push);
    }
}

fn draw_tree(c: &ChangesUi, clicks: crate::clicks::Clicks, ui: &mut Ui, events: &mut Vec<Event>) {
    let (cmd, shift, pointer, released, down) = ui.input(|i| (i.modifiers.command, i.modifiers.shift, i.pointer.latest_pos(), i.pointer.primary_released(), i.pointer.primary_down()));
    let dragging = c.drag.is_some();
    let mut target: Option<Group> = None;
    ScrollArea::both().auto_shrink([false, false]).drag_to_scroll(false).id_salt("changes-tree").show_rows(ui, ROW_H, c.rows.len(), |ui, range| {
        let width = ui.available_width().max(240.0);
        let clip = ui.clip_rect();
        // The drop target is the group of the row under the pointer, found before the rows
        // are painted so all of them can show the highlight.
        if dragging {
            let pitch = ROW_H + ui.spacing().item_spacing.y;
            let top = ui.cursor().min.y;
            if let Some(p) = pointer.filter(|p| clip.contains(*p) && p.y >= top) {
                let idx = range.start + ((p.y - top) / pitch) as usize;
                target = c.rows.get(idx).map(|r| r.group).filter(|&g| c.can_drop(g));
            }
        }
        let mut target_rect = Rect::NOTHING;
        // One fill under all target rows, so the spacing between them is covered too.
        let target_bg = ui.painter().add(Shape::Noop);
        for idx in range {
            let row = &c.rows[idx];
            let (rect, resp) = ui.allocate_exact_size(vec2(width, ROW_H), Sense::click_and_drag());
            let painter = ui.painter();
            let is_sel = matches!(row.kind, RowKind::File(i) if c.selected.contains(&c.key(i)));
            if target == Some(row.group) {
                target_rect = target_rect.union(rect);
            } else if is_sel {
                painter.rect_filled(rect, 0.0, theme::T.selection_inactive);
            } else if resp.hovered() && !dragging {
                painter.rect_filled(rect, 0.0, theme::T.hover);
            }
            let cy = rect.center().y;
            let mut x = rect.min.x + 4.0 + f32::from(row.depth) * 14.0;
            // An empty group (Staged or Unstaged, kept as a drop target) has no arrow and no box.
            let empty = row.span.is_empty();
            let has_arrow = !matches!(row.kind, RowKind::File(_)) && !empty;
            let arrow = Rect::from_min_size(pos2(x, rect.min.y), vec2(12.0, ROW_H));
            if has_arrow {
                let pts = if row.collapsed {
                    vec![pos2(x + 2.0, cy - 4.0), pos2(x + 7.0, cy), pos2(x + 2.0, cy + 4.0)]
                } else {
                    vec![pos2(x, cy - 2.0), pos2(x + 8.0, cy - 2.0), pos2(x + 4.0, cy + 3.0)]
                };
                painter.add(Shape::convex_polygon(pts, theme::T.text_dim, Stroke::NONE));
            }
            x += 14.0;
            let tri = c.tri(&row.span);
            let check = Rect::from_center_size(pos2(x + theme::CHECKBOX_SIZE / 2.0, cy), vec2(theme::CHECKBOX_SIZE, theme::CHECKBOX_SIZE));
            // The box is its own widget on top of the row, so it has an accessibility node and
            // takes the click before the row does.
            let name = c.row_label(row);
            crate::util::label_selectable(&resp, name.clone(), is_sel);
            if !empty {
                let check_resp = ui.interact(check.expand(2.0), resp.id.with("check"), Sense::click());
                check_resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::Checkbox, true, tri == CheckState::Checked, format!("Include {name}")));
                if check_resp.clicked() {
                    events.push(Event::Check(row.span.clone(), tri != CheckState::Checked));
                }
                crate::icons::checkbox(painter, check, tri, check_resp.hovered() && !dragging);
            }
            x += theme::CHECKBOX_SIZE + 6.0;
            let font = theme::T.ui_font();
            match &row.kind {
                RowKind::Group => {
                    let galley = painter.layout_no_wrap(row.group.title().to_string(), font.clone(), theme::T.text_bright);
                    let w = galley.size().x;
                    painter.galley(pos2(x, cy - galley.size().y / 2.0), galley, theme::T.text_bright);
                    if !empty {
                        painter.text(pos2(x + w + 8.0, cy), Align2::LEFT_CENTER, count_label(row.span.len()), theme::T.tiny_font(), theme::T.text_dim);
                    }
                }
                RowKind::Dir(name) => {
                    crate::icons::folder(painter, pos2(x + 7.0, cy), 14.0);
                    x += 18.0;
                    let galley = painter.layout_no_wrap(name.clone(), font.clone(), theme::T.text);
                    let w = galley.size().x;
                    painter.galley(pos2(x, cy - galley.size().y / 2.0), galley, theme::T.text);
                    painter.text(pos2(x + w + 8.0, cy), Align2::LEFT_CENTER, count_label(row.span.len()), theme::T.tiny_font(), theme::T.text_dim);
                }
                RowKind::File(i) => {
                    let e = &c.entries[c.items[*i].entry];
                    // Each group colors the file by its own side of the change.
                    let kind = match row.group {
                        Group::Staged => e.staged.unwrap_or(e.kind()),
                        Group::Unstaged => e.unstaged.unwrap_or(e.kind()),
                        Group::Unversioned => ChangeKind::Untracked,
                    };
                    let color = change_color(kind);
                    let name = e.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                    let galley = painter.layout_no_wrap(name, font.clone(), color);
                    let w = galley.size().x;
                    painter.galley(pos2(x, cy - galley.size().y / 2.0), galley, color);
                    let extra = match (&e.old_path, kind) {
                        (Some(old), _) if row.group == Group::Staged => Some(format!("from {}", old.display())),
                        (_, ChangeKind::Deleted) => Some("deleted".into()),
                        _ => None,
                    };
                    if let Some(extra) = extra {
                        painter.text(pos2(x + w + 8.0, cy), Align2::LEFT_CENTER, extra, theme::T.tiny_font(), theme::T.text_dim);
                    }
                }
            }

            if resp.drag_started() {
                events.push(Event::DragStart(idx));
            }
            let resp = match &row.kind {
                RowKind::File(i) if !dragging => resp.on_hover_ui_at_pointer(|ui| {
                    ui.label(c.file_tooltip(*i));
                }),
                _ => resp,
            };
            if resp.clicked() {
                let p = resp.interact_pointer_pos().unwrap_or_default();
                if !empty && check.expand(2.0).contains(p) {
                    events.push(Event::Check(row.span.clone(), tri != CheckState::Checked));
                } else if has_arrow && arrow.expand(2.0).contains(p) {
                    events.push(Event::Toggle(idx));
                } else {
                    events.push(Event::Select { row: idx, cmd, shift });
                    // A double click on the box or the arrow already acted twice; only the
                    // rest of the row opens a diff or toggles.
                    if clicks.double(&resp) {
                        match &row.kind {
                            RowKind::File(i) => events.push(Event::Diff(c.entries[c.items[*i].entry].path.clone())),
                            _ => events.push(Event::Toggle(idx)),
                        }
                    }
                }
            }
            if resp.secondary_clicked() {
                events.push(Event::SelectIfNot(idx));
            }
            resp.context_menu(|ui| context_menu(c, row, ui, events));
        }
        if let Some(g) = target.filter(|_| target_rect.is_positive()) {
            ui.painter().set(target_bg, egui::epaint::RectShape::filled(target_rect, theme::T.radius.small, theme::T.drop_target_bg));
            ui.painter().rect_stroke(target_rect, theme::T.radius.small, Stroke::new(1.0_f32, theme::T.drop_target_border), egui::StrokeKind::Inside);
            // A hover-only node, so tests (and screen readers) see where a drop would land.
            let r = ui.interact(target_rect, crate::workspace::wid("changes-drop-target"), Sense::hover());
            r.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Other, true, format!("Drop target {}", g.title())));
        }
    });
    if let Some(drag) = &c.drag {
        if released || !down {
            events.push(Event::Drop(target));
        } else {
            ui.ctx().set_cursor_icon(CursorIcon::Grabbing);
            if let Some(p) = pointer {
                drag_ghost(ui.ctx(), p, drag.items.len());
            }
        }
    }
}

/// The count label that follows the pointer during a drag ("3 files").
fn drag_ghost(ctx: &Context, pointer: egui::Pos2, n: usize) {
    let painter = ctx.layer_painter(LayerId::new(Order::Tooltip, crate::workspace::wid("changes-drag-ghost")));
    let galley = painter.layout_no_wrap(count_label(n), theme::T.ui_font(), theme::T.text_bright);
    let rect = Rect::from_min_size(pointer + vec2(14.0, 10.0), galley.size() + vec2(16.0, 8.0));
    painter.rect(rect, theme::T.radius.row, theme::T.popup_bg, Stroke::new(1.0_f32, theme::T.popup_border), egui::StrokeKind::Inside);
    painter.galley(rect.min + vec2(8.0, 4.0), galley, theme::T.text_bright);
}

fn context_menu(c: &ChangesUi, row: &Row, ui: &mut Ui, events: &mut Vec<Event>) {
    ui.set_min_width(180.0);
    let items = c.target_items(row);
    let targets = c.paths_of(&items);
    let entries: Vec<&FileChange> = targets.iter().filter_map(|p| c.entry(p)).collect();
    let single = match row.kind {
        RowKind::File(_) if targets.len() == 1 => Some(targets[0].clone()),
        _ => None,
    };
    if ui.add_enabled(single.is_some(), egui::Button::new("Show Diff")).clicked() {
        if let Some(p) = &single {
            events.push(Event::Diff(p.clone()));
        }
        ui.close_menu();
    }
    let jump_ok = single.as_ref().is_some_and(|p| c.entry(p).is_some_and(|e| e.kind() != ChangeKind::Deleted));
    if ui.add_enabled(jump_ok, egui::Button::new("Jump to Source")).clicked() {
        if let Some(p) = &single {
            events.push(Event::Jump(p.clone()));
        }
        ui.close_menu();
    }
    ui.separator();
    let tracked: Vec<PathBuf> = entries.iter().filter(|e| !e.is_untracked()).map(|e| e.path.clone()).collect();
    if ui.add_enabled(!tracked.is_empty(), egui::Button::new("Rollback...")).clicked() {
        events.push(Event::Rollback(tracked));
        ui.close_menu();
    }
    let stageable: Vec<PathBuf> = entries.iter().filter(|e| e.unstaged.is_some()).map(|e| e.path.clone()).collect();
    let unstageable: Vec<PathBuf> = entries.iter().filter(|e| e.staged.is_some()).map(|e| e.path.clone()).collect();
    if ui.add_enabled(!stageable.is_empty(), egui::Button::new("Stage (git add)")).clicked() {
        events.push(Event::Stage(stageable));
        ui.close_menu();
    }
    if ui.add_enabled(!unstageable.is_empty(), egui::Button::new("Unstage")).clicked() {
        events.push(Event::Unstage(unstageable));
        ui.close_menu();
    }
    ui.separator();
    let deletable: Vec<PathBuf> = entries.iter().filter(|e| e.kind() != ChangeKind::Deleted).map(|e| e.path.clone()).collect();
    if ui.add_enabled(!deletable.is_empty(), egui::Button::new("Delete...")).clicked() {
        events.push(Event::Delete(deletable));
        ui.close_menu();
    }
}

/// The message box, Amend and the commit buttons. Returns `Some(push)` when a button was hit.
///
/// The content must fill the panel exactly. `TopBottomPanel` stores its content height as the
/// panel height every frame, so a box sized from a guessed button height made the panel shrink
/// by the difference on every repaint (and undid the user's resize). So the buttons go in first
/// at the bottom, and the box takes exactly the height that is left.
fn message_area(state: &mut AppState, ui: &mut Ui) -> Option<bool> {
    let c = &mut state.ws.git_ui.changes;
    let mut out = None;
    let mut amend_changed = false;
    ui.horizontal(|ui| {
        if ui.checkbox(&mut c.amend, "Amend").on_hover_text("Amend the last commit; fills in its message").changed() {
            amend_changed = true;
        }
    });
    let id = crate::workspace::wid(MESSAGE_ID);
    let can_commit = |c: &ChangesUi| !c.committing && !c.message.trim().is_empty() && (c.prefix.last().copied().unwrap_or(0) > 0 || c.amend);
    ui.with_layout(egui::Layout::bottom_up(egui::Align::Min), |ui| {
        let checked = c.prefix.last().copied().unwrap_or(0);
        let can = can_commit(c);
        // Not `ui.horizontal`: its row starts at `interact_size.y`, and the taller buttons would
        // grow down past the panel edge. Bottom-aligned items grow upwards.
        ui.with_layout(egui::Layout::left_to_right(egui::Align::Max), |ui| {
            let label = if c.amend { "Amend Commit" } else { "Commit" };
            let hint = if c.message.trim().is_empty() { "Enter a commit message" } else if checked == 0 && !c.amend { "Select files to commit" } else { "⌘⏎" };
            if ui.add_enabled(can, egui::Button::new(RichText::new(label).color(theme::T.on_accent)).fill(theme::T.accent)).on_disabled_hover_text(hint).clicked() {
                out = Some(false);
            }
            if ui.add_enabled(can, egui::Button::new(if c.amend { "Amend Commit and Push..." } else { "Commit and Push..." })).on_disabled_hover_text(hint).clicked() {
                out = Some(true);
            }
            if c.committing {
                ui.add(egui::Spinner::new().size(theme::T.font.hint));
            }
        });
        ui.add_space(4.0);
        ui.allocate_ui_with_layout(ui.available_size(), egui::Layout::top_down(egui::Align::Min), |ui| {
            let edit_h = ui.available_height().max(40.0);
            ScrollArea::vertical().id_salt("commit-message-scroll").max_height(edit_h).auto_shrink([false, true]).show(ui, |ui| {
                let r = ui.add_sized(
                    vec2(ui.available_width(), edit_h),
                    egui::TextEdit::multiline(&mut c.message).id(id).hint_text("Commit Message").font(egui::TextStyle::Monospace).desired_width(f32::INFINITY),
                );
                if std::mem::take(&mut c.focus_message) {
                    r.request_focus();
                }
                // The buttons above were drawn from the old text; one more frame shows the new state.
                if r.changed() {
                    ui.ctx().request_repaint();
                }
                // Cmd+Enter commits, like IDEA.
                if r.has_focus() && ui.input_mut(|i| i.consume_key(Modifiers::COMMAND, Key::Enter)) {
                    out = Some(false);
                }
            });
        });
    });
    // Checked against the text as it is now, after this frame's typing.
    let can = can_commit(c);
    if amend_changed {
        toggle_amend(state);
    }
    if out.is_some() && !can {
        out = None;
    }
    out
}

fn toggle_amend(state: &mut AppState) {
    let c = &mut state.ws.git_ui.changes;
    if !c.amend {
        // Put the user's own draft back if the amended message was not edited.
        if let Some((draft, amended)) = c.amend_restore.take() {
            if c.message == amended {
                c.message = draft;
            }
        }
        return;
    }
    let Some(repo) = state.ws.git.repo.clone() else { return };
    state.jobs.spawn_quiet(
        move || repo.last_commit_message(),
        |state, res| {
            let c = &mut state.ws.git_ui.changes;
            if !c.amend {
                return;
            }
            match res {
                Ok(msg) => {
                    let msg = msg.trim_end().to_string();
                    let draft = std::mem::replace(&mut c.message, msg.clone());
                    c.amend_restore = Some((draft, msg));
                }
                Err(e) => state.notifications.warn("Cannot read the last commit message", e.to_string()),
            }
        },
    );
}

fn handle(state: &mut AppState, e: Event) {
    let Some(workdir) = state.ws.git.repo.as_ref().map(|r| r.workdir().to_path_buf()) else { return };
    let c = &mut state.ws.git_ui.changes;
    match e {
        Event::Toggle(row) => {
            if let Some(r) = c.rows.get(row) {
                if !c.collapsed.remove(&r.key) {
                    c.collapsed.insert(r.key.clone());
                }
                c.rows_dirty = true;
            }
        }
        Event::Check(span, on) => c.set_checked(span, on),
        Event::Select { row, cmd, shift } => select(c, row, cmd, shift),
        Event::SelectIfNot(row) => {
            if let Some(RowKind::File(i)) = c.rows.get(row).map(|r| &r.kind) {
                let k = c.key(*i);
                if !c.selected.contains(&k) {
                    c.selected.clear();
                    c.selected.insert(k);
                    c.anchor = Some(row);
                }
            }
        }
        Event::Diff(p) => super::diff::open_worktree_diff(state, &workdir.join(p)),
        Event::Jump(p) => state.open_location(&workdir.join(p), None, true),
        Event::Rollback(paths) if !paths.is_empty() => c.confirm = Some(Confirm::Rollback(paths)),
        Event::Delete(paths) if !paths.is_empty() => c.confirm = Some(Confirm::Delete(paths)),
        Event::Rollback(_) | Event::Delete(_) => {}
        Event::Stage(paths) => stage_op(state, DropOp::Stage, paths),
        Event::Unstage(paths) => stage_op(state, DropOp::Unstage, paths),
        Event::ExpandAll(expand) => {
            if expand {
                c.collapsed.clear();
            } else {
                c.collapsed = c.rows.iter().filter(|r| !matches!(r.kind, RowKind::File(_))).map(|r| r.key.clone()).collect();
                // Groups stay open so the directories are still visible.
                c.collapsed.retain(|k| k.contains('/'));
            }
            c.rows_dirty = true;
        }
        Event::Refresh => state.refresh_git(),
        Event::DragStart(row) => {
            let Some(r) = c.rows.get(row) else { return };
            // Like IDEA: a drag on a row outside the selection drags that row alone.
            if let RowKind::File(i) = r.kind {
                let k = c.key(i);
                if !c.selected.contains(&k) {
                    c.selected.clear();
                    c.selected.insert(k);
                    c.anchor = Some(row);
                }
            }
            let items: Vec<ItemKey> = c.target_items(r).into_iter().map(|i| c.key(i)).collect();
            let from = Group::ALL.map(|g| items.iter().any(|(_, ig)| *ig == g));
            c.drag = Some(Drag { items, from });
        }
        Event::Drop(target) => {
            let op = target.and_then(|g| c.drop_paths(g));
            c.drag = None;
            if let Some((op, paths)) = op {
                if op == DropOp::Stage {
                    // A file that already had a Staged row keeps that row's box; it becomes
                    // ticked too, like every newly staged file.
                    for i in 0..c.items.len() {
                        if c.items[i].group == Group::Staged && paths.binary_search(&c.entries[c.items[i].entry].path).is_ok() {
                            c.checked[i] = true;
                        }
                    }
                    c.recount();
                }
                stage_op(state, op, paths);
            }
        }
    }
}

/// Stage or Unstage on a worker through `run_op`, which refreshes git state afterwards.
fn stage_op(state: &mut AppState, op: DropOp, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    let n = count_label(paths.len());
    let (title, body) = match op {
        DropOp::Stage => ("Stage", format!("{n} staged")),
        DropOp::Unstage => ("Unstage", format!("{n} unstaged")),
    };
    super::remote::run_op(
        state,
        title,
        body,
        false,
        move |repo| {
            match op {
                DropOp::Stage => repo.stage(&paths)?,
                DropOp::Unstage => repo.unstage(&paths)?,
            }
            Ok(None)
        },
        |_, _| {},
    );
}

fn select(c: &mut ChangesUi, row: usize, cmd: bool, shift: bool) {
    let path_of = |c: &ChangesUi, r: usize| match c.rows.get(r).map(|r| &r.kind) {
        Some(RowKind::File(i)) => Some(c.key(*i)),
        _ => None,
    };
    if shift {
        if let Some(a) = c.anchor {
            let (lo, hi) = if a <= row { (a, row) } else { (row, a) };
            if !cmd {
                c.selected.clear();
            }
            for r in lo..=hi {
                if let Some(p) = path_of(c, r) {
                    c.selected.insert(p);
                }
            }
            return;
        }
    }
    c.anchor = Some(row);
    let Some(p) = path_of(c, row) else {
        if !cmd {
            c.selected.clear();
        }
        return;
    };
    if cmd {
        if !c.selected.remove(&p) {
            c.selected.insert(p);
        }
    } else {
        c.selected.clear();
        c.selected.insert(p);
    }
}

/// Runs a git write on a worker, toasts a failure with its stderr and refreshes status.
fn git_write(state: &mut AppState, label: &str, work: impl FnOnce(&ide_git::Repo) -> ide_git::Result<()> + Send + 'static) {
    let Some(repo) = state.ws.git.repo.clone() else { return };
    let title = format!("{label} failed");
    state.jobs.spawn(
        label,
        move || work(&repo),
        move |state, res| {
            if let Err(e) = res {
                state.notifications.error(title, e.to_string());
            }
            state.refresh_git();
        },
    );
}

fn start_commit(state: &mut AppState, push: bool) {
    let Some(repo) = state.ws.git.repo.clone() else { return };
    let c = &mut state.ws.git_ui.changes;
    if c.committing {
        return;
    }
    let (paths, staged_only) = c.commit_selection();
    let message = c.message.trim_end().to_string();
    let amend = c.amend;
    if message.trim().is_empty() || (paths.is_empty() && staged_only.is_empty() && !amend) {
        return;
    }
    c.committing = true;
    // IDEA saves every document before a commit. The texts are written by the commit worker
    // itself, so git sees them before it runs and the UI thread never touches the disk.
    let mut saves = Vec::new();
    for (id, e) in state.ws.tabs.editors_mut() {
        if e.doc.is_dirty() && !e.read_only && !e.saving {
            let (text, token) = e.doc.save_snapshot();
            saves.push((id, e.path.clone(), text, token));
        }
    }
    let n = paths.len() + staged_only.len();
    state.jobs.spawn(
        if amend { "Amending commit" } else { "Committing" },
        move || {
            let mut saved = Vec::new();
            for (id, path, text, token) in saves {
                if std::fs::write(&path, text).is_ok() {
                    saved.push((id, token));
                }
            }
            (saved, repo.commit_selection(&message, &paths, &staged_only, amend), message)
        },
        move |state, (saved, res, message)| {
            for (id, token) in saved {
                if let Some(e) = state.ws.tabs.editor_mut(id) {
                    e.doc.mark_saved(token);
                }
            }
            state.ws.git_ui.changes.committing = false;
            let subject = message.lines().next().unwrap_or_default().to_string();
            match res {
                Ok(outcome) if outcome.success() => {
                    let hash = outcome.oid.map(|o| o.to_string()[..8].to_string()).unwrap_or_default();
                    let what = if n == 0 { "Amended the commit message".to_string() } else { format!("{n} file{} committed", if n == 1 { "" } else { "s" }) };
                    state.notifications.info(what, format!("{hash} {subject}"));
                    let c = &mut state.ws.git_ui.changes;
                    c.message.clear();
                    c.amend = false;
                    c.amend_restore = None;
                    state.refresh_git();
                    if push {
                        super::remote::open_push_dialog(state);
                    }
                }
                Ok(outcome) => {
                    let o = &outcome.output;
                    let body = if o.stderr.trim().is_empty() { o.stdout.clone() } else { o.stderr.clone() };
                    state.notifications.error("Commit failed", body);
                    state.refresh_git();
                }
                Err(e) => {
                    state.notifications.error("Commit failed", e.to_string());
                    state.refresh_git();
                }
            }
        },
    );
}

pub fn show_windows(state: &mut AppState, ctx: &Context) {
    // Cmd+K opens the Commit window and focuses the message. Shift is excluded because
    // consume_key would otherwise also take Cmd+Shift+K (Push).
    let cmd_k = !state.ws.terminals.has_focus(ctx)
        && state.ws.git.repo.is_some()
        && ctx.input_mut(|i| {
            let m = i.modifiers;
            if m.command && !m.shift && !m.alt && i.key_pressed(Key::K) {
                i.consume_key(Modifiers::COMMAND, Key::K)
            } else {
                false
            }
        });
    if cmd_k {
        state.ws.layout.show(crate::layout::ToolWindow::Commit);
        state.ws.git_ui.changes.focus_message = true;
    }
    confirm_dialog(state, ctx);
    test_tick(state);
}

fn confirm_dialog(state: &mut AppState, ctx: &Context) {
    let Some(confirm) = &state.ws.git_ui.changes.confirm else { return };
    let (title, paths, button) = match confirm {
        Confirm::Rollback(p) => ("Rollback Changes", p, "Rollback"),
        Confirm::Delete(p) => ("Delete", p, "Delete"),
    };
    let mut choice: Option<bool> = None;
    let entries = &state.ws.git_ui.changes;
    let modal = Modal::new(crate::workspace::wid("changes-confirm")).show(ctx, |ui| {
        ui.set_width(440.0);
        ui.label(RichText::new(title).strong().size(theme::T.font.hint));
        ui.add_space(6.0);
        let n = paths.len();
        let text = match confirm {
            Confirm::Rollback(_) => format!("Roll back {n} file{} to HEAD? Local changes are lost.", if n == 1 { "" } else { "s" }),
            Confirm::Delete(_) => format!("Delete {n} file{} from disk?", if n == 1 { "" } else { "s" }),
        };
        ui.label(text);
        ui.add_space(4.0);
        ScrollArea::vertical().max_height(220.0).show(ui, |ui| {
            for p in paths.iter().take(500) {
                let kind = entries.entry(p).map(|e| e.kind());
                let color = kind.map_or(theme::T.text, change_color);
                let note = match (confirm, kind) {
                    (Confirm::Rollback(_), Some(ChangeKind::Added)) => "  (will be deleted)",
                    _ => "",
                };
                ui.label(RichText::new(format!("{}{note}", p.display())).color(color).monospace());
            }
            if paths.len() > 500 {
                ui.label(RichText::new(format!("... and {} more", paths.len() - 500)).color(theme::T.text_dim));
            }
        });
        ui.add_space(8.0);
        ui.horizontal(|ui| {
            if ui.button(RichText::new(button).strong()).clicked() {
                choice = Some(true);
            }
            if ui.button("Cancel").clicked() {
                choice = Some(false);
            }
        });
    });
    if choice.is_none() && modal.should_close() {
        choice = Some(false);
    }
    let Some(ok) = choice else { return };
    let Some(confirm) = state.ws.git_ui.changes.confirm.take() else { return };
    if !ok {
        return;
    }
    match confirm {
        Confirm::Rollback(paths) => git_write(state, "Rolling back", move |repo| repo.rollback(&paths)),
        Confirm::Delete(paths) => {
            let Some(workdir) = state.ws.git.repo.as_ref().map(|r| r.workdir().to_path_buf()) else { return };
            state.jobs.spawn(
                "Deleting files",
                move || {
                    let mut errors = Vec::new();
                    for p in &paths {
                        let abs = workdir.join(p);
                        let res = if abs.is_dir() { std::fs::remove_dir_all(&abs) } else { std::fs::remove_file(&abs) };
                        if let Err(e) = res {
                            errors.push(format!("{}: {e}", p.display()));
                        }
                    }
                    errors
                },
                |state, errors: Vec<String>| {
                    if !errors.is_empty() {
                        state.notifications.error("Delete failed", errors.join("\n"));
                    }
                    state.refresh_git();
                },
            );
        }
    }
}

pub fn on_git_refreshed(state: &mut AppState) {
    let changes = state.ws.git.changes.clone();
    state.ws.git_ui.changes.set_entries(changes);
    super::diff::on_git_refreshed(state);
    super::editor_git::on_git_refreshed(state);
}

// ---------------------------------------------------------------------------------------------
// Test hooks (see testhook.rs): `--test-git-commit "<msg>" <comma-separated paths>`,
// `--test-git-diff <path>`, `--test-git-changes`, `--test-git-annotate`, `--test-git-gutter <L>`,
// `--test-git-rollback-lines <L>`, `--test-git-blame-click <L>`.

/// Steps queued by the test hook, run one per frame once the project and git status are loaded.
#[derive(Default)]
pub struct TestSteps {
    pub steps: std::collections::VecDeque<(String, String)>,
    pub wait_until: Option<std::time::Instant>,
}

thread_local! {
    static TEST: std::cell::RefCell<TestSteps> = std::cell::RefCell::new(TestSteps::default());
}

/// Queues one hook step. Called from testhook.rs while parsing the command line.
pub fn test_queue(flag: &str, arg: String) {
    TEST.with(|t| t.borrow_mut().steps.push_back((flag.to_string(), arg)));
}

fn test_tick(state: &mut AppState) {
    if state.ws.project.is_none() || state.ws.git.repo.is_none() || state.ws.git.status_ms.is_none() {
        return;
    }
    let step = TEST.with(|t| {
        let mut t = t.borrow_mut();
        if let Some(at) = t.wait_until {
            let now = std::time::Instant::now();
            if now < at {
                // Idle frames stop otherwise, and the next step would never run.
                state.ctx.request_repaint_after(at - now);
                return None;
            }
            t.wait_until = None;
        }
        let s = t.steps.pop_front();
        if s.is_some() {
            // Gives jobs (diff loads, blame) time to land before the next step.
            t.wait_until = Some(std::time::Instant::now() + std::time::Duration::from_millis(1200));
        }
        s
    });
    let Some((flag, arg)) = step else { return };
    state.ctx.request_repaint_after(std::time::Duration::from_millis(1300));
    let workdir = state.ws.git.repo.as_ref().map(|r| r.workdir().to_path_buf()).unwrap_or_default();
    eprintln!("[test] {flag} {arg}");
    let active = state.ws.tabs.active;
    match flag.as_str() {
        "--test-git-changes" => {
            state.ws.layout.show(crate::layout::ToolWindow::Commit);
            let c = &state.ws.git_ui.changes;
            let checked = c.checked_files;
            eprintln!("[test] commit window: {} entries, {checked} checked, status {} changes", c.entries.len(), state.ws.git.changes.len());
        }
        "--test-git-diff" => super::diff::open_worktree_diff(state, &workdir.join(&arg)),
        "--test-git-diff-next" => super::diff::test_next(state, arg.trim().parse().unwrap_or(1)),
        "--test-git-commit" => {
            let (msg, paths) = arg.split_once('\u{1}').unwrap_or((arg.as_str(), ""));
            state.ws.layout.show(crate::layout::ToolWindow::Commit);
            let c = &mut state.ws.git_ui.changes;
            c.message = msg.to_string();
            if !paths.is_empty() {
                let want: HashSet<PathBuf> = paths.split(',').map(PathBuf::from).collect();
                c.checked = c.items.iter().map(|it| want.contains(&c.entries[it.entry].path)).collect();
                c.recount();
            }
            start_commit(state, false);
        }
        "--test-git-annotate" | "--test-git-gutter" | "--test-git-rollback-lines" | "--test-git-blame-click" | "--test-git-history" => {
            if let Some(id) = active.filter(|&id| state.ws.tabs.editor_mut(id).is_some()) {
                super::editor_git::test_step(state, id, &flag, &arg);
            } else {
                eprintln!("[test] {flag}: no active editor");
            }
        }
        _ => eprintln!("[test] unknown git step {flag}"),
    }
}
