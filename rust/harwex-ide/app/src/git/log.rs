//! Git log: one `LogView` per Log tab of the Git window (filter bar, commit table, changes
//! pane), plus `LogUi`, the state all tabs share: branch names, HEAD, the git user, the modal
//! dialogs and the inbox that carries worker results back to the view that asked.
//!
//! The Git window (`window.rs`) owns the views and lends one to `log_body` per frame, so a
//! worker result cannot reach its view through `AppState`. Jobs post a `ViewMsg` into
//! `LogUi::inbox` under the view id, and the view drains it the next time it is drawn.

mod filters;
mod table;

use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use egui::{Context, Frame, Key, Margin, Modal, RichText, TextEdit, Ui};
use ide_git::{ChangeKind, ChangedFile, CommitInfo, GraphRow, LogFilter, Oid, ResetMode};

use super::commit_changes::{self, ChangesPane};
use crate::layout::ToolWindow;
use crate::state::AppState;
use crate::theme;

pub use table::{draw_graph, draw_ref_label, RowStyle, LANE_COLORS};

/// Commits per page. A page of the whole history costs a few ms; a path-filtered page costs
/// more because every commit's tree is compared, so the page stays moderate.
const PAGE: usize = 300;
/// The text filter reloads once typing rests this long.
const DEBOUNCE: Duration = Duration::from_millis(300);

static NEXT_VIEW: AtomicU64 = AtomicU64::new(1);

/// State shared by every Log tab.
#[derive(Default)]
pub struct LogUi {
    /// Worker results per view id, drained when that view is drawn.
    inbox: HashMap<u64, Vec<ViewMsg>>,
    /// Local and remote branch names, for the Branch filter popup.
    branch_names: (Vec<String>, Vec<String>),
    /// The commit HEAD points to; its graph node is a hollow circle.
    head: Option<Oid>,
    refs_fingerprint: Option<u64>,
    /// Bumped when a ref moved; each view reloads when it sees a newer epoch.
    refs_epoch: u64,
    /// `user.name` and `user.email`, for "me" and the bold author.
    me: Option<(String, String)>,
    /// The project generation `me` was asked for.
    me_asked: Option<u64>,
    dialog: Option<LogDialog>,
    /// Views whose text filter waits for the debounce, with the edit time.
    debouncing: HashMap<u64, Instant>,
    /// Set by Show History; the Git window opens a History tab from it, or the next drawn
    /// Log tab takes it.
    pending_history: Option<PathBuf>,
    /// The view drawn last, for the `--test-git-*` hooks.
    active: Option<u64>,
    /// A view was drawn once, so ref moves matter.
    drawn: bool,
    pub(crate) last_load_ms: Option<f64>,
}

impl LogUi {
    /// A text filter waits for its debounce. Loads are jobs and count as in flight anyway.
    /// An entry of a closed tab expires on its own.
    pub(crate) fn filter_pending(&self) -> bool {
        self.debouncing.values().any(|t| t.elapsed() < DEBOUNCE + Duration::from_secs(2))
    }

    /// The git user (`user.name`, `user.email`), once loaded.
    pub fn me(&self) -> Option<&(String, String)> {
        self.me.as_ref()
    }

    pub fn head(&self) -> Option<Oid> {
        self.head
    }

    /// The commit is the git user's own: same email, or same name when no email is set.
    pub fn is_me(&self, c: &CommitInfo) -> bool {
        self.me.as_ref().is_some_and(|(name, email)| if email.is_empty() { !name.is_empty() && c.author_name == *name } else { c.author_email.eq_ignore_ascii_case(email) })
    }

    fn post(&mut self, view: u64, msg: ViewMsg) {
        self.inbox.entry(view).or_default().push(msg);
    }
}

/// A worker result (or a test hook command) for one view.
enum ViewMsg {
    Page { request: u64, skip: usize, limit: usize, filter: LogFilter, result: Result<Vec<CommitInfo>, String>, ms: f64 },
    Changes { key: Vec<Oid>, result: Result<Vec<ChangedFile>, String> },
    TestSelect(usize),
    TestFilter(String),
    TestOpenFile(usize),
    TestAction(String),
    TestDescribe,
}

/// One author entry of the User filter.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Author {
    /// The git user, from `Repo::user`.
    Me,
    Name(String),
}

/// The filter of one Log tab as the user set it.
#[derive(Clone, Debug)]
pub struct ViewFilter {
    pub text: String,
    pub regex: bool,
    pub case_sensitive: bool,
    /// Empty shows all branches.
    pub branches: Vec<String>,
    pub authors: Vec<Author>,
    /// Absolute paths (files or folders).
    pub paths: Vec<PathBuf>,
    pub no_merges: bool,
}

