//! Continue to End in the rebase banner (task 107): the mode continues by itself after each
//! resolved stop and at edit stops, waits at each conflict, pauses with git's reason when git
//! refuses, and ends with the rebase, on Abort or on an error. The buttons never move.

use std::path::PathBuf;

use crate::common::*;
use harwex_ide::git::conflicts::AutoContinue;
use ide_git::{RebaseProgress, RepoState};

const SUITE: &str = "rebase_to_end";
const THEIRS: &str = "Accept Your commit (theirs)";

/// `feature` has two commits that both conflict with `main` (one file each); `lower` points at
/// the first one. The rebase (`--update-refs`, as the IDE starts it) is left stopped on the
/// first conflict.
fn two_conflicts(name: &str) -> (Fixture, Repo, Ide) {
    let fx = Fixture::new(SUITE, name);
    let r = Repo::init(fx.path("repo"));
    r.write("f.txt", "base f\n");
    r.write("g.txt", "base g\n");
    r.commit_all("Base");
    r.git(&["checkout", "-q", "-b", "feature"]);
    r.write("f.txt", "first f\n");
    r.commit_all("First");
    r.git(&["branch", "lower"]);
    r.write("g.txt", "second g\n");
    r.commit_all("Second");
    r.git(&["checkout", "-q", "main"]);
    r.write("f.txt", "main f\n");
    r.write("g.txt", "main g\n");
    r.commit_all("Main edits both files");
    r.git(&["checkout", "-q", "feature"]);
    let out = r.git_status(&["rebase", "--update-refs", "main"]);
    assert!(!out.status.success(), "the rebase must stop on the first conflict");
    let mut ide = Ide::open(SUITE, &r.dir);
    ide.wait_for("first conflict", |s| s.ws.git_ui.conflicts.op() == RepoState::Rebase && s.ws.git_ui.conflicts.files().len() == 1 && s.is_idle());
    ide.settle();
    ide.dismiss_toasts();
    (fx, r, ide)
}

fn auto(ide: &Ide) -> AutoContinue {
    ide.state().ws.git_ui.conflicts.auto().clone()
}

/// The left edges of the banner buttons.
fn button_xs(ide: &Ide) -> Vec<f32> {
    ["Continue", "Continue to End", "Abort"].iter().map(|b| ide.rects(b)[0].min.x).collect()
}

#[test]
fn stops_at_each_conflict_and_continues_after_each_resolve() {
    let (_fx, repo, mut ide) = two_conflicts("two_conflicts");
    ide.assert_text("Rebase in progress: 1 conflicted file(s)");
    assert!(ide.has("Resolve..."));
    assert!(!ide.is_enabled_nth("Continue", 0), "Continue waits for the conflicts");
    assert!(ide.is_enabled("Continue to End"));
    assert_eq!(ide.state().ws.git_ui.conflicts.progress(), Some(RebaseProgress { step: 1, total: 2 }));
    let xs = button_xs(&ide);
    ide.snapshot("banner_conflicts");

    // Resolve the first stop by hand: the plain banner asks to continue, the buttons stay put.
    ide.click(THEIRS);
    ide.wait_for("first resolved", |s| s.ws.git_ui.conflicts.files().is_empty() && s.is_idle());
    ide.settle();
    ide.dismiss_toasts();
    ide.assert_text("Rebase in progress: all conflicts resolved");
    assert!(!ide.has("Resolve..."));
    assert_eq!(button_xs(&ide), xs, "Resolve leaves its place empty");
    ide.snapshot("banner_resolved");

    // Hold git in prepare-commit-msg, so the running state can be seen.
    let hook = repo.dir.join(".git/hooks/prepare-commit-msg");
    std::fs::write(&hook, "#!/bin/sh\nwhile [ ! -f .git/release-hook ]; do sleep 0.05; done\n").unwrap();
    make_executable(&hook);
    ide.click("Continue to End");
    ide.wait_for("continue runs", |s| *s.ws.git_ui.conflicts.auto() == AutoContinue::Running && s.ws.git_ui.conflicts.is_busy());
    ide.assert_text("Continuing to the end… (step 1 of 2)");
    assert_eq!(button_xs(&ide), xs);
    ide.snapshot_running("banner_running");
    std::fs::write(repo.dir.join(".git/release-hook"), "").unwrap();

    // The second commit conflicts: the mode waits and the dialog opens.
    ide.wait_for("second conflict", |s| *s.ws.git_ui.conflicts.auto() == AutoContinue::WaitResolve && s.ws.git_ui.conflicts.files().len() == 1 && s.is_idle());
    ide.settle();
    ide.dismiss_toasts();
    assert!(ide.state().ws.git_ui.conflicts.dialog_open());
    assert_eq!(ide.state().ws.git_ui.conflicts.progress(), Some(RebaseProgress { step: 2, total: 2 }));
    ide.assert_text("Continuing to the end… (step 2 of 2) Resolve the conflicts to go on.");
    assert_eq!(button_xs(&ide), xs);
    ide.snapshot("banner_waiting");

    // Resolving the last conflict continues without a question and ends the rebase.
    ide.click(THEIRS);
    ide.wait_for("rebase done", |s| s.ws.git_ui.conflicts.op() == RepoState::Clean && s.is_idle());
    ide.settle();
    assert_eq!(auto(&ide), AutoContinue::Off);
    assert!(!ide.shows_text("Rebase in progress"));
    assert!(!ide.shows_text("Continuing to the end"));
    assert!(ide.state().notifications.log().iter().any(|n| n.body == "Rebase finished"), "one toast says the rebase finished");
    assert_eq!(repo.subjects("feature"), ["Second", "First", "Main edits both files", "Base"]);
    assert_eq!(repo.read("f.txt"), "first f\n");
    assert_eq!(repo.read("g.txt"), "second g\n");
    assert_eq!(repo.git(&["rev-parse", "lower"]), repo.git(&["rev-parse", "feature~1"]), "--update-refs moved lower");
    assert!(repo.status_short().is_empty());
}

