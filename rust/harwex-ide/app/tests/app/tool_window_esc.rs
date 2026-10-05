//! Esc in a tool window gives the keys back to the editor, like IDEA; the window stays open. An
//! inner widget that needs Esc (a context menu, a rename box) takes it first. In a focused
//! terminal Esc always goes to the program. Cmd+F from a tool window opens the editor's find bar.

use crate::common::*;
use egui::Key;
use harwex_ide::find_window::{self, UsageOrigin};
use harwex_ide::lang::{Location, Reference};
use harwex_ide::layout::ToolWindow;

const SUITE: &str = "tool_window_esc";

fn open(name: &str) -> (Fixture, Ide) {
    let fx = Fixture::new(SUITE, name);
    let repo = changed_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/app.ts");
    (fx, ide)
}

/// The active tab's editor has the keys (a Find preview may show an editor of the same file).
fn editor_focused(ide: &Ide) -> bool {
    let ctx = ide.ctx();
    ide.state().ws.tabs.active_editor().is_some_and(|e| e.view.owns_focus(&ctx))
}

/// Esc gives the editor the keys: typing lands in the editor, and the window stays open.
fn esc_returns_to_editor(ide: &mut Ide, w: ToolWindow) {
    assert!(!editor_focused(ide), "{w:?}: the editor has no focus before Esc");
    ide.key(Key::Escape);
    ide.settle();
    assert!(editor_focused(ide), "{w:?}: Esc focused the editor");
    let layout = ide.state().ws.layout;
    assert!(layout.left == Some(w) || layout.bottom == Some(w), "{w:?} stays open: {layout:?}");
    let before = ide.active_text();
    ide.type_text("Q");
    assert_eq!(ide.active_text(), format!("Q{before}"), "{w:?}: typing reaches the editor");
    ide.cmd(Key::Z);
    ide.settle();
}

#[test]
fn esc_from_project_commit_git_and_problems() {
    let (_fx, mut ide) = open("windows");
    // Project: the tree has the focus after a click on a row.
    ide.click("src");
    ide.settle();
    assert!(harwex_ide::tree::has_focus(&ide.ctx()));
    esc_returns_to_editor(&mut ide, ToolWindow::Project);

    // Commit: from a file row, then from the message box.
    ide.cmd(Key::K);
    ide.settle();
    assert_eq!(ide.state().ws.layout.left, Some(ToolWindow::Commit));
    esc_returns_to_editor(&mut ide, ToolWindow::Commit);
    ide.click("src/added.ts");
    ide.settle();
    esc_returns_to_editor(&mut ide, ToolWindow::Commit);

    // Git: a press on a log row.
    ide.state_mut().ws.layout.show(ToolWindow::Git);
    ide.wait_until("log rows", |ide| ide.has("Commit Initial commit"));
    ide.click("Commit Initial commit");
    ide.settle();
    esc_returns_to_editor(&mut ide, ToolWindow::Git);

    // Problems: no focusable widget; a press inside the window makes it active.
    ide.state_mut().ws.layout.show(ToolWindow::Problems);
    ide.settle();
    let hide = ide.rect("Hide Problems");
    ide.click_at(hide.center() + egui::vec2(-300.0, 80.0));
    ide.settle();
    esc_returns_to_editor(&mut ide, ToolWindow::Problems);
}

fn reference(root: &std::path::Path, rel: &str, line: usize, column: usize, text: &str, def: bool) -> Reference {
    Reference {
        location: Location { path: root.join(rel), line, column },
        end_line: line,
        end_column: column + 3,
        line_text: text.to_string(),
        is_definition: def,
        is_write: false,
    }
}

#[test]
fn esc_from_find_results() {
    let (_fx, mut ide) = open("find");
    let root = ide.root();
    let refs = vec![
        reference(&root, "src/util.ts", 0, 16, "export function add(a: number, b: number): number {", true),
        reference(&root, "src/app.ts", 0, 9, "import { add } from \"./util\";", false),
        reference(&root, "src/app.ts", 3, 12, "  const x = add(40, 2);", false),
    ];
    let origin = UsageOrigin::Symbol { path: root.join("src/util.ts"), pos: ide_editor::Position::new(0, 16), word: "add".to_string() };
    let (tab, generation) = find_window::start_usages(ide.state_mut(), origin, None);
    find_window::finish_usages(ide.state_mut(), tab, generation, Ok(refs));
    ide.settle();
    // The usages search opened util.ts in a preview, not a tab: app.ts stays the active editor.
    ide.click("src/app.ts:1:10");
    ide.settle();
    assert!(ide.is_focused("Find results"));
    esc_returns_to_editor(&mut ide, ToolWindow::Find);
}

