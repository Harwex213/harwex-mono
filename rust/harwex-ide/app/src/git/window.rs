//! Git tool window shell: header tabs (Log, Console, History, Compare), the branch tree on the
//! left of each Log tab, and the Log body from `log::log_body`. Task 028 owns this file.
//!
//! Tab 0 is the main Log tab and never closes. `+` adds a Log tab with clean filters. Console,
//! History, Compare with branch and Diff with Working Tree are temporary tabs. The tab strip lives
//! in the tool window's header (`header_tabs`); `⌄` lists every tab when they do not fit.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};

use egui::{pos2, vec2, Frame, Margin, Rect, RichText, ScrollArea, Sense, Ui};
use ide_git::{BranchCompare, ChangedFile, CommitInfo, Oid};

use super::branch_tree::{self, Refs, TreeAction, TreeState};
use super::console::ConsoleUi;
use super::log::{self, LogView};
use crate::icons::{self, Icon};
use crate::layout::ToolWindow;
use crate::state::AppState;
use crate::theme;

/// eframe storage key: one line per repository, `<workdir>\t<ref>\t<ref>...`.
pub const STORAGE_FAVORITES: &str = "git_favorite_branches";
const TAB_H: f32 = 24.0;
const BUTTON_W: f32 = 22.0;
const CLOSE_W: f32 = 16.0;

pub struct GitWindowUi {
    tabs: Vec<GitTab>,
    active: usize,
    next_id: u64,
    pub console: ConsoleUi,
    /// Favourite branches per repository workdir, as full ref names. Survives a project switch.
    pub favorites: HashMap<PathBuf, BTreeSet<String>>,
    pub refs: Option<Refs>,
    refs_loading: bool,
    /// The refs must be read again before the tree trusts them.
    refs_stale: bool,
}

impl Default for GitWindowUi {
    fn default() -> Self {
        GitWindowUi {
            tabs: vec![GitTab { id: 0, kind: TabKind::Log(Box::default()) }],
            active: 0,
            next_id: 1,
            console: ConsoleUi::default(),
            favorites: HashMap::new(),
            refs: None,
            refs_loading: false,
            refs_stale: true,
        }
    }
}

struct GitTab {
    id: u64,
    kind: TabKind,
}

#[derive(Default)]
pub struct LogTab {
    pub view: LogView,
    pub tree: TreeState,
}

enum TabKind {
    Log(Box<LogTab>),
    Console,
    /// One file's history, from `log::show_file_history` (picked up by `take_history`).
    History(Box<LogView>),
    Compare(Box<CompareTab>),
    WorktreeDiff(Box<WorktreeDiffTab>),
}

struct CompareTab {
    current: String,
    other: String,
    data: Option<Result<BranchCompare, String>>,
    selected: Option<Oid>,
    files: Option<(Oid, Result<Vec<ChangedFile>, String>)>,
}

struct WorktreeDiffTab {
    rev: String,
    files: Option<Result<Vec<ChangedFile>, String>>,
}

impl GitTab {
    fn title(&self) -> String {
        match &self.kind {
            TabKind::Log(l) => format!("Log: {}", l.view.filter_label()),
            TabKind::Console => "Console".to_string(),
            TabKind::History(v) => match v.filter().paths.first() {
                Some(p) => format!("History: {}", p.file_name().map_or_else(|| p.display().to_string(), |n| n.to_string_lossy().into_owned())),
                None => "History".to_string(),
            },
            TabKind::Compare(c) => format!("Compare with {}", c.other),
            TabKind::WorktreeDiff(d) => format!("Diff with {}", d.rev),
        }
    }
}

impl GitWindowUi {
    pub fn tab_titles(&self) -> Vec<String> {
        self.tabs.iter().map(GitTab::title).collect()
    }

    pub fn active(&self) -> usize {
        self.active
    }

    pub fn active_title(&self) -> String {
        self.tabs[self.active].title()
    }

    pub fn has_console(&self) -> bool {
        self.tabs.iter().any(|t| matches!(t.kind, TabKind::Console))
    }

    /// The Log tab at `index`, if that tab is a Log tab.
    pub fn log_tab(&self, index: usize) -> Option<&LogTab> {
        match &self.tabs.get(index)?.kind {
            TabKind::Log(l) => Some(l),
            _ => None,
        }
    }

