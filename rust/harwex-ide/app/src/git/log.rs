//! Git log tool window: lane graph, filters, paging, details pane, commit context menu.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use egui::{pos2, vec2, Align2, Color32, Context, CornerRadius, Frame, Id, Key, Margin, Modal, Rect, RichText, ScrollArea, Sense, Stroke, TextEdit, Ui};
use ide_git::{ChangeKind, CommitDetails, CommitInfo, GraphRow, LogFilter, Oid, RefKind, ResetMode};

use crate::layout::ToolWindow;
use crate::state::AppState;
use crate::theme;

/// Commits per page. A page of the whole history costs a few ms; a path-filtered page costs
/// more because every commit's tree is compared, so the page stays moderate.
const PAGE: usize = 300;
const ROW_H: f32 = 22.0;
const LANE_W: f32 = 12.0;
/// Wider graphs are clipped; IDEA also collapses very wide graphs.
const MAX_LANES: usize = 24;
const AUTHOR_W: f32 = 150.0;
const DATE_W: f32 = 130.0;

pub const LANE_COLORS: [Color32; 8] = theme::T.lanes;

pub struct LogUi {
    // Filter inputs as typed.
    text: String,
    author: String,
    branch: Option<String>,
    path: Option<PathBuf>,
    /// Debounce for the text boxes: reload once typing rests.
    edited_at: Option<Instant>,
    commits: Vec<CommitInfo>,
    graph: Vec<GraphRow>,
    has_more: bool,
    loading: bool,
    /// Bumped on every reload, so pages of an older filter are dropped.
    request: u64,
    needs_load: bool,
    /// Set by a refresh while the window is hidden; the next draw reloads.
    stale: bool,
    selected: Option<Oid>,
    details: Option<CommitDetails>,
    details_for: Option<Oid>,
    branch_names: (Vec<String>, Vec<String>),
    refs_fingerprint: Option<u64>,
    dialog: Option<LogDialog>,
    error: Option<String>,
    scroll_to: Option<usize>,
    /// Viewport of the commit list from the last frame, for keyboard scrolling.
    view_offset: f32,
    view_height: f32,
    pub(crate) last_load_ms: Option<f64>,
}

impl Default for LogUi {
    fn default() -> Self {
        LogUi {
            text: String::new(),
            author: String::new(),
            branch: None,
            path: None,
            edited_at: None,
            commits: Vec::new(),
            graph: Vec::new(),
            has_more: false,
            loading: false,
            request: 0,
            needs_load: true,
            stale: false,
            selected: None,
            details: None,
            details_for: None,
            branch_names: (Vec::new(), Vec::new()),
            refs_fingerprint: None,
            dialog: None,
            error: None,
            scroll_to: None,
            view_offset: 0.0,
            view_height: 0.0,
            last_load_ms: None,
        }
    }
}

enum LogDialog {
    NewBranch { from: Oid, name: String, checkout: bool },
    Reset { oid: Oid, mode: ResetMode, confirm_hard: bool },
}

enum RowAction {
    CopyHash(Oid),
    Checkout(Oid),
    NewBranch(Oid),
    Reset(Oid),
    Revert(Oid),
    CherryPick(Oid),
}

impl LogUi {
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

    pub fn selected(&self) -> Option<Oid> {
        self.selected
    }

    /// Details of the selected commit, once loaded.
    pub fn details(&self) -> Option<&CommitDetails> {
        self.details.as_ref()
    }

    /// The text or author filter was edited and the debounced reload has not run yet.
    pub(crate) fn filter_pending(&self) -> bool {
        self.edited_at.is_some() || self.loading
    }

    fn filter(&self) -> LogFilter {
        let opt = |s: &str| {
            let t = s.trim();
            (!t.is_empty()).then(|| t.to_string())
        };
        LogFilter { branch: self.branch.clone(), text: opt(&self.text), author: opt(&self.author), path: self.path.clone(), since: None, until: None }
    }
}

