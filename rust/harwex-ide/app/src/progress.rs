//! The running-jobs widget in the status bar, like IDEA's progress indicator: a spinner, the
//! oldest job with its elapsed time and a stop `×`, and `+N` for more. Hover lists every job;
//! a press on the text opens the list with a `×` per job. A job that runs longer than
//! `Jobs::still_running_after` (30 s) turns into "still running — Cancel?".
//!
//! The `×` sets the job's cancel flag (`jobs::Cancel`). The job then ends with one
//! "Cancelled: <label>" toast; error toasts that carry the cancel text go to the log only
//! (`is_cancel_text`).

use egui::{vec2, Align2, CornerRadius, Id, Rect, RichText, Sense, Ui};

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

const LIST_ROW_H: f32 = 24.0;
const LIST_PAD: f32 = 6.0;
const LIST_W: f32 = 340.0;

/// Draws the widget into the status bar's right-to-left row. Nothing when no job runs.
pub fn status_widget(s: &mut AppState, ui: &mut Ui) {
    let t = &theme::T;
    let running = s.jobs.running();
    let ctx = ui.ctx().clone();
    let Some(first) = running.first().cloned() else {
        ctx.data_mut(|d| d.remove::<bool>(list_open_id()));
        return;
    };
    let hint_after = s.jobs.still_running_after();
    let deterministic = s.deterministic;
    ui.spacing_mut().item_spacing.x = 6.0;
    // Right to left: the × sits at the right end.
    let mut cancel = None;
    if !first.cancel.is_cancelled() && stop_button(ui, &first) {
        cancel = Some(first.id);
    }
    let late = first.started.elapsed() >= hint_after;
    let (mut text, color) = if first.cancel.is_cancelled() {
        (format!("{} — cancelling…", first.label), t.text_dim)
    } else if late {
        (format!("{} — still running, Cancel?", with_time(&first, deterministic)), t.warning)
    } else {
        (with_time(&first, deterministic), t.text_dim)
    };
    if running.len() > 1 {
        text = format!("{text}  +{}", running.len() - 1);
    }
    let label = ui.add(egui::Label::new(RichText::new(text).size(t.font.small).color(color)).sense(Sense::click()));
    crate::util::label_widget(&label, egui::WidgetType::Button, format!("Running: {}", first.label));
    // A spinner's angle follows the clock, so snapshots leave it out.
    if !deterministic {
        ui.add(egui::Spinner::new().size(t.font.small));
    }
    let open = ctx.data(|d| d.get_temp::<bool>(list_open_id())).unwrap_or(false);
    if crate::clicks::pressed(&label) {
        ctx.data_mut(|d| d.insert_temp(list_open_id(), !open));
    } else if open {
        if let Some(id) = list(&ctx, label.rect, &running, deterministic, hint_after) {
            cancel = Some(id);
        }
    } else {
        label.on_hover_ui(|ui| {
            for job in &running {
                ui.label(RichText::new(with_time(job, deterministic)).size(t.font.small));
            }
            ui.label(RichText::new("Press to cancel a job").size(t.font.small).color(t.text_dim));
        });
    }
    if let Some(id) = cancel {
        s.jobs.cancel(id);
    }
}

/// The small `×` for `job`. Acts on the press.
fn stop_button(ui: &mut Ui, job: &RunningJob) -> bool {
    let t = &theme::T;
    let (rect, resp) = ui.allocate_exact_size(vec2(16.0, 16.0), Sense::click());
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

/// The list of every running job above the widget, a `×` per row. Returns the job to cancel.
/// A press outside it or Escape closes it.
fn list(ctx: &egui::Context, widget: Rect, running: &[RunningJob], deterministic: bool, hint_after: std::time::Duration) -> Option<u64> {
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
    let x = (widget.max.x - LIST_W - margin.x).max(screen.min.x);
    let pos = egui::pos2(x, widget.min.y - 4.0 - height - margin.y);
    let mut chosen = None;
    let area = egui::Area::new(Id::new("progress-list")).order(egui::Order::Foreground).fixed_pos(pos).constrain(false).show(ctx, |ui| {
        frame.show(ui, |ui| {
            // An explicit size: an Area otherwise offers its content last frame's size.
            ui.set_width(LIST_W);
            ui.set_height(height);
            let origin = ui.min_rect().min;
            for (i, job) in running.iter().enumerate() {
                let row = Rect::from_min_size(origin + vec2(0.0, i as f32 * LIST_ROW_H), vec2(LIST_W, LIST_ROW_H));
                let stop = Rect::from_center_size(egui::pos2(row.max.x - 12.0, row.center().y), vec2(16.0, 16.0));
                let resp = ui.interact(stop, Id::new(("progress-list-stop", job.id)), Sense::click());
                // Several jobs may share a label; the row number tells them apart.
                crate::util::label_widget(&resp, egui::WidgetType::Button, format!("Cancel {} in the list ({})", job.label, i + 1));
                let late = job.started.elapsed() >= hint_after;
                let (text, color) = match (job.cancel.is_cancelled(), late) {
                    (true, _) => (format!("{} — cancelling…", job.label), t.text_dim),
                    (false, true) => (format!("{} — still running", with_time(job, deterministic)), t.warning),
                    (false, false) => (with_time(job, deterministic), t.text),
                };
                let text_rect = Rect::from_min_max(row.min + vec2(8.0, 0.0), egui::pos2(stop.min.x - 6.0, row.max.y));
                let galley = ui.painter().layout(text, t.small_font(), color, f32::INFINITY);
                ui.painter().with_clip_rect(text_rect).galley(Align2::LEFT_CENTER.align_size_within_rect(galley.size(), text_rect).min, galley, color);
                if !job.cancel.is_cancelled() {
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
    let pressed_outside = ctx.input(|i| i.pointer.any_pressed() && i.pointer.interact_pos().is_some_and(|p| !list_rect.contains(p) && !widget.contains(p)));
    let escape = ctx.input_mut(|i| i.consume_key(egui::Modifiers::NONE, egui::Key::Escape));
    if pressed_outside || escape {
        ctx.data_mut(|d| d.insert_temp(list_open_id(), false));
    }
    chosen
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