#[test]
fn context_menu_takes_the_first_esc() {
    let (_fx, mut ide) = open("context_menu");
    ide.right_click("src");
    ide.settle();
    assert!(ide.ctx().is_context_menu_open());
    ide.key(Key::Escape);
    ide.settle();
    assert!(!ide.ctx().is_context_menu_open(), "the first Esc closed the menu");
    assert!(!editor_focused(&ide), "the first Esc did not move the focus");
    // The menu leaves the focus on the tree or nowhere; both count as the Project window.
    esc_returns_to_editor(&mut ide, ToolWindow::Project);
}

#[test]
fn terminal_rename_takes_the_esc() {
    let (_fx, mut ide) = open("rename");
    ide.key_mods(ALT, Key::F12);
    ide.wait_for("terminal spawned", |s| !s.ws.terminals.is_empty());
    ide.settle();
    let tab = ide.rects("zsh").into_iter().find(|r| (r.height() - 24.0).abs() < 0.5).expect("terminal tab");
    ide.right_click_at(tab.center());
    ide.click("Rename Tab…");
    ide.settle();
    assert!(ide.state().ws.terminals.is_renaming());
    ide.key(Key::Escape);
    ide.settle();
    assert!(!ide.state().ws.terminals.is_renaming(), "Esc cancelled the rename");
    assert!(!editor_focused(&ide), "Esc only cancelled the rename");
    assert_eq!(ide.state().ws.layout.bottom, Some(ToolWindow::Terminal));
}

#[test]
fn esc_in_the_terminal_reaches_the_shell() {
    let (_fx, mut ide) = open("terminal");
    ide.key_mods(ALT, Key::F12);
    ide.wait_for("terminal spawned", |s| !s.ws.terminals.is_empty());
    let screen = |ide: &Ide| ide.state().ws.terminals.terminal(0).map(|t| t.screen_text()).unwrap_or_default();
    ide.wait_until("shell prompt", move |ide| screen(ide).lines().any(|l| l.starts_with('$')));
    // `cat -v` prints the Esc byte as ^[ when the line ends.
    ide.type_text("cat -v\n");
    ide.wait_real(std::time::Duration::from_millis(300));
    ide.key(Key::Escape);
    ide.settle();
    assert!(ide.state().ws.terminals.has_focus(&ide.ctx()), "the focus stays in the terminal");
    ide.key(Key::Enter);
    ide.wait_until("cat echoed Esc", move |ide| screen(ide).lines().any(|l| l == "^["));
    assert!(!editor_focused(&ide));
}

#[test]
fn cmd_f_from_a_tool_window_opens_the_editor_find_bar() {
    let (_fx, mut ide) = open("cmd_f");
    ide.click("src");
    ide.settle();
    assert!(harwex_ide::tree::has_focus(&ide.ctx()));
    ide.cmd(Key::F);
    ide.settle();
    let bar_open = ide.state().ws.tabs.active_editor().expect("editor").view.find().is_open();
    assert!(bar_open, "Cmd+F opened the editor's find bar");
    assert!(ide.is_focused("Search Query"), "the query field has the keys");
    // A text field in a tool window keeps Cmd+F to itself (no find bar toggle from there).
    ide.key(Key::Escape);
    ide.settle();
    ide.cmd(Key::K);
    ide.settle();
    ide.cmd(Key::F);
    ide.settle();
    assert!(!ide.state().ws.tabs.active_editor().expect("editor").view.find().is_open(), "the message box kept Cmd+F");
}

#[test]
fn without_an_editor_esc_does_nothing() {
    let (_fx, mut ide) = open("no_editor");
    ide.cmd(Key::W);
    ide.settle();
    assert!(ide.state().ws.tabs.active_editor().is_none());
    ide.state_mut().ws.layout.show(ToolWindow::Problems);
    ide.settle();
    let hide = ide.rect("Hide Problems");
    ide.click_at(hide.center() + egui::vec2(-300.0, 80.0));
    ide.key(Key::Escape);
    ide.settle();
    assert_eq!(ide.state().ws.layout.bottom, Some(ToolWindow::Problems));
    assert_eq!(ide.state().ws.layout.left, Some(ToolWindow::Project));
}
