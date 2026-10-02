//! App shell: layout, project tree, tabs, search, Find in Files, status bar, tool windows,
//! layout persistence.

mod common;

use common::*;
use egui::Key;
use harwex_ide::layout::ToolWindow;
use ide_git::ChangeKind;

const SUITE: &str = "shell";

#[test]
fn layout_renders_with_git_colors() {
    let fx = Fixture::new(SUITE, "layout");
    let repo = changed_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    let root = ide.root();
    let status = &ide.state().git.status;
    assert_eq!(status.get(&root.join("src/app.ts")), Some(&ChangeKind::Modified));
    assert_eq!(status.get(&root.join("src/added.ts")), Some(&ChangeKind::Added));
    assert_eq!(status.get(&root.join("scratch.txt")), Some(&ChangeKind::Untracked));
    assert_eq!(status.get(&root.join("docs/notes.md")), Some(&ChangeKind::Deleted));
    assert!(ide.state().git.dirty_dirs.contains(&root.join("src")));
    ide.assert_text("Branch main");
    ide.snapshot("layout");

    // A click on a directory row expands it; its children load on a worker.
    ide.click("src");
    ide.wait_until("src children listed", |ide| ide.has("src/app.ts"));
    ide.click("src/core");
    ide.wait_until("core children listed", |ide| ide.has("src/core/deep"));
    assert!(ide.has("src/added.ts") && ide.has("src/util.ts"));
    ide.snapshot("tree_expanded");

    // A second click collapses it again.
    ide.click("src");
    ide.wait_until("src collapsed", |ide| !ide.has("src/app.ts"));
}

#[test]
fn tabs_open_and_close() {
    let fx = Fixture::new(SUITE, "tabs");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.click("src");
    ide.wait_until("src listed", |ide| ide.has("src/app.ts"));

    // Double-click opens a file from the tree.
    ide.double_click("src/app.ts");
    ide.wait_for("app.ts tab", |s| s.tabs.list.len() == 1);
    ide.double_click("src/util.ts");
    ide.wait_for("util.ts tab", |s| s.tabs.list.len() == 2);
    ide.double_click("README.md");
    ide.wait_for("README tab", |s| s.tabs.list.len() == 3);
    ide.settle();
    assert_eq!(ide.tab_titles(), ["app.ts", "util.ts", "README.md"]);
    assert_eq!(ide.active_title().as_deref(), Some("README.md"));
    assert!(ide.is_selected("Tab README.md"));
    ide.snapshot("three_tabs");

    // A click on a tab activates it.
    ide.click("Tab app.ts");
    assert_eq!(ide.active_title().as_deref(), Some("app.ts"));

    // Cmd+W closes the active tab; the most recently used one becomes active.
    ide.cmd(Key::W);
    ide.settle();
    assert_eq!(ide.tab_titles(), ["util.ts", "README.md"]);
    assert_eq!(ide.active_title().as_deref(), Some("README.md"));

    // Middle click closes the tab under the pointer, not the active one.
    let util = ide.rect("Tab util.ts").center();
    ide.middle_click_at(util);
    ide.settle();
    assert_eq!(ide.tab_titles(), ["README.md"]);

    // The "x" on the active tab closes it too.
    let r = ide.rect("Tab README.md");
    ide.click_at(egui::pos2(r.max.x - 14.0, r.center().y));
    ide.settle();
    assert!(ide.tab_titles().is_empty());
    ide.snapshot("no_tabs");
}

