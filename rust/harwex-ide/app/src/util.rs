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

/// A list-row button whose text is cut with `…` at the row width. When the text is cut, hovering
/// the row shows `full()` as a tooltip.
///
/// `egui::Button` lays out its text privately and never says whether it cut it, so the row lays
/// the galley out here with the button's own wrap width and hands the galley to the button.
pub fn truncated_row(ui: &mut egui::Ui, text: impl Into<egui::WidgetText>, selected: bool, min_size: egui::Vec2, full: impl FnOnce() -> String) -> egui::Response {
    let wrap_width = ui.available_width() - 2.0 * ui.spacing().button_padding.x;
    let galley = text.into().into_galley(ui, Some(egui::TextWrapMode::Truncate), wrap_width, egui::TextStyle::Button);
    let elided = galley.elided;
    let resp = ui.add(egui::Button::new(galley).selected(selected).min_size(min_size));
    if elided {
        resp.on_hover_text(full())
    } else {
        resp
    }
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
