//! Task 093: mouse buttons and tool window keys, like IDEA. A middle click closes a terminal
//! tab; mouse buttons 4 and 5 are Navigate Back and Forward from anywhere; ⌘1 / ⌘0 / ⌘9 / ⌘6
//! activate Project / Commit / Git / Problems and hide them when pressed in the active window;
//! Shift+Esc hides the active window from every focus; ⇧⌘F12 hides every tool window and
//! brings them back.

use crate::common::*;
use egui::{Key, PointerButton, Rect};
use harwex_ide::find_window::{self, UsageOrigin};
use harwex_ide::lang::{Location, Reference};
use harwex_ide::layout::{Side, ToolWindow};
use harwex_ide::nav::NavPoint;

const SUITE: &str = "window_keys";

fn open(name: &str) -> (Fixture, Ide) {
    let fx = Fixture::new(SUITE, name);
    let repo = changed_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/app.ts");
    (fx, ide)
}

fn editor_focused(ide: &Ide) -> bool {
    let ctx = ide.ctx();
    ide.state().ws.tabs.active_editor().is_some_and(|e| e.view.owns_focus(&ctx))
}

fn terminal_focused(ide: &Ide) -> bool {
    ide.state().ws.terminals.has_focus(&ide.ctx())
}

fn screen(ide: &Ide) -> String {
    ide.state().ws.terminals.terminal(ide.state().ws.terminals.active_index()).map(|t| t.screen_text()).unwrap_or_default()
}

fn open_terminal(ide: &mut Ide) {
    ide.key_mods(ALT, Key::F12);
    ide.wait_for("terminal spawned", |s| !s.ws.terminals.is_empty());
    ide.wait_until("shell prompt", |ide| screen(ide).lines().any(|l| l.starts_with('$')));
}

/// The rect of the focused widget, if any.
fn focused_rect(ide: &Ide) -> Option<Rect> {
    let ctx = ide.ctx();
    let id = ctx.memory(|m| m.focused())?;
    ctx.read_response(id).map(|r| r.rect)
}

/// The focused widget sits on `side`'s island: left of the editor or under it.
fn focus_on(ide: &Ide, side: Side) -> bool {
    let editor = ide.rect("Editor app.ts");
    focused_rect(ide).is_some_and(|r| match side {
        Side::Left => r.center().x < editor.min.x,
        Side::Bottom => r.center().y > editor.max.y,
    })
}

fn shown(ide: &Ide, w: ToolWindow) -> bool {
    let l = ide.state().ws.layout;
    l.left == Some(w) || l.bottom == Some(w)
}

fn active_file(ide: &Ide) -> String {
    ide.active_title().unwrap_or_default()
}

// ---------------------------------------------------------------------------------------------
// Mouse

#[test]
fn middle_click_closes_a_terminal_tab() {
    let (_fx, mut ide) = open("middle_click");
    open_terminal(&mut ide);
    ide.click("+");
    ide.wait_for("second terminal", |s| s.ws.terminals.len() == 2);
    ide.wait_until("second prompt", |ide| screen(ide).lines().any(|l| l.starts_with('$')));
    let pids = |ide: &Ide| {
        let t = &ide.state().ws.terminals;
        (0..t.len()).map(|i| t.terminal(i).and_then(|t| t.process_id()).expect("pid")).collect::<Vec<_>>()
    };
    let before = pids(&ide);
    let mut tabs: Vec<Rect> = ide.rects("zsh").into_iter().filter(|r| (r.height() - 24.0).abs() < 0.5).collect();
    tabs.sort_by(|a, b| a.min.x.total_cmp(&b.min.x));
    assert_eq!(tabs.len(), 2);
    // The first tab is not the active one: the middle click closes the tab under the pointer.
    ide.middle_click_at(tabs[0].center());
    ide.settle();
    assert_eq!(pids(&ide), [before[1]], "the first tab closed");
    assert_eq!(ide.state().ws.layout.bottom, Some(ToolWindow::Terminal));
    // The last tab: the window hides, like the close button.
    let tab = ide.rects("zsh").into_iter().find(|r| (r.height() - 24.0).abs() < 0.5).expect("tab");
    ide.middle_click_at(tab.center());
    ide.settle();
    assert!(ide.state().ws.terminals.is_empty());
    assert_eq!(ide.state().ws.layout.bottom, None);
}

