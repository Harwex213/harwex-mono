//! Push dialog, Update Project (pull), stash / unstash dialogs, and the shared runner that
//! every git write of the history side goes through (worker thread, toast, refresh).

mod testing;

use std::collections::VecDeque;
use std::path::PathBuf;
use std::time::Instant;

use egui::{vec2, Align2, Context, FontId, Id, Key, Modal, RichText, ScrollArea, Sense, TextEdit, Ui};
use ide_git::{CommandOutcome, CommitDetails, CommitInfo, Error, Oid, Repo, StashEntry};

use super::log::{format_time, kind_color, short};
use crate::state::AppState;
use crate::theme;

pub use testing::test_steps;

#[derive(Default)]
pub struct RemoteUi {
    push: Option<PushDialog>,
    update: Option<UpdateDialog>,
    stash: Option<StashDialog>,
    unstash: Option<UnstashDialog>,
    /// Remembered between Update Project runs, like IDEA.
    update_rebase: bool,
    tests: VecDeque<(String, Option<String>)>,
    test_next: Option<Instant>,
}

#[derive(Default)]
struct PushDialog {
    loading: bool,
    error: Option<String>,
    branch: Option<String>,
    detached: bool,
    upstream: Option<String>,
    remote_guess: String,
    commits: Vec<CommitInfo>,
    selected: Option<Oid>,
    details: Option<CommitDetails>,
    force: bool,
    confirm_force: bool,
    set_upstream: bool,
    pushing: bool,
}

struct UpdateDialog {
    rebase: bool,
}

#[derive(Default)]
struct StashDialog {
    message: String,
    include_untracked: bool,
    focused: bool,
}

#[derive(Default)]
struct UnstashDialog {
    loading: bool,
    entries: Vec<StashEntry>,
    selected: Option<usize>,
    details: Option<CommitDetails>,
    reinstate_index: bool,
    confirm_drop: Option<usize>,
    busy: bool,
}

/// One frame's worth of requests from inside a dialog, run after its UI borrow ends.
pub(crate) type Deferred = Option<Box<dyn FnOnce(&mut AppState)>>;

impl RemoteUi {
    pub fn push_open(&self) -> bool {
        self.push.is_some()
    }

    /// Subjects of the outgoing commits the push dialog lists.
    pub fn push_commits(&self) -> Vec<String> {
        self.push.as_ref().map(|p| p.commits.iter().map(|c| c.summary.clone()).collect()).unwrap_or_default()
    }

    pub fn update_open(&self) -> bool {
        self.update.is_some()
    }

    pub fn stash_open(&self) -> bool {
        self.stash.is_some()
    }

    /// Stash messages the Unstash dialog lists, `None` when it is closed.
    pub fn unstash_entries(&self) -> Option<Vec<String>> {
        self.unstash.as_ref().map(|u| u.entries.iter().map(|e| e.message.clone()).collect())
    }

    pub fn unstash_busy(&self) -> bool {
        self.unstash.as_ref().is_some_and(|u| u.busy || u.loading)
    }
}

pub fn open_push_dialog(state: &mut AppState) {
    let Some(repo) = state.git.repo.clone() else { return };
    state.git_ui.remote.push = Some(PushDialog { loading: true, ..Default::default() });
    state.jobs.spawn(
        "Collecting outgoing commits",
        move || (repo.outgoing(), repo.branches()),
        |state, (out, branches)| {
            let Some(d) = state.git_ui.remote.push.as_mut() else { return };
            d.loading = false;
            match out {
                Ok(list) => {
                    d.selected = list.first().map(|c| c.oid);
                    d.commits = list;
                }
                Err(e) => d.error = Some(e.to_string()),
            }
            if let Ok(b) = branches {
                d.detached = b.detached;
                d.branch = b.current.clone();
                d.upstream = b.local.iter().find(|x| x.is_current).and_then(|x| x.upstream.clone());
                d.remote_guess = b.remote.first().and_then(|r| r.name.split('/').next()).unwrap_or("origin").to_string();
                d.set_upstream = d.upstream.is_none();
            }
            if let Some(oid) = d.selected {
                load_details(state, oid, DetailsTarget::Push);
            }
        },
    );
}

pub fn open_update_dialog(state: &mut AppState) {
    if state.git.repo.is_none() {
        return;
    }
    state.git_ui.remote.update = Some(UpdateDialog { rebase: state.git_ui.remote.update_rebase });
}

