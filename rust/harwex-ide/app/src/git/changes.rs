//! Commit tool window: change tree with checkboxes, message, Amend, Commit / Commit and Push.
//!
//! The tree is flattened into rows once per status change (or collapse click), and only the
//! visible rows are drawn, so thousands of changed files cost the same per frame as ten.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::ops::Range;
use std::path::{Path, PathBuf};

use egui::{pos2, vec2, Align2, Color32, Context, FontId, Id, Key, Modal, Modifiers, Rect, RichText, ScrollArea, Sense, Shape, Stroke, Ui};
use ide_git::{ChangeKind, FileChange};

use crate::state::AppState;
use crate::theme;
use crate::tree::change_color;

const ROW_H: f32 = 20.0;
const MESSAGE_ID: &str = "commit-message";

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
enum Group {
    Changes,
    Unversioned,
}

impl Group {
    fn title(self) -> &'static str {
        match self {
            Group::Changes => "Changes",
            Group::Unversioned => "Unversioned Files",
        }
    }
}

enum RowKind {
    Group(Group),
    Dir(String),
    File(usize),
}

struct Row {
    kind: RowKind,
    depth: u16,
    /// Collapse key: group name plus directory path.
    key: String,
    /// Range in `ChangesUi::order` covered by this row (one file for a file row).
    span: Range<usize>,
    collapsed: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Tri {
    Off,
    Mixed,
    On,
}

enum Confirm {
    Rollback(Vec<PathBuf>),
    Delete(Vec<PathBuf>),
}

#[derive(Default)]
pub struct ChangesUi {
    /// Current status entries, sorted by path. Rows index into this.
    entries: Vec<FileChange>,
    checked: Vec<bool>,
    /// Checkbox state by path, so a refresh keeps what the user ticked.
    check_memory: HashMap<PathBuf, bool>,
    /// Entry indices in display (depth-first) order; group and dir rows cover a contiguous span.
    order: Vec<usize>,
    /// Checked counts over `order`, for O(1) tri-state of a directory.
    prefix: Vec<u32>,
    rows: Vec<Row>,
    rows_dirty: bool,
    collapsed: HashSet<String>,
    selected: HashSet<PathBuf>,
    /// Last clicked row, the anchor for Shift+click.
    anchor: Option<usize>,
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
        let mut v: Vec<PathBuf> = self.selected.iter().cloned().collect();
        v.sort();
        v
    }

    pub fn has_confirm_dialog(&self) -> bool {
        self.confirm.is_some()
    }

    fn set_entries(&mut self, mut changes: Vec<FileChange>) {
        changes.sort_by(|a, b| a.path.cmp(&b.path));
        if changes == self.entries && !self.rows.is_empty() {
            return;
        }
        // Remember the current boxes before the entries go away.
        for (e, &c) in self.entries.iter().zip(&self.checked) {
            self.check_memory.insert(e.path.clone(), c);
        }
        let present: HashSet<&PathBuf> = changes.iter().map(|c| &c.path).collect();
        self.check_memory.retain(|p, _| present.contains(p));
        self.selected.retain(|p| present.contains(p));
        // Like IDEA: tracked changes start ticked, unversioned files start unticked.
        self.checked = changes.iter().map(|c| self.check_memory.get(&c.path).copied().unwrap_or(!c.is_untracked())).collect();
        self.entries = changes;
        self.rows_dirty = true;
    }

