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
    let status = &ide.state().ws.git.status;
    assert_eq!(status.get(&root.join("src/app.ts")), Some(&ChangeKind::Modified));
    assert_eq!(status.get(&root.join("src/added.ts")), Some(&ChangeKind::Added));
    assert_eq!(status.get(&root.join("scratch.txt")), Some(&ChangeKind::Untracked));
    assert_eq!(status.get(&root.join("docs/notes.md")), Some(&ChangeKind::Deleted));
    assert!(ide.state().ws.git.dirty_dirs.contains(&root.join("src")));
    ide.assert_text("Branch main");
    ide.snapshot("layout");

    // Like IDEA, a click on a folder row selects it and does not expand it.
    ide.click("src");
    assert!(ide.is_selected("src"));
    assert!(!ide.has("src/app.ts"), "a single click does not expand");
    // A double click expands it; its children load on a worker.
    ide.double_click("src");
    ide.wait_until("src children listed", |ide| ide.has("src/app.ts"));
    // A click on the chevron toggles at once.
    ide.click("Expand src/core");
    ide.wait_until("core children listed", |ide| ide.has("src/core/deep"));
    assert!(ide.has("Collapse src/core") && ide.has("Expand src/core/deep"));
    assert!(ide.has("src/added.ts") && ide.has("src/util.ts"));
    // Files have no chevron.
    assert!(!ide.has("Expand src/util.ts"));
    ide.snapshot("tree_chevrons");

    // A second double click collapses it again.
    ide.double_click("src");
    ide.wait_until("src collapsed", |ide| !ide.has("src/app.ts"));
}

/// A real user's double click often follows other clicks: a click that selected the row, or a
/// double click a moment ago. egui calls a click "triple" up to twice the double-click interval
/// after the click before last (1 s with the macOS default), and it ignores where a click lands.
/// The tree counts its own click chain, so these double clicks toggle and single clicks do not.
#[test]
fn double_click_follows_other_clicks() {
    let fx = Fixture::new(SUITE, "double_click_chain");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    let delay = ide.ctx().options(|o| o.input_options.max_double_click_delay);
    assert_eq!(delay, harwex_ide::chrome::DEFAULT_DOUBLE_CLICK_INTERVAL, "tests run with the macOS default interval");
    let src = ide.root().join("src");
    let c = ide.rect("src").center();

    // Click to select, then double click 0.6 s later.
    ide.click_at(c);
    ide.idle(0.6);
    ide.double_click_now(c);
    assert!(ide.state().ws.tree.is_expanded(&src), "a double click after a selecting click expands");

    // Collapse again 0.6 s after the first double click.
    ide.idle(0.6);
    ide.double_click_now(c);
    assert!(!ide.state().ws.tree.is_expanded(&src), "a second double click collapses");

    // A quick click on another row is a new single click, not the second click of a double.
    let readme = ide.rect("README.md").center();
    ide.idle(1.5);
    ide.click_now(c);
    ide.idle(0.1);
    ide.click_now(readme);
    assert!(ide.state().ws.tabs.list.is_empty(), "a single click on a file opens nothing");
    assert!(!ide.state().ws.tree.is_expanded(&src));

    // A third quick click on the chevron toggles again; the second one only ends the double click.
    let chevron = ide.rect("Expand src").center();
    ide.idle(1.5);
    ide.click_now(chevron);
    assert!(ide.state().ws.tree.is_expanded(&src), "a chevron click toggles at once");
}