pub fn open_stash_dialog(state: &mut AppState) {
    if state.git.repo.is_none() {
        return;
    }
    state.git_ui.remote.stash = Some(StashDialog::default());
}

pub fn open_unstash_dialog(state: &mut AppState) {
    let Some(repo) = state.git.repo.clone() else { return };
    let keep = state.git_ui.remote.unstash.as_ref().map(|d| d.reinstate_index).unwrap_or(false);
    state.git_ui.remote.unstash = Some(UnstashDialog { loading: true, reinstate_index: keep, ..Default::default() });
    state.jobs.spawn_quiet(
        move || repo.stash_list(),
        |state, res| {
            let Some(d) = state.git_ui.remote.unstash.as_mut() else { return };
            d.loading = false;
            match res {
                Ok(list) => {
                    d.selected = (!list.is_empty()).then_some(0);
                    let first = list.first().map(|e| e.oid);
                    d.entries = list;
                    if let Some(oid) = first {
                        load_details(state, oid, DetailsTarget::Unstash);
                    }
                }
                Err(e) => state.notifications.error("Cannot list stashes", e.to_string()),
            }
        },
    );
}

#[derive(Clone, Copy)]
enum DetailsTarget {
    Push,
    Unstash,
}

fn load_details(state: &mut AppState, oid: Oid, target: DetailsTarget) {
    let Some(repo) = state.git.repo.clone() else { return };
    state.jobs.spawn_quiet(
        move || repo.commit_details(&oid).ok(),
        move |state, d| {
            let r = &mut state.git_ui.remote;
            match target {
                DetailsTarget::Push => {
                    if let Some(p) = r.push.as_mut().filter(|p| p.selected == Some(oid)) {
                        p.details = d;
                    }
                }
                DetailsTarget::Unstash => {
                    if let Some(u) = r.unstash.as_mut() {
                        let sel = u.selected.and_then(|i| u.entries.get(i)).map(|e| e.oid);
                        if sel == Some(oid) {
                            u.details = d;
                        }
                    }
                }
            }
        },
    );
}

pub fn show_windows(state: &mut AppState, ctx: &Context) {
    testing::tick(state);
    push_window(state, ctx);
    update_window(state, ctx);
    stash_window(state, ctx);
    unstash_window(state, ctx);
}

/// Draws the changed files of `details`; returns the clicked path.
fn files_list(ui: &mut Ui, details: Option<&CommitDetails>, salt: &str) -> Option<PathBuf> {
    let Some(d) = details else {
        ui.label(RichText::new("Loading...").color(theme::TEXT_DIM));
        return None;
    };
    let mut clicked = None;
    ui.label(RichText::new(format!("{} file(s)", d.files.len())).small().color(theme::TEXT_DIM));
    ui.push_id(salt, |ui| {
        ui.spacing_mut().item_spacing.y = 0.0;
        ScrollArea::vertical().auto_shrink([false, false]).show_rows(ui, 20.0, d.files.len(), |ui, range| {
            for f in &d.files[range] {
                let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), 20.0), Sense::click());
                crate::util::label_widget(&resp, egui::WidgetType::Button, format!("Changed file {}", f.path.display()));
                if resp.hovered() {
                    ui.painter().rect_filled(rect, 0.0, theme::HOVER);
                }
                let p = ui.painter().with_clip_rect(rect.intersect(ui.clip_rect()));
                p.text(rect.left_center() + vec2(4.0, 0.0), Align2::LEFT_CENTER, f.path.display().to_string(), FontId::proportional(13.0), kind_color(f.kind));
                if resp.on_hover_text("Show diff").clicked() {
                    clicked = Some(f.path.clone());
                }
            }
        });
    });
    clicked
}

/// A vertical divider of a fixed height; `ui.separator()` in a horizontal layout would
/// stretch to the window's unbounded height.
fn vsep(ui: &mut Ui, h: f32) {
    let (rect, _) = ui.allocate_exact_size(vec2(9.0, h), Sense::hover());
    ui.painter().vline(rect.center().x, rect.y_range(), egui::Stroke::new(1.0_f32, theme::BORDER));
}

