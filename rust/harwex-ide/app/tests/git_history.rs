//! Git history: the log (graph with a merge, filters, paging, details pane and commit diff),
//! the branches popup, push to a bare remote, Update Project, stash / unstash, the conflict
//! flow (dialog, merge tab, Continue, Abort) and the Cmd+T / Cmd+Shift+K shortcuts.

mod common;

use common::*;
use egui::Key;
use harwex_ide::layout::ToolWindow;
use ide_git::RepoState;

const SUITE: &str = "git_history";

fn subjects(ide: &Ide) -> Vec<String> {
    ide.state().git_ui.log.commits().iter().map(|c| c.summary.clone()).collect()
}

fn open_log(ide: &mut Ide) {
    ide.click("Git tool window");
    ide.wait_for("log loaded", |s| !s.git_ui.log.is_loading() && !s.git_ui.log.commits().is_empty());
    ide.settle();
    assert_eq!(ide.state().layout.bottom, Some(ToolWindow::Git));
}

/// Clicks the last widget labelled `label`: dialogs draw after the top bar, whose buttons share
/// names with them (Push, Commit).
fn click_last(ide: &mut Ide, label: &str) {
    // Toasts never expire in tests and can cover dialog buttons.
    ide.dismiss_toasts();
    let n = ide.rects(label).len();
    assert!(n > 0, "no widget labelled {label:?}; {:?}", ide.labels());
    ide.click_nth(label, n - 1);
}

fn open_branches(ide: &mut Ide) {
    ide.dismiss_toasts();
    let label = format!("{}  v", ide.state().git.branch.clone().expect("branch"));
    ide.click(&label);
    ide.wait_until("branches popup", |ide| ide.state().git_ui.branches.is_open() && ide.has("Fetch"));
    ide.settle();
}

/// Hovers a branch row; its submenu opens to the right.
fn branch_menu(ide: &mut Ide, row: &str) {
    let name = row.rsplit(' ').next().expect("branch name").to_string();
    ide.hover(row);
    let item = format!("New Branch from '{name}'...");
    ide.wait_until("branch submenu", move |ide| ide.has(&item));
    ide.settle();
}

#[test]
fn log_graph_details_and_commit_diff() {
    let fx = Fixture::new(SUITE, "log");
    let repo = history_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_log(&mut ide);
    // Topological order, newest first: the main-line commit is newer than the side work.
    assert_eq!(subjects(&ide), ["After merge", "Merge branch 'side'", "Main line change", "More side work", "Side work", "Add ONE", "Initial commit"]);
    let log = &ide.state().git_ui.log;
    let merge = log.commits().iter().position(|c| c.parents.len() == 2).expect("merge commit");
    assert!(log.graph()[merge].down.len() >= 2, "the merge row opens a second lane");
    assert!(log.graph().iter().any(|g| g.lane == 1), "side commits sit in their own lane");
    ide.snapshot("log_graph");

    // Selecting a commit loads its files; a click on a file opens the commit diff.
    ide.click("Commit More side work");
    ide.wait_for("details", |s| s.git_ui.log.details().is_some_and(|d| d.info.summary == "More side work"));
    ide.settle();
    ide.assert_text("Changed files (1)");
    ide.click("Changed file src/side.ts");
    ide.wait_until("commit diff tab", |ide| ide.active_title().is_some_and(|t| t.starts_with("side.ts @ ")));
    ide.settle();
    ide.assert_text("1 difference");
    ide.snapshot("commit_diff");

    // Up/Down move the selection while the table has focus.
    ide.click("Commit Merge branch 'side'");
    ide.key(Key::ArrowDown);
    let sel = ide.state().git_ui.log.selected();
    assert_eq!(sel, ide.state().git_ui.log.commits().get(2).map(|c| c.oid));
}

#[test]
fn log_filters() {
    let fx = Fixture::new(SUITE, "filters");
    let repo = history_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_log(&mut ide);

    // The text filter reloads after typing rests (300 ms).
    let text = ide.role_rects(egui::accesskit::Role::TextInput)[0];
    ide.click_at(text.center());
    ide.type_text("side");
    ide.wait_for("text filter", |s| s.git_ui.log.commits().len() == 3);
    ide.settle();
    assert_eq!(subjects(&ide), ["Merge branch 'side'", "More side work", "Side work"]);
    ide.snapshot("filter_text");
    for _ in 0..4 {
        ide.key(Key::Backspace);
    }
    ide.wait_for("filter cleared", |s| s.git_ui.log.commits().len() == 7);

    // The branch combo limits the log to one branch.
    let combo = ide.role_rects(egui::accesskit::Role::ComboBox)[0];
    ide.click_at(combo.center());
    ide.settle();
    ide.click("side");
    ide.wait_for("branch filter", |s| s.git_ui.log.commits().len() == 4);
    ide.settle();
    assert_eq!(subjects(&ide), ["More side work", "Side work", "Add ONE", "Initial commit"]);
    ide.snapshot("filter_branch");

    // An author nobody matches leaves an empty table with a hint.
    let author = ide.role_rects(egui::accesskit::Role::TextInput)[1];
    ide.click_at(author.center());
    ide.type_text("nobody");
    ide.wait_for("author filter", |s| !s.git_ui.log.is_loading() && s.git_ui.log.commits().is_empty());
    ide.settle();
    ide.assert_text("No commits match the filter.");
}