impl Default for ViewFilter {
    fn default() -> Self {
        // A new Log tab shows the history of HEAD, like IDEA's "Branch: HEAD".
        ViewFilter { text: String::new(), regex: false, case_sensitive: false, branches: vec!["HEAD".into()], authors: Vec::new(), paths: Vec::new(), no_merges: false }
    }
}

/// One Log tab of the Git window: its filters, loaded commits, selection and changes pane.
pub struct LogView {
    pub(super) id: u64,
    pub(super) filter: ViewFilter,
    /// The text box changed; the reload waits for the debounce.
    edited_at: Option<Instant>,
    pub(super) commits: Vec<CommitInfo>,
    graph: Vec<GraphRow>,
    has_more: bool,
    loading: bool,
    /// Bumped on every reload, so pages of an older filter are dropped.
    request: u64,
    needs_load: bool,
    /// `LogUi::refs_epoch` of the last load.
    epoch: u64,
    error: Option<String>,
    /// Selected commits; the last one is the lead.
    pub(super) selection: Vec<Oid>,
    /// Shift+click and Shift+arrows extend from here.
    anchor: Option<Oid>,
    /// Row index to scroll into view.
    scroll_to: Option<usize>,
    /// The commit list's viewport last frame, for keyboard paging.
    view_offset: f32,
    view_height: f32,
    /// Authors of the loaded commits, for the User popup.
    authors_seen: Vec<String>,
    popups: filters::Popups,
    pub(super) changes: ChangesPane,
}

impl Default for LogView {
    fn default() -> Self {
        LogView {
            id: NEXT_VIEW.fetch_add(1, Ordering::Relaxed),
            filter: ViewFilter::default(),
            edited_at: None,
            commits: Vec::new(),
            graph: Vec::new(),
            has_more: false,
            loading: false,
            request: 0,
            needs_load: true,
            epoch: 0,
            error: None,
            selection: Vec::new(),
            anchor: None,
            scroll_to: None,
            view_offset: 0.0,
            view_height: 0.0,
            authors_seen: Vec::new(),
            popups: filters::Popups::default(),
            changes: ChangesPane::default(),
        }
    }
}

impl LogView {
    /// A Log tab with the history of one file or folder (absolute path), all branches.
    pub fn file_history(path: PathBuf) -> LogView {
        let mut v = LogView::default();
        v.filter.branches.clear();
        v.filter.paths = vec![path];
        v
    }

    /// The tab title after "Log: ": the branch filter.
    pub fn filter_label(&self) -> String {
        if self.filter.branches.is_empty() {
            "all".to_owned()
        } else {
            self.filter.branches.join(", ")
        }
    }

    /// Filters the log by these branches (empty: all branches) and reloads.
    pub fn set_branches(&mut self, branches: Vec<String>) {
        if self.filter.branches != branches {
            self.filter.branches = branches;
            self.needs_load = true;
        }
    }

    pub fn filter(&self) -> &ViewFilter {
        &self.filter
    }

    /// Loaded commits, newest first.
    pub fn commits(&self) -> &[CommitInfo] {
        &self.commits
    }

    pub fn graph(&self) -> &[GraphRow] {
        &self.graph
    }

    /// More pages can be loaded.
    pub fn has_more(&self) -> bool {
        self.has_more
    }

    pub fn is_loading(&self) -> bool {
        self.loading
    }

