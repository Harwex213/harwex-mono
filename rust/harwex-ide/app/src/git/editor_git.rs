//! Editor-side git: gutter bar popup, Rollback Lines, Annotate (blame), Show History.

use std::collections::HashMap;
use std::ops::Range;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use egui::{Align2, Area, Context, Frame, Key, Order, Pos2, RichText, ScrollArea};
use ide_editor::EditorAction;
use ide_git::{BlameLine, CommitDetails, LineChange, LineChangeKind, Oid};

use crate::state::AppState;
use crate::tabs::TabId;
use crate::theme;

struct GutterPopup {
    tab: TabId,
    change: LineChange,
    anchor: Pos2,
    /// Doc version `change` was computed for. An edit makes its line numbers stale.
    version: u64,
}

struct CommitPopup {
    tab: TabId,
    path: PathBuf,
    oid: Oid,
    anchor: Pos2,
    details: Option<Result<CommitDetails, String>>,
}

struct Blame {
    lines: Vec<BlameLine>,
    /// Doc version the blame was computed for.
    version: u64,
    in_flight: bool,
    /// The run whose answer this entry waits for. An older run's answer is dropped, so a
    /// hung blame cannot block or overwrite a new one.
    run: u64,
    /// Stops the running `git blame` when the annotations are closed.
    cancel: Option<crate::jobs::Cancel>,
}

#[derive(Default)]
pub struct EditorGitUi {
    gutter: Option<GutterPopup>,
    commit: Option<CommitPopup>,
    /// Tabs with the annotation column on.
    blame: HashMap<TabId, Blame>,
    /// Source of `Blame::run`.
    blame_runs: u64,
}

impl EditorGitUi {
    /// An annotated tab whose blame is older than its text, or a blame that is running.
    pub(crate) fn blame_pending(&self, tabs: &crate::tabs::Tabs) -> bool {
        self.blame.iter().any(|(id, b)| b.in_flight || tabs.get(*id).and_then(|t| t.editor()).is_some_and(|e| b.version != e.doc.version()))
    }
}

pub fn on_editor_action(state: &mut AppState, tab: TabId, action: &EditorAction) {
    match action {
        EditorAction::GitAnnotate => toggle_annotate(state, tab),
        EditorAction::GitShowHistory => {
            if let Some(path) = state.ws.tabs.editor_mut(tab).map(|e| e.path.clone()) {
                super::log::show_file_history(state, &path);
            }
        }
        EditorAction::GitRollbackLines => {
            let Some(e) = state.ws.tabs.editor_mut(tab) else { return };
            let sel = e.view.selection();
            let start = e.doc.char_to_position(sel.start());
            let end = e.doc.char_to_position(sel.end());
            // A selection that ends at column 0 does not include that line, like IDEA.
            let last = if !sel.is_empty() && end.column == 0 && end.line > start.line { end.line - 1 } else { end.line };
            rollback(state, tab, start.line..last + 1);
        }
        _ => {}
    }
}

pub fn on_gutter_click(state: &mut AppState, tab: TabId, line: usize) {
    let Some(repo) = state.ws.git.repo.clone() else { return };
    let Some(e) = state.ws.tabs.editor_mut(tab) else { return };
    let text = e.doc.text();
    let version = e.doc.version();
    let path = e.path.clone();
    let anchor = state.ctx.input(|i| i.pointer.interact_pos()).unwrap_or(Pos2::new(300.0, 200.0));
    state.ws.git_ui.editor.gutter = None;
    state.jobs.spawn_quiet(
        move || repo.line_changes(&path, &text),
        move |state, res| {
            let Ok(changes) = res else { return };
            // The text changed since the click (or a newer click is pending): the lines are stale.
            if state.ws.tabs.editor_mut(tab).map(|e| e.doc.version()) != Some(version) {
                return;
            }
            let hit = changes.into_iter().find(|c| c.lines.contains(&line) || (c.lines.is_empty() && (c.lines.start == line || c.lines.start == line + 1)));
            if let Some(change) = hit {
                state.ws.git_ui.editor.gutter = Some(GutterPopup { tab, change, anchor, version });
            }
        },
    );
}

