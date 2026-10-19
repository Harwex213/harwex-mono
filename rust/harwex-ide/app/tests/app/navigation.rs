//! Code navigation through tsserver: Cmd+B, Cmd+click and the context menu into a dependency's
//! `.d.ts` and `.js`, the multi-target chooser, workspace packages, back/forward, Find Usages
//! and the hover tooltip. Skipped (with a printed reason) when node or TypeScript is missing.

use crate::common::*;
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
    ide.state().ws.tabs.active_editor().map(|e| e.path.display().to_string()).unwrap_or_default()
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
    assert!(ide.state().ws.tabs.active_editor().expect("editor").read_only, "dependency files open read-only");
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
    assert_eq!(ide.state().ws.nav.back.len(), 1, "the jump recorded where it came from");
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
    let real = dunce::canonicalize(fx.path("repo/packages/util/src/index.ts")).expect("real path");
    assert_eq!(active_path(&ide), real.display().to_string());
    assert!(!ide.state().ws.tabs.active_editor().expect("editor").read_only, "workspace sources stay editable");
    assert_eq!(ide.cursor(), (0, 16));
}

#[test]
fn go_to_source_definition_opens_the_js() {
    let Some((_fx, mut ide)) = open_main("source_definition") else { return };
    let p = ide.char_pos(5, 18);
    ide.right_click_at(p);
    ide.settle();
    ide.click("Go to Source Definition");
    ide.wait_until("source definition result", |ide| active_path(ide).ends_with("fake-lib/index.js") || ide.state().ws.nav.popup.is_some());
    ide.settle();
    if let Some(popup) = &ide.state().ws.nav.popup {
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
    ide.wait_for("chooser", |s| s.ws.nav.popup.is_some());
    ide.settle();
    let popup = ide.state().ws.nav.popup.as_ref().expect("popup");
    assert_eq!(popup.items.len(), 2);
    assert!(popup.title.contains("Options"));
    ide.snapshot("chooser");

    // Down + Enter pick the second declaration. Regression: Enter used to reach the editor
    // behind the popup and insert a newline before the jump.
    ide.key(Key::ArrowDown);
    assert_eq!(ide.state().ws.nav.popup.as_ref().map(|p| p.selected), Some(1));
    ide.key(Key::Enter);
    wait_for_file(&mut ide, "fake-lib/index.d.ts");
    assert_eq!(ide.cursor(), (7, 17));
    let main = ide.state().ws.tabs.editors().find(|e| e.path.ends_with("src/main.ts")).expect("main.ts tab");
    assert_eq!(main.doc.text(), before, "no key leaked into main.ts");
    assert!(!main.doc.is_dirty());

    // Escape closes the chooser without a jump; arrows do not move the caret behind it.
    ide.cmd(Key::OpenBracket);
    wait_for_file(&mut ide, "src/main.ts");
    ide.cmd(Key::B);
    ide.wait_for("chooser again", |s| s.ws.nav.popup.is_some());
    let caret = ide.cursor();
    ide.key(Key::ArrowDown);
    ide.key(Key::Escape);
    ide.settle();
    assert!(ide.state().ws.nav.popup.is_none());
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
    let done = |s: &harwex_ide::AppState| s.ws.find_window.active_tab().is_some_and(|t| !t.searching && !t.items.is_empty());
    ide.wait_for("usages", done);
    ide.settle();
    assert_eq!(ide.state().ws.layout.bottom, Some(harwex_ide::layout::ToolWindow::Find));
    let tab = ide.state().ws.find_window.active_tab().expect("usages tab");
    assert_eq!(tab.title, "greet in Project Files");
    let in_main = tab.items.iter().filter(|i| i.path.ends_with("src/main.ts")).count();
    // The import, the call and the second call in main.ts, plus the declaration.
    assert_eq!(in_main, 3);
    assert_eq!(tab.items.len(), 4);
    for label in ["Imports group", "Writes group", "Reads group", "Find folder src in Reads"] {
        assert!(ide.has(label), "{label}: {:?}", ide.labels());
    }
    ide.snapshot("usages");

    // ⟳ asks the server again into the same tab.
    ide.click("Rerun");
    ide.wait_for("rerun", done);
    assert_eq!(ide.state().ws.find_window.tabs.len(), 1);
    assert_eq!(ide.state().ws.find_window.active_tab().map(|t| t.items.len()), Some(4));

    // Previous Occurrence wraps to the last usage and scrolls to it; a double click opens it.
    ide.click("Previous Occurrence");
    ide.settle();
    ide.double_click("src/main.ts:9:45");
    ide.settle();
    assert_eq!(ide.cursor(), (8, 44));
}

#[test]
fn hover_shows_quick_info() {
    let Some((_fx, mut ide)) = open_main("hover") else { return };
    let p = ide.char_pos(5, 18);
    ide.move_to(p);
    // The request goes out after the pointer rests 500 ms on one identifier.
    ide.wait_real(std::time::Duration::from_millis(650));
    ide.wait_for("quick info", |s| s.ws.nav.hover.info().is_some());
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

/// A workspace of four TypeScript projects (task 121). Package `@ws/a` declares `rootStore` in
/// `src/common/services/store.ts` and re-exports it from `src/common/index.ts` (its `./common`
/// export) and `src/index.ts` (its entry). B imports it from `@ws/a/common`, C from `@ws/a`; D
/// has its own `rootStore`. No tsconfig has project references, so only the pre-filter makes
/// the server load B and C.
fn packages_project(dir: std::path::PathBuf) -> Repo {
    let r = Repo::init(dir);
    let tsconfig = "{\"compilerOptions\":{\"strict\":true,\"module\":\"esnext\",\"target\":\"es2020\",\"moduleResolution\":\"bundler\"},\"include\":[\"src\"]}\n";
    r.write(".gitignore", "node_modules/\n");
    r.write("package.json", "{ \"name\": \"usages-ws\", \"private\": true, \"workspaces\": [\"packages/*\"] }\n");
    r.write("packages/a/package.json", "{\"name\":\"@ws/a\",\"version\":\"1.0.0\",\"exports\":{\".\":\"./src/index.ts\",\"./common\":\"./src/common/index.ts\"}}\n");
    r.write("packages/a/src/common/services/store.ts", "export const rootStore = { size: 1 };\n\nexport function sizeOf(): number {\n  return rootStore.size;\n}\n");
    r.write("packages/a/src/common/index.ts", "export { rootStore, sizeOf } from \"./services/store\";\n");
    r.write("packages/a/src/index.ts", "export * from \"./common\";\n");
    r.write("packages/b/src/use.ts", "import { rootStore } from \"@ws/a/common\";\n\nexport const b = rootStore.size + 1;\n");
    r.write("packages/c/src/use.ts", "import { rootStore, sizeOf } from \"@ws/a\";\n\nexport const c = rootStore.size + sizeOf();\nconsole.log(rootStore);\n");
    r.write("packages/d/src/local.ts", "export const rootStore = { size: 2 };\n");
    r.write("packages/d/src/use.ts", "import { rootStore } from \"./local\";\n\nexport const d = rootStore.size;\n");
    std::fs::create_dir_all(r.dir.join("node_modules/@ws")).expect("scope dir");
    for p in ["a", "b", "c", "d"] {
        r.write(&format!("packages/{p}/tsconfig.json"), tsconfig);
        if p != "a" {
            r.write(&format!("packages/{p}/package.json"), &format!("{{\"name\":\"@ws/{p}\",\"version\":\"1.0.0\"}}\n"));
        }
        symlink_dir(format!("../../packages/{p}"), r.dir.join(format!("node_modules/@ws/{p}"))).expect("workspace link");
    }
    symlink_dir(typescript().expect("TypeScript 5"), r.dir.join("node_modules/typescript")).expect("typescript link");
    r.commit_all("TS workspace");
    r
}

fn open_store(name: &str) -> Option<(Fixture, Ide)> {
    if skip_without_tsserver(name) {
        return None;
    }
    let fx = Fixture::new(SUITE, name);
    let repo = packages_project(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("packages/a/src/common/services/store.ts");
    Some((fx, ide))
}

#[test]
fn find_usages_across_packages() {
    let Some((_fx, mut ide)) = open_store("usages_packages") else { return };
    // `rootStore` in `export const rootStore = ...`.
    let p = ide.char_pos(0, 15);
    ide.right_click_at(p);
    ide.settle();
    ide.click("Find Usages");
    let done = |s: &harwex_ide::AppState| s.ws.find_window.active_tab().is_some_and(|t| !t.searching && !t.items.is_empty());
    ide.wait_for("usages", done);
    ide.settle();
    let tab = ide.state().ws.find_window.active_tab().expect("usages tab");
    assert_eq!(tab.title, "rootStore in Project Files");
    let root = ide.root();
    let mut files: Vec<String> = tab.items.iter().map(|i| i.path.strip_prefix(&root).unwrap_or(&i.path).to_string_lossy().replace('\\', "/")).collect();
    files.sort();
    files.dedup();
    assert_eq!(files, ["packages/a/src/common/index.ts", "packages/a/src/common/services/store.ts", "packages/b/src/use.ts", "packages/c/src/use.ts"], "D's own rootStore is not a usage");
    assert_eq!(tab.items.iter().filter(|i| i.path.ends_with("packages/c/src/use.ts")).count(), 3);
    assert!(tab.error.is_none());

    // ⟳: the projects stay loaded, the answer is the same.
    ide.click("Rerun");
    ide.wait_for("rerun", done);
    assert_eq!(ide.state().ws.find_window.active_tab().map(|t| t.items.len()), Some(8));
}

#[test]
fn find_usages_cancel_closes_quietly() {
    let Some((_fx, mut ide)) = open_store("usages_cancel") else { return };
    let p = ide.caret_pos(0, 15);
    ide.click_at(p);
    // Find Usages, then the tab closes at once: the search stops and its answer is dropped.
    let path = ide.state().ws.tabs.active_editor().expect("editor").path.clone();
    harwex_ide::nav::usages(ide.state_mut(), path, ide_editor::Position::new(0, 15), "rootStore".into(), None);
    assert_eq!(ide.state().ws.find_window.tabs.len(), 1);
    harwex_ide::find_window::close_tab(ide.state_mut(), 0);
    ide.wait_for("languages idle", |s| s.ws.langs.queued() == 0 && s.jobs.running().is_empty());
    ide.settle();
    assert!(ide.state().ws.find_window.tabs.is_empty());
    assert!(!ide.shows_text("Find Usages failed"), "a cancel is no error");
}

#[test]
fn rename_symbol_across_packages() {
    let Some((fx, mut ide)) = open_store("rename_packages") else { return };
    let p = ide.caret_pos(0, 15);
    ide.click_at(p);
    ide.key_mods(egui::Modifiers::SHIFT, Key::F6);
    ide.settle();
    ide.type_text("mainStore");
    ide.key(Key::Enter);
    ide.wait_until("rename preview", |ide| ide.shows_text("Rename `rootStore` to `mainStore`: 8 occurrences in 4 files"));
    ide.snapshot("rename_packages_preview");
    ide.key(Key::Enter);
    let c = fx.path("repo/packages/c/src/use.ts");
    ide.wait_until("C renamed", move |_| std::fs::read_to_string(&c).is_ok_and(|t| t.contains("mainStore")));
    ide.settle();
    let read = |rel: &str| std::fs::read_to_string(fx.path(&format!("repo/{rel}"))).expect(rel);
    assert_eq!(read("packages/b/src/use.ts"), "import { mainStore } from \"@ws/a/common\";\n\nexport const b = mainStore.size + 1;\n");
    assert_eq!(read("packages/c/src/use.ts"), "import { mainStore, sizeOf } from \"@ws/a\";\n\nexport const c = mainStore.size + sizeOf();\nconsole.log(mainStore);\n");
    assert_eq!(read("packages/a/src/common/index.ts"), "export { mainStore, sizeOf } from \"./services/store\";\n");
    assert!(read("packages/d/src/use.ts").contains("rootStore") && read("packages/d/src/local.ts").contains("rootStore"), "D keeps its own name");
    assert!(ide.active_text().starts_with("export const mainStore = "));
}
