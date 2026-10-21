//! Git status refresh in IDEA's model (`app/src/git/refresh.rs`): our own writes and file
//! changes refresh only their paths, a `.git` change from our own write runs nothing, an
//! outside index or HEAD change runs exactly one incremental status (a full walk only above
//! `MAX_CHANGED` paths), and a burst of `.git` events during a running full status queues no
//! second one. Every step checks that the UI equals what a full status reports.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::common::*;
use egui::PointerButton;
use harwex_ide::git::changes::Group;
use harwex_ide::watcher::FsBatch;

const SUITE: &str = "git_refresh";

/// (full, path, light) runs so far.
fn runs(ide: &Ide) -> (u64, u64, u64) {
    let r = &ide.state().ws.git.refresh;
    (r.full_runs, r.path_runs, r.light_runs)
}

fn changed_runs(ide: &Ide) -> u64 {
    ide.state().ws.git.refresh.changed_runs
}

/// The UI's status must equal a full status read now.
fn assert_matches_full_status(ide: &Ide, dir: &Path, what: &str) {
    let full = ide_git::Repo::discover(dir).expect("repo").status().expect("status");
    assert_eq!(ide.state().ws.git.changes, full, "{what}");
}

fn drag_rows(ide: &mut Ide, from: &str, to: &str) {
    let (a, b) = (ide.rect(from).center(), ide.rect(to).center());
    ide.drag(a, b);
    ide.wait_for("git write", |s| s.is_idle());
    ide.settle();
}

fn open_commit_window(ide: &mut Ide) {
    ide.click("Commit tool window");
    ide.settle();
    // Folders start collapsed; these tests click file rows, so they open every folder.
    expand_all(ide);
}

fn expand_all(ide: &mut Ide) {
    ide.click("Expand All");
    ide.settle();
}

fn fs_batch(ide: &mut Ide, paths: &[PathBuf], git_changed: bool) {
    let paths: HashSet<PathBuf> = paths.iter().cloned().collect();
    ide.state_mut().on_fs_batch(FsBatch { paths, structure_changed: false, git_changed });
}

#[test]
fn own_writes_refresh_only_their_paths() {
    let fx = Fixture::new(SUITE, "own_writes");
    let repo = changed_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_commit_window(&mut ide);
    let (full, paths, _) = runs(&ide);
    assert_eq!(full, 1, "startup runs one full status");

    drag_rows(&mut ide, "src/app.ts", "Staged group");
    ide.wait_for("app.ts staged", |s| s.ws.git_ui.changes.group_paths(Group::Staged).contains(&PathBuf::from("src/app.ts")));
    assert_matches_full_status(&ide, &repo.dir, "after Stage");

    // An unversioned file staged and unstaged again is unversioned again.
    drag_rows(&mut ide, "scratch.txt", "Staged group");
    ide.wait_for("scratch.txt added", |s| s.ws.git_ui.changes.group_paths(Group::Staged).contains(&PathBuf::from("scratch.txt")));
    assert_matches_full_status(&ide, &repo.dir, "after adding scratch.txt");
    drag_rows(&mut ide, "scratch.txt", "Unstaged group");
    ide.wait_for("scratch.txt unversioned", |s| s.ws.git_ui.changes.group_paths(Group::Unversioned).contains(&PathBuf::from("scratch.txt")));
    assert_matches_full_status(&ide, &repo.dir, "after Unstage");

    // The watcher reports the index change of our own writes: nothing runs again.
    fs_batch(&mut ide, &[], true);
    ide.settle();
    let after_writes = runs(&ide);
    assert_eq!(after_writes.0, full, "no full status after our own writes");
    assert!(after_writes.1 >= paths + 3, "each write refreshed its paths: {after_writes:?}");
    assert_eq!(after_writes.2, 1, "the .git event only re-read the branches");

    // Commit the staged files (src/added.ts and src/app.ts are ticked).
    let r = *ide.role_rects(egui::accesskit::Role::MultilineTextInput).first().expect("commit message box");
    ide.click_at(r.center());
    ide.type_text("Commit two");
    let n = ide.rects("Commit").len();
    ide.click_nth("Commit", n - 1);
    ide.wait_for("commit done", |s| !s.ws.git_ui.changes.is_committing() && s.ws.git_ui.changes.message.is_empty());
    ide.settle();
    assert_eq!(repo.subjects("HEAD")[0], "Commit two");
    assert_matches_full_status(&ide, &repo.dir, "after Commit");
    fs_batch(&mut ide, &[], true);
    ide.settle();
    assert_eq!(runs(&ide).0, full, "no full status after the commit");
}

