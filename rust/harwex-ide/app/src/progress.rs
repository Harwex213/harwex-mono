//! The background tasks slot in the status bar, like IDEA's progress indicator. The slot has a
//! fixed width and sits between the breadcrumbs and the rest of the right part, so a job that
//! starts or ends never moves the breadcrumbs. It is empty while nothing runs.
//!
//! The slot shows the oldest job: a spinner, its label with the elapsed time (cut with `…`, the
//! full text on hover), `+N` for the other jobs, and a stop `×`. A press on the text opens the
//! tasks popup above the slot: every running job with its name, a progress bar (or a moving bar
//! when the job reports no progress) and a `×` when the job can be cancelled. The popup follows
//! the job list every frame and closes on Escape, a press outside it, or when the last job ends.
//! A job that runs longer than `Jobs::still_running_after` (30 s) turns into
//! "still running — Cancel?".
//!
//! The `×` sets the job's cancel flag (`jobs::Cancel`). The job then ends with one
//! "Cancelled: <label>" toast; error toasts that carry the cancel text go to the log only
//! (`is_cancel_text`).

use egui::{pos2, vec2, Align2, Color32, CornerRadius, Id, Rect, Sense, Ui};

use crate::icons::{self, Icon};
use crate::jobs::RunningJob;
use crate::state::AppState;
use crate::theme;

/// Whether an error text comes from a cancelled git command or language-server request.
pub fn is_cancel_text(text: &str) -> bool {
    text.contains(ide_git::CANCELLED) || text.contains(ide_lsp::CANCELLED)
}

fn list_open_id() -> Id {
    Id::new("progress-list-open")
}

/// The slot's width in a window of at least 800 pt for the status bar, and in a narrower one.
pub const SLOT_W: f32 = 240.0;
pub const SLOT_W_NARROW: f32 = 160.0;
const SPINNER_W: f32 = 14.0;
const STOP_W: f32 = 16.0;
const GAP: f32 = 6.0;
const LIST_ROW_H: f32 = 34.0;
const LIST_PAD: f32 = 6.0;
const LIST_W: f32 = 360.0;
const BAR_H: f32 = 4.0;

/// The status bar row of the oldest job: its text and color.
fn slot_text(job: &RunningJob, deterministic: bool, hint_after: std::time::Duration) -> (String, Color32) {
    let t = &theme::T;
    if job.cancel.is_cancelled() {
        (format!("{} — cancelling…", job.label), t.text_dim)
    } else if job.started.elapsed() >= hint_after {
        (format!("{} — still running, Cancel?", with_time(job, deterministic)), t.warning)
    } else {
        (with_time(job, deterministic), t.text_dim)
    }
}

/// Draws the slot into the status bar's right-to-left row, `width` wide whatever runs.
/// It only reads the job list; the popup opens from here too.
pub fn status_widget(s: &mut AppState, ui: &mut Ui, width: f32) {
    let t = &theme::T;
    let ctx = ui.ctx().clone();
    let (slot, _) = ui.allocate_exact_size(vec2(width, ui.available_height()), Sense::hover());
    let running = s.jobs.running();
    let Some(first) = running.first().cloned() else {
        ctx.data_mut(|d| d.remove::<bool>(list_open_id()));
        return;
    };
    let hint_after = s.jobs.still_running_after();
    let deterministic = s.deterministic;
    let painter = ui.painter_at(slot);
    let cy = slot.center().y;

    // Left to right: spinner, text, +N, ×. The × sits at the right end of the slot.
    let mut cancel = None;
    let stop = Rect::from_center_size(pos2(slot.max.x - STOP_W / 2.0, cy), vec2(STOP_W, STOP_W));
    if first.cancellable && !first.cancel.is_cancelled() && stop_button(ui, stop, &first) {
        cancel = Some(first.id);
    }
    let (text, color) = slot_text(&first, deterministic, hint_after);
    let more = (running.len() > 1).then(|| format!("+{}", running.len() - 1));
    let more_galley = more.as_ref().map(|m| painter.layout_no_wrap(m.clone(), t.small_font(), t.text));
    let text_x = slot.min.x + SPINNER_W + GAP;
    let more_w = more_galley.as_ref().map_or(0.0, |g| g.size().x + GAP);
    let mut job = egui::text::LayoutJob::simple_singleline(text.clone(), t.small_font(), color);
    job.wrap = egui::text::TextWrapping::truncate_at_width((stop.min.x - GAP - more_w - text_x).max(0.0));
    let galley = painter.layout_job(job);
    let text_w = galley.size().x;
    let full = match &more {
        Some(m) => format!("{text}  {m}"),
        None => text.clone(),
    };
    // The spinner, the text and `+N` are one press target; it opens the tasks popup.
    let target = Rect::from_min_max(slot.min, pos2(text_x + text_w + more_w, slot.max.y));
    let resp = ui.interact(target, Id::new("progress-slot"), Sense::click());
    resp.widget_info(|| egui::WidgetInfo { current_text_value: Some(full.clone()), ..egui::WidgetInfo::labeled(egui::WidgetType::Button, true, format!("Running: {}", first.label)) });
    if resp.hovered() {
        painter.rect_filled(target.shrink2(vec2(0.0, 2.0)), t.radius.button, t.hover_on_window);
    }
    // A spinner's angle follows the clock, so snapshots leave it out; its room stays.
    if !deterministic {
        let r = Rect::from_center_size(pos2(slot.min.x + SPINNER_W / 2.0, cy), vec2(SPINNER_W, SPINNER_W));
        egui::Spinner::new().size(t.font.small).paint_at(ui, r);
    }
    painter.galley(pos2(text_x, cy - galley.size().y / 2.0), galley, color);
    if let Some(g) = more_galley {
        painter.galley(pos2(text_x + text_w + GAP, cy - g.size().y / 2.0), g, t.text);
    }
    let open = ctx.data(|d| d.get_temp::<bool>(list_open_id())).unwrap_or(false);
    if crate::clicks::pressed(&resp) {
        ctx.data_mut(|d| d.insert_temp(list_open_id(), !open));
    } else if open {
        if let Some(id) = list(&ctx, slot, &running, deterministic, hint_after) {
            cancel = Some(id);
        }
    } else {
        resp.on_hover_ui(|ui| {
            // The whole text of the shown job, cut or not, then the others.
            ui.label(egui::RichText::new(&text).size(t.font.small));
            for job in running.iter().skip(1) {
                ui.label(egui::RichText::new(with_time(job, deterministic)).size(t.font.small));
            }
            ui.label(egui::RichText::new("Press to list the tasks").size(t.font.small).color(t.text_dim));
        });
    }
    if let Some(id) = cancel {
        s.jobs.cancel(id);
    }
    // The elapsed time and the moving bars change without input.
    if !deterministic {
        ctx.request_repaint_after(std::time::Duration::from_millis(500));
    }
}