    pub fn is_favorite(&self, workdir: &Path, name: &str, remote: bool) -> bool {
        self.favorites.get(workdir).is_some_and(|f| f.contains(&branch_tree::favorite_key(name, remote)))
    }

    /// Commits only on the current branch and only on the other one, once loaded.
    pub fn compare_counts(&self) -> Option<(usize, usize)> {
        self.tabs.iter().find_map(|t| match &t.kind {
            TabKind::Compare(c) => c.data.as_ref().and_then(|d| d.as_ref().ok()).map(|d| (d.only_current.len(), d.only_other.len())),
            _ => None,
        })
    }

    fn push_tab(&mut self, kind: TabKind, activate: bool) {
        let id = self.next_id;
        self.next_id += 1;
        self.tabs.push(GitTab { id, kind });
        if activate {
            self.active = self.tabs.len() - 1;
        }
    }

    fn close(&mut self, index: usize) {
        if index == 0 || index >= self.tabs.len() {
            return;
        }
        self.tabs.remove(index);
        if self.active >= index {
            self.active = self.active.saturating_sub(1).min(self.tabs.len() - 1);
        }
    }

    fn index_of(&self, id: u64) -> Option<usize> {
        self.tabs.iter().position(|t| t.id == id)
    }
}

/// A writing git command started: a closed Console tab comes back, without taking the focus.
pub fn reopen_console(state: &mut AppState) {
    let w = &mut state.ws.git_ui.window;
    if !w.has_console() {
        w.push_tab(TabKind::Console, false);
    }
}

/// Git > Show History (`log::show_file_history`) leaves a pending view; it becomes a History
/// tab, or activates the open History tab of the same path.
fn take_history(state: &mut AppState) {
    let Some(view) = log::take_file_history(state) else { return };
    let w = &mut state.ws.git_ui.window;
    let path = view.filter().paths.clone();
    match w.tabs.iter().position(|t| matches!(&t.kind, TabKind::History(v) if v.filter().paths == path)) {
        Some(i) => w.active = i,
        None => w.push_tab(TabKind::History(Box::new(view)), true),
    }
}

/// After `refresh_git`: branches may have moved, so the tree reads them again.
pub fn on_git_refreshed(state: &mut AppState) {
    state.ws.git_ui.window.refs_stale = true;
    if state.ws.layout.bottom == Some(ToolWindow::Git) {
        load_refs(state);
    }
}

fn load_refs(state: &mut AppState) {
    let w = &mut state.ws.git_ui.window;
    if w.refs_loading {
        return;
    }
    let Some(repo) = state.ws.git.repo.clone() else { return };
    w.refs_loading = true;
    w.refs_stale = false;
    let generation = state.project_generation();
    state.jobs.spawn_quiet(
        move || repo.branches().and_then(|b| Ok(Refs { branches: b, tags: repo.tags()? })),
        move |state, res| {
            if state.project_generation() != generation {
                return;
            }
            let w = &mut state.ws.git_ui.window;
            w.refs_loading = false;
            match res {
                Ok(r) => w.refs = Some(r),
                Err(e) => state.notifications.error("Cannot list branches", e.to_string()),
            }
            if state.ws.git_ui.window.refs_stale {
                load_refs(state);
            }
        },
    );
}

pub fn load_storage(state: &mut AppState, storage: &dyn eframe::Storage) {
    let Some(text) = storage.get_string(STORAGE_FAVORITES) else { return };
    for line in text.lines() {
        let mut parts = line.split('\t');
        let Some(dir) = parts.next().filter(|d| !d.is_empty()) else { continue };
        let set: BTreeSet<String> = parts.filter(|p| !p.is_empty()).map(str::to_string).collect();
        if !set.is_empty() {
            state.ws.git_ui.window.favorites.insert(PathBuf::from(dir), set);
        }
    }
}

pub fn save_storage(state: &AppState, storage: &mut dyn eframe::Storage) {
    let mut lines: Vec<String> = state
        .ws.git_ui
        .window
        .favorites
        .iter()
        .filter(|(_, set)| !set.is_empty())
        .map(|(dir, set)| std::iter::once(dir.display().to_string()).chain(set.iter().cloned()).collect::<Vec<_>>().join("\t"))
        .collect();
    lines.sort();
    storage.set_string(STORAGE_FAVORITES, lines.join("\n"));
}

// ---------------------------------------------------------------------------------------------
// Header