pub fn tool_window(state: &mut AppState, ui: &mut Ui) {
    if state.git.repo.is_none() {
        ui.label(RichText::new("The project is not inside a git repository.").color(theme::T.text_dim));
        return;
    }
    {
        let log = &mut state.git_ui.log;
        if log.needs_load || log.stale {
            let keep = if log.stale { log.commits.len() } else { 0 };
            log.needs_load = false;
            log.stale = false;
            reload(state, keep);
        }
    }
    if let Some(at) = state.git_ui.log.edited_at {
        let rest = at.elapsed();
        if rest >= Duration::from_millis(300) {
            state.git_ui.log.edited_at = None;
            reload(state, 0);
        } else {
            ui.ctx().request_repaint_after(Duration::from_millis(300) - rest);
        }
    }

    filter_bar(state, ui);
    ui.add_space(2.0);
    egui::SidePanel::right("git-log-details")
        .resizable(true)
        .default_width(360.0)
        .width_range(200.0..=900.0)
        .frame(Frame::NONE.inner_margin(Margin { left: 8, right: 0, top: 0, bottom: 0 }))
        .show_inside(ui, |ui| details_pane(state, ui));
    egui::CentralPanel::default().frame(Frame::NONE).show_inside(ui, |ui| commit_table(state, ui));
}

fn filter_bar(state: &mut AppState, ui: &mut Ui) {
    let mut changed_now = false;
    let mut close_path = false;
    let mut refresh = false;
    let log = &mut state.git_ui.log;
    ui.horizontal(|ui| {
        let r = ui.add(TextEdit::singleline(&mut log.text).hint_text("Text or hash").desired_width(180.0));
        if r.changed() {
            log.edited_at = Some(Instant::now());
        }
        let before = log.branch.clone();
        let label = log.branch.clone().unwrap_or_else(|| "All".into());
        egui::ComboBox::from_id_salt("git-log-branch").selected_text(format!("Branch: {label}")).width(170.0).height(400.0).show_ui(ui, |ui| {
            ui.selectable_value(&mut log.branch, None, "All");
            if !log.branch_names.0.is_empty() {
                ui.label(RichText::new("Local").small().color(theme::T.text_dim));
            }
            for b in &log.branch_names.0 {
                ui.selectable_value(&mut log.branch, Some(b.clone()), b);
            }
            if !log.branch_names.1.is_empty() {
                ui.label(RichText::new("Remote").small().color(theme::T.text_dim));
            }
            for b in &log.branch_names.1 {
                ui.selectable_value(&mut log.branch, Some(b.clone()), b);
            }
        });
        if log.branch != before {
            changed_now = true;
        }
        let r = ui.add(TextEdit::singleline(&mut log.author).hint_text("Author").desired_width(130.0));
        if r.changed() {
            log.edited_at = Some(Instant::now());
        }
        if let Some(p) = &log.path {
            Frame::NONE.fill(theme::T.tab_active_bg).corner_radius(CornerRadius::same(3)).inner_margin(Margin::symmetric(6, 1)).show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.label(RichText::new(format!("Path: {}", p.display())).color(theme::T.text_bright));
                    if ui.small_button("x").on_hover_text("Show the whole history").clicked() {
                        close_path = true;
                    }
                });
            });
        }
        if ui.small_button("Refresh").clicked() {
            refresh = true;
        }
        let count = log.commits.len();
        let more = if log.has_more { "+" } else { "" };
        let text = if log.loading { format!("{count}{more} commits, loading...") } else { format!("{count}{more} commits") };
        ui.label(RichText::new(text).small().color(theme::T.text_dim));
    });
    if close_path {
        log.path = None;
        changed_now = true;
    }
    if changed_now {
        log.edited_at = None;
        reload(state, 0);
    } else if refresh {
        let keep = state.git_ui.log.commits.len();
        reload(state, keep);
    }
}

/// Loads the first page again with the current filter. `keep` loads at least that many
/// commits, so a refresh after a commit keeps the scroll position.
fn reload(state: &mut AppState, keep: usize) {
    let Some(repo) = state.git.repo.clone() else { return };
    let log = &mut state.git_ui.log;
    log.request += 1;
    let request = log.request;
    log.loading = true;
    log.error = None;
    let filter = log.filter();
    let used = filter.clone();
    let limit = keep.max(PAGE);
    let generation = state.project_generation();
    let started = Instant::now();
    state.jobs.spawn_quiet(
        move || {
            let commits = repo.log(&filter, 0, limit);
            let branches = repo.branches();
            (commits, branches)
        },
        move |state, (commits, branches)| {
            if state.project_generation() != generation {
                return;
            }
            apply_branches(state, branches.ok());
            let log = &mut state.git_ui.log;
            if log.request != request {
                return;
            }
            log.loading = false;
            let ms = started.elapsed().as_secs_f64() * 1000.0;
            log.last_load_ms = Some(ms);
            match commits {
                Ok(list) => {
                    log.has_more = list.len() >= limit;
                    log.commits = list;
                    log.graph = layout_graph(&log.commits, &used);
                    let still_there = log.selected.is_some_and(|s| log.commits.iter().any(|c| c.oid == s));
                    if !still_there {
                        log.selected = log.commits.first().map(|c| c.oid);
                        log.scroll_to = Some(0);
                    }
                    let n = log.commits.len();
                    state.timings.log(format!("[git log] loaded {n} commits in {ms:.1} ms"));
                }
                Err(e) => {
                    log.commits.clear();
                    log.graph.clear();
                    log.has_more = false;
                    log.error = Some(e.to_string());
                }
            }
        },
    );
}