#[test]
fn abort_ends_the_mode() {
    let (_fx, repo, mut ide) = two_conflicts("abort");
    let before = repo.git(&["rev-parse", "ORIG_HEAD"]);
    // With conflicts open, Continue to End only turns the mode on.
    ide.click("Continue to End");
    ide.settle();
    assert_eq!(auto(&ide), AutoContinue::WaitResolve);
    ide.assert_text("Continuing to the end… (step 1 of 2) Resolve the conflicts to go on.");
    ide.click_nth("Abort", 0);
    ide.settle();
    ide.assert_text("Abort rebase?");
    let n = ide.rects("Abort").len();
    ide.click_nth("Abort", n - 1);
    ide.wait_for("aborted", |s| s.ws.git_ui.conflicts.op() == RepoState::Clean && s.is_idle());
    assert_eq!(auto(&ide), AutoContinue::Off);
    assert_eq!(repo.head(), before.trim(), "feature is back where it was");
    assert_eq!(repo.subjects("lower"), ["First", "Base"]);
    assert!(!ide.shows_text("Continuing to the end"));
}

/// A stop git cannot pass without the user (unstaged changes) pauses the mode with git's
/// reason; a failed `exec` pauses it too. Continue goes on in the mode.
#[test]
fn pauses_when_git_refuses() {
    let fx = Fixture::new(SUITE, "paused");
    let r = Repo::init(fx.path("repo"));
    r.write("g.txt", "x\n");
    r.commit_all("Base");
    r.git(&["checkout", "-q", "-b", "feature"]);
    r.write("one.txt", "1\n");
    r.commit_all("One");
    r.write("two.txt", "2\n");
    r.commit_all("Two");
    r.git(&["checkout", "-q", "main"]);
    r.write("m.txt", "m\n");
    r.commit_all("Main");
    r.git(&["checkout", "-q", "feature"]);
    assert!(!r.git_status(&["rebase", "-x", "false", "main"]).status.success(), "the exec stops the rebase");
    let mut ide = Ide::open(SUITE, &r.dir);
    ide.wait_for("rebase stop", |s| s.ws.git_ui.conflicts.op() == RepoState::Rebase && s.is_idle());
    ide.settle();
    ide.dismiss_toasts();
    let xs = button_xs(&ide);

    r.write("g.txt", "dirty\n");
    ide.click("Continue to End");
    ide.wait_for("paused", |s| matches!(s.ws.git_ui.conflicts.auto(), AutoContinue::Paused(_)) && s.is_idle());
    ide.settle();
    ide.dismiss_toasts();
    ide.assert_text("Continue to End stopped (step 1 of 2): You must edit all merge conflicts and then mark them as resolved using git add");
    assert_eq!(button_xs(&ide), xs);
    ide.snapshot("banner_paused");

    // The tree is clean again; Continue picks Two, whose exec fails: paused with that reason.
    r.write("g.txt", "x\n");
    ide.click("Continue");
    ide.wait_for("exec stop", |s| matches!(s.ws.git_ui.conflicts.auto(), AutoContinue::Paused(m) if m.contains("execution failed")) && s.is_idle());
    ide.assert_text("Continue to End stopped (step 2 of 2): Executing: false warning: execution failed: false");
    ide.click("Continue");
    ide.wait_for("rebase done", |s| s.ws.git_ui.conflicts.op() == RepoState::Clean && s.is_idle());
    assert_eq!(auto(&ide), AutoContinue::Off);
    assert_eq!(r.subjects("feature"), ["Two", "One", "Main", "Base"]);
}

/// Edit stops end with git's success, so the mode passes them without input.
#[test]
fn passes_edit_stops() {
    let fx = Fixture::new(SUITE, "edit_stops");
    let r = Repo::init(fx.path("repo"));
    r.write("g.txt", "x\n");
    r.commit_all("Base");
    for name in ["One", "Two", "Three"] {
        r.write(&format!("{name}.txt"), "1\n");
        r.commit_all(name);
    }
    let out = r.git_status(&["-c", "sequence.editor=sed -i.bak -e s/^pick/edit/", "rebase", "-i", "HEAD~3"]);
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let mut ide = Ide::open(SUITE, &r.dir);
    ide.wait_for("edit stop", |s| s.ws.git_ui.conflicts.op() == RepoState::Rebase && s.is_idle());
    assert_eq!(ide.state().ws.git_ui.conflicts.progress(), Some(RebaseProgress { step: 1, total: 3 }));
    ide.click("Continue to End");
    ide.wait_for("rebase done", |s| s.ws.git_ui.conflicts.op() == RepoState::Clean && s.is_idle());
    assert_eq!(auto(&ide), AutoContinue::Off);
    assert_eq!(r.subjects("main"), ["Three", "Two", "One", "Base"]);
    assert!(!PathBuf::from(&r.dir).join(".git/rebase-merge").exists());
}

fn make_executable(path: &std::path::Path) {
    #[cfg(not(unix))]
    let _ = path;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    #[cfg(unix)]
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
}
