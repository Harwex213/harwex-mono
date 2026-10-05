//! The right pane of a Log tab: the changed files of the selected commits as a tree in the
//! Project tree's look, and the file context menu (Show Diff,
//! Compare with Local, Edit Source, Cherry-Pick Selected Changes, Create Patch, Copy Patch).

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use egui::{pos2, vec2, Align, Align2, Frame, Id, Key, Layout, Modifiers, Rect, RichText, ScrollArea, Sense, Ui};
use ide_git::{ChangeKind, ChangedFile, Oid};

use super::log::{self, LogView};
use crate::icons::{self, Icon};
use crate::state::AppState;
use crate::theme;

/// Show Diff opens at most this many tabs at once.
const MAX_DIFF_TABS: usize = 10;

/// One node of the changes tree: a folder (possibly a chain of single-child folders shown as
/// one row) or a file.
#[derive(Clone, Debug)]
pub struct Node {
    /// What the row shows: `src/scene` for a folder chain, the file name for a file.
    pub name: String,
    /// The folder's (deepest) path or the file's path, relative to the repository.
    pub path: PathBuf,
    /// Index into the files for a file row.
    pub file: Option<usize>,
    pub children: Vec<usize>,
    /// Files below a folder.
    pub count: usize,
}

/// Changed files as a tree. Node 0 is the root: the common folder of all files.
#[derive(Clone, Debug, Default)]
pub struct Tree {
    pub nodes: Vec<Node>,
}

/// A visible row of the changes tree, for drawing and for the tests.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChangeRow {
    pub depth: usize,
    pub name: String,
    pub path: PathBuf,
    pub is_dir: bool,
    pub count: usize,
    pub kind: Option<ChangeKind>,
    pub old_path: Option<PathBuf>,
    pub expanded: bool,
}

/// Builds the tree: the root is the deepest folder that holds every file; folders below it
/// that hold exactly one folder and no file merge into one row; folders sort before files.
pub fn build_tree(files: &[ChangedFile]) -> Tree {
    let parent_parts = |p: &Path| -> Vec<String> { p.parent().map(|d| d.iter().map(|c| c.to_string_lossy().into_owned()).collect()).unwrap_or_default() };
    let mut common: Vec<String> = files.first().map(|f| parent_parts(&f.path)).unwrap_or_default();
    for f in files.iter().skip(1) {
        let parts = parent_parts(&f.path);
        let same = common.iter().zip(&parts).take_while(|(a, b)| a == b).count();
        common.truncate(same);
    }
    let root_path: PathBuf = common.iter().collect();
    let mut nodes = vec![Node { name: common.join("/"), path: root_path.clone(), file: None, children: Vec::new(), count: 0 }];
    for (i, f) in files.iter().enumerate() {
        let rest: Vec<String> = f.path.strip_prefix(&root_path).unwrap_or(&f.path).iter().map(|c| c.to_string_lossy().into_owned()).collect();
        let mut at = 0;
        let mut path = root_path.clone();
        for (k, part) in rest.iter().enumerate() {
            path.push(part);
            let last = k + 1 == rest.len();
            if last {
                nodes.push(Node { name: part.clone(), path: f.path.clone(), file: Some(i), children: Vec::new(), count: 1 });
                let id = nodes.len() - 1;
                nodes[at].children.push(id);
            } else {
                let found = nodes[at].children.iter().copied().find(|&c| nodes[c].file.is_none() && nodes[c].name == *part);
                at = match found {
                    Some(c) => c,
                    None => {
                        nodes.push(Node { name: part.clone(), path: path.clone(), file: None, children: Vec::new(), count: 0 });
                        let id = nodes.len() - 1;
                        nodes[at].children.push(id);
                        id
                    }
                };
            }
        }
    }
    let mut tree = Tree { nodes };
    tree.finish(0, true);
    tree
}

