//! Editor input through the app: typing, undo/redo, selection, Cmd+D, Cmd+/, the context menu,
//! Cmd+hover, read-only dependency files and gutter marks.

mod common;

use common::*;
use egui::Key;
use ide_editor::GutterMark;

const SUITE: &str = "editor";

fn open_util(name: &str) -> (Fixture, Ide) {
    let fx = Fixture::new(SUITE, name);
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/util.ts");
    (fx, ide)
}

const UTIL: &str = "export function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport const ZERO = 0;\n";

#[test]
fn typing_undo_redo() {
    let (_fx, mut ide) = open_util("typing");
    // Click at the end of line 2 ("}") and type a new line.
    let p = ide.caret_pos(2, 1);
    ide.click_at(p);
    assert_eq!(ide.cursor(), (2, 1));
    ide.type_text("\nconst y = 1;");
    ide.settle();
    assert_eq!(ide.active_text(), UTIL.replace("}\n\n", "}\nconst y = 1;\n\n"));
    assert_eq!(ide.cursor(), (3, 12));
    ide.snapshot("typed");

    // Backspace deletes before the caret.
    ide.key(Key::Backspace);
    assert_eq!(ide.active_line(3), "const y = 1");

    // The first undo restores the deleted char; more undos walk back to the saved text,
    // which is clean again.
    ide.cmd(Key::Z);
    assert_eq!(ide.active_line(3), "const y = 1;");
    for _ in 0..10 {
        if ide.active_text() == UTIL {
            break;
        }
        ide.cmd(Key::Z);
    }
    ide.settle();
    assert_eq!(ide.active_text(), UTIL);
    assert!(!ide.state().ws.tabs.active_tab().expect("tab").is_dirty(), "undo to the saved state is clean");

    // Redo brings the typing back, up to the Backspace.
    ide.cmd_shift(Key::Z);
    assert_ne!(ide.active_text(), UTIL);
    for _ in 0..10 {
        ide.cmd_shift(Key::Z);
    }
    ide.settle();
    assert_eq!(ide.active_line(3), "const y = 1");
}

#[test]
fn selection_with_keys_mouse_and_double_click() {
    let (_fx, mut ide) = open_util("selection");
    // Shift+Right extends the selection one char at a time.
    let p = ide.caret_pos(0, 7);
    ide.click_at(p);
    for _ in 0..8 {
        ide.key_mods(SHIFT, Key::ArrowRight);
    }
    assert_eq!(ide.selected_text(), "function");

    // A double click selects the word under the pointer.
    let p = ide.char_pos(4, 15);
    ide.double_click_at(p);
    assert_eq!(ide.selected_text(), "ZERO");

    // Dragging selects from the press to the release point.
    let from = ide.caret_pos(1, 2);
    let to = ide.caret_pos(1, 14);
    ide.drag(from, to);
    assert_eq!(ide.selected_text(), "return a + b");
    ide.snapshot("drag_selection");

    // Cmd+A selects everything.
    ide.cmd(Key::A);
    assert_eq!(ide.selected_text(), UTIL);
}

#[test]
fn triple_click_selects_the_line_and_keeps_the_caret_at_the_click() {
    let (_fx, mut ide) = open_util("line_select");
    let p = ide.caret_pos(1, 9);
    ide.click_at(p);
    ide.click_now(p);
    ide.click_now(p);
    assert_eq!(ide.selected_text(), "  return a + b;\n", "the third click selects the line with its newline");
    assert_eq!(ide.cursor(), (1, 9), "the caret stays at the click");
    ide.snapshot("line_selected_caret_mid_line");

    // Typing replaces the whole line, like any selection.
    ide.type_text("x");
    ide.settle();
    assert_eq!(ide.active_line(1), "x}");
}

#[test]
fn cmd_d_duplicates_and_cmd_slash_comments() {
    let (_fx, mut ide) = open_util("duplicate");
    let p = ide.caret_pos(1, 4);
    ide.click_at(p);
    ide.cmd(Key::D);
    ide.settle();
    assert_eq!(ide.active_line(1), "  return a + b;");
    assert_eq!(ide.active_line(2), "  return a + b;");

    ide.cmd(Key::Slash);
    ide.settle();
    assert_eq!(ide.active_line(2), "  // return a + b;");
    // Like IDEA, commenting one line moves the caret down, so repeated Cmd+/ walks the file.
    assert_eq!(ide.cursor().0, 3);
    ide.snapshot("duplicated_and_commented");

    // Back on the commented line, Cmd+/ removes the comment again.
    ide.key(Key::ArrowUp);
    ide.cmd(Key::Slash);
    ide.settle();
    assert_eq!(ide.active_line(2), "  return a + b;");
}