/// A fast double click as a late UI thread sees it: several button events in one frame, frames
/// 8 to 30 ms apart, a small move between the presses. Each double click toggles the folder
/// exactly once. The second double click fired twice when the first release and the second
/// press shared a frame, so the folder toggled back (task 021).
#[test]
fn fast_double_clicks_toggle_once() {
    let fx = Fixture::new(SUITE, "fast_double_click");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    let src = ide.root().join("src");
    let c = ide.rect("src").center();
    let near = c + egui::vec2(4.0, 2.0);
    let (down, up) = (|p| (p, true), |p| (p, false));
    type Frames = Vec<(f64, Vec<(egui::Pos2, bool)>)>;
    let mut cases: Vec<(String, Frames)> = vec![
        ("all four events in one frame".into(), vec![(0.016, vec![down(c), up(c), down(c), up(c)])]),
        ("release 1 and press 2 in one frame".into(), vec![(0.016, vec![down(c)]), (0.09, vec![up(c), down(c)]), (0.08, vec![up(c)])]),
        ("press 2 in the frame of click 1".into(), vec![(0.016, vec![down(c), up(c), down(c)]), (0.08, vec![up(c)])]),
        ("click 2 in the frame of release 1".into(), vec![(0.016, vec![down(c)]), (0.08, vec![up(c), down(c), up(c)])]),
        ("a 4 pt move between the presses".into(), vec![(0.016, vec![down(c)]), (0.08, vec![up(c)]), (0.1, vec![down(near)]), (0.08, vec![up(near)])]),
    ];
    for gap in [0.008, 0.016, 0.030] {
        cases.push((format!("one event per frame, {gap} s apart"), vec![(gap, vec![down(c)]), (gap, vec![up(c)]), (gap, vec![down(c)]), (gap, vec![up(c)])]));
        cases.push((format!("one click per frame, {gap} s apart"), vec![(gap, vec![down(c), up(c)]), (gap, vec![down(c), up(c)])]));
    }
    ide.move_to(c);
    let mut failed = Vec::new();
    for (name, frames) in cases {
        let before = ide.state().ws.tree.is_expanded(&src);
        // Each case is a fresh chain: no click in the double-click interval before it.
        ide.idle(1.5);
        for (dt, buttons) in &frames {
            ide.pointer_frame(*dt, buttons);
        }
        ide.steps(3);
        if ide.state().ws.tree.is_expanded(&src) == before {
            failed.push(format!("{name}: the double click toggles the folder once"));
            continue;
        }
        // A second double click right after the first one toggles back, again exactly once.
        ide.idle(0.6);
        for (dt, buttons) in &frames {
            ide.pointer_frame(*dt, buttons);
        }
        ide.steps(3);
        if ide.state().ws.tree.is_expanded(&src) != before {
            failed.push(format!("{name}: a second double click 0.6 s later toggles it back"));
        }
    }
    assert!(failed.is_empty(), "{}", failed.join("\n"));
}

/// A double click on the empty title bar zooms the window (the action is fixed to Zoom in
/// tests), also right after a single click and twice in a row 0.6 s apart.
#[test]
fn title_bar_double_click_zooms() {
    let fx = Fixture::new(SUITE, "title_double_click");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    let zooms = |ide: &mut Ide| ide.take_viewport_commands().into_iter().filter(|c| matches!(c, egui::ViewportCommand::Maximized(_))).count();
    let screen = ide.ctx().screen_rect();
    let bar = egui::pos2(screen.right() - 120.0, 20.0);

    ide.click_at(bar);
    assert_eq!(zooms(&mut ide), 0, "a single click does not zoom");
    ide.idle(0.6);
    ide.double_click_now(bar);
    assert_eq!(zooms(&mut ide), 1, "a double click after a single click zooms");
    ide.idle(0.6);
    ide.double_click_now(bar);
    assert_eq!(zooms(&mut ide), 1, "a second double click 0.6 s later zooms again");
    // A late frame with the first release and the second press zooms once, not twice.
    ide.idle(0.6);
    ide.pointer_frame(0.016, &[(bar, true)]);
    ide.pointer_frame(0.09, &[(bar, false), (bar, true)]);
    ide.pointer_frame(0.08, &[(bar, false)]);
    ide.steps(2);
    assert_eq!(zooms(&mut ide), 1, "a double click with merged frames zooms once");
}

