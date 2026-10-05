//! Cmd+T (new terminal tab) and Cmd+Shift+T (reopen the last closed editor tab). Both keys
//! belong to the IDE even while a terminal has focus: the shell never sees them.

use crate::common::*;
use egui::{Event, Key, Modifiers, MouseWheelUnit, Pos2, Vec2};
use ide_editor::{Position, ViewState};
use harwex_ide::layout::ToolWindow;

const SUITE: &str = "tab_shortcuts";

fn screen(ide: &Ide, index: usize) -> String {
    ide.state().ws.terminals.terminal(index).map(|t| t.screen_text()).unwrap_or_default()
}

fn wait_prompt(ide: &mut Ide, index: usize) {
    ide.wait_until("shell prompt", move |ide| screen(ide, index).lines().any(|l| l.starts_with('$')));
}

/// Waits until terminal `index` shows `line` as a whole screen line.
fn wait_line(ide: &mut Ide, index: usize, line: &str) {
    let l = line.to_string();
    ide.wait_until(&format!("{line:?} on terminal {index}"), move |ide| screen(ide, index).lines().any(|s| s == l));
}

fn terminal_focused(ide: &Ide) -> bool {
    ide.state().ws.terminals.has_focus(&ide.ctx())
}

/// Puts the caret of the active editor at (line, column) with a click.
fn put_caret(ide: &mut Ide, line: usize, column: usize) {
    let p = ide.caret_pos(line, column);
    ide.click_at(p);
    ide.settle();
    assert_eq!(ide.cursor(), (line, column));
}

fn reopen(ide: &mut Ide, title: &str) {
    ide.cmd_shift(Key::T);
    let t = title.to_string();
    ide.wait_until(&format!("{title} reopened"), move |ide| ide.active_title().as_deref() == Some(t.as_str()));
    ide.settle();
}

/// A wheel event at `at`; egui spreads a big step over a few frames.
fn wheel(ide: &mut Ide, at: Pos2, delta: Vec2) {
    ide.move_to(at);
    ide.harness.input_mut().events.push(Event::MouseWheel { unit: MouseWheelUnit::Point, delta, modifiers: Modifiers::NONE });
    ide.steps(10);
    ide.settle();
}

fn view_state(ide: &Ide) -> ViewState {
    let e = ide.state().ws.tabs.active_editor().expect("active editor");
    e.view.view_state(&e.doc).expect("editor drawn")
}

fn visual_row(ide: &Ide, line: usize, column: usize) -> usize {
    let e = ide.state().ws.tabs.active_editor().expect("active editor");
    e.view.visual_row(&e.doc, Position::new(line, column))
}

/// Closes the active tab, runs `between`, presses Cmd+Shift+T and returns the view of the
/// first frame that draws the reopened tab: the restore must not show another offset first.
fn close_and_reopen(ide: &mut Ide, title: &str, between: impl FnOnce(&mut Ide)) -> ViewState {
    ide.click(&format!("Tab {title}"));
    ide.cmd(Key::W);
    ide.settle();
    assert!(!ide.tab_titles().iter().any(|t| t == title));
    between(ide);
    ide.cmd_shift(Key::T);
    let t = title.to_string();
    ide.wait_until(&format!("{title} reopened and drawn"), move |ide| {
        ide.active_title().as_deref() == Some(t.as_str()) && ide.state().ws.tabs.active_editor().is_some_and(|e| e.view.geometry().is_some())
    });
    let first = view_state(ide);
    ide.settle();
    first
}

