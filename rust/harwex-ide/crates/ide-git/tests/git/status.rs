//! Status through the git CLI: the full status, the path-limited `status_of` that the app
//! merges after its own writes, and the `GitStamp` that tells an index change from a stat
//! refresh.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::common::{p, TestRepo};
use ide_git::{CancelScope, ChangeKind, FileChange, Repo};

/// The entries of a full status under `paths`, which is what `status_of(paths)` must return.
fn full_under(t: &TestRepo, paths: &[PathBuf]) -> Vec<FileChange> {
    let rel: Vec<PathBuf> = paths.iter().map(|q| q.strip_prefix(t.repo.workdir()).unwrap_or(q).to_path_buf()).collect();
    t.repo.status().unwrap().into_iter().filter(|c| rel.iter().any(|q| c.path.starts_with(q))).collect()
}

fn renamed_repo() -> TestRepo {
    let t = TestRepo::new();
    t.write("old.txt", "rename me\nwith enough\ncontent to match\n");
    t.write("keep.txt", "k\n");
    t.write("dir/a.txt", "a\n");
    t.commit_all("init");
    t
}

#[test]
fn status_of_equals_the_full_status_for_its_paths() {
    let t = renamed_repo();
    t.write("keep.txt", "changed\n");
    t.write("dir/a.txt", "b\n");
    t.write("dir/new.txt", "n\n");
    t.write("untracked dir/with space.txt", "s\n");
    t.git(&["mv", "old.txt", "new.txt"]);
    t.git(&["add", "dir/a.txt"]);

    for paths in [
        vec![p("keep.txt")],
        vec![p("dir")],
        vec![p("new.txt"), p("old.txt")],
        vec![p("untracked dir")],
        vec![t.repo.workdir().join("dir/new.txt"), p("missing.txt")],
    ] {
        assert_eq!(t.repo.status_of(&paths).unwrap(), full_under(&t, &paths), "{paths:?}");
    }
    let rename = t.repo.status_of(&[p("new.txt"), p("old.txt")]).unwrap();
    assert_eq!(rename.len(), 1, "{rename:?}");
    assert_eq!(rename[0].staged, Some(ChangeKind::Renamed));
    assert_eq!(rename[0].old_path, Some(p("old.txt")));
    let spaced = t.repo.status_of(&[p("untracked dir")]).unwrap();
    assert_eq!(spaced[0].path, p("untracked dir/with space.txt"));
}

#[test]
fn a_staged_then_unstaged_new_file_is_untracked_again() {
    let t = renamed_repo();
    t.write("fresh.txt", "f\n");
    t.repo.stage(&[p("fresh.txt")]).unwrap();
    assert_eq!(t.repo.status_of(&[p("fresh.txt")]).unwrap()[0].staged, Some(ChangeKind::Added));
    t.repo.unstage(&[p("fresh.txt")]).unwrap();
    let after = t.repo.status_of(&[p("fresh.txt")]).unwrap();
    assert_eq!(after.len(), 1);
    assert!(after[0].is_untracked(), "{after:?}");
}

#[test]
fn a_commit_clears_only_the_committed_paths() {
    let t = renamed_repo();
    t.write("keep.txt", "changed\n");
    t.write("dir/a.txt", "b\n");
    t.repo.commit("msg", &[p("keep.txt")], false).unwrap();
    assert!(t.repo.status_of(&[p("keep.txt")]).unwrap().is_empty());
    assert_eq!(t.repo.status_of(&[p("dir/a.txt")]).unwrap(), full_under(&t, &[p("dir/a.txt")]));
}

#[test]
fn renames_show_even_when_the_config_turns_them_off() {
    let t = renamed_repo();
    t.git(&["config", "status.renames", "false"]);
    t.git(&["config", "diff.renames", "false"]);
    t.git(&["mv", "old.txt", "new.txt"]);
    let st = t.repo.status().unwrap();
    assert_eq!(st.len(), 1, "{st:?}");
    assert_eq!(st[0].kind(), ChangeKind::Renamed);
}

