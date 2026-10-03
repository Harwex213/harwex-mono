//! Terminal tool window: Alt+F12, typing into the shell, tabs, Escape routing (prompt vs the
//! alternate screen), shortcut blocking, path and URL links and the exited-shell bar. Shells run
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

#[test]
fn shift_enter_does_not_run_the_line() {
    let (_fx, mut ide) = open_terminal("shift_enter");
    // EDITOR=vi in the environment would pick zsh's vi keymap, where ESC CR runs the line.
    ide.type_text("bindkey -e\n");
    wait_screen(&mut ide, "$", 2);
    ide.type_text("echo first-$((40+2))");
    ide.key_mods(SHIFT, Key::Enter);
    ide.type_text("echo second-$((50+5))");
    wait_screen(&mut ide, "second-$((50+5))", 1);
    // Give a wrongly executed first line time to print.
    std::thread::sleep(std::time::Duration::from_millis(300));
    ide.settle();
    let s = screen(&ide, 0);
    assert!(!s.contains("first-42"), "Shift+Enter ran the line:\n{s}");
    // The continuation sits on its own row: zsh inserted a newline into the buffer.
    assert!(s.lines().any(|l| l.trim_start().starts_with("echo second-")), "{s}");
    // Plain Enter runs both lines.
    ide.type_text("\n");
    wait_screen(&mut ide, "second-55", 1);
    let s = screen(&ide, 0);
    assert!(s.lines().any(|l| l == "first-42"), "{s}");
}

/// URLs the app handed to the (recording) platform opener. Tests never start a browser.
fn opened_urls(ide: &Ide) -> Vec<String> {
    ide.state().platform.calls().into_iter().filter_map(|c| c.strip_prefix("open-url ").map(str::to_string)).collect()
}

#[test]
fn cmd_click_opens_a_url() {
    let (_fx, mut ide) = open_terminal("url");
    ide.type_text("echo 'docs: https://example.com/a_(b).'\n");
    wait_screen(&mut ide, "docs: https://example.com/a_(b).", 2);
    let s = screen(&ide, 0);
    let row = s.lines().position(|l| l == "docs: https://example.com/a_(b).").expect("output row");
    let p = cell_pos(&ide, row, 14);

    // Without Cmd the URL is plain text, and a click opens nothing.
    ide.move_to(p);
    ide.steps(2);
    assert_eq!(ide.cursor_icon(), egui::CursorIcon::Text, "a URL is a link only with Cmd held");
    ide.click_at(p);
    ide.settle();
    assert!(opened_urls(&ide).is_empty());

    // With Cmd held it is a link.
    ide.harness.input_mut().modifiers = CMD;
    ide.move_to(p);
    ide.steps(2);
    assert_eq!(ide.cursor_icon(), egui::CursorIcon::PointingHand);
    ide.snapshot_here("url_hover");
    ide.harness.input_mut().modifiers = egui::Modifiers::NONE;
    ide.step();

    ide.click_button_at(p, egui::PointerButton::Primary, CMD);
    ide.wait_until("URL opened", |ide| !opened_urls(ide).is_empty());
    // The balanced parens stay, the final "." does not.
    assert_eq!(opened_urls(&ide), ["https://example.com/a_(b)"]);
    assert_eq!(ide.tab_titles(), ["app.ts"], "a URL opens no editor tab");
}

#[test]
fn cmd_click_opens_the_osc8_target() {
    let (_fx, mut ide) = open_terminal("osc8");
    // The text says one thing, the hyperlink points elsewhere; the hyperlink wins.
    ide.type_text("printf '\\e]8;;https://real.example/x\\e\\\\https://shown.example\\e]8;;\\e\\\\ end\\n'\n");
    wait_screen(&mut ide, "https://shown.example end", 1);
    let s = screen(&ide, 0);
    let row = s.lines().position(|l| l == "https://shown.example end").expect("output row");
    ide.click_button_at(cell_pos(&ide, row, 10), egui::PointerButton::Primary, CMD);
    ide.wait_until("URL opened", |ide| !opened_urls(ide).is_empty());
    assert_eq!(opened_urls(&ide), ["https://real.example/x"]);
}

/// Opens a terminal and two more tabs; returns the shell pids in tab order.
fn three_tabs(name: &str) -> (Fixture, Ide, Vec<u32>) {
    let (fx, mut ide) = open_terminal(name);
    for n in 2..=3 {
        ide.click("+");
        ide.wait_for("another terminal", move |s| s.terminals.len() == n);
        wait_prompt(&mut ide);
    }
    let before = pids(&ide);
    (fx, ide, before)
}

fn pids(ide: &Ide) -> Vec<u32> {
    let terms = &ide.state().terminals;
    (0..terms.len()).map(|i| terms.terminal(i).and_then(|t| t.process_id()).expect("shell pid")).collect()
}

