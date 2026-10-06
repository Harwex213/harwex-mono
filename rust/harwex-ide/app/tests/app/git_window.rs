//! Git window shell: header tabs (+, close, overflow list, Console reopening), the branch tree
//! (folders by prefix, search, click and keys filter the log, ahead/behind badges, favourites,
//! context menu operations, Fetch and Update) and the Console tab.

use crate::common::*;
use egui::{Key, Pos2};
use harwex_ide::layout::ToolWindow;

const SUITE: &str = "git_window";

/// `history_repo` plus branches with folder prefixes, like the reference screenshot.
fn branchy_repo(fx: &Fixture) -> Repo {
    let r = history_repo(fx.path("repo"));
    for b in ["agent/ostrov-assets-01", "prototype/customGameEngine", "prototype/ostrov", "prototype/unity-self-learning", "NAPI---FLOCK"] {
        r.git(&["branch", b]);
    }
    r
}

fn open_git(ide: &mut Ide) {
    if ide.state().ws.layout.bottom != Some(ToolWindow::Git) {
        ide.click("Git tool window");
    }
    ide.wait_for("branches loaded", |s| s.ws.git_ui.window.refs.is_some());
    ide.settle();
    // A taller Git window, like the reference screenshot: drag the editor/Git border up.
    let top = ide.rect("Hide Git").min.y - 8.0;
    ide.drag(Pos2::new(700.0, top), Pos2::new(700.0, 200.0));
    ide.settle();
}

fn titles(ide: &Ide) -> Vec<String> {
    ide.state().ws.git_ui.window.tab_titles()
}

fn active_title(ide: &Ide) -> String {
    ide.state().ws.git_ui.window.active_title()
}

/// Clicks a context-menu entry (menus close on click; the label must be unique on screen).
fn menu(ide: &mut Ide, row: &str, item: &str) {
    ide.right_click(row);
    let item_owned = item.to_string();
    ide.wait_until("context menu", move |ide| ide.has(&item_owned));
    ide.click(item);
    ide.settle();
}

#[test]
fn tabs_plus_close_and_overflow() {
    let fx = Fixture::new(SUITE, "tabs");
    let repo = branchy_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_git(&mut ide);
    assert_eq!(titles(&ide), ["Log: HEAD"]);
    // The main Log tab has no close button.
    assert!(!ide.has("Close Log: HEAD"));

    ide.click("New Log tab");
    ide.settle();
    assert_eq!(titles(&ide), ["Log: HEAD", "Log: HEAD"]);
    assert_eq!(ide.state().ws.git_ui.window.active(), 1);
    // Each Log tab has its own branch filter.
    ide.click("Tree branch feature");
    ide.settle();
    assert_eq!(titles(&ide), ["Log: HEAD", "Log: feature"]);
    ide.click("Close Log: feature");
    ide.settle();
    assert_eq!(titles(&ide), ["Log: HEAD"]);
    assert_eq!(ide.state().ws.git_ui.window.active(), 0);

    // Many tabs do not fit: `⌄` appears and lists all of them.
    assert!(!ide.has("Show all tabs"));
    for _ in 0..12 {
        ide.click("New Log tab");
    }
    ide.settle();
    assert_eq!(titles(&ide).len(), 13);
    assert!(ide.has("Show all tabs"));
    ide.click("Show all tabs");
    ide.settle();
    assert_eq!(ide.rects("Switch to Log: HEAD").len(), 13);
    ide.snapshot("overflow_list");
    ide.click_nth("Switch to Log: HEAD", 0);
    ide.settle();
    assert_eq!(ide.state().ws.git_ui.window.active(), 0);
}