    pub fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }

    /// Selected commits in the order they were selected.
    pub fn selection(&self) -> &[Oid] {
        &self.selection
    }

    /// The lead commit (the last one selected).
    pub fn selected(&self) -> Option<Oid> {
        self.selection.last().copied()
    }

    /// Combined changes of the selection, once loaded.
    pub fn changes(&self) -> Option<&[ChangedFile]> {
        self.changes.files()
    }

    /// The changes pane (its tree rows and file selection).
    pub fn changes_pane(&self) -> &ChangesPane {
        &self.changes
    }

    /// How the commit table draws row `i`.
    pub fn row_style(&self, ui: &LogUi, i: usize) -> RowStyle {
        let c = &self.commits[i];
        RowStyle { bold_author: ui.is_me(c), dimmed: c.parents.len() > 1, hollow: ui.head == Some(c.oid) }
    }

    /// The selection sorted oldest first (log order is newest first).
    pub(super) fn selection_oldest_first(&self) -> Vec<Oid> {
        let mut rows: Vec<(usize, Oid)> = self.selection.iter().map(|o| (self.commits.iter().position(|c| c.oid == *o).unwrap_or(usize::MAX), *o)).collect();
        rows.sort_by_key(|r| std::cmp::Reverse(r.0));
        rows.into_iter().map(|(_, o)| o).collect()
    }

    fn log_filter(&self, me: Option<&(String, String)>) -> LogFilter {
        let text = self.filter.text.trim();
        let authors = self
            .filter
            .authors
            .iter()
            .filter_map(|a| match a {
                Author::Me => me.map(|(name, email)| if email.is_empty() { name.clone() } else { email.clone() }),
                Author::Name(n) => Some(n.clone()),
            })
            .collect();
        LogFilter {
            branches: self.filter.branches.clone(),
            text: (!text.is_empty()).then(|| text.to_string()),
            text_regex: self.filter.regex,
            text_case_sensitive: self.filter.case_sensitive,
            authors,
            paths: self.filter.paths.clone(),
            no_merges: self.filter.no_merges,
            ..LogFilter::default()
        }
    }

    fn apply(&mut self, state: &mut AppState, msg: ViewMsg) {
        match msg {
            ViewMsg::Page { request, skip, limit, filter, result, ms } => {
                if request != self.request {
                    return;
                }
                self.loading = false;
                match result {
                    Ok(list) => {
                        self.has_more = list.len() >= limit;
                        let n = list.len();
                        if skip == 0 {
                            self.commits = list;
                        } else {
                            self.commits.extend(list);
                        }
                        // Earlier rows depend only on earlier commits, so a full recompute
                        // keeps them; it costs microseconds per thousand rows.
                        self.graph = layout_graph(&self.commits, &filter);
                        let mut seen: Vec<String> = self.commits.iter().map(|c| c.author_name.clone()).collect();
                        seen.sort_unstable();
                        seen.dedup();
                        self.authors_seen = seen;
                        let commits = &self.commits;
                        self.selection.retain(|s| commits.iter().any(|c| c.oid == *s));
                        if self.selection.is_empty() {
                            if let Some(first) = self.commits.first() {
                                self.selection = vec![first.oid];
                                self.anchor = Some(first.oid);
                                self.scroll_to = Some(0);
                            }
                        }
                        state.ws.git_ui.log.last_load_ms = Some(ms);
                        let total = self.commits.len();
                        state.timings.log(format!("[git log] page at {skip}: {n} commits, {total} total, {ms:.1} ms"));
                    }
                    Err(e) => {
                        if skip == 0 {
                            self.commits.clear();
                            self.graph.clear();
                        }
                        self.has_more = false;
                        self.error = Some(e);
                    }
                }
            }
            ViewMsg::Changes { key, result } => self.changes.set_files(key, result),
            ViewMsg::TestSelect(row) => {
                if let Some(c) = self.commits.get(row) {
                    self.selection = vec![c.oid];
                    self.anchor = Some(c.oid);
                    self.scroll_to = Some(row);
                }
            }
            ViewMsg::TestFilter(text) => {
                self.filter.text = text;
                self.text_edited(state);
            }
            ViewMsg::TestOpenFile(n) => {
                let oids = self.selection_oldest_first();
                match self.changes.files().and_then(|f| f.get(n)).map(|f| f.path.clone()) {
                    Some(path) => super::diff::open_commits_diff(state, &oids, &path),
                    None => eprintln!("[test-git] logfile: no changes or no file {n}"),
                }
            }
            ViewMsg::TestAction(what) => {
                if let Some(oid) = self.selected() {
                    let action = match what.as_str() {
                        "checkout" => RowAction::Checkout(oid),
                        "newbranch" => RowAction::NewBranch(oid),
                        "newtag" => RowAction::NewTag(oid),
                        "reset" => RowAction::Reset(oid),
                        "revert" => RowAction::Revert(oid),
                        "cherry-pick" => RowAction::CherryPick(oid),
                        _ => RowAction::CopyHash(oid),
                    };
                    let ctx = state.ctx.clone();
                    run_action(state, &ctx, action);
                }
            }
            ViewMsg::TestDescribe => {
                let top: Vec<&str> = self.commits.iter().take(4).map(|c| c.summary.as_str()).collect();
                eprintln!(
                    "[test-git] log: {} commits (more {}), branches {:?}, paths {:?}, top {top:?}, selected {}, changes {:?}",
                    self.commits.len(),
                    self.has_more,
                    self.filter.branches,
                    self.filter.paths,
                    self.selection.len(),
                    self.changes.files().map(<[ChangedFile]>::len)
                );
            }
        }
    }

    /// The text box changed: reload after the debounce.
    pub(super) fn text_edited(&mut self, state: &mut AppState) {
        let now = Instant::now();
        self.edited_at = Some(now);
        state.ws.git_ui.log.debouncing.insert(self.id, now);
    }

    /// A filter other than the text changed: reload now.
    pub(super) fn filter_changed(&mut self, state: &mut AppState) {
        self.edited_at = None;
        state.ws.git_ui.log.debouncing.remove(&self.id);
        reload(state, self, 0);
    }
}

