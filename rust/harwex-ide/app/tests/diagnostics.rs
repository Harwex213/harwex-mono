//! Problems in the editor: TypeScript errors from tsserver and the native TypeScript 7
//! server, oxlint rule errors (also type-aware), squiggles and hover text, the counts widget,
//! F2 / Shift+F2, the Problems tool window, unsaved edits and `.harwex/ide.toml` switches.
//! Skipped (with a printed reason) when node, TypeScript or oxlint is missing.

mod common;

use common::*;
use egui::{Key, Modifiers};
use harwex_ide::diagnostics::SourceId;
use ide_editor::ProblemSeverity;

const SUITE: &str = "diagnostics";

/// (line, column, severity, origin) of the active editor's problems.
fn problems(ide: &Ide) -> Vec<(usize, usize, ProblemSeverity, String)> {
    let Some(e) = ide.state().ws.tabs.active_editor() else { return Vec::new() };
    e.problems.current.iter().map(|p| {
        let pos = e.doc.char_to_position(p.start);
        (pos.line, pos.column, p.severity, p.origin())
    }).collect()
}

fn has(ide: &Ide, origin: &str) -> bool {
    problems(ide).iter().any(|p| p.3 == origin)
}

fn open(name: &str, native: bool, oxlint: bool, ide_toml: Option<&str>) -> (Fixture, Ide) {
    let fx = Fixture::new(SUITE, name);
    let repo = problems_project(fx.path("repo"), native, oxlint);
    if let Some(toml) = ide_toml {
        repo.write(".harwex/ide.toml", toml);
    }
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/app.ts");
    (fx, ide)
}

#[test]
fn tsserver_type_error_squiggle_and_hover() {
    if skip_without_tsserver("tsserver_type_error_squiggle_and_hover") {
        return;
    }
    let (_fx, mut ide) = open("tsserver", false, false, None);
    ide.wait_until("the TS error", |ide| has(ide, "ts(2322)"));
    ide.settle();
    let p = problems(&ide);
    assert!(p.contains(&(3, 6, ProblemSeverity::Error, "ts(2322)".into())), "{p:?}");
    assert!(p.iter().all(|p| !p.3.starts_with("oxlint")), "no oxlint without a config: {p:?}");
    assert!(ide.has("Problems: 1 errors, 0 warnings"), "{:?}", ide.labels());
    // The hover shows the message and the source at once, before quick info.
    let at = ide.char_pos(3, 8);
    ide.move_to(at);
    ide.steps(3);
    ide.assert_text("Type 'string' is not assignable to type 'number'.");
    ide.assert_text("ts(2322)");
    ide.snapshot_here("ts_error_hover");
}

#[test]
fn native_ts7_type_error() {
    if skip_without_ts7("native_ts7_type_error") {
        return;
    }
    let (_fx, mut ide) = open("native", true, false, None);
    ide.wait_until("the TS error", |ide| has(ide, "ts(2322)"));
    let p = problems(&ide);
    assert!(p.contains(&(3, 6, ProblemSeverity::Error, "ts(2322)".into())), "{p:?}");
    let label = ide.state().ws.tabs.active_editor().and_then(|e| e.lang.map(|l| ide.state().ws.langs.status(l, &e.path)));
    assert!(format!("{label:?}").contains("native"), "{label:?}");
}

fn wait_all(ide: &mut Ide) {
    ide.wait_until("TS and oxlint problems", |ide| has(ide, "ts(2322)") && has(ide, "oxlint(no-debugger)") && has(ide, "oxlint(no-floating-promises)"));
    ide.settle();
}

#[test]
fn oxlint_rules_counts_f2_and_problems_window() {
    if skip_without_oxlint("oxlint_rules_counts_f2_and_problems_window") {
        return;
    }
    let (_fx, mut ide) = open("oxlint", false, true, None);
    wait_all(&mut ide);
    let p = problems(&ide);
    assert!(p.contains(&(4, 0, ProblemSeverity::Error, "oxlint(no-debugger)".into())), "{p:?}");
    assert!(p.contains(&(5, 0, ProblemSeverity::Error, "oxlint(no-floating-promises)".into())), "type-aware rules run: {p:?}");
    assert!(p.contains(&(6, 10, ProblemSeverity::Warning, "oxlint(eqeqeq)".into())), "{p:?}");
    assert!(p.contains(&(3, 6, ProblemSeverity::Error, "ts(2322)".into())), "TS errors still come from the TS server: {p:?}");
    assert_eq!(harwex_ide::diagnostics::running(ide.state(), SourceId::Oxlint), 1, "one oxlint server for the workspace");
    assert!(ide.has("Problems: 3 errors, 1 warnings"), "{:?}", ide.labels());
    ide.snapshot("oxlint_squiggles");

    // F2 walks the errors from the caret, wrapping; Shift+F2 goes back.
    ide.click_at(ide.caret_pos(0, 0));
    ide.key(Key::F2);
    ide.settle();
    assert_eq!(ide.cursor(), (3, 6));
    ide.key(Key::F2);
    ide.settle();
    assert_eq!(ide.cursor(), (4, 0));
    ide.key_mods(Modifiers::SHIFT, Key::F2);
    ide.settle();
    assert_eq!(ide.cursor(), (3, 6));
    // The widget goes to the next one as well.
    ide.click("Problems: 3 errors, 1 warnings");
    ide.settle();
    assert_eq!(ide.cursor(), (4, 0));

    // The Problems window groups the current file's problems by severity.
    ide.click("Problems tool window");
    ide.settle();
    assert!(ide.has("Errors group") && ide.has("Warnings group"), "{:?}", ide.labels());
    ide.snapshot("problems_window");
    ide.click("Problem Expected === and instead saw == at 7:11");
    ide.settle();
    assert_eq!(ide.cursor(), (6, 10));
}

