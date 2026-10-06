//! Horizontal scroll (tasks 049, 074): the editor (code files, no soft wrap), the Git branch
//! tree, the commit changes tree and the Project tree. A swipe or Shift+wheel scrolls sideways, the editor shows its own
//! horizontal scrollbar only when a line is wider than the view, and tree rows take clicks and
//! context menus across the whole visible width at any horizontal offset.

use crate::common::*;
use egui::{Event, Key, Modifiers, MouseWheelUnit, Pos2, Vec2};

const SUITE: &str = "horizontal_scroll";

/// A wheel event at `at`; egui spreads a big step over a few frames.
fn wheel(ide: &mut Ide, at: Pos2, delta: Vec2, modifiers: Modifiers) {
    ide.move_to(at);
    ide.harness.input_mut().modifiers = modifiers;
    ide.harness.input_mut().events.push(Event::MouseWheel { unit: MouseWheelUnit::Point, delta, modifiers });
    ide.steps(10);
    ide.harness.input_mut().modifiers = Modifiers::NONE;
    ide.settle();
}

/// Drags the editor/Git border up, so the Git window shows every row of the fixture.
fn tall_git_window(ide: &mut Ide) {
    let top = ide.rect("Hide Git").min.y - 8.0;
    ide.drag(Pos2::new(700.0, top), Pos2::new(700.0, 200.0));
    ide.settle();
}

fn editor_scroll(ide: &Ide) -> Vec2 {
    ide.state().ws.tabs.active_editor().expect("editor").view.scroll_offset()
}

#[test]
fn editor_scrolls_sideways_with_its_own_scrollbar() {
    let fx = Fixture::new(SUITE, "editor");
    let repo = basic_repo(fx.path("repo"));
    let long = format!("export const wide = \"{}\";\n", "abcdefghij".repeat(30));
    repo.write("src/long.ts", &format!("// A file with one long line.\n{long}export const narrow = 1;\n"));
    let mut ide = Ide::open(SUITE, &repo.dir);

    // Short lines: no horizontal scrollbar, and a swipe does nothing.
    ide.open_file("src/util.ts");
    assert!(!ide.has("Horizontal scrollbar util.ts"));
    let center = ide.editor_geometry().text_rect.center();
    wheel(&mut ide, center, Vec2::new(-200.0, 0.0), Modifiers::NONE);
    assert_eq!(editor_scroll(&ide).x, 0.0);

    // A long line: the bar is there from the start, at the bottom of the text area.
    ide.open_file("src/long.ts");
    assert!(ide.has("Horizontal scrollbar long.ts"));
    let g = ide.editor_geometry();
    let bar = ide.rect("Horizontal scrollbar long.ts");
    assert_eq!(bar.bottom(), g.text_rect.bottom());
    assert!(bar.left() >= g.text_rect.left(), "the bar never covers the gutter");

    // A two-finger swipe and Shift+wheel scroll sideways; the gutter stays.
    wheel(&mut ide, g.text_rect.center(), Vec2::new(-150.0, 0.0), Modifiers::NONE);
    assert!((editor_scroll(&ide).x - 150.0).abs() < 0.5, "{:?}", editor_scroll(&ide));
    wheel(&mut ide, g.text_rect.center(), Vec2::new(0.0, -100.0), Modifiers::SHIFT);
    assert!((editor_scroll(&ide).x - 250.0).abs() < 0.5, "{:?}", editor_scroll(&ide));
    assert_eq!(editor_scroll(&ide).y, 0.0, "Shift+wheel does not scroll down");
    assert_eq!(ide.editor_geometry().gutter_rect, g.gutter_rect);
    ide.snapshot("editor_scrolled");

    // A click lands on the char drawn under the pointer, and Home scrolls back.
    let p = ide.caret_pos(1, 60);
    ide.click_at(p);
    assert_eq!(ide.cursor(), (1, 60));
    ide.key(Key::Home);
    ide.settle();
    assert_eq!(editor_scroll(&ide).x, 0.0);

    // End on the long line scrolls to the caret.
    ide.key(Key::End);
    ide.settle();
    assert_eq!(ide.cursor(), (1, long.len() - 1));
    assert!(editor_scroll(&ide).x > 0.0);
    let caret = ide.char_pos(1, long.len() - 1);
    assert!(ide.editor_geometry().text_rect.contains(caret), "the caret is in view after End");
}