#[test]
fn a_rename_refreshes_both_sides() {
    let fx = Fixture::new(SUITE, "rename");
    let repo = basic_repo(fx.path("repo"));
    // Something staged, so the Staged group is there to drop on.
    repo.write("extra.txt", "extra\n");
    repo.git(&["add", "extra.txt"]);
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_commit_window(&mut ide);
    let full = runs(&ide).0;

    // A move on disk, as the project tree or the watcher reports it.
    let (old, new) = (repo.dir.join("src/app.ts"), repo.dir.join("src/main.ts"));
    std::fs::rename(&old, &new).expect("rename");
    fs_batch(&mut ide, &[old, new], false);
    ide.settle();
    assert_matches_full_status(&ide, &repo.dir, "after the move");
    // The move made a new folder row in Unversioned Files; it starts collapsed.
    expand_all(&mut ide);

    // Staging both sides makes a staged rename.
    ide.click("src/app.ts");
    let r = ide.rect("src/main.ts").center();
    ide.click_button_at(r, PointerButton::Primary, CMD);
    drag_rows(&mut ide, "src/main.ts", "Staged group");
    ide.wait_for("rename staged", |s| s.ws.git.changes.iter().any(|c| c.old_path.as_deref() == Some(Path::new("src/app.ts"))));
    assert_matches_full_status(&ide, &repo.dir, "after staging the rename");
    expand_all(&mut ide);

    // Unstaging the new side brings back the old side, both unstaged.
    ide.click("extra.txt");
    drag_rows(&mut ide, "src/main.ts", "Unstaged group");
    ide.wait_for("rename unstaged", |s| s.ws.git.changes.iter().all(|c| c.old_path.is_none()));
    assert_matches_full_status(&ide, &repo.dir, "after unstaging the rename");
    assert_eq!(runs(&ide).0, full, "no full status for a rename");
}

#[test]
fn an_outside_index_change_runs_one_incremental_status() {
    let fx = Fixture::new(SUITE, "outside");
    let repo = changed_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    let full = runs(&ide).0;

    // A terminal `git add`; the watcher delivers it in two batches.
    repo.git(&["add", "scratch.txt"]);
    fs_batch(&mut ide, &[], true);
    fs_batch(&mut ide, &[], true);
    ide.settle();
    assert_eq!(changed_runs(&ide), 1, "exactly one incremental status");
    assert_eq!(runs(&ide).0, full, "no full walk");
    assert_matches_full_status(&ide, &repo.dir, "after the outside git add");

    // A shell prompt's `git status` rewrites the index with new stat data only.
    std::thread::sleep(std::time::Duration::from_millis(1100));
    repo.write("src/app.ts", &repo.read("src/app.ts"));
    repo.git(&["status", "--porcelain"]);
    fs_batch(&mut ide, &[], true);
    ide.settle();
    assert_eq!((runs(&ide).0, changed_runs(&ide)), (full, 1), "a stat-only index rewrite runs no status");

    // A terminal commit, `reset --mixed HEAD~1` and a checkout of another branch: HEAD moves,
    // and the worktree changes only through git.
    repo.git(&["commit", "-q", "-m", "outside commit"]);
    fs_batch(&mut ide, &[], true);
    ide.settle();
    assert_matches_full_status(&ide, &repo.dir, "after the outside commit");
    repo.git(&["reset", "-q", "HEAD~1"]);
    fs_batch(&mut ide, &[], true);
    ide.settle();
    assert_matches_full_status(&ide, &repo.dir, "after reset --mixed");
    repo.git(&["stash", "-q", "-u"]);
    repo.git(&["checkout", "-q", "-b", "side"]);
    repo.write("side.txt", "side\n");
    repo.write("README.md", "side readme\n");
    repo.commit_all("Side work");
    repo.git(&["checkout", "-q", "main"]);
    repo.git(&["stash", "pop", "-q"]);
    fs_batch(&mut ide, &[], true);
    ide.settle();
    // The stash pop wrote files that neither HEAD nor the index explain; the watcher reports them.
    fs_batch(&mut ide, &[repo.dir.join("src/app.ts"), repo.dir.join("src/added.ts"), repo.dir.join("scratch.txt")], false);
    ide.settle();
    assert_matches_full_status(&ide, &repo.dir, "after the stash round trip");
    repo.git(&["checkout", "-q", "side"]);
    fs_batch(&mut ide, &[], true);
    ide.settle();
    assert_matches_full_status(&ide, &repo.dir, "after an outside checkout");
    assert_eq!(runs(&ide).0, full, "every step ran without a full walk");
    // The stash round trip may leave the index as it was: then only the branches are re-read.
    assert!(changed_runs(&ide) >= 4, "{}", changed_runs(&ide));
}

