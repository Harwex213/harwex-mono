//! Status and log budgets on a generated large repository: thousands of files, about 1600
//! commits with merges and side branches, and a dirty worktree. `git fast-import` builds the
//! history in well under a second. `-- --nocapture` prints the numbers.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::common::TestRepo;
use ide_git::LogFilter;

const DIRS: usize = 80;
const FILES_PER_DIR: usize = 50;
const MAIN_COMMITS: usize = 1200;
/// Every this many main commits, a side branch with `SIDE_COMMITS` commits is merged.
const MERGE_EVERY: usize = 40;
const SIDE_COMMITS: usize = 8;

fn file(i: usize) -> String {
    format!("src/dir{}/file{}.ts", i % DIRS, i / DIRS)
}

fn content(i: usize, version: usize) -> String {
    (0..20).map(|l| format!("export const v{i}_{l} = {version};\n")).collect()
}

/// A fast-import stream for the whole history. Marks: `:n` is the n-th commit.
fn history() -> (Vec<u8>, usize) {
    let files = DIRS * FILES_PER_DIR;
    let mut out = Vec::new();
    let mut mark = 0;
    let mut clock = 1_700_000_000u64;
    let mut commit = |out: &mut Vec<u8>, branch: &str, from: Option<usize>, merge: Option<usize>, msg: &str, changes: &[(String, String)]| {
        mark += 1;
        clock += 60;
        let who = format!("Test User <test@example.com> {clock} +0000");
        write!(out, "commit refs/heads/{branch}\nmark :{mark}\nauthor {who}\ncommitter {who}\ndata {}\n{msg}\n", msg.len()).unwrap();
        if let Some(from) = from {
            writeln!(out, "from :{from}").unwrap();
        }
        if let Some(merge) = merge {
            writeln!(out, "merge :{merge}").unwrap();
        }
        for (path, text) in changes {
            write!(out, "M 100644 inline {path}\ndata {}\n{text}\n", text.len()).unwrap();
        }
        mark
    };

    let initial: Vec<(String, String)> = (0..files).map(|i| (file(i), content(i, 0))).collect();
    let mut main = commit(&mut out, "main", None, None, "Initial import", &initial);
    let mut side_branches = 0;
    for n in 1..=MAIN_COMMITS {
        let changes: Vec<(String, String)> = [n * 7 % files, n * 13 % files].iter().map(|&i| (file(i), content(i, n))).collect();
        if n % MERGE_EVERY == 0 {
            side_branches += 1;
            let branch = format!("feature/side-{side_branches}");
            let mut tip = main;
            for s in 0..SIDE_COMMITS {
                let i = (n * 31 + s * 17) % files;
                tip = commit(&mut out, &branch, Some(tip), None, &format!("Side {side_branches} step {s}"), &[(file(i), content(i, n * 100 + s))]);
            }
            main = commit(&mut out, "main", Some(main), Some(tip), &format!("Merge branch '{branch}'"), &changes);
        } else {
            main = commit(&mut out, "main", Some(main), None, &format!("Change {n}"), &changes);
        }
    }
    (out, mark)
}

fn generate() -> (TestRepo, usize) {
    let repo = TestRepo::new();
    let (stream, commits) = history();
    let mut child = Command::new("git")
        .args(["fast-import", "--quiet"])
        .current_dir(repo.path())
        .stdin(Stdio::piped())
        .spawn()
        .expect("git fast-import runs");
    child.stdin.take().unwrap().write_all(&stream).unwrap();
    assert!(child.wait().unwrap().success(), "fast-import failed");
    repo.git(&["reset", "-q", "--hard", "main"]);

    // A dirty worktree: modified, deleted and untracked files spread over the tree.
    for i in (0..DIRS * FILES_PER_DIR).step_by(80) {
        repo.write(&file(i), "changed\n");
    }
    for i in (5..DIRS * FILES_PER_DIR).step_by(400) {
        std::fs::remove_file(repo.path().join(file(i))).unwrap();
    }
    for i in 0..100 {
        repo.write(&format!("src/dir{}/new{i}.ts", i % DIRS), "new\n");
    }
    (repo, commits)
}

fn timed<T>(f: impl FnOnce() -> T) -> (T, Duration) {
    let t = Instant::now();
    let out = f();
    (out, t.elapsed())
}