impl Tree {
    /// Merges single-folder chains below `n`, sorts the children and counts the files.
    fn finish(&mut self, n: usize, is_root: bool) -> usize {
        if !is_root && self.nodes[n].file.is_none() {
            while let [only] = self.nodes[n].children[..] {
                if self.nodes[only].file.is_some() {
                    break;
                }
                let child = self.nodes[only].clone();
                let node = &mut self.nodes[n];
                node.name = format!("{}/{}", node.name, child.name);
                node.path = child.path;
                node.children = child.children;
            }
        }
        let mut children = std::mem::take(&mut self.nodes[n].children);
        children.sort_by(|&a, &b| {
            let (a, b) = (&self.nodes[a], &self.nodes[b]);
            a.file.is_some().cmp(&b.file.is_some()).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        let mut count = usize::from(self.nodes[n].file.is_some());
        for &c in &children {
            count += self.finish(c, false);
        }
        self.nodes[n].children = children;
        self.nodes[n].count = count;
        count
    }

    /// Visible rows: the root, then the children of every expanded folder.
    fn rows(&self, collapsed: &HashSet<PathBuf>) -> Vec<(usize, usize)> {
        let mut out = Vec::new();
        if self.nodes.is_empty() {
            return out;
        }
        let mut stack = vec![(0usize, 0usize)];
        while let Some((n, depth)) = stack.pop() {
            out.push((n, depth));
            let node = &self.nodes[n];
            if node.file.is_none() && !collapsed.contains(&node.path) {
                for &c in node.children.iter().rev() {
                    stack.push((c, depth + 1));
                }
            }
        }
        out
    }

    /// Indices of the files at or below node `n`.
    fn files_under(&self, n: usize, out: &mut Vec<usize>) {
        let node = &self.nodes[n];
        if let Some(f) = node.file {
            out.push(f);
        }
        for &c in &node.children {
            self.files_under(c, out);
        }
    }

    fn folders(&self) -> impl Iterator<Item = &Node> {
        self.nodes.iter().skip(1).filter(|n| n.file.is_none())
    }
}

/// The changes pane of one Log tab.
#[derive(Default)]
pub struct ChangesPane {
    /// The selection (sorted) the shown files belong to.
    key: Vec<Oid>,
    /// The selection whose files were asked for last.
    requested: Option<Vec<Oid>>,
    files: Vec<ChangedFile>,
    error: Option<String>,
    tree: Tree,
    /// Collapsed folders by path. Everything starts expanded.
    collapsed: HashSet<PathBuf>,
    /// Selected rows by path; files or folders.
    selected: Vec<PathBuf>,
    anchor: Option<PathBuf>,
    scroll_to: Option<usize>,
    view_offset: f32,
    view_height: f32,
    /// The horizontal scroll offset as of the last frame.
    scroll_x: f32,
}

impl ChangesPane {
    /// The horizontal scroll offset as of the last frame (long paths scroll sideways).
    pub fn scroll_x(&self) -> f32 {
        self.scroll_x
    }

    /// The files of the current selection, once loaded.
    pub fn files(&self) -> Option<&[ChangedFile]> {
        (self.requested.as_ref() == Some(&self.key) && self.error.is_none()).then_some(self.files.as_slice())
    }

    /// The visible tree rows.
    pub fn rows(&self) -> Vec<ChangeRow> {
        self.tree
            .rows(&self.collapsed)
            .into_iter()
            .map(|(n, depth)| {
                let node = &self.tree.nodes[n];
                let file = node.file.map(|f| &self.files[f]);
                ChangeRow {
                    depth,
                    name: node.name.clone(),
                    path: node.path.clone(),
                    is_dir: file.is_none(),
                    count: node.count,
                    kind: file.map(|f| f.kind),
                    old_path: file.and_then(|f| f.old_path.clone()),
                    expanded: file.is_none() && !self.collapsed.contains(&node.path),
                }
            })
            .collect()
    }

    /// Paths of the selected rows.
    pub fn selected_rows(&self) -> &[PathBuf] {
        &self.selected
    }

    pub(super) fn set_files(&mut self, key: Vec<Oid>, result: Result<Vec<ChangedFile>, String>) {
        if self.requested.as_ref() != Some(&key) {
            return;
        }
        let same = key == self.key;
        self.key = key;
        match result {
            Ok(files) => {
                self.tree = build_tree(&files);
                self.files = files;
                self.error = None;
            }
            Err(e) => {
                self.files.clear();
                self.tree = Tree::default();
                self.error = Some(e);
            }
        }
        if !same {
            self.collapsed.clear();
            self.selected.clear();
            self.anchor = None;
        }
    }

    /// The files a context-menu action works on: the selected files, and the files below the
    /// selected folders.
    fn target_files(&self) -> Vec<ChangedFile> {
        let mut idx = Vec::new();
        for (n, node) in self.tree.nodes.iter().enumerate() {
            if self.selected.contains(&node.path) {
                self.tree.files_under(n, &mut idx);
            }
        }
        idx.sort_unstable();
        idx.dedup();
        idx.into_iter().map(|i| self.files[i].clone()).collect()
    }

    fn click_row(&mut self, rows: &[ChangeRow], i: usize, command: bool, shift: bool) {
        let path = rows[i].path.clone();
        let anchor = self.anchor.as_ref().and_then(|a| rows.iter().position(|r| &r.path == a));
        match anchor {
            Some(a) if shift => {
                let (lo, hi) = (a.min(i), a.max(i));
                self.selected = rows[lo..=hi].iter().map(|r| r.path.clone()).collect();
            }
            _ if command => {
                if let Some(p) = self.selected.iter().position(|s| *s == path) {
                    self.selected.remove(p);
                } else {
                    self.selected.push(path.clone());
                }
                self.anchor = Some(path);
            }
            _ => {
                self.selected = vec![path.clone()];
                self.anchor = Some(path);
            }
        }
    }

    fn toggle(&mut self, path: &Path) {
        if !self.collapsed.remove(path) {
            self.collapsed.insert(path.to_path_buf());
        }
    }
}

/// What a context-menu entry (or a key) of the changes tree does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileAction {
    ShowDiff,
    CompareWithLocal,
    EditSource,
    CherryPick,
    CreatePatch,
    CopyPatch,
}

pub(super) fn show(state: &mut AppState, view: &mut LogView, ui: &mut Ui) {
    let mut key = view.selection.clone();
    key.sort();
    if key.is_empty() {
        ui.add_space(6.0);
        ui.label(RichText::new("Select a commit to see its changes.").color(theme::T.text_dim));
        return;
    }
    if view.changes.requested.as_ref() != Some(&key) {
        view.changes.requested = Some(key.clone());
        log::load_changes(state, view.id, key);
    }

    let mut expand_all = false;
    let mut collapse_all = false;
    let (bar, _) = ui.allocate_exact_size(vec2(ui.available_width(), 30.0), Sense::hover());
    let mut right = ui.new_child(egui::UiBuilder::new().max_rect(bar).layout(Layout::right_to_left(Align::Center)));
    if crate::layout::icon_button(&mut right, Icon::CollapseAll, "Collapse All", "Collapse All").clicked() {
        collapse_all = true;
    }
    if crate::layout::icon_button(&mut right, Icon::ExpandAll, "Expand All", "Expand All").clicked() {
        expand_all = true;
    }
    if view.selection.len() > 1 {
        let mut left = ui.new_child(egui::UiBuilder::new().max_rect(bar).layout(Layout::left_to_right(Align::Center)));
        left.add_space(4.0);
        left.label(RichText::new(format!("{} commits selected", view.selection.len())).size(theme::T.font.small).color(theme::T.text_dim));
    }
    let pane = &mut view.changes;
    if expand_all {
        pane.collapsed.clear();
    }
    if collapse_all {
        pane.collapsed = pane.tree.folders().map(|n| n.path.clone()).collect();
    }

    let oids = view.selection_oldest_first();
    egui::CentralPanel::default().frame(Frame::NONE).show_inside(ui, |ui| {
        if let Some(e) = &view.changes.error {
            ui.label(RichText::new(e).color(theme::T.error));
            return;
        }
        if view.changes.requested.as_ref() != Some(&view.changes.key) && view.changes.files.is_empty() {
            ui.label(RichText::new("Loading...").color(theme::T.text_dim));
            return;
        }
        if view.changes.files.is_empty() {
            ui.label(RichText::new("No changed files.").color(theme::T.text_dim));
            return;
        }
        if let Some((action, files)) = tree(state, view.id, &mut view.changes, ui) {
            run_file_action(state, oids, files, action);
        }
    });
}

/// The dim text after a row's name: a folder's file count, a renamed file's old name.
fn row_extra(row: &ChangeRow) -> Option<String> {
    if row.is_dir {
        Some(format!("{} file{}", row.count, if row.count == 1 { "" } else { "s" }))
    } else {
        // A rename in the same folder shows the old name, a move the old path.
        row.old_path.as_ref().map(|o| if o.parent() == row.path.parent() { format!("← {}", o.file_name().unwrap_or_default().to_string_lossy()) } else { format!("← {}", o.display()) })
    }
}

/// The width a row needs: indent, icon, name, the dim extra text and a margin.
fn row_width(fonts: &egui::text::Fonts, row: &ChangeRow, name: &str) -> f32 {
    let t = &theme::T;
    let measure = |s: String| fonts.layout_no_wrap(s, t.ui_font(), t.text).size().x;
    let extra = row_extra(row).map_or(0.0, |e| 8.0 + measure(e));
    4.0 + row.depth as f32 * t.space.indent + 34.0 + measure(name.to_string()) + extra + 12.0
}

/// The focus id of a view's changes tree.
fn focus_id(view_id: u64) -> Id {
    crate::workspace::wid(("git-changes-tree", view_id))
}

fn tree(state: &mut AppState, view_id: u64, pane: &mut ChangesPane, ui: &mut Ui) -> Option<(FileAction, Vec<ChangedFile>)> {
    let t = &theme::T;
    let rows = pane.rows();
    let focus = focus_id(view_id);
    let focused = ui.memory(|m| m.has_focus(focus));
    let mut action: Option<FileAction> = None;
    if focused && !ui.ctx().is_context_menu_open() {
        action = keyboard(pane, &rows, ui);
    }
    let clicks = state.clicks;
    // Files at the top of the repository: the root row shows the repository folder.
    let root_name = state.ws.git.repo.as_ref().and_then(|r| r.workdir().file_name()).map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let (command, shift) = ui.input(|i| (i.modifiers.command, i.modifiers.shift));
    let row_h = t.space.row_h;
    // Long paths scroll sideways. Drag-to-scroll stays off: a press selects a row.
    let mut area = ScrollArea::both().id_salt(("git-changes-rows", view_id)).auto_shrink([false, false]).drag_to_scroll(false);
    if let Some(i) = pane.scroll_to.take() {
        let top = i as f32 * row_h;
        if top < pane.view_offset {
            area = area.vertical_scroll_offset(top);
        } else if top + row_h > pane.view_offset + pane.view_height {
            area = area.vertical_scroll_offset(top + row_h - pane.view_height);
        }
    }
    let mut pressed: Option<usize> = None;
    let mut right: Option<usize> = None;
    let mut toggle: Option<PathBuf> = None;
    let mut menu: Option<FileAction> = None;
    ui.spacing_mut().item_spacing.y = 0.0;
    let view = ui.available_rect_before_wrap();
    let content_w = ui.fonts(|f| rows.iter().enumerate().map(|(i, r)| row_width(f, r, if i == 0 && r.name.is_empty() { &root_name } else { &r.name })).fold(0.0, f32::max));
    let out = area.show_rows(ui, row_h, rows.len(), |ui, range| {
        for i in range {
            let row = &rows[i];
            // As wide as the widest row, so the content scrolls sideways; clicks and the
            // highlight cover the visible part (`branch_tree::visible_part`).
            let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width().max(content_w), row_h), Sense::hover());
            let hit = super::branch_tree::visible_part(rect, view);
            let resp = ui.interact(hit, crate::workspace::wid(("git-change-row", view_id, &row.path)), Sense::click());
            let selected = pane.selected.contains(&row.path);
            let name = if i == 0 && row.name.is_empty() { root_name.as_str() } else { row.name.as_str() };
            let label = match (i, row.is_dir) {
                (0, _) => format!("Changes root {name}"),
                (_, true) => format!("Changes folder {}", row.name),
                (_, false) => format!("Changed file {}", row.path.display()),
            };
            crate::util::label_selectable(&resp, label, selected);
            let x = rect.min.x + 4.0 + row.depth as f32 * t.space.indent;
            let cy = rect.center().y;
            let chevron_cell = row.is_dir.then(|| Rect::from_min_max(pos2(x - 3.0, rect.min.y), pos2(x + 15.0, rect.max.y)));
            let painter = ui.painter();
            if selected {
                painter.rect_filled(hit, t.radius.row, if focused { t.tree_selection } else { t.tree_selection_inactive });
            } else if resp.hovered() {
                painter.rect_filled(hit, t.radius.row, t.tree_hover);
            }
            if row.is_dir {
                icons::tree_chevron(painter, pos2(x + 6.0, cy), row.expanded, t.tree_chevron);
                icons::folder(painter, pos2(x + 22.0, cy), 15.0);
            } else {
                icons::file(painter, pos2(x + 22.0, cy), 14.0, &row.name);
            }
            let color = match row.kind {
                Some(k) => crate::tree::change_color(k),
                None => t.text,
            };
            let clip = painter.with_clip_rect(rect.intersect(painter.clip_rect()));
            let name_rect = clip.text(pos2(x + 34.0, cy), Align2::LEFT_CENTER, name, t.ui_font(), color);
            if let Some(extra) = row_extra(row) {
                clip.text(pos2(name_rect.right() + 8.0, cy), Align2::LEFT_CENTER, extra, t.ui_font(), t.text_dim);
            }
            let on_chevron = chevron_cell.zip(resp.interact_pointer_pos()).is_some_and(|(c, p)| c.contains(p));
            if resp.is_pointer_button_down_on() && ui.input(|inp| inp.pointer.primary_pressed()) && !on_chevron {
                pressed = Some(i);
            }
            let double = clicks.double(&resp);
            if resp.clicked() && on_chevron && !double {
                toggle = Some(row.path.clone());
            }
            if double && !on_chevron {
                if row.is_dir {
                    toggle = Some(row.path.clone());
                } else {
                    menu = Some(FileAction::ShowDiff);
                }
            }
            if resp.secondary_clicked() {
                right = Some(i);
            }
            resp.context_menu(|ui| {
                ui.set_min_width(260.0);
                let mut item = |ui: &mut Ui, button: egui::Button, a: FileAction| {
                    if ui.add(button).clicked() {
                        menu = Some(a);
                        ui.close_menu();
                    }
                };
                item(ui, egui::Button::new("Show Diff"), FileAction::ShowDiff);
                item(ui, egui::Button::new("Compare with Local"), FileAction::CompareWithLocal);
                item(ui, egui::Button::new("Edit Source").shortcut_text("F4"), FileAction::EditSource);
                ui.separator();
                item(ui, egui::Button::new("Cherry-Pick Selected Changes"), FileAction::CherryPick);
                ui.separator();
                item(ui, egui::Button::new("Create Patch..."), FileAction::CreatePatch);
                item(ui, egui::Button::new("Copy Patch"), FileAction::CopyPatch);
            });
        }
    });
    pane.view_offset = out.state.offset.y;
    pane.scroll_x = out.state.offset.x;
    pane.view_height = out.inner_rect.height();
    if let Some(i) = pressed {
        pane.click_row(&rows, i, command, shift);
    }
    if let Some(i) = right {
        if !pane.selected.contains(&rows[i].path) {
            pane.selected = vec![rows[i].path.clone()];
            pane.anchor = Some(rows[i].path.clone());
        }
    }
    if let Some(p) = toggle {
        pane.toggle(&p);
    }
    let node = ui.interact(out.inner_rect, focus, Sense::focusable_noninteractive());
    crate::util::label_widget(&node, egui::WidgetType::Other, "Changes tree");
    if pressed.is_some() || right.is_some() {
        ui.memory_mut(|m| m.request_focus(focus));
    }
    let action = menu.or(action)?;
    let files = pane.target_files();
    (!files.is_empty()).then_some((action, files))
}

