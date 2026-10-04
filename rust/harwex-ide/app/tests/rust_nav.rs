//! Rust navigation through rust-analyzer in a temp Cargo workspace (`app` + `util`): Cmd+B
//! across crates and into the standard library (read-only), Type Definition, Find Usages,
//! hover, the status bar label, the idle stop and `.harwex/ide.toml` turning Rust off.
//! Skipped (with a printed reason) when rust-analyzer or rust-src is missing.

mod common;

use std::path::PathBuf;

use common::*;
use egui::Key;
use harwex_ide::lang::LangId;

const SUITE: &str = "rust_nav";

fn open_main(name: &str, ide_toml: Option<&str>) -> Option<(Fixture, Ide)> {
    if skip_without_rust_analyzer(name) {
        return None;
    }
    let fx = Fixture::new(SUITE, name);
    let repo = cargo_project(fx.path("repo"));
    if let Some(toml) = ide_toml {
        repo.write(".harwex/ide.toml", toml);
    }
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("app/src/main.rs");
    Some((fx, ide))
}

fn active_path(ide: &Ide) -> String {
    ide.state().ws.tabs.active_editor().map(|e| e.path.display().to_string()).unwrap_or_default()
}

fn active_file(ide: &Ide) -> PathBuf {
    ide.state().ws.tabs.active_editor().map(|e| e.path.clone()).unwrap_or_default()
}

fn wait_for_file(ide: &mut Ide, suffix: &str) {
    let s = suffix.to_string();
    ide.wait_until(&format!("jump to {suffix}"), move |ide| active_path(ide).ends_with(&s));
    ide.settle();
}

/// Waits until rust-analyzer has loaded the workspace, so the status bar is stable.
fn wait_ready(ide: &mut Ide) {
    ide.wait_until("rust-analyzer ready", |ide| ide.state().ws.langs.status(LangId::Rust, &active_file(ide)).as_deref() == Some("rust-analyzer"));
    ide.settle();
}

/// Stops the servers before the fixture directory goes away.
fn finish(ide: Ide) {
    ide.state().ws.langs.shutdown();
}

#[test]
fn cmd_b_jumps_across_crates() {
    let Some((_fx, mut ide)) = open_main("cross_crate", None) else { return };
    assert_eq!(ide.state().ws.langs.running(LangId::Rust), 1, "opening a .rs file starts rust-analyzer");
    assert_eq!(ide.state().ws.langs.running(LangId::TypeScript), 0, "a Rust project never starts a TypeScript server");
    // `add` in `let total = add(1, 2);`
    let p = ide.caret_pos(3, 17);
    ide.click_at(p);
    ide.cmd(Key::B);
    wait_for_file(&mut ide, "util/src/lib.rs");
    assert_eq!(ide.cursor(), (1, 7), "the caret lands on the function name");
    assert!(!ide.state().ws.tabs.active_editor().expect("editor").read_only, "workspace crates stay editable");
    wait_ready(&mut ide);
    ide.assert_text("rust-analyzer");
    ide.snapshot("cross_crate_add");

    // Back returns to the call; Type Definition on `p` lands on the struct.
    ide.cmd(Key::OpenBracket);
    wait_for_file(&mut ide, "app/src/main.rs");
    assert_eq!(ide.cursor(), (3, 17));
    let p = ide.caret_pos(5, 8);
    ide.click_at(p);
    ide.cmd_shift(Key::B);
    wait_for_file(&mut ide, "util/src/lib.rs");
    assert_eq!(ide.cursor(), (6, 11), "Type Definition of `p` is `struct Point`");
    assert_eq!(ide.state().ws.langs.running(LangId::Rust), 1, "one server for the whole workspace");

    // Budget (rule 9): a warm Go to Declaration answers well under half a second, even in a
    // debug build. Locally it takes about a millisecond.
    ide.cmd(Key::OpenBracket);
    wait_for_file(&mut ide, "app/src/main.rs");
    let p = ide.caret_pos(7, 17);
    ide.click_at(p);
    ide.cmd(Key::B);
    wait_for_file(&mut ide, "util/src/lib.rs");
    let ms = ide.state().ws.nav.last_ms.expect("latency");
    assert!(ms < 500.0, "warm Go to Declaration took {ms:.1} ms");
    finish(ide);
}

#[test]
fn cmd_b_on_std_type_opens_rust_src_read_only() {
    if skip_without_rust_src("std_type") {
        return;
    }
    let Some((_fx, mut ide)) = open_main("std_type", None) else { return };
    // `Vec` in `let words: Vec<String> = Vec::new();`
    let p = ide.caret_pos(4, 16);
    ide.click_at(p);
    ide.cmd(Key::B);
    wait_for_file(&mut ide, "alloc/src/vec/mod.rs");
    let e = ide.state().ws.tabs.active_editor().expect("editor");
    assert!(e.read_only, "standard library sources open read-only");
    let line = ide.cursor().0;
    assert!(ide.active_line(line).contains("pub struct Vec"), "landed on {:?}", ide.active_line(line));
    // The std file is served by the same server; it must not start one for the sysroot.
    assert_eq!(ide.state().ws.langs.running(LangId::Rust), 1);
    wait_ready(&mut ide);
    ide.snapshot("std_vec");
    finish(ide);
}