#[test]
fn unsaved_edits_shift_and_recheck() {
    if skip_without_oxlint("unsaved_edits_shift_and_recheck") {
        return;
    }
    let (_fx, mut ide) = open("edits", false, true, None);
    wait_all(&mut ide);
    // Two lines typed at the top: the old problems move down at once.
    ide.click_at(ide.caret_pos(0, 0));
    ide.type_text("// a\n// b\n");
    ide.step();
    let p = problems(&ide);
    assert!(p.contains(&(6, 0, ProblemSeverity::Error, "oxlint(no-debugger)".into())), "shifted before the answer: {p:?}");
    // An unsaved new error appears after the debounce; nothing was written to disk.
    ide.type_text("debugger;\n");
    ide.wait_until("the new problem", |ide| problems(ide).iter().filter(|p| p.3 == "oxlint(no-debugger)").count() == 2);
    assert!(ide.state().ws.tabs.active_editor().expect("editor").doc.is_dirty());
    // Fixing the type error in the buffer removes it.
    let fx_line = ide.active_line(6);
    assert!(fx_line.contains("\"three\""), "{fx_line}");
    ide.click_at(ide.caret_pos(6, 22));
    for _ in 0.."\"three\"".len() {
        ide.key(Key::Delete);
    }
    ide.type_text("3");
    ide.wait_until("the TS error is gone", |ide| !has(ide, "ts(2322)"));
}

#[test]
fn ide_toml_switches_sources_off() {
    if skip_without_oxlint("ide_toml_switches_sources_off") {
        return;
    }
    let (_fx, mut ide) = open("off", false, true, Some("[diagnostics]\nts = false\n\n[diagnostics.oxlint]\nenabled = false\n"));
    ide.settle();
    ide.wait_real(std::time::Duration::from_millis(400));
    ide.settle();
    let e = ide.state().ws.tabs.active_editor().expect("editor");
    let plan = e.problems.plan.clone().expect("planned");
    assert!(plan.is_empty(), "{plan:?}");
    assert!(problems(&ide).is_empty());
    assert_eq!(harwex_ide::diagnostics::running(ide.state(), SourceId::Oxlint), 0, "oxlint never started");
    assert!(!ide.has("Problems: none"), "no widget without sources");
}

#[test]
fn oxlint_only_with_ts_off_and_idle_stop() {
    if skip_without_oxlint("oxlint_only_with_ts_off_and_idle_stop") {
        return;
    }
    let (_fx, mut ide) = open("idle", false, true, Some("idle_timeout_secs = 0.5\n\n[diagnostics]\nts = false\n"));
    ide.wait_until("oxlint problems", |ide| has(ide, "oxlint(no-debugger)"));
    ide.settle();
    assert!(!has(&ide, "ts(2322)"), "the TS server is not asked: {:?}", problems(&ide));
    assert_eq!(harwex_ide::diagnostics::running(ide.state(), SourceId::Oxlint), 1);
    ide.cmd(Key::W);
    ide.settle();
    ide.wait_until("oxlint stopped after the idle timeout", |ide| harwex_ide::diagnostics::running(ide.state(), SourceId::Oxlint) == 0);
}

// -----------------------------------------------------------------------------------------
// ESLint

/// Opens `file` without waiting for idle (`open_file` settles, and that would wait out the
/// first lint), so a test can watch the cold start.
fn open_eslint(name: &str, ide_toml: Option<&str>, file: &str) -> (Fixture, Ide) {
    let fx = Fixture::new(SUITE, name);
    let repo = eslint_project(fx.path("repo"));
    if let Some(toml) = ide_toml {
        repo.write(".harwex/ide.toml", toml);
    }
    let mut ide = Ide::open(SUITE, &repo.dir);
    let path = std::fs::canonicalize(repo.dir.join(file)).expect("file exists");
    ide.state_mut().open_location(&path, None, true);
    (fx, ide)
}