/// 700 commits: pages of 300 load as PageDown nears the end.
#[test]
fn log_paging() {
    let fx = Fixture::new(SUITE, "paging");
    let repo = long_history_repo(fx.path("repo"), 700);
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_log(&mut ide);
    assert_eq!(ide.state().git_ui.log.commits().len(), 300);
    assert!(ide.state().git_ui.log.has_more());
    ide.assert_text("300+ commits");
    ide.click("Commit Commit 699");
    for _ in 0..300 {
        ide.key(Key::PageDown);
        if ide.state().git_ui.log.commits().len() == 700 {
            break;
        }
    }
    ide.wait_for("all pages", |s| s.git_ui.log.commits().len() == 700 && !s.git_ui.log.has_more());
    ide.settle();
    let last = ide.state().git_ui.log.commits().last().map(|c| c.summary.clone());
    assert_eq!(last.as_deref(), Some("Commit 0"));
    ide.assert_text("700 commits");
}

#[test]
fn branches_popup_search_checkout_and_new_branch() {
    let fx = Fixture::new(SUITE, "branches");
    let (repo, _bare) = repo_with_remote(&fx);
    repo.git(&["branch", "feature"]);
    repo.git(&["branch", "fix/other"]);
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_branches(&mut ide);
    for row in ["+ New Branch...", "Update Project...", "Push...", "Fetch", "Stash Changes...", "Unstash Changes...", "Local branch main", "Local branch feature", "Remote branch origin/main"] {
        assert!(ide.has(row), "{row:?} missing; {:?}", ide.labels());
    }
    // main is one commit ahead of origin/main: the row draws an up arrow with 1, and its
    // tooltip says so.
    ide.snapshot("branches_popup");
    ide.hover("Local branch main");
    ide.wait_until("ahead/behind tooltip", |ide| ide.shows_text("Tracks origin/main; 1 to push, 0 to pull"));
    ide.park_mouse();

    // The search filters branches and actions.
    ide.type_text("fea");
    ide.settle();
    assert!(ide.has("Local branch feature"));
    assert!(!ide.has("Local branch main") && !ide.has("Fetch"));
    ide.snapshot("branches_search");

    // The submenu checks out the hovered branch.
    branch_menu(&mut ide, "Local branch feature");
    ide.click("Checkout");
    ide.wait_for("checked out", |s| s.git.branch.as_deref() == Some("feature"));
    assert_eq!(repo.branch(), "feature");
    assert!(!ide.state().git_ui.branches.is_open());

    // + New Branch... asks for a name and checks the branch out.
    open_branches(&mut ide);
    ide.click("+ New Branch...");
    ide.settle();
    ide.assert_text("Create New Branch");
    ide.type_text("topic/new\n");
    ide.wait_for("new branch", |s| s.git.branch.as_deref() == Some("topic/new"));
    assert_eq!(repo.branch(), "topic/new");
}

#[test]
fn push_to_bare_remote_with_set_upstream() {
    let fx = Fixture::new(SUITE, "push");
    let (repo, bare) = repo_with_remote(&fx);
    let remote_log = |b: &str| {
        let out = std::process::Command::new("git").args(["--git-dir", bare.to_str().expect("utf8"), "log", "--format=%s", b]).output().expect("git log");
        String::from_utf8_lossy(&out.stdout).lines().map(str::to_string).collect::<Vec<_>>()
    };
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.click("Push");
    ide.wait_for("push dialog", |s| s.git_ui.remote.push_open() && !s.git_ui.remote.push_commits().is_empty());
    ide.settle();
    assert_eq!(ide.state().git_ui.remote.push_commits(), ["Local work to push"]);
    ide.assert_text("main -> origin/main");
    ide.snapshot("push_dialog");
    click_last(&mut ide, "Push");
    ide.wait_for("pushed", |s| !s.git_ui.remote.push_open());
    assert_eq!(remote_log("main")[0], "Local work to push");

    // A branch without upstream: the dialog offers "Set upstream" (on by default).
    repo.git(&["checkout", "-q", "-b", "topic"]);
    repo.write("topic.txt", "topic\n");
    repo.commit_all("Topic work");
    ide.state_mut().refresh_git();
    ide.wait_for("on topic", |s| s.git.branch.as_deref() == Some("topic"));
    ide.cmd_shift(Key::K);
    ide.wait_for("push dialog for topic", |s| s.git_ui.remote.push_open() && !s.git_ui.remote.push_commits().is_empty());
    ide.settle();
    ide.assert_text("topic -> origin/topic  (new)");
    assert!(ide.is_selected("Set upstream"));
    ide.snapshot("push_new_branch");
    click_last(&mut ide, "Push");
    ide.wait_for("pushed topic", |s| !s.git_ui.remote.push_open());
    assert_eq!(remote_log("topic")[0], "Topic work");
    assert_eq!(repo.git(&["rev-parse", "--abbrev-ref", "topic@{u}"]).trim(), "origin/topic");
}