#[test]
fn dirty_dot_save_and_close_prompt() {
    let fx = Fixture::new(SUITE, "dirty");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/util.ts");
    // Typing goes to the focused editor at the caret (start of the file).
    ide.type_text("// edited\n");
    ide.settle();
    assert!(ide.state().tabs.active_tab().is_some_and(|t| t.is_dirty()));
    assert!(ide.active_text().starts_with("// edited\nexport function add"));
    ide.snapshot("dirty_tab");

    // Cmd+S writes on a worker and clears the dot.
    ide.cmd(Key::S);
    ide.wait_for("saved", |s| s.tabs.active_tab().is_some_and(|t| !t.is_dirty()));
    assert!(repo.read("src/util.ts").starts_with("// edited\n"));

    // Closing a dirty tab asks first. "Don't Save" closes it and keeps the disk file.
    ide.type_text("x");
    ide.cmd(Key::W);
    ide.settle();
    assert!(ide.state().confirm_close.is_some());
    ide.assert_text("Save changes to util.ts?");
    ide.snapshot("close_prompt");
    ide.click("Cancel");
    ide.settle();
    assert_eq!(ide.tab_titles(), ["util.ts"]);
    ide.cmd(Key::W);
    ide.settle();
    ide.click("Don't Save");
    ide.settle();
    assert!(ide.tab_titles().is_empty());
    assert!(repo.read("src/util.ts").starts_with("// edited\nexport"));
}

#[test]
fn search_everywhere_with_double_shift() {
    let fx = Fixture::new(SUITE, "search_shift");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.double_shift();
    ide.settle();
    assert!(ide.state().search.open, "Shift Shift opens Search Everywhere");
    ide.type_text("util");
    ide.wait_for("results", |s| !s.search.results().is_empty());
    ide.settle();
    assert_eq!(ide.state().search.results()[0].path, "src/util.ts");
    ide.snapshot("search_util");
    ide.key(Key::Enter);
    ide.wait_for("util.ts opened", |s| s.tabs.active_editor().is_some_and(|e| e.path.ends_with("src/util.ts")));
    assert!(!ide.state().search.open);

    // Escape closes the popup without opening anything.
    ide.double_shift();
    ide.settle();
    assert!(ide.state().search.open);
    ide.key(Key::Escape);
    ide.settle();
    assert!(!ide.state().search.open);
    assert_eq!(ide.tab_titles(), ["util.ts"]);
}

#[test]
fn search_everywhere_ranking_with_cmd_shift_o() {
    let fx = Fixture::new(SUITE, "search_rank");
    let repo = basic_repo(fx.path("repo"));
    // Decoys: deeper paths, and names that match the query only with gaps.
    repo.write("vendor/apptest/src/apptools.ts", "x\n");
    repo.write("packages/a/p/p/t/s.ts", "x\n");
    repo.write("docs/app-tips.md", "x\n");
    repo.commit_all("Decoys");
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.cmd_shift(Key::O);
    ide.settle();
    assert!(ide.state().search.open, "Cmd+Shift+O opens Search Everywhere");
    ide.type_text("appts");
    ide.wait_for("results", |s| s.search.results().len() >= 3);
    ide.settle();
    let paths: Vec<String> = ide.state().search.results().iter().map(|h| h.path.clone()).collect();
    assert_eq!(paths[0], "src/app.ts", "the exact file name wins: {paths:?}");
    let pos = |p: &str| paths.iter().position(|x| x == p).unwrap_or(usize::MAX);
    assert!(pos("src/app.ts") < pos("packages/a/p/p/t/s.ts"), "{paths:?}");
    ide.snapshot("search_ranking");

    // Arrow keys move the selection; Enter opens the selected file.
    ide.key(Key::ArrowDown);
    assert_eq!(ide.state().search.selected(), 1);
    let second = paths[1].clone();
    ide.key(Key::Enter);
    ide.wait_for("second hit opened", |s| s.tabs.active_editor().is_some_and(|e| e.path.ends_with(&second)));
}

