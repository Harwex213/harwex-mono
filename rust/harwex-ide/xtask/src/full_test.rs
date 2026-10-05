//! `cargo xtask test`: the full test suite, one run at a time.
//!
//! All agents of one tree share one `target/`. Two full runs at once fight over cargo's build
//! lock and the fixture locks, and double the load on `syspolicyd` (macOS checks every new
//! test executable). So a full run takes `<target>/full-test.lock` first. The lock is a `flock`
//! (`File::try_lock`): the kernel drops it when the holding process ends, so the lock of a dead
//! run is free at once and the next run takes it over. The file holds the owner (pid, start
//! time, agent or cwd) for the waiting message. It is never deleted: a waiter may hold an open
//! handle to it, and a new file under the same name would give two holders.
//!
//! A run narrowed to a package, a test binary or a filter is "suite-only" and takes no lock.

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use std::{env, thread};

pub const LOCK_FILE: &str = "full-test.lock";

/// Flags that narrow a run to a part of the workspace. Any of them makes the run suite-only.
const NARROWING: &[&str] = &[
    "-p", "--package", "--test", "--tests", "--lib", "--bin", "--bins", "--example", "--examples", "--bench",
    "--benches", "--doc", "-E", "--filter-expr", "--filterset", "--partition", "--run-ignored",
];

/// Flags (of nextest and cargo test) that take a value as the next argument. The value is not a
/// test filter.
const WITH_VALUE: &[&str] = &[
    "-p", "--package", "--test", "--bin", "--example", "--bench", "-E", "--filter-expr", "--filterset",
    "--partition", "--run-ignored", "--exclude", "-F", "--features", "--target", "--target-dir", "-j", "--jobs",
    "--test-threads", "--retries", "-P", "--profile", "--success-output", "--failure-output", "--status-level",
    "--final-status-level", "--color", "--message-format", "--manifest-path", "--config", "-Z",
];

/// Whether `args` run the whole workspace (and so must take the lock).
pub fn is_full_run(args: &[String]) -> bool {
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        if arg == "--" {
            // Arguments for the test binaries: filters and libtest flags. `--ignored`,
            // `--include-ignored`, `--nocapture` and friends keep the run full; a filter does not.
            return args.all(|a| a.starts_with('-'));
        }
        let name = arg.split('=').next().unwrap_or(arg);
        if NARROWING.contains(&name) || (arg.starts_with("-p") && arg.len() > 2 && !arg.starts_with("--")) {
            return false;
        }
        if !arg.starts_with('-') {
            return false; // a positional test filter
        }
        if WITH_VALUE.contains(&name) && !arg.contains('=') {
            args.next();
        }
    }
    true
}

/// Who holds the lock. Written into the lock file, shown to the runs that wait.
#[derive(Clone, Debug, PartialEq)]
pub struct Owner {
    pub pid: u32,
    /// Local start time, `HH:MM`.
    pub started: String,
    /// `HARWEX_AGENT` when set, plus the cwd of the run.
    pub by: String,
}

impl Owner {
    pub fn current() -> Owner {
        let cwd = env::current_dir().map(|d| d.display().to_string()).unwrap_or_else(|_| "?".into());
        let by = match env::var("HARWEX_AGENT") {
            Ok(agent) if !agent.is_empty() => format!("{agent} in {cwd}"),
            _ => cwd,
        };
        Owner { pid: std::process::id(), started: local_hh_mm(), by }
    }

    fn encode(&self) -> String {
        format!("pid={}\nstarted={}\nby={}\n", self.pid, self.started, self.by)
    }

    fn decode(text: &str) -> Option<Owner> {
        let field = |key: &str| {
            text.lines().find_map(|l| l.strip_prefix(key).and_then(|r| r.strip_prefix('='))).map(str::to_string)
        };
        Some(Owner { pid: field("pid")?.parse().ok()?, started: field("started")?, by: field("by")? })
    }

    pub fn describe(&self) -> String {
        format!("pid {}, started {} by {}", self.pid, self.started, self.by)
    }
}

fn local_hh_mm() -> String {
    let out = Command::new("date").arg("+%H:%M").stdin(Stdio::null()).output();
    match out {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).trim().to_string(),
        _ => {
            let secs = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
            format!("{:02}:{:02} UTC", secs / 3600 % 24, secs / 60 % 60)
        }
    }
}