fn eslint_runs(ide: &Ide) -> u64 {
    ide.state().ws.langs.lint.counts(SourceId::Eslint).runs
}

#[test]
fn eslint_rules_per_package_config_with_progress() {
    if skip_without_eslint("eslint_rules_per_package_config_with_progress") {
        return;
    }
    let (_fx, mut ide) = open_eslint("eslint", None, "packages/strict/src/app.ts");
    // The first lint loads the config and builds the TS program: the status bar says so.
    let saw_loading = std::cell::Cell::new(false);
    ide.wait_until("ESLint and TS problems", |ide| {
        if ide.state().jobs.running().iter().any(|j| j.label == "ESLint: loading packages/strict") {
            saw_loading.set(true);
        }
        has(ide, "eslint(no-debugger)") && has(ide, "ts(2322)")
    });
    ide.settle();
    assert!(saw_loading.get(), "the cold start shows in the status bar");
    let p = problems(&ide);
    assert!(p.contains(&(4, 0, ProblemSeverity::Error, "eslint(no-debugger)".into())), "{p:?}");
    assert!(p.contains(&(5, 0, ProblemSeverity::Error, "eslint(@typescript-eslint/no-floating-promises)".into())), "type-aware rule: {p:?}");
    assert!(p.contains(&(6, 10, ProblemSeverity::Warning, "eslint(eqeqeq)".into())), "{p:?}");
    assert!(p.contains(&(3, 6, ProblemSeverity::Error, "ts(2322)".into())), "TS errors still come from the TS server: {p:?}");
    assert!(!has(&ide, "eslint(no-console)"), "the strict config has no no-console: {p:?}");
    assert!(ide.has("Problems: 3 errors, 1 warnings"), "{:?}", ide.labels());
    let at = ide.char_pos(4, 3);
    ide.move_to(at);
    ide.steps(3);
    ide.assert_text("Unexpected 'debugger' statement.");
    ide.assert_text("eslint(no-debugger)");
    ide.snapshot_here("eslint_hover");

    // The other package has its own config; the same server lints it.
    ide.open_file("packages/loose/src/app.ts");
    ide.wait_until("the loose package's problems", |ide| has(ide, "eslint(no-console)"));
    ide.settle();
    let p = problems(&ide);
    assert!(p.contains(&(7, 2, ProblemSeverity::Warning, "eslint(no-console)".into())), "{p:?}");
    assert!(p.iter().all(|p| p.3 == "eslint(no-console)" || p.3 == "ts(2322)"), "only the loose rules: {p:?}");
    assert_eq!(harwex_ide::diagnostics::running(ide.state(), SourceId::Eslint), 1, "one ESLint server for the workspace");
}

#[test]
fn eslint_typing_is_debounced_and_unsaved() {
    if skip_without_eslint("eslint_typing_is_debounced_and_unsaved") {
        return;
    }
    let (_fx, mut ide) = open_eslint("eslint_typing", None, "packages/strict/src/app.ts");
    ide.wait_until("ESLint problems", |ide| has(ide, "eslint(no-debugger)"));
    ide.settle();
    let before = eslint_runs(&ide);
    ide.click_at(ide.caret_pos(0, 0));
    // Ten keystrokes 40 ms apart: each one restarts the 300 ms debounce.
    for c in "debugger;\n".chars() {
        ide.type_text(&c.to_string());
        std::thread::sleep(std::time::Duration::from_millis(40));
    }
    ide.wait_until("the unsaved new problem", |ide| problems(ide).iter().filter(|p| p.3 == "eslint(no-debugger)").count() == 2);
    ide.settle();
    let runs = eslint_runs(&ide) - before;
    assert!(runs <= 2, "one lint after the typing rests, not one per key: {runs}");
    assert!(ide.state().ws.tabs.active_editor().expect("editor").doc.is_dirty());
}

#[test]
fn eslint_off_in_ide_toml() {
    if skip_without_eslint("eslint_off_in_ide_toml") {
        return;
    }
    let (_fx, mut ide) = open_eslint("eslint_off", Some("[diagnostics.eslint]\nenabled = false\n"), "packages/strict/src/app.ts");
    ide.wait_until("the TS error", |ide| has(ide, "ts(2322)"));
    ide.wait_real(std::time::Duration::from_millis(400));
    ide.settle();
    let plan = ide.state().ws.tabs.active_editor().and_then(|e| e.problems.plan.clone()).expect("planned");
    assert!(plan.ts && plan.eslint.is_none(), "{plan:?}");
    assert!(problems(&ide).iter().all(|p| !p.3.starts_with("eslint")), "{:?}", problems(&ide));
    assert_eq!(harwex_ide::diagnostics::running(ide.state(), SourceId::Eslint), 0, "ESLint never started");
}
