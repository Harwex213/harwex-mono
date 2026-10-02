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