pub fn on_annotation_click(state: &mut AppState, tab: TabId, line: usize) {
    let Some(b) = state.ws.git_ui.editor.blame.get(&tab) else { return };
    // Between an edit and the next blame the line numbers do not match the text.
    if state.ws.tabs.get(tab).and_then(|t| t.editor()).map(|e| e.doc.version()) != Some(b.version) {
        state.notifications.info("Annotations are updating", "Click again in a moment.");
        return;
    }
    let Some(bl) = b.lines.get(line) else { return };
    if bl.oid.is_zero() {
        state.notifications.info("Not committed yet", "This line has local changes.");
        return;
    }
    let oid = bl.oid;
    let Some(repo) = state.ws.git.repo.clone() else { return };
    let Some(path) = state.ws.tabs.editor_mut(tab).map(|e| e.path.clone()) else { return };
    let anchor = state.ctx.input(|i| i.pointer.interact_pos()).unwrap_or(Pos2::new(300.0, 200.0));
    state.ws.git_ui.editor.commit = Some(CommitPopup { tab, path, oid, anchor, details: None });
    state.jobs.spawn_quiet(
        move || repo.commit_details(&oid).map_err(|e| e.to_string()),
        move |state, res| {
            if state.test.is_some() {
                eprintln!("[test] commit popup: {:?}", res.as_ref().map(|d| (d.info.summary.clone(), d.info.author_name.clone(), d.files.len())));
            }
            if let Some(p) = &mut state.ws.git_ui.editor.commit {
                if p.oid == oid {
                    p.details = Some(res);
                }
            }
        },
    );
}

/// Reverts the changes touching `lines` in the buffer. The new text goes through
/// `Document::set_text`, so Cmd+Z brings the change back.
fn rollback(state: &mut AppState, tab: TabId, lines: Range<usize>) {
    let Some(repo) = state.ws.git.repo.clone() else { return };
    let Some(e) = state.ws.tabs.editor_mut(tab) else { return };
    if e.read_only {
        return;
    }
    let text = e.doc.text();
    let version = e.doc.version();
    let path = e.path.clone();
    state.jobs.spawn_quiet(
        move || repo.rollback_lines(&path, &text, lines).map(|new| (new, text)),
        move |state, res| match res {
            Ok((new, old)) => {
                let Some(e) = state.ws.tabs.editor_mut(tab) else { return };
                if e.doc.version() != version {
                    state.notifications.warn("Rollback skipped", "The file changed while the rollback was computed. Try again.");
                    return;
                }
                if new == old {
                    return;
                }
                // The buffer uses `\n`; HEAD lines may carry `\r\n` on a CRLF file.
                let new = if old.contains('\r') { new } else { new.replace("\r\n", "\n") };
                if state.test.is_some() {
                    eprintln!("[test] rollback lines applied");
                }
                let Some(e) = state.ws.tabs.editor_mut(tab) else { return };
                e.doc.seal_undo_group();
                e.doc.set_text(&new);
                e.doc.seal_undo_group();
                e.last_edit = Instant::now();
                e.invalidate_marks();
                // The popup button took the focus; Cmd+Z must reach the editor right away.
                e.view.request_focus();
            }
            Err(err) => state.notifications.error("Rollback Lines failed", err.to_string()),
        },
    );
}

fn toggle_annotate(state: &mut AppState, tab: TabId) {
    if let Some(old) = state.ws.git_ui.editor.blame.remove(&tab) {
        if let Some(c) = old.cancel {
            c.cancel_quietly();
        }
        if let Some(e) = state.ws.tabs.editor_mut(tab) {
            e.annotations.clear();
        }
        return;
    }
    state.ws.git_ui.editor.blame.insert(tab, Blame { lines: Vec::new(), version: u64::MAX, in_flight: false, run: 0, cancel: None });
    run_blame(state, tab);
}