/// app.ts at line 3 is in Back history, util.ts is open.
fn with_history(ide: &mut Ide) {
    let root = ide.root();
    ide.open_file("src/util.ts");
    ide.state_mut().ws.nav.push_back(NavPoint { path: root.join("src/app.ts"), pos: ide_editor::Position::new(3, 2) });
    assert_eq!(active_file(ide), "util.ts");
}

#[test]
fn mouse_back_and_forward_buttons_navigate() {
    let (_fx, mut ide) = open("mouse_nav");
    with_history(&mut ide);
    let editor = ide.rect("Editor util.ts").center();
    ide.click_button_at(editor, PointerButton::Extra1, egui::Modifiers::NONE);
    ide.settle();
    assert_eq!(active_file(&ide), "app.ts", "button 4 is Back");
    let e = ide.state().ws.tabs.active_editor().expect("editor");
    let caret = e.doc.char_to_position(e.view.selection().head);
    assert_eq!((caret.line, caret.column), (3, 2));
    assert_eq!(ide.state().ws.nav.forward.len(), 1);
    // From the Project tree too.
    ide.click("src");
    ide.settle();
    let row = ide.rect("src").center();
    ide.click_button_at(row, PointerButton::Extra2, egui::Modifiers::NONE);
    ide.settle();
    assert_eq!(active_file(&ide), "util.ts", "button 5 is Forward");
    assert!(ide.state().ws.nav.forward.is_empty());
}

#[test]
fn mouse_back_works_from_a_focused_terminal() {
    let (_fx, mut ide) = open("mouse_nav_terminal");
    with_history(&mut ide);
    open_terminal(&mut ide);
    assert!(terminal_focused(&ide));
    let before = screen(&ide);
    let output = ide.rect("Terminal output").center();
    ide.click_button_at(output, PointerButton::Extra1, egui::Modifiers::NONE);
    ide.settle();
    assert_eq!(active_file(&ide), "app.ts", "button 4 is Back from the terminal");
    assert_eq!(screen(&ide), before, "the shell got nothing");
}

// ---------------------------------------------------------------------------------------------
// ⌘<digit>

#[test]
fn cmd_1_focuses_hides_and_shows_project() {
    let (_fx, mut ide) = open("cmd_1");
    assert_eq!(ide.state().ws.layout.left, Some(ToolWindow::Project));
    assert!(editor_focused(&ide));
    // Open but without the keys: the first press focuses the tree.
    ide.cmd(Key::Num1);
    ide.settle();
    assert_eq!(ide.state().ws.layout.left, Some(ToolWindow::Project));
    assert!(harwex_ide::tree::has_focus(&ide.ctx()), "⌘1 focused the tree");
    // In the active window, the next press hides it and gives the editor the keys.
    ide.cmd(Key::Num1);
    ide.settle();
    assert_eq!(ide.state().ws.layout.left, None);
    assert!(editor_focused(&ide));
    ide.cmd(Key::Num1);
    ide.settle();
    assert_eq!(ide.state().ws.layout.left, Some(ToolWindow::Project));
    assert!(harwex_ide::tree::has_focus(&ide.ctx()));
    // The arrows now move the tree selection, not the caret.
    let text = ide.active_text();
    ide.key(Key::ArrowDown);
    ide.settle();
    assert_eq!(ide.active_text(), text);
    assert!(harwex_ide::tree::has_focus(&ide.ctx()));
}