#[derive(Clone)]
enum LogDialog {
    NewBranch { from: Oid, name: String, checkout: bool },
    NewTag { oid: Oid, name: String },
    Reset { oid: Oid, mode: ResetMode, confirm_hard: bool },
    CreatePatch { oids: Vec<Oid>, paths: Vec<PathBuf>, dest: String },
}

enum RowAction {
    CopyHash(Oid),
    Checkout(Oid),
    NewBranch(Oid),
    NewTag(Oid),
    Reset(Oid),
    Revert(Oid),
    CherryPick(Oid),
}

/// Filter bar, commit table and changes pane of one Log tab, inside `ui`'s rect.
pub fn log_body(state: &mut AppState, view: &mut LogView, ui: &mut Ui) {
    if state.ws.git.repo.is_none() {
        ui.label(RichText::new("The project is not inside a git repository.").color(theme::T.text_dim));
        return;
    }
    {
        let log = &mut state.ws.git_ui.log;
        log.active = Some(view.id);
        log.drawn = true;
        if let Some(path) = log.pending_history.take() {
            view.filter.paths = vec![path];
            view.filter.text.clear();
            view.filter.authors.clear();
            view.selection.clear();
            view.needs_load = true;
        }
    }
    ask_me(state);
    if let Some(msgs) = state.ws.git_ui.log.inbox.remove(&view.id) {
        for m in msgs {
            view.apply(state, m);
        }
    }
    if view.needs_load || view.epoch != state.ws.git_ui.log.refs_epoch {
        // A ref move keeps as many rows as are loaded, so the scroll position stays.
        let keep = if view.needs_load { 0 } else { view.commits.len() };
        view.needs_load = false;
        reload(state, view, keep);
    }
    if let Some(at) = view.edited_at {
        let rest = at.elapsed();
        if rest >= DEBOUNCE {
            view.edited_at = None;
            state.ws.git_ui.log.debouncing.remove(&view.id);
            reload(state, view, 0);
        } else {
            ui.ctx().request_repaint_after(DEBOUNCE - rest);
        }
    }

    // The changes pane takes the full body height; the filter bar spans only the table column,
    // like IDEA, so it follows the splitter.
    let pane = egui::SidePanel::right(crate::workspace::wid(("git-log-changes", view.id)))
        .resizable(true)
        .default_width(380.0)
        .width_range(220.0..=900.0)
        .frame(Frame::NONE.inner_margin(Margin { left: 6, right: 0, top: 0, bottom: 0 }))
        .show_inside(ui, |ui| commit_changes::show(state, view, ui));
    let node = ui.interact(pane.response.rect, crate::workspace::wid(("git-log-changes-node", view.id)), egui::Sense::hover());
    crate::util::label_widget(&node, egui::WidgetType::Other, "Log changes pane");
    // The gap keeps the table's scroll bar out of the splitter's grab area; without it the
    // scroll bar takes the press and the splitter can be grabbed only right of the edge.
    egui::CentralPanel::default().frame(Frame::NONE.inner_margin(Margin { left: 0, right: 6, top: 0, bottom: 0 })).show_inside(ui, |ui| {
        filters::bar(state, view, ui);
        table::show(state, view, ui);
    });
}

/// Loads `user.name`/`user.email` once per project.
fn ask_me(state: &mut AppState) {
    let generation = state.project_generation();
    if state.ws.git_ui.log.me_asked == Some(generation) {
        return;
    }
    state.ws.git_ui.log.me_asked = Some(generation);
    let Some(repo) = state.ws.git.repo.clone() else { return };
    state.jobs.spawn_quiet(
        move || repo.user().ok().flatten(),
        move |state, me| {
            if state.project_generation() == generation {
                state.ws.git_ui.log.me = me;
            }
        },
    );
}