fn keyboard(pane: &mut ChangesPane, rows: &[ChangeRow], ui: &mut Ui) -> Option<FileAction> {
    let (key, shift) = ui.input_mut(|i| {
        let mut take = |k: Key| i.consume_key(Modifiers::SHIFT, k).then_some((k, true)).or_else(|| i.consume_key(Modifiers::NONE, k).then_some((k, false)));
        [Key::ArrowUp, Key::ArrowDown, Key::ArrowLeft, Key::ArrowRight, Key::Enter, Key::F4].into_iter().find_map(&mut take)
    })?;
    let cur = pane.selected.last().and_then(|s| rows.iter().position(|r| &r.path == s));
    match key {
        Key::Enter => return Some(FileAction::ShowDiff),
        Key::F4 => return Some(FileAction::EditSource),
        Key::ArrowLeft | Key::ArrowRight => {
            let row = &rows[cur?];
            if row.is_dir && row.expanded == (key == Key::ArrowLeft) {
                pane.toggle(&row.path.clone());
            } else if key == Key::ArrowLeft {
                // On a file or a collapsed folder, Left goes to the parent row.
                let parent = rows[..cur?].iter().rposition(|r| r.depth < row.depth);
                if let Some(p) = parent {
                    pane.selected = vec![rows[p].path.clone()];
                    pane.anchor = pane.selected.first().cloned();
                    pane.scroll_to = Some(p);
                }
            }
            return None;
        }
        _ => {}
    }
    if rows.is_empty() {
        return None;
    }
    let next = match (key, cur) {
        (Key::ArrowUp, Some(c)) => c.saturating_sub(1),
        (Key::ArrowDown, Some(c)) => (c + 1).min(rows.len() - 1),
        _ => 0,
    };
    let anchor = pane.anchor.as_ref().and_then(|a| rows.iter().position(|r| &r.path == a));
    match anchor {
        Some(a) if shift => {
            let (lo, hi) = (a.min(next), a.max(next));
            let mut sel: Vec<PathBuf> = (lo..=hi).filter(|&r| r != next).map(|r| rows[r].path.clone()).collect();
            sel.push(rows[next].path.clone());
            pane.selected = sel;
        }
        _ => {
            pane.selected = vec![rows[next].path.clone()];
            pane.anchor = Some(rows[next].path.clone());
        }
    }
    pane.scroll_to = Some(next);
    None
}