/// The held lock. Dropping it empties the owner info and releases the `flock`.
#[derive(Debug)]
pub struct Lock {
    file: File,
}

impl Drop for Lock {
    fn drop(&mut self) {
        let _ = self.file.set_len(0);
        let _ = self.file.unlock();
    }
}

pub struct Wait {
    pub wait: bool,
    /// How often a waiting run tries the lock again.
    pub poll: Duration,
    /// How often a waiting run says it still waits.
    pub report: Duration,
}

impl Wait {
    pub fn new(wait: bool) -> Wait {
        Wait { wait, poll: Duration::from_millis(500), report: Duration::from_secs(60) }
    }
}

/// Takes the full-run lock at `path`. With `wait.wait` false, a held lock is an error that
/// names the owner; otherwise the call blocks until the owner ends. `out` gets the messages.
pub fn acquire(path: &Path, me: &Owner, wait: &Wait, out: &mut dyn FnMut(&str)) -> Result<Lock, String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    }
    // No truncate: the file holds the info of the run that may own the lock right now.
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(|e| format!("open {}: {e}", path.display()))?;
    let start = Instant::now();
    let mut last_report = Instant::now();
    let mut announced = false;
    let mut seen: Option<Owner> = None;
    loop {
        match file.try_lock() {
            Ok(()) => break,
            Err(fs::TryLockError::WouldBlock) => {}
            Err(fs::TryLockError::Error(e)) => return Err(format!("lock {}: {e}", path.display())),
        }
        let owner = fs::read_to_string(path).ok().and_then(|t| Owner::decode(&t));
        let who = owner.as_ref().map_or_else(|| "owner unknown".to_string(), Owner::describe);
        if !wait.wait {
            return Err(format!(
                "another full run ({who}) is in progress; run again when it ends, or pass --wait to wait for it"
            ));
        }
        if !announced || owner != seen {
            out(&format!("another full run ({who}) is in progress; waiting for it (--no-wait fails fast instead)"));
            announced = true;
            seen = owner;
            last_report = Instant::now();
        } else if last_report.elapsed() >= wait.report {
            out(&format!("still waiting for the full run ({who}), {} s so far", start.elapsed().as_secs()));
            last_report = Instant::now();
        }
        thread::sleep(wait.poll);
    }
    let mut old = String::new();
    let _ = file.read_to_string(&mut old);
    if let Some(stale) = Owner::decode(&old) {
        out(&format!("taking over the stale lock of a full run that is gone ({})", stale.describe()));
    }
    let write = file.set_len(0).and_then(|_| file.seek(SeekFrom::Start(0))).and_then(|_| {
        file.write_all(me.encode().as_bytes())?;
        file.flush()
    });
    write.map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(Lock { file })
}

/// Splits our own flags (`--wait`, `--no-wait`) from the arguments for the test runner.
pub fn split_flags(args: Vec<String>) -> (bool, Vec<String>) {
    let mut wait = true;
    let mut rest = Vec::new();
    let mut passthrough = false;
    for arg in args {
        match arg.as_str() {
            "--" => {
                passthrough = true;
                rest.push(arg);
            }
            "--wait" if !passthrough => wait = true,
            "--no-wait" if !passthrough => wait = false,
            _ => rest.push(arg),
        }
    }
    (wait, rest)
}

/// Takes the lock when `args` are a full run. A suite-only run gets `None` and never waits.
pub fn lock_for(args: &[String], lock: &Path, wait: bool) -> Result<Option<Lock>, String> {
    if !is_full_run(args) {
        return Ok(None);
    }
    let mut out = |line: &str| println!("{line}");
    acquire(lock, &Owner::current(), &Wait::new(wait), &mut out).map(Some)
}

