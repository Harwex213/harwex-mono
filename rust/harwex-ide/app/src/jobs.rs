//! Background work. Every job runs on its own thread and hands its result back to the UI thread
//! as a closure over `AppState`. The UI drains those closures at the start of each frame, so job
//! code never needs locks around app state.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use crate::state::AppState;
use crate::workspace::WorkspaceId;

/// A piece of work for the UI thread.
pub type UiCallback = Box<dyn FnOnce(&mut AppState) + Send>;

/// A callback and the workspace it belongs to (`None`: the window itself).
pub type Posted = (Option<WorkspaceId>, UiCallback);

/// Cheap to clone; clones share the channel and the list of running tasks.
///
/// Every handle carries a workspace tag. `state.jobs` carries the workspace in context, and a
/// clone keeps the tag it was made with, so a worker started for project A delivers to A even
/// when B is active by then. A callback of a closed workspace is dropped.
#[derive(Clone)]
pub struct Jobs {
    tx: Sender<Posted>,
    ws: Option<WorkspaceId>,
    ctx: egui::Context,
    running: Arc<Mutex<Vec<RunningJob>>>,
    next_id: Arc<AtomicU64>,
    /// Jobs whose work runs, plus callbacks posted but not yet run on the UI thread.
    in_flight: Arc<AtomicUsize>,
}

#[derive(Clone)]
pub struct RunningJob {
    pub id: u64,
    pub label: String,
    pub started: Instant,
}

/// Removes the job from the spinner list even when the work panics.
struct RunningGuard {
    id: u64,
    running: Arc<Mutex<Vec<RunningJob>>>,
    ctx: egui::Context,
    in_flight: Arc<AtomicUsize>,
}

impl Drop for RunningGuard {
    fn drop(&mut self) {
        if let Ok(mut list) = self.running.lock() {
            list.retain(|j| j.id != self.id);
        }
        self.in_flight.fetch_sub(1, Ordering::SeqCst);
        self.ctx.request_repaint();
    }
}

impl Jobs {
    pub fn new(ctx: egui::Context) -> (Jobs, Receiver<Posted>) {
        let (tx, rx) = channel();
        let jobs = Jobs { tx, ws: None, ctx, running: Arc::default(), next_id: Arc::new(AtomicU64::new(1)), in_flight: Arc::default() };
        (jobs, rx)
    }

    /// A handle whose callbacks run with workspace `ws` in context (`None`: the active one,
    /// for window-level work such as the memory sampler).
    pub fn for_ws(&self, ws: Option<WorkspaceId>) -> Jobs {
        Jobs { ws, ..self.clone() }
    }

    /// A handle for window-level work: its callbacks run whatever workspace is open.
    pub fn window(&self) -> Jobs {
        self.for_ws(None)
    }

    /// The workspace this handle delivers to.
    pub fn workspace(&self) -> Option<WorkspaceId> {
        self.ws
    }

    pub(crate) fn set_workspace(&mut self, ws: Option<WorkspaceId>) {
        self.ws = ws;
    }

    #[allow(dead_code)] // Extension surface for the Git UI phase.
    pub fn ctx(&self) -> &egui::Context {
        &self.ctx
    }

    /// Runs `work` on a new thread and then `done` on the UI thread with its result.
    /// The label shows next to the status bar spinner while the job runs.
    pub fn spawn<R, W, D>(&self, label: impl Into<String>, work: W, done: D)
    where
        R: Send + 'static,
        W: FnOnce() -> R + Send + 'static,
        D: FnOnce(&mut AppState, R) + Send + 'static,
    {
        self.spawn_inner(Some(label.into()), work, done);
    }

    /// Like `spawn`, but invisible in the status bar. For short, frequent work (hover, matching).
    pub fn spawn_quiet<R, W, D>(&self, work: W, done: D)
    where
        R: Send + 'static,
        W: FnOnce() -> R + Send + 'static,
        D: FnOnce(&mut AppState, R) + Send + 'static,
    {
        self.spawn_inner(None, work, done);
    }

    fn spawn_inner<R, W, D>(&self, label: Option<String>, work: W, done: D)
    where
        R: Send + 'static,
        W: FnOnce() -> R + Send + 'static,
        D: FnOnce(&mut AppState, R) + Send + 'static,
    {
        let guard = label.as_ref().map(|label| self.track(label.clone()));
        let jobs = self.clone();
        let name = label.clone().unwrap_or_else(|| "background task".into());
        self.in_flight.fetch_add(1, Ordering::SeqCst);
        let spawned = std::thread::Builder::new().name(format!("job: {name}")).spawn(move || {
            let result = catch_unwind(AssertUnwindSafe(work));
            drop(guard);
            // The callback is counted before the job stops counting, so the total never
            // drops to zero in between.
            match result {
                Ok(r) => jobs.post(move |state| done(state, r)),
                Err(_) => jobs.post(move |state| state.notifications.error(format!("{name} failed"), "The task panicked.")),
            }
            jobs.in_flight.fetch_sub(1, Ordering::SeqCst);
        });
        if let Err(e) = spawned {
            self.in_flight.fetch_sub(1, Ordering::SeqCst);
            let msg = e.to_string();
            self.post(move |state| state.notifications.error("Cannot start a background task", msg));
        }
    }

    /// Adds an entry to the spinner list until the returned guard drops. Long-lived workers
    /// (tsserver queue, watcher) use this for the duration of one request.
    fn track(&self, label: String) -> RunningGuard {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut list) = self.running.lock() {
            list.push(RunningJob { id, label, started: Instant::now() });
        }
        self.in_flight.fetch_add(1, Ordering::SeqCst);
        self.ctx.request_repaint();
        RunningGuard { id, running: self.running.clone(), ctx: self.ctx.clone(), in_flight: self.in_flight.clone() }
    }

    /// Like `track`, but the caller only gets an opaque guard to drop when done.
    pub fn busy(&self, label: impl Into<String>) -> impl Drop + Send {
        self.track(label.into())
    }

    /// Schedules `f` on the UI thread. Callable from any thread.
    pub fn post(&self, f: impl FnOnce(&mut AppState) + Send + 'static) {
        self.in_flight.fetch_add(1, Ordering::SeqCst);
        // A send error means the app is shutting down; the result is no longer wanted.
        if self.tx.send((self.ws, Box::new(f))).is_err() {
            self.in_flight.fetch_sub(1, Ordering::SeqCst);
        }
        self.ctx.request_repaint();
    }

    /// The UI thread ran `n` posted callbacks.
    pub(crate) fn delivered(&self, n: usize) {
        if n > 0 {
            self.in_flight.fetch_sub(n, Ordering::SeqCst);
        }
    }

    /// Work not finished yet: running jobs, held `busy` guards and undelivered callbacks.
    pub fn in_flight(&self) -> usize {
        self.in_flight.load(Ordering::SeqCst)
    }

    /// Jobs with a label, oldest first.
    pub fn running(&self) -> Vec<RunningJob> {
        self.running.lock().map(|l| l.clone()).unwrap_or_default()
    }
}
