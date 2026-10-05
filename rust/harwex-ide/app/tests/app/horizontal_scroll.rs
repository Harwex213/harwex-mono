//! Horizontal scroll (task 049): the editor (code files, no soft wrap), the Git branch tree and
//! the commit changes tree. A swipe or Shift+wheel scrolls sideways, the editor shows its own
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