#[test]
fn branch_tree_folders_search_and_filter() {
    let fx = Fixture::new(SUITE, "tree");
    let repo = branchy_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_git(&mut ide);
    // Folders come from the prefix before `/`; folders sort before plain branches.
    for l in ["HEAD (Current Branch)", "Tree group Local", "Tree folder agent", "Tree branch agent/ostrov-assets-01", "Tree folder prototype", "Tree branch prototype/ostrov", "Tree branch main", "Tree group Remote", "Tree group Tags"] {
        assert!(ide.has(l), "missing {l}; {:?}", ide.labels());
    }
    assert!(ide.rect("Tree folder prototype").min.y < ide.rect("Tree branch NAPI---FLOCK").min.y);
    // Tags start collapsed.
    assert!(!ide.has("Tree tag v1.0"));
    ide.snapshot("window");

    // A click filters the tab's log by the branch; HEAD goes back to the current branch.
    ide.click("Tree branch prototype/ostrov");
    ide.settle();
    assert_eq!(active_title(&ide), "Log: prototype/ostrov");
    ide.click("HEAD (Current Branch)");
    ide.settle();
    assert_eq!(active_title(&ide), "Log: HEAD");

    // Keys: Down moves, Left on a branch goes to its folder, Left folds, Enter filters.
    ide.click("Tree branch agent/ostrov-assets-01");
    ide.settle();
    ide.key(Key::ArrowDown);
    ide.settle();
    assert!(ide.is_selected("Tree folder prototype"));
    ide.key(Key::ArrowLeft);
    ide.settle();
    assert!(!ide.has("Tree branch prototype/ostrov"), "Left folds the folder");
    ide.key(Key::ArrowRight);
    ide.key(Key::ArrowDown);
    ide.key(Key::Enter);
    ide.settle();
    assert_eq!(active_title(&ide), "Log: prototype/customGameEngine");

    // The search keeps matching branches and their folders.
    ide.click("Branch or tag");
    ide.type_text("unity");
    ide.settle();
    assert!(ide.has("Tree branch prototype/unity-self-learning"));
    assert!(ide.has("Tree folder prototype"));
    assert!(!ide.has("Tree branch agent/ostrov-assets-01"));
    assert!(!ide.has("Tree branch main"));
    ide.snapshot("search");
}

#[test]
fn ahead_behind_badges() {
    let fx = Fixture::new(SUITE, "badges");
    let (repo, bare) = repo_with_remote(&fx);
    push_from_other_clone(&fx, &bare, "README.md", "# changed elsewhere\n", "Remote work");
    repo.git(&["fetch", "-q"]);
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_git(&mut ide);
    assert!(ide.has("main: 1 to push"), "{:?}", ide.labels());
    assert!(ide.has("main: 1 to pull"));
    // Remote starts collapsed; a click on its chevron unfolds it.
    assert!(!ide.has("Tree remote branch origin/main"));
    let r = ide.rect("Tree group Remote");
    ide.click_at(Pos2::new(r.min.x + 10.0, r.center().y));
    ide.settle();
    assert!(ide.has("Tree folder origin"));
    assert!(ide.has("Tree remote branch origin/main"));
    ide.snapshot("badges");
}

/// Push from the tree's context menu pushes the clicked branch without a checkout.
#[test]
fn push_non_current_branch_from_tree() {
    let fx = Fixture::new(SUITE, "push_branch");
    let (repo, bare) = repo_with_remote(&fx);
    let remote_log = |b: &str| {
        let out = std::process::Command::new("git").args(["--git-dir", bare.to_str().expect("utf8"), "log", "--format=%s", b]).output().expect("git log");
        String::from_utf8_lossy(&out.stdout).lines().map(str::to_string).collect::<Vec<_>>()
    };
    repo.git(&["checkout", "-q", "-b", "release"]);
    repo.write("release.txt", "1\n");
    repo.commit_all("Release prep");
    repo.write("release.txt", "2\n");
    repo.commit_all("Release notes");
    repo.git(&["checkout", "-q", "main"]);
    // Tracked and level with its upstream: nothing to push.
    repo.git(&["branch", "-q", "--track", "synced", "origin/main"]);
    let head = repo.git(&["rev-parse", "HEAD"]);
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_git(&mut ide);

    ide.right_click("Tree branch synced");
    ide.wait_until("context menu", |ide| ide.has("Push..."));
    assert!(!ide.is_enabled("Push..."), "synced has nothing to push");
    ide.key(Key::Escape);
    ide.settle();

    menu(&mut ide, "Tree branch release", "Push...");
    ide.wait_for("push dialog", |s| s.ws.git_ui.remote.push_open() && !s.ws.git_ui.remote.push_commits().is_empty());
    ide.settle();
    assert_eq!(ide.state().ws.git_ui.remote.push_branch().as_deref(), Some("release"));
    // The list holds release's commits; main's unpushed commit is shared, so it is listed too.
    assert_eq!(ide.state().ws.git_ui.remote.push_commits(), ["Release notes", "Release prep", "Local work to push"]);
    ide.assert_text("release -> origin/release  (new)");
    assert!(ide.is_selected("Set upstream"));
    ide.snapshot("push_other_branch");
    click_last(&mut ide, "Push");
    ide.wait_for("pushed", |s| !s.ws.git_ui.remote.push_open());
    assert_eq!(remote_log("release")[..3], ["Release notes", "Release prep", "Local work to push"]);
    assert_eq!(repo.git(&["rev-parse", "--abbrev-ref", "release@{u}"]).trim(), "origin/release");
    assert_eq!(repo.branch(), "main");
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), head);
    // main stays unpushed; the command went through the Console.
    assert_eq!(remote_log("main")[0], "Initial commit");
    let entries = ide.state().ws.git_ui.window.console.entries();
    let push = entries.iter().find(|e| e.args.first().map(String::as_str) == Some("push")).expect("push logged");
    assert!(push.is_finished() && push.success(), "{push:?}");
    assert!(push.args.iter().any(|a| a == "refs/heads/release:refs/heads/release"), "{:?}", push.args);
}