#[test]
fn tabs_open_and_close() {
    let fx = Fixture::new(SUITE, "tabs");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.double_click("src");
    ide.wait_until("src listed", |ide| ide.has("src/app.ts"));

    // Double-click opens a file from the tree.
    ide.double_click("src/app.ts");
    ide.wait_for("app.ts tab", |s| s.ws.tabs.list.len() == 1);
    ide.double_click("src/util.ts");
    ide.wait_for("util.ts tab", |s| s.ws.tabs.list.len() == 2);
    ide.double_click("README.md");
    ide.wait_for("README tab", |s| s.ws.tabs.list.len() == 3);
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
    assert!(ide.state().ws.tabs.active_tab().is_some_and(|t| t.is_dirty()));
    assert!(ide.active_text().starts_with("// edited\nexport function add"));
    ide.snapshot("dirty_tab");

    // Cmd+S writes on a worker and clears the dot.
    ide.cmd(Key::S);
    ide.wait_for("saved", |s| s.ws.tabs.active_tab().is_some_and(|t| !t.is_dirty()));
    assert!(repo.read("src/util.ts").starts_with("// edited\n"));

    // Closing a dirty tab asks first. "Don't Save" closes it and keeps the disk file.
    ide.type_text("x");
    ide.cmd(Key::W);
    ide.settle();
    assert!(ide.state().ws.confirm_close.is_some());
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
    assert!(ide.state().ws.search.open, "Shift Shift opens Search Everywhere");
    ide.type_text("util");
    ide.wait_for("results", |s| !s.ws.search.results().is_empty());
    ide.settle();
    assert_eq!(ide.state().ws.search.results()[0].path, "src/util.ts");
    ide.snapshot("search_util");
    ide.key(Key::Enter);
    ide.wait_for("util.ts opened", |s| s.ws.tabs.active_editor().is_some_and(|e| e.path.ends_with("src/util.ts")));
    assert!(!ide.state().ws.search.open);

    // Escape closes the popup without opening anything.
    ide.double_shift();
    ide.settle();
    assert!(ide.state().ws.search.open);
    ide.key(Key::Escape);
    ide.settle();
    assert!(!ide.state().ws.search.open);
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
    assert!(ide.state().ws.search.open, "Cmd+Shift+O opens Search Everywhere");
    ide.type_text("appts");
    ide.wait_for("results", |s| s.ws.search.results().len() >= 3);
    ide.settle();
    let paths: Vec<String> = ide.state().ws.search.results().iter().map(|h| h.path.clone()).collect();
    assert_eq!(paths[0], "src/app.ts", "the exact file name wins: {paths:?}");
    let pos = |p: &str| paths.iter().position(|x| x == p).unwrap_or(usize::MAX);
    assert!(pos("src/app.ts") < pos("packages/a/p/p/t/s.ts"), "{paths:?}");
    ide.snapshot("search_ranking");

    // Arrow keys move the selection; Enter opens the selected file.
    ide.key(Key::ArrowDown);
    assert_eq!(ide.state().ws.search.selected(), 1);
    let second = paths[1].clone();
    ide.key(Key::Enter);
    ide.wait_for("second hit opened", |s| s.ws.tabs.active_editor().is_some_and(|e| e.path.ends_with(&second)));
}

#[test]
fn find_in_files() {
    let fx = Fixture::new(SUITE, "find");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.cmd_shift(Key::F);
    ide.settle();
    assert!(ide.state().ws.find.dialog_open);
    ide.type_text("add");
    ide.snapshot("find_dialog");
    ide.key(Key::Enter);
    ide.wait_for("search finished", |s| !s.ws.find.searching && !s.ws.find.searched_for.is_empty());
    ide.settle();
    assert_eq!(ide.state().ws.layout.left, Some(ToolWindow::Find));
    // `add` appears in app.ts twice (import, call) and in util.ts once.
    assert_eq!(ide.state().ws.find.hit_count(), 3);
    assert_eq!(ide.state().ws.find.results.len(), 2);
    ide.assert_text("\"add\": 3 matches in 2 files");
    ide.snapshot("find_results");

    // A click on a hit opens the file at the match.
    ide.click_containing("const x = add(1, 2);");
    ide.wait_for("app.ts opened", |s| s.ws.tabs.active_editor().is_some_and(|e| e.path.ends_with("src/app.ts")));
    ide.settle();
    let c = ide.state().ws.tabs.active_editor().map(|e| e.view.cursor()).expect("editor");
    assert_eq!((c.line, c.column), (3, 12));
}

/// The status bar holds the breadcrumbs on the left, the language and the memory indicator on
/// the right. It shows no caret position and no branch; the branch lives in the title bar.
#[test]
fn status_bar_shows_language_without_caret_or_branch() {
    let fx = Fixture::new(SUITE, "status");
    let repo = basic_repo(fx.path("repo"));
    repo.git(&["checkout", "-q", "-b", "topic"]);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/app.ts");
    let p = ide.caret_pos(3, 8);
    ide.click_at(p);
    ide.settle();
    let c = ide.state().ws.tabs.active_editor().map(|e| e.view.cursor()).expect("editor");
    assert_eq!((c.line, c.column), (3, 8));
    ide.assert_no_text("4:9");
    ide.assert_text("TypeScript");
    assert!(!ide.has("topic"), "no branch label in the status bar");
    let branch = ide.rect("Branch topic");
    assert!(branch.max.y < 100.0, "the branch stays in the title bar: {branch:?}");
    let crumb = ide.rect("Breadcrumb app.ts");
    assert!(crumb.min.y > SIZE.y - harwex_ide::theme::T.space.status_h - 2.0, "the breadcrumbs stay in the status bar: {crumb:?}");
    ide.snapshot("status_bar");
}