#[test]
fn status_and_log_budgets_on_generated_large_repo() {
    let ((repo, commits), generated) = timed(generate);
    let git = &repo.repo;

    let (status, cold_status) = timed(|| git.status().unwrap());
    // 50 modified + 10 deleted + 100 untracked.
    assert_eq!(status.len(), 160, "{status:?}");
    // The fastest of three: status runs the git CLI, and a process start under the load of a
    // full parallel test run varies by 100 ms and more.
    let mut warm_status = Duration::MAX;
    for _ in 0..3 {
        let (st, t) = timed(|| git.status().unwrap());
        assert_eq!(st.len(), 160);
        warm_status = warm_status.min(t);
    }

    let (first, first_page) = timed(|| git.log(&LogFilter::default(), 0, 200).unwrap());
    assert_eq!(first.len(), 200);
    let (rows, graph_time) = timed(|| git.graph(&first));
    assert_eq!(rows.len(), 200);
    let width = rows.iter().map(|r| r.width).max().unwrap_or(0);
    assert!(width >= 2, "merges must show a second lane, width {width}");
    let (deep, deep_page) = timed(|| git.log(&LogFilter::default(), 1000, 200).unwrap());
    assert_eq!(deep.len(), 200);
    let (branches, branches_time) = timed(|| git.branches().unwrap());
    assert_eq!(branches.local.len(), 1 + MAIN_COMMITS / MERGE_EVERY);
    let filter = LogFilter { paths: vec![PathBuf::from(file(7))], ..Default::default() };
    let (by_path, by_path_time) = timed(|| git.log(&filter, 0, 50).unwrap());
    assert!(!by_path.is_empty());

    // The refresh after a HEAD change (the app's incremental status): the paths that changed
    // between HEAD~20 and HEAD plus the 160 rows, through `status_of`.
    let since = git.stamp(None).unwrap().head_oid();
    let back = Command::new("git").args(["rev-parse", "HEAD~20"]).current_dir(repo.path()).output().unwrap();
    let back = ide_git::Oid::from_str(String::from_utf8_lossy(&back.stdout).trim()).unwrap();
    assert!(since.is_some());
    let ((changed, incremental), incremental_time) = timed(|| {
        let mut set = git.changed_paths(Some(back), 400).unwrap().expect("under the limit");
        let changed = set.len();
        set.extend(status.iter().map(|c| c.path.clone()));
        (changed, git.status_of(&set).unwrap())
    });
    assert!(changed > 0);
    assert_eq!(incremental.len(), 160, "{incremental:?}");

    eprintln!(
        "{} files, {commits} commits: generate {generated:?}, status cold {cold_status:?}, warm min {warm_status:?}, \
         log 200 {first_page:?}, graph {graph_time:?} (width {width}), log at skip 1000 {deep_page:?}, \
         branches {branches_time:?}, log by path ({}) {by_path_time:?}, incremental status \
         ({changed} changed paths + 160 rows) {incremental_time:?}",
        DIRS * FILES_PER_DIR,
        by_path.len()
    );
    assert!(warm_status < Duration::from_millis(300), "warm status took {warm_status:?}");
    assert!(first_page < Duration::from_millis(100), "first log page took {first_page:?}");
    assert!(deep_page < Duration::from_millis(100), "log page at skip 1000 took {deep_page:?}");
    assert!(graph_time < Duration::from_millis(50), "graph took {graph_time:?}");
    assert!(branches_time < Duration::from_millis(200), "branches took {branches_time:?}");
    assert!(incremental_time < Duration::from_millis(500), "incremental status took {incremental_time:?}");
}

/// The refresh pieces on a real repository, read-only (`GIT_OPTIONAL_LOCKS=0` reads and
/// libgit2): `HARWEX_GIT_BENCH_REPO=<repo> cargo test --release -p ide-git --test git
/// large_repo::bench_external_repo -- --ignored --nocapture`. `HARWEX_GIT_BENCH_BACK` sets
/// how many commits back the "old HEAD" is (default 1).
#[test]
#[ignore]
fn bench_external_repo() {
    let Some(dir) = std::env::var_os("HARWEX_GIT_BENCH_REPO") else {
        eprintln!("HARWEX_GIT_BENCH_REPO is not set: nothing to measure");
        return;
    };
    let back: usize = std::env::var("HARWEX_GIT_BENCH_BACK").ok().and_then(|v| v.parse().ok()).unwrap_or(1);
    let git = ide_git::Repo::discover(std::path::Path::new(&dir)).unwrap();
    let (stamp, stamp_cold) = timed(|| git.stamp(None).unwrap());
    let (_, stamp_warm) = timed(|| git.stamp(Some(&stamp)).unwrap());
    let out = Command::new("git").args(["rev-parse", &format!("HEAD~{back}")]).env("GIT_OPTIONAL_LOCKS", "0").current_dir(git.workdir()).output().unwrap();
    let old = ide_git::Oid::from_str(String::from_utf8_lossy(&out.stdout).trim()).unwrap();
    let (rows, full) = timed(|| git.status().unwrap());
    let (changed, changed_time) = timed(|| git.changed_paths(Some(old), 400).unwrap());
    let Some(mut set) = changed else {
        eprintln!("stamp cold {stamp_cold:?}, warm {stamp_warm:?}; full status {full:?} ({} rows); over 400 changed paths since HEAD~{back}", rows.len());
        return;
    };
    let n = set.len();
    set.extend(rows.iter().map(|c| c.path.clone()));
    let (_, status_of) = timed(|| git.status_of(&set).unwrap());
    eprintln!(
        "stamp cold {stamp_cold:?}, warm {stamp_warm:?}; full status {full:?} ({} rows); changed_paths since HEAD~{back} {changed_time:?} ({n} paths); \
         status_of those + rows {status_of:?}",
        rows.len()
    );
}
