//! Conflicts dialog and three-pane merge, abort/continue for an in-progress merge/rebase.

mod merge;

use std::path::PathBuf;

use egui::{vec2, Align2, Context, Frame, Id, Modal, RichText, ScrollArea, Sense};
use ide_git::{ConflictChoice, RepoState};

use super::remote::run_op;
use crate::state::AppState;
use crate::theme;

pub struct ConflictsUi {
    pub(crate) op: RepoState,
    files: Vec<PathBuf>,
    dialog_open: bool,
    selected: Option<usize>,
    checking: bool,
    /// A check was requested while one ran; it runs again when the first returns.
    check_again: Option<bool>,
    confirm_abort: bool,
    busy: bool,
}

impl Default for ConflictsUi {
    fn default() -> Self {
        ConflictsUi { op: RepoState::Clean, files: Vec::new(), dialog_open: false, selected: None, checking: false, check_again: None, confirm_abort: false, busy: false }
    }
}

impl ConflictsUi {
    pub fn op(&self) -> RepoState {
        self.op
    }

    /// Conflicted paths, relative to the workdir.
    pub fn files(&self) -> &[PathBuf] {
        &self.files
    }

    pub fn dialog_open(&self) -> bool {
        self.dialog_open
    }

    pub fn is_busy(&self) -> bool {
        self.busy || self.checking
    }
}

/// Opens the conflicts dialog if the repository has conflicted files.
pub fn open_if_conflicts(state: &mut AppState) {
    check(state, true);
}

/// After a merge, rebase, pull, cherry-pick, revert or unstash.
pub fn check_after_operation(state: &mut AppState) {
    check(state, true);
}

pub fn on_git_refreshed(state: &mut AppState) {
    check(state, false);
}

/// Reads the operation state and the conflicted paths on a worker. `open` shows the dialog
/// when there are conflicts; without it the dialog only opens when conflicts newly appear
/// (for example after a merge in the terminal).
fn check(state: &mut AppState, open: bool) {
    let Some(repo) = state.git.repo.clone() else { return };
    let c = &mut state.git_ui.conflicts;
    if c.checking {
        c.check_again = Some(c.check_again.unwrap_or(false) || open);
        return;
    }
    c.checking = true;
    let generation = state.project_generation();
    state.jobs.spawn_quiet(
        move || (repo.state().unwrap_or(RepoState::Clean), repo.conflicts().unwrap_or_default()),
        move |state, (op, files)| {
            // Cleared before the generation check, or a check that outlived a project switch
            // would block every later check.
            state.git_ui.conflicts.checking = false;
            if state.project_generation() != generation {
                return;
            }
            let c = &mut state.git_ui.conflicts;
            let appeared = c.files.is_empty() && !files.is_empty();
            if (open || appeared) && !files.is_empty() {
                c.dialog_open = true;
            }
            if c.selected.is_none_or(|i| i >= files.len()) {
                c.selected = (!files.is_empty()).then_some(0);
            }
            c.files = files;
            c.op = op;
            if op == RepoState::Clean && c.files.is_empty() {
                c.dialog_open = false;
            }
            if let Some(again) = c.check_again.take() {
                check(state, again);
            }
        },
    );
}

fn op_name(op: RepoState) -> &'static str {
    match op {
        RepoState::Merge => "Merge",
        RepoState::Rebase => "Rebase",
        RepoState::CherryPick => "Cherry-pick",
        RepoState::Revert => "Revert",
        RepoState::Bisect => "Bisect",
        RepoState::Other => "Operation",
        RepoState::Clean => "",
    }
}

/// Column titles for the two sides. During a rebase git's "ours" is the branch being
/// rebased onto, so the labels follow what the user sees, not git's names.
pub(crate) fn side_labels(op: RepoState) -> (&'static str, &'static str) {
    match op {
        RepoState::Rebase => ("Upstream (ours)", "Your commit (theirs)"),
        _ => ("Yours", "Theirs"),
    }
}

pub fn show_windows(state: &mut AppState, ctx: &Context) {
    dialog(state, ctx);
    abort_confirm(state, ctx);
}