#[test]
fn favourites_sort_first_and_persist() {
    let fx = Fixture::new(SUITE, "favourites");
    let repo = branchy_repo(&fx);
    let mut storage = MemoryStorage::default();
    let root = std::fs::canonicalize(&repo.dir).expect("canonical");
    {
        let mut ide = Ide::open(SUITE, &repo.dir);
        open_git(&mut ide);
        assert!(ide.rect("Tree branch NAPI---FLOCK").min.y > ide.rect("Tree folder prototype").min.y);
        menu(&mut ide, "Tree branch NAPI---FLOCK", "Add to Favorites");
        assert!(ide.state().ws.git_ui.window.is_favorite(&root, "NAPI---FLOCK", false));
        // A favourite moves to the top of its folder, above the folders.
        assert!(ide.rect("Tree branch NAPI---FLOCK").min.y < ide.rect("Tree folder agent").min.y);
        menu(&mut ide, "Tree branch prototype/ostrov", "Add to Favorites");
        assert!(ide.rect("Tree branch prototype/ostrov").min.y < ide.rect("Tree branch prototype/customGameEngine").min.y);
        ide.snapshot("favourites");
        eframe::App::save(ide.harness.state_mut(), &mut storage);
    }
    let saved = storage.map.get("git_favorite_branches").cloned().unwrap_or_default();
    assert!(saved.contains("refs/heads/NAPI---FLOCK"), "{saved}");
    assert!(!saved.contains(repo.dir.join(".git").to_str().expect("utf8")));

    // A new app reads them back from the same storage.
    let mut ide = Ide::with_options(SUITE, test_options(Some(&repo.dir)), Some(&storage));
    open_git(&mut ide);
    assert!(ide.state().ws.git_ui.window.is_favorite(&root, "NAPI---FLOCK", false));
    assert!(ide.rect("Tree branch NAPI---FLOCK").min.y < ide.rect("Tree folder agent").min.y);
    menu(&mut ide, "Tree branch NAPI---FLOCK", "Remove from Favorites");
    assert!(!ide.state().ws.git_ui.window.is_favorite(&root, "NAPI---FLOCK", false));
}