/// The tab strip in the tool window header, right of the "Git" title.
pub fn header_tabs(state: &mut AppState, ui: &mut Ui) {
    take_history(state);
    let t = &theme::T;
    ui.spacing_mut().item_spacing.x = 2.0;
    let w = &mut state.ws.git_ui.window;
    let font = t.ui_font();
    let tabs: Vec<(String, f32, bool)> = w
        .tabs
        .iter()
        .enumerate()
        .map(|(i, tab)| {
            let title = tab.title();
            let text_w = ui.painter().layout_no_wrap(title.clone(), font.clone(), t.text).size().x;
            let closable = i != 0;
            (title, 10.0 + text_w + if closable { 4.0 + CLOSE_W + 4.0 } else { 10.0 }, closable)
        })
        .collect();
    let gap = 2.0;
    let avail = ui.available_width();
    let total: f32 = tabs.iter().map(|x| x.1 + gap).sum();
    let overflow = total + BUTTON_W > avail;
    // Which tabs fit: from the left, keeping room for `+` and `⌄`; the active tab always shows.
    let mut visible: Vec<usize> = Vec::new();
    if overflow {
        let room = avail - 2.0 * (BUTTON_W + gap);
        let mut used = 0.0;
        for (i, tab) in tabs.iter().enumerate() {
            if used + tab.1 + gap > room {
                break;
            }
            used += tab.1 + gap;
            visible.push(i);
        }
        if !visible.contains(&w.active) {
            let need = tabs[w.active].1 + gap;
            while !visible.is_empty() && used + need > room {
                let last = visible.pop().expect("not empty");
                used -= tabs[last].1 + gap;
            }
            visible.push(w.active);
        }
    } else {
        visible = (0..tabs.len()).collect();
    }

    let mut activate = None;
    let mut close = None;
    for &i in &visible {
        let (title, width, closable) = &tabs[i];
        let (rect, _) = ui.allocate_exact_size(vec2(*width, TAB_H), Sense::hover());
        let id = w.tabs[i].id;
        let resp = ui.interact(rect, crate::workspace::wid(("git-window-tab", id)), Sense::click());
        let active = i == w.active;
        crate::util::label_selectable(&resp, format!("Git tab {title}"), active);
        let close_rect = Rect::from_center_size(pos2(rect.max.x - 4.0 - CLOSE_W / 2.0, rect.center().y), vec2(CLOSE_W, CLOSE_W));
        let close_resp = closable.then(|| {
            let r = ui.interact(close_rect, crate::workspace::wid(("git-window-tab-close", id)), Sense::click());
            crate::util::label_widget(&r, egui::WidgetType::Button, format!("Close {title}"));
            r
        });
        let close_hovered = close_resp.as_ref().is_some_and(|r| r.hovered());
        let painter = ui.painter();
        if active {
            painter.rect_filled(rect, t.radius.button, t.tab_active_bg);
        } else if resp.hovered() {
            painter.rect_filled(rect, t.radius.button, t.hover);
        }
        let color = if active { t.text_bright } else { t.text };
        painter.text(pos2(rect.min.x + 10.0, rect.center().y), egui::Align2::LEFT_CENTER, title, font.clone(), color);
        if *closable {
            if close_hovered {
                painter.rect_filled(close_rect, t.radius.small, t.button_hover);
            }
            icons::paint(painter, close_rect.shrink(3.0), Icon::Close, if close_hovered { t.icon_active } else { t.text_dim });
        }
        if close_resp.is_some_and(|r| r.clicked()) {
            close = Some(i);
        } else if resp.is_pointer_button_down_on() && ui.input(|inp| inp.pointer.primary_pressed()) {
            // Press-based, like IDEA's tabs.
            activate = Some(i);
        }
    }
    let plus = crate::layout::icon_button(ui, Icon::Plus, "New Log tab", "New Log tab");
    if plus.clicked() {
        w.push_tab(TabKind::Log(Box::default()), true);
    }
    if overflow {
        let more = crate::layout::icon_button(ui, Icon::ChevronDown, "Show all tabs", "Show all tabs");
        let popup_id = crate::workspace::wid("git-window-all-tabs");
        if more.clicked() {
            ui.memory_mut(|m| m.toggle_popup(popup_id));
        }
        egui::popup_below_widget(ui, popup_id, &more, egui::PopupCloseBehavior::CloseOnClick, |ui| {
            ui.set_min_width(200.0);
            for (i, (title, _, _)) in tabs.iter().enumerate() {
                let r = ui.selectable_label(i == w.active, title);
                crate::util::label_selectable(&r, format!("Switch to {title}"), i == w.active);
                if r.clicked() {
                    activate = Some(i);
                }
            }
        });
    }
    if let Some(i) = activate {
        w.active = i;
    }
    if let Some(i) = close {
        w.close(i);
    }
}

