//! Terminal tool window: Alt+F12, typing into the shell, tabs, Escape routing (prompt vs the
//! alternate screen), shortcut blocking, path links and the exited-shell bar. Shells run
//! `zsh -f` with a fixed prompt, so the user's rc files do not matter.

mod common;

use common::*;
use egui::{Key, Pos2};
use harwex_ide::layout::ToolWindow;

const SUITE: &str = "terminal";

fn screen(ide: &Ide, index: usize) -> String {
    ide.state().terminals.terminal(index).map(|t| t.screen_text()).unwrap_or_default()
}

fn terminal_focused(ide: &Ide) -> bool {
    ide.state().terminals.has_focus(&ide.ctx())
}

/// Waits until the active terminal's screen contains `text` `times` times.
fn wait_screen(ide: &mut Ide, text: &str, times: usize) {
    let t = text.to_string();
    ide.wait_until(&format!("{times}x {text:?} on the terminal"), move |ide| screen(ide, ide.state().terminals.active_index()).matches(&t).count() >= times);
}

fn wait_prompt(ide: &mut Ide) {
    ide.wait_until("shell prompt", |ide| screen(ide, ide.state().terminals.active_index()).lines().any(|l| l.starts_with("$")));
}

/// Screen position of a cell of the active terminal.
fn cell_pos(ide: &Ide, row: usize, col: usize) -> Pos2 {
    let rect = ide.rect("Terminal output");
    let font = egui::FontId::monospace(13.0);
    let ctx = ide.ctx();
    let (w, h) = ctx.fonts(|f| (f.glyph_width(&font, 'M'), f.row_height(&font)));
    Pos2::new(rect.left() + (col as f32 + 0.5) * w, rect.top() + (row as f32 + 0.5) * h.round())
}

fn open_terminal(name: &str) -> (Fixture, Ide) {
    let fx = Fixture::new(SUITE, name);
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/app.ts");
    ide.key_mods(ALT, Key::F12);
    ide.wait_for("terminal spawned", |s| !s.terminals.is_empty());
    wait_prompt(&mut ide);
    (fx, ide)
}

#[test]
fn alt_f12_runs_a_command() {
    let (_fx, mut ide) = open_terminal("echo");
    assert_eq!(ide.state().layout.bottom, Some(ToolWindow::Terminal));
    assert!(terminal_focused(&ide), "Alt+F12 focuses the new terminal");
    ide.type_text("echo hello-from-test\n");
    // Once in the typed command line, once as output.
    wait_screen(&mut ide, "hello-from-test", 2);
    wait_screen(&mut ide, "$", 2);
    let s = screen(&ide, 0);
    assert!(s.lines().any(|l| l == "hello-from-test"), "{s}");
    assert_eq!(ide.state().terminals.terminal(0).expect("terminal").title(), "zsh");
    ide.snapshot("echo");

    // Alt+F12 on a focused terminal hides the window and gives the editor the keys back.
    ide.key_mods(ALT, Key::F12);
    ide.settle();
    assert_eq!(ide.state().layout.bottom, None);
    ide.type_text("Z");
    assert!(ide.active_text().starts_with('Z'), "typing reaches the editor again");
}

#[test]
fn plus_opens_a_second_tab() {
    let (_fx, mut ide) = open_terminal("tabs");
    ide.click("+");
    ide.wait_for("second terminal", |s| s.terminals.len() == 2);
    wait_prompt(&mut ide);
    assert_eq!(ide.state().terminals.active_index(), 1);
    ide.type_text("echo second\n");
    wait_screen(&mut ide, "second", 2);
    assert!(!screen(&ide, 0).contains("second"), "the first shell did not get the input");
    ide.snapshot("two_tabs");

    // Clicking the first tab label switches back; "x" closes a tab and kills its shell.
    ide.click_nth("zsh", 0);
    ide.settle();
    assert_eq!(ide.state().terminals.active_index(), 0);
    let n = ide.rects("x").len();
    ide.click_nth("x", n - 1);
    ide.settle();
    assert_eq!(ide.state().terminals.len(), 1);
}