#[test]
fn checkout_from_menu_and_console_reopens() {
    let fx = Fixture::new(SUITE, "console");
    let repo = branchy_repo(&fx);
    // An unmerged branch: deleting it without force fails.
    repo.git(&["checkout", "-q", "-b", "wip"]);
    repo.write("wip.txt", "wip\n");
    repo.commit_all("Unmerged work");
    repo.git(&["checkout", "-q", "main"]);
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_git(&mut ide);
    assert!(!ide.state().ws.git_ui.window.has_console());

    // Checkout runs on a worker (`run_op`); the Console opens without taking the selection.
    menu(&mut ide, "Tree branch feature", "Checkout");
    ide.wait_for("checked out", |s| s.ws.git.branch.as_deref() == Some("feature"));
    ide.settle();
    assert_eq!(repo.branch(), "feature");
    assert!(titles(&ide).contains(&"Console".to_string()), "{:?}", titles(&ide));
    assert_eq!(ide.state().ws.git_ui.window.active(), 0);
    let entries = &ide.state().ws.git_ui.window.console.entries();
    let co = entries.iter().find(|e| e.args.first().map(String::as_str) == Some("checkout")).expect("checkout logged");
    assert!(co.is_finished() && co.success(), "{co:?}");

    ide.click("Git tab Console");
    ide.settle();
    assert!(ide.has("Command git checkout feature --"), "{:?}", ide.labels());
    // git prints "Switched to branch 'feature'" on stderr.
    ide.assert_text("Switched to branch 'feature'");
    ide.snapshot("console");

    // A failing command shows its error.
    ide.click("Git tab Log: HEAD");
    ide.settle();
    menu(&mut ide, "Tree branch wip", "Delete");
    click_last(&mut ide, "Delete");
    ide.wait_for("delete failed", |s| s.ws.git_ui.window.console.entries().iter().any(|e| e.args.first().map(String::as_str) == Some("branch") && e.is_finished()));
    ide.settle();
    assert!(repo.git(&["branch", "--list", "wip"]).contains("wip"));
    ide.click("Git tab Console");
    ide.settle();
    ide.assert_text("not fully merged");
    ide.snapshot("console_error");

    // Closed, the Console comes back with the next git operation, still in the background.
    ide.click("Git tab Console");
    ide.click("Close Console");
    ide.settle();
    assert!(!ide.state().ws.git_ui.window.has_console());
    ide.dismiss_toasts();
    menu(&mut ide, "Tree branch main", "Checkout");
    ide.wait_for("checked out main", |s| s.ws.git.branch.as_deref() == Some("main"));
    ide.settle();
    assert!(ide.state().ws.git_ui.window.has_console());
    assert_eq!(active_title(&ide), "Log: HEAD");
}

#[test]
fn compare_with_current_and_tag_menu() {
    let fx = Fixture::new(SUITE, "compare");
    let repo = branchy_repo(&fx);
    repo.git(&["checkout", "-q", "-b", "topic", "v1.0~1"]);
    repo.write("topic.txt", "topic\n");
    repo.commit_all("Topic work");
    repo.git(&["checkout", "-q", "main"]);
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_git(&mut ide);
    menu(&mut ide, "Tree branch topic", "Compare with Current");
    ide.wait_for("compare loaded", |s| s.ws.git_ui.window.compare_counts().is_some());
    ide.settle();
    assert_eq!(active_title(&ide), "Compare with topic");
    let (only_current, only_other) = ide.state().ws.git_ui.window.compare_counts().expect("counts");
    assert_eq!(only_other, 1);
    assert!(only_current >= 2, "{only_current}");
    ide.click("Commit Topic work");
    ide.wait_until("files", |ide| ide.has("Changed file topic.txt"));
    ide.snapshot("compare");

    // Show Diff with Working Tree lists the files; a click opens the branch-vs-disk diff.
    ide.click("Git tab Log: HEAD");
    ide.settle();
    menu(&mut ide, "Tree branch topic", "Show Diff with Working Tree");
    ide.wait_until("diff files", |ide| ide.has("Changed file topic.txt"));
    assert_eq!(active_title(&ide), "Diff with topic");
    ide.click("Changed file topic.txt");
    ide.wait_until("diff tab", |ide| ide.active_title().is_some_and(|t| t.contains("topic.txt")));
    ide.settle();

    // Tags: unfold the group, delete a tag from its menu.
    ide.click("Git tab Log: HEAD");
    ide.settle();
    let r = ide.rect("Tree group Tags");
    ide.click_at(Pos2::new(r.min.x + 10.0, r.center().y));
    ide.settle();
    menu(&mut ide, "Tree tag v1.0", "Delete");
    ide.wait_until("tag deleted", |ide| !ide.has("Tree tag v1.0"));
    assert!(repo.git(&["tag"]).trim().is_empty());
}