fn load_more(state: &mut AppState) {
    let Some(repo) = state.git.repo.clone() else { return };
    let log = &mut state.git_ui.log;
    if log.loading || !log.has_more {
        return;
    }
    log.loading = true;
    let request = log.request;
    let filter = log.filter();
    let used = filter.clone();
    let skip = log.commits.len();
    let started = Instant::now();
    state.jobs.spawn_quiet(
        move || repo.log(&filter, skip, PAGE),
        move |state, res| {
            let log = &mut state.git_ui.log;
            if log.request != request {
                return;
            }
            log.loading = false;
            match res {
                Ok(list) => {
                    log.has_more = list.len() >= PAGE;
                    log.commits.extend(list);
                    // The layout of earlier rows depends only on earlier commits, so a full
                    // recompute keeps them unchanged; it costs microseconds per thousand rows.
                    log.graph = layout_graph(&log.commits, &used);
                    let n = log.commits.len();
                    let ms = started.elapsed().as_secs_f64() * 1000.0;
                    state.timings.log(format!("[git log] page at {skip}: {n} commits total, {ms:.1} ms"));
                }
                Err(e) => {
                    log.has_more = false;
                    log.error = Some(e.to_string());
                }
            }
        },
    );
}

/// A text, author or path filter hides the parents of most rows, so a real layout would open
/// a lane per row. Those views draw one straight line instead, like IDEA's filtered log.
fn layout_graph(commits: &[CommitInfo], filter: &LogFilter) -> Vec<GraphRow> {
    if filter.text.is_none() && filter.author.is_none() && filter.path.is_none() {
        return ide_git::graph_layout(commits);
    }
    let linear: Vec<CommitInfo> = commits
        .iter()
        .enumerate()
        .map(|(i, c)| CommitInfo { parents: commits.get(i + 1).map(|n| vec![n.oid]).unwrap_or_default(), refs: Vec::new(), ..c.clone() })
        .collect();
    ide_git::graph_layout(&linear)
}

