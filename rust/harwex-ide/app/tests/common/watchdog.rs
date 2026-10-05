//! The frame watchdog. A wait budget cannot end a frame that never returns: an egui context
//! that locks itself inside a frame blocks the test thread for good, and the run hangs with no
//! output. A thread per `Ide` watches the frame in progress. When one frame takes longer than
//! the frame budget, it prints the test, the frame and the labelled jobs to stderr (past the
//! test harness's output capture), samples the process on macOS and ends the process. The
//! failed exit then names the test binary under `cargo test`, and the test under nextest.

use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// How long one frame (or one snapshot render) may take. A cold frame (font atlas, first wgpu
/// pipeline) takes about a second; `HARWEX_TEST_FRAME_SECS` changes the budget for a run.
pub const FRAME_BUDGET: Duration = Duration::from_secs(30);
/// Exit code of a process the watchdog ended.
pub const EXIT_CODE: i32 = 124;

/// A duration in whole or fractional seconds from an env variable.
pub fn secs_from_env(name: &str) -> Option<Duration> {
    let v: f64 = std::env::var(name).ok()?.trim().parse().ok()?;
    (v > 0.0).then(|| Duration::from_secs_f64(v))
}

/// The running test's name. libtest names the test thread after the test. A test that runs on
/// the main thread (one test per process) gets the name from the filter argument.
pub fn test_name() -> String {
    match std::thread::current().name() {
        Some(name) if name != "main" => name.to_string(),
        _ => std::env::args().skip(1).find(|a| !a.starts_with('-')).unwrap_or_else(|| "<unknown test>".into()),
    }
}

#[derive(Default)]
struct Watch {
    /// Milliseconds since `epoch` when the current frame began, plus one; 0 when no frame runs.
    started: AtomicU64,
    frames: AtomicU64,
    /// What the current frame is (`frame`, `snapshot "x"`) and the labelled jobs before it.
    what: Mutex<(String, Vec<String>)>,
    stop: AtomicBool,
}

pub struct Watchdog {
    watch: Arc<Watch>,
    epoch: Instant,
}

impl Watchdog {
    pub fn start() -> Watchdog {
        let watch = Arc::new(Watch::default());
        let epoch = Instant::now();
        let budget = secs_from_env("HARWEX_TEST_FRAME_SECS").unwrap_or(FRAME_BUDGET);
        let test = test_name();
        let w = watch.clone();
        std::thread::Builder::new()
            .name(format!("frame watchdog: {test}"))
            .spawn(move || watch_loop(&w, epoch, budget, &test))
            .expect("start the frame watchdog");
        Watchdog { watch, epoch }
    }

    /// Marks the start of a frame. The frame ends when the guard drops, also on a panic.
    pub fn begin(&self, what: &str, jobs: Vec<String>) -> FrameGuard<'_> {
        if let Ok(mut w) = self.watch.what.lock() {
            w.0.clear();
            w.0.push_str(what);
            w.1 = jobs;
        }
        self.watch.frames.fetch_add(1, Ordering::Relaxed);
        self.watch.started.store(self.epoch.elapsed().as_millis() as u64 + 1, Ordering::SeqCst);
        FrameGuard(self)
    }
}

pub struct FrameGuard<'a>(&'a Watchdog);

impl Drop for FrameGuard<'_> {
    fn drop(&mut self) {
        self.0.watch.started.store(0, Ordering::SeqCst);
    }
}

impl Drop for Watchdog {
    fn drop(&mut self) {
        self.watch.stop.store(true, Ordering::SeqCst);
    }
}

fn watch_loop(w: &Watch, epoch: Instant, budget: Duration, test: &str) {
    let tick = Duration::from_millis(100).min(budget / 4);
    while !w.stop.load(Ordering::SeqCst) {
        std::thread::sleep(tick);
        let started = w.started.load(Ordering::SeqCst);
        if started == 0 {
            continue;
        }
        let running = epoch.elapsed().saturating_sub(Duration::from_millis(started - 1));
        if running < budget {
            continue;
        }
        let (what, jobs) = w.what.lock().map(|g| g.clone()).unwrap_or_default();
        let frame = w.frames.load(Ordering::Relaxed);
        let sample = sample_process(test);
        // `eprintln!` would go into the test's captured output, which nobody prints when the
        // process exits.
        let _ = writeln!(
            std::io::stderr(),
            "\nfrozen frame: test `{test}`: {what} #{frame} has not returned for {:.1} s (frame budget {:.0} s); running jobs before it {jobs:?}{sample}\nending the test process (exit {EXIT_CODE})",
            running.as_secs_f64(),
            budget.as_secs_f64(),
        );
        std::process::exit(EXIT_CODE);
    }
}

/// `sample` of this process into `$TMPDIR`, so the stuck stack is not lost with the process.
fn sample_process(test: &str) -> String {
    if !cfg!(target_os = "macos") || !std::path::Path::new("/usr/bin/sample").exists() {
        return String::new();
    }
    let safe: String = test.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect();
    let out = std::env::temp_dir().join(format!("harwex-ide-frozen-{safe}-{}.txt", std::process::id()));
    let child = std::process::Command::new("/usr/bin/sample")
        .arg(std::process::id().to_string())
        .arg("1")
        .arg("-file")
        .arg(&out)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
    let Ok(mut child) = child else { return String::new() };
    // Symbolication takes a few seconds; the process must still end soon.
    let deadline = Instant::now() + Duration::from_secs(10);
    let ok = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break false;
            }
        }
    };
    if ok { format!("; stacks: {}", out.display()) } else { String::new() }
}
