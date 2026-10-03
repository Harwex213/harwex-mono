//! The Project tree's context menu and file operations: the menu on a file and a folder, Cut
//! (grey name) and Escape, Paste as move and copy with a collision, New File with folders,
//! Rename with the import preview (tsserver and rust-analyzer), safe Delete to the (recorded)
//! Trash, Replace in Files, exclusion, paths, Open In, Git Rollback and Reload from Disk.
//!
//! The app gets a recording platform in deterministic mode, so nothing here touches the real
//! Trash, Finder or clipboard.

mod common;

use std::time::{Duration, Instant};

use common::*;
use egui::{Event, Key, Modifiers};

const SUITE: &str = "project_menu";

fn reveal(ide: &mut Ide, rel: &str) {
    let root = ide.root();
    let path = root.join(rel);
    ide.state_mut().tree.reveal(&root, &path);
    ide.settle();
}

/// Sends a clipboard event the way macOS delivers ⌘X / ⌘C / ⌘V: only the event, with the
/// modifiers held.
fn clipboard_event(ide: &mut Ide, ev: Event, mods: Modifiers) {
    ide.harness.input_mut().modifiers = mods;
    ide.harness.input_mut().events.push(ev);
    ide.step();
    ide.harness.input_mut().modifiers = Modifiers::NONE;
    ide.settle();
}

fn calls(ide: &Ide) -> Vec<String> {
    ide.state().platform.calls()
}

fn dialog_open(ide: &Ide) -> bool {
    ide.state().tree_ops.dialog.is_some()
}

#[test]
fn menu_on_file_and_folder() {
    let fx = Fixture::new(SUITE, "menu");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    reveal(&mut ide, "src/util.ts");

    ide.right_click("src");
    ide.settle();
    let root = ide.root();
    assert_eq!(ide.state().tree.selected.as_deref(), Some(root.join("src").as_path()), "right-click selects the row");
    for label in ["New File...", "Cut", "Paste", "Copy Absolute Path", "Find in Files...", "Replace in Files...", "Rename...", "Delete...", "Open In Terminal", "Git Rollback...", "Mark Directory as Excluded"] {
        assert!(ide.has(label), "menu item {label}");
    }
    assert!(!ide.is_enabled("Paste"), "nothing cut or copied yet");
    ide.snapshot("menu_folder");
    ide.key(Key::Escape);
    ide.settle();

    ide.right_click("src/app.ts");
    ide.settle();
    assert_eq!(ide.state().tree.selected.as_deref(), Some(root.join("src/app.ts").as_path()));
    assert!(!ide.has("Mark Directory as Excluded"), "folders only");
    ide.snapshot("menu_file");

    // Copy Project Path from the menu, ⇧⌘C (a Copy event with Shift) and ⌥C from the keys.
    ide.click("Copy Project Path");
    ide.settle();
    assert_eq!(calls(&ide).last().map(String::as_str), Some("copy src/app.ts"));
    assert!(ide.state().tree_ops.dialog.is_none());
    clipboard_event(&mut ide, Event::Copy, CMD_SHIFT);
    assert_eq!(calls(&ide).last().cloned(), Some(format!("copy {}", root.join("src/app.ts").display())));
    ide.key_mods(ALT, Key::C);
    assert_eq!(calls(&ide).last().map(String::as_str), Some("copy src/app.ts"));
    assert!(ide.state().tree_ops.clip.is_none(), "path copies do not mark the file");

    // Open In: Finder goes through the platform, Terminal opens a tab in the file's folder.
    ide.right_click("src/app.ts");
    ide.settle();
    ide.click("Open In Finder");
    ide.settle();
    assert_eq!(calls(&ide).last().cloned(), Some(format!("reveal {}", root.join("src/app.ts").display())));
    ide.right_click("src/app.ts");
    ide.settle();
    let before = ide.state().terminals.len();
    ide.click("Open In Terminal");
    ide.settle();
    assert_eq!(ide.state().terminals.len(), before + 1);
    let term = ide.state().terminals.terminal(ide.state().terminals.active_index()).expect("terminal");
    assert_eq!(term.cwd(), root.join("src"));
}