/// The small `×` for `job` at `rect`. Acts on the press.
fn stop_button(ui: &mut Ui, rect: Rect, job: &RunningJob) -> bool {
    let t = &theme::T;
    let resp = ui.interact(rect, Id::new(("progress-stop", job.id)), Sense::click());
    crate::util::label_widget(&resp, egui::WidgetType::Button, format!("Cancel {}", job.label));
    if resp.hovered() {
        ui.painter().rect_filled(rect, t.radius.button, t.hover);
    }
    let color = if resp.hovered() { t.icon_active } else { t.icon };
    icons::paint(ui.painter(), rect.shrink(2.0), Icon::Close, color);
    let pressed = crate::clicks::pressed(&resp);
    resp.on_hover_text(format!("Cancel {}", job.label));
    pressed
}

/// The job's label and elapsed seconds. Snapshots never show a clock.
fn with_time(job: &RunningJob, deterministic: bool) -> String {
    match job.started.elapsed().as_secs() {
        _ if deterministic => job.label.clone(),
        0 => job.label.clone(),
        n => format!("{} {n}s", job.label),
    }
}

/// The progress bar under a job's name: the done share, or a moving segment while the job
/// reports none. Snapshots get the segment at the start.
fn progress_bar(ui: &Ui, rect: Rect, fraction: Option<f32>, deterministic: bool) {
    let t = &theme::T;
    let painter = ui.painter();
    let radius = BAR_H / 2.0;
    painter.rect_filled(rect, radius, t.scrollbar_track);
    let fill = match fraction {
        Some(f) => Rect::from_min_size(rect.min, vec2(rect.width() * f, rect.height())),
        None => {
            let w = rect.width() * 0.3;
            // The segment enters on the left and leaves on the right; snapshots hold it at the start.
            let x = if deterministic { rect.min.x } else { rect.min.x + (rect.width() + w) * (ui.input(|i| i.time) * 0.8).fract() as f32 - w };
            Rect::from_min_max(pos2(x.max(rect.min.x), rect.min.y), pos2((x + w).min(rect.max.x), rect.max.y))
        }
    };
    if fill.width() > 0.0 {
        painter.rect_filled(fill, radius, t.accent);
    }
}