/// A selectable commit row: subject on the left, hash and date on the right.
fn commit_row(ui: &mut Ui, c: &CommitInfo, selected: bool) -> egui::Response {
    let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), 22.0), Sense::click());
    crate::util::label_selectable(&resp, format!("Commit {}", c.summary), selected);
    let p = ui.painter().with_clip_rect(rect.intersect(ui.clip_rect()));
    if selected {
        p.rect_filled(rect, 0.0, theme::SELECTION);
    } else if resp.hovered() {
        p.rect_filled(rect, 0.0, theme::HOVER);
    }
    let right = format!("{}  {}", short(&c.oid), format_time(c.author_time, c.author_offset_minutes));
    let r = p.text(rect.right_center() - vec2(4.0, 0.0), Align2::RIGHT_CENTER, right, FontId::proportional(11.5), theme::TEXT_DIM);
    let clip = egui::Rect::from_min_max(rect.min, egui::pos2(r.left() - 8.0, rect.max.y));
    ui.painter().with_clip_rect(clip.intersect(ui.clip_rect())).text(rect.left_center() + vec2(4.0, 0.0), Align2::LEFT_CENTER, &c.summary, FontId::proportional(13.0), if selected { theme::TEXT_BRIGHT } else { theme::TEXT });
    resp
}

fn push_window(state: &mut AppState, ctx: &Context) {
    let Some(d) = state.git_ui.remote.push.as_mut() else { return };
    let mut open = true;
    let mut deferred: Deferred = None;
    let mut select: Option<Oid> = None;
    let mut diff: Option<(Oid, PathBuf)> = None;
    let branch = d.branch.clone().unwrap_or_else(|| "HEAD".into());
    egui::Window::new(format!("Push Commits to {}", d.upstream.as_deref().map(|u| u.split('/').next().unwrap_or(u)).unwrap_or(&d.remote_guess)))
        .id(Id::new("git-push-window"))
        .open(&mut open)
        .collapsible(false)
        .resizable(false)
        .anchor(Align2::CENTER_CENTER, vec2(0.0, 0.0))
        .show(ctx, |ui| {
            ui.set_width(760.0);
            if d.loading {
                ui.horizontal(|ui| {
                    ui.spinner();
                    ui.label("Collecting outgoing commits...");
                });
                return;
            }
            if let Some(e) = &d.error {
                ui.label(RichText::new(e).color(theme::ERROR));
            }
            let target = match &d.upstream {
                Some(up) => format!("{branch} -> {up}"),
                None => format!("{branch} -> {}/{branch}  (new)", d.remote_guess),
            };
            ui.label(RichText::new(target).strong().color(theme::TEXT_BRIGHT));
            if d.detached {
                ui.label(RichText::new("HEAD is detached; check out a branch to push.").color(theme::WARNING));
            }
            ui.add_space(4.0);
            let body_h = 320.0;
            ui.horizontal_top(|ui| {
                let w = ui.available_width();
                ui.allocate_ui(vec2(w * 0.5, body_h), |ui| {
                    ui.set_min_size(vec2(w * 0.5, body_h));
                    ui.vertical(|ui| {
                        ui.label(RichText::new(format!("{} outgoing commit(s)", d.commits.len())).small().color(theme::TEXT_DIM));
                        ui.spacing_mut().item_spacing.y = 0.0;
                        ScrollArea::vertical().id_salt("push-commits").auto_shrink([false, false]).show_rows(ui, 22.0, d.commits.len(), |ui, range| {
                            for c in &d.commits[range] {
                                if commit_row(ui, c, d.selected == Some(c.oid)).clicked() {
                                    select = Some(c.oid);
                                }
                            }
                        });
                    });
                });
                vsep(ui, body_h);
                ui.allocate_ui(vec2(ui.available_width(), body_h), |ui| {
                    ui.set_min_size(vec2(ui.available_width(), body_h));
                    ui.vertical(|ui| {
                        if let Some(oid) = d.selected {
                            if let Some(p) = files_list(ui, d.details.as_ref().filter(|x| x.info.oid == oid), "push-files") {
                                diff = Some((oid, p));
                            }
                        }
                    });
                });
            });
            ui.separator();
            if d.confirm_force {
                ui.label(RichText::new("Force push overwrites the remote branch if nobody else pushed to it since your last fetch (--force-with-lease). Continue?").color(theme::WARNING));
                ui.horizontal(|ui| {
                    if ui.button("Force Push").clicked() {
                        d.confirm_force = false;
                        deferred = Some(push_job(true, d.set_upstream && d.upstream.is_none()));
                        d.pushing = true;
                    }
                    if ui.button("Cancel").clicked() {
                        d.confirm_force = false;
                    }
                });
                return;
            }
            ui.horizontal(|ui| {
                ui.checkbox(&mut d.force, "Force push (with lease)");
                if d.upstream.is_none() {
                    ui.checkbox(&mut d.set_upstream, "Set upstream");
                }
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    let can = !d.pushing && !d.detached && (d.upstream.is_none() || !d.commits.is_empty() || d.force);
                    if d.pushing {
                        ui.spinner();
                    }
                    if ui.add_enabled(can, egui::Button::new(if d.force { "Force Push" } else { "Push" })).clicked() {
                        if d.force {
                            d.confirm_force = true;
                        } else {
                            deferred = Some(push_job(false, d.set_upstream && d.upstream.is_none()));
                            d.pushing = true;
                        }
                    }
                });
            });
        });
    if let Some(oid) = select {
        d.selected = Some(oid);
        d.details = None;
        load_details(state, oid, DetailsTarget::Push);
    }
    if !open {
        state.git_ui.remote.push = None;
    }
    if let Some((oid, path)) = diff {
        super::diff::open_commit_diff(state, oid, &path);
    }
    if let Some(f) = deferred {
        f(state);
    }
}