/// Loads the first page again with the view's filter. `keep` loads at least that many
/// commits, so a reload after a ref move keeps the scroll position.
fn reload(state: &mut AppState, view: &mut LogView, keep: usize) {
    let Some(repo) = state.ws.git.repo.clone() else { return };
    view.request += 1;
    view.loading = true;
    view.error = None;
    view.epoch = state.ws.git_ui.log.refs_epoch;
    let request = view.request;
    let filter = view.log_filter(state.ws.git_ui.log.me.as_ref());
    let limit = keep.max(PAGE);
    let generation = state.project_generation();
    let id = view.id;
    let started = Instant::now();
    state.jobs.spawn_quiet(
        move || {
            let commits = repo.log(&filter, 0, limit).map_err(|e| e.to_string());
            let branches = repo.branches().ok();
            (filter, commits, branches)
        },
        move |state, (filter, result, branches)| {
            if state.project_generation() != generation {
                return;
            }
            if let Some(b) = branches {
                apply_branches(state, &b);
                state.ws.git_ui.log.refs_fingerprint.get_or_insert(fingerprint(&b));
            }
            let ms = started.elapsed().as_secs_f64() * 1000.0;
            state.ws.git_ui.log.post(id, ViewMsg::Page { request, skip: 0, limit, filter, result, ms });
        },
    );
}

fn load_more(state: &mut AppState, view: &mut LogView) {
    let Some(repo) = state.ws.git.repo.clone() else { return };
    if view.loading || !view.has_more {
        return;
    }
    view.loading = true;
    let request = view.request;
    let filter = view.log_filter(state.ws.git_ui.log.me.as_ref());
    let skip = view.commits.len();
    let generation = state.project_generation();
    let id = view.id;
    let started = Instant::now();
    state.jobs.spawn_quiet(
        move || {
            let result = repo.log(&filter, skip, PAGE).map_err(|e| e.to_string());
            (filter, result)
        },
        move |state, (filter, result)| {
            if state.project_generation() != generation {
                return;
            }
            let ms = started.elapsed().as_secs_f64() * 1000.0;
            state.ws.git_ui.log.post(id, ViewMsg::Page { request, skip, limit: PAGE, filter, result, ms });
        },
    );
}

/// Starts loading the combined changes of `key` (the selection, sorted) for a view.
pub(super) fn load_changes(state: &mut AppState, view_id: u64, key: Vec<Oid>) {
    let Some(repo) = state.ws.git.repo.clone() else { return };
    let generation = state.project_generation();
    state.jobs.spawn_quiet(
        move || {
            let result = repo.changes_of(&key).map_err(|e| e.to_string());
            (key, result)
        },
        move |state, (key, result)| {
            if state.project_generation() == generation {
                state.ws.git_ui.log.post(view_id, ViewMsg::Changes { key, result });
            }
        },
    );
}

/// A text, author or path filter hides the parents of most rows, so a real layout would open
/// a lane per row. Those views draw one straight line instead, like IDEA's filtered log.
fn layout_graph(commits: &[CommitInfo], filter: &LogFilter) -> Vec<GraphRow> {
    if filter.text.is_none() && filter.authors.is_empty() && filter.paths.is_empty() && !filter.no_merges {
        return ide_git::graph_layout(commits);
    }
    let linear: Vec<CommitInfo> = commits
        .iter()
        .enumerate()
        .map(|(i, c)| CommitInfo { parents: commits.get(i + 1).map(|n| vec![n.oid]).unwrap_or_default(), refs: Vec::new(), ..c.clone() })
        .collect();
    ide_git::graph_layout(&linear)
}

fn apply_branches(state: &mut AppState, b: &ide_git::Branches) {
    let log = &mut state.ws.git_ui.log;
    log.branch_names = (b.local.iter().map(|x| x.name.clone()).collect(), b.remote.iter().map(|x| x.name.clone()).collect());
    log.head = b.head;
}

fn fingerprint(b: &ide_git::Branches) -> u64 {
    let mut h = DefaultHasher::new();
    b.head.map(|o| o.to_string()).hash(&mut h);
    b.current.hash(&mut h);
    for x in b.local.iter().chain(&b.remote) {
        x.name.hash(&mut h);
        x.oid.as_bytes().hash(&mut h);
    }
    h.finish()
}

pub fn kind_color(kind: ChangeKind) -> egui::Color32 {
    crate::tree::change_color(kind)
}

pub fn short(oid: &Oid) -> String {
    oid.to_string()[..8].to_string()
}