/// Clicks the last widget labelled `label` (a dialog button that shares its name).
fn click_last(ide: &mut Ide, label: &str) {
    ide.dismiss_toasts();
    let n = ide.rects(label).len();
    assert!(n > 0, "no widget labelled {label:?}; {:?}", ide.labels());
    ide.click_nth(label, n - 1);
}

fn console_args(ide: &Ide, cmd: &str) -> Vec<Vec<String>> {
    ide.state().ws.git_ui.window.console.entries().iter().filter(|e| e.args.first().map(String::as_str) == Some(cmd) && e.is_finished()).map(|e| e.args.clone()).collect()
}

fn notes(ide: &Ide) -> Vec<(String, String)> {
    ide.state().notifications.log().iter().map(|n| (n.title.clone(), n.body.clone())).collect()
}

/// The Log toolbar's Fetch button fetches every remote: the tree shows the new remote branch and
/// the incoming count, with no success toast. The Remote group and a remote's folder fetch too.
#[test]
fn fetch_from_toolbar_and_tree() {
    let fx = Fixture::new(SUITE, "fetch");
    let (repo, bare) = repo_with_remote(&fx);
    push_from_other_clone(&fx, &bare, "README.md", "# changed elsewhere\n", "Remote work");
    let other = fx.path("other");
    let git_other = |args: &[&str]| {
        let out = std::process::Command::new("git").args(args).current_dir(&other).output().expect("git");
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    };
    git_other(&["push", "-q", "origin", "HEAD:refs/heads/remote-feature"]);
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_git(&mut ide);
    assert!(!ide.has("main: 1 to pull"));
    ide.dismiss_toasts();
    ide.snapshot("log_toolbar");

    ide.click("Fetch All Remotes");
    ide.wait_for("fetched", |s| s.ws.git_ui.window.refs.as_ref().is_some_and(|r| r.branches.remote.iter().any(|b| b.name == "origin/remote-feature")));
    ide.settle();
    assert_eq!(console_args(&ide, "fetch"), [["fetch", "--all", "--prune"]]);
    assert!(ide.has("main: 1 to pull"), "{:?}", ide.labels());
    assert!(ide.state().notifications.toast_titles().is_empty(), "a fetch succeeds quietly: {:?}", notes(&ide));
    let r = ide.rect("Tree group Remote");
    ide.click_at(Pos2::new(r.min.x + 10.0, r.center().y));
    ide.settle();
    assert!(ide.has("Tree remote branch origin/remote-feature"));

    // The Remote group fetches every remote, a remote's folder only that remote.
    git_other(&["push", "-q", "origin", "HEAD:refs/heads/second"]);
    menu(&mut ide, "Tree group Remote", "Fetch");
    ide.wait_until("second", |ide| ide.has("Tree remote branch origin/second"));
    git_other(&["push", "-q", "origin", "HEAD:refs/heads/third"]);
    ide.right_click("Tree folder origin");
    ide.wait_until("context menu", |ide| ide.has("Fetch"));
    ide.snapshot_here("remote_menu");
    ide.click("Fetch");
    ide.wait_until("third", |ide| ide.has("Tree remote branch origin/third"));
    assert_eq!(console_args(&ide, "fetch")[2], ["fetch", "--prune", "origin"]);
    // A branch folder under a remote has no Fetch.
    ide.right_click("Tree remote branch origin/third");
    ide.wait_until("branch menu", |ide| ide.has("Checkout"));
    assert!(!ide.has("Fetch"));
    ide.key(Key::Escape);
    ide.settle();
    assert!(ide.state().notifications.toast_titles().is_empty(), "{:?}", notes(&ide));
}