#[test]
fn conflicts_are_reported_once() {
    let t = TestRepo::new();
    t.write("c.txt", "base\n");
    t.commit_all("base");
    t.git(&["checkout", "-q", "-b", "other"]);
    t.write("c.txt", "other\n");
    t.commit_all("other");
    t.git(&["checkout", "-q", "main"]);
    t.write("c.txt", "main\n");
    t.commit_all("main");
    let _ = std::process::Command::new("git").current_dir(t.path()).args(["merge", "-q", "other"]).output();
    let st = t.repo.status().unwrap();
    assert_eq!(st.len(), 1, "{st:?}");
    assert_eq!(st[0].kind(), ChangeKind::Conflicted);
}

#[test]
fn status_does_not_rewrite_the_index() {
    let t = renamed_repo();
    let index = t.path().join(".git/index");
    // A stat change that git would write back into the index.
    std::thread::sleep(Duration::from_millis(1100));
    t.write("keep.txt", "k\n");
    let before = std::fs::metadata(&index).unwrap().modified().unwrap();
    t.repo.status().unwrap();
    t.repo.status_of(&[p("keep.txt")]).unwrap();
    assert_eq!(std::fs::metadata(&index).unwrap().modified().unwrap(), before);
}

#[test]
fn stamp_ignores_a_stat_refresh_and_sees_index_and_head_changes() {
    let t = renamed_repo();
    let first = t.repo.stamp(None).unwrap();
    assert_eq!(t.repo.stamp(Some(&first)).unwrap(), first);

    // A shell prompt's `git status` rewrites the index with fresh stat data only.
    std::thread::sleep(Duration::from_millis(1100));
    t.write("keep.txt", "k\n");
    t.git(&["status", "--porcelain"]);
    let refreshed = t.repo.stamp(Some(&first)).unwrap();
    assert_eq!(refreshed, first, "a stat refresh is no status change");

    t.write("keep.txt", "staged\n");
    t.git(&["add", "keep.txt"]);
    let staged = t.repo.stamp(Some(&refreshed)).unwrap();
    assert_ne!(staged, first, "a staged change");

    t.git(&["commit", "-q", "-m", "c"]);
    let committed = t.repo.stamp(Some(&staged)).unwrap();
    assert_ne!(committed, staged, "a new HEAD");

    t.git(&["checkout", "-q", "-b", "side"]);
    assert_ne!(t.repo.stamp(Some(&committed)).unwrap(), committed, "another branch");
}

/// What the app does after a HEAD or index change: `status_of` over `changed_paths` plus the
/// paths of the rows it shows, merged into those rows. It must equal a full status when only
/// git (not a plain file edit, which the watcher reports) changed the worktree.
fn assert_incremental_equals_full(t: &TestRepo, since: Option<ide_git::Oid>, old_rows: &[FileChange], what: &str) {
    let mut set = t.repo.changed_paths(since, 1000).unwrap().unwrap_or_else(|| panic!("{what}: no incremental answer"));
    for c in old_rows {
        set.push(c.path.clone());
        set.extend(c.old_path.clone());
    }
    let rows = t.repo.status_of(&set).unwrap();
    let mut merged: Vec<FileChange> = old_rows.iter().filter(|c| !set.contains(&c.path) && !c.old_path.as_ref().is_some_and(|o| set.contains(o))).cloned().collect();
    merged.extend(rows);
    merged.sort_by(|a, b| a.path.cmp(&b.path));
    merged.dedup_by(|a, b| a.path == b.path);
    assert_eq!(merged, t.repo.status().unwrap(), "{what}");
}

fn head(t: &TestRepo) -> Option<ide_git::Oid> {
    t.repo.stamp(None).unwrap().head_oid()
}