fn run_action(state: &mut AppState, ctx: &Context, action: RowAction) {
    use super::remote::run_op;
    match action {
        RowAction::CopyHash(oid) => {
            state.platform.copy_text(ctx, &oid.to_string());
            state.notifications.info("Copied", oid.to_string());
        }
        RowAction::Checkout(oid) => {
            let body = format!("HEAD is now at {} (detached)", short(&oid));
            run_op(state, "Checkout Revision", body, false, move |r| r.checkout_revision(&oid).map(|_| None), |_, _| {});
        }
        RowAction::NewBranch(oid) => state.ws.git_ui.log.dialog = Some(LogDialog::NewBranch { from: oid, name: String::new(), checkout: true }),
        RowAction::NewTag(oid) => state.ws.git_ui.log.dialog = Some(LogDialog::NewTag { oid, name: String::new() }),
        RowAction::Reset(oid) => state.ws.git_ui.log.dialog = Some(LogDialog::Reset { oid, mode: ResetMode::Mixed, confirm_hard: false }),
        RowAction::Revert(oid) => run_op(state, format!("Revert {}", short(&oid)), "Reverted", true, move |r| r.revert(&oid).map(Some), |_, _| {}),
        RowAction::CherryPick(oid) => run_op(state, format!("Cherry-pick {}", short(&oid)), "Cherry-picked", true, move |r| r.cherry_pick(&oid).map(Some), |_, _| {}),
    }
}

/// Opens the Create Patch dialog for these files of the selected commits.
pub(super) fn open_patch_dialog(state: &mut AppState, oids: Vec<Oid>, paths: Vec<PathBuf>) {
    let Some(repo) = state.ws.git.repo.as_ref() else { return };
    let name = oids.last().map(short).unwrap_or_default();
    let dest = repo.workdir().join(format!("{name}.patch")).display().to_string();
    state.ws.git_ui.log.dialog = Some(LogDialog::CreatePatch { oids, paths, dest });
}

/// Shows the history of one file. The Git window opens a History tab for it
/// (`take_file_history`); without one, the next drawn Log tab filters by the path.
pub fn show_file_history(state: &mut AppState, path: &Path) {
    if state.ws.git.repo.is_none() {
        return;
    }
    // Editor and tree paths are canonical already; no disk access on the UI thread.
    state.ws.git_ui.log.pending_history = Some(path.to_path_buf());
    state.ws.layout.show(ToolWindow::Git);
}

/// The view for a pending Show History request, for the Git window's History tab.
pub fn take_file_history(state: &mut AppState) -> Option<LogView> {
    state.ws.git_ui.log.pending_history.take().map(LogView::file_history)
}

