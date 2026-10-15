//! Conflicts dialog and three-pane merge, abort/continue for an in-progress merge/rebase.

pub mod merge;

use std::collections::BTreeSet;
use std::path::PathBuf;

use egui::text::{LayoutJob, TextFormat};
use egui::{vec2, Align2, Context, Frame, Modal, RichText, ScrollArea};
use ide_git::{CommandOutcome, ConflictChoice, Error, RebaseProgress, RepoState};

use super::remote::run_op;
use crate::state::AppState;
use crate::theme;

pub struct ConflictsUi {
    pub(crate) op: RepoState,
    files: Vec<PathBuf>,
    dialog_open: bool,
    /// Selected rows by path, so a refresh that removes resolved files keeps the rest.
    selected: BTreeSet<PathBuf>,
    /// The row of the last plain or Cmd click: Shift+click selects from it, Merge... opens it.
    lead: Option<PathBuf>,
    checking: bool,
    /// A check was requested while one ran; it runs again when the first returns.
    check_again: Option<bool>,
    confirm_abort: bool,
    busy: bool,
    /// Continue to End (task 107).
    auto: AutoContinue,
    progress: Option<RebaseProgress>,
    /// Bumped when an automatic continue ends. A check spawned before that may have read the
    /// repository while git was still writing, so its result never starts a continue.
    epoch: u64,
}

/// The Continue to End mode of a rebase.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AutoContinue {
    Off,
    /// `git rebase --continue` runs.
    Running,
    /// The rebase stopped on conflicts. The continue runs when the last one is resolved.
    WaitResolve,
    /// git refused to continue without the user's help. The text is git's message.
    Paused(String),
}

