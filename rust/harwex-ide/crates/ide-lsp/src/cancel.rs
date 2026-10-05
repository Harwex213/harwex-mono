//! Cancellation of requests, and killing a server with its children.
//!
//! The app installs the cancel flag of a running job for the job's thread (`CancelScope`).
//! A request made on that thread watches the flag: once it is set, the request sends
//! `$/cancelRequest`, drops the late answer and returns `Error::Cancelled`.

use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::ThreadId;

thread_local! {
    static CURRENT: RefCell<Option<Arc<AtomicBool>>> = const { RefCell::new(None) };
}

/// Installs `flag` as the cancel flag of the current thread until the scope drops. Scopes
/// nest: dropping one restores the flag that was there before.
pub struct CancelScope {
    prev: Option<Arc<AtomicBool>>,
    thread: ThreadId,
}

impl CancelScope {
    pub fn enter(flag: Arc<AtomicBool>) -> CancelScope {
        let prev = CURRENT.with(|c| c.replace(Some(flag)));
        CancelScope { prev, thread: std::thread::current().id() }
    }
}

impl Drop for CancelScope {
    fn drop(&mut self) {
        // A scope moved to another thread must not overwrite that thread's flag.
        if std::thread::current().id() == self.thread {
            let prev = self.prev.take();
            CURRENT.with(|c| *c.borrow_mut() = prev);
        }
    }
}

pub(crate) fn current() -> Option<Arc<AtomicBool>> {
    CURRENT.with(|c| c.borrow().clone())
}

pub(crate) fn is_set(flag: &Option<Arc<AtomicBool>>) -> bool {
    flag.as_ref().is_some_and(|f| f.load(Ordering::SeqCst))
}

#[cfg(unix)]
extern "C" {
    // libc's kill(2); declared here so the crate keeps serde_json as its only dependency.
    fn kill(pid: i32, sig: i32) -> i32;
}

/// SIGKILL to the server's process group. A server starts helpers as its own children
/// (oxlint runs `tsgolint`, rust-analyzer runs proc-macro servers); they share its group
/// and die with it instead of hanging on as orphans.
pub(crate) fn kill_group(pgid: u32) {
    #[cfg(unix)]
    // SAFETY: kill(2) with a negative pid only sends a signal; it touches no memory.
    unsafe {
        const SIGKILL: i32 = 9;
        kill(-(pgid as i32), SIGKILL);
    }
    #[cfg(not(unix))]
    let _ = pgid;
}