/// A checkout that changes more than `MAX_CHANGED` (400) paths walks the whole tree.
#[test]
fn a_big_checkout_walks_the_whole_tree() {
    let fx = Fixture::new(SUITE, "big_checkout");
    let repo = changed_repo(fx.path("repo"));
    repo.git(&["stash", "-q", "-u"]);
    repo.git(&["checkout", "-q", "-b", "big"]);
    for i in 0..450 {
        repo.write(&format!("many/f{i}.txt"), "x\n");
    }
    repo.commit_all("Many files");
    repo.git(&["checkout", "-q", "main"]);
    repo.git(&["stash", "pop", "-q"]);
    let mut ide = Ide::open(SUITE, &repo.dir);
    let full = runs(&ide).0;
    // A checkout from the Git window (`run_op`) refreshes through the incremental status.
    menu_checkout(&mut ide, "big");
    assert_eq!(changed_runs(&ide), 1);
    assert_eq!(runs(&ide).0, full + 1, "450 changed paths: a full walk");
    assert_matches_full_status(&ide, &repo.dir, "after the big checkout");
}

fn menu_checkout(ide: &mut Ide, branch: &str) {
    ide.key_mods(CTRL_SHIFT, egui::Key::Backtick);
    let row = format!("Local branch {branch}");
    let r2 = row.clone();
    ide.wait_until("branches popup", move |ide| ide.has(&r2));
    ide.hover(&row);
    ide.wait_until("submenu", |ide| ide.has("Checkout"));
    ide.click("Checkout");
    let b = branch.to_string();
    ide.wait_for("checked out", move |s| s.ws.git.branch.as_deref() == Some(b.as_str()) && s.is_idle());
    ide.settle();
}

#[test]
fn a_burst_during_a_full_status_queues_no_second_one() {
    let fx = Fixture::new(SUITE, "burst");
    let repo = changed_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    let full = runs(&ide).0;

    repo.git(&["add", "scratch.txt"]);
    ide.state_mut().refresh_git();
    for _ in 0..5 {
        fs_batch(&mut ide, &[], true);
        ide.step();
    }
    ide.settle();
    assert_eq!(runs(&ide).0, full + 1, "the running full status already covers the burst");
    assert_matches_full_status(&ide, &repo.dir, "after the burst");

    // A second full status cancels the first instead of queuing behind it.
    ide.state_mut().refresh_git();
    ide.state_mut().refresh_git();
    ide.settle();
    assert_eq!(runs(&ide).0, full + 3);
    assert_matches_full_status(&ide, &repo.dir, "after two Refresh");
}

#[test]
fn file_changes_refresh_only_their_paths() {
    let fx = Fixture::new(SUITE, "files");
    let repo = changed_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    let (full, paths, _) = runs(&ide);

    repo.write("README.md", "changed\n");
    repo.write("new dir/fresh.txt", "fresh\n");
    std::fs::remove_file(repo.dir.join("scratch.txt")).expect("remove");
    fs_batch(&mut ide, &[repo.dir.join("README.md"), repo.dir.join("new dir"), repo.dir.join("scratch.txt")], false);
    ide.settle();
    assert_matches_full_status(&ide, &repo.dir, "after file changes");
    assert_eq!(runs(&ide).0, full, "no full status for file changes");
    assert_eq!(runs(&ide).1, paths + 1);
}