fn diverged(name: &str) -> (Fixture, Repo) {
    let fx = Fixture::new(SUITE, name);
    let (repo, bare) = repo_with_remote(&fx);
    push_from_other_clone(&fx, &bare, "README.md", "# demo\n\nChanged elsewhere.\n", "Remote change");
    repo.git(&["fetch", "-q"]);
    (fx, repo)
}

#[test]
fn update_project_merge() {
    let (_fx, repo) = diverged("update_merge");
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.click("Update");
    ide.wait_for("update dialog", |s| s.git_ui.remote.update_open());
    ide.settle();
    ide.click("Merge incoming changes into the current branch");
    ide.snapshot("update_dialog");
    ide.click("OK");
    ide.wait_for("updated", |s| !s.git_ui.remote.update_open() && s.is_idle());
    ide.wait_until("merge done", |_| repo.git(&["log", "-1", "--format=%p"]).split_whitespace().count() == 2);
    let s = repo.subjects("HEAD");
    assert!(s.contains(&"Remote change".to_string()) && s.contains(&"Local work to push".to_string()), "{s:?}");
    assert_eq!(repo.read("README.md"), "# demo\n\nChanged elsewhere.\n");
}

#[test]
fn update_project_rebase_with_cmd_t() {
    let (_fx, repo) = diverged("update_rebase");
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.cmd(Key::T);
    ide.wait_for("update dialog", |s| s.git_ui.remote.update_open());
    ide.click("Rebase the current branch on top of incoming changes");
    ide.click("OK");
    ide.wait_until("rebased", |_| repo.subjects("HEAD").first().map(String::as_str) == Some("Local work to push") && repo.subjects("HEAD").get(1).map(String::as_str) == Some("Remote change"));
    assert_eq!(repo.git(&["log", "-1", "--format=%p"]).split_whitespace().count(), 1, "linear history");
}

#[test]
fn stash_and_unstash_pop_and_drop_by_id() {
    let fx = Fixture::new(SUITE, "stash");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    let stash = |ide: &mut Ide, file: &str, message: &str| {
        repo.write(file, &format!("{message}\n"));
        ide.state_mut().refresh_git();
        ide.settle();
        open_branches(ide);
        ide.click("Stash Changes...");
        ide.wait_for("stash dialog", |s| s.git_ui.remote.stash_open());
        ide.settle();
        ide.type_text(message);
        ide.click("Include untracked files");
        ide.dismiss_toasts();
        ide.click("Create Stash");
        ide.wait_for("stashed", |s| !s.git_ui.remote.stash_open() && s.is_idle());
    };
    stash(&mut ide, "src/util.ts", "wip one");
    stash(&mut ide, "new.txt", "wip two");
    assert!(repo.status_short().is_empty(), "both stashes took everything, untracked too");

    open_branches(&mut ide);
    ide.click("Unstash Changes...");
    ide.wait_for("unstash list", |s| s.git_ui.remote.unstash_entries().is_some_and(|e| e.len() == 2) && !s.git_ui.remote.unstash_busy());
    ide.settle();
    ide.snapshot("unstash_dialog");

    // Pop the older stash (index 1).
    ide.click_containing("wip one");
    ide.settle();
    ide.dismiss_toasts();
    ide.click("Pop");
    ide.wait_for("popped", |s| s.git_ui.remote.unstash_entries().is_none() && s.is_idle());
    assert!(repo.read("src/util.ts").starts_with("wip one"));
    assert_eq!(repo.git(&["stash", "list", "--format=%s"]).trim(), "On main: wip two");

    // Drop by id: a stash made while the dialog is open shifts the indices, and Drop must
    // still remove the entry the dialog showed.
    open_branches(&mut ide);
    ide.click("Unstash Changes...");
    ide.wait_for("unstash list", |s| s.git_ui.remote.unstash_entries().is_some_and(|e| e.len() == 1) && !s.git_ui.remote.unstash_busy());
    repo.write("other.txt", "other\n");
    repo.git(&["stash", "push", "-u", "-q", "-m", "made outside"]);
    ide.dismiss_toasts();
    ide.click("Drop");
    ide.settle();
    ide.assert_text("Drop stash@{0}? Its changes are lost.");
    let n = ide.rects("Drop").len();
    ide.click_nth("Drop", n - 1);
    ide.wait_for("dropped", |s| s.is_idle() && s.git_ui.remote.unstash_entries().is_some_and(|e| e.len() == 1));
    assert_eq!(repo.git(&["stash", "list", "--format=%s"]).trim(), "On main: made outside");
}