pub fn show_windows(state: &mut AppState, ctx: &Context) {
    let Some(dialog) = state.ws.git_ui.log.dialog.as_mut() else { return };
    let mut close = false;
    let mut submit: super::remote::Deferred = None;
    match dialog {
        LogDialog::NewBranch { from, name, checkout } => {
            let from = *from;
            let m = Modal::new(crate::workspace::wid("git-log-new-branch")).show(ctx, |ui| {
                ui.set_width(380.0);
                ui.label(RichText::new(format!("New branch from {}", short(&from))).strong());
                ui.add_space(6.0);
                let r = ui.add(TextEdit::singleline(name).hint_text("Branch name").desired_width(f32::INFINITY));
                // Re-grabbing the focus on the frame Enter released it would hide that Enter.
                if !r.lost_focus() {
                    r.request_focus();
                }
                ui.checkbox(checkout, "Checkout branch");
                ui.add_space(6.0);
                let enter = r.lost_focus() && ui.input(|i| i.key_pressed(Key::Enter));
                ui.horizontal(|ui| {
                    let valid = !name.trim().is_empty() && !name.contains(' ');
                    if (ui.add_enabled(valid, egui::Button::new("Create")).clicked() || (enter && valid)) && submit.is_none() {
                        let n = name.trim().to_string();
                        let co = *checkout;
                        submit = Some(Box::new(move |state| {
                            let body = format!("Created branch {n}");
                            let rev = from.to_string();
                            super::remote::run_op(state, "New Branch", body, false, move |r| r.create_branch(&n, Some(&rev), co).map(|_| None), |_, _| {});
                        }));
                    }
                    if ui.button("Cancel").clicked() {
                        close = true;
                    }
                });
            });
            close |= m.should_close();
        }
        LogDialog::NewTag { oid, name } => {
            let oid = *oid;
            let m = Modal::new(crate::workspace::wid("git-log-new-tag")).show(ctx, |ui| {
                ui.set_width(380.0);
                ui.label(RichText::new(format!("New tag on {}", short(&oid))).strong());
                ui.add_space(6.0);
                let r = ui.add(TextEdit::singleline(name).hint_text("Tag name").desired_width(f32::INFINITY));
                if !r.lost_focus() {
                    r.request_focus();
                }
                ui.add_space(6.0);
                let enter = r.lost_focus() && ui.input(|i| i.key_pressed(Key::Enter));
                ui.horizontal(|ui| {
                    let valid = !name.trim().is_empty() && !name.contains(' ');
                    if (ui.add_enabled(valid, egui::Button::new("Create")).clicked() || (enter && valid)) && submit.is_none() {
                        let n = name.trim().to_string();
                        submit = Some(Box::new(move |state| {
                            let body = format!("Created tag {n}");
                            super::remote::run_op(state, "New Tag", body, false, move |r| r.create_tag(&n, &oid, None).map(|_| None), |_, _| {});
                        }));
                    }
                    if ui.button("Cancel").clicked() {
                        close = true;
                    }
                });
            });
            close |= m.should_close();
        }
        LogDialog::Reset { oid, mode, confirm_hard } => {
            let oid = *oid;
            let branch = state.ws.git.branch.clone().unwrap_or_default();
            let m = Modal::new(crate::workspace::wid("git-log-reset")).show(ctx, |ui| {
                ui.set_width(440.0);
                ui.label(RichText::new(format!("Reset {branch} to {}", short(&oid))).strong());
                ui.add_space(6.0);
                if *confirm_hard {
                    ui.label(RichText::new("Hard reset discards all uncommitted changes in the working tree and the index. This cannot be undone.").color(theme::T.warning));
                    ui.add_space(6.0);
                    ui.horizontal(|ui| {
                        if ui.button("Reset --hard").clicked() {
                            submit = Some(reset_job(oid, ResetMode::Hard));
                        }
                        if ui.button("Cancel").clicked() {
                            close = true;
                        }
                    });
                    return;
                }
                ui.radio_value(mode, ResetMode::Soft, "Soft: keep the changes staged");
                ui.radio_value(mode, ResetMode::Mixed, "Mixed: keep the changes, unstaged");
                ui.radio_value(mode, ResetMode::Hard, "Hard: discard all changes");
                ui.add_space(6.0);
                ui.horizontal(|ui| {
                    if ui.button("Reset").clicked() {
                        if *mode == ResetMode::Hard {
                            *confirm_hard = true;
                        } else {
                            submit = Some(reset_job(oid, *mode));
                        }
                    }
                    if ui.button("Cancel").clicked() {
                        close = true;
                    }
                });
            });
            close |= m.should_close();
        }
        LogDialog::CreatePatch { oids, paths, dest } => {
            let m = Modal::new(crate::workspace::wid("git-log-create-patch")).show(ctx, |ui| {
                ui.set_width(520.0);
                let files = if paths.is_empty() { "all files".to_string() } else { format!("{} file(s)", paths.len()) };
                ui.label(RichText::new(format!("Create Patch: {files} of {} commit(s)", oids.len())).strong());
                ui.add_space(6.0);
                let r = ui.add(TextEdit::singleline(dest).hint_text("Patch file").desired_width(f32::INFINITY));
                if !r.lost_focus() {
                    r.request_focus();
                }
                ui.add_space(6.0);
                let enter = r.lost_focus() && ui.input(|i| i.key_pressed(Key::Enter));
                ui.horizontal(|ui| {
                    let valid = !dest.trim().is_empty();
                    if (ui.add_enabled(valid, egui::Button::new("Save Patch")).clicked() || (enter && valid)) && submit.is_none() {
                        let (oids, paths, dest) = (oids.clone(), paths.clone(), PathBuf::from(dest.trim()));
                        submit = Some(Box::new(move |state| save_patch(state, oids, paths, dest)));
                    }
                    if ui.button("Cancel").clicked() {
                        close = true;
                    }
                });
            });
            close |= m.should_close();
        }
    }
    if let Some(f) = submit {
        state.ws.git_ui.log.dialog = None;
        f(state);
    } else if close {
        state.ws.git_ui.log.dialog = None;
    }
}

fn save_patch(state: &mut AppState, oids: Vec<Oid>, paths: Vec<PathBuf>, dest: PathBuf) {
    let Some(repo) = state.ws.git.repo.clone() else { return };
    let dest = if dest.is_absolute() { dest } else { repo.workdir().join(dest) };
    state.jobs.spawn(
        "Create Patch",
        move || {
            let text = repo.patch(&oids, &paths).map_err(|e| e.to_string())?;
            std::fs::write(&dest, text).map_err(|e| format!("{}: {e}", dest.display()))?;
            Ok::<PathBuf, String>(dest)
        },
        |state, res| match res {
            Ok(p) => state.notifications.info("Patch created", p.display().to_string()),
            Err(e) => state.notifications.error("Create Patch failed", e),
        },
    );
}

