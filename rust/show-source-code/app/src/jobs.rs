//! Background work. A job runs on its own thread and hands results back to the UI thread as
//! closures over `State`. The UI drains them at the start of each frame, so job code never
//! needs locks around app state.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;

use crate::State;

pub type UiCallback = Box<dyn FnOnce(&mut State) + Send>;

/// Cheap to clone; clones share the channel and the in-flight count.
#[derive(Clone)]
pub struct Jobs {
    tx: Sender<UiCallback>,
    ctx: egui::Context,
    /// Running jobs plus callbacks posted but not yet run. Zero means the UI is settled.
    in_flight: Arc<AtomicUsize>,
}

impl Jobs {
    pub fn new(ctx: egui::Context) -> (Jobs, Receiver<UiCallback>) {
        let (tx, rx) = channel();
        (Jobs { tx, ctx, in_flight: Arc::default() }, rx)
    }

    /// Runs `work` on a new thread, then `done` with its result on the UI thread. `work` gets a
    /// handle to post partial results with `post`.
    pub fn spawn<R: Send + 'static>(&self, label: &str, work: impl FnOnce(&Jobs) -> R + Send + 'static, done: impl FnOnce(&mut State, R) + Send + 'static) {
        self.in_flight.fetch_add(1, Ordering::SeqCst);
        let jobs = self.clone();
        let label = label.to_string();
        let spawned = std::thread::Builder::new().name(format!("job: {label}")).spawn(move || {
            match catch_unwind(AssertUnwindSafe(|| work(&jobs))) {
                Ok(r) => jobs.post(move |s| done(s, r)),
                Err(_) => eprintln!("[show-code-source] job {label:?} panicked"),
            }
            jobs.in_flight.fetch_sub(1, Ordering::SeqCst);
            jobs.ctx.request_repaint();
        });
        if spawned.is_err() {
            self.in_flight.fetch_sub(1, Ordering::SeqCst);
        }
    }

    /// Queues `f` for the UI thread and wakes it.
    pub fn post(&self, f: impl FnOnce(&mut State) + Send + 'static) {
        self.in_flight.fetch_add(1, Ordering::SeqCst);
        if self.tx.send(Box::new(f)).is_err() {
            self.in_flight.fetch_sub(1, Ordering::SeqCst);
        }
        self.ctx.request_repaint();
    }

    /// Called by the UI thread after it ran a posted callback.
    pub(crate) fn callback_done(&self) {
        self.in_flight.fetch_sub(1, Ordering::SeqCst);
    }

    pub fn is_idle(&self) -> bool {
        self.in_flight.load(Ordering::SeqCst) == 0
    }
}
