//! Shift+Esc hides the active tool window, like IDEA: from the editor, from a focused terminal
//! and from a text field inside a tool window. The editor gets the keys back.

use crate::common::*;
use egui::Key;
use harwex_ide::layout::ToolWindow;

const SUITE: &str = "tool_window_hide";

fn open(name: &str) -> (Fixture, Ide) {
    let fx = Fixture::new(SUITE, name);
    let repo = changed_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/app.ts");
    (fx, ide)
}

fn editor_focused(ide: &Ide) -> bool {
    ide.node("Editor app.ts").is_focused()
}

fn terminal_focused(ide: &Ide) -> bool {
    ide.state().ws.terminals.has_focus(&ide.ctx())
}

fn screen(ide: &Ide) -> String {
    ide.state().ws.terminals.terminal(0).map(|t| t.screen_text()).unwrap_or_default()
}

fn shift_esc(ide: &mut Ide) {
    ide.key_mods(SHIFT, Key::Escape);
    ide.settle();
}

#[test]
fn hides_every_kind_of_tool_window() {
    let (_fx, mut ide) = open("every_kind");
    for w in ToolWindow::LEFT.into_iter().chain(ToolWindow::BOTTOM) {
        ide.state_mut().ws.layout.show(w);
        ide.settle();
        assert!(ide.has(&format!("Hide {}", w.title())), "{w:?} is drawn");
        shift_esc(&mut ide);
        let layout = ide.state().ws.layout;
        assert!(layout.left != Some(w) && layout.bottom != Some(w), "Shift+Esc hid {w:?}: {layout:?}");
        assert!(editor_focused(&ide), "the editor has focus after hiding {w:?}");
    }
    assert_eq!((ide.state().ws.layout.left, ide.state().ws.layout.bottom), (None, None));
}

#[test]
fn hides_the_last_used_side() {
    let (_fx, mut ide) = open("last_used");
    ide.state_mut().ws.layout.show(ToolWindow::Problems);
    ide.settle();
    // A click in the Project tree makes the left side the active one again.
    ide.click("src");
    ide.settle();
    assert!(harwex_ide::tree::has_focus(&ide.ctx()));
    shift_esc(&mut ide);
    assert_eq!(ide.state().ws.layout.left, None, "Project was used last");
    assert_eq!(ide.state().ws.layout.bottom, Some(ToolWindow::Problems));
    assert!(editor_focused(&ide));
    // The next Shift+Esc takes the window that is left.
    shift_esc(&mut ide);
    assert_eq!(ide.state().ws.layout.bottom, None);
}

#[test]
fn focused_terminal_does_not_swallow_shift_esc() {
    let (_fx, mut ide) = open("terminal");
    ide.key_mods(ALT, Key::F12);
    ide.wait_for("terminal spawned", |s| !s.ws.terminals.is_empty());
    ide.wait_until("shell prompt", |ide| screen(ide).lines().any(|l| l.starts_with('$')));
    assert!(terminal_focused(&ide));
    shift_esc(&mut ide);
    assert_eq!(ide.state().ws.layout.bottom, None, "Shift+Esc hid the terminal");
    assert_eq!(ide.state().ws.layout.left, Some(ToolWindow::Project), "the left window stays");
    assert!(!terminal_focused(&ide));
    assert!(editor_focused(&ide));
    ide.type_text("Z");
    assert!(ide.active_text().starts_with('Z'), "typing reaches the editor");
}

#[test]
fn plain_esc_still_reaches_the_terminal_program() {
    let (fx, mut ide) = open("terminal_less");
    let lines: String = (1..=200).map(|i| format!("line {i}\n")).collect();
    write(&fx.path("repo"), "lines.txt", &lines);
    ide.key_mods(ALT, Key::F12);
    ide.wait_for("terminal spawned", |s| !s.ws.terminals.is_empty());
    ide.wait_until("shell prompt", |ide| screen(ide).lines().any(|l| l.starts_with('$')));
    ide.type_text("less lines.txt\n");
    ide.wait_until("less on the alternate screen", |ide| ide.state().ws.terminals.terminal(0).is_some_and(|t| t.is_alt_screen()));
    ide.key(Key::Escape);
    ide.settle();
    assert!(terminal_focused(&ide), "less got Escape; focus stayed in the terminal");
    assert_eq!(ide.state().ws.layout.bottom, Some(ToolWindow::Terminal));
    // less reads Escape as the start of a two-key command; "q" completes it and "q" quits.
    ide.type_text("qq");
    ide.wait_until("less quit", |ide| ide.state().ws.terminals.terminal(0).is_some_and(|t| !t.is_alt_screen()));
    // Shift+Esc still hides the window from inside the program.
    ide.type_text("less lines.txt\n");
    ide.wait_until("less again", |ide| ide.state().ws.terminals.terminal(0).is_some_and(|t| t.is_alt_screen()));
    shift_esc(&mut ide);
    assert_eq!(ide.state().ws.layout.bottom, None);
    assert!(editor_focused(&ide));
}

#[test]
fn text_field_in_a_tool_window_does_not_swallow_shift_esc() {
    let (_fx, mut ide) = open("text_field");
    // Cmd+K opens the Commit window and focuses the message box.
    ide.cmd(Key::K);
    ide.settle();
    assert_eq!(ide.state().ws.layout.left, Some(ToolWindow::Commit));
    ide.type_text("draft");
    assert_eq!(ide.state().ws.git_ui.changes.message, "draft");
    shift_esc(&mut ide);
    assert_eq!(ide.state().ws.layout.left, None, "Shift+Esc hid the Commit window");
    assert_eq!(ide.state().ws.git_ui.changes.message, "draft", "the draft stays");
    assert!(editor_focused(&ide));
}

#[test]
fn without_a_tool_window_shift_esc_does_nothing() {
    let (_fx, mut ide) = open("nothing");
    ide.state_mut().ws.layout.left = None;
    ide.settle();
    // Escape closes the editor's find bar; Shift+Esc must not reach the editor as Escape.
    ide.cmd(Key::F);
    ide.settle();
    let bar_open = |ide: &Ide| ide.state().ws.tabs.active_editor().expect("editor").view.find().is_open();
    assert!(bar_open(&ide));
    shift_esc(&mut ide);
    assert!(bar_open(&ide), "Shift+Esc did not close the find bar");
    assert_eq!((ide.state().ws.layout.left, ide.state().ws.layout.bottom), (None, None));
    ide.key(Key::Escape);
    ide.settle();
    assert!(!bar_open(&ide), "plain Escape still closes it");
}

#[test]
fn hide_button_tooltip_names_the_shortcut() {
    let (_fx, mut ide) = open("tooltip");
    ide.hover("Hide Project");
    ide.wait_real(std::time::Duration::from_millis(400));
    ide.assert_text("Hide  ⇧⎋");
    ide.snapshot_here("hide_tooltip");
}