/// The in-progress operation bar under the top bar, with Abort and Continue. It is a panel, so
/// it pushes the editor down instead of covering a tab's toolbar (the merge tab's buttons sat
/// under the old floating banner).
pub fn banner(state: &mut AppState, ctx: &Context) {
    let c = &state.git_ui.conflicts;
    if matches!(c.op, RepoState::Clean | RepoState::Bisect) {
        return;
    }
    let name = op_name(c.op);
    let n = c.files.len();
    let mut resolve = false;
    let mut cont = false;
    let mut abort = false;
    let busy = c.busy;
    let fill = theme::T.banner_bg;
    egui::TopBottomPanel::top("git-op-banner").frame(Frame::NONE.fill(fill).inner_margin(egui::Margin::symmetric(10, 4))).show(ctx, |ui| {
        ui.horizontal(|ui| {
            {
                let text = if n > 0 { format!("{name} in progress: {n} conflicted file(s)") } else { format!("{name} in progress: all conflicts resolved") };
                ui.label(RichText::new(text).color(theme::T.text_bright));
                ui.add_space(8.0);
                if n > 0 && ui.button("Resolve...").clicked() {
                    resolve = true;
                }
                ui.add_enabled_ui(!busy, |ui| {
                    if ui.add_enabled(n == 0, egui::Button::new("Continue")).on_disabled_hover_text("Resolve all conflicts first").clicked() {
                        cont = true;
                    }
                    if ui.button("Abort").clicked() {
                        abort = true;
                    }
                });
                if busy {
                    ui.spinner();
                }
            }
        });
    });
    if resolve {
        state.git_ui.conflicts.dialog_open = true;
    }
    if cont {
        continue_operation(state);
    }
    if abort {
        state.git_ui.conflicts.confirm_abort = true;
    }
}

fn continue_operation(state: &mut AppState) {
    let name = op_name(state.git_ui.conflicts.op);
    state.git_ui.conflicts.busy = true;
    run_op(state, format!("Continue {}", name.to_lowercase()), format!("{name} finished"), true, |r| r.continue_operation().map(Some), |state, _| {
        state.git_ui.conflicts.busy = false;
    });
}

fn abort_confirm(state: &mut AppState, ctx: &Context) {
    if !state.git_ui.conflicts.confirm_abort {
        return;
    }
    let name = op_name(state.git_ui.conflicts.op);
    let mut choice = None;
    let m = Modal::new(Id::new("git-abort-confirm")).show(ctx, |ui| {
        ui.set_width(380.0);
        ui.label(RichText::new(format!("Abort {}?", name.to_lowercase())).strong().color(theme::T.text_bright));
        ui.label(RichText::new("The working tree returns to the state before the operation started. Resolved files are lost.").color(theme::T.warning));
        ui.add_space(6.0);
        ui.horizontal(|ui| {
            if ui.button("Abort").clicked() {
                choice = Some(true);
            }
            if ui.button("Cancel").clicked() {
                choice = Some(false);
            }
        });
    });
    if m.should_close() && choice.is_none() {
        choice = Some(false);
    }
    match choice {
        Some(true) => abort_operation(state),
        Some(false) => state.git_ui.conflicts.confirm_abort = false,
        None => {}
    }
}

fn abort_operation(state: &mut AppState) {
    let name = op_name(state.git_ui.conflicts.op);
    let c = &mut state.git_ui.conflicts;
    c.confirm_abort = false;
    c.busy = true;
    c.dialog_open = false;
    run_op(state, format!("Abort {}", name.to_lowercase()), format!("{name} aborted"), true, |r| r.abort_operation().map(Some), |state, _| {
        state.git_ui.conflicts.busy = false;
    });
}