/// Runs a file action on `files` of the selected commits (`oids`, oldest first).
pub fn run_file_action(state: &mut AppState, oids: Vec<Oid>, files: Vec<ChangedFile>, action: FileAction) {
    let Some(repo) = state.ws.git.repo.clone() else { return };
    let paths: Vec<PathBuf> = files.iter().map(|f| f.path.clone()).collect();
    match action {
        FileAction::ShowDiff => {
            for f in files.iter().take(MAX_DIFF_TABS) {
                super::diff::open_commits_diff(state, &oids, &f.path);
            }
        }
        FileAction::CompareWithLocal => {
            let Some(newest) = oids.last() else { return };
            let rev = newest.to_string();
            for f in files.iter().take(MAX_DIFF_TABS) {
                super::diff::open_rev_local_diff(state, &rev, &f.path);
            }
        }
        FileAction::EditSource => {
            // A file the commits deleted may be gone; the editor reports a missing file itself.
            for f in files.iter().filter(|f| f.kind != ChangeKind::Deleted).take(MAX_DIFF_TABS) {
                let abs = repo.workdir().join(&f.path);
                state.open_location(&abs, None, true);
            }
        }
        FileAction::CherryPick => {
            let n = paths.len();
            let body = format!("Applied {n} file(s) to the working tree");
            super::remote::run_op(state, "Cherry-Pick Selected Changes", body, true, move |r| cherry_pick_files(r, &oids, &paths), |_, _| {});
        }
        FileAction::CreatePatch => log::open_patch_dialog(state, oids, paths),
        FileAction::CopyPatch => {
            state.jobs.spawn(
                "Copy Patch",
                move || repo.patch(&oids, &paths).map_err(|e| e.to_string()),
                |state, res| match res {
                    Ok(text) => {
                        let ctx = state.ctx.clone();
                        state.platform.copy_text(&ctx, &text);
                        state.notifications.info("Patch copied", format!("{} lines on the clipboard", text.lines().count()));
                    }
                    Err(e) => state.notifications.error("Copy Patch failed", e),
                },
            );
        }
    }
}