fn apply_branches(state: &mut AppState, branches: Option<ide_git::Branches>) {
    let Some(b) = branches else { return };
    let log = &mut state.git_ui.log;
    log.branch_names = (b.local.iter().map(|x| x.name.clone()).collect(), b.remote.iter().map(|x| x.name.clone()).collect());
    log.refs_fingerprint = Some(fingerprint(&b));
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

fn commit_table(state: &mut AppState, ui: &mut Ui) {
    let full = ui.available_rect_before_wrap();
    // Header.
    let (header, _) = ui.allocate_exact_size(vec2(full.width(), 18.0), Sense::hover());
    let painter = ui.painter();
    let dim = theme::T.text_dim;
    let small = theme::T.tiny_font();
    painter.text(pos2(header.left() + 6.0, header.center().y), Align2::LEFT_CENTER, "Subject", small.clone(), dim);
    let author_x = header.right() - DATE_W - AUTHOR_W;
    painter.text(pos2(author_x + 4.0, header.center().y), Align2::LEFT_CENTER, "Author", small.clone(), dim);
    painter.text(pos2(header.right() - DATE_W + 4.0, header.center().y), Align2::LEFT_CENTER, "Date", small, dim);
    painter.hline(header.x_range(), header.bottom() - 0.5, Stroke::new(1.0_f32, theme::T.border));

    if let Some(err) = state.git_ui.log.error.clone() {
        ui.label(RichText::new(err).color(theme::T.error));
        return;
    }
    if state.git_ui.log.commits.is_empty() {
        let text = if state.git_ui.log.loading { "Loading..." } else { "No commits match the filter." };
        ui.label(RichText::new(text).color(theme::T.text_dim));
        return;
    }

    let table_id = Id::new("git-log-table");
    let has_focus = ui.memory(|m| m.has_focus(table_id));
    keyboard(state, ui, has_focus);

    let n = state.git_ui.log.commits.len();
    let mut scroll = ScrollArea::vertical().id_salt("git-log-rows").auto_shrink([false, false]);
    if let Some(i) = state.git_ui.log.scroll_to.take() {
        let log = &state.git_ui.log;
        let top = i as f32 * ROW_H;
        if top < log.view_offset || top + ROW_H > log.view_offset + log.view_height {
            scroll = scroll.vertical_scroll_offset((top - log.view_height / 2.0).max(0.0));
        }
    }
    let mut action: Option<RowAction> = None;
    let mut clicked: Option<usize> = None;
    let mut want_more = false;
    ui.spacing_mut().item_spacing.y = 0.0;
    let out = scroll.show_rows(ui, ROW_H, n, |ui, range| {
        let log = &state.git_ui.log;
        let lanes = log.graph[range.clone()].iter().map(|g| g.width.max(g.lane + 1)).max().unwrap_or(1).min(MAX_LANES);
        let graph_w = lanes as f32 * LANE_W + 8.0;
        if range.end + 60 >= n && log.has_more && !log.loading {
            want_more = true;
        }
        for i in range {
            let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), ROW_H), Sense::click());
            let commit = &log.commits[i];
            let selected = log.selected == Some(commit.oid);
            crate::util::label_selectable(&resp, format!("Commit {}", commit.summary), selected);
            draw_row(ui, rect, commit, &log.graph[i], graph_w, selected, has_focus, resp.hovered());
            if resp.clicked() || resp.secondary_clicked() {
                clicked = Some(i);
            }
            let oid = commit.oid;
            resp.context_menu(|ui| {
                ui.set_min_width(220.0);
                if ui.button("Copy Revision Number").clicked() {
                    action = Some(RowAction::CopyHash(oid));
                    ui.close_menu();
                }
                ui.separator();
                if ui.button("Checkout Revision").clicked() {
                    action = Some(RowAction::Checkout(oid));
                    ui.close_menu();
                }
                if ui.button("New Branch...").clicked() {
                    action = Some(RowAction::NewBranch(oid));
                    ui.close_menu();
                }
                if ui.button("Reset Current Branch to Here...").clicked() {
                    action = Some(RowAction::Reset(oid));
                    ui.close_menu();
                }
                ui.separator();
                if ui.button("Revert Commit").clicked() {
                    action = Some(RowAction::Revert(oid));
                    ui.close_menu();
                }
                if ui.button("Cherry-Pick").clicked() {
                    action = Some(RowAction::CherryPick(oid));
                    ui.close_menu();
                }
            });
        }
    });
    {
        let log = &mut state.git_ui.log;
        log.view_offset = out.state.offset.y;
        log.view_height = out.inner_rect.height();
    }
    if let Some(i) = clicked {
        let log = &mut state.git_ui.log;
        log.selected = Some(log.commits[i].oid);
        ui.memory_mut(|m| m.request_focus(table_id));
    }
    // Keep the focus id alive so arrow keys keep working after a click.
    ui.interact(out.inner_rect, table_id, Sense::focusable_noninteractive());
    if want_more {
        load_more(state);
    }
    if let Some(a) = action {
        run_action(state, ui.ctx(), a);
    }
}

fn keyboard(state: &mut AppState, ui: &mut Ui, has_focus: bool) {
    if !has_focus {
        return;
    }
    let (up, down, page_up, page_down) = ui.input_mut(|i| {
        (
            i.consume_key(egui::Modifiers::NONE, Key::ArrowUp),
            i.consume_key(egui::Modifiers::NONE, Key::ArrowDown),
            i.consume_key(egui::Modifiers::NONE, Key::PageUp),
            i.consume_key(egui::Modifiers::NONE, Key::PageDown),
        )
    });
    let log = &mut state.git_ui.log;
    let n = log.commits.len();
    if n == 0 {
        return;
    }
    let cur = log.selected.and_then(|s| log.commits.iter().position(|c| c.oid == s)).unwrap_or(0);
    let page = ((log.view_height / ROW_H) as usize).max(1);
    let next = if up {
        cur.saturating_sub(1)
    } else if down {
        (cur + 1).min(n - 1)
    } else if page_up {
        cur.saturating_sub(page)
    } else if page_down {
        (cur + page).min(n - 1)
    } else {
        return;
    };
    log.selected = Some(log.commits[next].oid);
    log.scroll_to = Some(next);
}