#[test]
fn right_click_moves_caret_and_opens_context_menu() {
    let (_fx, mut ide) = open_util("context_menu");
    assert_eq!(ide.cursor(), (0, 0));
    let p = ide.caret_pos(4, 13);
    ide.right_click_at(p);
    ide.settle();
    // Like IDEA, the caret moves to the right-clicked spot first.
    assert_eq!(ide.cursor(), (4, 13));
    for item in ["Go to Declaration", "Go to Source Definition", "Go to Type Definition", "Find Usages", "Cut", "Copy", "Paste", "Comment with Line Comment", "Git"] {
        assert!(ide.has(item), "menu item {item:?} missing; labels {:?}", ide.labels());
    }
    ide.snapshot_here("context_menu");

    // The Git submenu opens on hover. Rollback Lines is disabled on an unchanged line.
    ide.hover("Git");
    ide.wait_until("git submenu", |ide| ide.has("Annotate with Git Blame"));
    assert!(ide.has("Show History"));
    assert!(!ide.is_enabled("Rollback Lines"));
    ide.snapshot_here("context_menu_git");

    // Picking an item runs it on the clicked line and closes the menu.
    ide.click("Comment with Line Comment");
    ide.settle();
    assert_eq!(ide.active_line(4), "// export const ZERO = 0;");
    assert!(!ide.has("Go to Declaration"));

    // Right-click inside a selection keeps it, so Copy acts on it.
    let p = ide.char_pos(0, 10);
    ide.double_click_at(p);
    assert_eq!(ide.selected_text(), "function");
    let p = ide.char_pos(0, 11);
    ide.right_click_at(p);
    ide.settle();
    assert_eq!(ide.selected_text(), "function");
    ide.key(Key::Escape);
}

/// Opens the context menu at `(line, column)` and clicks `path` (a submenu first, like "Git").
fn menu_pick(ide: &mut Ide, line: usize, column: usize, path: &[&str]) {
    let p = ide.caret_pos(line, column);
    ide.right_click_at(p);
    ide.settle();
    let (item, submenus) = path.split_last().expect("a menu item");
    for sub in submenus {
        ide.hover(sub);
        let wanted = item.to_string();
        ide.wait_until("submenu", move |ide| ide.has(&wanted));
    }
    ide.click(item);
    ide.settle();
    assert!(!ide.has("Comment with Line Comment"), "the menu closed");
}

/// The editor of the active tab has keyboard focus.
fn editor_focused(ide: &Ide) -> bool {
    ide.is_focused(&format!("Editor {}", ide.active_title().expect("active tab")))
}

// Every context-menu item hands the focus back to the editor, so the next key acts on it
// without a click into the text first.

#[test]
fn menu_comment_then_undo() {
    let (_fx, mut ide) = open_util("menu_comment");
    menu_pick(&mut ide, 4, 13, &["Comment with Line Comment"]);
    assert_eq!(ide.active_line(4), "// export const ZERO = 0;");
    assert!(editor_focused(&ide));
    ide.cmd(Key::Z);
    ide.settle();
    assert_eq!(ide.active_text(), UTIL);
}

#[test]
fn menu_cut_then_undo() {
    let (_fx, mut ide) = open_util("menu_cut");
    let p = ide.char_pos(4, 15);
    ide.double_click_at(p);
    assert_eq!(ide.selected_text(), "ZERO");
    menu_pick(&mut ide, 4, 15, &["Cut"]);
    assert_eq!(ide.active_line(4), "export const  = 0;");
    ide.cmd(Key::Z);
    ide.settle();
    assert_eq!(ide.active_text(), UTIL);
}

#[test]
fn menu_copy_then_type() {
    let (_fx, mut ide) = open_util("menu_copy");
    let p = ide.char_pos(4, 15);
    ide.double_click_at(p);
    menu_pick(&mut ide, 4, 15, &["Copy"]);
    assert_eq!(ide.selected_text(), "ZERO");
    // The selection is still there, so typing replaces it.
    ide.type_text("ONE");
    ide.settle();
    assert_eq!(ide.active_line(4), "export const ONE = 0;");
}

#[test]
fn menu_paste_then_type() {
    let (_fx, mut ide) = open_util("menu_paste");
    // The test harness has no clipboard, so only the focus is checked here.
    menu_pick(&mut ide, 4, 0, &["Paste"]);
    assert!(editor_focused(&ide));
    ide.type_text("// ");
    ide.settle();
    assert_eq!(ide.active_line(4), "// export const ZERO = 0;");
}

#[test]
fn menu_go_to_then_type() {
    let fx = Fixture::new(SUITE, "menu_go_to");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    // Markdown has no language server: the request ends in a warning, the focus stays.
    ide.open_file("README.md");
    for item in ["Go to Declaration", "Go to Type Definition", "Find Usages"] {
        menu_pick(&mut ide, 0, 2, &[item]);
        assert!(editor_focused(&ide), "{item} returns the focus");
    }
    ide.type_text("x");
    ide.settle();
    assert_eq!(ide.active_line(0), "# xdemo");
}

