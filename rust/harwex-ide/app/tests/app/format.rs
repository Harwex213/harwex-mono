//! oxfmt: format on explicit save, ⌥⌘L, the Settings page. Runs the pinned oxfmt from
//! `cargo xtask test-tools`, linked into the fixture's `node_modules`.

use std::time::{Duration, Instant};

use crate::common::*;
use egui::{Key, Modifiers};
use harwex_ide::notifications::Level;

/// `UNFORMATTED_TS` after oxfmt with the fixture's `singleQuote`, with "keep" typed as "keeps".
const FORMATTED_KEEPS: &str = "const a = { b: 1, c: 'x' };\nfunction f(x) {\n  return x;\n}\nexport const keeps = 1;\n";

fn active_id(ide: &Ide) -> u64 {
    ide.state().ws.tabs.active.expect("active tab")
}

fn dirty(ide: &Ide) -> bool {
    ide.state().ws.tabs.active_tab().is_some_and(|t| t.is_dirty())
}

/// Warnings that the formatter left in the Notifications log.
fn oxfmt_notes(ide: &Ide) -> Vec<String> {
    ide.state().notifications.log().iter().filter(|n| n.level == Level::Warning && n.title.starts_with("oxfmt")).map(|n| n.title.clone()).collect()
}

/// Types "s" after "keep" on the unchanged third line, so the file is dirty and the caret sits
/// on text that oxfmt keeps.
fn edit_keep_line(ide: &mut Ide) {
    ide.click_at(ide.caret_pos(2, 17));
    ide.type_text("s");
    assert_eq!(ide.cursor(), (2, 18));
    assert!(dirty(ide));
}

#[test]
fn save_formats_when_on_save_is_on() {
    if skip_without_oxfmt("format::save_formats_when_on_save_is_on") {
        return;
    }
    let fx = Fixture::new("format", "save_formats_when_on_save_is_on");
    let repo = oxfmt_project(fx.path("repo"), true);
    let mut ide = Ide::open("format", &repo.dir);
    assert!(ide.state().ws.langs.config.oxfmt.on_save);
    ide.open_file("src/app.ts");
    edit_keep_line(&mut ide);
    ide.cmd(Key::S);
    let id = active_id(&ide);
    ide.wait_for("formatted and saved", |s| !s.ws.format.in_flight(id) && !s.ws.tabs.active_tab().unwrap().is_dirty());
    assert_eq!(repo.read("src/app.ts"), FORMATTED_KEEPS);
    assert_eq!(ide.active_text(), FORMATTED_KEEPS);
    assert_eq!(ide.state().ws.format.applied, 1);
    // The caret stays after "keeps" on the line oxfmt did not change; that line moved down.
    assert_eq!(ide.cursor(), (4, 18));
    assert!(oxfmt_notes(&ide).is_empty(), "{:?}", oxfmt_notes(&ide));
}

#[test]
fn save_is_unformatted_when_on_save_is_off() {
    if skip_without_oxfmt("format::save_is_unformatted_when_on_save_is_off") {
        return;
    }
    let fx = Fixture::new("format", "save_is_unformatted_when_on_save_is_off");
    let repo = oxfmt_project(fx.path("repo"), false);
    let mut ide = Ide::open("format", &repo.dir);
    ide.open_file("src/app.ts");
    edit_keep_line(&mut ide);
    ide.cmd(Key::S);
    ide.wait_for("saved", |s| !s.ws.tabs.active_tab().unwrap().is_dirty());
    ide.settle();
    assert_eq!(repo.read("src/app.ts"), UNFORMATTED_TS.replace("keep", "keeps"));
    assert_eq!(ide.state().ws.format.applied, 0);
}

#[test]
fn syntax_error_saves_as_is_with_one_status_line() {
    if skip_without_oxfmt("format::syntax_error_saves_as_is_with_one_status_line") {
        return;
    }
    let fx = Fixture::new("format", "syntax_error_saves_as_is_with_one_status_line");
    let repo = oxfmt_project(fx.path("repo"), true);
    repo.write("src/broken.ts", "const = ;\nfunction f( x ){return x}\n");
    let mut ide = Ide::open("format", &repo.dir);
    ide.open_file("src/broken.ts");
    ide.click_at(ide.caret_pos(1, 0));
    ide.type_text("//");
    ide.cmd(Key::S);
    let id = active_id(&ide);
    ide.wait_for("saved", |s| !s.ws.format.in_flight(id) && !s.ws.tabs.active_tab().unwrap().is_dirty());
    ide.settle();
    assert_eq!(repo.read("src/broken.ts"), "const = ;\n//function f( x ){return x}\n");
    assert_eq!(oxfmt_notes(&ide), vec!["oxfmt could not parse the file. Saved unformatted.".to_string()]);
    // A status bar line, no toast and no modal.
    assert!(ide.state().notifications.toast_titles().is_empty(), "{:?}", ide.state().notifications.toast_titles());
    ide.assert_text("oxfmt could not parse the file. Saved unformatted.");
}

