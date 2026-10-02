//! Code navigation through tsserver: Cmd+B, Cmd+click and the context menu into a dependency's
//! `.d.ts` and `.js`, the multi-target chooser, workspace packages, back/forward, Find Usages
//! and the hover tooltip. Skipped (with a printed reason) when node or TypeScript is missing.

mod common;

use common::*;
use egui::Key;

const SUITE: &str = "navigation";

fn open_main(name: &str) -> Option<(Fixture, Ide)> {
    if skip_without_tsserver(name) {
        return None;
    }
    let fx = Fixture::new(SUITE, name);
    let repo = ts_project(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/main.ts");
    Some((fx, ide))
}

fn active_path(ide: &Ide) -> String {
    ide.state().tabs.active_editor().map(|e| e.path.display().to_string()).unwrap_or_default()
}

fn wait_for_file(ide: &mut Ide, suffix: &str) {
    let s = suffix.to_string();
    ide.wait_until(&format!("jump to {suffix}"), move |ide| active_path(ide).ends_with(&s));
    ide.settle();
}

#[test]
fn cmd_b_jumps_into_dependency_types() {
    let Some((_fx, mut ide)) = open_main("cmd_b") else { return };
    // `greet` in `const message = greet("world");`
    let p = ide.caret_pos(5, 17);
    ide.click_at(p);
    ide.cmd(Key::B);
    wait_for_file(&mut ide, "node_modules/fake-lib/index.d.ts");
    assert_eq!(ide.cursor(), (1, 24), "the caret lands on the declaration name");
    assert!(ide.state().tabs.active_editor().expect("editor").read_only, "dependency files open read-only");
    ide.snapshot("greet_in_dts");

    // Back (Cmd+[) returns to the place of the request, Forward (Cmd+]) goes there again.
    ide.cmd(Key::OpenBracket);
    wait_for_file(&mut ide, "src/main.ts");
    assert_eq!(ide.cursor(), (5, 17));
    ide.cmd(Key::CloseBracket);
    wait_for_file(&mut ide, "fake-lib/index.d.ts");
    assert_eq!(ide.cursor(), (1, 24));
}

#[test]
fn cmd_click_jumps_to_local_module() {
    let Some((_fx, mut ide)) = open_main("cmd_click") else { return };
    // Cmd+click on `localHelper` in `const doubled = localHelper(21);`
    let p = ide.char_pos(6, 20);
    ide.click_button_at(p, egui::PointerButton::Primary, CMD);
    wait_for_file(&mut ide, "src/local.ts");
    assert_eq!(ide.cursor(), (0, 16));
    assert_eq!(ide.state().nav.back.len(), 1, "the jump recorded where it came from");
}

#[test]
fn context_menu_go_to_declaration_into_workspace_package() {
    let Some((fx, mut ide)) = open_main("workspace") else { return };
    // `wsUtil` in `const fromWs = wsUtil();`, through the right-click menu.
    let p = ide.char_pos(7, 17);
    ide.right_click_at(p);
    ide.settle();
    ide.click("Go to Declaration");
    wait_for_file(&mut ide, "src/index.ts");
    // tsserver reports the real path behind the node_modules/@ws/util symlink.
    let real = std::fs::canonicalize(fx.path("repo/packages/util/src/index.ts")).expect("real path");
    assert_eq!(active_path(&ide), real.display().to_string());
    assert!(!ide.state().tabs.active_editor().expect("editor").read_only, "workspace sources stay editable");
    assert_eq!(ide.cursor(), (0, 16));
}

#[test]
fn go_to_source_definition_opens_the_js() {
    let Some((_fx, mut ide)) = open_main("source_definition") else { return };
    let p = ide.char_pos(5, 18);
    ide.right_click_at(p);
    ide.settle();
    ide.click("Go to Source Definition");
    ide.wait_until("source definition result", |ide| active_path(ide).ends_with("fake-lib/index.js") || ide.state().nav.popup.is_some());
    ide.settle();
    if let Some(popup) = &ide.state().nav.popup {
        // Several places in the .js define `greet`: every choice is in the source file.
        assert!(popup.items.iter().all(|t| t.location.path.ends_with("fake-lib/index.js")));
        ide.key(Key::Enter);
        wait_for_file(&mut ide, "fake-lib/index.js");
    }
    assert!(active_path(&ide).ends_with("fake-lib/index.js"));
    let line = ide.cursor().0;
    assert!(ide.active_line(line).contains("greet"), "landed on {:?}", ide.active_line(line));
    ide.snapshot("greet_in_js");
}

#[test]
fn chooser_keys_do_not_reach_the_editor() {
    let Some((_fx, mut ide)) = open_main("chooser") else { return };
    let before = ide.active_text();
    // `Options` has two declarations (interface merging), so Cmd+B shows the chooser.
    let p = ide.caret_pos(4, 13);
    ide.click_at(p);
    ide.cmd(Key::B);
    ide.wait_for("chooser", |s| s.nav.popup.is_some());
    ide.settle();
    let popup = ide.state().nav.popup.as_ref().expect("popup");
    assert_eq!(popup.items.len(), 2);
    assert!(popup.title.contains("Options"));
    ide.snapshot("chooser");

    // Down + Enter pick the second declaration. Regression: Enter used to reach the editor
    // behind the popup and insert a newline before the jump.
    ide.key(Key::ArrowDown);
    assert_eq!(ide.state().nav.popup.as_ref().map(|p| p.selected), Some(1));
    ide.key(Key::Enter);
    wait_for_file(&mut ide, "fake-lib/index.d.ts");
    assert_eq!(ide.cursor(), (7, 17));
    let main = ide.state().tabs.editors().find(|e| e.path.ends_with("src/main.ts")).expect("main.ts tab");
    assert_eq!(main.doc.text(), before, "no key leaked into main.ts");
    assert!(!main.doc.is_dirty());

    // Escape closes the chooser without a jump; arrows do not move the caret behind it.
    ide.cmd(Key::OpenBracket);
    wait_for_file(&mut ide, "src/main.ts");
    ide.cmd(Key::B);
    ide.wait_for("chooser again", |s| s.nav.popup.is_some());
    let caret = ide.cursor();
    ide.key(Key::ArrowDown);
    ide.key(Key::Escape);
    ide.settle();
    assert!(ide.state().nav.popup.is_none());
    assert_eq!(ide.cursor(), caret);
    assert!(active_path(&ide).ends_with("src/main.ts"));
}

#[test]
fn find_usages_fills_the_tool_window() {
    let Some((_fx, mut ide)) = open_main("usages") else { return };
    let p = ide.char_pos(5, 18);
    ide.right_click_at(p);
    ide.settle();
    ide.click("Find Usages");
    ide.wait_for("usages", |s| !s.usages.searching && !s.usages.groups.is_empty());
    ide.settle();
    assert_eq!(ide.state().layout.bottom, Some(harwex_ide::layout::ToolWindow::Usages));
    let total: usize = ide.state().usages.groups.iter().map(|g| g.refs.len()).sum();
    let in_main = ide.state().usages.groups.iter().find(|g| g.path.ends_with("src/main.ts")).map_or(0, |g| g.refs.len());
    // The import, the call and the second call in main.ts, plus the declaration.
    assert_eq!(in_main, 3);
    assert_eq!(total, 4);
    ide.assert_text("Usages of greet: 4 usages in 2 files");
    ide.snapshot("usages");

    // A click on a usage row navigates to it.
    ide.click_containing("console.log(message");
    ide.settle();
    assert_eq!(ide.cursor().0, 8);
}

#[test]
fn hover_shows_quick_info() {
    let Some((_fx, mut ide)) = open_main("hover") else { return };
    let p = ide.char_pos(5, 18);
    ide.move_to(p);
    // The request goes out after the pointer rests 500 ms on one identifier.
    ide.wait_real(std::time::Duration::from_millis(650));
    ide.wait_for("quick info", |s| s.nav.hover.info().is_some());
    // The hovered name is the imported alias of the dependency's function.
    ide.wait_until("quick info tooltip", |ide| ide.shows_text("(alias) greet(name: string): string"));
    ide.assert_text("Says hello.");
    ide.snapshot_here("hover_greet");

    // Holding Cmd hides the tooltip (Cmd+hover is for the link underline).
    ide.hover_with(CMD, p);
    ide.steps(3);
    assert!(!ide.shows_text("(alias) greet(name: string): string"));
    ide.release_modifiers();
}
