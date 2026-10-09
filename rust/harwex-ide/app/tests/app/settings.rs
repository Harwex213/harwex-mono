//! The Settings dialog (task 101): the gear opens it, the pages, global settings in storage,
//! project settings in `.harwex/ide.toml`, and System › Files at work: idle save, save on focus
//! loss and on the terminal, backups, Trash or permanent delete, and the sync of open files.

use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::common::*;
use egui::{Event, Key};
use harwex_ide::settings::{Detected, Page};

const SUITE: &str = "settings";

fn page(ide: &Ide) -> Option<Page> {
    ide.state().ws.settings.as_ref().map(|d| d.page)
}

fn dirty(ide: &Ide, rel: &str) -> bool {
    let path = ide.root().join(rel);
    ide.state().ws.tabs.editors().any(|e| e.path == path && e.doc.is_dirty())
}

fn tab_text(ide: &Ide, rel: &str) -> String {
    let path = ide.root().join(rel);
    ide.state().ws.tabs.editors().find(|e| e.path == path).expect("the tab is open").doc.text()
}

/// Types `text` at the start of the active file.
fn edit(ide: &mut Ide, text: &str) {
    ide.click_at(ide.caret_pos(0, 0));
    ide.type_text(text);
    ide.settle();
}

fn focus_window(ide: &mut Ide, focused: bool) {
    ide.harness.input_mut().events.push(Event::WindowFocused(focused));
    ide.step();
}

#[test]
fn gear_opens_the_pages() {
    let fx = Fixture::new(SUITE, "pages");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    // The gear opens the dialog itself, no menu in between.
    ide.click("Settings");
    ide.settle();
    assert_eq!(page(&ide), Some(Page::System));
    ide.assert_text("Move files to the Trash instead of deleting permanently");
    ide.assert_text("Autosave cannot be disabled completely: a commit always saves the files first, and closing a modified tab asks to save it.");
    assert!(ide.is_selected("Settings page System"));
    ide.snapshot("system");

    ide.click("Settings page Keymap");
    ide.click("Filter keymap");
    ide.type_text("save");
    ide.settle();
    ide.assert_text("Save All");
    ide.assert_no_text("Go to Declaration");
    ide.snapshot("keymap");

    ide.click("Settings page Editor");
    ide.wait_until("oxfmt looked up", |ide| ide.shows_text("oxfmt: not found (no node_modules/oxfmt from the project root up)"));
    ide.assert_text("Run oxfmt on save");
    ide.snapshot("editor");

    ide.click("Settings page Languages");
    ide.wait_for("servers looked up", |s| s.ws.settings.as_ref().is_some_and(|d| d.servers.iter().all(|x| *x != Detected::Looking)));
    // The lookup's answers depend on the machine; the snapshot shows fixed ones.
    let d = ide.state_mut().ws.settings.as_mut().expect("open");
    d.servers = [Detected::Found("/tools/rust-analyzer".into()), Detected::Found("/tools/clangd".into()), Detected::Missing("No Roslyn server.".into()), Detected::Found("/tools/dotnet".into())];
    ide.settle();
    ide.assert_text("TypeScript and JavaScript");
    ide.snapshot("languages");

    ide.click("Settings page Frameworks");
    ide.settle();
    ide.assert_text("Unreal Engine");
    ide.snapshot("frameworks");

    // Escape closes it; ⌘, opens the page shown last.
    ide.key(Key::Escape);
    ide.settle();
    assert_eq!(page(&ide), None);
    ide.cmd(Key::Comma);
    ide.settle();
    assert_eq!(page(&ide), Some(Page::Frameworks));
}

#[test]
fn global_settings_survive_a_restart() {
    let fx = Fixture::new(SUITE, "global");
    let repo = basic_repo(fx.path("repo"));
    let mut storage = MemoryStorage::default();
    {
        let mut ide = Ide::open(SUITE, &repo.dir);
        ide.cmd(Key::Comma);
        ide.settle();
        ide.click("Move files to the Trash instead of deleting permanently");
        ide.click("Periodically when the IDE is inactive (experimental)");
        // Cancel drops the change.
        ide.click("Cancel");
        ide.settle();
        assert!(ide.state().settings.global.files.trash);
        ide.cmd(Key::Comma);
        ide.settle();
        ide.click("Move files to the Trash instead of deleting permanently");
        ide.click("Periodically when the IDE is inactive (experimental)");
        ide.click("OK");
        ide.settle();
        let files = &ide.state().settings.global.files;
        assert!(!files.trash && files.sync_periodically);
        // A global setting writes nothing into the project.
        assert!(!repo.dir.join(".harwex/ide.toml").exists());
        eframe::App::save(ide.harness.state_mut(), &mut storage);
    }
    assert!(storage.map["global_settings"].contains("trash = false"), "{}", storage.map["global_settings"]);
    let ide = Ide::with_options(SUITE, test_options(Some(&repo.dir)), Some(&storage));
    let files = &ide.state().settings.global.files;
    assert!(!files.trash && files.sync_periodically && files.save_on_idle);
}