fn dialog(state: &mut AppState, ctx: &Context) {
    if !state.git_ui.conflicts.dialog_open {
        return;
    }
    let mut open = true;
    let mut accept: Option<(PathBuf, ConflictChoice)> = None;
    let mut merge: Option<PathBuf> = None;
    let mut cont = false;
    let c = &mut state.git_ui.conflicts;
    let (yours, theirs) = side_labels(c.op);
    let title = if c.op == RepoState::Clean { "Conflicts".to_string() } else { format!("Conflicts ({})", op_name(c.op)) };
    egui::Window::new(title)
        .id(Id::new("git-conflicts-window"))
        .open(&mut open)
        .collapsible(false)
        .resizable(false)
        .anchor(Align2::CENTER_CENTER, vec2(0.0, 0.0))
        .show(ctx, |ui| {
            ui.set_width(620.0);
            if c.files.is_empty() {
                ui.label(RichText::new("All conflicts are resolved.").color(theme::T.text_bright));
                if c.op != RepoState::Clean {
                    ui.add_space(6.0);
                    if ui.add_enabled(!c.busy, egui::Button::new(format!("Continue {}", op_name(c.op).to_lowercase()))).clicked() {
                        cont = true;
                    }
                }
                return;
            }
            ui.label(RichText::new(format!("{} file(s) have conflicts. Pick a side, or merge them by hand.", c.files.len())).color(theme::T.text_dim));
            ui.add_space(4.0);
            ui.horizontal_top(|ui| {
                let list_w = ui.available_width() - 160.0;
                let h = 240.0;
                ui.allocate_ui(vec2(list_w, h), |ui| {
                    ui.set_min_size(vec2(list_w, h));
                    ui.spacing_mut().item_spacing.y = 0.0;
                    ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
                        for (i, f) in c.files.iter().enumerate() {
                            let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), 22.0), Sense::click());
                            let sel = c.selected == Some(i);
                            crate::util::label_selectable(&resp, format!("Conflict {}", f.display()), sel);
                            if sel {
                                ui.painter().rect_filled(rect, 0.0, theme::T.selection);
                            } else if resp.hovered() {
                                ui.painter().rect_filled(rect, 0.0, theme::T.hover);
                            }
                            ui.painter().text(rect.left_center() + vec2(6.0, 0.0), Align2::LEFT_CENTER, f.display().to_string(), theme::T.ui_font(), theme::T.git_conflict);
                            if resp.clicked() {
                                c.selected = Some(i);
                            }
                            if resp.double_clicked() {
                                merge = Some(f.clone());
                            }
                        }
                    });
                });
                ui.vertical(|ui| {
                    ui.set_width(150.0);
                    let sel = c.selected.and_then(|i| c.files.get(i)).cloned();
                    ui.add_enabled_ui(sel.is_some() && !c.busy, |ui| {
                        let full = egui::vec2(150.0, 24.0);
                        if ui.add_sized(full, egui::Button::new(format!("Accept {yours}"))).clicked() {
                            accept = sel.clone().map(|p| (p, ConflictChoice::Ours));
                        }
                        if ui.add_sized(full, egui::Button::new(format!("Accept {theirs}"))).clicked() {
                            accept = sel.clone().map(|p| (p, ConflictChoice::Theirs));
                        }
                        if ui.add_sized(full, egui::Button::new("Merge...")).clicked() {
                            merge = sel.clone();
                        }
                    });
                    if c.busy {
                        ui.spinner();
                    }
                });
            });
        });
    if !open {
        state.git_ui.conflicts.dialog_open = false;
    }
    if cont {
        state.git_ui.conflicts.dialog_open = false;
        continue_operation(state);
    }
    if let Some((path, choice)) = accept {
        state.git_ui.conflicts.busy = true;
        let side = match choice {
            ConflictChoice::Ours => yours,
            ConflictChoice::Theirs => theirs,
        };
        let body = format!("{} resolved with {side}", path.display());
        run_op(state, "Resolve Conflict", body, false, move |r| r.resolve_with(&path, choice).map(|_| None), |state, _| {
            state.git_ui.conflicts.busy = false;
            check(state, false);
        });
    }
    if let Some(path) = merge {
        open_merge(state, path);
    }
}

/// Opens the three-pane merge tab for a conflicted file (path relative to the workdir).
pub fn open_merge(state: &mut AppState, path: PathBuf) {
    let Some(repo) = state.git.repo.clone() else { return };
    let op = state.git_ui.conflicts.op;
    state.jobs.spawn(
        format!("Loading conflict in {}", path.display()),
        move || repo.conflict_sides(&path),
        move |state, res| match res {
            Ok(sides) if sides.binary => state.notifications.warn("Binary conflict", format!("{} is binary; use Accept Yours or Accept Theirs.", sides.path.display())),
            Ok(sides) => {
                state.git_ui.conflicts.dialog_open = false;
                let (l, r) = side_labels(op);
                state.tabs.open_custom(Box::new(merge::MergeTab::new(sides, l, r)));
            }
            Err(e) => state.notifications.error("Cannot load the conflict", e.to_string()),
        },
    );
}

/// Called by the merge tab after it wrote and staged a file.
pub(crate) fn merge_saved(state: &mut AppState) {
    check(state, true);
}

/// Test hook: resolves every block of the active merge tab with one side.
pub(crate) fn test_take_all(state: &mut AppState, theirs: bool) {
    let Some(id) = state.tabs.active else { return };
    if let Some(crate::tabs::TabContent::Custom(c)) = state.tabs.get_mut(id).map(|t| &mut t.content) {
        if let Some(m) = c.as_any_mut().downcast_mut::<merge::MergeTab>() {
            m.take_all(theirs);
        }
    }
}

pub(crate) fn test_describe(state: &AppState) -> String {
    let c = &state.git_ui.conflicts;
    format!("conflicts: op {:?}, files {:?}, dialog open {}", c.op, c.files, c.dialog_open)
}

/// Test hook: presses "Save and Mark Resolved" in the active merge tab.
pub(crate) fn test_save(state: &mut AppState) {
    let Some(id) = state.tabs.active else { return };
    let Some(crate::tabs::TabContent::Custom(c)) = state.tabs.get_mut(id).map(|t| &mut t.content) else { return };
    let Some(m) = c.as_any_mut().downcast_mut::<merge::MergeTab>() else { return };
    let text = m.result_text();
    let path = m.path().to_path_buf();
    eprintln!("[test-git] merge result for {}:\n{text}", path.display());
    m.request_save();
}

pub(crate) fn test_continue(state: &mut AppState) {
    continue_operation(state);
}

/// Test hook: confirms Abort, as the banner button plus the confirmation do.
pub(crate) fn test_abort(state: &mut AppState) {
    abort_operation(state);
}