/// Update on a branch that is not checked out fetches its upstream and fast-forwards it; HEAD,
/// the index and the worktree stay. A diverged branch is refused with a message. Update on the
/// current branch runs Update Project (pull).
#[test]
fn update_branches_from_tree() {
    let fx = Fixture::new(SUITE, "update");
    let (repo, bare) = repo_with_remote(&fx);
    repo.git(&["branch", "-q", "--track", "synced", "origin/main"]);
    repo.git(&["checkout", "-q", "-b", "diverged", "--track", "origin/main"]);
    repo.write("diverged.txt", "mine\n");
    repo.commit_all("Diverged work");
    repo.git(&["checkout", "-q", "main"]);
    repo.write("dirty.txt", "untracked\n");
    push_from_other_clone(&fx, &bare, "README.md", "# changed elsewhere\n", "Remote work");
    let rev = |r: &str| repo.git(&["rev-parse", r]).trim().to_string();
    let remote_main = std::process::Command::new("git").args(["--git-dir", bare.to_str().expect("utf8"), "rev-parse", "main"]).output().expect("rev-parse");
    let remote_main = String::from_utf8_lossy(&remote_main.stdout).trim().to_string();
    let head = rev("HEAD");
    let readme = repo.read("README.md");
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_git(&mut ide);

    // A branch without an upstream has no Update.
    repo.git(&["branch", "-q", "--no-track", "loose", "main"]);
    ide.state_mut().refresh_git();
    ide.wait_until("loose", |ide| ide.has("Tree branch loose"));
    ide.right_click("Tree branch loose");
    ide.wait_until("menu", |ide| ide.has("Checkout"));
    assert!(!ide.has("Update"));
    ide.key(Key::Escape);
    ide.settle();

    ide.right_click("Tree branch synced");
    ide.wait_until("menu", |ide| ide.has("Update"));
    ide.snapshot_here("branch_menu_update");
    ide.dismiss_toasts();
    ide.click("Update");
    ide.wait_until("synced updated", |_| rev("synced") == remote_main);
    ide.settle();
    assert_eq!(rev("HEAD"), head);
    assert_eq!(repo.branch(), "main");
    assert_eq!(repo.read("README.md"), readme);
    assert_eq!(repo.read("dirty.txt"), "untracked\n");
    assert_eq!(rev("origin/main"), remote_main);
    let fetch = console_args(&ide, "fetch");
    assert_eq!(fetch.last().map(|a| a.last().cloned()), Some(Some("refs/heads/main:refs/heads/synced".to_string())), "{fetch:?}");
    assert!(notes(&ide).iter().any(|(t, b)| t == "Update synced" && b.contains("fast-forwarded")), "{:?}", notes(&ide));
    assert!(!ide.has("synced: 1 to pull"));
    assert!(ide.has("main: 1 to pull"), "the fetch moved origin/main: {:?}", ide.labels());

    // The branches popup offers the same Update for a tracked branch; synced is up to date now.
    ide.dismiss_toasts();
    ide.key_mods(CTRL_SHIFT, Key::Backtick);
    ide.wait_until("branches popup", |ide| ide.has("Local branch synced"));
    ide.hover("Local branch synced");
    ide.wait_until("submenu", |ide| ide.has("New Branch from 'synced'..."));
    ide.click("Update");
    ide.wait_until("up to date", |ide| ide.state().notifications.log().iter().any(|n| n.title == "Update synced" && n.body == "synced is up to date"));
    ide.settle();
    assert_eq!(rev("synced"), remote_main);

    // A diverged branch is refused and stays where it was.
    let diverged = rev("diverged");
    ide.dismiss_toasts();
    menu(&mut ide, "Tree branch diverged", "Update");
    ide.wait_until("refused", |ide| ide.state().notifications.toast_titles().iter().any(|t| t == "Update diverged failed"));
    ide.settle();
    assert_eq!(rev("diverged"), diverged);
    let refused = notes(&ide).into_iter().find(|(t, _)| t == "Update diverged failed").expect("toast").1;
    assert!(refused.contains("diverged cannot be fast-forwarded to origin/main") && refused.contains("Check out diverged to merge or rebase"), "{refused}");
    ide.snapshot("update_refused");

    // The current branch runs the pull flow (merge, the default), not a ref update.
    ide.dismiss_toasts();
    menu(&mut ide, "Tree branch main", "Update");
    ide.wait_until("merged", |_| repo.subjects("HEAD").iter().any(|s| s == "Remote work"));
    ide.settle();
    assert_eq!(repo.branch(), "main");
    assert!(repo.subjects("HEAD").iter().any(|s| s == "Local work to push"));
    assert_eq!(repo.read("README.md"), "# changed elsewhere\n");
    assert_eq!(console_args(&ide, "pull").last().expect("pull logged"), &["pull", "--autostash", "--no-rebase"]);
}