#[test]
fn project_pages_write_only_changed_keys() {
    let fx = Fixture::new(SUITE, "project");
    let repo = basic_repo(fx.path("repo"));
    repo.write(".harwex/ide.toml", "# keep me\nidle_timeout_secs = 600\n");
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.cmd(Key::Comma);
    ide.settle();
    ide.click("Settings page Languages");
    ide.settle();
    ide.click("Rust");
    ide.click("clangd path");
    ide.type_text("/opt/llvm/bin/clangd");
    ide.click("OK");
    ide.wait_for("config applied", |s| s.ws.langs.config.cpp.clangd.is_some());
    let config = &ide.state().ws.langs.config;
    assert_eq!(config.languages, Some(vec![harwex_ide::lang::LangId::TypeScript, harwex_ide::lang::LangId::Cpp, harwex_ide::lang::LangId::CSharp]));
    assert_eq!(repo.read(".harwex/ide.toml"), "# keep me\nidle_timeout_secs = 600\nlanguages = [\"ts\", \"cpp\", \"csharp\"]\n\n[cpp]\nclangd = \"/opt/llvm/bin/clangd\"\n");
    // OK without a change writes nothing.
    std::fs::remove_file(repo.dir.join(".harwex/ide.toml")).unwrap();
    ide.cmd(Key::Comma);
    ide.settle();
    ide.click("OK");
    ide.settle();
    assert!(!repo.dir.join(".harwex/ide.toml").exists());
}

#[test]
fn idle_save() {
    let fx = Fixture::new(SUITE, "idle");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/util.ts");
    // Deterministic mode keeps the timer off, so other suites never save behind their back.
    assert!(!ide.state().settings.sync.idle_timer);
    ide.state_mut().settings.sync.idle_timer = true;
    edit(&mut ide, "// a\n");
    assert!(dirty(&ide, "src/util.ts"));
    // Input keeps the clock fresh: no save before 15 s without input.
    ide.steps(3);
    assert!(dirty(&ide, "src/util.ts"));
    ide.state_mut().settings.sync.last_input = Instant::now() - Duration::from_secs(16);
    ide.wait_until("idle save", |ide| !dirty(ide, "src/util.ts"));
    assert!(repo.read("src/util.ts").starts_with("// a\n"));
    assert_eq!(ide.state().settings.sync.idle_saves, 1);

    // Turned off: nothing is saved.
    ide.state_mut().settings.global.files.save_on_idle = false;
    edit(&mut ide, "// b\n");
    ide.state_mut().settings.sync.last_input = Instant::now() - Duration::from_secs(60);
    ide.steps(5);
    ide.settle();
    assert!(dirty(&ide, "src/util.ts"));
    assert_eq!(ide.state().settings.sync.idle_saves, 1);
}

#[test]
fn save_on_focus_loss_and_terminal() {
    let fx = Fixture::new(SUITE, "deactivate");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/util.ts");
    edit(&mut ide, "// a\n");
    focus_window(&mut ide, false);
    ide.wait_until("saved on focus loss", |ide| !dirty(ide, "src/util.ts"));
    assert!(repo.read("src/util.ts").starts_with("// a\n"));
    focus_window(&mut ide, true);
    ide.settle();

    // The built-in terminal taking the focus saves too.
    edit(&mut ide, "// b\n");
    ide.cmd(Key::T);
    ide.wait_until("saved for the terminal", |ide| !dirty(ide, "src/util.ts"));
    assert!(repo.read("src/util.ts").starts_with("// b\n// a\n"));
    assert_eq!(ide.state().settings.sync.deactivate_saves, 2);

    // Turned off: focus loss keeps the edits unsaved.
    ide.state_mut().settings.global.files.save_on_deactivate = false;
    ide.open_file("src/util.ts");
    edit(&mut ide, "// c\n");
    focus_window(&mut ide, false);
    ide.settle();
    assert!(dirty(&ide, "src/util.ts"));
}

