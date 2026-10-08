//! Background work. Every job runs on its own thread and hands its result back to the UI thread
//! as a closure over `AppState`. The UI drains those closures at the start of each frame, so job
//! code never needs locks around app state.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

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
    /// When the status bar starts to offer Cancel for a long job, in ms (tests shorten it).
    still_running_ms: Arc<AtomicU64>,
}

/// How long a job runs before the status bar asks "still running — Cancel?".
pub const STILL_RUNNING_AFTER: Duration = Duration::from_secs(30);

#[derive(Clone)]
pub struct RunningJob {
    pub id: u64,
    pub label: String,
    pub started: Instant,
    pub cancel: Cancel,
    /// How far the job is, when it reports it (`report_progress`).
    pub progress: JobProgress,
    /// False for a job that cannot stop early: the status bar offers no `×` for it.
    pub cancellable: bool,
}

/// The share of a job that is done, set from the job's thread and read by the status bar.
#[derive(Clone, Default)]
pub struct JobProgress(Arc<AtomicU32>);

impl JobProgress {
    /// Stored as millionths plus one, so the default 0 means "unknown".
    const SCALE: f32 = 1_000_000.0;

    pub fn set(&self, fraction: f32) {
        self.0.store((fraction.clamp(0.0, 1.0) * Self::SCALE) as u32 + 1, Ordering::Relaxed);
    }

    /// The done share in 0..=1, or `None` while the job reports nothing (a spinner then).
    pub fn fraction(&self) -> Option<f32> {
        match self.0.load(Ordering::Relaxed) {
            0 => None,
            v => Some((v - 1) as f32 / Self::SCALE),
        }
    }
}

/// The cancel switch of one job. Git commands and language-server requests made on the job's
/// thread watch it (`ide_git::CancelScope`, `ide_lsp::CancelScope`): git is killed with its
/// whole process group, a request gets `$/cancelRequest`. Other work may check `is_cancelled`.
#[derive(Clone, Default)]
pub struct Cancel {
    flag: Arc<AtomicBool>,
    /// Cancelled by the app itself (the user closed what the job works for): no toast.
    quiet: Arc<AtomicBool>,
}

impl Cancel {
    /// The user's Cancel: the job ends with a "Cancelled: <label>" toast.
    pub fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
    }

    /// Stops the job without a toast (its result is no longer wanted).
    pub fn cancel_quietly(&self) {
        self.quiet.store(true, Ordering::SeqCst);
        self.flag.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }

    /// Installs the flag for git and language-server calls on the current thread, and the
    /// job's progress for `report_progress`.
    fn enter(&self, progress: JobProgress) -> Scopes {
        let prev = CURRENT.with(|c| c.replace(Some(self.flag.clone())));
        let prev_progress = CURRENT_PROGRESS.with(|c| c.replace(Some(progress)));
        Scopes { _git: ide_git::CancelScope::enter(self.flag.clone()), _lsp: ide_lsp::CancelScope::enter(self.flag.clone()), prev, prev_progress, thread: std::thread::current().id() }
    }
}

thread_local! {
    static CURRENT: std::cell::RefCell<Option<Arc<AtomicBool>>> = const { std::cell::RefCell::new(None) };
    static CURRENT_PROGRESS: std::cell::RefCell<Option<JobProgress>> = const { std::cell::RefCell::new(None) };
}

/// Reports how far the labelled job running on this thread is (0..=1). The tasks popup then
/// draws a bar instead of a spinner. Does nothing on a thread without a job.
pub fn report_progress(fraction: f32) {
    CURRENT_PROGRESS.with(|c| {
        if let Some(p) = c.borrow().as_ref() {
            p.set(fraction);
        }
    });
}

/// The cancel flag of the labelled job running on this thread, for work that checks a flag
/// itself (a Find in Files walk). A fresh flag when no job runs here.
pub fn current_cancel() -> Arc<AtomicBool> {
    CURRENT.with(|c| c.borrow().clone()).unwrap_or_default()
}