#[allow(clippy::too_many_arguments)]
fn draw_row(ui: &Ui, rect: Rect, c: &CommitInfo, g: &GraphRow, graph_w: f32, selected: bool, focused: bool, hovered: bool) {
    let painter = ui.painter();
    if selected {
        painter.rect_filled(rect, 0.0, if focused { theme::T.selection } else { theme::T.selection_inactive });
    } else if hovered {
        painter.rect_filled(rect, 0.0, theme::T.hover);
    }
    let graph_rect = Rect::from_min_size(rect.min, vec2(graph_w, rect.height()));
    draw_graph(&painter.with_clip_rect(graph_rect.intersect(painter.clip_rect())), graph_rect, g, c.parents.len() > 1);

    let author_x = rect.right() - DATE_W - AUTHOR_W;
    let subject_rect = Rect::from_min_max(pos2(graph_rect.right(), rect.top()), pos2(author_x - 6.0, rect.bottom()));
    let sp = painter.with_clip_rect(subject_rect.intersect(painter.clip_rect()));
    let mut x = subject_rect.left();
    let cy = rect.center().y;
    for r in c.refs.iter().take(4) {
        x += draw_ref_label(&sp, pos2(x, cy), r) + 4.0;
    }
    if c.refs.len() > 4 {
        let g = sp.layout_no_wrap(format!("+{}", c.refs.len() - 4), theme::T.tiny_font(), theme::T.text_dim);
        let w = g.size().x;
        sp.galley(pos2(x, cy - g.size().y / 2.0), g, theme::T.text_dim);
        x += w + 4.0;
    }
    let text_color = if selected { theme::T.text_bright } else { theme::T.text };
    sp.text(pos2(x + 2.0, cy), Align2::LEFT_CENTER, &c.summary, theme::T.ui_font(), text_color);

    let ap = painter.with_clip_rect(Rect::from_min_max(pos2(author_x, rect.top()), pos2(rect.right() - DATE_W - 4.0, rect.bottom())).intersect(painter.clip_rect()));
    let dim = if selected { theme::T.text } else { theme::T.text_dim };
    ap.text(pos2(author_x + 4.0, cy), Align2::LEFT_CENTER, &c.author_name, theme::T.small_font(), dim);
    painter.text(pos2(rect.right() - DATE_W + 4.0, cy), Align2::LEFT_CENTER, format_time(c.author_time, c.author_offset_minutes), theme::T.small_font(), dim);
}

/// Draws one row of the lane graph. A segment between two rows is a straight line from lane
/// `from` at the upper center to lane `to` at the lower center; each row draws the half that
/// lies inside it, so rows can be drawn independently.
pub fn draw_graph(painter: &egui::Painter, rect: Rect, g: &GraphRow, merge: bool) {
    let x = |lane: usize| rect.left() + 6.0 + lane as f32 * LANE_W + LANE_W / 2.0;
    let (top, mid, bottom) = (rect.top(), rect.center().y, rect.bottom());
    let color = |c: usize| LANE_COLORS[c % LANE_COLORS.len()];
    for e in &g.up {
        let half = (x(e.from) + x(e.to)) / 2.0;
        painter.line_segment([pos2(half, top), pos2(x(e.to), mid)], Stroke::new(1.6_f32, color(e.color)));
    }
    for e in &g.down {
        let half = (x(e.from) + x(e.to)) / 2.0;
        painter.line_segment([pos2(x(e.from), mid), pos2(half, bottom)], Stroke::new(1.6_f32, color(e.color)));
    }
    let center = pos2(x(g.lane), mid);
    if merge {
        painter.circle_filled(center, 4.0, theme::T.island_bg);
        painter.circle_stroke(center, 3.5, Stroke::new(1.6_f32, color(g.color)));
    } else {
        painter.circle_filled(center, 4.0, color(g.color));
    }
}