#[test]
fn escape_at_the_prompt_returns_to_the_editor() {
    let (_fx, mut ide) = open_terminal("escape_prompt");
    assert!(terminal_focused(&ide));
    ide.key(Key::Escape);
    ide.settle();
    assert!(!terminal_focused(&ide), "Escape left the terminal");
    assert!(ide.node("Editor app.ts").is_focused(), "the editor has focus");
    ide.type_text("Q");
    assert!(ide.active_text().starts_with('Q'));
    assert_eq!(ide.state().layout.bottom, Some(ToolWindow::Terminal), "the window stays open");
}

#[test]
fn escape_goes_to_the_program_on_the_alternate_screen() {
    let (fx, mut ide) = open_terminal("escape_less");
    let lines: String = (1..=200).map(|i| format!("line {i}\n")).collect();
    write(&fx.path("repo"), "lines.txt", &lines);
    ide.type_text("less lines.txt\n");
    ide.wait_until("less on the alternate screen", |ide| ide.state().terminals.terminal(0).is_some_and(|t| t.is_alt_screen()));
    wait_screen(&mut ide, "line 1", 1);
    ide.key(Key::Escape);
    ide.settle();
    assert!(terminal_focused(&ide), "less got Escape; focus stayed in the terminal");
    ide.snapshot("less");
    // less reads Escape as the start of a two-key command; the first "q" completes it.
    ide.type_text("qq");
    ide.wait_until("less quit", |ide| ide.state().terminals.terminal(0).is_some_and(|t| !t.is_alt_screen()));
}

#[test]
fn terminal_focus_blocks_cmd_k() {
    let (_fx, mut ide) = open_terminal("cmd_k");
    ide.type_text("echo before-clear\n");
    wait_screen(&mut ide, "before-clear", 2);
    ide.cmd(Key::K);
    ide.settle();
    assert_eq!(ide.state().layout.left, Some(ToolWindow::Project), "Cmd+K did not open the Commit window");
    // The terminal used Cmd+K itself: the scrollback is cleared.
    ide.wait_until("screen cleared", |ide| !screen(ide, 0).contains("before-clear"));
    // Cmd+W does not close the editor tab while the terminal has focus.
    ide.cmd(Key::W);
    ide.settle();
    assert_eq!(ide.tab_titles(), ["app.ts"]);
}

#[test]
fn path_link_opens_the_file() {
    let (_fx, mut ide) = open_terminal("link");
    ide.type_text("echo src/util.ts:2:5\n");
    wait_screen(&mut ide, "src/util.ts:2:5", 2);
    let s = screen(&ide, 0);
    let row = s.lines().position(|l| l == "src/util.ts:2:5").expect("output row");
    let p = cell_pos(&ide, row, 3);
    ide.move_to(p);
    ide.steps(2);
    assert_eq!(ide.cursor_icon(), egui::CursorIcon::PointingHand, "a path under the pointer is a link");
    ide.snapshot_here("link_hover");
    ide.click_at(p);
    ide.wait_for("util.ts opened", |s| s.tabs.active_editor().is_some_and(|e| e.path.ends_with("src/util.ts")));
    ide.settle();
    // `path:2:5` is 1-based; the editor is 0-based.
    assert_eq!(ide.cursor(), (1, 4));
}

#[test]
fn exited_shell_shows_a_bar() {
    let (_fx, mut ide) = open_terminal("exited");
    ide.type_text("exit\n");
    ide.wait_until("shell exited", |ide| ide.state().terminals.terminal(0).is_some_and(|t| !t.is_alive()));
    ide.wait_until("exit bar", |ide| ide.shows_text("[process exited]"));
    ide.snapshot("exited");
    ide.click("Close");
    ide.settle();
    assert!(ide.state().terminals.is_empty());
    assert_eq!(ide.state().layout.bottom, None, "closing the last terminal hides the window");
}
