//! The editor's find bar (IDEA style): Cmd+F with matches and scrollbar marks, Enter /
//! Shift+Enter / Cmd+G cycling, the replace row, Replace, Replace All with one undo, Exclude,
//! the filter and more menus, Esc and read-only tabs.

mod common;

use common::*;
use egui::Key;

const SUITE: &str = "find_replace";

/// "total" appears 7 times: twice in the first comment, three times in code, once in a string
/// and once in the comment at the bottom (below the first screen, for the scrollbar marks).
fn find_ts() -> String {
    let mut s = String::from(
        "// total is the running total\nexport function sumAll(values: number[]): number {\n  let total = 0;\n  for (const v of values) {\n    total += v;\n  }\n  return total;\n}\n\nexport const label = \"total\";\n",
    );
    for i in 0..60 {
        s.push_str(&format!("export const filler{i} = {i};\n"));
    }
    s.push_str("// total again at the bottom\n");
    s
}

fn open_find_ts(name: &str) -> (Fixture, Ide) {
    let fx = Fixture::new(SUITE, name);
    let repo = basic_repo(fx.path("repo"));
    repo.write("src/find.ts", &find_ts());
    repo.commit_all("Add find.ts");
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/find.ts");
    (fx, ide)
}

fn counter(ide: &Ide) -> (Option<usize>, usize) {
    ide.state().tabs.active_editor().expect("editor").view.find().counter()
}

fn bar_open(ide: &Ide) -> bool {
    ide.state().tabs.active_editor().expect("editor").view.find().is_open()
}

#[test]
fn search_highlights_matches_and_marks_the_scrollbar() {
    let (_fx, mut ide) = open_find_ts("search");
    ide.cmd(Key::F);
    ide.settle();
    assert!(bar_open(&ide));
    assert!(ide.is_focused("Search Query"), "Cmd+F focuses the query field");
    ide.type_text("total");
    ide.settle();
    assert_eq!(counter(&ide), (Some(1), 7));
    // The first match after the caret (line 0) is selected in the editor.
    assert_eq!(ide.selected_text(), "total");
    assert_eq!(ide.cursor(), (0, 8));
    ide.assert_text("1/7");
    ide.snapshot("search_matches");

    // Match Case drops nothing here, Words keeps all seven, a regex narrows them.
    ide.click("Regex");
    ide.click("Search Query");
    ide.cmd(Key::A);
    ide.type_text(r"total \+=");
    ide.settle();
    assert_eq!(counter(&ide).1, 1);
    assert!(ide.is_selected("Regex"));
}

#[test]
fn selection_prefills_and_keys_cycle() {
    let (_fx, mut ide) = open_find_ts("cycle");
    // Double-click "total" on line 2, then Cmd+F takes it as the query.
    let p = ide.char_pos(2, 7);
    ide.double_click_at(p);
    assert_eq!(ide.selected_text(), "total");
    ide.cmd(Key::F);
    ide.settle();
    assert_eq!(ide.state().tabs.active_editor().expect("editor").view.find().query(), "total");
    assert_eq!(counter(&ide), (Some(3), 7), "the selected occurrence is the current one");

    // Enter and Shift+Enter in the field, Cmd+G and Shift+Cmd+G anywhere.
    ide.key(Key::Enter);
    assert_eq!(counter(&ide), (Some(4), 7));
    ide.key_mods(SHIFT, Key::Enter);
    assert_eq!(counter(&ide), (Some(3), 7));
    ide.cmd(Key::G);
    assert_eq!(counter(&ide), (Some(4), 7));
    ide.cmd_shift(Key::G);
    ide.cmd_shift(Key::G);
    assert_eq!(counter(&ide), (Some(2), 7));
    assert_eq!(ide.cursor(), (0, 29), "the second match ends the first comment");
    // The arrow buttons do the same.
    ide.click("Next Occurrence");
    assert_eq!(counter(&ide), (Some(3), 7));
    ide.click("Previous Occurrence");
    assert_eq!(counter(&ide), (Some(2), 7));

    // Esc closes the bar and gives the focus back to the text.
    ide.click("Search Query");
    ide.key(Key::Escape);
    ide.settle();
    assert!(!bar_open(&ide));
    assert!(ide.is_focused("Editor find.ts"));
    assert_eq!(ide.selected_text(), "total", "the last match stays selected");

    // Cmd+G with the bar closed goes on with the last query.
    ide.cmd(Key::G);
    ide.settle();
    assert_eq!(ide.cursor(), (2, 11));
}