/// The tab rects in the tool window header, left to right.
fn tab_rects(ide: &Ide) -> Vec<egui::Rect> {
    let mut rects: Vec<_> = ide.rects("zsh").into_iter().filter(|r| (r.height() - 24.0).abs() < 0.5).collect();
    rects.sort_by(|a, b| a.min.x.total_cmp(&b.min.x));
    rects
}

/// Presses at `from` and moves the pointer to `to` in steps, with the button held.
fn press_and_move(ide: &mut Ide, from: Pos2, to: Pos2) {
    ide.move_to(from);
    ide.pointer_frame(1.0 / 60.0, &[(from, true)]);
    for i in 1..=6 {
        ide.move_to(from + (to - from) * (i as f32 / 6.0));
    }
}

fn release(ide: &mut Ide, at: Pos2) {
    ide.pointer_frame(1.0 / 60.0, &[(at, false)]);
    ide.settle();
}

#[test]
fn drag_moves_a_tab_after_the_third() {
    let (_fx, mut ide, before) = three_tabs("drag_reorder");
    assert_eq!(ide.state().terminals.active_index(), 2);
    let rects = tab_rects(&ide);
    assert_eq!(rects.len(), 3);
    // Grab the first tab by its title and drag it past the middle of the third.
    let from = Pos2::new(rects[0].min.x + 12.0, rects[0].center().y);
    let to = Pos2::new(rects[2].max.x - 4.0, rects[2].center().y + 3.0);
    // Halfway: the tab floats over the gap between the second and the third tab.
    let half = Pos2::new(from.x + (rects[1].min.x - rects[0].min.x) * 1.5, from.y);
    press_and_move(&mut ide, from, half);
    assert!(ide.state().terminals.is_dragging_tab(), "the move past the threshold started a drag");
    assert_eq!(pids(&ide), before, "nothing moves before the release");
    ide.snapshot_here("tab_drag");
    // The second tab made room: it moved into the first slot.
    let during = tab_rects(&ide);
    assert!((during[0].min.x - rects[0].min.x).abs() < 0.5, "{during:?}");
    for i in 1..=6 {
        ide.move_to(half + (to - half) * (i as f32 / 6.0));
    }

    release(&mut ide, to);
    assert!(!ide.state().terminals.is_dragging_tab());
    assert_eq!(pids(&ide), [before[1], before[2], before[0]], "same shells, new order");
    assert_eq!(ide.state().terminals.active_index(), 2, "the dragged tab is active");
    assert!(terminal_focused(&ide), "focus goes to the moved terminal");
    let id = ide.state().terminals.widget_id(2).expect("widget id");
    assert_eq!(ide.ctx().memory(|m| m.focused()), Some(id));
    // The moved shell still works.
    ide.type_text("echo moved-$((6*7))\n");
    wait_screen(&mut ide, "moved-42", 1);
}

#[test]
fn click_without_movement_does_not_reorder() {
    let (_fx, mut ide, before) = three_tabs("drag_click");
    let rects = tab_rects(&ide);
    // A tiny wobble stays under egui's drag threshold: a click, not a drag.
    let p = Pos2::new(rects[0].min.x + 12.0, rects[0].center().y);
    press_and_move(&mut ide, p, p + egui::vec2(2.0, 0.0));
    assert!(!ide.state().terminals.is_dragging_tab());
    release(&mut ide, p + egui::vec2(2.0, 0.0));
    assert_eq!(pids(&ide), before);
    assert_eq!(ide.state().terminals.active_index(), 0, "the click selected the first tab");
}

#[test]
fn escape_or_a_far_release_cancels_the_drag() {
    let (_fx, mut ide, before) = three_tabs("drag_cancel");
    let rects = tab_rects(&ide);
    let from = Pos2::new(rects[0].min.x + 12.0, rects[0].center().y);
    let to = Pos2::new(rects[2].max.x - 4.0, rects[2].center().y);

    // Escape puts the tab back; the release afterwards changes nothing.
    press_and_move(&mut ide, from, to);
    assert!(ide.state().terminals.is_dragging_tab());
    ide.key(Key::Escape);
    assert!(!ide.state().terminals.is_dragging_tab(), "Escape ended the drag");
    release(&mut ide, to);
    assert_eq!(pids(&ide), before, "Escape cancelled the move");
    assert_eq!(ide.state().terminals.active_index(), 2, "the cancelled drag did not select a tab");
    assert_eq!(ide.state().layout.bottom, Some(ToolWindow::Terminal));

    // A release far below the strip (over the terminal output) cancels too.
    let away = Pos2::new(to.x, to.y + 200.0);
    press_and_move(&mut ide, from, to);
    ide.move_to(away);
    assert!(ide.state().terminals.is_dragging_tab());
    release(&mut ide, away);
    assert!(!ide.state().terminals.is_dragging_tab());
    assert_eq!(pids(&ide), before, "a release away from the strip cancelled the move");
}