fn push_job(force: bool, set_upstream: bool) -> Box<dyn FnOnce(&mut AppState)> {
    Box::new(move |state| {
        let title = if force { "Force Push" } else { "Push" };
        run_op(state, title, "Pushed", false, move |r| r.push(force, set_upstream).map(Some), |state, ok| {
            if ok {
                state.git_ui.remote.push = None;
            } else if let Some(d) = state.git_ui.remote.push.as_mut() {
                d.pushing = false;
            }
        });
    })
}

fn update_window(state: &mut AppState, ctx: &Context) {
    let Some(d) = state.git_ui.remote.update.as_mut() else { return };
    let mut close = false;
    let mut go: Option<bool> = None;
    let m = Modal::new(Id::new("git-update-dialog")).show(ctx, |ui| {
        ui.set_width(360.0);
        ui.label(RichText::new("Update Project").strong().color(theme::TEXT_BRIGHT));
        ui.add_space(6.0);
        ui.label(RichText::new("Update type").small().color(theme::TEXT_DIM));
        ui.radio_value(&mut d.rebase, false, "Merge incoming changes into the current branch");
        ui.radio_value(&mut d.rebase, true, "Rebase the current branch on top of incoming changes");
        ui.add_space(8.0);
        ui.horizontal(|ui| {
            if ui.button("OK").clicked() || ui.input(|i| i.key_pressed(Key::Enter)) {
                go = Some(d.rebase);
            }
            if ui.button("Cancel").clicked() {
                close = true;
            }
        });
    });
    if m.should_close() {
        close = true;
    }
    if let Some(rebase) = go {
        state.git_ui.remote.update = None;
        state.git_ui.remote.update_rebase = rebase;
        update_project(state, rebase);
    } else if close {
        state.git_ui.remote.update = None;
    }
}

pub fn update_project(state: &mut AppState, rebase: bool) {
    let body = if rebase { "Rebased onto the upstream" } else { "Merged the upstream" };
    run_op(state, "Update Project", body, true, move |r| r.pull(rebase).map(Some), |_, _| {});
}

fn stash_window(state: &mut AppState, ctx: &Context) {
    let Some(d) = state.git_ui.remote.stash.as_mut() else { return };
    let mut close = false;
    let mut go = false;
    let branch = state.git.branch.clone().unwrap_or_default();
    let m = Modal::new(Id::new("git-stash-dialog")).show(ctx, |ui| {
        ui.set_width(420.0);
        ui.label(RichText::new("Stash Changes").strong().color(theme::TEXT_BRIGHT));
        ui.label(RichText::new(format!("Current branch: {branch}")).small().color(theme::TEXT_DIM));
        ui.add_space(6.0);
        let r = ui.add(TextEdit::singleline(&mut d.message).hint_text("Message").desired_width(f32::INFINITY));
        if !d.focused {
            d.focused = true;
            r.request_focus();
        }
        ui.checkbox(&mut d.include_untracked, "Include untracked files");
        ui.add_space(6.0);
        let enter = r.lost_focus() && ui.input(|i| i.key_pressed(Key::Enter));
        ui.horizontal(|ui| {
            if ui.button("Create Stash").clicked() || enter {
                go = true;
            }
            if ui.button("Cancel").clicked() {
                close = true;
            }
        });
    });
    if m.should_close() {
        close = true;
    }
    if go {
        let message = d.message.clone();
        let untracked = d.include_untracked;
        state.git_ui.remote.stash = None;
        run_op(state, "Stash Changes", "Changes stashed", false, move |r| r.stash_save(&message, untracked).map(|_| None), |_, _| {});
    } else if close {
        state.git_ui.remote.stash = None;
    }
}