fn reset_job(oid: Oid, mode: ResetMode) -> Box<dyn FnOnce(&mut AppState)> {
    Box::new(move |state| {
        let body = format!("Reset ({mode:?}) to {}", short(&oid));
        super::remote::run_op(state, "Reset Current Branch", body, false, move |r| r.reset(&oid, mode).map(Some), |_, _| {});
    })
}

/// A status refresh follows every file save; the views reload only when a ref moved.
pub fn on_git_refreshed(state: &mut AppState) {
    if !state.ws.git_ui.log.drawn {
        return;
    }
    let Some(repo) = state.ws.git.repo.clone() else { return };
    let generation = state.project_generation();
    state.jobs.spawn_quiet(
        move || repo.branches().ok(),
        move |state, b| {
            if state.project_generation() != generation {
                return;
            }
            let Some(b) = b else { return };
            apply_branches(state, &b);
            let fp = fingerprint(&b);
            let log = &mut state.ws.git_ui.log;
            if log.refs_fingerprint != Some(fp) {
                log.refs_fingerprint = Some(fp);
                log.refs_epoch += 1;
                state.ctx.request_repaint();
            }
        },
    );
}

/// "Today 17:05", "Yesterday 22:15", older days "01.10.2026, 13:18", like IDEA.
pub fn format_time(secs: i64, offset_min: i32) -> String {
    let local = secs + offset_min as i64 * 60;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0) + offset_min as i64 * 60;
    let day = local.div_euclid(86400);
    let today = now.div_euclid(86400);
    let sod = local.rem_euclid(86400);
    let hm = format!("{:02}:{:02}", sod / 3600, sod % 3600 / 60);
    if day == today {
        format!("Today {hm}")
    } else if day == today - 1 {
        format!("Yesterday {hm}")
    } else {
        let (y, m, d) = civil_from_days(day);
        format!("{d:02}.{m:02}.{y:04}, {hm}")
    }
}

pub fn format_time_full(secs: i64, offset_min: i32) -> String {
    let local = secs + offset_min as i64 * 60;
    let (y, m, d) = civil_from_days(local.div_euclid(86400));
    let sod = local.rem_euclid(86400);
    let sign = if offset_min < 0 { '-' } else { '+' };
    let off = offset_min.abs();
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02} {sign}{:02}{:02}", sod / 3600, sod % 3600 / 60, sod % 60, off / 60, off % 60)
}

/// Days since 1970-01-01 to (year, month, day); Howard Hinnant's algorithm, so no date crate
/// is needed for one column.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

// Test hooks for `--test-git-*` (remote/testing.rs). They act on the Log tab drawn last.

fn post_active(state: &mut AppState, msg: ViewMsg) {
    state.ws.layout.show(ToolWindow::Git);
    let log = &mut state.ws.git_ui.log;
    match log.active {
        Some(id) => log.post(id, msg),
        None => eprintln!("[test-git] no Log tab was drawn yet"),
    }
    state.ctx.request_repaint();
}

/// Test hook: selects the n-th loaded commit and shows the Git tool window.
pub(crate) fn test_select(state: &mut AppState, row: usize) {
    post_active(state, ViewMsg::TestSelect(row));
}

/// Test hook: types into the text filter.
pub(crate) fn test_filter(state: &mut AppState, text: &str) {
    post_active(state, ViewMsg::TestFilter(text.to_string()));
}

/// Test hook: the drawn Log tab prints its state on the next frame.
pub(crate) fn test_describe(state: &mut AppState) -> String {
    post_active(state, ViewMsg::TestDescribe);
    "log: described on the next frame".to_string()
}

/// Test hook: Show Diff of the n-th changed file of the selection.
pub(crate) fn test_open_file(state: &mut AppState, n: usize) {
    post_active(state, ViewMsg::TestOpenFile(n));
}

/// Test hook: runs a context-menu action on the selected commit.
pub(crate) fn test_action(state: &mut AppState, what: &str) {
    post_active(state, ViewMsg::TestAction(what.to_string()));
}

#[cfg(test)]
mod tests {
    #[test]
    fn civil_dates() {
        assert_eq!(super::civil_from_days(0), (1970, 1, 1));
        assert_eq!(super::civil_from_days(20_454), (2026, 1, 1));
        assert_eq!(super::format_time_full(951_782_400, 0), "2000-02-29 00:00:00 +0000");
        assert_eq!(super::format_time(951_782_400 + 13 * 3600 + 18 * 60, 0), "29.02.2000, 13:18");
    }
}