/// `cargo xtask test [--no-wait] [args]`.
pub fn run(root: &Path, target: &Path, args: Vec<String>) -> Result<(), String> {
    let (wait, args) = split_flags(args);
    let full = is_full_run(&args);
    let _lock = lock_for(&args, &target.join(LOCK_FILE), wait)?;
    let cargo = env::var_os("CARGO").map_or_else(|| PathBuf::from("cargo"), PathBuf::from);
    if full {
        build(&cargo, root)?;
    }
    let nextest = crate::test_tools::nextest_bin(&target.join("tools"));
    if nextest.is_file() {
        let mut command = Command::new(&nextest);
        command.args(["nextest", "run"]);
        if full && !args.iter().any(|a| a == "--workspace") {
            command.arg("--workspace");
        }
        status(command.args(&args).current_dir(root), "cargo nextest run")?;
        if full {
            // nextest runs no doc tests.
            status(Command::new(&cargo).args(["test", "--workspace", "--doc"]).current_dir(root), "cargo test --doc")?;
        }
    } else {
        println!("note: no pinned nextest in {} (cargo xtask test-tools); running cargo test", nextest.display());
        let mut command = Command::new(&cargo);
        command.arg("test");
        if full && !args.iter().any(|a| a == "--workspace") {
            command.arg("--workspace");
        }
        status(command.args(&args).current_dir(root), "cargo test")?;
    }
    Ok(())
}

fn status(command: &mut Command, name: &str) -> Result<(), String> {
    let status = command.status().map_err(|e| format!("cannot start {name}: {e}"))?;
    if status.success() { Ok(()) } else { Err(format!("{name}: {status}")) }
}

/// Builds every test target first, so a broken build is reported as one, with the files that
/// break it. The test run that follows finds everything built.
fn build(cargo: &Path, root: &Path) -> Result<(), String> {
    println!("build cargo test --workspace --no-run");
    let mut child = Command::new(cargo)
        .args(["test", "--workspace", "--no-run", "--message-format", "short"])
        .current_dir(root)
        .stdin(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("cannot start cargo: {e}"))?;
    let mut lines = Vec::new();
    for line in BufReader::new(child.stderr.take().expect("piped stderr")).lines() {
        let line = line.unwrap_or_default();
        eprintln!("{line}");
        lines.push(line);
    }
    let status = child.wait().map_err(|e| format!("cargo: {e}"))?;
    if status.success() {
        return Ok(());
    }
    Err(broken_build_report(&lines))
}