    fn rebuild(&mut self) {
        self.rows_dirty = false;
        self.rows.clear();
        self.order.clear();
        let (tracked, unversioned): (Vec<usize>, Vec<usize>) = (0..self.entries.len()).partition(|&i| !self.entries[i].is_untracked());
        for (group, files) in [(Group::Changes, tracked), (Group::Unversioned, unversioned)] {
            if files.is_empty() {
                continue;
            }
            let mut root = DirNode::default();
            for i in files {
                let path = &self.entries[i].path;
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
            self.rows.push(Row { kind: RowKind::Group(group), depth: 0, key: key.clone(), span: 0..0, collapsed });
            self.emit(&root, &key, 1, collapsed);
            self.rows[row].span = start..self.order.len();
        }
        self.recount();
    }

    /// Appends rows for `node`'s children. When `hidden`, files still go into `order` (so the
    /// collapsed parent's span and tri-state stay right) but no rows are added.
    fn emit(&mut self, node: &DirNode, key: &str, depth: u16, hidden: bool) {
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
                self.rows.push(Row { kind: RowKind::Dir(label), depth, key: child_key.clone(), span: 0..0, collapsed });
                Some(self.rows.len() - 1)
            };
            self.emit(child, &child_key, depth + 1, hidden || collapsed);
            if let Some(r) = row {
                self.rows[r].span = start..self.order.len();
            }
        }
        let mut files = node.files.clone();
        files.sort_by(|&a, &b| file_name(&self.entries[a].path).cmp(&file_name(&self.entries[b].path)));
        for i in files {
            let at = self.order.len();
            self.order.push(i);
            if !hidden {
                self.rows.push(Row { kind: RowKind::File(i), depth, key: String::new(), span: at..at + 1, collapsed: false });
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
    }

    fn tri(&self, span: &Range<usize>) -> Tri {
        let (Some(a), Some(b)) = (self.prefix.get(span.start), self.prefix.get(span.end)) else { return Tri::Off };
        let n = (b - a) as usize;
        if n == 0 {
            Tri::Off
        } else if n == span.len() {
            Tri::On
        } else {
            Tri::Mixed
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

    /// Paths whose box is ticked, sorted.
    pub fn checked_paths(&self) -> Vec<PathBuf> {
        self.entries.iter().zip(&self.checked).filter(|(_, &c)| c).map(|(e, _)| e.path.clone()).collect()
    }

    fn span_paths(&self, span: &Range<usize>) -> Vec<PathBuf> {
        self.order[span.clone()].iter().map(|&i| self.entries[i].path.clone()).collect()
    }

    fn entry(&self, path: &Path) -> Option<&FileChange> {
        self.entries.binary_search_by(|e| e.path.as_path().cmp(path)).ok().map(|i| &self.entries[i])
    }

    /// Paths an action on `row` applies to: the selection if the row is part of it.
    fn targets(&self, row: &Row) -> Vec<PathBuf> {
        match row.kind {
            RowKind::File(i) => {
                let p = &self.entries[i].path;
                if self.selected.contains(p) && self.selected.len() > 1 {
                    self.entries.iter().filter(|e| self.selected.contains(&e.path)).map(|e| e.path.clone()).collect()
                } else {
                    vec![p.clone()]
                }
            }
            _ => self.span_paths(&row.span),
        }
    }
}

#[derive(Default)]
struct DirNode {
    dirs: BTreeMap<String, DirNode>,
    files: Vec<usize>,
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default()
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
}

pub fn tool_window(state: &mut AppState, ui: &mut Ui) {
    if state.git.repo.is_none() {
        ui.label(RichText::new("The project is not under git.").color(theme::TEXT_DIM));
        return;
    }
    if state.git_ui.changes.rows_dirty {
        state.git_ui.changes.rebuild();
    }
    let mut events = Vec::new();
    let mut commit: Option<bool> = None;

    egui::TopBottomPanel::bottom("commit-message-panel")
        .resizable(true)
        .default_height(170.0)
        .height_range(110.0..=500.0)
        .frame(egui::Frame::NONE.fill(theme::PANEL_BG).inner_margin(egui::Margin::symmetric(0, 6)))
        .show_inside(ui, |ui| {
            commit = message_area(state, ui);
        });

    let c = &state.git_ui.changes;
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = 2.0;
        if small_button(ui, "\u{27F3}", "Refresh").clicked() {
            events.push(Event::Refresh);
        }
        let sel: Vec<PathBuf> = c.entries.iter().filter(|e| c.selected.contains(&e.path)).map(|e| e.path.clone()).collect();
        let has_sel = !sel.is_empty();
        if ui.add_enabled(has_sel, egui::Button::new("Rollback").small()).on_hover_text("Rollback selected files").clicked() {
            events.push(Event::Rollback(sel.iter().filter(|p| c.entry(p).is_some_and(|e| !e.is_untracked())).cloned().collect()));
        }
        if ui.add_enabled(sel.len() == 1, egui::Button::new("Diff").small()).on_hover_text("Show Diff").clicked() {
            events.push(Event::Diff(sel[0].clone()));
        }
        ui.separator();
        if small_button(ui, "+", "Expand All").clicked() {
            events.push(Event::ExpandAll(true));
        }
        if small_button(ui, "\u{2212}", "Collapse All").clicked() {
            events.push(Event::ExpandAll(false));
        }
        let checked = c.prefix.last().copied().unwrap_or(0);
        ui.label(RichText::new(format!("{checked} of {} selected", c.entries.len())).size(11.0).color(theme::TEXT_DIM));
    });

    if c.entries.is_empty() {
        ui.add_space(20.0);
        ui.vertical_centered(|ui| ui.label(RichText::new("No changes").color(theme::TEXT_DIM)));
    } else {
        draw_tree(c, ui, &mut events);
    }

    for e in events {
        handle(state, e);
    }
    if let Some(push) = commit {
        start_commit(state, push);
    }
}

fn small_button(ui: &mut Ui, text: &str, tip: &str) -> egui::Response {
    ui.add(egui::Button::new(text).small()).on_hover_text(tip)
}

fn draw_tree(c: &ChangesUi, ui: &mut Ui, events: &mut Vec<Event>) {
    let (cmd, shift) = ui.input(|i| (i.modifiers.command, i.modifiers.shift));
    ScrollArea::both().auto_shrink([false, false]).id_salt("changes-tree").show_rows(ui, ROW_H, c.rows.len(), |ui, range| {
        let width = ui.available_width().max(240.0);
        for idx in range {
            let row = &c.rows[idx];
            let (rect, resp) = ui.allocate_exact_size(vec2(width, ROW_H), Sense::click());
            let painter = ui.painter();
            let is_sel = matches!(row.kind, RowKind::File(i) if c.selected.contains(&c.entries[i].path));
            if is_sel {
                painter.rect_filled(rect, 0.0, theme::SELECTION_INACTIVE);
            } else if resp.hovered() {
                painter.rect_filled(rect, 0.0, theme::HOVER);
            }
            let cy = rect.center().y;
            let mut x = rect.min.x + 4.0 + f32::from(row.depth) * 14.0;
            let has_arrow = !matches!(row.kind, RowKind::File(_));
            let arrow = Rect::from_min_size(pos2(x, rect.min.y), vec2(12.0, ROW_H));
            if has_arrow {
                let pts = if row.collapsed {
                    vec![pos2(x + 2.0, cy - 4.0), pos2(x + 7.0, cy), pos2(x + 2.0, cy + 4.0)]
                } else {
                    vec![pos2(x, cy - 2.0), pos2(x + 8.0, cy - 2.0), pos2(x + 4.0, cy + 3.0)]
                };
                painter.add(Shape::convex_polygon(pts, theme::TEXT_DIM, Stroke::NONE));
            }
            x += 14.0;
            let tri = c.tri(&row.span);
            let check = Rect::from_center_size(pos2(x + 6.0, cy), vec2(12.0, 12.0));
            // The box is its own widget on top of the row, so it has an accessibility node and
            // takes the click before the row does.
            let check_resp = ui.interact(check.expand(3.0), resp.id.with("check"), Sense::click());
            let name = match &row.kind {
                RowKind::Group(g) => format!("{} group", g.title()),
                RowKind::Dir(_) => format!("Directory {}", row.key.split_once('/').map_or(row.key.as_str(), |(_, d)| d)),
                RowKind::File(i) => c.entries[*i].path.display().to_string(),
            };
            crate::util::label_selectable(&resp, name.clone(), is_sel);
            check_resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::Checkbox, true, tri == Tri::On, format!("Include {name}")));
            if check_resp.clicked() {
                events.push(Event::Check(row.span.clone(), tri != Tri::On));
            }
            let pointer = resp.interact_pointer_pos();
            paint_checkbox(painter, check, tri, pointer.is_none() && ui.rect_contains_pointer(check.expand(2.0)));
            x += 18.0;
            let font = FontId::proportional(13.0);
            match &row.kind {
                RowKind::Group(g) => {
                    let galley = painter.layout_no_wrap(g.title().to_string(), font.clone(), theme::TEXT_BRIGHT);
                    let w = galley.size().x;
                    painter.galley(pos2(x, cy - galley.size().y / 2.0), galley, theme::TEXT_BRIGHT);
                    let n = row.span.len();
                    painter.text(pos2(x + w + 8.0, cy), Align2::LEFT_CENTER, format!("{n} file{}", if n == 1 { "" } else { "s" }), FontId::proportional(11.5), theme::TEXT_DIM);
                }
                RowKind::Dir(name) => {
                    let r = Rect::from_center_size(pos2(x + 6.0, cy), vec2(12.0, 9.0));
                    painter.rect_filled(r, 1.5, Color32::from_rgb(0x87, 0x93, 0x9A));
                    x += 16.0;
                    let galley = painter.layout_no_wrap(name.clone(), font.clone(), theme::TEXT);
                    let w = galley.size().x;
                    painter.galley(pos2(x, cy - galley.size().y / 2.0), galley, theme::TEXT);
                    let n = row.span.len();
                    painter.text(pos2(x + w + 8.0, cy), Align2::LEFT_CENTER, format!("{n} file{}", if n == 1 { "" } else { "s" }), FontId::proportional(11.5), theme::TEXT_DIM);
                }
                RowKind::File(i) => {
                    let e = &c.entries[*i];
                    let kind = e.kind();
                    let color = change_color(kind);
                    let name = e.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                    let galley = painter.layout_no_wrap(name, font.clone(), color);
                    let w = galley.size().x;
                    painter.galley(pos2(x, cy - galley.size().y / 2.0), galley, color);
                    let extra = match (&e.old_path, kind) {
                        (Some(old), _) => Some(format!("from {}", old.display())),
                        (None, ChangeKind::Deleted) => Some("deleted".into()),
                        _ => None,
                    };
                    if let Some(extra) = extra {
                        painter.text(pos2(x + w + 8.0, cy), Align2::LEFT_CENTER, extra, FontId::proportional(11.5), theme::TEXT_DIM);
                    }
                }
            }

            let resp = match &row.kind {
                RowKind::File(i) => resp.on_hover_text_at_pointer(c.entries[*i].path.display().to_string()),
                _ => resp,
            };
            if resp.clicked() {
                let p = resp.interact_pointer_pos().unwrap_or_default();
                if check.expand(3.0).contains(p) {
                    events.push(Event::Check(row.span.clone(), tri != Tri::On));
                } else if has_arrow && arrow.expand(2.0).contains(p) {
                    events.push(Event::Toggle(idx));
                } else {
                    events.push(Event::Select { row: idx, cmd, shift });
                }
            }
            if resp.double_clicked() {
                match &row.kind {
                    RowKind::File(i) => events.push(Event::Diff(c.entries[*i].path.clone())),
                    _ => events.push(Event::Toggle(idx)),
                }
            }
            if resp.secondary_clicked() {
                events.push(Event::SelectIfNot(idx));
            }
            resp.context_menu(|ui| context_menu(c, row, ui, events));
        }
    });
}