#[test]
fn menu_git_rollback_then_undo() {
    let fx = Fixture::new(SUITE, "menu_rollback");
    let repo = changed_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/app.ts");
    let changed = ide.active_text();
    menu_pick(&mut ide, 3, 4, &["Git", "Rollback Lines"]);
    ide.wait_until("rolled back", |ide| ide.active_line(3) == "  const x = add(1, 2);");
    assert!(editor_focused(&ide));
    ide.cmd(Key::Z);
    ide.settle();
    assert_eq!(ide.active_text(), changed);
}

#[test]
fn menu_git_annotate_then_type() {
    let (_fx, mut ide) = open_util("menu_annotate");
    menu_pick(&mut ide, 4, 0, &["Git", "Annotate with Git Blame"]);
    ide.wait_for("blame shown", |s| s.ws.tabs.active_editor().is_some_and(|e| !e.annotations.is_empty()));
    assert!(editor_focused(&ide));
    ide.type_text("// ");
    ide.settle();
    assert_eq!(ide.active_line(4), "// export const ZERO = 0;");
}

#[test]
fn cmd_hover_underlines_identifier() {
    let (_fx, mut ide) = open_util("cmd_hover");
    let p = ide.char_pos(0, 17);
    ide.hover_with(CMD, p);
    ide.steps(2);
    assert_eq!(ide.cursor_icon(), egui::CursorIcon::PointingHand, "Cmd+hover over an identifier shows a hand");
    ide.snapshot_here("cmd_hover_add");
    ide.release_modifiers();
    ide.move_to(p);
    assert_eq!(ide.cursor_icon(), egui::CursorIcon::Text, "without Cmd the text cursor is back");
}

#[test]
fn node_modules_tab_is_read_only() {
    let fx = Fixture::new(SUITE, "read_only");
    let repo = basic_repo(fx.path("repo"));
    repo.write(".gitignore", "node_modules/\n");
    repo.write("node_modules/dep/index.js", "module.exports = 1;\n");
    let mut ide = Ide::open(SUITE, &repo.dir);
    let path = std::fs::canonicalize(repo.dir.join("node_modules/dep/index.js")).expect("file");
    ide.state_mut().open_location(&path, None, true);
    ide.wait_for("dep tab", |s| s.ws.tabs.active_editor().is_some_and(|e| e.path == path));
    ide.settle();
    assert!(ide.state().ws.tabs.active_editor().expect("editor").read_only);
    ide.assert_text("read-only");

    // Typing, Backspace, Enter, Cmd+D and Cmd+/ change nothing.
    let p = ide.caret_pos(0, 6);
    ide.click_at(p);
    ide.type_text("zzz\n");
    ide.key(Key::Backspace);
    ide.cmd(Key::D);
    ide.cmd(Key::Slash);
    ide.settle();
    assert_eq!(ide.active_text(), "module.exports = 1;\n");
    assert!(!ide.state().ws.tabs.active_tab().expect("tab").is_dirty());
    // Navigation and selection still work.
    ide.key_mods(SHIFT, Key::ArrowRight);
    assert_eq!(ide.selected_text(), ".");

    // The context menu disables the editing items.
    let p = ide.caret_pos(0, 2);
    ide.right_click_at(p);
    ide.settle();
    assert!(!ide.is_enabled("Cut"));
    assert!(!ide.is_enabled("Paste"));
    assert!(ide.is_enabled("Copy"));
    ide.key(Key::Escape);
    ide.settle();
    // The tab shows a padlock instead of the dirty dot.
    ide.snapshot("read_only_tab");
}

#[test]
fn gutter_marks_for_changed_lines() {
    let fx = Fixture::new(SUITE, "gutter");
    let repo = changed_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/app.ts");
    let marks = ide.state().ws.tabs.active_editor().expect("editor").marks.clone();
    assert_eq!(marks, vec![(3, GutterMark::Modified)], "the changed call on line 4");

    // An inserted line gets an Added bar; deleting a line leaves a Deleted triangle.
    let p = ide.caret_pos(0, 0);
    ide.click_at(p);
    ide.type_text("// header\n");
    let p = ide.caret_pos(8, 0);
    ide.click_at(p);
    ide.key_mods(CMD, Key::Backspace);
    ide.settle();
    let marks = ide.state().ws.tabs.active_editor().expect("editor").marks.clone();
    assert!(marks.contains(&(0, GutterMark::Added)), "{marks:?}");
    assert!(marks.contains(&(4, GutterMark::Modified)), "{marks:?}");
    assert!(marks.iter().any(|(_, m)| *m == GutterMark::Deleted), "{marks:?}");
    ide.snapshot("gutter_marks");
}
