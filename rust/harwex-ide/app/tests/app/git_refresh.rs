//! Git status refresh in IDEA's model (`app/src/git/refresh.rs`): our own writes and file
//! changes refresh only their paths, a `.git` change from our own write runs nothing, an
//! outside index change runs exactly one full status, and a burst of `.git` events during a
//! running full status queues no second one. Every step checks that the UI equals what a full
//! status reports.

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

    // Staging both sides makes a staged rename.
    ide.click("src/app.ts");
    let r = ide.rect("src/main.ts").center();
    ide.click_button_at(r, PointerButton::Primary, CMD);
    drag_rows(&mut ide, "src/main.ts", "Staged group");
    ide.wait_for("rename staged", |s| s.ws.git.changes.iter().any(|c| c.old_path.as_deref() == Some(Path::new("src/app.ts"))));
    assert_matches_full_status(&ide, &repo.dir, "after staging the rename");

    // Unstaging the new side brings back the old side, both unstaged.
    ide.click("extra.txt");
    drag_rows(&mut ide, "src/main.ts", "Unstaged group");
    ide.wait_for("rename unstaged", |s| s.ws.git.changes.iter().all(|c| c.old_path.is_none()));
    assert_matches_full_status(&ide, &repo.dir, "after unstaging the rename");
    assert_eq!(runs(&ide).0, full, "no full status for a rename");
}

#[test]
fn an_outside_index_change_runs_one_full_status() {
    let fx = Fixture::new(SUITE, "outside");
    let repo = changed_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    let full = runs(&ide).0;

    // A terminal `git add`; the watcher delivers it in two batches.
    repo.git(&["add", "scratch.txt"]);
    fs_batch(&mut ide, &[], true);
    fs_batch(&mut ide, &[], true);
    ide.settle();
    assert_eq!(runs(&ide).0, full + 1, "exactly one full status");
    assert_matches_full_status(&ide, &repo.dir, "after the outside git add");

    // A shell prompt's `git status` rewrites the index with new stat data only.
    std::thread::sleep(std::time::Duration::from_millis(1100));
    repo.write("src/app.ts", &repo.read("src/app.ts"));
    repo.git(&["status", "--porcelain"]);
    fs_batch(&mut ide, &[], true);
    ide.settle();
    assert_eq!(runs(&ide).0, full + 1, "a stat-only index rewrite runs no full status");
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
