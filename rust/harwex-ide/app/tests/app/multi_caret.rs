//! Multiple carets in the editor (IDEA style): Alt+click, column selection (Alt+Shift+drag and
//! middle drag), Ctrl+G / Ctrl+Shift+G, Select All Occurrences from the find bar and Ctrl+Cmd+G,
//! double Alt + arrows, typing and paste at every caret with one undo step, Esc.

use crate::common::*;
use egui::{Event, Key, Modifiers, PointerButton, Pos2};

const SUITE: &str = "multi_caret";

const CTRL: Modifiers = Modifiers { alt: false, ctrl: true, shift: false, mac_cmd: false, command: false };
const CTRL_SHIFT_G: Modifiers = Modifiers { alt: false, ctrl: true, shift: true, mac_cmd: false, command: false };
const CTRL_CMD: Modifiers = Modifiers { alt: false, ctrl: true, shift: false, mac_cmd: true, command: true };
const ALT_SHIFT: Modifiers = Modifiers { alt: true, ctrl: false, shift: true, mac_cmd: false, command: false };

/// "total" is a whole word on lines 1, 3 and 5; lines 8 to 11 line up for column selection.
const MULTI_TS: &str = "export function sum(values: number[]): number {\n  let total = 0;\n  for (const v of values) {\n    total += v;\n  }\n  return total;\n}\n\nexport const a = 1;\nexport const b = 2;\nexport const c = 3;\nexport const d = 4;\n";

fn open_multi(name: &str) -> (Fixture, Ide) {
    let fx = Fixture::new(SUITE, name);
    let repo = basic_repo(fx.path("repo"));
    repo.write("src/multi.ts", MULTI_TS);
    repo.commit_all("Add multi.ts");
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/multi.ts");
    (fx, ide)
}

/// Every caret as ((line, column) of the anchor, (line, column) of the head).
fn carets(ide: &Ide) -> Vec<((usize, usize), (usize, usize))> {
    let e = ide.state().ws.tabs.active_editor().expect("editor");
    let pos = |i: usize| {
        let p = e.doc.char_to_position(i);
        (p.line, p.column)
    };
    e.view.carets().all().iter().map(|s| (pos(s.anchor), pos(s.head))).collect()
}

fn heads(ide: &Ide) -> Vec<(usize, usize)> {
    carets(ide).into_iter().map(|(_, h)| h).collect()
}

fn selected_texts(ide: &Ide) -> Vec<String> {
    let e = ide.state().ws.tabs.active_editor().expect("editor");
    e.view.carets().all().iter().map(|s| e.doc.slice(s.range())).collect()
}

/// Presses at `from` with `mods` (or the middle button), drags to `to`, releases.
fn drag_with(ide: &mut Ide, from: Pos2, to: Pos2, button: PointerButton, mods: Modifiers) {
    ide.harness.input_mut().modifiers = mods;
    ide.move_to(from);
    ide.harness.input_mut().events.push(Event::PointerButton { pos: from, button, pressed: true, modifiers: mods });
    ide.step();
    for i in 1..=4 {
        ide.move_to(from + (to - from) * (i as f32 / 4.0));
    }
    ide.harness.input_mut().events.push(Event::PointerButton { pos: to, button, pressed: false, modifiers: mods });
    ide.step();
    ide.harness.input_mut().modifiers = Modifiers::NONE;
    ide.step();
}

#[test]
fn alt_click_adds_and_removes_carets() {
    let (_fx, mut ide) = open_multi("alt_click");
    ide.click_at(ide.caret_pos(8, 13));
    ide.click_button_at(ide.caret_pos(9, 13), PointerButton::Primary, ALT);
    ide.click_button_at(ide.caret_pos(10, 13), PointerButton::Primary, ALT);
    assert_eq!(heads(&ide), vec![(8, 13), (9, 13), (10, 13)]);
    assert_eq!(ide.cursor(), (10, 13), "the newest caret is the primary");
    ide.type_text("x");
    assert_eq!(ide.active_line(8), "export const xa = 1;");
    assert_eq!(ide.active_line(10), "export const xc = 3;");
    ide.snapshot("alt_click");
    // Alt+click on a caret removes it; a plain click leaves one caret.
    ide.click_button_at(ide.caret_pos(9, 14), PointerButton::Primary, ALT);
    assert_eq!(heads(&ide), vec![(8, 14), (10, 14)]);
    ide.click_at(ide.caret_pos(11, 2));
    assert_eq!(heads(&ide), vec![(11, 2)]);
}