#[test]
fn cmd_0_and_cmd_9_focus_the_commit_tree_and_the_log() {
    let (_fx, mut ide) = open("cmd_0_9");
    ide.cmd(Key::Num0);
    ide.settle();
    assert_eq!(ide.state().ws.layout.left, Some(ToolWindow::Commit));
    assert!(focus_on(&ide, Side::Left), "the Commit tree has the keys: {:?}", focused_rect(&ide));
    ide.cmd(Key::Num9);
    ide.wait_until("log rows", |ide| ide.has("Commit Initial commit"));
    ide.settle();
    assert_eq!(ide.state().ws.layout.bottom, Some(ToolWindow::Git));
    assert!(focus_on(&ide, Side::Bottom), "the Git log has the keys: {:?}", focused_rect(&ide));
    // Esc goes back to the editor; the windows stay.
    ide.key(Key::Escape);
    ide.settle();
    assert!(editor_focused(&ide));
    assert!(shown(&ide, ToolWindow::Git) && shown(&ide, ToolWindow::Commit));
    // ⌘0 again only focuses (Commit is open but the editor has the keys); the next one hides.
    ide.cmd(Key::Num0);
    ide.settle();
    assert!(focus_on(&ide, Side::Left));
    ide.cmd(Key::Num0);
    ide.settle();
    assert_eq!(ide.state().ws.layout.left, None);
    assert!(editor_focused(&ide));
    assert_eq!(ide.state().ws.layout.bottom, Some(ToolWindow::Git), "⌘0 left the Git window alone");
}

#[test]
fn cmd_6_toggles_problems_without_a_focusable_list() {
    let (_fx, mut ide) = open("cmd_6");
    ide.cmd(Key::Num6);
    ide.settle();
    assert_eq!(ide.state().ws.layout.bottom, Some(ToolWindow::Problems));
    assert!(!editor_focused(&ide), "the Problems window has the keys");
    // Typing does not reach the editor while Problems is active.
    let text = ide.active_text();
    ide.type_text("Q");
    assert_eq!(ide.active_text(), text);
    ide.cmd(Key::Num6);
    ide.settle();
    assert_eq!(ide.state().ws.layout.bottom, None);
    assert!(editor_focused(&ide));
    // Shift+⌘6 is not ours.
    ide.cmd_shift(Key::Num6);
    ide.settle();
    assert_eq!(ide.state().ws.layout.bottom, None);
}

#[test]
fn cmd_1_works_from_a_focused_terminal() {
    let (_fx, mut ide) = open("cmd_1_terminal");
    ide.state_mut().ws.layout.left = None;
    open_terminal(&mut ide);
    assert!(terminal_focused(&ide));
    let before = screen(&ide);
    ide.cmd(Key::Num1);
    ide.settle();
    assert_eq!(ide.state().ws.layout.left, Some(ToolWindow::Project));
    assert!(harwex_ide::tree::has_focus(&ide.ctx()), "the tree took the keys from the terminal");
    assert_eq!(ide.state().ws.layout.bottom, Some(ToolWindow::Terminal), "the terminal stays open");
    assert_eq!(screen(&ide), before, "the shell got nothing");
}

#[test]
fn strip_tooltips_name_the_keys() {
    let (_fx, mut ide) = open("tooltips");
    for (w, tip) in [("Project", "Project  ⌘1"), ("Commit", "Commit  ⌘0"), ("Git", "Git  ⌘9"), ("Problems", "Problems  ⌘6"), ("Terminal", "Terminal  ⌥F12")] {
        ide.hover(&format!("{w} tool window"));
        ide.wait_real(std::time::Duration::from_millis(400));
        ide.assert_text(tip);
        ide.move_to(egui::pos2(640.0, 300.0));
        ide.settle();
    }
}

// ---------------------------------------------------------------------------------------------
// Shift+Esc from every focus

fn reference(root: &std::path::Path, rel: &str, line: usize, column: usize, text: &str, def: bool) -> Reference {
    Reference { location: Location { path: root.join(rel), line, column }, end_line: line, end_column: column + 3, line_text: text.to_string(), is_definition: def, is_write: false }
}

