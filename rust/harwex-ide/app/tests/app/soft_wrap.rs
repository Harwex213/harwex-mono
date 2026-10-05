//! Soft wrap in the IDE (task 040): Markdown and `.txt` files wrap when they open, code files
//! do not, the editor context menu toggles it, and a narrower window re-wraps.

use crate::common::*;
use egui::Pos2;
use ide_editor::Position;

const SUITE: &str = "soft_wrap";

const GUIDE: &str = concat!(
    "# Soft wrap\n\n",
    "Long lines of prose break into visual rows at the width of the editor, at word boundaries when possible. ",
    "The line number stays on the first row of each logical line, and the caret moves by visual rows.\n\n",
    "- A list item keeps its indent on the rows that follow, so the text lines up under the first word of the item instead of the bullet.\n",
    "    - A nested item with a long explanation that runs past the right edge of the editor and wraps under its own indent.\n\n",
    "```\nshort code block\n```\n\n",
    "Short line.\n",
);

fn open_guide(name: &str) -> (Fixture, Ide) {
    let fx = Fixture::new(SUITE, name);
    let repo = basic_repo(fx.path("repo"));
    repo.write("docs/guide.md", GUIDE);
    repo.write("notes.txt", &format!("{}\n", "plain text words ".repeat(20)));
    repo.write("src/long.ts", &format!("export const words = \"{}\";\n", "word ".repeat(60)));
    repo.commit_all("Add long files");
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("docs/guide.md");
    (fx, ide)
}

fn wrap_cols(ide: &Ide) -> Option<usize> {
    ide.state().ws.tabs.active_editor().expect("active editor").view.wrap_cols()
}

/// Center of a char as drawn, in both layouts.
fn center(ide: &Ide, line: usize, column: usize) -> Pos2 {
    let e = ide.state().ws.tabs.active_editor().expect("active editor");
    e.view.char_center(&e.doc, Position::new(line, column)).expect("drawn")
}

fn visual_row(ide: &Ide, line: usize, column: usize) -> usize {
    let e = ide.state().ws.tabs.active_editor().expect("active editor");
    e.view.visual_row(&e.doc, Position::new(line, column))
}

#[test]
fn markdown_wraps_when_it_opens() {
    let (_fx, mut ide) = open_guide("markdown");
    let cols = wrap_cols(&ide).expect("Markdown wraps");
    assert!(ide.active_line(2).chars().count() > cols, "the paragraph is longer than a row");
    assert!(visual_row(&ide, 3, 0) > 3, "the paragraph takes more than one row");
    ide.snapshot("markdown_wrapped");

    // A click on the paragraph's second row puts the caret there.
    let rows = ide_editor::wrap::LineRows::new(&ide.active_line(2), cols);
    let col = rows.starts[1].char + 3;
    let p = center(&ide, 2, col) - egui::vec2(ide.editor_geometry().char_w * 0.3, 0.0);
    ide.click_at(p);
    assert_eq!(ide.cursor(), (2, col));
    // Up moves to the paragraph's first row, at the same x.
    ide.key(egui::Key::ArrowUp);
    assert_eq!(ide.cursor(), (2, 3));

    ide.open_file("notes.txt");
    assert!(wrap_cols(&ide).is_some(), ".txt wraps");
}

#[test]
fn code_files_do_not_wrap_and_have_no_toggle() {
    let (_fx, mut ide) = open_guide("code");
    ide.open_file("src/long.ts");
    assert_eq!(wrap_cols(&ide), None);
    assert_eq!(visual_row(&ide, 1, 0), 1);
    let p = ide.char_pos(0, 3);
    ide.right_click_at(p);
    assert!(ide.has("Go to Declaration"), "the menu is open");
    assert!(!ide.has("Soft-Wrap"), "code files have no soft-wrap toggle");
    ide.key(egui::Key::Escape);
}

#[test]
fn context_menu_toggles_soft_wrap() {
    let (_fx, mut ide) = open_guide("toggle");
    let p = center(&ide, 2, 5);
    ide.right_click_at(p);
    ide.snapshot_here("soft_wrap_menu");
    ide.click("Soft-Wrap");
    ide.settle();
    assert_eq!(wrap_cols(&ide), None, "the toggle turns soft wrap off");
    assert_eq!(visual_row(&ide, 3, 0), 3);
    ide.snapshot("markdown_unwrapped");
    let p = center(&ide, 2, 5);
    ide.right_click_at(p);
    ide.click("Soft-Wrap");
    ide.settle();
    assert!(wrap_cols(&ide).is_some(), "and back on");
}

#[test]
fn narrow_window_rewraps() {
    let (_fx, mut ide) = open_guide("narrow");
    let wide = wrap_cols(&ide).expect("wrapped");
    let rows_wide = visual_row(&ide, 3, 0);
    ide.resize(egui::vec2(900.0, 700.0));
    let narrow = wrap_cols(&ide).expect("wrapped");
    assert!(narrow < wide);
    assert!(visual_row(&ide, 3, 0) > rows_wide, "the paragraph takes more rows");
    ide.snapshot("markdown_narrow");
}