fn start_conflict(name: &str) -> (Fixture, Repo, Ide) {
    let fx = Fixture::new(SUITE, name);
    let repo = conflict_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_branches(&mut ide);
    branch_menu(&mut ide, "Local branch conflict-b");
    ide.click("Merge 'conflict-b' into 'conflict-a'");
    ide.wait_for("conflicts dialog", |s| s.git_ui.conflicts.dialog_open() && s.git_ui.conflicts.files().len() == 1 && s.is_idle());
    ide.settle();
    (fx, repo, ide)
}

#[test]
fn merge_conflict_resolved_in_merge_tab() {
    let (_fx, repo, mut ide) = start_conflict("conflict");
    assert_eq!(ide.state().git_ui.conflicts.op(), RepoState::Merge);
    ide.assert_text("1 file(s) have conflicts. Pick a side, or merge them by hand.");
    ide.dismiss_toasts();
    ide.snapshot("conflicts_dialog");

    ide.click("Merge...");
    ide.wait_until("merge tab", |ide| ide.active_title().is_some_and(|t| t.contains("conflict.txt")));
    ide.settle();
    ide.snapshot("merge_tab");
    ide.click("Accept Theirs");
    ide.settle();
    ide.click("Save and Mark Resolved");
    ide.wait_for("resolved", |s| s.git_ui.conflicts.files().is_empty() && s.is_idle());
    ide.settle();
    assert_eq!(repo.read("conflict.txt"), "line one\ntheirs version\nline three\n");
    ide.assert_text("Merge in progress: all conflicts resolved");
    ide.dismiss_toasts();
    ide.snapshot("banner_resolved");

    // Continue commits the merge.
    ide.click("Continue");
    ide.wait_for("merge committed", |s| s.git_ui.conflicts.op() == RepoState::Clean && s.is_idle());
    assert_eq!(repo.git(&["log", "-1", "--format=%p"]).split_whitespace().count(), 2);
    assert!(repo.status_short().is_empty());
}

#[test]
fn abort_from_the_banner() {
    let (_fx, repo, mut ide) = start_conflict("abort");
    // Closing the dialog leaves the banner.
    ide.click("Accept Yours");
    ide.wait_for("resolved with ours", |s| s.git_ui.conflicts.files().is_empty() && s.is_idle());
    ide.settle();
    ide.dismiss_toasts();
    ide.click("Abort");
    ide.settle();
    ide.assert_text("Abort merge?");
    ide.snapshot("abort_confirm");
    let n = ide.rects("Abort").len();
    ide.click_nth("Abort", n - 1);
    ide.wait_for("aborted", |s| s.git_ui.conflicts.op() == RepoState::Clean && s.is_idle());
    assert_eq!(repo.read("conflict.txt"), "line one\nours version\nline three\n");
    assert!(repo.status_short().is_empty());
    assert!(!ide.shows_text("Merge in progress"));
}

#[test]
fn log_context_menu_new_branch_and_reset() {
    let fx = Fixture::new(SUITE, "log_menu");
    let repo = history_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_log(&mut ide);
    ide.right_click("Commit Add ONE");
    ide.settle();
    for item in ["Copy Revision Number", "Checkout Revision", "New Branch...", "Reset Current Branch to Here...", "Revert Commit", "Cherry-Pick"] {
        assert!(ide.has(item), "log menu item {item:?}");
    }
    ide.snapshot_here("log_context_menu");
    ide.click("New Branch...");
    ide.settle();
    ide.assert_text("New branch from ");
    // Regression: Enter in the name box used to do nothing, because the box took the focus
    // back on the same frame.
    ide.type_text("from-log\n");
    ide.wait_for("branch from log", |s| s.git.branch.as_deref() == Some("from-log"));
    assert_eq!(repo.subjects("HEAD")[0], "Add ONE");

    // Reset --hard asks twice; the branch then points at the chosen commit.
    ide.click("Commit Initial commit");
    ide.right_click("Commit Initial commit");
    ide.settle();
    ide.click("Reset Current Branch to Here...");
    ide.settle();
    ide.click("Hard: discard all changes");
    ide.click("Reset");
    ide.settle();
    ide.assert_text("Hard reset discards all uncommitted changes");
    ide.snapshot("reset_hard_confirm");
    ide.click("Reset --hard");
    ide.wait_until("reset done", |_| repo.subjects("HEAD") == ["Initial commit"]);
}