/// Draws a branch/tag label at `left_center`; returns its width.
pub fn draw_ref_label(painter: &egui::Painter, left_center: egui::Pos2, r: &ide_git::RefLabel) -> f32 {
    let (bg, fg) = match r.kind {
        RefKind::Head => theme::T.ref_head,
        RefKind::LocalBranch if r.is_current => theme::T.ref_current,
        RefKind::LocalBranch => theme::T.ref_local,
        RefKind::RemoteBranch => theme::T.ref_remote,
        RefKind::Tag => theme::T.ref_tag,
    };
    let galley = painter.layout_no_wrap(r.name.clone(), theme::T.tiny_font(), fg);
    let size = galley.size() + vec2(8.0, 2.0);
    let rect = Rect::from_min_size(pos2(left_center.x, left_center.y - size.y / 2.0), size);
    painter.rect_filled(rect, 3.0, bg);
    painter.galley(pos2(rect.left() + 4.0, rect.top() + 1.0), galley, fg);
    size.x
}

fn details_pane(state: &mut AppState, ui: &mut Ui) {
    let selected = state.git_ui.log.selected;
    let Some(oid) = selected else {
        ui.label(RichText::new("Select a commit to see its details.").color(theme::T.text_dim));
        return;
    };
    if state.git_ui.log.details_for != Some(oid) {
        state.git_ui.log.details_for = Some(oid);
        if let Some(repo) = state.git.repo.clone() {
            state.jobs.spawn_quiet(
                move || repo.commit_details(&oid),
                move |state, res| {
                    let log = &mut state.git_ui.log;
                    if log.details_for != Some(oid) {
                        return;
                    }
                    match res {
                        Ok(d) => log.details = Some(d),
                        Err(e) => {
                            log.details = None;
                            state.notifications.log_only(crate::notifications::Level::Warning, "Cannot read commit", e.to_string());
                        }
                    }
                },
            );
        }
    }
    let Some(d) = state.git_ui.log.details.as_ref().filter(|d| d.info.oid == oid) else {
        ui.label(RichText::new("Loading...").color(theme::T.text_dim));
        return;
    };
    let mut open: Option<PathBuf> = None;
    let filter_path = state.git_ui.log.path.clone();
    let total_h = ui.available_height();
    ui.label(RichText::new(format!("Changed files ({})", d.files.len())).small().color(theme::T.text_dim));
    let files_h = (total_h * 0.5).max(80.0);
    ui.push_id("git-log-files", |ui| {
        ui.spacing_mut().item_spacing.y = 0.0;
        ScrollArea::vertical().max_height(files_h).auto_shrink([false, true]).show_rows(ui, 20.0, d.files.len(), |ui, range| {
            for f in &d.files[range] {
                let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), 20.0), Sense::click());
                crate::util::label_widget(&resp, egui::WidgetType::Button, format!("Changed file {}", f.path.display()));
                if resp.hovered() {
                    ui.painter().rect_filled(rect, 0.0, theme::T.hover);
                }
                let color = kind_color(f.kind);
                let name = f.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                let dir = f.path.parent().map(|p| p.display().to_string()).unwrap_or_default();
                let p = ui.painter().with_clip_rect(rect.intersect(ui.clip_rect()));
                let strong = filter_path.as_ref().is_some_and(|fp| f.path.starts_with(fp));
                let font = if strong { theme::T.semibold(theme::T.font.ui) } else { theme::T.ui_font() };
                let r = p.text(pos2(rect.left() + 4.0, rect.center().y), Align2::LEFT_CENTER, &name, font, color);
                let mut extra = dir;
                if let Some(old) = &f.old_path {
                    extra = format!("{extra}  (from {})", old.display());
                }
                p.text(pos2(r.right() + 8.0, rect.center().y), Align2::LEFT_CENTER, extra, theme::T.tiny_font(), theme::T.text_dim);
                let resp = resp.on_hover_text(f.path.display().to_string());
                if resp.clicked() {
                    open = Some(f.path.clone());
                }
            }
        });
    });
    ui.add_space(6.0);
    ui.separator();
    ScrollArea::vertical().id_salt("git-log-message").auto_shrink([false, false]).show(ui, |ui| {
        ui.add(egui::Label::new(RichText::new(d.message.trim_end()).color(theme::T.text_bright)).wrap());
        ui.add_space(8.0);
        let info = &d.info;
        ui.horizontal(|ui| {
            ui.label(RichText::new(info.oid.to_string()).monospace().color(theme::T.text_dim));
            if ui.small_button("Copy").on_hover_text("Copy Revision Number").clicked() {
                ui.ctx().copy_text(info.oid.to_string());
            }
        });
        ui.label(format!("{} <{}>", info.author_name, info.author_email));
        ui.label(RichText::new(format!("on {}", format_time_full(info.author_time, info.author_offset_minutes))).color(theme::T.text_dim));
        if d.committer_name != info.author_name || d.committer_email != info.author_email {
            ui.label(RichText::new(format!("committed by {} <{}>", d.committer_name, d.committer_email)).color(theme::T.text_dim));
        }
        if !info.parents.is_empty() {
            let parents: Vec<String> = info.parents.iter().map(short).collect();
            ui.label(RichText::new(format!("parents: {}", parents.join(", "))).color(theme::T.text_dim));
        }
        if !info.refs.is_empty() {
            ui.horizontal_wrapped(|ui| {
                for r in &info.refs {
                    let (rect, _) = ui.allocate_exact_size(vec2(ui.fonts(|f| f.layout_no_wrap(r.name.clone(), theme::T.tiny_font(), theme::T.text).size().x) + 8.0, 16.0), Sense::hover());
                    draw_ref_label(ui.painter(), rect.left_center(), r);
                }
            });
        }
    });
    if let Some(path) = open {
        super::diff::open_commit_diff(state, oid, &path);
    }
}