#[test]
fn find_in_files() {
    let fx = Fixture::new(SUITE, "find");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.cmd_shift(Key::F);
    ide.settle();
    assert!(ide.state().find.dialog_open);
    ide.type_text("add");
    ide.snapshot("find_dialog");
    ide.key(Key::Enter);
    ide.wait_for("search finished", |s| !s.find.searching && !s.find.searched_for.is_empty());
    ide.settle();
    assert_eq!(ide.state().layout.left, Some(ToolWindow::Find));
    // `add` appears in app.ts twice (import, call) and in util.ts once.
    assert_eq!(ide.state().find.hit_count(), 3);
    assert_eq!(ide.state().find.results.len(), 2);
    ide.assert_text("\"add\": 3 matches in 2 files");
    ide.snapshot("find_results");

    // A click on a hit opens the file at the match.
    ide.click_containing("const x = add(1, 2);");
    ide.wait_for("app.ts opened", |s| s.tabs.active_editor().is_some_and(|e| e.path.ends_with("src/app.ts")));
    ide.settle();
    let c = ide.state().tabs.active_editor().map(|e| e.view.cursor()).expect("editor");
    assert_eq!((c.line, c.column), (3, 12));
}

#[test]
fn status_bar_shows_caret_language_and_branch() {
    let fx = Fixture::new(SUITE, "status");
    let repo = basic_repo(fx.path("repo"));
    repo.git(&["checkout", "-q", "-b", "topic"]);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/app.ts");
    // A click in the text moves the caret; the status bar follows (1-based).
    let p = ide.caret_pos(3, 8);
    ide.click_at(p);
    ide.settle();
    let c = ide.state().tabs.active_editor().map(|e| e.view.cursor()).expect("editor");
    assert_eq!((c.line, c.column), (3, 8));
    ide.assert_text("4:9");
    ide.assert_text("TypeScript");
    ide.assert_text("topic");
    ide.snapshot("status_bar");
}

#[test]
fn tool_window_toggles() {
    let fx = Fixture::new(SUITE, "toggles");
    let repo = changed_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    assert_eq!(ide.state().layout.left, Some(ToolWindow::Project));
    ide.click("Commit tool window");
    ide.settle();
    assert_eq!(ide.state().layout.left, Some(ToolWindow::Commit));
    assert!(ide.is_selected("Commit tool window"));
    ide.click("Notifications tool window");
    ide.settle();
    assert_eq!(ide.state().layout.bottom, Some(ToolWindow::Notifications));
    ide.snapshot("commit_and_notifications");

    // Clicking the active strip button hides the window.
    ide.click("Commit tool window");
    ide.settle();
    assert_eq!(ide.state().layout.left, None);
    // The header's hide button hides the bottom window.
    ide.click("Hide Notifications");
    ide.settle();
    assert_eq!(ide.state().layout.bottom, None);
    ide.snapshot("all_hidden");

    // The title bar's Commit button opens the Commit window.
    ide.click("Commit");
    ide.settle();
    assert_eq!(ide.state().layout.left, Some(ToolWindow::Commit));
}

#[test]
fn layout_persists_through_storage() {
    let fx = Fixture::new(SUITE, "persist");
    let repo = basic_repo(fx.path("repo"));
    let mut storage = MemoryStorage::default();
    {
        let mut ide = Ide::open(SUITE, &repo.dir);
        ide.click("Find tool window");
        ide.click("Git tool window");
        ide.settle();
        eframe::App::save(ide.harness.state_mut(), &mut storage);
    }
    assert_eq!(storage.map.get("tool_windows").map(String::as_str), Some("left=Find;bottom=Git"));
    let root = std::fs::canonicalize(&repo.dir).expect("canonical");
    assert_eq!(storage.map.get("last_folder").map(String::as_str), root.to_str());

    // A new app restores the layout and reopens the last folder from the same storage.
    let options = harwex_ide::AppOptions { project: None, restore_last_folder: true, ..test_options(None) };
    let mut ide = Ide::with_options(SUITE, options, Some(&storage));
    ide.wait_for("last folder reopened", |s| s.project.as_ref().is_some_and(|p| p.root == root) && s.git.status_ms.is_some());
    ide.settle();
    assert_eq!(ide.state().layout.left, Some(ToolWindow::Find));
    assert_eq!(ide.state().layout.bottom, Some(ToolWindow::Git));
    ide.snapshot("restored_layout");
}