fn context_menu(c: &ChangesUi, row: &Row, ui: &mut Ui, events: &mut Vec<Event>) {
    ui.set_min_width(180.0);
    let targets = c.targets(row);
    let entries: Vec<&FileChange> = targets.iter().filter_map(|p| c.entry(p)).collect();
    let single = match row.kind {
        RowKind::File(i) if targets.len() == 1 => Some(c.entries[i].path.clone()),
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

fn paint_checkbox(painter: &egui::Painter, r: Rect, tri: Tri, hovered: bool) {
    let border = if hovered { theme::TEXT_BRIGHT } else { Color32::from_gray(0x80) };
    match tri {
        Tri::Off => {
            painter.rect_filled(r, 2.0, Color32::from_rgb(0x43, 0x45, 0x47));
            painter.rect_stroke(r, 2.0, Stroke::new(1.0_f32, border), egui::StrokeKind::Inside);
        }
        Tri::On | Tri::Mixed => {
            painter.rect_filled(r, 2.0, theme::TAB_ACTIVE_LINE);
            let s = Stroke::new(1.6_f32, Color32::WHITE);
            if tri == Tri::On {
                painter.line_segment([pos2(r.min.x + 2.5, r.center().y), pos2(r.min.x + 5.0, r.max.y - 3.0)], s);
                painter.line_segment([pos2(r.min.x + 5.0, r.max.y - 3.0), pos2(r.max.x - 2.5, r.min.y + 3.0)], s);
            } else {
                painter.line_segment([pos2(r.min.x + 3.0, r.center().y), pos2(r.max.x - 3.0, r.center().y)], s);
            }
        }
    }
}

/// The message box, Amend and the commit buttons. Returns `Some(push)` when a button was hit.
fn message_area(state: &mut AppState, ui: &mut Ui) -> Option<bool> {
    let c = &mut state.git_ui.changes;
    let mut out = None;
    let mut amend_changed = false;
    ui.horizontal(|ui| {
        if ui.checkbox(&mut c.amend, "Amend").on_hover_text("Amend the last commit; fills in its message").changed() {
            amend_changed = true;
        }
    });
    let buttons_h = 30.0;
    let edit_h = (ui.available_height() - buttons_h).max(40.0);
    let id = Id::new(MESSAGE_ID);
    ScrollArea::vertical().id_salt("commit-message-scroll").max_height(edit_h).auto_shrink([false, true]).show(ui, |ui| {
        let r = ui.add_sized(
            vec2(ui.available_width(), edit_h - 4.0),
            egui::TextEdit::multiline(&mut c.message).id(id).hint_text("Commit Message").font(egui::TextStyle::Monospace).desired_width(f32::INFINITY),
        );
        if std::mem::take(&mut c.focus_message) {
            r.request_focus();
        }
        // Cmd+Enter commits, like IDEA.
        if r.has_focus() && ui.input_mut(|i| i.consume_key(Modifiers::COMMAND, Key::Enter)) {
            out = Some(false);
        }
    });
    let checked = c.prefix.last().copied().unwrap_or(0);
    let can = !c.committing && !c.message.trim().is_empty() && (checked > 0 || c.amend);
    ui.add_space(4.0);
    ui.horizontal(|ui| {
        let label = if c.amend { "Amend Commit" } else { "Commit" };
        let hint = if c.message.trim().is_empty() { "Enter a commit message" } else if checked == 0 && !c.amend { "Select files to commit" } else { "Cmd+Enter" };
        if ui.add_enabled(can, egui::Button::new(RichText::new(label).strong()).fill(theme::SELECTION)).on_disabled_hover_text(hint).clicked() {
            out = Some(false);
        }
        if ui.add_enabled(can, egui::Button::new(if c.amend { "Amend Commit and Push..." } else { "Commit and Push..." })).on_disabled_hover_text(hint).clicked() {
            out = Some(true);
        }
        if c.committing {
            ui.add(egui::Spinner::new().size(14.0));
        }
    });
    if amend_changed {
        toggle_amend(state);
    }
    if out.is_some() && !can {
        out = None;
    }
    out
}

fn toggle_amend(state: &mut AppState) {
    let c = &mut state.git_ui.changes;
    if !c.amend {
        // Put the user's own draft back if the amended message was not edited.
        if let Some((draft, amended)) = c.amend_restore.take() {
            if c.message == amended {
                c.message = draft;
            }
        }
        return;
    }
    let Some(repo) = state.git.repo.clone() else { return };
    state.jobs.spawn_quiet(
        move || repo.last_commit_message(),
        |state, res| {
            let c = &mut state.git_ui.changes;
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
    let Some(workdir) = state.git.repo.as_ref().map(|r| r.workdir().to_path_buf()) else { return };
    let c = &mut state.git_ui.changes;
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
                let p = c.entries[*i].path.clone();
                if !c.selected.contains(&p) {
                    c.selected.clear();
                    c.selected.insert(p);
                    c.anchor = Some(row);
                }
            }
        }
        Event::Diff(p) => super::diff::open_worktree_diff(state, &workdir.join(p)),
        Event::Jump(p) => state.open_location(&workdir.join(p), None, true),
        Event::Rollback(paths) if !paths.is_empty() => c.confirm = Some(Confirm::Rollback(paths)),
        Event::Delete(paths) if !paths.is_empty() => c.confirm = Some(Confirm::Delete(paths)),
        Event::Rollback(_) | Event::Delete(_) => {}
        Event::Stage(paths) => git_write(state, "Staging", move |repo| repo.stage(&paths)),
        Event::Unstage(paths) => git_write(state, "Unstaging", move |repo| repo.unstage(&paths)),
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
    }
}

fn select(c: &mut ChangesUi, row: usize, cmd: bool, shift: bool) {
    let path_of = |c: &ChangesUi, r: usize| match c.rows.get(r).map(|r| &r.kind) {
        Some(RowKind::File(i)) => Some(c.entries[*i].path.clone()),
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
    let Some(repo) = state.git.repo.clone() else { return };
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
    let Some(repo) = state.git.repo.clone() else { return };
    let c = &mut state.git_ui.changes;
    if c.committing {
        return;
    }
    let paths = c.checked_paths();
    let message = c.message.trim_end().to_string();
    let amend = c.amend;
    if message.trim().is_empty() || (paths.is_empty() && !amend) {
        return;
    }
    c.committing = true;
    // IDEA saves every document before a commit. The texts are written by the commit worker
    // itself, so git sees them before it runs and the UI thread never touches the disk.
    let mut saves = Vec::new();
    for (id, e) in state.tabs.editors_mut() {
        if e.doc.is_dirty() && !e.read_only && !e.saving {
            let (text, token) = e.doc.save_snapshot();
            saves.push((id, e.path.clone(), text, token));
        }
    }
    let n = paths.len();
    state.jobs.spawn(
        if amend { "Amending commit" } else { "Committing" },
        move || {
            let mut saved = Vec::new();
            for (id, path, text, token) in saves {
                if std::fs::write(&path, text).is_ok() {
                    saved.push((id, token));
                }
            }
            (saved, repo.commit(&message, &paths, amend), message)
        },
        move |state, (saved, res, message)| {
            for (id, token) in saved {
                if let Some(e) = state.tabs.editor_mut(id) {
                    e.doc.mark_saved(token);
                }
            }
            state.git_ui.changes.committing = false;
            let subject = message.lines().next().unwrap_or_default().to_string();
            match res {
                Ok(outcome) if outcome.success() => {
                    let hash = outcome.oid.map(|o| o.to_string()[..8].to_string()).unwrap_or_default();
                    let what = if n == 0 { "Amended the commit message".to_string() } else { format!("{n} file{} committed", if n == 1 { "" } else { "s" }) };
                    state.notifications.info(what, format!("{hash} {subject}"));
                    let c = &mut state.git_ui.changes;
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
    let cmd_k = !state.terminals.has_focus(ctx)
        && state.git.repo.is_some()
        && ctx.input_mut(|i| {
            let m = i.modifiers;
            if m.command && !m.shift && !m.alt && i.key_pressed(Key::K) {
                i.consume_key(Modifiers::COMMAND, Key::K)
            } else {
                false
            }
        });
    if cmd_k {
        state.layout.show(crate::layout::ToolWindow::Commit);
        state.git_ui.changes.focus_message = true;
    }
    confirm_dialog(state, ctx);
    test_tick(state);
}

fn confirm_dialog(state: &mut AppState, ctx: &Context) {
    let Some(confirm) = &state.git_ui.changes.confirm else { return };
    let (title, paths, button) = match confirm {
        Confirm::Rollback(p) => ("Rollback Changes", p, "Rollback"),
        Confirm::Delete(p) => ("Delete", p, "Delete"),
    };
    let mut choice: Option<bool> = None;
    let entries = &state.git_ui.changes;
    let modal = Modal::new(Id::new("changes-confirm")).show(ctx, |ui| {
        ui.set_width(440.0);
        ui.label(RichText::new(title).strong().size(14.0));
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
                let color = kind.map_or(theme::TEXT, change_color);
                let note = match (confirm, kind) {
                    (Confirm::Rollback(_), Some(ChangeKind::Added)) => "  (will be deleted)",
                    _ => "",
                };
                ui.label(RichText::new(format!("{}{note}", p.display())).color(color).monospace());
            }
            if paths.len() > 500 {
                ui.label(RichText::new(format!("... and {} more", paths.len() - 500)).color(theme::TEXT_DIM));
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
    let Some(confirm) = state.git_ui.changes.confirm.take() else { return };
    if !ok {
        return;
    }
    match confirm {
        Confirm::Rollback(paths) => git_write(state, "Rolling back", move |repo| repo.rollback(&paths)),
        Confirm::Delete(paths) => {
            let Some(workdir) = state.git.repo.as_ref().map(|r| r.workdir().to_path_buf()) else { return };
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
    let changes = state.git.changes.clone();
    state.git_ui.changes.set_entries(changes);
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
    if state.project.is_none() || state.git.repo.is_none() || state.git.status_ms.is_none() {
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
    let workdir = state.git.repo.as_ref().map(|r| r.workdir().to_path_buf()).unwrap_or_default();
    eprintln!("[test] {flag} {arg}");
    let active = state.tabs.active;
    match flag.as_str() {
        "--test-git-changes" => {
            state.layout.show(crate::layout::ToolWindow::Commit);
            let c = &state.git_ui.changes;
            let checked = c.checked.iter().filter(|&&x| x).count();
            eprintln!("[test] commit window: {} entries, {checked} checked, status {} changes", c.entries.len(), state.git.changes.len());
        }
        "--test-git-diff" => super::diff::open_worktree_diff(state, &workdir.join(&arg)),
        "--test-git-diff-next" => super::diff::test_next(state, arg.trim().parse().unwrap_or(1)),
        "--test-git-commit" => {
            let (msg, paths) = arg.split_once('\u{1}').unwrap_or((arg.as_str(), ""));
            state.layout.show(crate::layout::ToolWindow::Commit);
            let c = &mut state.git_ui.changes;
            c.message = msg.to_string();
            if !paths.is_empty() {
                let want: HashSet<PathBuf> = paths.split(',').map(PathBuf::from).collect();
                c.checked = c.entries.iter().map(|e| want.contains(&e.path)).collect();
                c.recount();
            }
            start_commit(state, false);
        }
        "--test-git-annotate" | "--test-git-gutter" | "--test-git-rollback-lines" | "--test-git-blame-click" | "--test-git-history" => {
            if let Some(id) = active.filter(|&id| state.tabs.editor_mut(id).is_some()) {
                super::editor_git::test_step(state, id, &flag, &arg);
            } else {
                eprintln!("[test] {flag}: no active editor");
            }
        }
        _ => eprintln!("[test] unknown git step {flag}"),
    }
}