#[test]
fn cut_turns_grey_and_escape_cancels() {
    let fx = Fixture::new(SUITE, "cut");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    reveal(&mut ide, "src/util.ts");
    ide.click("src/util.ts");
    ide.settle();
    clipboard_event(&mut ide, Event::Cut, CMD);
    let root = ide.root();
    assert!(ide.state().tree_ops.is_cut(&root.join("src/util.ts")));
    assert_eq!(calls(&ide).last().map(String::as_str), Some("copy util.ts"), "the name goes to the clipboard so ⌘V arrives");
    assert!(tree_focused(&ide));
    ide.snapshot("cut_grey");

    ide.key(Key::Escape);
    ide.settle();
    assert!(ide.state().tree_ops.clip.is_none(), "Escape cancels the cut");
    assert!(tree_focused(&ide), "the tree keeps the focus");
}

fn tree_focused(ide: &Ide) -> bool {
    harwex_ide::tree::has_focus(&ide.ctx())
}

#[test]
fn paste_moves_and_copies() {
    let fx = Fixture::new(SUITE, "paste");
    let repo = basic_repo(fx.path("repo"));
    repo.write("other/util.ts", "export const other = 1;\n");
    let mut ide = Ide::open(SUITE, &repo.dir);
    let root = ide.root();
    reveal(&mut ide, "src/util.ts");
    reveal(&mut ide, "other/util.ts");

    // Copy src/util.ts, paste on other/: the name exists, so the collision dialog asks.
    ide.click("src/util.ts");
    clipboard_event(&mut ide, Event::Copy, CMD);
    ide.click("other");
    clipboard_event(&mut ide, Event::Paste("util.ts".into()), CMD);
    ide.wait_for("collision dialog", |s| s.tree_ops.dialog.is_some());
    ide.settle();
    ide.assert_text("\"util.ts\" already exists in other.");
    ide.snapshot("paste_collision");
    ide.click("Keep Both");
    ide.wait_for("copy", |_| root.join("other/util copy.ts").is_file());
    ide.settle();
    assert_eq!(repo.read("other/util copy.ts"), repo.read("src/util.ts"));
    assert_eq!(repo.read("other/util.ts"), "export const other = 1;\n", "Keep Both leaves the old file");

    // Overwrite moves the old file to the (recorded) Trash first.
    ide.click("other");
    clipboard_event(&mut ide, Event::Paste("util.ts".into()), CMD);
    ide.wait_for("collision dialog", |s| s.tree_ops.dialog.is_some());
    ide.click("Overwrite");
    ide.wait_for("overwrite", |_| std::fs::read_to_string(root.join("other/util.ts")).is_ok_and(|t| t.contains("add")));
    ide.settle();
    assert!(calls(&ide).contains(&format!("trash {}", root.join("other/util.ts").display())));

    // Cut src/core/deep/nested.ts and paste it on docs/: a move. The open tab follows.
    reveal(&mut ide, "src/core/deep/nested.ts");
    ide.open_file("src/core/deep/nested.ts");
    ide.click("src/core/deep/nested.ts");
    clipboard_event(&mut ide, Event::Cut, CMD);
    ide.click("docs");
    clipboard_event(&mut ide, Event::Paste("nested.ts".into()), CMD);
    ide.wait_for("moved", |_| root.join("docs/nested.ts").is_file() && !root.join("src/core/deep/nested.ts").exists());
    ide.settle();
    assert!(ide.state().tree_ops.clip.is_none(), "the cut is used up");
    let tab = ide.state().tabs.active_editor().expect("tab");
    assert_eq!(tab.path, root.join("docs/nested.ts"), "the tab follows the move");
    assert_eq!(ide.state().tree.selected.as_deref(), Some(root.join("docs/nested.ts").as_path()));
    assert!(ide.has("docs/nested.ts"), "the tree shows the new place");
    assert!(!ide.has("src/core/deep/nested.ts"));
}