#[test]
fn find_usages_across_crates() {
    let Some((_fx, mut ide)) = open_main("usages", None) else { return };
    let p = ide.char_pos(3, 17);
    ide.right_click_at(p);
    ide.settle();
    ide.click("Find Usages");
    ide.wait_for("usages", |s| !s.ws.usages.searching && !s.ws.usages.groups.is_empty());
    ide.settle();
    let groups = &ide.state().ws.usages.groups;
    let in_main = groups.iter().find(|g| g.path.ends_with("app/src/main.rs")).map_or(0, |g| g.refs.len());
    let in_util = groups.iter().find(|g| g.path.ends_with("util/src/lib.rs")).map_or(0, |g| g.refs.len());
    // The `use`, two calls, and the declaration.
    assert_eq!((in_main, in_util), (3, 1), "{:?}", groups.iter().map(|g| (&g.path, g.refs.len())).collect::<Vec<_>>());
    let decl = &groups.iter().find(|g| g.path.ends_with("util/src/lib.rs")).expect("util group").refs[0];
    assert!(decl.is_definition);
    ide.assert_text("Usages of add: 4 usages in 2 files");
    wait_ready(&mut ide);
    ide.snapshot("usages_add");

    ide.click_containing("let again = add(3, 4);");
    ide.settle();
    assert_eq!(ide.cursor().0, 7);
    finish(ide);
}

#[test]
fn hover_shows_signature_and_docs() {
    let Some((_fx, mut ide)) = open_main("hover", None) else { return };
    wait_ready(&mut ide);
    let p = ide.char_pos(3, 17);
    ide.move_to(p);
    ide.wait_real(std::time::Duration::from_millis(650));
    ide.wait_for("hover info", |s| s.ws.nav.hover.info().is_some());
    ide.wait_until("hover tooltip", |ide| ide.shows_text("pub fn add(a: i32, b: i32) -> i32"));
    ide.assert_text("Adds two numbers.");
    ide.snapshot_here("hover_add");
    finish(ide);
}

#[test]
fn idle_server_stops_after_the_last_file_closes() {
    let Some((_fx, mut ide)) = open_main("idle", Some("[rust]\nidle_timeout_secs = 0.5\n")) else { return };
    assert_eq!(ide.state().ws.langs.running(LangId::Rust), 1);
    // An open file keeps the server alive past the timeout.
    ide.wait_real(std::time::Duration::from_millis(1200));
    assert_eq!(ide.state().ws.langs.running(LangId::Rust), 1, "an open .rs file keeps rust-analyzer running");
    ide.cmd(Key::W);
    ide.settle();
    assert!(ide.state().ws.tabs.active_editor().is_none());
    ide.wait_until("idle stop", |ide| ide.state().ws.langs.running(LangId::Rust) == 0);
    // Opening a Rust file again starts a fresh server.
    ide.open_file("util/src/lib.rs");
    assert_eq!(ide.state().ws.langs.running(LangId::Rust), 1);
    finish(ide);
}

#[test]
fn ide_toml_can_turn_rust_off() {
    let Some((_fx, mut ide)) = open_main("rust_off", Some("languages = [\"ts\"]\n")) else { return };
    assert_eq!(ide.state().ws.langs.running(LangId::Rust), 0, "no server for a turned-off language");
    assert_eq!(ide.state().ws.tabs.active_editor().expect("editor").lang, None);
    let p = ide.caret_pos(3, 17);
    ide.click_at(p);
    ide.cmd(Key::B);
    ide.settle();
    ide.assert_text("Rust support is turned off in .harwex/ide.toml");
    assert_eq!(ide.state().ws.langs.running(LangId::Rust), 0, "Cmd+B does not start it either");
    assert!(active_path(&ide).ends_with("app/src/main.rs"));
    ide.snapshot("rust_off_toast");
}

#[test]
fn missing_server_says_how_to_install() {
    // Needs no rust-analyzer: the configured path is wrong on purpose.
    let fx = Fixture::new(SUITE, "missing");
    let repo = cargo_project(fx.path("repo"));
    repo.write(".harwex/ide.toml", "[rust]\nserver = \"/nonexistent/rust-analyzer\"\n");
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("app/src/main.rs");
    ide.wait_until("missing toast", |ide| ide.shows_text("rust-analyzer not found"));
    ide.assert_text("rustup component add rust-analyzer");
    assert_eq!(ide.state().ws.langs.running(LangId::Rust), 0);
    let path = active_file(&ide);
    assert_eq!(ide.state().ws.langs.status(LangId::Rust, &path).as_deref(), Some("no rust-analyzer"));
    ide.snapshot("missing_server");
}