/// `rows` synthetic status rows in 50 packages; every 5th is a staged rename from `file<i>.ts`
/// to `moved<i>.ts`.
fn synthetic_rows(rows: usize) -> Vec<ide_git::FileChange> {
    use ide_git::{ChangeKind, FileChange};
    let mut out: Vec<FileChange> = (0..rows)
        .map(|i| {
            let dir = format!("pkg{}/src/dir{}", i % 50, i % 700);
            let rename = i % 5 == 0;
            FileChange {
                path: format!("{dir}/moved{i}.ts").into(),
                old_path: rename.then(|| format!("{dir}/file{i}.ts").into()),
                staged: rename.then_some(ChangeKind::Renamed),
                unstaged: (!rename).then_some(ChangeKind::Modified),
            }
        })
        .collect();
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

/// `n` absolute paths under the synthetic packages, on the old sides of the renames.
fn burst(dir: &Path, n: usize) -> Vec<PathBuf> {
    (0..n).map(|i| dir.join(format!("pkg{}/src/dir{}/file{i}.ts", i % 50, i % 700))).collect()
}

/// Steps frames until the app is idle. Returns the slowest frame.
fn worst_frame_until_idle(ide: &mut Ide) -> std::time::Duration {
    let started = std::time::Instant::now();
    let mut worst = std::time::Duration::ZERO;
    loop {
        let t = std::time::Instant::now();
        ide.step();
        worst = worst.max(t.elapsed());
        if ide.state().is_idle() {
            return worst;
        }
        assert!(started.elapsed() < std::time::Duration::from_secs(60), "the refresh did not end in 60 s");
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
}

/// Task 122: a watcher burst of 100k paths with 10k status rows froze the UI for minutes
/// (rows x paths `starts_with` calls in `start_paths`). The budget (`docs/timings.md`) holds the
/// `paths` call and every frame until the refresh lands.
#[test]
fn a_huge_burst_keeps_frames_fast() {
    use harwex_ide::git::refresh;
    const BUDGET: std::time::Duration = std::time::Duration::from_millis(100);
    let fx = Fixture::new(SUITE, "huge_burst");
    let repo = changed_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    let rows = synthetic_rows(10_000);

    // 100k paths: the whole tree is dirty, and one full status runs.
    ide.state_mut().apply_status(rows.clone());
    let (full, paths, _) = runs(&ide);
    let many = burst(&repo.dir, 100_000);
    let t = std::time::Instant::now();
    refresh::paths(ide.state_mut(), many, false);
    let call = t.elapsed();
    assert!(ide.state().ws.git.refresh.pending().is_empty(), "the burst is never stored");
    let worst = worst_frame_until_idle(&mut ide);
    eprintln!("100k paths, 10k rows: paths() {call:?}, worst frame {worst:?}");
    assert_eq!(runs(&ide).0, full + 1, "a burst above the cap walks the whole tree");
    assert_eq!(runs(&ide).1, paths, "and runs no path refresh");
    assert_matches_full_status(&ide, &repo.dir, "after the 100k burst");
    assert!(call < BUDGET && worst < BUDGET, "paths() {call:?}, worst frame {worst:?}");

    // Just under the cap: a path refresh. The partner pass and the coarsening run on the
    // worker; the UI merges 10k rows.
    ide.state_mut().apply_status(rows);
    let (full, paths, _) = runs(&ide);
    let near = burst(&repo.dir, refresh::MAX_PENDING);
    let t = std::time::Instant::now();
    refresh::paths(ide.state_mut(), near, false);
    let call = t.elapsed();
    let worst = worst_frame_until_idle(&mut ide);
    eprintln!("{} paths, 10k rows: paths() {call:?}, worst frame {worst:?}", refresh::MAX_PENDING);
    assert_eq!(runs(&ide).0, full, "no full status under the cap");
    assert_eq!(runs(&ide).1, paths + 1);
    assert!(ide.state().ws.git.changes.iter().all(|c| !c.path.starts_with("pkg0")), "the rows under the refreshed folders are gone");
    assert!(call < BUDGET && worst < BUDGET, "paths() {call:?}, worst frame {worst:?}");
}

/// A frame longer than the guard's limit logs its longest section (task 122).
#[test]
fn a_slow_frame_names_its_longest_section() {
    let fx = Fixture::new(SUITE, "slow_frame");
    let repo = changed_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.state_mut().frame_clock.slow_after = std::time::Duration::from_millis(30);
    ide.state().jobs.post(|_| std::thread::sleep(std::time::Duration::from_millis(60)));
    ide.step();
    let slow = ide.state().frame_clock.last_slow.clone().expect("a slow frame");
    assert!(slow.section.contains("a_slow_frame_names_its_longest_section"), "{}", slow.line());
    assert!(slow.section_took >= std::time::Duration::from_millis(60), "{}", slow.line());
}