/// The summary of a failed build: the crates and files with errors, and what to do about it.
pub fn broken_build_report(lines: &[String]) -> String {
    let mut crates: Vec<&str> = Vec::new();
    let mut files: Vec<&str> = Vec::new();
    for line in lines {
        if let Some(rest) = line.strip_prefix("error: could not compile `") {
            if let Some(name) = rest.split('`').next() {
                if !crates.contains(&name) {
                    crates.push(name);
                }
            }
        }
        // Short format: `path:line:col: error[E0425]: message`.
        if let Some((path, rest)) = line.split_once(':') {
            let is_error = rest.split(": ").nth(1).is_some_and(|kind| kind.starts_with("error"));
            if is_error && !path.contains(' ') && !files.contains(&path) {
                files.push(path);
            }
        }
    }
    let mut report = String::from("the build is broken");
    if !crates.is_empty() {
        report.push_str(&format!(" in {}", crates.join(", ")));
    }
    if !files.is_empty() {
        report.push_str(&format!(" ({})", files.join(", ")));
    }
    report.push_str(
        ". If you did not edit these files, another agent's edit is in progress there: wait and run again, \
         do not fix foreign code.",
    );
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    fn temp_lock(name: &str) -> PathBuf {
        let dir = env::temp_dir().join(format!("xtask-full-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join(LOCK_FILE)
    }

    fn owner(by: &str) -> Owner {
        Owner { pid: std::process::id(), started: "12:34".into(), by: by.into() }
    }

    fn fast(wait: bool) -> Wait {
        Wait { wait, poll: Duration::from_millis(20), report: Duration::from_secs(60) }
    }

    #[test]
    fn full_and_suite_only_runs() {
        for full in [&[][..], &["--workspace"], &["--workspace", "--no-fail-fast"], &["-j", "4"], &["--retries=2"],
            &["--success-output", "immediate"], &["--exclude", "xtask"], &["--", "--include-ignored"]]
        {
            assert!(is_full_run(&args(full)), "{full:?} is a full run");
        }
        for suite in [&["-p", "xtask"][..], &["-pxtask"], &["--package=ide-git"], &["--test", "app"], &["--lib"],
            &["git_history::"], &["--workspace", "-E", "test(/x/)"], &["--", "shell::tabs"], &["--doc"]]
        {
            assert!(!is_full_run(&args(suite)), "{suite:?} is suite-only");
        }
    }

    #[test]
    fn wait_flags_are_ours_and_the_rest_passes_through() {
        assert_eq!(split_flags(args(&["--no-wait", "-p", "app"])), (false, args(&["-p", "app"])));
        assert_eq!(split_flags(args(&["--wait"])), (true, vec![]));
        assert_eq!(split_flags(args(&["--", "--no-wait"])), (true, args(&["--", "--no-wait"])));
    }

    #[test]
    fn second_run_fails_fast_with_the_owner() {
        let path = temp_lock("fail-fast");
        let mut out = |_: &str| {};
        let first = acquire(&path, &owner("agent-a in ws"), &fast(false), &mut out).unwrap();
        let err = acquire(&path, &owner("agent-b"), &fast(false), &mut out).unwrap_err();
        let pid = std::process::id();
        assert!(err.contains(&format!("another full run (pid {pid}, started 12:34 by agent-a in ws) is in progress")), "{err}");
        drop(first);
        acquire(&path, &owner("agent-b"), &fast(false), &mut out).expect("free after the first run ends");
    }

    #[test]
    fn second_run_waits_until_the_first_ends() {
        let path = temp_lock("wait");
        let mut out = |_: &str| {};
        let first = acquire(&path, &owner("agent-a"), &fast(false), &mut out).unwrap();
        let (tx, rx) = mpsc::channel();
        let waiter_path = path.clone();
        let waiter = thread::spawn(move || {
            let mut lines = Vec::new();
            let mut out = |line: &str| {
                lines.push(line.to_string());
                let _ = tx.send(line.to_string());
            };
            let lock = acquire(&waiter_path, &owner("agent-b"), &fast(true), &mut out).unwrap();
            drop(lock);
            lines
        });
        let message = rx.recv_timeout(Duration::from_secs(10)).expect("the waiter says it waits");
        assert!(message.contains("another full run (pid") && message.contains("by agent-a) is in progress; waiting"), "{message}");
        thread::sleep(Duration::from_millis(200));
        assert!(!waiter.is_finished(), "the waiter must not run while the first run holds the lock");
        drop(first);
        let lines = waiter.join().unwrap();
        assert_eq!(lines.len(), 1, "no stale takeover after a clean release: {lines:?}");
    }

    #[test]
    fn stale_lock_of_a_dead_run_is_taken_over() {
        let path = temp_lock("stale");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        // A run that was killed: its info is still there, but no process holds the flock.
        fs::write(&path, "pid=999999\nstarted=03:00\nby=gone-agent\n").unwrap();
        let mut lines = Vec::new();
        let mut out = |line: &str| lines.push(line.to_string());
        let lock = acquire(&path, &owner("agent-b"), &fast(false), &mut out).expect("a stale lock is free");
        assert!(lines.iter().any(|l| l.contains("stale lock") && l.contains("pid 999999")), "{lines:?}");
        assert_eq!(Owner::decode(&fs::read_to_string(&path).unwrap()), Some(owner("agent-b")));
        drop(lock);
        assert_eq!(fs::read_to_string(&path).unwrap(), "", "a released lock holds no owner");
    }

    #[test]
    fn suite_only_run_ignores_a_held_lock() {
        let path = temp_lock("suite");
        let mut out = |_: &str| {};
        let _first = acquire(&path, &owner("agent-a"), &fast(false), &mut out).unwrap();
        let lock = lock_for(&args(&["--test", "app", "git_history::"]), &path, false).unwrap();
        assert!(lock.is_none());
        let err = lock_for(&args(&["--workspace"]), &path, false).unwrap_err();
        assert!(err.contains("another full run"), "{err}");
    }

    #[test]
    fn broken_build_names_crate_and_files() {
        let lines = args(&[
            "   Compiling ide-git v0.1.0",
            "crates/ide-git/src/log.rs:10:5: error[E0425]: cannot find value `x` in this scope",
            "crates/ide-git/src/log.rs:12:1: error: expected item",
            "app/src/app.rs:3:9: warning: unused import: `Foo`",
            "error: could not compile `ide-git` (lib) due to 2 previous errors",
        ]);
        let report = broken_build_report(&lines);
        assert!(report.starts_with("the build is broken in ide-git (crates/ide-git/src/log.rs)."), "{report}");
        assert!(report.contains("do not fix foreign code"));
    }
}