/// Applies `paths` of each commit, oldest first. A commit that does not touch any of them is
/// skipped; a conflict stops the run with the files left in conflict.
fn cherry_pick_files(repo: &ide_git::Repo, oids: &[Oid], paths: &[PathBuf]) -> ide_git::Result<Option<ide_git::CommandOutcome>> {
    let mut last = None;
    for oid in oids {
        let touched: Vec<PathBuf> = repo.changes_of(std::slice::from_ref(oid))?.into_iter().filter(|f| paths.contains(&f.path) || f.old_path.as_ref().is_some_and(|o| paths.contains(o))).map(|f| f.path).collect();
        if touched.is_empty() {
            continue;
        }
        let out = repo.cherry_pick_paths(oid, &touched)?;
        let failed = !out.success;
        last = Some(out);
        if failed {
            break;
        }
    }
    Ok(last)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(path: &str, kind: ChangeKind) -> ChangedFile {
        ChangedFile { path: PathBuf::from(path), old_path: None, kind }
    }

    #[test]
    fn root_is_common_folder_and_chains_merge() {
        let files = vec![
            f("web/ui/index.html", ChangeKind::Modified),
            f("web/ui/src/scene/board.ts", ChangeKind::Modified),
            f("web/ui/src/scene/gl.ts", ChangeKind::Added),
        ];
        let tree = build_tree(&files);
        let pane = ChangesPane { files: files.clone(), tree, ..ChangesPane::default() };
        let rows: Vec<(usize, String, usize)> = pane.rows().into_iter().map(|r| (r.depth, r.name, r.count)).collect();
        assert_eq!(rows, [(0, "web/ui".into(), 3), (1, "src/scene".into(), 2), (2, "board.ts".into(), 1), (2, "gl.ts".into(), 1), (1, "index.html".into(), 1)]);
    }

    #[test]
    fn files_at_the_top_have_an_empty_root() {
        let tree = build_tree(&[f("a.txt", ChangeKind::Added), f("b/c.txt", ChangeKind::Deleted)]);
        assert_eq!(tree.nodes[0].name, "");
        assert_eq!(tree.nodes[0].count, 2);
    }
}