#[test]
fn cmd_t_opens_a_terminal_tab_and_not_update_project() {
    let fx = Fixture::new(SUITE, "cmd_t");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/app.ts");

    // From the editor: the Terminal window opens with a focused shell.
    ide.cmd(Key::T);
    ide.wait_for("first terminal", |s| s.ws.terminals.len() == 1);
    wait_prompt(&mut ide, 0);
    assert_eq!(ide.state().ws.layout.bottom, Some(ToolWindow::Terminal));
    assert!(terminal_focused(&ide), "Cmd+T focuses the new terminal");
    assert!(!ide.state().ws.git_ui.remote.update_open(), "Cmd+T no longer opens Update Project");
    assert_eq!(ide.tab_titles(), ["app.ts"], "the editor tab stays");

    // From a focused terminal: a second tab, and the first shell receives nothing.
    ide.type_text("echo one");
    wait_line(&mut ide, 0, "$ echo one");
    ide.cmd(Key::T);
    ide.wait_for("second terminal", |s| s.ws.terminals.len() == 2);
    wait_prompt(&mut ide, 1);
    assert_eq!(ide.state().ws.terminals.active_index(), 1);
    assert!(terminal_focused(&ide));
    assert!(!ide.state().ws.git_ui.remote.update_open());
    ide.wait_real(std::time::Duration::from_millis(300));
    assert!(screen(&ide, 0).lines().any(|l| l == "$ echo one"), "no bytes reached the first shell:\n{}", screen(&ide, 0));

    // Cmd+Shift+T is not Cmd+T: it opens no terminal.
    ide.cmd_shift(Key::T);
    ide.settle();
    assert_eq!(ide.state().ws.terminals.len(), 2);
}

#[test]
fn cmd_shift_t_walks_back_through_closed_tabs() {
    let fx = Fixture::new(SUITE, "reopen");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/app.ts");
    put_caret(&mut ide, 3, 4);
    ide.open_file("src/util.ts");
    put_caret(&mut ide, 1, 5);
    ide.open_file("docs/notes.md");
    assert_eq!(ide.tab_titles(), ["app.ts", "util.ts", "notes.md"]);

    // Close util.ts (the middle tab), then app.ts (the first one).
    ide.click("Tab util.ts");
    ide.cmd(Key::W);
    ide.settle();
    ide.click("Tab app.ts");
    ide.cmd(Key::W);
    ide.settle();
    assert_eq!(ide.tab_titles(), ["notes.md"]);

    // The last closed tab comes back first, at its old place and caret.
    reopen(&mut ide, "app.ts");
    assert_eq!(ide.tab_titles(), ["app.ts", "notes.md"]);
    assert_eq!(ide.cursor(), (3, 4));
    // A second press walks one step further back.
    reopen(&mut ide, "util.ts");
    assert_eq!(ide.tab_titles(), ["app.ts", "util.ts", "notes.md"]);
    assert_eq!(ide.cursor(), (1, 5));

    // A file deleted since it closed is skipped.
    ide.click("Tab util.ts");
    ide.cmd(Key::W);
    ide.settle();
    ide.click("Tab notes.md");
    ide.cmd(Key::W);
    ide.settle();
    assert_eq!(ide.tab_titles(), ["app.ts"]);
    std::fs::remove_file(repo.dir.join("docs/notes.md")).expect("delete notes.md");
    reopen(&mut ide, "util.ts");
    assert_eq!(ide.tab_titles(), ["app.ts", "util.ts"]);
    assert_eq!(ide.cursor(), (1, 5));
    ide.dismiss_toasts();
    assert!(ide.state().ws.tabs.closed().is_empty(), "the history is used up");

    // Nothing left: another press changes nothing.
    ide.cmd_shift(Key::T);
    ide.settle();
    assert_eq!(ide.tab_titles(), ["app.ts", "util.ts"]);
}

#[test]
fn cmd_shift_t_from_a_focused_terminal() {
    let fx = Fixture::new(SUITE, "reopen_from_terminal");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/app.ts");
    put_caret(&mut ide, 2, 7);
    ide.cmd(Key::W);
    ide.settle();
    assert!(ide.tab_titles().is_empty());

    ide.key_mods(ALT, Key::F12);
    ide.wait_for("terminal spawned", |s| !s.ws.terminals.is_empty());
    wait_prompt(&mut ide, 0);
    ide.type_text("echo two");
    wait_line(&mut ide, 0, "$ echo two");
    assert!(terminal_focused(&ide));

    reopen(&mut ide, "app.ts");
    assert_eq!(ide.cursor(), (2, 7));
    assert_eq!(ide.state().ws.terminals.len(), 1, "Cmd+Shift+T opens no terminal");
    ide.wait_real(std::time::Duration::from_millis(300));
    assert!(screen(&ide, 0).lines().any(|l| l == "$ echo two"), "no bytes reached the shell:\n{}", screen(&ide, 0));
}

