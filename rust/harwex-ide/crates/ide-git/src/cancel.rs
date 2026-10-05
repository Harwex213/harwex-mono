//! Cancellation of git CLI runs.
//!
//! The app installs the cancel flag of a running job for the job's thread (`CancelScope`).
//! Every git command that thread starts watches the flag. The flag is thread-scoped, so the
//! dozens of `Repo` methods need no extra parameter.

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

/// The cancel flag of the current thread, if a scope is active.
pub(crate) fn current() -> Option<Arc<AtomicBool>> {
    CURRENT.with(|c| c.borrow().clone())
}

pub(crate) fn is_set(flag: &Option<Arc<AtomicBool>>) -> bool {
    flag.as_ref().is_some_and(|f| f.load(Ordering::SeqCst))
}

/// Signals a whole process group. git runs hooks, `sh` and `git-lfs filter-process` as its
/// own children; they share git's group, so one call reaches all of them.
#[cfg(unix)]
pub(crate) fn signal_group(pgid: u32, signal: i32) {
    // SAFETY: kill(2) with a negative pid only sends a signal; it touches no memory.
    unsafe {
        libc::kill(-(pgid as i32), signal);
    }
}

#[cfg(unix)]
pub(crate) const SIGTERM: i32 = libc::SIGTERM;
#[cfg(unix)]
pub(crate) const SIGKILL: i32 = libc::SIGKILL;
