//! The test harness's own time limits: a wait that runs out of budget panics with the pending
//! jobs, a frame that never returns ends the process with a message, and a fixture lock held by
//! another run panics instead of waiting forever.

use crate::common::*;

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const SUITE: &str = "time_limits";
/// Set in the child process of `frozen_frame_ends_the_process`; the child test does nothing
/// without it.
const CHILD_ENV: &str = "HARWEX_TIME_LIMITS_CHILD";

fn panic_text(e: Box<dyn std::any::Any + Send>) -> String {
    e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default()
}

/// A job that never finishes makes `settle` panic within its budget, naming the test and the job.
#[test]
fn settle_budget_names_the_hung_job() {
    let mut ide = Ide::with_options(SUITE, test_options(None), None);
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    ide.state().jobs.spawn("Hung job", move || rx.recv().ok(), |_, _| {});
    ide.set_wait_budget(Duration::from_secs(1));
    let start = Instant::now();
    let err = catch_unwind(AssertUnwindSafe(|| ide.settle())).expect_err("settle must give up");
    assert!(start.elapsed() < Duration::from_secs(10), "settle gave up after {:?}", start.elapsed());
    let text = panic_text(err);
    assert!(text.contains("settle_budget_names_the_hung_job"), "{text}");
    assert!(text.contains("settle ran out of budget"), "{text}");
    assert!(text.contains("\"Hung job\""), "{text}");

    let err = catch_unwind(AssertUnwindSafe(|| ide.wait_for("a flag that never flips", |_| false))).expect_err("wait_for must give up");
    let text = panic_text(err);
    assert!(text.contains("waiting for: a flag that never flips"), "{text}");
    drop(tx);
    ide.set_wait_budget(WAIT_BUDGET);
    ide.settle();
}

/// A fixture whose lock another run holds panics after the lock budget and names the holder.
#[test]
fn fixture_lock_has_a_deadline() {
    let held = Fixture::new(SUITE, "locked");
    let start = Instant::now();
    let err = catch_unwind(|| Fixture::new_within(SUITE, "locked", Duration::from_millis(300))).err().expect("the second lock must give up");
    assert!(start.elapsed() < Duration::from_secs(5), "gave up after {:?}", start.elapsed());
    let text = panic_text(err);
    assert!(text.contains("fixture time_limits/locked locked by another run for 0 s"), "{text}");
    assert!(text.contains(&format!("held by pid {}", std::process::id())), "{text}");
    drop(held);
    drop(Fixture::new_within(SUITE, "locked", Duration::from_secs(5)));
}

/// The child of `frozen_frame_ends_the_process`: a job callback that never returns blocks the
/// frame, the way an egui context that locks itself does.
#[test]
fn frozen_frame_child() {
    if std::env::var_os(CHILD_ENV).is_none() {
        return;
    }
    let mut ide = Ide::with_options(SUITE, test_options(None), None);
    ide.state().jobs.spawn("Freezer", || (), |_, ()| loop {
        std::thread::sleep(Duration::from_secs(3600));
    });
    ide.settle();
    unreachable!("the frame never returns");
}

/// A frozen frame ends the test process within the frame budget, with a message that names the
/// test and the frame. The run then fails instead of hanging.
#[test]
fn frozen_frame_ends_the_process() {
    let start = Instant::now();
    let out = Command::new(std::env::current_exe().expect("test binary"))
        .args(["--exact", "time_limits::frozen_frame_child", "--nocapture", "--test-threads=1"])
        .env(CHILD_ENV, "1")
        .env("HARWEX_TEST_FRAME_SECS", "2")
        .stdin(Stdio::null())
        .output()
        .expect("run the child test");
    let took = start.elapsed();
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(124), "the watchdog ends the child: {stderr}");
    assert!(took < Duration::from_secs(60), "took {took:?}");
    assert!(stderr.contains("frozen frame: test `time_limits::frozen_frame_child`: frame #"), "{stderr}");
    assert!(stderr.contains("has not returned for"), "{stderr}");
    eprintln!("frozen frame ended after {took:?}");
}
