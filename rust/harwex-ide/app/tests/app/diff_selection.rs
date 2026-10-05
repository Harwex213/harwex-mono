//! Text selection in the side-by-side diff (task 058): drag, double and triple press, Shift
//! press, Shift+arrows, Cmd+A, Cmd+C and the context menu's Copy on each side; a selection
//! never spans both sides, both sides stay read-only, and a drag past the edge scrolls.

use crate::common::*;
use egui::{Event, Key, Modifiers, PointerButton, Pos2};
use harwex_ide::git::diff::{DiffTab, Side};

const SUITE: &str = "diff_selection";

const OLD: &str = "const alpha = 1;\nconst beta = 2;\nfunction sum(a, b) {\n  return a + b;\n}\n";
const NEW: &str = "const alpha = 1;\nconst beta = 20;\nfunction sum(a, b) {\n  const total = a + b;\n  return total;\n}\n";

fn tab<'a>(ide: &'a mut Ide, key: &str) -> &'a mut DiffTab {
    ide.state_mut().ws.tabs.custom_mut::<DiffTab>(key).unwrap_or_else(|| panic!("diff tab {key}"))
}

/// Opens the worktree diff of `rel` and waits for its model.
fn open_diff(ide: &mut Ide, rel: &str) -> String {
    let path = ide.root().join(rel);
    harwex_ide::git::diff::open_worktree_diff(ide.state_mut(), &path);
    let key = format!("diff:wt:{rel}");
    ide.wait_until("diff model", |ide| ide.state().is_idle() && ide.state().ws.tabs.custom_by_key(&key).is_some());
    ide.settle();
    assert!(tab(ide, &key).hunk_count().is_some(), "diff loaded");
    key
}

/// A point just right of the left edge of char `col`, so the press lands on that boundary.
fn at(ide: &mut Ide, key: &str, side: Side, line: usize, col: usize) -> Pos2 {
    let t = tab(ide, key);
    let a = t.char_center(side, line, col).expect("diff drawn");
    let b = t.char_center(side, line, col + 1).expect("diff drawn");
    Pos2::new(a.x - (b.x - a.x) / 2.0 + 1.0, a.y)
}

fn selection(ide: &mut Ide, key: &str) -> Option<(Side, String)> {
    tab(ide, key).selection()
}

fn last_copy(ide: &Ide) -> Option<String> {
    ide.state().platform.calls().iter().rev().find_map(|c| c.strip_prefix("copy ").map(str::to_string))
}

fn push_copy(ide: &mut Ide) {
    ide.harness.input_mut().events.push(Event::Copy);
    ide.step();
    ide.settle();
}