pub fn kind_color(kind: ChangeKind) -> Color32 {
    match kind {
        ChangeKind::Added => theme::T.git_added,
        ChangeKind::Modified | ChangeKind::TypeChange => theme::T.git_modified,
        ChangeKind::Deleted => theme::T.git_deleted,
        ChangeKind::Renamed => theme::T.git_renamed,
        ChangeKind::Untracked => theme::T.git_untracked,
        ChangeKind::Conflicted => theme::T.git_conflict,
    }
}

pub fn short(oid: &Oid) -> String {
    oid.to_string()[..8].to_string()
}

fn run_action(state: &mut AppState, ctx: &Context, action: RowAction) {
    use super::remote::run_op;
    match action {
        RowAction::CopyHash(oid) => {
            ctx.copy_text(oid.to_string());
            state.notifications.info("Copied", oid.to_string());
        }
        RowAction::Checkout(oid) => {
            let body = format!("HEAD is now at {} (detached)", short(&oid));
            run_op(state, "Checkout Revision", body, false, move |r| r.checkout_revision(&oid).map(|_| None), |_, _| {});
        }
        RowAction::NewBranch(oid) => state.git_ui.log.dialog = Some(LogDialog::NewBranch { from: oid, name: String::new(), checkout: true }),
        RowAction::Reset(oid) => state.git_ui.log.dialog = Some(LogDialog::Reset { oid, mode: ResetMode::Mixed, confirm_hard: false }),
        RowAction::Revert(oid) => run_op(state, format!("Revert {}", short(&oid)), "Reverted", true, move |r| r.revert(&oid).map(Some), |_, _| {}),
        RowAction::CherryPick(oid) => run_op(state, format!("Cherry-pick {}", short(&oid)), "Cherry-picked", true, move |r| r.cherry_pick(&oid).map(Some), |_, _| {}),
    }
}

/// Shows the Git tool window filtered to the history of one file. Called by "Git > Show History".
pub fn show_file_history(state: &mut AppState, path: &Path) {
    let rel = match state.git.repo.as_ref() {
        Some(r) => {
            // Editor paths are canonical already; no disk access on the UI thread.
            path.strip_prefix(r.workdir()).map(Path::to_path_buf).unwrap_or_else(|_| path.to_path_buf())
        }
        None => return,
    };
    let log = &mut state.git_ui.log;
    log.path = Some(rel);
    log.text.clear();
    log.author.clear();
    log.edited_at = None;
    log.selected = None;
    state.layout.show(ToolWindow::Git);
    reload(state, 0);
}