impl Default for ConflictsUi {
    fn default() -> Self {
        ConflictsUi { op: RepoState::Clean, files: Vec::new(), dialog_open: false, selected: BTreeSet::new(), lead: None, checking: false, check_again: None, confirm_abort: false, busy: false, auto: AutoContinue::Off, progress: None, epoch: 0 }
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

    pub fn auto(&self) -> &AutoContinue {
        &self.auto
    }

    /// The step of the rebase in progress, as of the last check.
    pub fn progress(&self) -> Option<RebaseProgress> {
        self.progress
    }

    pub fn is_busy(&self) -> bool {
        self.busy || self.checking
    }

    /// Selected conflicted paths, in list order.
    pub fn selected(&self) -> Vec<PathBuf> {
        self.files.iter().filter(|f| self.selected.contains(*f)).cloned().collect()
    }

    /// Drops selected paths that are no longer conflicted. An empty selection falls back to the
    /// first row, so the buttons always have a target while files remain.
    fn keep_selection(&mut self) {
        let files = &self.files;
        self.selected.retain(|p| files.contains(p));
        if self.lead.as_ref().is_some_and(|l| !files.contains(l)) {
            self.lead = None;
        }
        if self.selected.is_empty() {
            if let Some(first) = files.first() {
                self.selected.insert(first.clone());
                self.lead = Some(first.clone());
            }
        }
        if self.lead.is_none() {
            self.lead = files.iter().find(|f| self.selected.contains(*f)).cloned();
        }
    }

    /// A press on row `i`: plain selects only it, Cmd toggles it, Shift selects the range from
    /// the lead row.
    fn press_row(&mut self, i: usize, mods: egui::Modifiers) {
        let Some(path) = self.files.get(i).cloned() else { return };
        if mods.shift {
            let from = self.lead.as_ref().and_then(|l| self.files.iter().position(|f| f == l)).unwrap_or(i);
            let (a, b) = if from <= i { (from, i) } else { (i, from) };
            if !mods.command {
                self.selected.clear();
            }
            self.selected.extend(self.files[a..=b].iter().cloned());
            return;
        }
        if mods.command {
            if !self.selected.remove(&path) {
                self.selected.insert(path.clone());
            }
        } else {
            self.selected.clear();
            self.selected.insert(path.clone());
        }
        self.lead = Some(path);
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
    let Some(repo) = state.ws.git.repo.clone() else { return };
    let c = &mut state.ws.git_ui.conflicts;
    if c.checking {
        c.check_again = Some(c.check_again.unwrap_or(false) || open);
        return;
    }
    c.checking = true;
    let epoch = c.epoch;
    let generation = state.project_generation();
    state.jobs.spawn_quiet(
        move || (repo.state().unwrap_or(RepoState::Clean), repo.conflicts().unwrap_or_default(), repo.rebase_progress().ok().flatten()),
        move |state, (op, files, progress)| {
            // Cleared before the generation check, or a check that outlived a project switch
            // would block every later check.
            state.ws.git_ui.conflicts.checking = false;
            if state.project_generation() != generation {
                return;
            }
            let c = &mut state.ws.git_ui.conflicts;
            let appeared = c.files.is_empty() && !files.is_empty();
            if (open || appeared) && !files.is_empty() {
                c.dialog_open = true;
            }
            c.files = files;
            c.keep_selection();
            c.op = op;
            c.progress = progress;
            if op == RepoState::Clean && c.files.is_empty() {
                c.dialog_open = false;
            }
            let fresh = c.epoch == epoch && c.check_again.is_none();
            if fresh && op != RepoState::Rebase {
                c.auto = AutoContinue::Off;
            }
            // The last conflict of a stop is resolved (the dialog, the merge tab or a terminal):
            // Continue to End goes on without asking.
            let resume = fresh && c.auto == AutoContinue::WaitResolve && op == RepoState::Rebase && c.files.is_empty() && !c.busy;
            if let Some(again) = c.check_again.take() {
                check(state, again);
            }
            if resume {
                continue_step(state);
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

/// The in-progress operation bar under the top bar: Resolve, Continue, Continue to End (a
/// rebase only) and Abort. It is a panel, so it pushes the editor down instead of covering a
/// tab's toolbar (the merge tab's buttons sat under the old floating banner). The status text
/// and a hidden Resolve keep their widths, so the buttons never move between states.
pub fn banner(state: &mut AppState, ctx: &Context) {
    let c = &state.ws.git_ui.conflicts;
    if matches!(c.op, RepoState::Clean | RepoState::Bisect) {
        return;
    }
    let name = op_name(c.op);
    let n = c.files.len();
    let rebase = c.op == RepoState::Rebase;
    let mut resolve = false;
    let mut cont = false;
    let mut to_end = false;
    let mut abort = false;
    let busy = c.busy;
    let resolved_text = format!("{name} in progress: all conflicts resolved");
    let text = if n > 0 { format!("{name} in progress: {n} conflicted file(s)") } else { resolved_text.clone() };
    let mode = mode_text(c);
    let fill = theme::T.banner_bg;
    egui::TopBottomPanel::top(crate::workspace::wid("git-op-banner")).frame(Frame::NONE.fill(fill).inner_margin(egui::Margin::symmetric(10, 4))).show(ctx, |ui| {
        ui.horizontal(|ui| {
            let width = |ui: &egui::Ui, t: &str, style: egui::TextStyle| {
                let font = style.resolve(ui.style());
                ui.fonts(|f| f.layout_no_wrap(t.to_string(), font, theme::T.text).size().x)
            };
            let slot = width(ui, &resolved_text, egui::TextStyle::Body).max(width(ui, &text, egui::TextStyle::Body));
            let label = ui.label(RichText::new(&text).color(theme::T.text_bright));
            ui.add_space(slot - label.rect.width() + 8.0);
            if n > 0 {
                resolve = ui.button("Resolve...").clicked();
            } else {
                let w = width(ui, "Resolve...", egui::TextStyle::Button) + 2.0 * ui.spacing().button_padding.x;
                ui.allocate_exact_size(vec2(w, 1.0), egui::Sense::hover());
            }
            ui.add_enabled_ui(!busy, |ui| {
                cont = ui.add_enabled(n == 0, egui::Button::new("Continue")).on_disabled_hover_text("Resolve all conflicts first").clicked();
                if rebase {
                    to_end = ui.button("Continue to End").on_hover_text("Continue, and continue again by itself after each stop you resolve").clicked();
                }
                abort = ui.button("Abort").clicked();
            });
            let spin = ui.spacing().interact_size.y;
            if busy {
                ui.add(egui::Spinner::new().size(spin));
            } else {
                ui.allocate_exact_size(vec2(spin, spin), egui::Sense::hover());
            }
            if let Some((text, color, full)) = mode {
                let r = ui.add(egui::Label::new(RichText::new(text).color(color)).truncate());
                if let Some(full) = full {
                    r.on_hover_text(full);
                }
            }
        });
    });
    if resolve {
        state.ws.git_ui.conflicts.dialog_open = true;
    }
    if cont {
        continue_operation(state);
    }
    if to_end {
        continue_to_end(state);
    }
    if abort {
        state.ws.git_ui.conflicts.confirm_abort = true;
    }
}

/// The banner's Continue to End line: its text, colour and the full git message of a pause.
fn mode_text(c: &ConflictsUi) -> Option<(String, egui::Color32, Option<String>)> {
    let step = c.progress.map(|p| format!(" (step {} of {})", p.step, p.total)).unwrap_or_default();
    match &c.auto {
        AutoContinue::Off => None,
        AutoContinue::Running => Some((format!("Continuing to the end…{step}"), theme::T.text_bright, None)),
        AutoContinue::WaitResolve => Some((format!("Continuing to the end…{step} Resolve the conflicts to go on."), theme::T.text_bright, None)),
        AutoContinue::Paused(reason) => Some((format!("Continue to End stopped{step}: {}", first_paragraph(reason)), theme::T.warning, Some(reason.clone()))),
    }
}

/// git's message up to its first blank line, on one line, without `hint:` lines.
fn first_paragraph(text: &str) -> String {
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.starts_with("hint:")).skip_while(|l| l.is_empty()).take_while(|l| !l.is_empty()).collect();
    lines.join(" ")
}

/// Continue, Enter in the dialog and the test hook. While Continue to End is on, every continue
/// goes through its own step, so a stop is handled the same way whoever pressed.
fn continue_operation(state: &mut AppState) {
    if state.ws.git_ui.conflicts.auto != AutoContinue::Off {
        continue_step(state);
        return;
    }
    let name = op_name(state.ws.git_ui.conflicts.op);
    state.ws.git_ui.conflicts.busy = true;
    run_op(state, format!("Continue {}", name.to_lowercase()), format!("{name} finished"), true, |r| r.continue_operation().map(Some), |state, _| {
        state.ws.git_ui.conflicts.busy = false;
    });
}

/// Continue to End: turns the mode on and continues. With conflicts still open it only waits
/// for them.
pub(crate) fn continue_to_end(state: &mut AppState) {
    let c = &mut state.ws.git_ui.conflicts;
    if c.op != RepoState::Rebase || c.busy {
        return;
    }
    if c.files.is_empty() {
        continue_step(state);
    } else {
        c.auto = AutoContinue::WaitResolve;
    }
}

/// One `git rebase --continue` of Continue to End. The worker reads the state it left, so the
/// next move never depends on a check that raced with git.
fn continue_step(state: &mut AppState) {
    let Some(repo) = state.ws.git.repo.clone() else { return };
    let c = &mut state.ws.git_ui.conflicts;
    c.busy = true;
    c.auto = AutoContinue::Running;
    c.dialog_open = false;
    super::refresh::write_started(state);
    state.jobs.spawn(
        "Continue rebase",
        move || {
            let run = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| repo.continue_operation())).unwrap_or_else(|_| Err(Error::Other("the git task panicked".into())));
            let run = match run {
                Err(Error::Command(out)) => Ok(out),
                other => other,
            };
            (run, repo.state().unwrap_or(RepoState::Clean), repo.conflicts().unwrap_or_default(), repo.rebase_progress().ok().flatten())
        },
        move |state, (run, op, files, progress): (ide_git::Result<CommandOutcome>, RepoState, Vec<PathBuf>, Option<RebaseProgress>)| {
            super::refresh::write_done(state, super::refresh::Refresh::Changed);
            let c = &mut state.ws.git_ui.conflicts;
            c.busy = false;
            c.epoch += 1;
            c.op = op;
            c.files = files;
            c.keep_selection();
            c.progress = progress;
            match run {
                Err(e) => {
                    c.auto = AutoContinue::Off;
                    state.notifications.error("Continue to End failed", e.to_string());
                }
                Ok(out) if op != RepoState::Rebase => {
                    c.auto = AutoContinue::Off;
                    if out.success {
                        state.notifications.info("Continue to End", "Rebase finished");
                    } else {
                        state.notifications.error("Continue to End failed", git_message(&out));
                    }
                }
                Ok(_) if !c.files.is_empty() => {
                    c.auto = AutoContinue::WaitResolve;
                    c.dialog_open = true;
                }
                // An edit or break stop: git continues from it without input.
                Ok(out) if out.success => continue_step(state),
                Ok(out) => c.auto = AutoContinue::Paused(git_message(&out)),
            }
        },
    );
}

/// git's stderr (else stdout). Progress lines end in `\r`; only their last state is kept.
fn git_message(out: &CommandOutcome) -> String {
    let err = out.stderr.trim();
    let text = if err.is_empty() { out.stdout.trim() } else { err };
    text.lines().map(|l| l.rsplit('\r').next().unwrap_or(l)).collect::<Vec<_>>().join("\n")
}

fn abort_confirm(state: &mut AppState, ctx: &Context) {
    if !state.ws.git_ui.conflicts.confirm_abort {
        return;
    }
    let name = op_name(state.ws.git_ui.conflicts.op);
    let mut choice = None;
    let m = Modal::new(crate::workspace::wid("git-abort-confirm")).show(ctx, |ui| {
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
        Some(false) => state.ws.git_ui.conflicts.confirm_abort = false,
        None => {}
    }
}

fn abort_operation(state: &mut AppState) {
    let name = op_name(state.ws.git_ui.conflicts.op);
    let c = &mut state.ws.git_ui.conflicts;
    c.confirm_abort = false;
    c.auto = AutoContinue::Off;
    c.busy = true;
    c.dialog_open = false;
    run_op(state, format!("Abort {}", name.to_lowercase()), format!("{name} aborted"), true, |r| r.abort_operation().map(Some), |state, _| {
        state.ws.git_ui.conflicts.busy = false;
    });
}

fn dialog(state: &mut AppState, ctx: &Context) {
    if !state.ws.git_ui.conflicts.dialog_open {
        return;
    }
    let mut open = true;
    let mut accept: Option<(Vec<PathBuf>, ConflictChoice)> = None;
    let mut merge: Option<PathBuf> = None;
    let mut cont = false;
    let mut pressed: Option<usize> = None;
    let clicks = state.clicks;
    let mods = ctx.input(|i| i.modifiers);
    let c = &mut state.ws.git_ui.conflicts;
    let (yours, theirs) = side_labels(c.op);
    let title = if c.op == RepoState::Clean { "Conflicts".to_string() } else { format!("Conflicts ({})", op_name(c.op)) };
    egui::Window::new(title)
        .id(crate::workspace::wid("git-conflicts-window"))
        .open(&mut open)
        .collapsible(false)
        .resizable(false)
        .anchor(Align2::CENTER_CENTER, vec2(0.0, 0.0))
        .show(ctx, |ui| {
            ui.set_width(DIALOG_W);
            if c.files.is_empty() {
                ui.label(RichText::new("All conflicts are resolved.").color(theme::T.text_bright));
                if matches!(c.auto, AutoContinue::WaitResolve | AutoContinue::Running) {
                    // Continue to End goes on by itself; the dialog does not ask.
                    ui.add_space(6.0);
                    ui.label(RichText::new("Continuing to the end…").color(theme::T.text_dim));
                } else if c.op != RepoState::Clean {
                    ui.add_space(6.0);
                    if ui.add_enabled(!c.busy, egui::Button::new(format!("Continue {}", op_name(c.op).to_lowercase()))).clicked() {
                        cont = true;
                    }
                }
                return;
            }
            ui.label(RichText::new(format!("{} file(s) have conflicts. Pick a side, or merge them by hand.", c.files.len())).color(theme::T.text_dim));
            ui.add_space(4.0);
            let labels = [format!("Accept {yours}"), format!("Accept {theirs}"), "Merge...".to_string()];
            // The button column is as wide as its longest label, so a label never wraps and the
            // list never runs under the buttons.
            let pad = ui.spacing().button_padding.x;
            let font = egui::TextStyle::Button.resolve(ui.style());
            let label_w = labels.iter().map(|l| ui.fonts(|f| f.layout_no_wrap(l.clone(), font.clone(), theme::T.text).size().x)).fold(0.0_f32, f32::max);
            let col_w = (label_w + 2.0 * pad + 4.0).max(150.0);
            let gap = ui.spacing().item_spacing.x;
            let list_w = (ui.available_width() - col_w - gap).max(100.0);
            ui.horizontal_top(|ui| {
                // Top-down: the ScrollArea's rows take this layout, and `horizontal_top` would
                // put them side by side.
                ui.allocate_ui_with_layout(vec2(list_w, LIST_H), egui::Layout::top_down(egui::Align::Min), |ui| {
                    ui.set_min_size(vec2(list_w, LIST_H));
                    ui.set_max_width(list_w);
                    Frame::NONE.stroke(ui.visuals().widgets.noninteractive.bg_stroke).show(ui, |ui| {
                        ui.spacing_mut().item_spacing.y = 0.0;
                        // Rows look like list items, not buttons, until hovered or selected.
                        ui.visuals_mut().widgets.inactive.weak_bg_fill = theme::T.clear;
                        ui.visuals_mut().widgets.inactive.bg_stroke = egui::Stroke::NONE;
                        ScrollArea::vertical().auto_shrink([false, false]).min_scrolled_height(0.0).max_height(LIST_H - 2.0).show(ui, |ui| {
                            for (i, f) in c.files.iter().enumerate() {
                                let sel = c.selected.contains(f);
                                let min_size = vec2(ui.available_width(), theme::T.space.row_h + 2.0);
                                let resp = crate::util::expandable_row(ui, row_job(f), sel, min_size);
                                crate::util::label_selectable(&resp, format!("Conflict {}", f.display()), sel);
                                if crate::clicks::pressed(&resp) {
                                    pressed = Some(i);
                                }
                                if clicks.double(&resp) {
                                    merge = Some(f.clone());
                                }
                            }
                        });
                    });
                });
                ui.vertical(|ui| {
                    ui.set_width(col_w);
                    let sel = c.selected();
                    ui.add_enabled_ui(!sel.is_empty() && !c.busy, |ui| {
                        let size = vec2(col_w, 24.0);
                        if ui.add_sized(size, egui::Button::new(&labels[0])).clicked() {
                            accept = Some((sel.clone(), ConflictChoice::Ours));
                        }
                        if ui.add_sized(size, egui::Button::new(&labels[1])).clicked() {
                            accept = Some((sel.clone(), ConflictChoice::Theirs));
                        }
                        if ui.add_sized(size, egui::Button::new(&labels[2])).clicked() {
                            merge = c.lead.clone().filter(|l| sel.contains(l)).or_else(|| sel.first().cloned());
                        }
                    });
                    if c.busy {
                        ui.spinner();
                    }
                });
            });
        });
    if let Some(i) = pressed {
        state.ws.git_ui.conflicts.press_row(i, mods);
    }
    if !open {
        state.ws.git_ui.conflicts.dialog_open = false;
    }
    if cont {
        state.ws.git_ui.conflicts.dialog_open = false;
        continue_operation(state);
    }
    if let Some((paths, choice)) = accept {
        state.ws.git_ui.conflicts.busy = true;
        let side = match choice {
            ConflictChoice::Ours => yours,
            ConflictChoice::Theirs => theirs,
        };
        let body = match paths.as_slice() {
            [one] => format!("{} resolved with {side}", one.display()),
            many => format!("{} files resolved with {side}", many.len()),
        };
        run_op(
            state,
            "Resolve Conflict",
            body,
            false,
            move |r| {
                for p in &paths {
                    r.resolve_with(p, choice)?;
                }
                Ok(None)
            },
            |state, _| {
                state.ws.git_ui.conflicts.busy = false;
                check(state, false);
            },
        );
    }
    if let Some(path) = merge {
        open_merge(state, path);
    }
}

const DIALOG_W: f32 = 640.0;
const LIST_H: f32 = 240.0;

/// A conflict row: the file name in the conflict colour, then its folder dimmed (as in Search
/// Everywhere).
fn row_job(path: &std::path::Path) -> LayoutJob {
    let mut job = LayoutJob::default();
    let name = path.file_name().map_or_else(|| path.display().to_string(), |n| n.to_string_lossy().into_owned());
    job.append(&name, 0.0, TextFormat { font_id: theme::T.ui_font(), color: theme::T.git_conflict, ..Default::default() });
    if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
        job.append(&format!("  {}", dir.display()), 0.0, TextFormat { font_id: theme::T.small_font(), color: theme::T.text_dim, ..Default::default() });
    }
    job
}

/// Opens the three-pane merge tab for a conflicted file (path relative to the workdir). The
/// result edits the file's editor tab, so the file opens in one too (in the background).
pub fn open_merge(state: &mut AppState, path: PathBuf) {
    let Some(repo) = state.ws.git.repo.clone() else { return };
    let op = state.ws.git_ui.conflicts.op;
    state.jobs.spawn(
        format!("Loading conflict in {}", path.display()),
        move || {
            let sides = repo.conflict_sides(&path)?;
            let abs = repo.workdir().join(&sides.path);
            let abs = dunce::canonicalize(&abs).unwrap_or(abs);
            let bytes = std::fs::read(&abs).unwrap_or_default();
            let doc = ide_editor::Document::open(&abs).ok();
            Ok((sides, abs, bytes, doc))
        },
        move |state, res: ide_git::Result<_>| match res {
            Ok((sides, _, _, _)) if sides.binary => state.notifications.warn("Binary conflict", format!("{} is binary; use Accept Yours or Accept Theirs.", sides.path.display())),
            Ok((sides, abs, bytes, doc)) => {
                state.ws.git_ui.conflicts.dialog_open = false;
                let key = format!("merge:{}", sides.path.display());
                if let Some(id) = state.ws.tabs.custom_by_key(&key) {
                    state.ws.tabs.activate(id);
                    return;
                }
                let opened = state.ws.tabs.editor_by_path(&abs).is_none();
                if opened {
                    let doc = doc.unwrap_or_else(|| ide_editor::Document::from_text(&String::from_utf8_lossy(&bytes), ide_editor::Language::from_path(&abs)));
                    state.add_editor_tab(abs.clone(), doc, None);
                }
                let Some(eid) = state.ws.tabs.editor_by_path(&abs) else { return };
                let mut tab = merge::MergeTab::new(sides, side_labels(op), abs, bytes, opened);
                if let Some(e) = state.ws.tabs.editor_mut(eid) {
                    tab.init(&mut e.doc);
                    e.last_edit = std::time::Instant::now();
                }
                state.ws.tabs.open_custom(Box::new(tab));
            }
            Err(e) => state.notifications.error("Cannot load the conflict", e.to_string()),
        },
    );
}

/// The "Save" answer of the close prompt for a merge tab: it saves by resolving. Returns false
/// for any other tab.
pub fn request_merge_save(state: &mut AppState, id: crate::tabs::TabId) -> bool {
    let Some(crate::tabs::TabContent::Custom(c)) = state.ws.tabs.get_mut(id).map(|t| &mut t.content) else { return false };
    let Some(m) = c.as_any_mut().downcast_mut::<merge::MergeTab>() else { return false };
    m.request_save();
    state.ws.tabs.activate(id);
    true
}

/// The active merge tab and its lent editor tab, for the test hooks.
fn with_active_merge(state: &mut AppState, f: impl FnOnce(&mut merge::MergeTab, &mut crate::tabs::EditorTab)) {
    let Some(id) = state.ws.tabs.active else { return };
    let shared = match state.ws.tabs.get(id).map(|t| &t.content) {
        Some(crate::tabs::TabContent::Custom(c)) => c.shared_editor().and_then(|p| state.ws.tabs.editor_by_path(&p)),
        _ => None,
    };
    let (Some(tab), Some((_, e))) = state.ws.tabs.get_with_editor(id, shared) else { return };
    let crate::tabs::TabContent::Custom(c) = &mut tab.content else { return };
    if let Some(m) = c.as_any_mut().downcast_mut::<merge::MergeTab>() {
        f(m, e);
    }
}

/// Called by the merge tab after it wrote and staged a file.
pub(crate) fn merge_saved(state: &mut AppState) {
    check(state, true);
}

/// Test hook: resolves every block of the active merge tab with one side.
pub(crate) fn test_take_all(state: &mut AppState, theirs: bool) {
    with_active_merge(state, |m, e| m.test_take_all(&mut e.doc, theirs));
}

pub(crate) fn test_describe(state: &AppState) -> String {
    let c = &state.ws.git_ui.conflicts;
    format!("conflicts: op {:?}, files {:?}, dialog open {}, auto {:?}", c.op, c.files, c.dialog_open, c.auto)
}

/// Test hook: presses "Save and Mark Resolved" in the active merge tab.
pub(crate) fn test_save(state: &mut AppState) {
    with_active_merge(state, |m, e| {
        eprintln!("[test-git] merge result for {}:\n{}", m.path().display(), e.doc.text());
        m.request_save();
    });
}

pub(crate) fn test_continue(state: &mut AppState) {
    continue_operation(state);
}

/// Test hook: confirms Abort, as the banner button plus the confirmation do.
pub(crate) fn test_abort(state: &mut AppState) {
    abort_operation(state);
}