const LONG_BRANCH: &str = "topic/a-really-long-branch-name-that-does-not-fit-into-the-tree-panel-at-all";

fn tree_scroll(ide: &Ide) -> f32 {
    ide.state().ws.git_ui.window.log_tab(0).expect("main Log tab").tree.scroll_x()
}

#[test]
fn branch_tree_scrolls_sideways_and_rows_take_clicks_at_the_right_edge() {
    let fx = Fixture::new(SUITE, "branch_tree");
    let repo = history_repo(fx.path("repo"));
    repo.git(&["branch", LONG_BRANCH]);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.click("Git tool window");
    ide.wait_for("branches loaded", |s| s.ws.git_ui.window.refs.is_some());
    ide.settle();
    tall_git_window(&mut ide);

    let long_label = format!("Tree branch {LONG_BRANCH}");
    let main0 = ide.rect("Tree branch main");
    let long0 = ide.rect(&long_label);
    assert_eq!(long0.x_range(), main0.x_range(), "every row is exactly the visible width");
    assert_eq!(tree_scroll(&ide), 0.0);

    wheel(&mut ide, main0.center(), Vec2::new(-200.0, 0.0), Modifiers::NONE);
    let scrolled = tree_scroll(&ide);
    assert!(scrolled > 100.0, "the long name scrolls sideways: {scrolled}");
    ide.snapshot("branch_tree_scrolled");

    // Scrolled, the rows still cover the visible width: a press at the right edge selects.
    let main = ide.rect("Tree branch main");
    assert_eq!(main.x_range(), main0.x_range());
    ide.click_at(Pos2::new(main.right() - 3.0, main.center().y));
    assert!(ide.is_selected("Tree branch main"));
    assert_eq!(tree_scroll(&ide), scrolled, "a click does not move the view");

    // The context menu of a scrolled row, opened at its right edge.
    let long = ide.rect(&long_label);
    ide.right_click_at(Pos2::new(long.right() - 3.0, long.center().y));
    ide.wait_until("branch menu", |ide| ide.has("Checkout"));
    assert!(ide.is_selected(&long_label));
    assert!(ide.has(&format!("New Branch from '{LONG_BRANCH}'...")));
    ide.key(Key::Escape);
    ide.settle();
    assert!(!ide.has("Checkout"));
}

const LONG_PATH: &str = "packages/some-workspace-package/src/components/deeply/nested/folder/a_component_file_with_a_long_name.ts";

fn changes_scroll(ide: &Ide) -> f32 {
    ide.state().ws.git_ui.window.log_tab(0).expect("main Log tab").view.changes_pane().scroll_x()
}

#[test]
fn commit_changes_tree_scrolls_sideways_and_rows_take_clicks_at_the_right_edge() {
    let fx = Fixture::new(SUITE, "commit_changes");
    let repo = basic_repo(fx.path("repo"));
    repo.write(LONG_PATH, "export const a = 1;\n");
    repo.write("README.md", "# Changed\n");
    repo.commit_all("Long path work");
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.click("Git tool window");
    ide.wait_for("log loaded", |s| s.ws.git_ui.window.log_tab(0).is_some_and(|t| !t.view.is_loading() && !t.view.commits().is_empty()));
    ide.settle();
    tall_git_window(&mut ide);
    ide.click("Commit Long path work");
    ide.wait_for("changes loaded", |s| s.ws.git_ui.window.log_tab(0).is_some_and(|t| t.view.changes().is_some_and(|c| c.len() == 2)));
    ide.settle();

    let file_label = format!("Changed file {LONG_PATH}");
    let readme0 = ide.rect("Changed file README.md");
    assert_eq!(ide.rect(&file_label).x_range(), readme0.x_range(), "every row is exactly the visible width");

    wheel(&mut ide, readme0.center(), Vec2::new(0.0, -200.0), Modifiers::SHIFT);
    let scrolled = changes_scroll(&ide);
    assert!(scrolled > 100.0, "the long path scrolls sideways: {scrolled}");
    ide.snapshot("commit_changes_scrolled");

    let readme = ide.rect("Changed file README.md");
    assert_eq!(readme.x_range(), readme0.x_range());
    ide.click_at(Pos2::new(readme.right() - 3.0, readme.center().y));
    assert!(ide.is_selected("Changed file README.md"));
    assert_eq!(changes_scroll(&ide), scrolled, "a click does not move the view");

    let file = ide.rect(&file_label);
    ide.right_click_at(Pos2::new(file.right() - 3.0, file.center().y));
    ide.wait_until("changes menu", |ide| ide.has("Show Diff"));
    assert!(ide.is_selected(&file_label));
    assert!(ide.has("Copy Patch"));
    ide.key(Key::Escape);
    ide.settle();
    assert!(!ide.has("Show Diff"));
}