#[test]
fn tool_window_toggles() {
    let fx = Fixture::new(SUITE, "toggles");
    let repo = changed_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    assert_eq!(ide.state().ws.layout.left, Some(ToolWindow::Project));
    ide.click("Commit tool window");
    ide.settle();
    assert_eq!(ide.state().ws.layout.left, Some(ToolWindow::Commit));
    assert!(ide.is_selected("Commit tool window"));
    ide.click("Notifications tool window");
    ide.settle();
    assert_eq!(ide.state().ws.layout.bottom, Some(ToolWindow::Notifications));
    ide.snapshot("commit_and_notifications");

    // Clicking the active strip button hides the window.
    ide.click("Commit tool window");
    ide.settle();
    assert_eq!(ide.state().ws.layout.left, None);
    // The header's hide button hides the bottom window.
    ide.click("Hide Notifications");
    ide.settle();
    assert_eq!(ide.state().ws.layout.bottom, None);
    ide.snapshot("all_hidden");

    // Cmd+K opens the Commit window.
    ide.cmd(Key::K);
    ide.settle();
    assert_eq!(ide.state().ws.layout.left, Some(ToolWindow::Commit));
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
    ide.wait_for("last folder reopened", |s| s.ws.project.as_ref().is_some_and(|p| p.root == root) && s.ws.git.status_ms.is_some());
    ide.settle();
    assert_eq!(ide.state().ws.layout.left, Some(ToolWindow::Find));
    assert_eq!(ide.state().ws.layout.bottom, Some(ToolWindow::Git));
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
    assert!(ide.state().ws.tabs.list.is_empty());
    ide.snapshot("empty_editor");

    ide.open_file("src/util.ts");
    ide.open_file("src/app.ts");
    ide.cmd(Key::E);
    ide.settle();
    assert!(ide.state().ws.search.open && ide.state().ws.search.recent_mode);
    let hits: Vec<String> = ide.state().ws.search.results().iter().map(|h| h.path.clone()).collect();
    assert_eq!(hits, ["src/app.ts", "src/util.ts"]);
    assert_eq!(ide.state().ws.search.selected(), 1, "the previous file is preselected");
    ide.assert_text("Recent Files");
    ide.snapshot("recent_files");
    ide.key(Key::Enter);
    ide.settle();
    assert_eq!(ide.active_title().as_deref(), Some("util.ts"));
    assert!(!ide.state().ws.search.open);
}