// ---------------------------------------------------------------------------------------------
// Body

pub fn tool_window(state: &mut AppState, ui: &mut Ui) {
    if state.ws.git.repo.is_none() {
        ui.label(RichText::new("The project is not inside a git repository.").color(theme::T.text_dim));
        return;
    }
    take_history(state);
    if state.ws.git_ui.window.refs_stale {
        load_refs(state);
    }
    let w = &mut state.ws.git_ui.window;
    w.active = w.active.min(w.tabs.len() - 1);
    let index = w.active;
    let id = w.tabs[index].id;
    // The tab leaves the list while it draws, so its body can take `&mut AppState`.
    let mut kind = std::mem::replace(&mut w.tabs[index].kind, TabKind::Console);
    let mut actions = Vec::new();
    match &mut kind {
        TabKind::Log(tab) => {
            egui::SidePanel::left(crate::workspace::wid(("git-branch-tree-panel", id)))
                .resizable(true)
                .default_width(240.0)
                .width_range(150.0..=600.0)
                .frame(Frame::NONE.inner_margin(Margin { left: 0, right: 6, top: 0, bottom: 0 }))
                .show_inside(ui, |ui| actions = branch_tree::show(state, &mut tab.tree, id, ui));
            egui::CentralPanel::default().frame(Frame::NONE.inner_margin(Margin { left: 6, right: 0, top: 0, bottom: 0 })).show_inside(ui, |ui| log::log_body(state, &mut tab.view, ui));
            for a in actions.iter() {
                if let TreeAction::Filter(f) = a {
                    tab.view.set_branches(f.clone());
                }
            }
        }
        TabKind::Console => super::console::body(state, ui),
        TabKind::History(view) => log::log_body(state, view, ui),
        TabKind::Compare(c) => compare_body(state, c, id, ui),
        TabKind::WorktreeDiff(d) => worktree_diff_body(state, d, ui),
    }
    if let Some(i) = state.ws.git_ui.window.index_of(id) {
        state.ws.git_ui.window.tabs[i].kind = kind;
    }
    for a in actions {
        apply(state, a);
    }
}

fn apply(state: &mut AppState, a: TreeAction) {
    use super::branches::{self, Action};
    match a {
        TreeAction::Filter(_) => {}
        TreeAction::Checkout(n) => branches::run_action(state, Action::Checkout(n)),
        TreeAction::NewBranchFrom(n) => branches::run_action(state, Action::NewFrom(Some(n))),
        TreeAction::Merge(n) => branches::run_action(state, Action::Merge(n)),
        TreeAction::Rebase(n) => branches::run_action(state, Action::Rebase(n)),
        TreeAction::RebaseUpdateRefs(n) => branches::run_action(state, Action::RebaseUpdateRefs(n)),
        TreeAction::Rename(n) => branches::run_action(state, Action::Rename(n)),
        TreeAction::Delete { name, remote, upstream } => branches::open_delete_dialog(state, name, remote, upstream),
        TreeAction::Update(n) => super::remote::update_branch(state, n),
        TreeAction::UpdateProject => super::remote::open_update_dialog(state),
        TreeAction::Fetch(remote) => super::remote::fetch(state, remote),
        TreeAction::Push(n) => super::remote::open_push_dialog_for(state, n),
        TreeAction::DeleteTag(n) => {
            let body = format!("Deleted tag {n}");
            super::remote::run_op(state, "Delete Tag", body, false, move |r| r.delete_tag(&n).map(|_| None), |_, _| {});
        }
        TreeAction::ToggleFavorite(key) => {
            let Some(dir) = state.ws.git.repo.as_ref().map(|r| r.workdir().to_path_buf()) else { return };
            let set = state.ws.git_ui.window.favorites.entry(dir).or_default();
            if !set.remove(&key) {
                set.insert(key);
            }
        }
        TreeAction::Compare(other) => open_compare(state, other),
        TreeAction::DiffWithWorkingTree(rev) => open_worktree_diff(state, rev),
    }
}