#[test]
fn replace_row_replace_and_replace_all_with_one_undo() {
    let (_fx, mut ide) = open_find_ts("replace");
    let original = find_ts();
    ide.cmd(Key::R);
    ide.settle();
    assert!(ide.has("Replacement"));
    ide.type_text("total");
    ide.click("Replacement");
    ide.type_text("sum");
    ide.settle();
    ide.snapshot("replace_row");

    // Replace changes the current match (the first) and moves to the next.
    ide.click("Replace");
    ide.settle();
    assert_eq!(ide.active_line(0), "// sum is the running total");
    assert_eq!(counter(&ide), (Some(1), 6));
    assert_eq!(ide.cursor(), (0, 27));

    // Replace All does the rest, and one Cmd+Z in the editor brings them back.
    ide.click("Replace All");
    ide.settle();
    assert!(!ide.active_text().contains("total"), "{}", ide.active_text());
    assert_eq!(counter(&ide).1, 0);
    ide.assert_text("0 results");
    let p = ide.caret_pos(20, 0);
    ide.click_at(p);
    ide.cmd(Key::Z);
    ide.settle();
    assert_eq!(ide.active_text(), original.replacen("total", "sum", 1));
    ide.cmd(Key::Z);
    ide.settle();
    assert_eq!(ide.active_text(), original);

    // The replacement is in the history dropdown.
    ide.click("Replacement History");
    ide.settle();
    assert!(ide.has("sum"));
    ide.key(Key::Escape);
}

#[test]
fn exclude_skips_a_match() {
    let (_fx, mut ide) = open_find_ts("exclude");
    ide.cmd(Key::R);
    ide.type_text("total");
    ide.click("Replacement");
    ide.type_text("t");
    ide.settle();
    assert_eq!(counter(&ide), (Some(1), 7));
    // Exclude the first match; the counter drops it and the second becomes current.
    ide.click("Exclude");
    ide.settle();
    assert_eq!(counter(&ide), (Some(1), 6));
    ide.click("Replace All");
    ide.settle();
    assert_eq!(ide.active_line(0), "// total is the running t");
    assert_eq!(ide.active_text().matches("total").count(), 1);
}

#[test]
fn filter_menu() {
    let (_fx, mut ide) = open_find_ts("filter");
    ide.cmd(Key::F);
    ide.type_text("total");
    ide.settle();
    ide.click("Filter Search Results");
    ide.settle();
    ide.snapshot("filter_menu");
    ide.click("In Comments");
    ide.settle();
    assert_eq!(counter(&ide).1, 3);
    assert!(ide.is_selected("Filter Search Results"), "the funnel shows that a filter is on");
    ide.click("Filter Search Results");
    ide.click("Except Comments and String Literals");
    ide.settle();
    assert_eq!(counter(&ide).1, 3);
    ide.click("Filter Search Results");
    ide.click("In String Literals");
    ide.settle();
    assert_eq!(counter(&ide).1, 1);
}

#[test]
fn more_menu_and_in_selection() {
    let (_fx, mut ide) = open_find_ts("more");
    // Select lines 2 to 6 (the function body), then Cmd+F: In Selection turns on.
    let from = ide.caret_pos(2, 0);
    let to = ide.caret_pos(6, 15);
    ide.drag(from, to);
    ide.cmd(Key::F);
    ide.type_text("total");
    ide.settle();
    assert_eq!(counter(&ide).1, 3);
    ide.click("More Options");
    ide.settle();
    assert!(ide.is_enabled("Select All Occurrences"));
    ide.snapshot("more_menu");
    ide.click("In Selection");
    ide.settle();
    assert_eq!(counter(&ide).1, 7);
}

#[test]
fn read_only_tab_searches_but_does_not_replace() {
    let fx = Fixture::new(SUITE, "read_only");
    let repo = basic_repo(fx.path("repo"));
    repo.write(".gitignore", "node_modules/\n");
    repo.write("node_modules/dep/index.js", "module.exports = 1;\nmodule.id = 2;\n");
    let mut ide = Ide::open(SUITE, &repo.dir);
    let path = std::fs::canonicalize(repo.dir.join("node_modules/dep/index.js")).expect("file");
    ide.state_mut().open_location(&path, None, true);
    ide.wait_for("dep tab", |s| s.tabs.active_editor().is_some_and(|e| e.path == path));
    ide.settle();
    ide.cmd(Key::R);
    ide.type_text("module");
    ide.settle();
    assert_eq!(counter(&ide), (Some(1), 2));
    assert!(!ide.has("Replacement"), "a read-only tab has no replace row");
    assert!(!ide.is_enabled("Expand Replace"));
}
