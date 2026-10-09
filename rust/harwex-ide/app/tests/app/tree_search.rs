//! Project tree speed search (typing in the focused tree selects matching visible rows, Up/Down
//! move between matches, Backspace edits, Escape clears, Enter acts and ends it) and the
//! recursive collapse (a collapsed folder forgets its expanded subfolders, like IDEA).

use crate::common::*;
use egui::Key;

const SUITE: &str = "tree_search";

fn reveal(ide: &mut Ide, rel: &str) {
    let root = ide.root();
    let path = root.join(rel);
    ide.state_mut().ws.tree.reveal(&root, &path);
    ide.settle();
}

/// The selected row, relative to the project root.
fn selected(ide: &Ide) -> String {
    let root = ide.root();
    let sel = ide.state().ws.tree.selected.clone().expect("a selected row");
    sel.strip_prefix(&root).expect("under root").display().to_string()
}

fn search(ide: &Ide) -> String {
    ide.state().ws.tree.search().to_string()
}

fn expanded(ide: &Ide, rel: &str) -> bool {
    ide.state().ws.tree.is_expanded(&ide.root().join(rel))
}

#[test]
fn typing_searches_the_visible_rows() {
    let fx = Fixture::new(SUITE, "typing");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    reveal(&mut ide, "docs/notes.md");
    reveal(&mut ide, "src/util.ts");
    ide.click("README.md");
    assert!(harwex_ide::tree::has_focus(&ide.ctx()));

    // The first visible match is selected; notes.md matches "ts" by chars in order.
    ide.type_text("ts");
    ide.settle();
    assert_eq!(search(&ide), "ts");
    assert!(ide.has("Speed search ts"), "{:?}", ide.labels());
    assert_eq!(selected(&ide), "docs/notes.md");
    // Down and Up go between the matches only, and wrap around.
    ide.key(Key::ArrowDown);
    assert_eq!(selected(&ide), "src/app.ts");
    ide.key(Key::ArrowDown);
    assert_eq!(selected(&ide), "src/util.ts");
    ide.snapshot("speed_search");
    ide.key(Key::ArrowDown);
    assert_eq!(selected(&ide), "docs/notes.md", "Down at the last match wraps");
    ide.key(Key::ArrowUp);
    assert_eq!(selected(&ide), "src/util.ts", "Up at the first match wraps");

    // Backspace edits the text (never deletes a file); a selected row that still matches stays.
    ide.key(Key::Backspace);
    assert_eq!(search(&ide), "t");
    assert_eq!(selected(&ide), "src/util.ts");
    assert!(repo.dir.join("src/util.ts").exists());
    // Camel humps and word starts: "ut" picks util.ts.
    ide.key(Key::Backspace);
    ide.type_text("ut");
    ide.settle();
    assert_eq!(selected(&ide), "src/util.ts");

    // A text with no match keeps the selection.
    ide.type_text("zz");
    ide.settle();
    assert_eq!(search(&ide), "utzz");
    assert_eq!(selected(&ide), "src/util.ts");
    ide.snapshot("no_match");

    // Escape clears the search first; the tree keeps the focus.
    ide.key(Key::Escape);
    ide.settle();
    assert_eq!(search(&ide), "");
    assert!(!ide.labels().iter().any(|l| l.starts_with("Speed search")));
    assert!(harwex_ide::tree::has_focus(&ide.ctx()), "Escape with a search does not leave the tree");

    // Enter acts on the selected match and ends the search.
    ide.type_text("app");
    ide.settle();
    assert_eq!(selected(&ide), "src/app.ts");
    ide.key(Key::Enter);
    ide.settle();
    assert_eq!(search(&ide), "");
    assert_eq!(ide.active_title().as_deref(), Some("app.ts"));
}

#[test]
fn a_click_or_focus_loss_ends_the_search() {
    let fx = Fixture::new(SUITE, "click_ends");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    reveal(&mut ide, "src/util.ts");
    ide.click("README.md");
    ide.type_text("ut");
    ide.settle();
    assert_eq!(selected(&ide), "src/util.ts");
    ide.click("src/app.ts");
    assert_eq!(search(&ide), "");
    assert_eq!(selected(&ide), "src/app.ts");

    // Text typed with Cmd held is a shortcut, not a search.
    ide.harness.input_mut().modifiers = CMD;
    ide.type_text("u");
    ide.harness.input_mut().modifiers = egui::Modifiers::NONE;
    ide.settle();
    assert_eq!(search(&ide), "");

    // The search ends when the tree loses the focus (here to the editor).
    ide.type_text("ut");
    ide.settle();
    assert_eq!(search(&ide), "ut");
    ide.open_file("src/app.ts");
    ide.state_mut().ws.tabs.active_editor_mut().expect("editor").view.request_focus();
    ide.settle();
    assert_eq!(search(&ide), "");
}

#[test]
fn collapse_forgets_inner_folders() {
    let fx = Fixture::new(SUITE, "collapse");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    reveal(&mut ide, "src/core/deep/nested.ts");
    assert!(expanded(&ide, "src") && expanded(&ide, "src/core") && expanded(&ide, "src/core/deep"));

    // A click on the chevron collapses src and everything inside it.
    ide.click("Collapse src");
    ide.settle();
    assert!(!expanded(&ide, "src") && !expanded(&ide, "src/core") && !expanded(&ide, "src/core/deep"));
    ide.click("Expand src");
    ide.settle();
    assert!(ide.has("src/core"));
    assert!(!ide.has("src/core/deep"), "expanding again shows one level");

    // Left on an expanded folder does the same.
    reveal(&mut ide, "src/core/deep/nested.ts");
    ide.click("src/core");
    ide.key(Key::ArrowLeft);
    ide.settle();
    assert!(expanded(&ide, "src") && !expanded(&ide, "src/core") && !expanded(&ide, "src/core/deep"));
}