#[test]
fn new_file_creates_folders_and_opens_it() {
    let fx = Fixture::new(SUITE, "new_file");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    reveal(&mut ide, "src/util.ts");
    ide.click("src");
    ide.cmd(Key::Period);
    ide.settle();
    assert!(dialog_open(&ide));
    ide.type_text("a/b/c.ts");
    ide.snapshot("new_file_dialog");
    ide.key(Key::Enter);
    let root = ide.root();
    ide.wait_for("file created and opened", |s| s.tabs.active_editor().is_some_and(|e| e.path == root.join("src/a/b/c.ts")));
    ide.settle();
    assert!(root.join("src/a/b/c.ts").is_file());
    assert!(ide.has("src/a/b/c.ts"), "the tree reveals the new file");

    // A name that exists stays in the dialog with an error.
    ide.right_click("src");
    ide.settle();
    ide.click("New File...");
    ide.settle();
    ide.type_text("util.ts\n");
    ide.wait_for("error", |s| matches!(&s.tree_ops.dialog, Some(harwex_ide::tree_menu::Dialog::NewEntry(n)) if n.error.is_some()));
    ide.key(Key::Escape);
    ide.settle();
    assert!(!dialog_open(&ide));
}

#[test]
fn rename_updates_imports_after_a_preview() {
    if skip_without_tsserver("rename_updates_imports_after_a_preview") {
        return;
    }
    let fx = Fixture::new(SUITE, "rename_ts");
    let repo = ts_project(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/main.ts");
    reveal(&mut ide, "src/local.ts");
    ide.click("src/local.ts");
    ide.key_mods(SHIFT, Key::F6);
    ide.settle();
    assert!(dialog_open(&ide));
    // The name without the extension is selected, so typing replaces it.
    ide.type_text("helpers");
    ide.key(Key::Enter);
    ide.wait_for("preview", |s| matches!(&s.tree_ops.dialog, Some(harwex_ide::tree_menu::Dialog::Rename(r)) if matches!(r.phase, harwex_ide::tree_menu::RenamePhase::Preview { .. })));
    ide.settle();
    ide.assert_text("Rename to \"helpers.ts\" and update 1 import in 1 file");
    ide.snapshot("rename_preview");
    ide.key(Key::Enter);
    let root = ide.root();
    ide.wait_for("renamed", |_| root.join("src/helpers.ts").is_file() && !root.join("src/local.ts").exists());
    ide.settle();
    // main.ts is open: the edit went through the document (one undo step) and was saved.
    let main = ide.state().tabs.editors().find(|e| e.path.ends_with("src/main.ts")).expect("main.ts tab");
    assert!(main.doc.text().contains("import { localHelper } from \"./helpers\";"), "{}", main.doc.text());
    assert!(main.doc.can_undo());
    ide.wait_for("saved", |s| s.tabs.editors().all(|e| !e.doc.is_dirty()));
    assert!(repo.read("src/main.ts").contains("from \"./helpers\""));
    assert!(ide.has("src/helpers.ts"));
}

#[test]
fn rename_cancel_drops_the_result() {
    if skip_without_tsserver("rename_cancel_drops_the_result") {
        return;
    }
    let fx = Fixture::new(SUITE, "rename_cancel");
    let repo = ts_project(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    reveal(&mut ide, "src/local.ts");
    ide.click("src/local.ts");
    ide.key_mods(SHIFT, Key::F6);
    ide.type_text("other\n");
    // Cancel while the servers think; nothing moves, even when the answer arrives.
    ide.key(Key::Escape);
    ide.settle();
    assert!(!dialog_open(&ide));
    let root = ide.root();
    assert!(root.join("src/local.ts").is_file());
    assert!(!root.join("src/other.ts").exists());
}

#[test]
fn rename_rust_module_updates_mod_and_paths() {
    if skip_without_rust_analyzer("rename_rust_module_updates_mod_and_paths") {
        return;
    }
    let fx = Fixture::new(SUITE, "rename_rust");
    let repo = cargo_project(fx.path("repo"));
    repo.write("util/src/lib.rs", &format!("pub mod shapes;\n\n{UTIL_RS}"));
    repo.write("util/src/shapes.rs", "pub struct Circle {\n    pub r: i32,\n}\n");
    repo.write("app/src/main.rs", &APP_RS.replace("fn main() {\n", "fn main() {\n    let _c = util::shapes::Circle { r: 1 };\n"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    // A Rust file makes rust-analyzer start and load the workspace.
    ide.open_file("app/src/main.rs");
    // No wait for the workspace load: an early rename must still get its edits.
    reveal(&mut ide, "util/src/shapes.rs");
    ide.click("util/src/shapes.rs");
    ide.key_mods(SHIFT, Key::F6);
    ide.type_text("geometry\n");
    ide.wait_for("preview", |s| matches!(&s.tree_ops.dialog, Some(harwex_ide::tree_menu::Dialog::Rename(r)) if matches!(r.phase, harwex_ide::tree_menu::RenamePhase::Preview { .. })));
    ide.settle();
    ide.key(Key::Enter);
    let root = ide.root();
    ide.wait_for("renamed", |_| root.join("util/src/geometry.rs").is_file());
    ide.wait_for("saved", |s| s.tabs.editors().all(|e| !e.doc.is_dirty()) && s.is_idle());
    assert!(repo.read("util/src/lib.rs").starts_with("pub mod geometry;"), "{}", repo.read("util/src/lib.rs"));
    assert!(repo.read("app/src/main.rs").contains("util::geometry::Circle"), "{}", repo.read("app/src/main.rs"));
}

#[test]
fn safe_delete_lists_usages_and_trashes() {
    if skip_without_tsserver("safe_delete_lists_usages_and_trashes") {
        return;
    }
    let fx = Fixture::new(SUITE, "delete");
    let repo = ts_project(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/local.ts");
    reveal(&mut ide, "src/local.ts");
    ide.click("src/local.ts");
    ide.key(Key::Backspace);
    ide.wait_for("usages", |s| matches!(&s.tree_ops.dialog, Some(harwex_ide::tree_menu::Dialog::Delete(d)) if matches!(&d.usages, harwex_ide::tree_menu::Usages::Found(r) if !r.is_empty())));
    ide.settle();
    ide.assert_text("1 usage in 1 file still refers to it:");
    ide.assert_text("src/main.ts:2  import { localHelper } from \"./local\";");
    ide.snapshot("delete_usages");
    // The user may still delete.
    ide.click("Delete");
    let root = ide.root();
    ide.wait_for("trashed", |_| !root.join("src/local.ts").exists());
    ide.settle();
    assert_eq!(calls(&ide), [format!("trash {}", root.join("src/local.ts").display())]);
    assert!(ide.state().tabs.editors().all(|e| !e.path.ends_with("src/local.ts")), "its tab closed");
    assert!(!ide.has("src/local.ts"));
}

#[test]
fn find_usages_of_a_file() {
    if skip_without_tsserver("find_usages_of_a_file") {
        return;
    }
    let fx = Fixture::new(SUITE, "file_usages");
    let repo = ts_project(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    reveal(&mut ide, "src/local.ts");
    ide.right_click("src/local.ts");
    ide.settle();
    ide.click("Find Usages");
    ide.wait_for("usages", |s| !s.usages.searching && !s.usages.groups.is_empty());
    let u = &ide.state().usages;
    assert_eq!(u.title, "Usages of local.ts");
    assert_eq!(u.groups.len(), 1);
    assert!(u.groups[0].path.ends_with("src/main.ts"));
}

#[test]
fn safe_delete_falls_back_to_a_text_search() {
    let fx = Fixture::new(SUITE, "delete_fallback");
    let repo = basic_repo(fx.path("repo"));
    // TypeScript support is off, so no server answers; the import search still finds app.ts.
    repo.write(".harwex/ide.toml", "languages = [\"rust\"]\n");
    let mut ide = Ide::open(SUITE, &repo.dir);
    reveal(&mut ide, "src/util.ts");
    ide.click("src/util.ts");
    ide.key(Key::Delete);
    ide.wait_for("usages", |s| matches!(&s.tree_ops.dialog, Some(harwex_ide::tree_menu::Dialog::Delete(d)) if matches!(&d.usages, harwex_ide::tree_menu::Usages::Found(_))));
    ide.settle();
    ide.assert_text("src/app.ts:1  import { add } from \"./util\";");
    // Turning safe delete off drops the list; Cancel keeps the file.
    ide.click("Search for usages (safe delete)");
    ide.settle();
    ide.assert_no_text("src/app.ts:1");
    ide.click("Cancel");
    ide.settle();
    assert!(ide.root().join("src/util.ts").is_file());
    assert!(calls(&ide).is_empty());
}

#[test]
fn replace_in_files_in_a_folder() {
    let fx = Fixture::new(SUITE, "replace");
    let repo = basic_repo(fx.path("repo"));
    repo.write("docs/add.md", "add here\n");
    let mut ide = Ide::open(SUITE, &repo.dir);
    reveal(&mut ide, "src/util.ts");
    ide.open_file("src/util.ts");
    ide.click("src");
    ide.cmd_shift(Key::R);
    ide.settle();
    assert!(ide.state().find.dialog_open && ide.state().find.replace_mode);
    assert_eq!(ide.state().find.scope.as_deref(), Some(ide.root().join("src").as_path()));
    ide.type_text("add");
    // The replacement field is the second text box.
    let boxes = ide.role_rects(egui::accesskit::Role::TextInput);
    ide.click_at(boxes[1].center());
    ide.type_text("plus");
    ide.click("Words");
    ide.key(Key::Enter);
    ide.wait_for("search finished", |s| !s.find.searching && !s.find.searched_for.is_empty());
    ide.settle();
    // `add` as a word: the import and the call in app.ts, the function in util.ts. docs/ is
    // outside the folder.
    assert_eq!(ide.state().find.hit_count(), 3);
    ide.assert_text("\"add\": 3 matches in 2 files in src");
    ide.snapshot("replace_preview");
    // Leave the import unchecked, then Replace All.
    ide.click("Replace src/app.ts:1");
    ide.settle();
    assert_eq!(ide.state().find.checked_count(), 2);
    ide.click("Replace All");
    ide.wait_for("replaced", |s| !s.find.replacing && !s.find.searching && s.tabs.editors().all(|e| !e.doc.is_dirty()));
    ide.settle();
    assert_eq!(repo.read("src/app.ts"), APP_TS.replace("add(1, 2)", "plus(1, 2)"));
    assert!(repo.read("src/util.ts").starts_with("export function plus("));
    assert_eq!(repo.read("docs/add.md"), "add here\n");
    let util = ide.state().tabs.editors().find(|e| e.path.ends_with("src/util.ts")).expect("util tab");
    assert!(util.doc.text().starts_with("export function plus("), "the open document changed through the edit API");
    assert!(util.doc.can_undo());
}

#[test]
fn excluded_folder_is_dimmed_and_hidden_from_search() {
    let fx = Fixture::new(SUITE, "exclude");
    let repo = basic_repo(fx.path("repo"));
    repo.write("dist/bundle.js", "add();\n");
    let mut ide = Ide::open(SUITE, &repo.dir);
    assert!(ide.state().index.files.iter().any(|f| f == "dist/bundle.js"));
    reveal(&mut ide, "dist/bundle.js");
    ide.right_click("dist");
    ide.settle();
    ide.click("Mark Directory as Excluded");
    let root = ide.root();
    ide.wait_for("excluded", |s| s.tree.excluded == [root.join("dist")]);
    ide.settle();
    assert!(repo.read(".harwex/ide.toml").contains("[project]\nexcluded = [\"dist\"]"), "{}", repo.read(".harwex/ide.toml"));
    assert!(!ide.state().index.files.iter().any(|f| f.starts_with("dist/")), "Search Everywhere skips it");
    ide.snapshot("excluded_folder");

    // From a file at the root, Find in Files searches the whole project.
    ide.click("README.md");
    ide.cmd_shift(Key::F);
    ide.type_text("add\n");
    ide.wait_for("search finished", |s| !s.find.searching && !s.find.searched_for.is_empty());
    assert!(ide.state().find.results.iter().all(|(p, _)| !p.starts_with(root.join("dist"))), "Find in Files skips it");
    ide.assert_text("\"add\": 3 matches in 2 files");
    ide.state_mut().layout.show(harwex_ide::layout::ToolWindow::Project);
    ide.settle();

    ide.right_click("dist");
    ide.settle();
    ide.click("Cancel Exclusion");
    ide.wait_for("included", |s| s.tree.excluded.is_empty() && s.index.files.iter().any(|f| f == "dist/bundle.js"));
}

#[test]
fn git_rollback_and_reload_from_disk() {
    let fx = Fixture::new(SUITE, "rollback");
    let repo = changed_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    reveal(&mut ide, "src/app.ts");
    ide.right_click("src/app.ts");
    ide.settle();
    ide.click("Git Rollback...");
    ide.settle();
    ide.assert_text("Roll back 1 changed files in src/app.ts? Local changes are lost.");
    ide.click("Rollback");
    ide.wait_for("rolled back", |_| std::fs::read_to_string(fx.path("repo/src/app.ts")).is_ok_and(|t| t == APP_TS));
    ide.settle();
    assert_eq!(ide.state().git.status.get(&ide.root().join("src/app.ts")), None);

    // Reload from Disk asks before it drops unsaved edits.
    ide.open_file("src/util.ts");
    let p = ide.caret_pos(0, 0);
    ide.click_at(p);
    ide.type_text("// mine\n");
    repo.write("src/util.ts", "export const fromDisk = 1;\n");
    ide.right_click("src/util.ts");
    ide.settle();
    ide.click("Reload from Disk");
    ide.settle();
    ide.assert_text("util.ts has unsaved changes. Reload from disk and lose them?");
    ide.click("Reload");
    ide.wait_for("reloaded", |s| s.tabs.active_editor().is_some_and(|e| e.doc.text() == "export const fromDisk = 1;\n" && !e.doc.is_dirty()));
}

/// The UI keeps its frame budget while a rename preview loads 30 TypeScript projects.
#[test]
fn rename_preview_keeps_frames_fast_in_a_monorepo() {
    if skip_without_tsserver("rename_preview_keeps_frames_fast_in_a_monorepo") {
        return;
    }
    const PACKAGES: usize = 60;
    const IMPORTERS: usize = 30;
    let fx = Fixture::new(SUITE, "monorepo");
    let dir = fx.path("repo");
    let tsconfig = r#"{"compilerOptions":{"strict":true,"module":"commonjs","target":"es2020","moduleResolution":"node"},"include":["src"]}"#;
    write(&dir, "package.json", r#"{ "name": "mono", "private": true }"#);
    write(&dir, "packages/core/tsconfig.json", tsconfig);
    write(&dir, "packages/core/src/shapes.ts", "export const area = (w: number, h: number): number => w * h;\n");
    for p in 0..PACKAGES {
        write(&dir, &format!("packages/pkg{p}/tsconfig.json"), tsconfig);
        let import = if p < IMPORTERS { "import { area } from \"../../core/src/shapes\";\nexport const size = area(1, 2);\n" } else { "" };
        write(&dir, &format!("packages/pkg{p}/src/index.ts"), &format!("{import}export const id{p} = {p};\n"));
    }
    std::fs::create_dir_all(dir.join("node_modules")).expect("node_modules");
    std::os::unix::fs::symlink(typescript().expect("TypeScript 5"), dir.join("node_modules/typescript")).expect("typescript link");
    let mut ide = Ide::open(SUITE, &dir);
    ide.open_file("packages/core/src/shapes.ts");
    reveal(&mut ide, "packages/core/src/shapes.ts");
    ide.click("packages/core/src/shapes.ts");
    ide.key_mods(SHIFT, Key::F6);
    ide.type_text("geometry");
    ide.key(Key::Enter);
    let started = Instant::now();
    let mut worst = Duration::ZERO;
    loop {
        let t = Instant::now();
        ide.step();
        worst = worst.max(t.elapsed());
        let done = matches!(&ide.state().tree_ops.dialog, Some(harwex_ide::tree_menu::Dialog::Rename(r)) if matches!(r.phase, harwex_ide::tree_menu::RenamePhase::Preview { .. }));
        if done {
            break;
        }
        assert!(started.elapsed() < Duration::from_secs(60), "no preview after 60 s");
        std::thread::sleep(Duration::from_millis(2));
    }
    let took = started.elapsed();
    let Some(harwex_ide::tree_menu::Dialog::Rename(r)) = &ide.state().tree_ops.dialog else { unreachable!() };
    let harwex_ide::tree_menu::RenamePhase::Preview { result, .. } = &r.phase else { unreachable!() };
    eprintln!("monorepo rename preview: {took:?}, worst frame {worst:?}, {} candidates, {} projects, {} files", result.candidates, result.projects, result.edits.len());
    assert_eq!(result.edits.len(), IMPORTERS, "every importer changes");
    assert_eq!(result.projects, IMPORTERS + 1);
    // Alone a frame takes under 1 ms; the suite runs its tests in parallel, which costs some.
    // Blocking the UI on the servers would take about as long as the whole preview.
    assert!(worst < Duration::from_millis(250), "a frame took {worst:?} during the rename preview");
    assert!(took < Duration::from_secs(20), "the preview took {took:?}");
}