fn run_blame(state: &mut AppState, tab: TabId) {
    let Some(repo) = state.ws.git.repo.clone() else { return };
    state.ws.git_ui.editor.blame_runs += 1;
    let run = state.ws.git_ui.editor.blame_runs;
    let Some(b) = state.ws.git_ui.editor.blame.get_mut(&tab) else { return };
    if b.in_flight {
        return;
    }
    let Some(e) = state.ws.tabs.editor_mut(tab) else { return };
    b.in_flight = true;
    b.run = run;
    let text = e.doc.text();
    let version = e.doc.version();
    let path = e.path.clone();
    let cancel = state.jobs.spawn_cancellable(
        "Annotating",
        move || repo.blame_text(&path, &text),
        move |state, res| {
            let Some(b) = state.ws.git_ui.editor.blame.get_mut(&tab).filter(|b| b.run == run) else { return };
            b.in_flight = false;
            b.cancel = None;
            match res {
                Ok(lines) => {
                    let annotations = format_blame(&lines);
                    if state.test.is_some() {
                        eprintln!("[test] blame: {} lines, first {:?}", annotations.len(), annotations.first());
                    }
                    b.lines = lines;
                    b.version = version;
                    if let Some(e) = state.ws.tabs.editor_mut(tab) {
                        e.annotations = annotations;
                    }
                }
                Err(err) => {
                    state.ws.git_ui.editor.blame.remove(&tab);
                    state.notifications.error("Annotate failed", err.to_string());
                }
            }
        },
    );
    if let Some(b) = state.ws.git_ui.editor.blame.get_mut(&tab).filter(|b| b.run == run) {
        b.cancel = Some(cancel);
    }
}

fn format_blame(lines: &[BlameLine]) -> Vec<String> {
    // The column width comes from the longest string, so pad the author to a fixed width.
    lines
        .iter()
        .map(|l| {
            if l.oid.is_zero() {
                return format!("{:<10} {:<12}", "", "");
            }
            let author: String = l.author.chars().take(12).collect();
            format!("{} {author:<12}", format_date(l.author_time, 0))
        })
        .collect()
}