/// The job's flag on one worker thread: for git, language servers and `current_cancel`.
struct Scopes {
    _git: ide_git::CancelScope,
    _lsp: ide_lsp::CancelScope,
    prev: Option<Arc<AtomicBool>>,
    prev_progress: Option<JobProgress>,
    thread: std::thread::ThreadId,
}

impl Drop for Scopes {
    fn drop(&mut self) {
        if std::thread::current().id() == self.thread {
            let prev = self.prev.take();
            CURRENT.with(|c| *c.borrow_mut() = prev);
            let prev = self.prev_progress.take();
            CURRENT_PROGRESS.with(|c| *c.borrow_mut() = prev);
        }
    }
}

/// Removes the job from the spinner list even when the work panics.
struct RunningGuard {
    id: u64,
    label: String,
    cancel: Cancel,
    progress: JobProgress,
    jobs: Jobs,
    /// The flag installed on the worker thread; dropped after the guard's own `drop`.
    scope: Option<Scopes>,
}

impl Drop for RunningGuard {
    fn drop(&mut self) {
        if let Ok(mut list) = self.jobs.running.lock() {
            list.retain(|j| j.id != self.id);
        }
        if self.cancel.is_cancelled() && !self.cancel.quiet.load(Ordering::SeqCst) {
            let label = std::mem::take(&mut self.label);
            self.jobs.post(move |state| state.notifications.info(format!("Cancelled: {label}"), ""));
        }
        self.jobs.in_flight.fetch_sub(1, Ordering::SeqCst);
        self.jobs.ctx.request_repaint();
    }
}