pub fn show_windows(state: &mut AppState, ctx: &Context) {
    let Some(dialog) = state.git_ui.log.dialog.as_mut() else { return };
    let mut close = false;
    let mut submit: super::remote::Deferred = None;
    match dialog {
        LogDialog::NewBranch { from, name, checkout } => {
            let from = *from;
            let m = Modal::new(Id::new("git-log-new-branch")).show(ctx, |ui| {
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
        LogDialog::Reset { oid, mode, confirm_hard } => {
            let oid = *oid;
            let branch = state.git.branch.clone().unwrap_or_default();
            let m = Modal::new(Id::new("git-log-reset")).show(ctx, |ui| {
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
    }
    if let Some(f) = submit {
        state.git_ui.log.dialog = None;
        f(state);
    } else if close {
        state.git_ui.log.dialog = None;
    }
}

fn reset_job(oid: Oid, mode: ResetMode) -> Box<dyn FnOnce(&mut AppState)> {
    Box::new(move |state| {
        let body = format!("Reset ({mode:?}) to {}", short(&oid));
        super::remote::run_op(state, "Reset Current Branch", body, false, move |r| r.reset(&oid, mode).map(Some), |_, _| {});
    })
}

pub fn on_git_refreshed(state: &mut AppState) {
    let log = &state.git_ui.log;
    if log.needs_load {
        return;
    }
    let Some(repo) = state.git.repo.clone() else { return };
    // A status refresh follows every file save; the log reloads only when a ref moved.
    let generation = state.project_generation();
    state.jobs.spawn_quiet(
        move || repo.branches().ok(),
        move |state, b| {
            if state.project_generation() != generation {
                return;
            }
            let Some(b) = b else { return };
            let fp = fingerprint(&b);
            let changed = state.git_ui.log.refs_fingerprint != Some(fp);
            apply_branches(state, Some(b));
            if changed {
                if state.layout.bottom == Some(ToolWindow::Git) {
                    let keep = state.git_ui.log.commits.len();
                    reload(state, keep);
                } else {
                    state.git_ui.log.stale = true;
                }
            }
        },
    );
}

/// Today/yesterday get a relative day, like IDEA; older dates show the day.
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
        format!("{y:04}-{m:02}-{d:02} {hm}")
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

/// Test hook: selects the n-th loaded commit and shows the Git tool window.
pub(crate) fn test_select(state: &mut AppState, row: usize) {
    state.layout.show(ToolWindow::Git);
    let log = &mut state.git_ui.log;
    if let Some(c) = log.commits.get(row) {
        log.selected = Some(c.oid);
        log.scroll_to = Some(row);
    }
}

/// Test hook: types into the text filter.
pub(crate) fn test_filter(state: &mut AppState, text: &str) {
    state.layout.show(ToolWindow::Git);
    state.git_ui.log.text = text.to_string();
    state.git_ui.log.edited_at = Some(Instant::now());
}

pub(crate) fn test_describe(state: &AppState) -> String {
    let l = &state.git_ui.log;
    let top: Vec<String> = l.commits.iter().take(4).map(|c| c.summary.clone()).collect();
    format!("log: {} commits (more {}), path {:?}, top {top:?}, details files {:?}", l.commits.len(), l.has_more, l.path, l.details.as_ref().map(|d| d.files.len()))
}

/// Test hook: clicks the n-th file in the details pane of the selected commit.
pub(crate) fn test_open_file(state: &mut AppState, n: usize) {
    let Some(oid) = state.git_ui.log.selected else { return };
    let Some(path) = state.git_ui.log.details.as_ref().and_then(|d| d.files.get(n)).map(|f| f.path.clone()) else {
        eprintln!("[test-git] logfile: no details or no file {n}");
        return;
    };
    super::diff::open_commit_diff(state, oid, &path);
}

/// Test hook: runs a context-menu action on the selected commit.
pub(crate) fn test_action(state: &mut AppState, what: &str) {
    let Some(oid) = state.git_ui.log.selected else { return };
    let action = match what {
        "checkout" => RowAction::Checkout(oid),
        "newbranch" => RowAction::NewBranch(oid),
        "reset" => RowAction::Reset(oid),
        "revert" => RowAction::Revert(oid),
        "cherry-pick" => RowAction::CherryPick(oid),
        _ => RowAction::CopyHash(oid),
    };
    let ctx = state.ctx.clone();
    run_action(state, &ctx, action);
}

#[cfg(test)]
mod tests {
    #[test]
    fn civil_dates() {
        assert_eq!(super::civil_from_days(0), (1970, 1, 1));
        assert_eq!(super::civil_from_days(20_454), (2026, 1, 1));
        assert_eq!(super::format_time_full(951_782_400, 0), "2000-02-29 00:00:00 +0000");
    }
}
