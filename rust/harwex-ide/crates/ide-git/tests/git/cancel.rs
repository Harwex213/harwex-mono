//! Timeouts and Cancel of git CLI runs. A fake `git` (a shell script in a temp dir) stands in
//! for a git that hangs, with a child that ignores SIGTERM: if that child survives, the
//! process group was not killed.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::common::TestRepo;
use ide_git::{CancelScope, Error, Repo};

/// Writes a fake git that starts a TERM-ignoring child, records both pids and waits forever.
fn hanging_git(dir: &Path) -> PathBuf {
    let script = dir.join("fake-git");
    let body = format!(
        "#!/bin/sh\necho $$ > '{d}/git.pid'\nsh -c 'trap \"\" TERM; echo $$ > \"{d}/child.pid\"; while :; do sleep 1; done' &\nwait\n",
        d = dir.display()
    );
    std::fs::write(&script, body).unwrap();
    make_executable(&script);
    script
}

fn make_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

fn read_pid(path: &Path) -> i32 {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(pid) = std::fs::read_to_string(path).ok().and_then(|s| s.trim().parse().ok()) {
            return pid;
        }
        assert!(Instant::now() < deadline, "{} was never written", path.display());
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn alive(pid: i32) -> bool {
    std::process::Command::new("kill").args(["-0", &pid.to_string()]).stderr(std::process::Stdio::null()).status().is_ok_and(|s| s.success())
}

fn assert_dies(pid: i32, what: &str) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while alive(pid) {
        if Instant::now() > deadline {
            // Do not leave it behind for the next test run.
            let _ = std::process::Command::new("kill").args(["-9", &pid.to_string()]).status();
            panic!("{what} (pid {pid}) survived");
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn file_repo(t: &TestRepo) -> PathBuf {
    t.write("a.txt", "one\n");
    t.commit_all("init");
    t.path().join("a.txt")
}

#[test]
fn hanging_git_times_out_and_its_group_dies() {
    let t = TestRepo::new();
    let file = file_repo(&t);
    let fake_dir = tempfile::tempdir().unwrap();
    let repo = Repo::discover(t.path()).unwrap().with_git_binary(hanging_git(fake_dir.path())).with_timeout(Duration::from_millis(700));
    let started = Instant::now();
    let err = repo.blame_text(&file, "one\n").unwrap_err();
    assert!(matches!(err, Error::Timeout { .. }), "{err}");
    let text = err.to_string();
    assert!(text.contains("git blame") && text.contains("did not finish"), "{text}");
    // 0.7 s limit + 2 s SIGTERM grace for the child that ignores TERM + slack.
    assert!(started.elapsed() < Duration::from_secs(5), "took {:?}", started.elapsed());
    assert_dies(read_pid(&fake_dir.path().join("git.pid")), "fake git");
    assert_dies(read_pid(&fake_dir.path().join("child.pid")), "child of the fake git");
}

#[test]
fn cancel_kills_the_whole_process_group() {
    let t = TestRepo::new();
    let file = file_repo(&t);
    let fake_dir = tempfile::tempdir().unwrap();
    let repo = Repo::discover(t.path()).unwrap().with_git_binary(hanging_git(fake_dir.path()));
    let flag = Arc::new(AtomicBool::new(false));
    let worker = {
        let flag = flag.clone();
        std::thread::spawn(move || {
            let _scope = CancelScope::enter(flag);
            repo.blame_text(&file, "one\n")
        })
    };
    let child = read_pid(&fake_dir.path().join("child.pid"));
    let started = Instant::now();
    flag.store(true, Ordering::SeqCst);
    let err = worker.join().unwrap().unwrap_err();
    assert!(err.is_cancelled(), "{err}");
    assert!(err.to_string().contains(ide_git::CANCELLED), "{err}");
    assert!(started.elapsed() < Duration::from_secs(5), "cancel took {:?}", started.elapsed());
    assert_dies(read_pid(&fake_dir.path().join("git.pid")), "fake git");
    assert_dies(child, "child of the fake git");
}

#[test]
fn a_set_flag_starts_no_command() {
    let t = TestRepo::new();
    let file = file_repo(&t);
    let _scope = CancelScope::enter(Arc::new(AtomicBool::new(true)));
    assert!(t.repo.stage(&[file]).unwrap_err().is_cancelled());
}

#[test]
fn cancelled_add_leaves_no_index_lock() {
    let t = TestRepo::new();
    t.write(".gitattributes", "*.slow filter=slow\n");
    t.commit_all("attributes");
    // The clean filter hangs while `git add` holds `index.lock`, like git-lfs under a stuck
    // syspolicyd. It also ignores SIGTERM, so only the group SIGKILL ends it.
    let marker = t.path().join("filter-started");
    t.git(&["config", "filter.slow.clean", &format!("sh -c 'trap \"\" TERM; touch \"{}\"; while :; do sleep 1; done'", marker.display())]);
    t.write("big.slow", "data\n");
    let repo = t.repo.clone();
    let flag = Arc::new(AtomicBool::new(false));
    let path = t.path().join("big.slow");
    let worker = {
        let flag = flag.clone();
        std::thread::spawn(move || {
            let _scope = CancelScope::enter(flag);
            repo.stage(&[path])
        })
    };
    let deadline = Instant::now() + Duration::from_secs(10);
    while !marker.exists() {
        assert!(Instant::now() < deadline, "the clean filter never started");
        std::thread::sleep(Duration::from_millis(20));
    }
    let lock = t.path().join(".git/index.lock");
    assert!(lock.exists(), "git add holds the index lock while the filter runs");
    flag.store(true, Ordering::SeqCst);
    assert!(worker.join().unwrap().unwrap_err().is_cancelled());
    assert!(!lock.exists(), "index.lock was left behind");
    // The repository is usable: a normal add works right away.
    t.git(&["config", "--unset", "filter.slow.clean"]);
    t.repo.stage(&[t.path().join("big.slow")]).unwrap();
}