impl Jobs {
    pub fn new(ctx: egui::Context) -> (Jobs, Receiver<Posted>) {
        let (tx, rx) = channel();
        let jobs = Jobs {
            tx,
            ws: None,
            ctx,
            running: Arc::default(),
            next_id: Arc::new(AtomicU64::new(1)),
            in_flight: Arc::default(),
            still_running_ms: Arc::new(AtomicU64::new(STILL_RUNNING_AFTER.as_millis() as u64)),
        };
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

    /// Like `spawn`, and returns the job's cancel switch, so the caller can stop the job when
    /// its result is no longer wanted (`Cancel::cancel_quietly`).
    pub fn spawn_cancellable<R, W, D>(&self, label: impl Into<String>, work: W, done: D) -> Cancel
    where
        R: Send + 'static,
        W: FnOnce() -> R + Send + 'static,
        D: FnOnce(&mut AppState, R) + Send + 'static,
    {
        self.spawn_inner(Some(label.into()), work, done).unwrap_or_default()
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

    fn spawn_inner<R, W, D>(&self, label: Option<String>, work: W, done: D) -> Option<Cancel>
    where
        R: Send + 'static,
        W: FnOnce() -> R + Send + 'static,
        D: FnOnce(&mut AppState, R) + Send + 'static,
    {
        // Tracked on the UI thread, so the job shows in the status bar at once.
        let mut guard = label.as_ref().map(|label| self.track(label.clone(), true));
        let cancel = guard.as_ref().map(|g| g.cancel.clone());
        let jobs = self.clone();
        let name = label.clone().unwrap_or_else(|| "background task".into());
        self.in_flight.fetch_add(1, Ordering::SeqCst);
        let spawned = std::thread::Builder::new().name(format!("job: {name}")).spawn(move || {
            if let Some(g) = guard.as_mut() {
                g.scope = Some(g.cancel.enter(g.progress.clone()));
            }
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
        cancel
    }

    /// Adds an entry to the spinner list until the returned guard drops. Long-lived workers
    /// (tsserver queue, watcher) use this for the duration of one request.
    fn track(&self, label: String, cancellable: bool) -> RunningGuard {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let cancel = Cancel::default();
        let progress = JobProgress::default();
        if let Ok(mut list) = self.running.lock() {
            list.push(RunningJob { id, label: label.clone(), started: Instant::now(), cancel: cancel.clone(), progress: progress.clone(), cancellable });
        }
        self.in_flight.fetch_add(1, Ordering::SeqCst);
        self.ctx.request_repaint();
        RunningGuard { id, label, cancel, progress, jobs: self.clone(), scope: None }
    }

    /// Like `track`, but the caller only gets an opaque guard to drop when done. Call it on
    /// the worker thread: the job's cancel flag is installed for that thread until the guard
    /// drops, so git and language-server calls made meanwhile can be cancelled.
    pub fn busy(&self, label: impl Into<String>) -> impl Drop + Send {
        self.busy_with(label.into(), true)
    }

    /// Like `busy`, for work that cannot stop early (it waits on other threads): the status
    /// bar shows it with no `×`.
    pub fn busy_uncancellable(&self, label: impl Into<String>) -> impl Drop + Send {
        self.busy_with(label.into(), false)
    }

    fn busy_with(&self, label: String, cancellable: bool) -> RunningGuard {
        let mut guard = self.track(label, cancellable);
        guard.scope = Some(guard.cancel.enter(guard.progress.clone()));
        guard
    }

    /// The user pressed × on job `id`.
    pub fn cancel(&self, id: u64) {
        if let Some(job) = self.running().into_iter().find(|j| j.id == id && j.cancellable) {
            job.cancel.cancel();
        }
        self.ctx.request_repaint();
    }

    /// When the status bar starts to offer Cancel for a running job.
    pub fn still_running_after(&self) -> Duration {
        Duration::from_millis(self.still_running_ms.load(Ordering::Relaxed))
    }

    /// Tests shorten the 30 s before the "still running — Cancel?" hint.
    pub fn set_still_running_after(&self, after: Duration) {
        self.still_running_ms.store(after.as_millis() as u64, Ordering::Relaxed);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn busy_installs_the_cancel_flag_for_git_and_language_server_calls() {
        let (jobs, _rx) = Jobs::new(egui::Context::default());
        let dir = tempfile::tempdir().unwrap();
        assert!(std::process::Command::new("git").args(["init", "-q"]).current_dir(dir.path()).status().unwrap().success());
        let repo = ide_git::Repo::discover(dir.path()).unwrap();
        let lsp = ide_lsp::LspClient::new(ide_lsp::ClientConfig::new("missing", dir.path().join("no-such-server")));
        let timeout = Duration::from_secs(1);

        let guard = jobs.busy("Find Usages: x");
        let id = jobs.running()[0].id;
        jobs.cancel(id);
        assert!(repo.stage(&[dir.path().join("a")]).unwrap_err().is_cancelled());
        assert!(matches!(lsp.request("textDocument/references", serde_json::json!({}), timeout), Err(ide_lsp::Error::Cancelled { .. })));
        assert!(current_cancel().load(Ordering::SeqCst));
        drop(guard);
        assert!(!current_cancel().load(Ordering::SeqCst));
        // The flag lives only as long as the guard.
        assert!(matches!(lsp.request("textDocument/references", serde_json::json!({}), timeout), Err(ide_lsp::Error::Spawn(_))));
        assert!(jobs.running().is_empty());
    }

    #[test]
    fn progress_reaches_the_job_of_this_thread_only() {
        let (jobs, _rx) = Jobs::new(egui::Context::default());
        report_progress(0.5);
        let guard = jobs.busy_uncancellable("Indexing");
        let job = jobs.running()[0].clone();
        assert!(!job.cancellable && job.progress.fraction().is_none());
        report_progress(0.25);
        assert_eq!(job.progress.fraction(), Some(0.25));
        report_progress(2.0);
        assert_eq!(job.progress.fraction(), Some(1.0));
        // The × is not offered, and a cancel by id does nothing.
        jobs.cancel(job.id);
        assert!(!job.cancel.is_cancelled());
        drop(guard);
        report_progress(0.75);
        assert_eq!(job.progress.fraction(), Some(1.0), "no job on this thread any more");
    }
}