fn shift_esc_hides(ide: &mut Ide, w: ToolWindow) {
    ide.key_mods(SHIFT, Key::Escape);
    ide.settle();
    assert!(!shown(ide, w), "Shift+Esc hid {w:?}: {:?}", ide.state().ws.layout);
    assert!(editor_focused(ide), "the editor has the keys after hiding {w:?}");
}

#[test]
fn shift_esc_from_the_commit_tree_git_log_find_and_problems() {
    let (_fx, mut ide) = open("shift_esc");
    // Commit: a press on a file row.
    ide.cmd(Key::K);
    ide.settle();
    ide.click("src/added.ts");
    ide.settle();
    assert!(focus_on(&ide, Side::Left));
    shift_esc_hides(&mut ide, ToolWindow::Commit);

    // Git: a press on a log row.
    ide.state_mut().ws.layout.show(ToolWindow::Git);
    ide.wait_until("log rows", |ide| ide.has("Commit Initial commit"));
    ide.click("Commit Initial commit");
    ide.settle();
    assert!(focus_on(&ide, Side::Bottom));
    shift_esc_hides(&mut ide, ToolWindow::Git);

    // Find: Find Usages results, a press on a row.
    let root = ide.root();
    let refs = vec![reference(&root, "src/util.ts", 0, 16, "export function add(a: number, b: number): number {", true), reference(&root, "src/app.ts", 0, 9, "import { add } from \"./util\";", false)];
    let origin = UsageOrigin::Symbol { path: root.join("src/util.ts"), pos: ide_editor::Position::new(0, 16), word: "add".to_string() };
    let (tab, generation) = find_window::start_usages(ide.state_mut(), origin, None);
    find_window::finish_usages(ide.state_mut(), tab, generation, Ok(refs));
    ide.settle();
    ide.click("src/app.ts:1:10");
    ide.settle();
    assert!(ide.is_focused("Find results"));
    shift_esc_hides(&mut ide, ToolWindow::Find);

    // Problems: no focusable widget; a press inside makes it active.
    ide.state_mut().ws.layout.show(ToolWindow::Problems);
    ide.settle();
    let hide = ide.rect("Hide Problems");
    ide.click_at(hide.center() + egui::vec2(-300.0, 80.0));
    ide.settle();
    shift_esc_hides(&mut ide, ToolWindow::Problems);
}

// ---------------------------------------------------------------------------------------------
// ⇧⌘F12

#[test]
fn cmd_shift_f12_hides_all_and_restores() {
    let (_fx, mut ide) = open("hide_all");
    open_terminal(&mut ide);
    assert_eq!((ide.state().ws.layout.left, ide.state().ws.layout.bottom), (Some(ToolWindow::Project), Some(ToolWindow::Terminal)));
    // From the focused terminal.
    ide.cmd_shift(Key::F12);
    ide.settle();
    assert_eq!((ide.state().ws.layout.left, ide.state().ws.layout.bottom), (None, None));
    assert!(editor_focused(&ide));
    ide.cmd_shift(Key::F12);
    ide.settle();
    assert_eq!((ide.state().ws.layout.left, ide.state().ws.layout.bottom), (Some(ToolWindow::Project), Some(ToolWindow::Terminal)));
    assert_eq!(ide.state().ws.terminals.len(), 1, "the same shell came back");
    // A window opened after Hide All is what the next press hides.
    ide.cmd_shift(Key::F12);
    ide.settle();
    ide.cmd(Key::Num6);
    ide.settle();
    ide.cmd_shift(Key::F12);
    ide.settle();
    assert_eq!((ide.state().ws.layout.left, ide.state().ws.layout.bottom), (None, None));
    ide.cmd_shift(Key::F12);
    ide.settle();
    assert_eq!((ide.state().ws.layout.left, ide.state().ws.layout.bottom), (None, Some(ToolWindow::Problems)));
}