#[test]
fn changed_paths_cover_commits_resets_checkouts_and_conflicts() {
    let t = renamed_repo();
    t.write("keep.txt", "changed\n");
    t.write("fresh.txt", "fresh\n");
    t.git(&["add", "keep.txt"]);

    // A commit in a terminal: the committed rows disappear.
    let (since, rows) = (head(&t), t.repo.status().unwrap());
    t.git(&["add", "fresh.txt"]);
    t.git(&["commit", "-q", "-m", "outside"]);
    assert_incremental_equals_full(&t, since, &rows, "after an outside commit");

    // `reset --mixed HEAD~1`: fresh.txt becomes untracked again, keep.txt modified.
    let (since, rows) = (head(&t), t.repo.status().unwrap());
    t.git(&["reset", "-q", "HEAD~1"]);
    assert_incremental_equals_full(&t, since, &rows, "after reset --mixed");

    // `reset --soft`, then a checkout of a branch with other files.
    t.git(&["add", "-A"]);
    t.git(&["commit", "-q", "-m", "again"]);
    let (since, rows) = (head(&t), t.repo.status().unwrap());
    t.git(&["reset", "-q", "--soft", "HEAD~1"]);
    assert_incremental_equals_full(&t, since, &rows, "after reset --soft");
    t.git(&["commit", "-q", "-m", "again"]);
    t.git(&["checkout", "-q", "-b", "side", "HEAD~1"]);
    t.write("side.txt", "side\n");
    t.write("keep.txt", "side keep\n");
    t.git(&["add", "-A"]);
    t.git(&["commit", "-q", "-m", "side"]);
    let (since, rows) = (head(&t), t.repo.status().unwrap());
    t.git(&["checkout", "-q", "main"]);
    assert_incremental_equals_full(&t, since, &rows, "after a checkout");

    // A merge that stops on a conflict: HEAD stays, the index holds the conflict.
    let (since, rows) = (head(&t), t.repo.status().unwrap());
    let out = std::process::Command::new("git").args(["merge", "-q", "side"]).current_dir(t.path()).output().unwrap();
    assert!(!out.status.success());
    assert_incremental_equals_full(&t, since, &rows, "after a conflicting merge");
    assert!(t.repo.status().unwrap().iter().any(|c| c.staged == Some(ChangeKind::Conflicted)));

    // An outside `git add` of an untracked file.
    t.git(&["merge", "--abort"]);
    t.write("later.txt", "later\n");
    let (since, rows) = (head(&t), t.repo.status().unwrap());
    t.git(&["add", "later.txt"]);
    assert_incremental_equals_full(&t, since, &rows, "after an outside git add");
}

#[test]
fn changed_paths_give_up_above_the_limit_and_on_an_unborn_head() {
    let t = TestRepo::new();
    t.write("a.txt", "a\n");
    t.git(&["add", "a.txt"]);
    assert_eq!(t.repo.changed_paths(head(&t), 10).unwrap(), None, "unborn HEAD");
    t.git(&["commit", "-q", "-m", "a"]);
    let since = head(&t);
    for i in 0..5 {
        t.write(&format!("f{i}.txt"), "x\n");
    }
    t.git(&["add", "-A"]);
    t.git(&["commit", "-q", "-m", "five"]);
    assert_eq!(t.repo.changed_paths(since, 4).unwrap(), None, "five paths over a limit of four");
    assert_eq!(t.repo.changed_paths(since, 5).unwrap().map(|v| v.len()), Some(5));
    assert_eq!(t.repo.changed_paths(None, 5).unwrap(), None, "no HEAD then");
    assert_eq!(t.repo.changed_paths(head(&t), 5).unwrap(), Some(vec![]), "nothing changed");
}

/// A fake git that hangs, so a status can only end through its cancel flag.
fn hanging_git(dir: &std::path::Path) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let script = dir.join("fake-git");
    std::fs::write(&script, format!("#!/bin/sh\necho $$ > '{}/git.pid'\nexec sleep 60\n", dir.display())).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    script
}

#[test]
fn cancel_kills_a_running_full_status() {
    let t = renamed_repo();
    let fake = tempfile::tempdir().unwrap();
    let repo = Repo::discover(t.path()).unwrap().with_git_binary(hanging_git(fake.path()));
    let flag = Arc::new(AtomicBool::new(false));
    let worker = {
        let flag = flag.clone();
        std::thread::spawn(move || {
            let _scope = CancelScope::enter(flag);
            repo.status()
        })
    };
    let pid_file = fake.path().join("git.pid");
    let deadline = Instant::now() + Duration::from_secs(10);
    while !pid_file.exists() {
        assert!(Instant::now() < deadline, "the fake git never started");
        std::thread::sleep(Duration::from_millis(20));
    }
    let started = Instant::now();
    flag.store(true, Ordering::SeqCst);
    let err = worker.join().unwrap().unwrap_err();
    assert!(err.is_cancelled(), "{err}");
    assert!(started.elapsed() < Duration::from_secs(5), "cancel took {:?}", started.elapsed());
}