#[test]
fn cmd_shift_t_restores_the_scroll_position() {
    let fx = Fixture::new(SUITE, "reopen_scroll");
    let repo = basic_repo(fx.path("repo"));
    let mut text = format!("// A long file.\nexport const wide = \"{}\";\n", "abcdefghij".repeat(30));
    for i in 0..300 {
        text.push_str(&format!("export const v{i} = {i};\n"));
    }
    repo.write("src/long.ts", &text);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/long.ts");
    put_caret(&mut ide, 2, 3);

    // Scroll far away from the caret, down and sideways.
    let center = ide.editor_geometry().text_rect.center();
    wheel(&mut ide, center, Vec2::new(0.0, -2500.0));
    wheel(&mut ide, center, Vec2::new(-150.0, 0.0));
    let before = view_state(&ide);
    let scroll = ide.state().ws.tabs.active_editor().expect("editor").view.scroll_offset();
    assert!(before.line > 100, "scrolled down: {before:?}");
    assert!(before.x > 100.0, "scrolled sideways: {before:?}");

    let first = close_and_reopen(&mut ide, "long.ts", |_| {});
    assert_eq!(first.line, before.line, "the first frame already draws the old top line: {first:?} vs {before:?}");
    assert!((first.offset - before.offset).abs() < 0.5 && (first.x - before.x).abs() < 0.5, "{first:?} vs {before:?}");
    let after = view_state(&ide);
    assert_eq!(after.line, before.line);
    assert!((after.x - before.x).abs() < 0.5, "{after:?} vs {before:?}");
    let now = ide.state().ws.tabs.active_editor().expect("editor").view.scroll_offset();
    assert!((now - scroll).length() < 0.5, "scroll {now:?} vs {scroll:?}");
    assert_eq!(ide.cursor(), (2, 3), "the caret comes back too, without scrolling to it");
}

#[test]
fn cmd_shift_t_restores_the_top_line_with_soft_wrap() {
    let fx = Fixture::new(SUITE, "reopen_scroll_wrap");
    let repo = basic_repo(fx.path("repo"));
    let mut text = String::new();
    for i in 0..200 {
        text.push_str(&format!("Paragraph {i}: {}\n", "some words ".repeat(50)));
    }
    repo.write("docs/long.md", &text);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("docs/long.md");
    assert!(ide.state().ws.tabs.active_editor().expect("editor").view.wrap_cols().is_some(), "Markdown wraps");

    // Stop with a continuation row of a paragraph at the top.
    let g = ide.editor_geometry();
    wheel(&mut ide, g.text_rect.center(), Vec2::new(0.0, -2000.0));
    if view_state(&ide).column == 0 {
        wheel(&mut ide, g.text_rect.center(), Vec2::new(0.0, -g.line_h));
    }
    let before = view_state(&ide);
    assert!(before.line > 10 && before.column > 0, "a continuation row on top: {before:?}");
    assert_eq!(before.x, 0.0);

    // Same width: the same row comes back.
    let first = close_and_reopen(&mut ide, "long.md", |_| {});
    assert_eq!((first.line, first.column), (before.line, before.column), "{first:?} vs {before:?}");
    assert!((first.offset - before.offset).abs() < 0.5, "{first:?} vs {before:?}");
    assert_eq!(view_state(&ide).line, before.line);

    // A narrower window: the same logical line, and its old top row's first char is on top.
    let first = close_and_reopen(&mut ide, "long.md", |ide| ide.resize(egui::vec2(900.0, 700.0)));
    assert_eq!(first.line, before.line, "{first:?} vs {before:?}");
    assert_eq!(visual_row(&ide, before.line, before.column), visual_row(&ide, first.line, first.column), "the old top text is on the top row: {first:?} vs {before:?}");
}