#[test]
fn select_and_copy_on_both_sides() {
    let fx = Fixture::new(SUITE, "both_sides");
    let repo = Repo::init(fx.path("repo"));
    repo.write("sel.ts", OLD);
    repo.commit_all("Initial");
    repo.write("sel.ts", NEW);
    let mut ide = Ide::open(SUITE, &repo.dir);
    let key = open_diff(&mut ide, "sel.ts");

    // A drag selects on the side it starts on.
    let (from, to) = (at(&mut ide, &key, Side::New, 0, 6), at(&mut ide, &key, Side::New, 0, 11));
    ide.drag(from, to);
    assert_eq!(selection(&mut ide, &key), Some((Side::New, "alpha".into())));
    let (from, to) = (at(&mut ide, &key, Side::Old, 2, 9), at(&mut ide, &key, Side::Old, 3, 8));
    ide.drag(from, to);
    assert_eq!(selection(&mut ide, &key), Some((Side::Old, "sum(a, b) {\n  return".into())), "the left side selects too, and the right one lost its selection");

    // A drag that leaves its pane for the other side stays on its own side.
    let (from, to) = (at(&mut ide, &key, Side::Old, 0, 0), at(&mut ide, &key, Side::New, 1, 3));
    ide.drag(from, to);
    let (side, text) = selection(&mut ide, &key).expect("selection");
    assert_eq!(side, Side::Old);
    assert!(text.starts_with("const alpha = 1;\n"), "{text:?}");

    // Double press selects the word, a third press the line with its break.
    let p = at(&mut ide, &key, Side::Old, 1, 7);
    ide.double_click_at(p);
    assert_eq!(selection(&mut ide, &key), Some((Side::Old, "beta".into())));
    ide.click_now(p);
    assert_eq!(selection(&mut ide, &key), Some((Side::Old, "const beta = 2;\n".into())));
    let p = at(&mut ide, &key, Side::New, 3, 9);
    ide.double_click_at(p);
    assert_eq!(selection(&mut ide, &key), Some((Side::New, "total".into())));

    // Shift+press extends from the caret.
    let p = at(&mut ide, &key, Side::New, 1, 0);
    ide.click_at(p);
    let p = at(&mut ide, &key, Side::New, 2, 8);
    ide.click_button_at(p, PointerButton::Primary, Modifiers::SHIFT);
    assert_eq!(selection(&mut ide, &key), Some((Side::New, "const beta = 20;\nfunction".into())));

    // Cmd+C copies the text as in the file, through the platform clipboard.
    push_copy(&mut ide);
    assert_eq!(last_copy(&ide).as_deref(), Some("const beta = 20;\nfunction"));

    // Shift+arrows extend on the focused side; plain arrows move the caret.
    let p = at(&mut ide, &key, Side::Old, 0, 0);
    ide.click_at(p);
    for _ in 0..5 {
        ide.key_mods(Modifiers::SHIFT, Key::ArrowRight);
    }
    assert_eq!(selection(&mut ide, &key), Some((Side::Old, "const".into())));
    ide.key_mods(Modifiers::SHIFT, Key::ArrowDown);
    assert_eq!(selection(&mut ide, &key), Some((Side::Old, "const alpha = 1;\nconst".into())));
    ide.key(Key::ArrowDown);
    assert_eq!(tab(&mut ide, &key).caret().map(|(s, p)| (s, p.line, p.column)), Some((Side::Old, 2, 5)));
    ide.key_mods(Modifiers::SHIFT, Key::End);
    assert_eq!(selection(&mut ide, &key), Some((Side::Old, "ion sum(a, b) {".into())));

    // The left side is read-only: typing, Backspace and Paste change nothing.
    ide.type_text("zz");
    ide.key(Key::Backspace);
    ide.harness.input_mut().events.push(Event::Paste("pasted".into()));
    ide.step();
    ide.settle();
    assert_eq!(tab(&mut ide, &key).side_text(Side::Old).as_deref(), Some(OLD));
    assert_eq!(tab(&mut ide, &key).side_text(Side::New).as_deref(), Some(NEW));
    assert_eq!(repo.read("sel.ts"), NEW);

    // Cmd+A selects the whole focused side; Copy keeps the file's line breaks.
    ide.cmd(Key::A);
    assert_eq!(selection(&mut ide, &key), Some((Side::Old, OLD.into())));
    push_copy(&mut ide);
    assert_eq!(last_copy(&ide).as_deref(), Some(OLD));

    // The context menu's Copy: a right press inside the selection keeps it.
    let p = at(&mut ide, &key, Side::New, 4, 9);
    ide.double_click_at(p);
    assert_eq!(selection(&mut ide, &key), Some((Side::New, "total".into())));
    let p = at(&mut ide, &key, Side::New, 4, 10);
    ide.right_click_at(p);
    assert!(ide.is_enabled("Copy"), "Copy is enabled over a selection");
    ide.click("Copy");
    ide.settle();
    assert_eq!(last_copy(&ide).as_deref(), Some("total"));
    assert!(!ide.has("Select All"), "the menu closed");

    // A right press outside the selection moves the caret there; the menu offers no Copy.
    let p = at(&mut ide, &key, Side::Old, 0, 2);
    ide.right_click_at(p);
    assert_eq!(selection(&mut ide, &key), Some((Side::Old, String::new())));
    assert!(!ide.is_enabled("Copy"));
    ide.click("Select All");
    assert_eq!(selection(&mut ide, &key), Some((Side::Old, OLD.into())));

    // The snapshot: a selection over the changed block on the right, with the caret.
    let (from, to) = (at(&mut ide, &key, Side::New, 1, 6), at(&mut ide, &key, Side::New, 3, 13));
    ide.drag(from, to);
    assert_eq!(selection(&mut ide, &key), Some((Side::New, "beta = 20;\nfunction sum(a, b) {\n  const total".into())));
    ide.snapshot("diff_selection");
}

/// A drag held below the panes scrolls both sides and extends the selection, like the editor.
#[test]
fn drag_past_the_edge_scrolls() {
    let fx = Fixture::new(SUITE, "autoscroll");
    let repo = big_file_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    let key = open_diff(&mut ide, "big.ts");
    let from = at(&mut ide, &key, Side::New, 2, 0);
    let top_before = tab(&mut ide, &key).char_center(Side::New, 0, 0).expect("drawn").y;
    let body = ide.rect("Tab big.ts (Diff)");
    let below = Pos2::new(from.x + 40.0, ide.harness.ctx.screen_rect().bottom() - 4.0);
    assert!(below.y > body.bottom() + 200.0, "the point is far below the tab strip");
    ide.move_to(from);
    ide.harness.input_mut().events.push(Event::PointerButton { pos: from, button: PointerButton::Primary, pressed: true, modifiers: Modifiers::NONE });
    ide.step();
    ide.move_to(below);
    ide.steps(120);
    let caret_line = tab(&mut ide, &key).caret().expect("caret").1.line;
    ide.harness.input_mut().events.push(Event::PointerButton { pos: below, button: PointerButton::Primary, pressed: false, modifiers: Modifiers::NONE });
    ide.step();
    ide.settle();
    let top_after = tab(&mut ide, &key).char_center(Side::New, 0, 0).expect("drawn").y;
    assert!(top_after < top_before - 18.0, "the view scrolled: line 0 moved from {top_before} to {top_after}");
    let (side, text) = selection(&mut ide, &key).expect("selection");
    assert_eq!(side, Side::New);
    assert!(text.lines().count() > 30 && caret_line > 30, "the selection grew with the scroll: {} lines, caret line {caret_line}", text.lines().count());
    assert!(text.starts_with("export const value2 = 2;\n"), "{:?}", &text[..40]);
    // The other side scrolled with it.
    let old_top = tab(&mut ide, &key).char_center(Side::Old, 0, 0).expect("drawn").y;
    assert!((old_top - top_after).abs() < 1.0, "the sides stay aligned above the first change");
}