// -----------------------------------------------------------------------------------------
// Project tree (task 074)

const DEEP_DIR: &str = "packages/some-workspace-package/src/components/deeply/nested/folder";
const DEEP_FILE: &str = "a_component_file_with_a_long_name.ts";

fn project_scroll(ide: &Ide) -> f32 {
    ide.state().ws.tree.scroll_x()
}

/// Sets the width of the left tool window, as a drag of its edge would. The panel id is per
/// workspace; the test thread runs the frames, so it holds the active workspace's salt.
fn set_left_width(ide: &mut Ide, w: f32) {
    let id = harwex_ide::workspace::wid("left-tool-window");
    ide.ctx().data_mut(|d| {
        let min = d.get_persisted::<egui::containers::panel::PanelState>(id).map_or(egui::pos2(0.0, 0.0), |s| s.rect.min);
        d.insert_persisted(id, egui::containers::panel::PanelState { rect: egui::Rect::from_min_size(min, egui::vec2(w, 600.0)) });
    });
    ide.settle();
}

/// The screen x where the icon of a tree row at `depth` starts (`tree::icon_left`).
fn icon_x(ide: &Ide, row: egui::Rect, depth: usize) -> f32 {
    let indent = harwex_ide::theme::T.space.indent;
    row.left() + 4.0 + (depth + 1) as f32 * indent + 14.0 - project_scroll(ide)
}

/// The screen x where the name of a tree row at `depth` ends.
fn name_end(ide: &Ide, row: egui::Rect, depth: usize, name: &str) -> f32 {
    let t = &harwex_ide::theme::T;
    let w = ide.ctx().fonts(|f| f.layout_no_wrap(name.to_string(), t.ui_font(), t.text).size().x);
    icon_x(ide, row, depth) + 20.0 + w
}

/// Presses on `from` and moves to `to` in small steps, holding `mods`, then releases.
fn drag_drop(ide: &mut Ide, from: Pos2, to: Pos2, mods: Modifiers) {
    ide.harness.input_mut().modifiers = mods;
    ide.move_to(from);
    ide.harness.input_mut().events.push(Event::PointerButton { pos: from, button: egui::PointerButton::Primary, pressed: true, modifiers: mods });
    ide.step();
    for i in 1..=8 {
        ide.move_to(from + (to - from) * (i as f32 / 8.0));
    }
    ide.harness.input_mut().events.push(Event::PointerButton { pos: to, button: egui::PointerButton::Primary, pressed: false, modifiers: mods });
    ide.step();
    ide.harness.input_mut().modifiers = Modifiers::NONE;
    ide.step();
}

/// Short rows: nothing to scroll sideways, and a swipe does nothing.
#[test]
fn project_tree_without_overflow_does_not_scroll() {
    let fx = Fixture::new(SUITE, "project_short");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    let src = ide.rect("src");
    assert!(!ide.state().ws.tree.overflows(), "no horizontal scrollbar");
    wheel(&mut ide, src.center(), Vec2::new(-200.0, 0.0), Modifiers::NONE);
    assert_eq!(project_scroll(&ide), 0.0);
    assert!(!ide.state().ws.tree.overflows());
}