/// The tasks popup above the slot: a row per running job with its name, progress and a `×`
/// when it can be cancelled. Returns the job to cancel. A press outside it or Escape closes it.
fn list(ctx: &egui::Context, slot: Rect, running: &[RunningJob], deterministic: bool, hint_after: std::time::Duration) -> Option<u64> {
    let t = &theme::T;
    let frame = egui::Frame::popup(&ctx.style())
        .fill(t.popup_bg)
        .stroke(egui::Stroke::new(1.0_f32, t.popup_border))
        .corner_radius(CornerRadius::same(t.radius.popup as u8))
        .inner_margin(egui::Margin::same(LIST_PAD as i8))
        .shadow(t.popup_shadow());
    let margin = frame.total_margin().sum();
    let height = running.len() as f32 * LIST_ROW_H;
    let screen = ctx.screen_rect();
    let x = slot.min.x.min(screen.max.x - LIST_W - margin.x).max(screen.min.x);
    let pos = pos2(x, slot.min.y - 4.0 - height - margin.y);
    let mut chosen = None;
    let area = egui::Area::new(Id::new("progress-list")).order(egui::Order::Foreground).fixed_pos(pos).constrain(false).default_size(vec2(LIST_W, height) + margin).show(ctx, |ui| {
        frame.show(ui, |ui| {
            // An explicit size: an Area otherwise offers its content last frame's size.
            ui.set_width(LIST_W);
            ui.set_height(height);
            let origin = ui.min_rect().min;
            for (i, job) in running.iter().enumerate() {
                let row = Rect::from_min_size(origin + vec2(0.0, i as f32 * LIST_ROW_H), vec2(LIST_W, LIST_ROW_H));
                let stop = Rect::from_center_size(pos2(row.max.x - 12.0, row.center().y), vec2(STOP_W, STOP_W));
                let late = job.started.elapsed() >= hint_after;
                let (text, color) = match (job.cancel.is_cancelled(), late) {
                    (true, _) => (format!("{} — cancelling…", job.label), t.text_dim),
                    (false, true) => (format!("{} — still running", with_time(job, deterministic)), t.warning),
                    (false, false) => (with_time(job, deterministic), t.text),
                };
                let content = Rect::from_min_max(row.min + vec2(8.0, 4.0), pos2(stop.min.x - 10.0, row.max.y - 6.0));
                let name = Rect::from_min_max(content.min, pos2(content.max.x, content.max.y - BAR_H - 4.0));
                let mut layout = egui::text::LayoutJob::simple_singleline(text.clone(), t.small_font(), color);
                layout.wrap = egui::text::TextWrapping::truncate_at_width(name.width());
                let galley = ui.painter().layout_job(layout);
                ui.painter().galley(Align2::LEFT_CENTER.align_size_within_rect(galley.size(), name).min, galley, color);
                let bar = Rect::from_min_max(pos2(content.min.x, content.max.y - BAR_H), content.max);
                progress_bar(ui, bar, job.progress.fraction(), deterministic);
                let info = ui.interact(row, Id::new(("progress-list-row", job.id)), Sense::hover());
                let percent = job.progress.fraction().map(|f| format!("{:.0}%", f * 100.0));
                info.widget_info(|| egui::WidgetInfo { current_text_value: Some(percent.clone().unwrap_or_else(|| "running".into())), ..egui::WidgetInfo::labeled(egui::WidgetType::ProgressIndicator, true, format!("Task {text}")) });
                if job.cancellable && !job.cancel.is_cancelled() {
                    let resp = ui.interact(stop, Id::new(("progress-list-stop", job.id)), Sense::click());
                    // Several jobs may share a label; the row number tells them apart.
                    crate::util::label_widget(&resp, egui::WidgetType::Button, format!("Cancel {} in the list ({})", job.label, i + 1));
                    if resp.hovered() {
                        ui.painter().rect_filled(stop, t.radius.button, t.hover);
                    }
                    icons::paint(ui.painter(), stop.shrink(2.0), Icon::Close, if resp.hovered() { t.icon_active } else { t.icon });
                    if crate::clicks::pressed(&resp) {
                        chosen = Some(job.id);
                    }
                }
            }
        });
    });
    let list_rect = area.response.rect;
    let pressed_outside = ctx.input(|i| i.pointer.any_pressed() && i.pointer.interact_pos().is_some_and(|p| !list_rect.contains(p) && !slot.contains(p)));
    let escape = ctx.input_mut(|i| i.consume_key(egui::Modifiers::NONE, egui::Key::Escape));
    if pressed_outside || escape {
        ctx.data_mut(|d| d.insert_temp(list_open_id(), false));
    }
    if !deterministic && running.iter().any(|j| j.progress.fraction().is_none()) {
        ctx.request_repaint();
    }
    chosen
}

/// Whether the tasks popup is open, for tests.
pub fn list_open(ctx: &egui::Context) -> bool {
    ctx.data(|d| d.get_temp::<bool>(list_open_id())).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_texts_of_both_crates_are_recognised() {
        let git = ide_git::Error::Cancelled { command: "git blame".into() }.to_string();
        let lsp = ide_lsp::Error::Cancelled { method: "textDocument/references".into() }.to_string();
        assert!(is_cancel_text(&git) && is_cancel_text(&lsp));
        assert!(!is_cancel_text("`git push` failed: rejected"));
    }
}