fn open_compare(state: &mut AppState, other: String) {
    let w = &mut state.ws.git_ui.window;
    if let Some(i) = w.tabs.iter().position(|t| matches!(&t.kind, TabKind::Compare(c) if c.other == other)) {
        w.active = i;
    } else {
        let current = state.ws.git.branch.clone().unwrap_or_else(|| "HEAD".into());
        w.push_tab(TabKind::Compare(Box::new(CompareTab { current, other: other.clone(), data: None, selected: None, files: None })), true);
    }
    let Some(repo) = state.ws.git.repo.clone() else { return };
    let id = state.ws.git_ui.window.tabs[state.ws.git_ui.window.active].id;
    state.jobs.spawn(
        format!("Comparing with {other}"),
        move || repo.compare_with_branch(&other).map_err(|e| e.to_string()),
        move |state, res| {
            if let Some(TabKind::Compare(c)) = tab_kind_mut(state, id) {
                c.data = Some(res);
            }
        },
    );
}

fn open_worktree_diff(state: &mut AppState, rev: String) {
    let w = &mut state.ws.git_ui.window;
    if let Some(i) = w.tabs.iter().position(|t| matches!(&t.kind, TabKind::WorktreeDiff(d) if d.rev == rev)) {
        w.active = i;
    } else {
        w.push_tab(TabKind::WorktreeDiff(Box::new(WorktreeDiffTab { rev: rev.clone(), files: None })), true);
    }
    let Some(repo) = state.ws.git.repo.clone() else { return };
    let id = state.ws.git_ui.window.tabs[state.ws.git_ui.window.active].id;
    state.jobs.spawn(
        format!("Comparing {rev} with the working tree"),
        move || repo.diff_with_working_tree(&rev).map_err(|e| e.to_string()),
        move |state, res| {
            if let Some(TabKind::WorktreeDiff(d)) = tab_kind_mut(state, id) {
                d.files = Some(res);
            }
        },
    );
}

fn tab_kind_mut(state: &mut AppState, id: u64) -> Option<&mut TabKind> {
    let w = &mut state.ws.git_ui.window;
    let i = w.index_of(id)?;
    Some(&mut w.tabs[i].kind)
}

fn commit_row(ui: &mut Ui, c: &CommitInfo, selected: bool) -> egui::Response {
    let t = &theme::T;
    let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), t.space.row_h), Sense::click());
    crate::util::label_selectable(&resp, format!("Commit {}", c.summary), selected);
    let painter = ui.painter();
    if selected {
        painter.rect_filled(rect, t.radius.row, t.selection);
    } else if resp.hovered() {
        painter.rect_filled(rect, t.radius.row, t.tree_hover);
    }
    let cy = rect.center().y;
    let clip = painter.with_clip_rect(rect.intersect(ui.clip_rect()));
    clip.text(pos2(rect.min.x + 8.0, cy), egui::Align2::LEFT_CENTER, &c.author_name, t.ui_font(), t.text_dim);
    clip.text(pos2(rect.min.x + 150.0, cy), egui::Align2::LEFT_CENTER, &c.summary, t.ui_font(), t.text);
    clip.text(pos2(rect.max.x - 8.0, cy), egui::Align2::RIGHT_CENTER, log::format_time(c.author_time, c.author_offset_minutes), t.ui_font(), t.text_dim);
    resp
}

fn file_row(ui: &mut Ui, f: &ChangedFile) -> egui::Response {
    let t = &theme::T;
    let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), t.space.row_h), Sense::click());
    let path = f.path.display().to_string();
    crate::util::label_widget(&resp, egui::WidgetType::Button, format!("Changed file {path}"));
    let painter = ui.painter();
    if resp.hovered() {
        painter.rect_filled(rect, t.radius.row, t.tree_hover);
    }
    let name = f.path.file_name().map_or_else(|| path.clone(), |n| n.to_string_lossy().into_owned());
    icons::file(painter, pos2(rect.min.x + 14.0, rect.center().y), 14.0, &name);
    let g = painter.layout_no_wrap(name, t.ui_font(), crate::tree::change_color(f.kind));
    let w = g.size().x;
    painter.galley(pos2(rect.min.x + 26.0, rect.center().y - g.size().y / 2.0), g, t.text);
    if let Some(dir) = f.path.parent().filter(|d| !d.as_os_str().is_empty()) {
        painter.with_clip_rect(rect.intersect(ui.clip_rect())).text(pos2(rect.min.x + 34.0 + w, rect.center().y), egui::Align2::LEFT_CENTER, dir.display().to_string(), t.small_font(), t.text_dim);
    }
    resp
}

