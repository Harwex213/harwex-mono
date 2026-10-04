//! Branch tree on the left of a Log tab: search, HEAD, Local, Remote, Tags. Task 028 owns this file.
//!
//! `build_rows` is pure: it turns the branch list, the favourites, the search text and the
//! toggled folders into flat rows. `show` draws them, handles the keys and returns `TreeAction`s;
//! the Git window applies them (filter the tab's log, run a branch operation on a worker).

use std::collections::{BTreeMap, BTreeSet, HashSet};

use egui::{pos2, vec2, Id, Key, Rect, RichText, ScrollArea, Sense, TextEdit, Ui};
use ide_git::{Branches, TagInfo};

use crate::icons;
use crate::state::AppState;
use crate::theme;

/// The branch list and the tags of the repository, loaded together on a worker.
pub struct Refs {
    pub branches: Branches,
    pub tags: Vec<TagInfo>,
}

/// One Log tab's tree: what is typed, folded and selected.
#[derive(Default)]
pub struct TreeState {
    pub query: String,
    /// Keys whose expansion differs from the default (`default_expanded`).
    toggled: HashSet<String>,
    pub selected: Option<String>,
    /// Scroll the selected row into view on the next frame (after a key press).
    scroll_to_selected: bool,
    /// Re-request the focus on the next frame (see the arrow-key trap in app/CLAUDE.md).
    focus_next: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RowKind {
    Head,
    Group,
    Folder,
    Branch(BranchRow),
    Tag(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BranchRow {
    /// Full name: `agent/x` or `origin/agent/x`.
    pub name: String,
    pub remote: bool,
    pub current: bool,
    pub favorite: bool,
    pub ahead: usize,
    pub behind: usize,
    /// The remote branch a local branch tracks (`origin/main`).
    pub upstream: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Row {
    /// Unique and stable: `HEAD`, `g:local`, `f:local/agent`, `refs/heads/agent/x`, ...
    pub key: String,
    pub depth: usize,
    /// The text drawn: the last segment of a branch or folder.
    pub text: String,
    pub kind: RowKind,
    /// Some for rows that fold.
    pub expanded: Option<bool>,
}

impl Row {
    /// The accessibility label (tests click rows by it).
    pub fn label(&self) -> String {
        match &self.kind {
            RowKind::Head => "HEAD (Current Branch)".to_string(),
            RowKind::Group => format!("Tree group {}", self.text),
            RowKind::Folder => format!("Tree folder {}", folder_path(&self.key)),
            RowKind::Branch(b) if b.remote => format!("Tree remote branch {}", b.name),
            RowKind::Branch(b) => format!("Tree branch {}", b.name),
            RowKind::Tag(name) => format!("Tree tag {name}"),
        }
    }

    /// What a click or Enter filters the log by.
    pub fn filter(&self) -> Option<Vec<String>> {
        match &self.kind {
            RowKind::Head => Some(vec!["HEAD".to_string()]),
            RowKind::Branch(b) => Some(vec![b.name.clone()]),
            RowKind::Tag(name) => Some(vec![name.clone()]),
            _ => None,
        }
    }
}

/// `f:local/agent/sub` -> `agent/sub`, `f:remote/origin/agent` -> `origin/agent`.
fn folder_path(key: &str) -> &str {
    let rest = key.strip_prefix("f:").unwrap_or(key);
    rest.split_once('/').map_or(rest, |(_, p)| p)
}

/// Favourite key of a branch: its full ref name, so a local and a remote branch never clash.
pub fn favorite_key(name: &str, remote: bool) -> String {
    if remote {
        format!("refs/remotes/{name}")
    } else {
        format!("refs/heads/{name}")
    }
}

fn default_expanded(key: &str) -> bool {
    !matches!(key, "g:remote" | "g:tags")
}

impl TreeState {
    fn is_expanded(&self, key: &str) -> bool {
        default_expanded(key) != self.toggled.contains(key)
    }

    pub fn set_expanded(&mut self, key: &str, expanded: bool) {
        if expanded == default_expanded(key) {
            self.toggled.remove(key);
        } else {
            self.toggled.insert(key.to_string());
        }
    }
}

/// A folder level while the rows are built.
#[derive(Default)]
struct Node {
    folders: BTreeMap<String, Node>,
    leaves: Vec<(String, RowKind)>,
}

impl Node {
    fn insert(&mut self, segments: &[&str], text: String, kind: RowKind) {
        match segments.split_first() {
            None => self.leaves.push((text, kind)),
            Some((first, rest)) => self.folders.entry(first.to_string()).or_default().insert(rest, text, kind),
        }
    }

    /// Favourites first, then folders, then the other leaves, like IDEA.
    fn emit(&self, prefix: &str, depth: usize, tree: &TreeState, searching: bool, out: &mut Vec<Row>) {
        let leaf = |(text, kind): &(String, RowKind), out: &mut Vec<Row>| {
            let key = match kind {
                RowKind::Branch(b) => favorite_key(&b.name, b.remote),
                RowKind::Tag(name) => format!("refs/tags/{name}"),
                _ => text.clone(),
            };
            out.push(Row { key, depth, text: text.clone(), kind: kind.clone(), expanded: None });
        };
        let is_fav = |k: &RowKind| matches!(k, RowKind::Branch(b) if b.favorite);
        for l in self.leaves.iter().filter(|l| is_fav(&l.1)) {
            leaf(l, out);
        }
        for (name, node) in &self.folders {
            let key = format!("f:{prefix}/{name}");
            let expanded = searching || tree.is_expanded(&key);
            out.push(Row { key: key.clone(), depth, text: name.clone(), kind: RowKind::Folder, expanded: Some(expanded) });
            if expanded {
                node.emit(&format!("{prefix}/{name}"), depth + 1, tree, searching, out);
            }
        }
        for l in self.leaves.iter().filter(|l| !is_fav(&l.1)) {
            leaf(l, out);
        }
    }
}

pub fn build_rows(refs: &Refs, favorites: &BTreeSet<String>, tree: &TreeState) -> Vec<Row> {
    let query = tree.query.trim().to_lowercase();
    let searching = !query.is_empty();
    let matches = |name: &str| !searching || name.to_lowercase().contains(&query);
    let mut out = Vec::new();
    if !searching || "head".contains(&query) {
        out.push(Row { key: "HEAD".into(), depth: 0, text: "HEAD (Current Branch)".into(), kind: RowKind::Head, expanded: None });
    }
    let group = |key: &str, title: &str, node: Node, out: &mut Vec<Row>| {
        if searching && node.folders.is_empty() && node.leaves.is_empty() {
            return;
        }
        let expanded = searching || tree.is_expanded(key);
        out.push(Row { key: key.into(), depth: 0, text: title.into(), kind: RowKind::Group, expanded: Some(expanded) });
        if expanded {
            node.emit(key.trim_start_matches("g:"), 1, tree, searching, out);
        }
    };
    let branch_node = |list: &[ide_git::BranchInfo], remote: bool| {
        let mut node = Node::default();
        for b in list.iter().filter(|b| matches(&b.name)) {
            let segments: Vec<&str> = b.name.split('/').collect();
            let (text, folders) = segments.split_last().expect("split yields one item");
            let row = BranchRow {
                name: b.name.clone(),
                remote,
                current: b.is_current,
                favorite: favorites.contains(&favorite_key(&b.name, remote)),
                ahead: b.ahead,
                behind: b.behind,
                upstream: b.upstream.clone(),
            };
            node.insert(folders, text.to_string(), RowKind::Branch(row));
        }
        node
    };
    group("g:local", "Local", branch_node(&refs.branches.local, false), &mut out);
    group("g:remote", "Remote", branch_node(&refs.branches.remote, true), &mut out);
    let mut tags = Node::default();
    for t in refs.tags.iter().filter(|t| matches(&t.name)) {
        tags.leaves.push((t.name.clone(), RowKind::Tag(t.name.clone())));
    }
    group("g:tags", "Tags", tags, &mut out);
    out
}

/// What the user asked for in the tree; the Git window applies it after the frame.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TreeAction {
    Filter(Vec<String>),
    Checkout(String),
    NewBranchFrom(String),
    Compare(String),
    DiffWithWorkingTree(String),
    Merge(String),
    Rebase(String),
    Update,
    /// Opens the push dialog for this local branch; it need not be checked out.
    Push(String),
    Rename(String),
    Delete { name: String, remote: bool, upstream: Option<String> },
    ToggleFavorite(String),
    DeleteTag(String),
}

pub fn focus_id(tab: u64) -> Id {
    crate::workspace::wid(("git-branch-tree", tab))
}

/// The search field and the tree. `tab` keys the widget ids, so each Log tab has its own.
pub fn show(state: &mut AppState, tree: &mut TreeState, tab: u64, ui: &mut Ui) -> Vec<TreeAction> {
    let t = &theme::T;
    let mut actions = Vec::new();
    // The search field, with a magnifier inside like IDEA's "Branch or tag".
    ui.add_space(4.0);
    let search = ui.add(TextEdit::singleline(&mut tree.query).hint_text("Branch or tag").desired_width(f32::INFINITY).margin(egui::Margin { left: 28, right: 4, top: 3, bottom: 3 }).id(crate::workspace::wid(("git-branch-search", tab))));
    crate::util::label_widget(&search, egui::WidgetType::TextEdit, "Branch or tag");
    icons::paint(ui.painter(), Rect::from_center_size(pos2(ui.max_rect().min.x + 14.0, search.rect.center().y), vec2(14.0, 14.0)), icons::Icon::Search, t.text_dim);
    ui.add_space(4.0);

    let Some(repo_dir) = state.ws.git.repo.as_ref().map(|r| r.workdir().to_path_buf()) else { return actions };
    let win = &state.ws.git_ui.window;
    let Some(refs) = win.refs.as_ref() else {
        ui.label(RichText::new("Loading branches...").color(t.text_dim));
        return actions;
    };
    let empty = BTreeSet::new();
    let favorites = win.favorites.get(&repo_dir).unwrap_or(&empty);
    let rows = build_rows(refs, favorites, tree);
    let current_upstream = refs.branches.local.iter().find(|b| b.is_current).and_then(|b| b.upstream.clone());

    let fid = focus_id(tab);
    if std::mem::take(&mut tree.focus_next) {
        ui.memory_mut(|m| m.request_focus(fid));
    }
    let focused = ui.memory(|m| m.has_focus(fid));
    if focused {
        ui.memory_mut(|m| m.set_focus_lock_filter(fid, egui::EventFilter { tab: false, horizontal_arrows: true, vertical_arrows: true, escape: false }));
    }
    let menu_open = ui.ctx().is_context_menu_open();
    if focused && !menu_open && !search.has_focus() {
        keys(ui, tree, &rows, &mut actions);
    }

    let row_h = t.space.row_h;
    let clicks = state.clicks;
    let mut area = ScrollArea::vertical().auto_shrink([false, false]).id_salt(("git-branch-rows", tab));
    if std::mem::take(&mut tree.scroll_to_selected) {
        if let Some(i) = tree.selected.as_ref().and_then(|k| rows.iter().position(|r| &r.key == k)) {
            let off = ui.ctx().data(|d| d.get_temp::<f32>(crate::workspace::wid(("git-branch-offset", tab)))).unwrap_or(0.0);
            let (top, view) = (i as f32 * row_h, ui.available_height());
            if top < off {
                area = area.vertical_scroll_offset(top);
            } else if top + row_h > off + view {
                area = area.vertical_scroll_offset(top + row_h - view);
            }
        }
    }
    let total = ui.available_rect_before_wrap();
    // Keeps the focus without a click sense (see app/CLAUDE.md).
    let focus_resp = ui.interact(total, fid, Sense::focusable_noninteractive());
    let mut take_focus = false;
    let hole = t.island_bg;
    let out = area.show_rows(ui, row_h, rows.len(), |ui, range| {
        ui.spacing_mut().item_spacing.y = 0.0;
        for row in &rows[range] {
            let (_, rect) = ui.allocate_space(vec2(ui.available_width(), row_h));
            let resp = ui.interact(rect, crate::workspace::wid(("git-branch-row", tab, &row.key)), Sense::click());
            let selected = tree.selected.as_deref() == Some(row.key.as_str());
            crate::util::label_selectable(&resp, row.label(), selected);
            let painter = ui.painter();
            if selected {
                painter.rect_filled(rect, t.radius.row, if focused { t.tree_selection } else { t.tree_selection_inactive });
            } else if resp.hovered() {
                painter.rect_filled(rect, t.radius.row, t.tree_hover);
            }
            let x = rect.min.x + 4.0 + row.depth as f32 * t.space.indent;
            let cy = rect.center().y;
            if let Some(expanded) = row.expanded {
                icons::tree_chevron(painter, pos2(x + 6.0, cy), expanded, t.tree_chevron);
            }
            let text_x = match &row.kind {
                RowKind::Head | RowKind::Group => x + 20.0,
                RowKind::Folder => {
                    icons::folder(painter, pos2(x + 22.0, cy), 15.0);
                    x + 34.0
                }
                RowKind::Branch(b) => {
                    let c = pos2(x + 22.0, cy);
                    if b.current {
                        icons::tag(painter, c, 14.0, t.ref_current.1, hole);
                    } else if b.favorite {
                        icons::star(painter, c, 13.0, t.ref_current.1);
                    } else {
                        icons::paint(painter, Rect::from_center_size(c, vec2(14.0, 14.0)), icons::Icon::Branch, t.text_dim);
                    }
                    x + 34.0
                }
                RowKind::Tag(_) => {
                    icons::tag(painter, pos2(x + 22.0, cy), 13.0, t.text_dim, hole);
                    x + 34.0
                }
            };
            let g = painter.layout_no_wrap(row.text.clone(), t.ui_font(), t.text);
            let text_w = g.size().x;
            painter.galley(pos2(text_x, cy - g.size().y / 2.0), g, t.text);
            if let RowKind::Branch(b) = &row.kind {
                badges(ui, b, pos2(text_x + text_w + 8.0, cy));
            }

            // Press-based: a press selects and filters at once; egui reports no click for a
            // long press, and a double click must not undo anything.
            let pressed = resp.is_pointer_button_down_on() && ui.input(|i| i.pointer.primary_pressed());
            let on_chevron = row.expanded.is_some() && resp.interact_pointer_pos().is_some_and(|p| p.x < x + 14.0);
            if pressed {
                tree.selected = Some(row.key.clone());
                take_focus = true;
                if on_chevron {
                    tree.set_expanded(&row.key, !row.expanded.unwrap_or(false));
                } else if let Some(f) = row.filter() {
                    actions.push(TreeAction::Filter(f));
                }
            }
            if clicks.double(&resp) && !on_chevron {
                if let Some(e) = row.expanded {
                    tree.set_expanded(&row.key, !e);
                }
            }
            if resp.secondary_clicked() {
                tree.selected = Some(row.key.clone());
                take_focus = true;
            }
            match &row.kind {
                RowKind::Branch(b) => {
                    resp.context_menu(|ui| branch_menu(ui, b, current_upstream.as_deref(), &mut actions));
                }
                RowKind::Tag(name) => {
                    resp.context_menu(|ui| {
                        if ui.button("Checkout").clicked() {
                            actions.push(TreeAction::Checkout(name.clone()));
                            ui.close_menu();
                        }
                        if ui.button("Delete").clicked() {
                            actions.push(TreeAction::DeleteTag(name.clone()));
                            ui.close_menu();
                        }
                    });
                }
                _ => {}
            }
        }
    });
    ui.ctx().data_mut(|d| d.insert_temp(crate::workspace::wid(("git-branch-offset", tab)), out.state.offset.y));
    if take_focus {
        // Re-requested on the press frame, after the interact call (see `tree::show`).
        focus_resp.request_focus();
        tree.focus_next = true;
    }
    actions
}

/// `↗ N` unpushed and `↙ N` to pull, drawn after the branch name.
fn badges(ui: &Ui, b: &BranchRow, at: egui::Pos2) {
    let t = &theme::T;
    let mut x = at.x;
    for (n, up, color, what) in [(b.ahead, true, t.link, "to push"), (b.behind, false, t.git_added, "to pull")] {
        if n == 0 {
            continue;
        }
        let painter = ui.painter();
        let c = pos2(x + 5.0, at.y);
        let stroke = egui::Stroke::new(1.2_f32, color);
        // A diagonal arrow: up-right for push, down-left for pull.
        let (from, to) = if up { (c + vec2(-3.5, 3.5), c + vec2(3.5, -3.5)) } else { (c + vec2(3.5, -3.5), c + vec2(-3.5, 3.5)) };
        painter.line_segment([from, to], stroke);
        let s = if up { 1.0 } else { -1.0 };
        painter.line_segment([to, to + vec2(-4.0 * s, 0.0)], stroke);
        painter.line_segment([to, to + vec2(0.0, 4.0 * s)], stroke);
        let g = painter.layout_no_wrap(n.to_string(), t.small_font(), color);
        let w = g.size().x;
        painter.galley(pos2(x + 12.0, at.y - g.size().y / 2.0), g, color);
        let r = Rect::from_min_size(pos2(x, at.y - 7.0), vec2(12.0 + w, 14.0));
        let node = ui.interact(r, crate::workspace::wid(("git-branch-badge", &b.name, b.remote, up)), Sense::hover());
        crate::util::label_widget(&node, egui::WidgetType::Label, format!("{}: {n} {what}", b.name));
        x += 12.0 + w + 6.0;
    }
}

fn branch_menu(ui: &mut Ui, b: &BranchRow, current_upstream: Option<&str>, actions: &mut Vec<TreeAction>) {
    let mut item = |ui: &mut Ui, enabled: bool, text: &str, a: TreeAction| {
        if ui.add_enabled(enabled, egui::Button::new(text)).clicked() {
            actions.push(a);
            ui.close_menu();
        }
    };
    let n = b.name.clone();
    if !b.current {
        item(ui, true, "Checkout", TreeAction::Checkout(n.clone()));
    }
    item(ui, true, &format!("New Branch from '{n}'..."), TreeAction::NewBranchFrom(n.clone()));
    if !b.current {
        item(ui, true, "Compare with Current", TreeAction::Compare(n.clone()));
    }
    item(ui, true, "Show Diff with Working Tree", TreeAction::DiffWithWorkingTree(n.clone()));
    if !b.current {
        ui.separator();
        item(ui, true, &format!("Merge '{n}' into Current"), TreeAction::Merge(n.clone()));
        item(ui, true, &format!("Rebase Current onto '{n}'"), TreeAction::Rebase(n.clone()));
    }
    let tracked = b.remote && current_upstream == Some(n.as_str());
    if b.current || tracked {
        ui.separator();
        item(ui, true, if b.current { "Update" } else { "Pull into Current" }, TreeAction::Update);
    }
    if !b.remote {
        // A tracked branch with no commits ahead has nothing to push.
        let can_push = b.upstream.is_none() || b.ahead > 0;
        item(ui, can_push, "Push...", TreeAction::Push(n.clone()));
    }
    ui.separator();
    if !b.remote {
        item(ui, true, "Rename...", TreeAction::Rename(n.clone()));
    }
    if !b.current {
        item(ui, true, "Delete", TreeAction::Delete { name: n.clone(), remote: b.remote, upstream: b.upstream.clone() });
    }
    ui.separator();
    let fav = favorite_key(&n, b.remote);
    item(ui, true, if b.favorite { "Remove from Favorites" } else { "Add to Favorites" }, TreeAction::ToggleFavorite(fav));
}

/// Up/Down move, Left folds or goes to the parent, Right unfolds, Enter filters.
fn keys(ui: &Ui, tree: &mut TreeState, rows: &[Row], actions: &mut Vec<TreeAction>) {
    let none = egui::Modifiers::NONE;
    let (up, down, left, right, enter) = ui.input_mut(|i| {
        (i.consume_key(none, Key::ArrowUp), i.consume_key(none, Key::ArrowDown), i.consume_key(none, Key::ArrowLeft), i.consume_key(none, Key::ArrowRight), i.consume_key(none, Key::Enter))
    });
    if !(up || down || left || right || enter) {
        return;
    }
    let idx = tree.selected.as_ref().and_then(|k| rows.iter().position(|r| &r.key == k));
    let select = |tree: &mut TreeState, i: usize| {
        if let Some(r) = rows.get(i) {
            tree.selected = Some(r.key.clone());
            tree.scroll_to_selected = true;
        }
    };
    let Some(i) = idx else {
        if up || down {
            select(tree, 0);
        }
        return;
    };
    let row = &rows[i];
    if down {
        select(tree, (i + 1).min(rows.len().saturating_sub(1)));
    } else if up {
        select(tree, i.saturating_sub(1));
    } else if left {
        if row.expanded == Some(true) {
            tree.set_expanded(&row.key, false);
        } else if let Some(p) = rows[..i].iter().rposition(|r| r.depth < row.depth) {
            select(tree, p);
        }
    } else if right {
        match row.expanded {
            Some(false) => tree.set_expanded(&row.key, true),
            Some(true) => select(tree, i + 1),
            None => {}
        }
    } else if enter {
        match (row.filter(), row.expanded) {
            (Some(f), _) => actions.push(TreeAction::Filter(f)),
            (None, Some(e)) => tree.set_expanded(&row.key, !e),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ide_git::{BranchInfo, Oid};

    fn branch(name: &str, current: bool) -> BranchInfo {
        BranchInfo { name: name.into(), oid: Oid::zero(), upstream: None, ahead: 0, behind: 0, is_current: current, tip_time: 0 }
    }

    fn refs() -> Refs {
        let local = ["NAPI", "agent/ostrov-assets-01", "main", "prototype/ostrov", "prototype/deep/x"].iter().map(|n| branch(n, *n == "main")).collect();
        let remote = vec![branch("origin/main", false), branch("origin/agent/y", false)];
        Refs { branches: Branches { current: Some("main".into()), head: None, detached: false, local, remote, recent: vec![] }, tags: vec![] }
    }

    fn texts(rows: &[Row]) -> Vec<String> {
        rows.iter().map(|r| format!("{}{}", "  ".repeat(r.depth), r.text)).collect()
    }

    #[test]
    fn folders_by_prefix_and_favourites_first() {
        let mut favs = BTreeSet::new();
        favs.insert(favorite_key("main", false));
        let rows = build_rows(&refs(), &favs, &TreeState::default());
        assert_eq!(
            texts(&rows),
            ["HEAD (Current Branch)", "Local", "  main", "  agent", "    ostrov-assets-01", "  prototype", "    deep", "      x", "    ostrov", "  NAPI", "Remote", "Tags"]
        );
    }

    #[test]
    fn search_keeps_matches_and_their_folders() {
        let tree = TreeState { query: "OSTROV".into(), ..TreeState::default() };
        let rows = build_rows(&refs(), &BTreeSet::new(), &tree);
        assert_eq!(texts(&rows), ["Local", "  agent", "    ostrov-assets-01", "  prototype", "    ostrov"]);
        let tree = TreeState { query: "agent".into(), ..TreeState::default() };
        let rows = build_rows(&refs(), &BTreeSet::new(), &tree);
        assert_eq!(texts(&rows), ["Local", "  agent", "    ostrov-assets-01", "Remote", "  origin", "    agent", "      y"]);
    }

    #[test]
    fn toggling_folds() {
        let mut tree = TreeState::default();
        tree.set_expanded("g:remote", true);
        tree.set_expanded("f:local/prototype", false);
        let rows = build_rows(&refs(), &BTreeSet::new(), &tree);
        assert!(texts(&rows).contains(&"    main".to_string()), "{:?}", texts(&rows));
        assert!(!texts(&rows).contains(&"    ostrov".to_string()));
    }
}