/// Islands Dark: the empty editor shows IDEA's hint list, and Cmd+E (one of the hints) opens
/// Recent Files with the previous file preselected.
#[test]
fn empty_editor_hints_and_recent_files() {
    let fx = Fixture::new(SUITE, "empty_editor");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    assert!(ide.has("Empty editor"));
    assert!(ide.state().tabs.list.is_empty());
    ide.snapshot("empty_editor");

    ide.open_file("src/util.ts");
    ide.open_file("src/app.ts");
    ide.cmd(Key::E);
    ide.settle();
    assert!(ide.state().search.open && ide.state().search.recent_mode);
    let hits: Vec<String> = ide.state().search.results().iter().map(|h| h.path.clone()).collect();
    assert_eq!(hits, ["src/app.ts", "src/util.ts"]);
    assert_eq!(ide.state().search.selected(), 1, "the previous file is preselected");
    ide.assert_text("Recent Files");
    ide.snapshot("recent_files");
    ide.key(Key::Enter);
    ide.settle();
    assert_eq!(ide.active_title().as_deref(), Some("util.ts"));
    assert!(!ide.state().search.open);
}

/// The title bar: project badge and name, the branch widget, and the icon buttons on the right.
#[test]
fn title_bar_widgets() {
    let fx = Fixture::new(SUITE, "title_bar");
    let repo = changed_repo(fx.path("harwex-mono"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    for label in ["Project harwex-mono", "Branch main", "Update", "Commit", "Push", "Search", "Settings"] {
        assert!(ide.has(label), "title bar has {label:?}; {:?}", ide.labels());
    }
    assert_eq!(harwex_ide::app::initials("harwex-mono"), "HM");
    let title_h = harwex_ide::theme::T.space.title_h;
    for label in ["Project harwex-mono", "Branch main", "Push", "Settings"] {
        let r = ide.rect(label);
        assert!(r.min.y >= 0.0 && r.max.y <= title_h, "{label} sits inside the title bar: {r:?}");
    }
    // The widgets read left to right: badge and project, branch; icon buttons at the right edge.
    assert!(ide.rect("Project harwex-mono").max.x <= ide.rect("Branch main").min.x);
    assert!(ide.rect("Update").max.x <= ide.rect("Commit").min.x && ide.rect("Commit").max.x <= ide.rect("Push").min.x);
    assert!(ide.rect("Search").max.x <= ide.rect("Settings").min.x);
    ide.hover("Branch main");
    ide.snapshot_here("title_bar");

    // Settings opens a menu; the Search button opens Search Everywhere.
    ide.click("Settings");
    ide.settle();
    ide.assert_text("Open Folder...");
    ide.key(Key::Escape);
    ide.click("Search");
    ide.settle();
    assert!(ide.state().search.open && !ide.state().search.recent_mode);
}

/// The tool window strips: icons only, the open windows highlighted, tooltips with the titles.
#[test]
fn tool_strips() {
    let fx = Fixture::new(SUITE, "strips");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    let strip_w = harwex_ide::theme::T.space.strip_w;
    let left = ["Project", "Commit", "Find", "Git", "Find Usages", "Terminal"];
    for title in left {
        let r = ide.rect(&format!("{title} tool window"));
        assert!(r.max.x <= strip_w, "{title} is on the left strip: {r:?}");
    }
    let n = ide.rect("Notifications tool window");
    assert!(n.min.x >= 1280.0 - strip_w, "Notifications is on the right strip: {n:?}");
    // The upper group opens left windows, the lower group bottom windows.
    assert!(ide.rect("Find tool window").max.y < ide.rect("Git tool window").min.y - 200.0);
    ide.click("Terminal tool window");
    ide.wait_until("terminal open", |ide| ide.state().layout.bottom == Some(ToolWindow::Terminal) && ide.state().terminals.len() == 1);
    ide.settle();
    assert!(ide.is_selected("Project tool window") && ide.is_selected("Terminal tool window"));
    assert!(!ide.is_selected("Commit tool window"));
    ide.hover("Find Usages tool window");
    ide.wait_real(std::time::Duration::from_millis(400));
    ide.assert_text("Find Usages  ⌥F7");
    ide.snapshot_here("tool_strips");
}