/// A deep file in a narrow Project panel: Select Opened File brings its name into view, the
/// view scrolls sideways to the end of the row, and rows take clicks, the context menu, keys
/// and drops across the visible width at any horizontal offset.
#[test]
fn project_tree_scrolls_sideways_and_rows_take_clicks_at_the_right_edge() {
    let fx = Fixture::new(SUITE, "project_tree");
    let repo = basic_repo(fx.path("repo"));
    let deep = format!("{DEEP_DIR}/{DEEP_FILE}");
    repo.write(&deep, "export const a = 1;\n");
    repo.commit_all("Deep file");
    let mut ide = Ide::open(SUITE, &repo.dir);
    set_left_width(&mut ide, 220.0);
    assert!(!ide.state().ws.tree.overflows(), "the top-level rows fit");
    let src0 = ide.rect("src");

    // Select Opened File: the deep row is revealed with the start of its name in view.
    ide.open_file(&deep);
    ide.click("Select Opened File");
    ide.wait_until("row revealed", |ide| ide.has(&deep));
    ide.settle();
    assert!(ide.state().ws.tree.overflows(), "the deep row is wider than the panel");
    let row = ide.rect(&deep);
    assert_eq!(row.x_range(), ide.rect("packages").x_range(), "every row is exactly the visible width");
    assert!(row.width() < 220.0, "a narrow panel: {row:?}");
    let revealed = project_scroll(&ide);
    assert!(revealed > 0.0, "the reveal scrolled sideways");
    let start = icon_x(&ide, row, 7);
    assert!(start >= row.left() && start + 48.0 <= row.right(), "the name starts in view: {start} in {row:?}");
    assert!(ide.is_selected(&deep));
    ide.snapshot("project_tree_revealed");

    // A swipe scrolls to the end of the row, and no further.
    wheel(&mut ide, row.center(), Vec2::new(-2000.0, 0.0), Modifiers::NONE);
    let end = name_end(&ide, ide.rect(&deep), 7, DEEP_FILE);
    assert!(end <= row.right() && end > row.right() - 20.0, "the row end is visible at the right edge: {end} vs {row:?}");
    let scrolled = project_scroll(&ide);
    assert!(scrolled > revealed);
    ide.snapshot("project_tree_scrolled");

    // Scrolled, a press on the right part of a row selects that row and keeps the view.
    let packages = ide.rect("packages");
    assert_eq!(packages.x_range(), row.x_range());
    ide.click_at(Pos2::new(packages.right() - 3.0, packages.center().y));
    assert!(ide.is_selected("packages") && !ide.is_selected(&deep));
    assert_eq!(project_scroll(&ide), scrolled, "a click does not move the view");

    // The context menu of a scrolled row, opened at its right edge.
    let r = ide.rect(&deep);
    ide.right_click_at(Pos2::new(r.right() - 3.0, r.center().y));
    ide.wait_until("tree menu", |ide| ide.has("Rename..."));
    assert!(ide.is_selected(&deep));
    ide.key(Key::Escape);
    ide.settle();
    assert!(!ide.has("Rename..."));

    // The keyboard: Up to a shallow row brings its name back into view.
    ide.click_at(Pos2::new(r.right() - 3.0, r.center().y));
    for _ in 0..7 {
        ide.key(Key::ArrowUp);
    }
    ide.settle();
    assert!(ide.is_selected("packages"));
    let packages = ide.rect("packages");
    let start = icon_x(&ide, packages, 0);
    assert!(project_scroll(&ide) < scrolled && start >= packages.left(), "the shallow row's name is in view: {start} in {packages:?}");

    // A drop from a scrolled view: Alt+drag README.md onto the right part of the deep folder.
    wheel(&mut ide, row.center(), Vec2::new(-2000.0, 0.0), Modifiers::NONE);
    assert!(project_scroll(&ide) > 0.0);
    let readme = ide.rect("README.md");
    let folder = ide.rect(DEEP_DIR);
    drag_drop(&mut ide, Pos2::new(readme.right() - 3.0, readme.center().y), Pos2::new(folder.right() - 3.0, folder.center().y), Modifiers::ALT);
    let root = ide.root();
    ide.wait_for("copied", |_| root.join(DEEP_DIR).join("README.md").is_file());
    ide.settle();
    assert!(root.join("README.md").is_file(), "a copy keeps the original");

    // Collapsing the deep folders leaves short rows: the content shrinks back.
    ide.state_mut().ws.tree.set_expanded(&root.join("packages"), false);
    ide.settle();
    assert!(!ide.state().ws.tree.overflows());
    assert_eq!(project_scroll(&ide), 0.0);
    assert_eq!(ide.rect("src").x_range(), src0.x_range());
}