fn unstash_window(state: &mut AppState, ctx: &Context) {
    let Some(d) = state.git_ui.remote.unstash.as_mut() else { return };
    let mut open = true;
    let mut select: Option<usize> = None;
    let mut deferred: Deferred = None;
    let mut diff: Option<(Oid, PathBuf)> = None;
    egui::Window::new("Unstash Changes")
        .id(Id::new("git-unstash-window"))
        .open(&mut open)
        .collapsible(false)
        .resizable(false)
        .anchor(Align2::CENTER_CENTER, vec2(0.0, 0.0))
        .show(ctx, |ui| {
            ui.set_width(700.0);
            if d.loading {
                ui.spinner();
                return;
            }
            if d.entries.is_empty() {
                ui.label(RichText::new("There are no stashes.").color(theme::TEXT_DIM));
                return;
            }
            let body_h = 280.0;
            ui.horizontal_top(|ui| {
                let w = ui.available_width();
                ui.allocate_ui(vec2(w * 0.5, body_h), |ui| {
                    ui.set_min_size(vec2(w * 0.5, body_h));
                    ui.spacing_mut().item_spacing.y = 0.0;
                    ScrollArea::vertical().id_salt("stash-list").auto_shrink([false, false]).show(ui, |ui| {
                        for (i, e) in d.entries.iter().enumerate() {
                            let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), 22.0), Sense::click());
                            let sel = d.selected == Some(i);
                            crate::util::label_selectable(&resp, format!("stash@{{{}}} {}", e.index, e.message), sel);
                            let p = ui.painter().with_clip_rect(rect.intersect(ui.clip_rect()));
                            if sel {
                                p.rect_filled(rect, 0.0, theme::SELECTION);
                            } else if resp.hovered() {
                                p.rect_filled(rect, 0.0, theme::HOVER);
                            }
                            let r = p.text(rect.left_center() + vec2(4.0, 0.0), Align2::LEFT_CENTER, format!("stash@{{{}}}", e.index), FontId::monospace(12.0), theme::TEXT_DIM);
                            p.text(egui::pos2(r.right() + 8.0, rect.center().y), Align2::LEFT_CENTER, &e.message, FontId::proportional(13.0), if sel { theme::TEXT_BRIGHT } else { theme::TEXT });
                            if resp.clicked() {
                                select = Some(i);
                            }
                        }
                    });
                });
                vsep(ui, body_h);
                ui.allocate_ui(vec2(ui.available_width(), body_h), |ui| {
                    ui.set_min_size(vec2(ui.available_width(), body_h));
                    ui.vertical(|ui| {
                        if let Some(e) = d.selected.and_then(|i| d.entries.get(i)) {
                            let oid = e.oid;
                            if let Some(p) = files_list(ui, d.details.as_ref().filter(|x| x.info.oid == oid), "stash-files") {
                                diff = Some((oid, p));
                            }
                        }
                    });
                });
            });
            ui.separator();
            let Some((sel, sel_oid)) = d.selected.and_then(|i| d.entries.get(i)).map(|e| (e.index, e.oid)) else { return };
            if let Some(drop_ix) = d.confirm_drop {
                let drop_oid = d.entries.iter().find(|e| e.index == drop_ix).map(|e| e.oid);
                ui.label(RichText::new(format!("Drop stash@{{{drop_ix}}}? Its changes are lost.")).color(theme::WARNING));
                ui.horizontal(|ui| {
                    if ui.button("Drop").clicked() {
                        d.confirm_drop = None;
                        d.busy = true;
                        deferred = Some(Box::new(move |state| {
                            run_op(state, "Drop Stash", format!("Dropped stash@{{{drop_ix}}}"), false, move |r| r.stash_drop(stash_index(r, drop_ix, drop_oid)?).map(|_| None), |state, _| {
                                if state.git_ui.remote.unstash.is_some() {
                                    open_unstash_dialog(state);
                                }
                            });
                        }));
                    }
                    if ui.button("Cancel").clicked() {
                        d.confirm_drop = None;
                    }
                });
                return;
            }
            ui.horizontal(|ui| {
                ui.checkbox(&mut d.reinstate_index, "Reinstate index");
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.add_enabled_ui(!d.busy, |ui| {
                        if ui.button("Drop").clicked() {
                            d.confirm_drop = Some(sel);
                        }
                        let reinstate = d.reinstate_index;
                        for (label, pop) in [("Pop", true), ("Apply", false)] {
                            if ui.button(label).clicked() {
                                d.busy = true;
                                deferred = Some(Box::new(move |state| {
                                    let title = if pop { "Unstash (pop)" } else { "Unstash (apply)" };
                                    run_op(state, title, format!("Applied stash@{{{sel}}}"), true, move |r| r.stash_apply_with(stash_index(r, sel, Some(sel_oid))?, pop, reinstate).map(Some), |state, ok| {
                                        if ok {
                                            state.git_ui.remote.unstash = None;
                                        } else if let Some(d) = state.git_ui.remote.unstash.as_mut() {
                                            d.busy = false;
                                        }
                                    });
                                }));
                            }
                        }
                    });
                    if d.busy {
                        ui.spinner();
                    }
                });
            });
        });
    if let Some(i) = select {
        d.selected = Some(i);
        d.details = None;
        if let Some(oid) = d.entries.get(i).map(|e| e.oid) {
            load_details(state, oid, DetailsTarget::Unstash);
        }
    }
    if !open {
        state.git_ui.remote.unstash = None;
    }
    if let Some((oid, path)) = diff {
        super::diff::open_commit_diff(state, oid, &path);
    }
    if let Some(f) = deferred {
        f(state);
    }
}

