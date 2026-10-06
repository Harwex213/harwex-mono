//! Small helpers without a better home.

use std::future::Future;
use std::pin::pin;
use std::sync::Arc;
use std::task::{Context, Poll, Wake, Waker};
use std::thread::Thread;

struct ThreadWaker(Thread);

impl Wake for ThreadWaker {
    fn wake(self: Arc<Self>) {
        self.0.unpark();
    }
}

/// Drives a future to completion on the current (worker) thread. Used for rfd's async dialog,
/// which must be created on the main thread but can be awaited anywhere.
pub fn block_on<F: Future>(fut: F) -> F::Output {
    let mut fut = pin!(fut);
    let waker = Waker::from(Arc::new(ThreadWaker(std::thread::current())));
    let mut cx = Context::from_waker(&waker);
    loop {
        match fut.as_mut().poll(&mut cx) {
            Poll::Ready(v) => return v,
            Poll::Pending => std::thread::park(),
        }
    }
}

/// egui's id of its one context menu (`egui::menu::CONTEXT_MENU_ID_STR`, crate-private).
const CONTEXT_MENU_ID: &str = "__egui::context_menu";

/// Closes the context menu when the widget that owns it was not drawn this frame.
///
/// egui shows and closes a context menu only inside the owner's `Response::context_menu` call.
/// When the owner stops being drawn (a virtualized row scrolled out, its tool window hidden by a
/// shortcut), the menu stays open but invisible. Its old rect then swallows every right-click
/// (`context_interaction` sees the pointer "in the old menu"), and `is_context_menu_open()`
/// stays true. Call once per frame, after every panel ran.
pub fn close_orphaned_context_menu(ctx: &egui::Context) {
    let id = egui::Id::new(CONTEXT_MENU_ID);
    let Some(owner) = ctx.data(|d| d.get_temp::<egui::menu::BarState>(id)).and_then(|s| s.as_ref().map(|root| root.id)) else { return };
    if ctx.viewport(|v| v.this_pass.widgets.get(owner).is_none()) {
        ctx.data_mut(|d| d.remove::<egui::menu::BarState>(id));
    }
}

/// A list-row button whose text is cut with `…` at the row width (IDEA's "expandable item").
/// While the pointer is over a cut row, an overlay on the tooltip layer repeats the row at its
/// exact position with the whole text on one line: same background, frame, font and colours.
/// The overlay runs past the list's right edge. When it does not fit on the screen, it moves
/// left; it never wraps. It shows in the frame the pointer arrives, with no tooltip frame.
///
/// `egui::Button` lays out its text privately and never says whether it cut it, so the row lays
/// the galley out here with the button's own wrap width and hands the galley to the button.
pub fn expandable_row(ui: &mut egui::Ui, text: impl Into<egui::WidgetText>, selected: bool, min_size: egui::Vec2) -> egui::Response {
    let text = text.into();
    let pad = ui.spacing().button_padding;
    let wrap_width = ui.available_width() - 2.0 * pad.x;
    let galley = text.clone().into_galley(ui, Some(egui::TextWrapMode::Truncate), wrap_width, egui::TextStyle::Button);
    let elided = galley.elided;
    let cut_size = galley.size();
    let resp = ui.add(egui::Button::new(galley).selected(selected).min_size(min_size));
    if elided && resp.hovered() {
        let full = text.into_galley(ui, Some(egui::TextWrapMode::Extend), f32::INFINITY, egui::TextStyle::Button);
        paint_expanded(ui, &resp, selected, cut_size, full);
    }
    resp
}

/// The last expanded row: the overlay rect and its text, for the pass that painted it.
#[derive(Clone)]
struct ExpandedRow {
    pass: u64,
    rect: egui::Rect,
    text: String,
}

fn expanded_row_id() -> egui::Id {
    egui::Id::new("harwex-expanded-row")
}

fn paint_expanded(ui: &egui::Ui, resp: &egui::Response, selected: bool, cut_size: egui::Vec2, full: std::sync::Arc<egui::Galley>) {
    let pad = ui.spacing().button_padding;
    let rect = resp.rect;
    // The same frame the button drew (`egui::Button`'s paint code).
    let visuals = ui.style().interact(resp);
    let (expansion, radius, fill, stroke) = if selected {
        let s = ui.visuals().selection;
        (egui::Vec2::ZERO, egui::CornerRadius::ZERO, s.bg_fill, s.stroke)
    } else {
        (egui::Vec2::splat(visuals.expansion), visuals.corner_radius, visuals.weak_bg_fill, visuals.bg_stroke)
    };
    // Where the button put its cut text; the whole text starts at the same spot.
    let text_pos = ui.layout().align_size_within_rect(cut_size, rect.shrink2(pad)).min;
    let width = (text_pos.x - rect.min.x + full.size().x + pad.x).max(rect.width());
    let screen = ui.ctx().screen_rect();
    let shift = (rect.min.x + width - screen.max.x).max(0.0).min(rect.min.x - screen.min.x).max(0.0);
    let overlay = egui::Rect::from_min_size(egui::pos2(rect.min.x - shift, rect.min.y), egui::vec2(width, rect.height()));
    let layer = egui::LayerId::new(egui::Order::Tooltip, resp.id.with("expanded"));
    let painter = ui.ctx().layer_painter(layer);
    // A see-through row fill would let the text under the overlay show through it.
    if fill.a() < 255 {
        painter.rect_filled(overlay.expand2(expansion), radius, ui.visuals().window_fill);
    }
    painter.rect(overlay.expand2(expansion), radius, fill, stroke, egui::StrokeKind::Inside);
    let text = full.text().to_string();
    painter.galley(egui::pos2(text_pos.x - shift, text_pos.y), full, visuals.text_color());
    let pass = ui.ctx().cumulative_pass_nr();
    ui.ctx().data_mut(|d| d.insert_temp(expanded_row_id(), ExpandedRow { pass, rect: overlay, text }));
}

/// The expandable-row overlay painted in the last frame: its rect and its text. Tests read it;
/// the overlay is paint only and has no accessibility node.
pub fn expanded_row(ctx: &egui::Context) -> Option<(egui::Rect, String)> {
    let row = ctx.data(|d| d.get_temp::<ExpandedRow>(expanded_row_id()))?;
    let pass = ctx.cumulative_pass_nr();
    (row.pass + 1 == pass).then_some((row.rect, row.text))
}

/// Gives a hand-painted widget an accessibility role and name. Screen readers and the UI tests
/// (`egui_kittest` queries by label) find the widget by it.
pub fn label_widget(resp: &egui::Response, typ: egui::WidgetType, label: impl Into<String>) {
    let label = label.into();
    let enabled = resp.enabled();
    resp.widget_info(|| egui::WidgetInfo::labeled(typ, enabled, label.clone()));
}

/// Like `label_widget`, for a row or button that can be selected (a tab, a list row).
pub fn label_selectable(resp: &egui::Response, label: impl Into<String>, selected: bool) {
    let label = label.into();
    let enabled = resp.enabled();
    resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::SelectableLabel, enabled, selected, label.clone()));
}