/// `YYYY-MM-DD` for a unix time shifted by `offset_minutes`. No chrono for one function.
pub fn format_date(time: i64, offset_minutes: i32) -> String {
    let secs = time + i64::from(offset_minutes) * 60;
    let days = secs.div_euclid(86_400);
    // Howard Hinnant's civil-from-days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

fn format_time(time: i64, offset_minutes: i32) -> String {
    let secs = (time + i64::from(offset_minutes) * 60).rem_euclid(86_400);
    let sign = if offset_minutes < 0 { '-' } else { '+' };
    let off = offset_minutes.abs();
    format!("{} {:02}:{:02} {sign}{:02}{:02}", format_date(time, offset_minutes), secs / 3600, secs / 60 % 60, off / 60, off % 60)
}

/// Re-blames annotated tabs after edits (debounced) and after commits.
fn refresh_blames(state: &mut AppState, force: bool) {
    let ids: Vec<TabId> = state.ws.git_ui.editor.blame.keys().copied().collect();
    for id in ids {
        let Some(e) = state.ws.tabs.editor_mut(id) else {
            // The tab closed: its running blame is no longer wanted.
            if let Some(c) = state.ws.git_ui.editor.blame.remove(&id).and_then(|b| b.cancel) {
                c.cancel_quietly();
            }
            continue;
        };
        let (version, rest) = (e.doc.version(), e.last_edit.elapsed());
        let Some(b) = state.ws.git_ui.editor.blame.get(&id) else { continue };
        if b.in_flight {
            continue;
        }
        if force || (b.version != version && b.version != u64::MAX) {
            let wait = Duration::from_millis(600);
            if !force && rest < wait {
                state.ctx.request_repaint_after(wait - rest);
                continue;
            }
            run_blame(state, id);
        }
    }
}

pub fn on_git_refreshed(state: &mut AppState) {
    refresh_blames(state, true);
}

pub fn show_windows(state: &mut AppState, ctx: &Context) {
    refresh_blames(state, false);
    gutter_popup(state, ctx);
    commit_popup(state, ctx);
}

fn popup_frame() -> Frame {
    Frame::popup(&egui::Style::default()).fill(theme::T.popup_bg).stroke(egui::Stroke::new(1.0_f32, theme::T.popup_border)).corner_radius(egui::CornerRadius::same(theme::T.radius.popup as u8))
}

fn gutter_popup(state: &mut AppState, ctx: &Context) {
    let Some(p) = &state.ws.git_ui.editor.gutter else { return };
    let version = state.ws.tabs.get(p.tab).and_then(|t| t.editor()).map(|e| e.doc.version());
    if state.ws.tabs.active != Some(p.tab) || version != Some(p.version) {
        state.ws.git_ui.editor.gutter = None;
        return;
    }
    let mut action = None;
    let c = &p.change;
    let area = Area::new(crate::workspace::wid("git-gutter-popup")).order(Order::Foreground).fixed_pos(p.anchor + egui::vec2(8.0, 4.0)).pivot(Align2::LEFT_TOP).constrain(true).show(ctx, |ui| {
        popup_frame().show(ui, |ui| {
            ui.set_max_width(700.0);
            ui.horizontal(|ui| {
                if ui.button("Rollback").on_hover_text("Revert this change in the editor (undoable)").clicked() {
                    action = Some(0);
                }
                if ui.button("Show Diff").clicked() {
                    action = Some(1);
                }
                if ui.button("Copy").on_hover_text("Copy the old text").clicked() {
                    action = Some(2);
                }
                let what = match c.kind {
                    LineChangeKind::Added => "Added lines",
                    LineChangeKind::Modified => "Modified lines",
                    LineChangeKind::Deleted => "Deleted lines",
                };
                ui.label(RichText::new(what).size(theme::T.font.tiny).color(theme::T.text_dim));
            });
            if c.kind != LineChangeKind::Added {
                ui.separator();
                ScrollArea::both().max_height(300.0).max_width(680.0).show(ui, |ui| {
                    let text = c.old_text.strip_suffix('\n').unwrap_or(&c.old_text);
                    ui.label(RichText::new(text).monospace().color(theme::T.text).background_color(theme::T.code_bg));
                });
            }
        });
    });
    let tab = p.tab;
    let lines = c.lines.clone();
    let old_text = c.old_text.clone();
    let clicked_outside = ctx.input(|i| i.pointer.any_pressed()) && !area.response.contains_pointer() && action.is_none();
    let escape = ctx.input(|i| i.key_pressed(Key::Escape));
    match action {
        Some(0) => {
            state.ws.git_ui.editor.gutter = None;
            // A deletion has an empty range at the line after it, which rollback_lines treats
            // as "the change next to this line".
            let range = if lines.is_empty() { lines.start..lines.start } else { lines };
            rollback(state, tab, range);
        }
        Some(1) => {
            state.ws.git_ui.editor.gutter = None;
            if let Some(path) = state.ws.tabs.editor_mut(tab).map(|e| e.path.clone()) {
                super::diff::open_worktree_diff(state, &path);
            }
        }
        Some(_) => {
            ctx.copy_text(old_text);
        }
        None if clicked_outside || escape => state.ws.git_ui.editor.gutter = None,
        None => {}
    }
}

fn commit_popup(state: &mut AppState, ctx: &Context) {
    let Some(p) = &state.ws.git_ui.editor.commit else { return };
    if state.ws.tabs.active != Some(p.tab) {
        state.ws.git_ui.editor.commit = None;
        return;
    }
    let mut action = None;
    let area = Area::new(crate::workspace::wid("git-commit-popup")).order(Order::Foreground).fixed_pos(p.anchor + egui::vec2(8.0, 4.0)).pivot(Align2::LEFT_TOP).constrain(true).show(ctx, |ui| {
        popup_frame().show(ui, |ui| {
            ui.set_max_width(560.0);
            match &p.details {
                None => {
                    ui.horizontal(|ui| {
                        ui.add(egui::Spinner::new().size(theme::T.font.small));
                        ui.label(format!("Loading {}...", &p.oid.to_string()[..8]));
                    });
                }
                Some(Err(e)) => {
                    ui.label(RichText::new(e).color(theme::T.error));
                }
                Some(Ok(d)) => {
                    let subject = d.message.lines().next().unwrap_or_default();
                    ui.label(RichText::new(subject).strong().color(theme::T.text_bright));
                    let body = d.message.lines().skip(1).collect::<Vec<_>>().join("\n");
                    let body = body.trim();
                    if !body.is_empty() {
                        ui.label(RichText::new(body).color(theme::T.text));
                    }
                    ui.add_space(4.0);
                    let i = &d.info;
                    ui.label(RichText::new(format!("{} <{}>", i.author_name, i.author_email)).color(theme::T.text));
                    ui.label(RichText::new(format_time(i.author_time, i.author_offset_minutes)).color(theme::T.text_dim));
                    ui.horizontal(|ui| {
                        ui.label(RichText::new(i.oid.to_string()).monospace().color(theme::T.text_dim));
                    });
                    ui.add_space(4.0);
                    ui.horizontal(|ui| {
                        if ui.button("Show Diff").on_hover_text("This file's changes in the commit").clicked() {
                            action = Some(0);
                        }
                        if ui.button("Copy Hash").clicked() {
                            action = Some(1);
                        }
                        ui.label(RichText::new(format!("{} file{} changed", d.files.len(), if d.files.len() == 1 { "" } else { "s" })).size(theme::T.font.tiny).color(theme::T.text_dim));
                    });
                }
            }
        });
    });
    let oid = p.oid;
    let path = p.path.clone();
    let clicked_outside = ctx.input(|i| i.pointer.any_pressed()) && !area.response.contains_pointer() && action.is_none();
    let escape = ctx.input(|i| i.key_pressed(Key::Escape));
    match action {
        Some(0) => {
            state.ws.git_ui.editor.commit = None;
            super::diff::open_commit_diff(state, oid, &path);
        }
        Some(_) => ctx.copy_text(oid.to_string()),
        None if clicked_outside || escape => state.ws.git_ui.editor.commit = None,
        None => {}
    }
}

/// Test hook steps on the active editor tab (see `changes::test_tick`).
pub fn test_step(state: &mut AppState, tab: TabId, flag: &str, arg: &str) {
    let line = arg.trim().parse::<usize>().ok().and_then(|l| l.checked_sub(1)).unwrap_or(0);
    match flag {
        "--test-git-annotate" => toggle_annotate(state, tab),
        "--test-git-history" => on_editor_action(state, tab, &EditorAction::GitShowHistory),
        "--test-git-gutter" => {
            state.ctx.input_mut(|i| i.pointer = Default::default());
            on_gutter_click(state, tab, line);
            if let Some(p) = &mut state.ws.git_ui.editor.gutter {
                p.anchor = Pos2::new(420.0, 160.0);
            }
            // The popup arrives with the job; pin its anchor then.
            let jobs = state.jobs.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(400));
                jobs.post(|state| {
                    if let Some(p) = &mut state.ws.git_ui.editor.gutter {
                        p.anchor = Pos2::new(420.0, 160.0);
                    }
                });
            });
        }
        "--test-git-rollback-lines" => rollback(state, tab, line..line + 1),
        "--test-git-blame-click" => {
            on_annotation_click(state, tab, line);
            if let Some(p) = &mut state.ws.git_ui.editor.commit {
                p.anchor = Pos2::new(420.0, 160.0);
            }
        }
        _ => {}
    }
}