/// What a git write returns: CLI commands give their outcome, typed helpers give nothing.
pub(crate) type OpResult = ide_git::Result<Option<CommandOutcome>>;

/// Runs a git write on a worker. Afterwards it shows a toast (the summary on success, the
/// stderr on failure), refreshes git state, optionally looks for conflicts, and then calls
/// `then` with the success flag.
pub(crate) fn run_op<W, T>(state: &mut AppState, title: impl Into<String>, ok_body: impl Into<String>, check_conflicts: bool, work: W, then: T)
where
    W: FnOnce(&Repo) -> OpResult + Send + 'static,
    T: FnOnce(&mut AppState, bool) + Send + 'static,
{
    let Some(repo) = state.git.repo.clone() else {
        state.notifications.warn("No git repository", "The project is not inside a git repository.");
        return;
    };
    let title = title.into();
    let ok_body = ok_body.into();
    let label = title.clone();
    state.jobs.spawn(
        label,
        move || work(&repo),
        move |state, res: OpResult| {
            let ok = report(state, &title, &ok_body, res);
            state.refresh_git();
            if check_conflicts {
                super::conflicts::check_after_operation(state);
            }
            then(state, ok);
        },
    );
}

/// Turns an operation result into a toast. Returns whether it succeeded.
pub(crate) fn report(state: &mut AppState, title: &str, ok_body: &str, res: OpResult) -> bool {
    match res {
        Ok(Some(out)) if out.success => {
            let body = summary(&out);
            state.notifications.info(title.to_string(), if body.is_empty() { ok_body.to_string() } else { body });
            true
        }
        Ok(Some(out)) => {
            state.notifications.error(format!("{title} failed"), failure_body(&out));
            false
        }
        Ok(None) => {
            state.notifications.info(title.to_string(), ok_body.to_string());
            true
        }
        Err(Error::Command(out)) => {
            state.notifications.error(format!("{title} failed"), failure_body(&out));
            false
        }
        Err(e) => {
            state.notifications.error(format!("{title} failed"), e.to_string());
            false
        }
    }
}

/// git prints progress and results on both streams; the last lines carry the useful part.
fn summary(out: &CommandOutcome) -> String {
    let mut lines: Vec<&str> = out.stdout.lines().chain(out.stderr.lines()).map(str::trim_end).filter(|l| !l.trim().is_empty()).collect();
    if lines.len() > 8 {
        lines.drain(..lines.len() - 8);
    }
    lines.join("\n")
}

fn failure_body(out: &CommandOutcome) -> String {
    let err = out.stderr.trim();
    let body = if err.is_empty() { out.stdout.trim() } else { err };
    format!("{}\n{}", out.command, body)
}

/// The current `stash@{n}` of the stash the dialog showed as `index`. A stash made since the
/// dialog opened shifts the numbers, and Drop must never hit a different entry.
fn stash_index(repo: &ide_git::Repo, index: usize, oid: Option<ide_git::Oid>) -> ide_git::Result<usize> {
    let Some(oid) = oid else { return Ok(index) };
    repo.stash_list()?
        .into_iter()
        .find(|e| e.oid == oid)
        .map(|e| e.index)
        .ok_or_else(|| ide_git::Error::Other("The stash list changed. Reopen Unstash and try again.".into()))
}