#[test]
fn reformat_key_formats_without_saving_and_undo_is_one_step() {
    if skip_without_oxfmt("format::reformat_key_formats_without_saving_and_undo_is_one_step") {
        return;
    }
    let fx = Fixture::new("format", "reformat_key_formats_without_saving_and_undo_is_one_step");
    // On-save is off: the manual action still works.
    let repo = oxfmt_project(fx.path("repo"), false);
    let mut ide = Ide::open("format", &repo.dir);
    ide.open_file("src/app.ts");
    ide.click_at(ide.caret_pos(2, 17));
    ide.key_mods(Modifiers::COMMAND | Modifiers::ALT, Key::L);
    ide.wait_for("formatted", |s| s.ws.format.applied == 1);
    let formatted = FORMATTED_KEEPS.replace("keeps", "keep");
    assert_eq!(ide.active_text(), formatted);
    assert!(dirty(&ide), "the format is an edit, not a save");
    assert_eq!(repo.read("src/app.ts"), UNFORMATTED_TS);
    assert_eq!(ide.cursor(), (4, 17));
    ide.cmd(Key::Z);
    assert_eq!(ide.active_text(), UNFORMATTED_TS, "one undo step brings the text back");
    assert!(!dirty(&ide), "undo returns to the saved state");
    ide.cmd_shift(Key::Z);
    assert_eq!(ide.active_text(), formatted);
}

#[test]
fn large_file_formats_on_a_worker() {
    if skip_without_oxfmt("format::large_file_formats_on_a_worker") {
        return;
    }
    let fx = Fixture::new("format", "large_file_formats_on_a_worker");
    let repo = oxfmt_project(fx.path("repo"), true);
    // 20k lines; every tenth needs formatting, so the edit has 2000 blocks.
    let big: String = (0..20_000).map(|i| if i % 10 == 0 { format!("export const v{i} = {{a:{i}}}\n") } else { format!("export const v{i} = {i};\n") }).collect();
    repo.write("src/big.ts", &big);
    let mut ide = Ide::open("format", &repo.dir);
    ide.open_file("src/big.ts");
    ide.click_at(ide.caret_pos(1, 0));
    ide.type_text("// x\n");
    let id = active_id(&ide);
    let start = Instant::now();
    harwex_ide::format::save(ide.state_mut(), id, false);
    let call = start.elapsed();
    assert!(ide.state().ws.format.in_flight(id), "the format runs on a worker");
    assert!(call < Duration::from_millis(50), "starting the format took {call:?}");
    let mut slowest = Duration::ZERO;
    let budget = Instant::now();
    while ide.state().ws.format.in_flight(id) || dirty(&ide) {
        let t = Instant::now();
        ide.step();
        slowest = slowest.max(t.elapsed());
        assert!(budget.elapsed() < Duration::from_secs(40), "the format never landed");
        std::thread::sleep(Duration::from_millis(5));
    }
    let saved = repo.read("src/big.ts");
    assert!(saved.contains("export const v0 = { a: 0 };\n// x\nexport const v1 = 1;\n") && saved.contains("export const v19990 = { a: 19990 };\n"));
    assert_eq!(ide.state().ws.format.applied, 1);
    eprintln!("format::large_file_formats_on_a_worker: slowest frame {slowest:?}");
    // Debug build: the frame that applies 2000 blocks is the slowest one.
    assert!(slowest < Duration::from_millis(500), "a frame took {slowest:?}");
}

#[test]
fn settings_page_turns_on_save_on() {
    if skip_without_oxfmt("format::settings_page_turns_on_save_on") {
        return;
    }
    let fx = Fixture::new("format", "settings_page_turns_on_save_on");
    let repo = oxfmt_project(fx.path("repo"), false);
    let mut ide = Ide::open("format", &repo.dir);
    ide.open_file("src/app.ts");
    ide.key_mods(Modifiers::COMMAND, Key::Comma);
    ide.wait_until("oxfmt detected", |ide| ide.shows_text("oxfmt 0.72.0 in node_modules/oxfmt"));
    ide.snapshot("settings_oxfmt");
    ide.click("Run oxfmt on save");
    ide.click("OK");
    ide.wait_for("on_save applied", |s| s.ws.langs.config.oxfmt.on_save);
    assert_eq!(repo.read(".harwex/ide.toml"), "[format.oxfmt]\non_save = true\n");
    assert!(ide.state().ws.settings.is_none());
    edit_keep_line(&mut ide);
    ide.cmd(Key::S);
    ide.wait_for("formatted and saved", |s| s.ws.format.applied == 1 && !s.ws.tabs.active_tab().unwrap().is_dirty());
    assert_eq!(repo.read("src/app.ts"), FORMATTED_KEEPS);
}

#[test]
fn settings_page_says_when_oxfmt_is_missing() {
    let fx = Fixture::new("format", "settings_page_says_when_oxfmt_is_missing");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open("format", &repo.dir);
    ide.key_mods(Modifiers::COMMAND, Key::Comma);
    ide.wait_until("detection done", |ide| ide.shows_text("oxfmt: not found (no node_modules/oxfmt from the project root up)"));
    ide.key(Key::Escape);
    assert!(ide.state().ws.settings.is_none());
}