fn compare_body(state: &mut AppState, c: &mut CompareTab, id: u64, ui: &mut Ui) {
    let t = &theme::T;
    let data = match &c.data {
        None => {
            ui.label(RichText::new("Loading...").color(t.text_dim));
            return;
        }
        Some(Err(e)) => {
            ui.label(RichText::new(e).color(t.error));
            return;
        }
        Some(Ok(d)) => d,
    };
    let mut pick: Option<Oid> = None;
    let mut open: Option<(Oid, PathBuf)> = None;
    egui::SidePanel::right(crate::workspace::wid(("git-compare-files", id))).resizable(true).default_width(320.0).width_range(160.0..=700.0).frame(Frame::NONE.inner_margin(Margin { left: 8, right: 0, top: 0, bottom: 0 })).show_inside(ui, |ui| {
        match &c.files {
            None => {
                ui.label(RichText::new("Select a commit to see its files.").color(t.text_dim));
            }
            Some((_, Err(e))) => {
                ui.label(RichText::new(e).color(t.error));
            }
            Some((oid, Ok(files))) => {
                ScrollArea::vertical().id_salt(("git-compare-file-list", id)).auto_shrink([false, false]).show(ui, |ui| {
                    for f in files {
                        if file_row(ui, f).clicked() {
                            open = Some((*oid, f.path.clone()));
                        }
                    }
                });
            }
        }
    });
    egui::CentralPanel::default().frame(Frame::NONE).show_inside(ui, |ui| {
        ScrollArea::vertical().id_salt(("git-compare-commits", id)).auto_shrink([false, false]).show(ui, |ui| {
            for (title, list) in [(format!("Commits in {} that {} does not have ({})", c.current, c.other, data.only_current.len()), &data.only_current), (format!("Commits in {} that {} does not have ({})", c.other, c.current, data.only_other.len()), &data.only_other)] {
                ui.label(RichText::new(title).font(t.semibold(t.font.ui)).color(t.text));
                if list.is_empty() {
                    ui.label(RichText::new("    No commits").color(t.text_dim));
                }
                for commit in list {
                    if commit_row(ui, commit, c.selected == Some(commit.oid)).clicked() {
                        pick = Some(commit.oid);
                    }
                }
                ui.add_space(8.0);
            }
        });
    });
    if let Some((oid, path)) = open {
        let abs = state.ws.git.repo.as_ref().map_or(path.clone(), |r| r.workdir().join(&path));
        super::diff::open_commit_diff(state, oid, &abs);
    }
    if let Some(oid) = pick.filter(|o| c.selected != Some(*o)) {
        c.selected = Some(oid);
        c.files = None;
        let Some(repo) = state.ws.git.repo.clone() else { return };
        state.jobs.spawn_quiet(
            move || repo.changes_of(&[oid]).map_err(|e| e.to_string()),
            move |state, res| {
                if let Some(TabKind::Compare(c)) = tab_kind_mut(state, id) {
                    if c.selected == Some(oid) {
                        c.files = Some((oid, res));
                    }
                }
            },
        );
    }
}

fn worktree_diff_body(state: &mut AppState, d: &mut WorktreeDiffTab, ui: &mut Ui) {
    let t = &theme::T;
    let files = match &d.files {
        None => {
            ui.label(RichText::new("Loading...").color(t.text_dim));
            return;
        }
        Some(Err(e)) => {
            ui.label(RichText::new(e).color(t.error));
            return;
        }
        Some(Ok(f)) => f,
    };
    ui.label(RichText::new(format!("Files that differ between {} and the working tree ({})", d.rev, files.len())).font(t.semibold(t.font.ui)).color(t.text));
    let mut open = None;
    ScrollArea::vertical().id_salt("git-worktree-diff").auto_shrink([false, false]).show(ui, |ui| {
        for f in files {
            if file_row(ui, f).clicked() {
                open = Some(f.path.clone());
            }
        }
    });
    if let Some(rel) = open {
        super::diff::open_rev_local_diff(state, &d.rev, &rel);
    }
}