#[test]
fn sync_on_focus_and_tab_activation() {
    let fx = Fixture::new(SUITE, "sync");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/util.ts");
    ide.open_file("src/app.ts");
    // The file changes outside; the watcher is off in tests, so only the sync can see it.
    repo.write("src/util.ts", "export const changed = 1;\n");
    let util = ide.state().ws.tabs.editor_by_path(&ide.root().join("src/util.ts")).expect("util tab");
    ide.state_mut().ws.tabs.activate(util);
    ide.wait_until("util.ts re-read on activation", |ide| tab_text(ide, "src/util.ts") == "export const changed = 1;\n");
    // Switching to the IDE window re-reads the other open files.
    repo.write("src/app.ts", "export const app = 2;\n");
    focus_window(&mut ide, false);
    focus_window(&mut ide, true);
    ide.wait_until("app.ts re-read on focus", |ide| tab_text(ide, "src/app.ts") == "export const app = 2;\n");
    assert_eq!(ide.state().settings.sync.reloads, 2);
    // A tab with unsaved edits keeps them.
    edit(&mut ide, "// mine\n");
    repo.write("src/util.ts", "export const again = 3;\n");
    focus_window(&mut ide, true);
    ide.settle();
    assert_eq!(tab_text(&ide, "src/util.ts"), "// mine\nexport const changed = 1;\n");
    // Turned off: nothing is re-read.
    ide.state_mut().settings.global.files.sync_on_activate = false;
    repo.write("src/app.ts", "export const app = 3;\n");
    focus_window(&mut ide, true);
    ide.settle();
    assert_eq!(tab_text(&ide, "src/app.ts"), "export const app = 2;\n");
}

#[test]
fn backups_before_saving() {
    let fx = Fixture::new(SUITE, "backup");
    let repo = basic_repo(fx.path("repo"));
    let backups = fx.path("backups");
    let mut ide = Ide::open(SUITE, &repo.dir);
    assert_eq!(ide.state().settings.backup_dir, None, "tests make no backups unless they ask");
    ide.state_mut().settings.backup_dir = Some(backups.clone());
    let path = ide.root().join("src/util.ts");
    let before = repo.read("src/util.ts");
    ide.open_file("src/util.ts");
    edit(&mut ide, "// a\n");
    ide.cmd(Key::S);
    ide.wait_until("saved", |ide| !dirty(ide, "src/util.ts"));
    let folder = harwex_ide::settings::files::backup_folder(&backups, &path);
    let kept = harwex_ide::settings::files::backups_of(&folder);
    assert_eq!(kept.len(), 1, "{kept:?}");
    assert_eq!(std::fs::read_to_string(&kept[0]).unwrap(), before);
    // Turned off: no new backup.
    ide.state_mut().settings.global.files.backup = false;
    edit(&mut ide, "// b\n");
    ide.cmd(Key::S);
    ide.wait_until("saved", |ide| !dirty(ide, "src/util.ts"));
    assert_eq!(harwex_ide::settings::files::backups_of(&folder).len(), 1);
}

#[test]
fn delete_to_trash_or_permanently() {
    let fx = Fixture::new(SUITE, "delete");
    let repo = basic_repo(fx.path("repo"));
    // No TypeScript server: the dialog never waits for one.
    repo.write(".harwex/ide.toml", "languages = [\"rust\"]\n");
    let trash = fx.path("trash");
    let platform = Arc::new(harwex_ide::fileops::RecordingPlatform::new(trash.clone()));
    let options = harwex_ide::app::AppOptions { platform: Some(platform), ..test_options(Some(&repo.dir)) };
    let mut ide = Ide::with_options(SUITE, options, None);
    let root = ide.root();
    let delete = |ide: &mut Ide, rel: &str, question: &str| {
        let path = ide.root().join(rel);
        ide.state_mut().ws.tree.reveal(&root, &path);
        ide.settle();
        ide.click(rel);
        ide.key(Key::Delete);
        ide.settle();
        ide.click("Search for usages (safe delete)");
        ide.settle();
        ide.assert_text(question);
        ide.click("Delete");
        ide.wait_until("deleted", |_| !path.exists());
        ide.settle();
    };
    delete(&mut ide, "src/util.ts", "Move the file \"util.ts\" to the Trash?");
    assert_eq!(ide.state().platform.calls(), [format!("trash {}", root.join("src/util.ts").display())]);
    assert_eq!(std::fs::read_dir(&trash).unwrap().count(), 1);

    ide.state_mut().settings.global.files.trash = false;
    delete(&mut ide, "docs/notes.md", "Delete the file \"notes.md\" permanently?");
    assert_eq!(ide.state().platform.calls().len(), 1, "no second trash call");
    assert_eq!(std::fs::read_dir(&trash).unwrap().count(), 1);
}