/// The title bar: project badge and name, Settings, then the current branch. The branch is
/// display-only; Ctrl+Shift+` opens the branches popup.
#[test]
fn title_bar_widgets() {
    let fx = Fixture::new(SUITE, "title_bar");
    let repo = changed_repo(fx.path("harwex-mono"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    for label in ["Project harwex-mono", "Settings", "Branch main"] {
        assert!(ide.has(label), "title bar has {label:?}; {:?}", ide.labels());
    }
    // Update, Commit, Push and Search Everywhere live on their shortcuts only.
    for label in ["Update", "Commit", "Push", "Search"] {
        assert!(!ide.has(label), "the title bar has no {label:?} button");
    }
    assert_eq!(harwex_ide::app::initials("harwex-mono"), "HM");
    let title_h = harwex_ide::theme::T.space.title_h;
    for label in ["Project harwex-mono", "Settings", "Branch main"] {
        let r = ide.rect(label);
        assert!(r.min.y >= 0.0 && r.max.y <= title_h, "{label} sits inside the title bar: {r:?}");
    }
    // Left to right: badge and project, Settings, branch.
    assert!(ide.rect("Project harwex-mono").max.x <= ide.rect("Settings").min.x);
    assert!(ide.rect("Settings").max.x <= ide.rect("Branch main").min.x);
    assert!(ide.rect("Branch main").max.x < 640.0, "the whole group sits on the left");
    ide.snapshot("title_bar");

    // A click on the branch does nothing.
    ide.click("Branch main");
    ide.settle();
    assert!(!ide.state().ws.git_ui.branches.is_open());
    // Ctrl+Shift+` opens the branches popup below the branch, and closes it again.
    ide.key_mods(CTRL_SHIFT, Key::Backtick);
    ide.wait_until("branches popup", |ide| ide.state().ws.git_ui.branches.is_open() && ide.has("Fetch"));
    ide.key_mods(CTRL_SHIFT, Key::Backtick);
    ide.settle();
    assert!(!ide.state().ws.git_ui.branches.is_open());

    // Settings opens a menu.
    ide.click("Settings");
    ide.settle();
    ide.assert_text("Open Folder...");
    ide.key(Key::Escape);
    ide.settle();

    // The shortcuts of the removed buttons still work.
    ide.double_shift();
    ide.settle();
    assert!(ide.state().ws.search.open && !ide.state().ws.search.recent_mode);
    ide.key(Key::Escape);
    ide.settle();
    ide.cmd(Key::K);
    ide.settle();
    assert_eq!(ide.state().ws.layout.left, Some(ToolWindow::Commit));
}

fn tree_focused(ide: &Ide) -> bool {
    harwex_ide::tree::has_focus(&ide.ctx())
}

/// The selected tree row is blue while the tree has keyboard focus and grey once the focus
/// moves to the editor. A hovered row that is not selected gets only a faint fill.
#[test]
fn tree_selection_follows_focus() {
    let fx = Fixture::new(SUITE, "tree_selection");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    assert!(!tree_focused(&ide));
    ide.double_click("src");
    ide.wait_until("src listed", |ide| ide.has("src/util.ts"));
    ide.click("src/util.ts");
    assert!(tree_focused(&ide) && ide.is_selected("src/util.ts"));
    ide.hover("docs");
    ide.snapshot_here("tree_selection_focused");

    // A double click opens the file; the editor takes the focus and the row turns grey.
    ide.double_click("src/util.ts");
    ide.wait_for("util.ts tab", |s| s.ws.tabs.active_editor().is_some());
    ide.settle();
    assert!(ide.is_focused("Editor util.ts") && !tree_focused(&ide));
    assert!(ide.is_selected("src/util.ts"));
    ide.snapshot("tree_selection_unfocused");

    // A click on a row brings the focus back to the tree.
    ide.click("src/app.ts");
    assert!(tree_focused(&ide) && ide.is_selected("src/app.ts"));
    // Escape hands the focus back to the editor.
    ide.key(Key::Escape);
    ide.settle();
    assert!(ide.is_focused("Editor util.ts") && !tree_focused(&ide));
}

/// The keyboard in the tree, like IDEA: Up and Down move, Right expands or steps in, Left
/// collapses or goes to the parent, Enter toggles a folder or opens a file.
#[test]
fn tree_keyboard() {
    let fx = Fixture::new(SUITE, "tree_keys");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    let root = ide.root();
    let selected = |ide: &Ide| ide.state().ws.tree.selected.as_ref().map(|p| p.strip_prefix(&root).expect("under root").display().to_string());
    // Rows: docs, src, .gitignore, README.md.
    ide.click("docs");
    ide.key(Key::ArrowDown);
    assert_eq!(selected(&ide).as_deref(), Some("src"));
    ide.key(Key::ArrowRight);
    ide.wait_until("src expanded", |ide| ide.has("src/app.ts"));
    assert_eq!(selected(&ide).as_deref(), Some("src"), "Right expands first");
    ide.key(Key::ArrowRight);
    assert_eq!(selected(&ide).as_deref(), Some("src/core"), "then steps into the folder");
    ide.key(Key::Enter);
    ide.wait_until("core expanded", |ide| ide.has("src/core/deep"));
    ide.key(Key::ArrowDown);
    assert_eq!(selected(&ide).as_deref(), Some("src/core/deep"));
    // Left on a collapsed folder goes to its parent; on an expanded one it collapses.
    ide.key(Key::ArrowLeft);
    assert_eq!(selected(&ide).as_deref(), Some("src/core"));
    ide.key(Key::ArrowLeft);
    ide.settle();
    assert!(!ide.has("src/core/deep"));
    ide.key(Key::ArrowDown);
    ide.key(Key::ArrowDown);
    assert_eq!(selected(&ide).as_deref(), Some("src/util.ts"));
    ide.key(Key::ArrowUp);
    assert_eq!(selected(&ide).as_deref(), Some("src/app.ts"));
    // Enter on a file opens it.
    ide.key(Key::Enter);
    ide.wait_for("app.ts tab", |s| s.ws.tabs.active_editor().is_some());
    assert_eq!(ide.active_title().as_deref(), Some("app.ts"));
}

/// A press on a row keeps the tree focused: the selection stays blue through press, hold, a
/// small drag and release. egui drops the focus of a widget when a press lands outside it, and
/// the tree's focus widget never counts as hovered, so the tree takes the focus back on press.
#[test]
fn tree_keeps_focus_while_pressed() {
    let fx = Fixture::new(SUITE, "tree_press");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.click("README.md");
    assert!(tree_focused(&ide) && ide.is_selected("README.md"));
    let p = ide.rect("docs").center();
    ide.move_to(p);
    let button = |pressed| egui::Event::PointerButton { pos: p, button: egui::PointerButton::Primary, pressed, modifiers: egui::Modifiers::NONE };
    ide.harness.input_mut().events.push(button(true));
    for i in 0..6 {
        ide.step();
        assert!(tree_focused(&ide), "the tree keeps the focus in held frame {i}");
    }
    ide.move_to(p + egui::vec2(2.0, 1.0));
    assert!(tree_focused(&ide), "the tree keeps the focus while the pointer moves");
    assert!(ide.is_selected("docs"), "the press selects the row");
    ide.snapshot_here("tree_press_held");
    ide.harness.input_mut().events.push(button(false));
    ide.step();
    assert!(tree_focused(&ide) && ide.is_selected("docs"));
    ide.step();
    assert!(tree_focused(&ide));

    // A press on an unfocused tree takes the focus at once, before the release.
    ide.double_click("README.md");
    ide.wait_for("README tab", |s| s.ws.tabs.active_editor().is_some());
    ide.settle();
    assert!(!tree_focused(&ide));
    ide.move_to(p);
    ide.harness.input_mut().events.push(button(true));
    ide.step();
    ide.step();
    assert!(tree_focused(&ide), "the press focuses the tree");
    ide.harness.input_mut().events.push(button(false));
    ide.step();
    assert!(tree_focused(&ide) && ide.is_selected("docs"));
}

/// Sets the width of the left tool window, as a drag of its edge would.
fn set_left_width(ide: &mut Ide, w: f32) {
    let id = egui::Id::new("left-tool-window");
    ide.ctx().data_mut(|d| {
        let min = d.get_persisted::<egui::containers::panel::PanelState>(id).map_or(egui::pos2(0.0, 0.0), |s| s.rect.min);
        d.insert_persisted(id, egui::containers::panel::PanelState { rect: egui::Rect::from_min_size(min, egui::vec2(w, 600.0)) });
    });
    ide.settle();
}

/// True while a context menu is drawn (not only open in egui's state).
fn menu_shown(ide: &Ide) -> bool {
    ide.ctx().is_context_menu_open() && ide.ctx().memory(|m| m.areas().visible_layer_ids().into_iter().any(|l| l.order == egui::Order::Foreground))
}

/// What a click, a double click and a right-click at `at` do to the folder `dir`: one letter
/// each. Click: `s` selects, `t` toggles, `.` nothing. Double click: `t` toggles. Right-click:
/// `m` shows the menu.
fn row_outcome(ide: &mut Ide, dir: &std::path::Path, at: egui::Pos2) -> [char; 3] {
    ide.state_mut().ws.tree.selected = None;
    let before = ide.state().ws.tree.is_expanded(dir);
    ide.click_at(at);
    let toggled = ide.state().ws.tree.is_expanded(dir) != before;
    let selected = ide.state().ws.tree.selected.as_deref() == Some(dir);
    let click = match (toggled, selected) {
        (true, false) => 't',
        (false, true) => 's',
        (true, true) => 'B',
        (false, false) => '.',
    };
    ide.state_mut().ws.tree.set_expanded(dir, before);
    ide.double_click_at(at);
    let double = if ide.state().ws.tree.is_expanded(dir) != before { 't' } else { '.' };
    ide.state_mut().ws.tree.set_expanded(dir, before);
    ide.right_click_at(at);
    let right = if menu_shown(ide) && ide.state().ws.tree.selected.as_deref() == Some(dir) { 'm' } else { '.' };
    if ide.ctx().is_context_menu_open() {
        ide.key(Key::Escape);
    }
    ide.settle();
    [click, double, right]
}

/// Every point of a folder row behaves the same, except the chevron cell (one indent wide, full
/// row height), where a click toggles at once. The sweep runs every pixel across the row at
/// several panel widths and depths, and every few pixels on the top and bottom lines (the
/// spacing under a row belongs to it).
#[test]
fn tree_row_hit_zones() {
    let fx = Fixture::new(SUITE, "tree_zones");
    let repo = basic_repo(fx.path("repo"));
    repo.write("a_folder_with_a_rather_long_name_to_fill_the_row/inner/x.txt", "x\n");
    let mut ide = Ide::open(SUITE, &repo.dir);
    let root = ide.root();
    let r = ide.rect("docs");
    assert_eq!(r.max.y, ide.rect("src").min.y, "the row rects touch");
    let src = root.join("src");
    ide.state_mut().ws.tree.set_expanded(&src, true);
    ide.state_mut().ws.tree.set_expanded(&root.join("src/core"), true);
    ide.wait_until("src/core/deep listed", |ide| ide.has("src/core/deep"));
    let t = &harwex_ide::theme::T;
    for width in [300.0, 250.0, 400.0, 600.0] {
        set_left_width(&mut ide, width);
        for (label, depth) in [("docs", 0), ("src/core/deep", 2)] {
            let dir = root.join(label);
            let r = ide.rect(label);
            // Rows sit one indent right of the root's chevron (see `tree::show`).
            let x = r.min.x + 4.0 + (depth + 1) as f32 * t.space.indent;
            let cell = (x + 15.0 - t.space.indent)..(x + 15.0);
            for (line, y, step) in [("middle", r.center().y, 1.0), ("top", r.min.y + 0.5, 7.0), ("bottom", r.max.y - 0.5, 7.0)] {
                let mut map = String::new();
                let mut bad = Vec::new();
                let mut px = r.min.x + 0.5;
                while px < r.max.x {
                    let got = row_outcome(&mut ide, &dir, egui::pos2(px, y));
                    // Half a pixel either side of the cell edge may go either way.
                    let edge = (px - cell.start).abs() < 1.0 || (px - cell.end).abs() < 1.0;
                    let want = if cell.contains(&px) { ['t', 't', 'm'] } else { ['s', 't', 'm'] };
                    map.push(if got == want { if cell.contains(&px) { 'c' } else { '.' } } else { 'X' });
                    if got != want && !edge {
                        bad.push(format!("x={px} got {got:?}"));
                    }
                    px += step;
                }
                assert!(bad.is_empty(), "panel {width}, {label} ({line}): {map}\n{bad:?}");
            }
        }
    }
}

/// A context menu belongs to the row that drew it. When that widget is no longer drawn (its tool
/// window switched by a shortcut, its row scrolled out of view), the menu closes. Before, it
/// stayed open and invisible: its old rect ate every right-click on the tree under it, and the
/// tree ignored its keys.
#[test]
fn orphaned_context_menu_closes() {
    let fx = Fixture::new(SUITE, "orphan_menu");
    let repo = changed_repo(fx.path("repo"));
    // Enough folders below `src` that the tree scrolls.
    for i in 0..60 {
        repo.write(&format!("z{i:02}/x.txt"), "x\n");
    }
    let mut ide = Ide::open(SUITE, &repo.dir);
    let root = ide.root();
    for dir in ["src", "src/core", "docs"] {
        ide.state_mut().ws.tree.set_expanded(&root.join(dir), true);
    }
    ide.wait_until("src/core listed", |ide| ide.has("src/core/deep"));

    // A menu in the Commit window, then the Project window comes back without a click.
    ide.state_mut().ws.layout.left = Some(ToolWindow::Commit);
    ide.settle();
    let c = ide.rect("src/app.ts");
    let at = egui::pos2(c.min.x + 120.0, c.center().y);
    ide.right_click_at(at);
    assert!(menu_shown(&ide), "the Commit row menu opens");
    ide.state_mut().ws.layout.left = Some(ToolWindow::Project);
    ide.settle();
    assert!(!ide.ctx().is_context_menu_open(), "the menu of a row that is not drawn closes");
    // A tree row under the old menu rect gets its own menu on a right-click.
    let row = ["src/util.ts", "src/app.ts", "src/core/deep", "src/core", "src"].into_iter().find(|l| ide.has(l) && ide.rect(l).y_range().contains(at.y)).expect("a tree row at the menu's height");
    let r = ide.rect(row);
    ide.right_click_at(egui::pos2(at.x + 40.0, r.center().y));
    assert!(menu_shown(&ide) && ide.is_selected(row), "a right-click where the old menu was opens the tree menu");
    ide.key(Key::Escape);
    ide.settle();
    assert!(!ide.ctx().is_context_menu_open());

    // A tree row menu, then its row scrolls out of view.
    ide.right_click("docs");
    assert!(menu_shown(&ide));
    // The wheel over the tree, left of the menu.
    let src = ide.rect("src");
    ide.move_to(egui::pos2(src.min.x + 20.0, src.center().y));
    for _ in 0..10 {
        ide.harness.input_mut().events.push(egui::Event::MouseWheel { unit: egui::MouseWheelUnit::Point, delta: egui::vec2(0.0, -80.0), modifiers: egui::Modifiers::NONE });
        ide.step();
    }
    ide.settle();
    assert!(!ide.has("docs"), "docs scrolled out of view");
    assert!(!ide.ctx().is_context_menu_open(), "the menu of a row scrolled out of view closes");
}

/// "Select Opened File": the header button and Alt+F1 expand the tree down to the active file,
/// select it and scroll it into view. Alt+F1 does nothing while the terminal has focus.
#[test]
fn select_opened_file() {
    let fx = Fixture::new(SUITE, "select_opened");
    let repo = basic_repo(fx.path("repo"));
    // Enough folders above `src` (folders sort first) that the target starts below the
    // visible part of the tree.
    for i in 0..60 {
        repo.write(&format!("a{i:02}/x.txt"), "x\n");
    }
    let mut ide = Ide::open(SUITE, &repo.dir);
    assert!(!ide.is_enabled("Select Opened File"), "no tab, nothing to select");
    let header = ide.rect("Select Opened File");
    assert!(header.max.x <= ide.rect("Hide Project").min.x, "the button sits left of the hide button");
    ide.open_file("src/core/deep/nested.ts");
    let root = ide.root();
    assert!(!ide.state().ws.tree.is_expanded(&root.join("src")));
    assert!(!ide.has("src/core/deep/nested.ts"));

    ide.click("Select Opened File");
    ide.wait_until("row revealed", |ide| ide.has("src/core/deep/nested.ts"));
    ide.settle();
    for dir in ["src", "src/core", "src/core/deep"] {
        assert!(ide.state().ws.tree.is_expanded(&root.join(dir)), "{dir} expanded");
    }
    assert!(ide.is_selected("src/core/deep/nested.ts") && tree_focused(&ide));
    ide.snapshot("select_opened_file");

    // Alt+F1 from the editor does the same.
    ide.double_click("src");
    ide.wait_until("src collapsed", |ide| !ide.has("src/core/deep/nested.ts"));
    ide.click("Editor nested.ts");
    assert!(ide.is_focused("Editor nested.ts"));
    ide.key_mods(ALT, Key::F1);
    ide.wait_until("row revealed again", |ide| ide.has("src/core/deep/nested.ts"));
    assert!(ide.is_selected("src/core/deep/nested.ts"));

    // In a focused terminal Alt+F1 belongs to the shell.
    ide.double_click("src");
    ide.wait_until("src collapsed", |ide| !ide.has("src/core/deep/nested.ts"));
    ide.click("Terminal tool window");
    ide.wait_until("terminal focused", |ide| ide.state().ws.terminals.has_focus(&ide.ctx()));
    ide.key_mods(ALT, Key::F1);
    ide.settle();
    assert!(!ide.state().ws.tree.is_expanded(&root.join("src")));
}

/// The tool window strips: icons only, the open windows highlighted, tooltips with the titles.
#[test]
fn tool_strips() {
    let fx = Fixture::new(SUITE, "strips");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    let strip_w = harwex_ide::theme::T.space.strip_w;
    let left = ["Project", "Commit", "Find", "Git", "Find Usages", "Terminal", "Notifications"];
    for title in left {
        let r = ide.rect(&format!("{title} tool window"));
        assert!(r.max.x <= strip_w, "{title} is on the left strip: {r:?}");
    }
    // The upper group opens left windows, the lower group bottom windows. Notifications ends
    // the lower group, right under Terminal.
    assert!(ide.rect("Find tool window").max.y < ide.rect("Git tool window").min.y - 200.0);
    assert!(ide.rect("Terminal tool window").max.y < ide.rect("Notifications tool window").min.y);
    // No right strip: the editor island ends one island gap before the right window edge.
    let gap = harwex_ide::theme::T.space.gap;
    let editor = ide.rect("Empty editor");
    assert!(editor.max.x <= SIZE.x - gap && editor.max.x > SIZE.x - strip_w, "the editor reaches the right edge: {editor:?}");
    ide.click("Terminal tool window");
    ide.wait_until("terminal open", |ide| ide.state().ws.layout.bottom == Some(ToolWindow::Terminal) && ide.state().ws.terminals.len() == 1);
    ide.settle();
    assert!(ide.is_selected("Project tool window") && ide.is_selected("Terminal tool window"));
    assert!(!ide.is_selected("Commit tool window"));
    ide.hover("Find Usages tool window");
    ide.wait_real(std::time::Duration::from_millis(400));
    ide.assert_text("Find Usages  ⌥F7");
    ide.snapshot_here("tool_strips");
    ide.hover("Notifications tool window");
    ide.wait_real(std::time::Duration::from_millis(400));
    ide.assert_text("Notifications");
    ide.snapshot_here("tool_strips_notifications");
}