#[test]
fn column_selection_by_alt_shift_drag_and_middle_drag() {
    let (_fx, mut ide) = open_multi("column");
    let from = ide.caret_pos(8, 7);
    let to = ide.caret_pos(11, 12);
    drag_with(&mut ide, from, to, PointerButton::Primary, ALT_SHIFT);
    assert_eq!(selected_texts(&ide), vec!["const"; 4]);
    assert_eq!(ide.cursor(), (11, 12), "the primary is the line under the pointer");
    ide.snapshot("column_selection");
    // Typing replaces every column at once.
    ide.type_text("let");
    assert_eq!(ide.active_line(9), "export let b = 2;");
    assert_eq!(ide.active_line(11), "export let d = 4;");
    // The middle button drags a column of carets without Alt.
    let from = ide.caret_pos(1, 2);
    let to = ide.caret_pos(3, 2);
    drag_with(&mut ide, from, to, PointerButton::Middle, Modifiers::NONE);
    assert_eq!(heads(&ide), vec![(1, 2), (2, 2), (3, 2)]);
    ide.key(Key::Escape);
    assert_eq!(heads(&ide), vec![(3, 2)], "Esc keeps only the primary");
}

#[test]
fn ctrl_g_adds_the_next_occurrence() {
    let (_fx, mut ide) = open_multi("next_occurrence");
    ide.click_at(ide.caret_pos(1, 7));
    ide.key_mods(CTRL, Key::G);
    assert_eq!(selected_texts(&ide), vec!["total"], "the first press selects the word");
    ide.key_mods(CTRL, Key::G);
    ide.key_mods(CTRL, Key::G);
    assert_eq!(selected_texts(&ide), vec!["total"; 3]);
    assert_eq!(ide.cursor(), (5, 14));
    ide.snapshot("next_occurrence");
    ide.key_mods(CTRL_SHIFT_G, Key::G);
    assert_eq!(heads(&ide), vec![(1, 11), (3, 9)], "Ctrl+Shift+G drops the last one");
    assert_eq!(ide.cursor(), (3, 9));
    // A press with every occurrence taken changes nothing; the run wraps to the top first.
    ide.key_mods(CTRL, Key::G);
    ide.key_mods(CTRL, Key::G);
    assert_eq!(selected_texts(&ide).len(), 3);
}

#[test]
fn select_all_occurrences_from_the_find_bar() {
    let (_fx, mut ide) = open_multi("select_all");
    ide.cmd(Key::F);
    ide.type_text("total");
    ide.settle();
    ide.click("More Options");
    ide.settle();
    assert!(ide.is_enabled("Select All Occurrences"));
    ide.click("Select All Occurrences");
    ide.settle();
    assert_eq!(selected_texts(&ide), vec!["total"; 3]);
    assert!(!ide.state().ws.tabs.active_editor().expect("editor").view.find().is_open(), "the bar closes");
    assert!(ide.is_focused("Editor multi.ts"), "typing goes to the carets");
    ide.snapshot("select_all");
}

#[test]
fn typing_at_many_carets_is_one_undo_step() {
    let (_fx, mut ide) = open_multi("typing");
    // Ctrl+Cmd+G without the bar takes the word under the caret.
    ide.click_at(ide.caret_pos(3, 6));
    ide.key_mods(CTRL_CMD, Key::G);
    assert_eq!(selected_texts(&ide), vec!["total"; 3]);
    ide.type_text("sum");
    ide.key(Key::Enter);
    ide.type_text("// next");
    assert_eq!(ide.active_line(1), "  let sum");
    assert_eq!(ide.active_line(2), "  // next = 0;");
    ide.snapshot("typed");
    // Paste with one line per caret puts one line at each.
    ide.harness.input_mut().events.push(Event::Paste("1\n2\n3".into()));
    ide.step();
    assert_eq!(ide.active_line(2), "  // next1 = 0;");
    assert_eq!(ide.active_line(8), "  // next3;");
    // One Cmd+Z takes the paste back at all three carets.
    ide.cmd(Key::Z);
    assert_eq!(ide.active_line(2), "  // next = 0;");
    assert_eq!(ide.active_line(8), "  // next;");
    // Then "next", "//", Enter, "um" and the first "s" (it replaced the selections).
    for _ in 0..5 {
        ide.cmd(Key::Z);
    }
    assert_eq!(ide.active_text(), MULTI_TS);
    assert_eq!(selected_texts(&ide), vec!["total"; 3], "undo brings the carets back");
}

#[test]
fn double_alt_and_arrows_clone_the_caret() {
    let (_fx, mut ide) = open_multi("clone");
    ide.click_at(ide.caret_pos(9, 7));
    for _ in 0..2 {
        ide.harness.input_mut().modifiers = Modifiers::NONE;
        ide.step();
        ide.harness.input_mut().modifiers = Modifiers::ALT;
        ide.step();
    }
    for key in [Key::ArrowDown, Key::ArrowDown, Key::ArrowUp, Key::ArrowUp, Key::ArrowUp] {
        ide.harness.input_mut().events.push(Event::Key { key, physical_key: None, pressed: true, repeat: false, modifiers: Modifiers::ALT });
        ide.step();
    }
    ide.harness.input_mut().modifiers = Modifiers::NONE;
    ide.step();
    assert_eq!(heads(&ide), vec![(8, 7), (9, 7), (10, 7), (11, 7)]);
    // A single Alt press does not arm it: Alt+Down then moves every caret down.
    ide.key_mods(Modifiers::ALT, Key::ArrowDown);
    assert_eq!(heads(&ide), vec![(9, 7), (10, 7), (11, 7), (12, 0)]);
}
