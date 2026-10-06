//! Problems in the editor: TypeScript errors from tsserver and the native TypeScript 7
//! server, oxlint rule errors (also type-aware), squiggles and hover text, the counts widget,
//! F2 / Shift+F2, the Problems tool window, unsaved edits and `.harwex/ide.toml` switches.
//! Skipped (with a printed reason) when node, TypeScript or oxlint is missing.

use crate::common::*;
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

// -----------------------------------------------------------------------------------------
// oxlint zombies

/// A fake `oxlint --lsp` that leaves zombies like oxlint's tsgolint: each diagnostic request
/// starts a perl helper in the server's process group that forks 11 children and never waits
/// for them. While `hold` exists in the root, the answer waits. It logs to `fake-oxlint.log`
/// and the helpers' pids to `helpers.pids`.
const ZOMBIE_OXLINT: &str = r#"const fs = require("fs");
const cp = require("child_process");
const log = (line) => fs.appendFileSync("fake-oxlint.log", line + "\n");
let buf = Buffer.alloc(0);
let lints = 0;
function send(msg) {
  const body = Buffer.from(JSON.stringify(msg));
  process.stdout.write("Content-Length: " + body.length + "\r\n\r\n");
  process.stdout.write(body);
}
process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const end = buf.indexOf("\r\n\r\n");
    if (end < 0) return;
    const len = Number(/Content-Length: (\d+)/i.exec(buf.slice(0, end).toString())[1]);
    if (buf.length < end + 4 + len) return;
    const msg = JSON.parse(buf.slice(end + 4, end + 4 + len).toString());
    buf = buf.slice(end + 4 + len);
    handle(msg);
  }
});
function answer(id) {
  if (fs.existsSync("hold")) {
    setTimeout(() => answer(id), 50);
    return;
  }
  log("diagnostic answered");
  send({ jsonrpc: "2.0", id, result: { kind: "full", items: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 9 } }, severity: 1, code: "eslint(no-debugger)", source: "oxc", message: "`debugger` statement is not allowed" }] } });
}
function handle(msg) {
  if (msg.method === "initialize") {
    log("start " + process.pid);
    send({ jsonrpc: "2.0", id: msg.id, result: { capabilities: { textDocumentSync: 1, diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false } } } });
  } else if (msg.method === "textDocument/diagnostic") {
    lints += 1;
    // The forked children exit at once; the helper never waits, so they stay zombies.
    const helper = cp.spawn("/usr/bin/perl", ["-e", "$| = 1; for (1..11) { exit 0 unless fork } select(undef, undef, undef, 0.3); print qq(ready\n); sleep 120"], { stdio: ["ignore", "pipe", "ignore"] });
    fs.appendFileSync("helpers.pids", helper.pid + "\n");
    let ready = false;
    helper.stdout.on("data", () => {
      if (ready) return;
      ready = true;
      log("zombies ready " + lints);
      answer(msg.id);
    });
  } else if (msg.method === "exit") {
    process.exit(0);
  } else if (msg.id !== undefined && msg.method) {
    send({ jsonrpc: "2.0", id: msg.id, result: null });
  }
}
"#;

fn fake_log(ide: &Ide) -> String {
    std::fs::read_to_string(ide.root().join("fake-oxlint.log")).unwrap_or_default()
}

fn oxlint_counts(ide: &Ide) -> harwex_ide::diagnostics::LintCounts {
    ide.state().ws.langs.lint.counts(SourceId::Oxlint)
}

/// Kills the fake's helpers at the end, also on a failure: the test process may exit before the
/// lint queue's shutdown kills the server's group, and a helper would then outlive the test.
struct KillHelpers(std::path::PathBuf);

impl Drop for KillHelpers {
    fn drop(&mut self) {
        for pid in std::fs::read_to_string(&self.0).unwrap_or_default().lines() {
            let _ = std::process::Command::new("kill").args(["-9", pid.trim()]).stderr(std::process::Stdio::null()).status();
        }
    }
}

fn pid_alive(pid: u32) -> bool {
    std::process::Command::new("kill").args(["-0", &pid.to_string()]).stderr(std::process::Stdio::null()).status().is_ok_and(|s| s.success())
}

#[test]
fn oxlint_with_many_zombies_restarts_once_quietly_when_idle() {
    use std::time::{Duration, Instant};
    if ide_ts::find_node().is_none() || !std::path::Path::new("/usr/bin/perl").is_file() {
        eprintln!("skipping oxlint_with_many_zombies_restarts_once_quietly_when_idle: node or /usr/bin/perl was not found");
        return;
    }
    let fx = Fixture::new(SUITE, "oxlint_zombies");
    let repo = Repo::init(fx.path("repo"));
    repo.write(".oxlintrc.json", "{}\n");
    // A 2 s idle timeout runs the lint queue's timer every 0.5 s; the open file keeps the
    // server from the idle stop.
    repo.write(".harwex/ide.toml", "idle_timeout_secs = 2\n\n[diagnostics]\nts = false\n");
    repo.write(".gitignore", "node_modules/\nfake-oxlint.log\nhelpers.pids\nhold\n");
    repo.write("node_modules/oxlint/package.json", "{\"name\": \"oxlint\", \"version\": \"1.77.0\"}\n");
    repo.write("node_modules/oxlint/bin/oxlint", ZOMBIE_OXLINT);
    repo.write("src/app.ts", "debugger;\n");
    repo.commit_all("init");
    let _helpers = KillHelpers(repo.dir.join("helpers.pids"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/app.ts");
    ide.wait_until("oxlint problems", |ide| has(ide, "oxlint(no-debugger)"));
    ide.settle();
    let starts = |ide: &Ide| fake_log(ide).lines().filter(|l| l.starts_with("start")).count();
    let server_pid = |ide: &Ide| ide.state().ws.langs.lint.pids().first().copied().expect("oxlint pid");

    // 11 zombies: below the limit, the server stays through several timer ticks.
    ide.wait_real(Duration::from_millis(1500));
    assert_eq!((starts(&ide), oxlint_counts(&ide).restarts), (1, 0), "{}", fake_log(&ide));
    let source = harwex_ide::memory::RealSource::new();
    if let Some(src) = &source {
        assert_eq!(harwex_ide::memory::defunct_in_tree(src, server_pid(&ide)), 11);
    }

    // The second lint makes 22 zombies and is held: no restart while it runs.
    std::fs::write(repo.dir.join("hold"), "").expect("hold");
    ide.click_at(ide.caret_pos(0, 9));
    ide.type_text("\n");
    ide.wait_until("the held lint", |ide| fake_log(ide).contains("zombies ready 2"));
    let first_server = server_pid(&ide);
    if let Some(src) = &source {
        assert_eq!(harwex_ide::memory::defunct_in_tree(src, server_pid(&ide)), 22);
    }
    ide.wait_real(Duration::from_millis(1500));
    assert_eq!((starts(&ide), oxlint_counts(&ide).restarts), (1, 0), "a lint is in flight");
    // `running` would wait for the held lint; the pid answers at once.
    assert!(pid_alive(first_server), "the server {first_server} runs");

    // Once the lint is answered, the next tick restarts the server: its group dies, and the
    // new server waits for the next lint.
    std::fs::remove_file(repo.dir.join("hold")).expect("hold");
    ide.wait_until("the quiet restart", |ide| oxlint_counts(ide).restarts == 1);
    ide.wait_until("the server stopped", |ide| harwex_ide::diagnostics::running(ide.state(), SourceId::Oxlint) == 0);
    let helpers: Vec<u32> = std::fs::read_to_string(repo.dir.join("helpers.pids")).expect("pids").lines().filter_map(|l| l.parse().ok()).collect();
    assert_eq!(helpers.len(), 2);
    let deadline = Instant::now() + Duration::from_secs(10);
    while helpers.iter().any(|&p| pid_alive(p)) {
        assert!(Instant::now() < deadline, "the zombies' parents {helpers:?} survived the restart");
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(starts(&ide), 1, "the new server starts lazily");
    assert!(!pid_alive(first_server), "the old server is gone");
    assert!(ide.state().notifications.toast_titles().is_empty(), "{:?}", ide.state().notifications.toast_titles());
    assert!(has(&ide, "oxlint(no-debugger)"), "the problems stay");

    // The next lint starts a new server with 11 zombies: no second restart.
    ide.type_text("\n");
    ide.wait_until("the third lint", |ide| fake_log(ide).contains("zombies ready 1") && starts(ide) == 2 && fake_log(ide).matches("diagnostic answered").count() == 3);
    ide.wait_real(Duration::from_millis(1500));
    ide.settle();
    assert_eq!((starts(&ide), oxlint_counts(&ide).restarts), (2, 1), "{}", fake_log(&ide));
    assert!(has(&ide, "oxlint(no-debugger)"));
    assert!(ide.state().notifications.toast_titles().is_empty(), "a zombie restart is no crash: {:?}", ide.state().notifications.toast_titles());
}

// -----------------------------------------------------------------------------------------
// oxlint crashes (task 080)

/// A fake `oxlint --lsp` that dies like oxlint 1.77 in `disable_fix.rs`: a file whose text
/// contains `CRASH` makes it print a panic and exit when the file is opened or changed. While
/// `die-on-init` exists in the root, it exits during `initialize`. A file with `debugger` gets
/// one `no-debugger` problem. It logs to `fake-oxlint.log`.
const CRASHING_OXLINT: &str = r#"const fs = require("fs");
const log = (line) => fs.appendFileSync("fake-oxlint.log", line + "\n");
const texts = new Map();
let buf = Buffer.alloc(0);
function send(msg) {
  const body = Buffer.from(JSON.stringify(msg));
  process.stdout.write("Content-Length: " + body.length + "\r\n\r\n");
  process.stdout.write(body);
}
process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const end = buf.indexOf("\r\n\r\n");
    if (end < 0) return;
    const len = Number(/Content-Length: (\d+)/i.exec(buf.slice(0, end).toString())[1]);
    if (buf.length < end + 4 + len) return;
    const msg = JSON.parse(buf.slice(end + 4, end + 4 + len).toString());
    buf = buf.slice(end + 4 + len);
    handle(msg);
  }
});
const name = (uri) => uri.split("/").pop();
function got(uri, text) {
  texts.set(uri, text);
  log("got " + name(uri));
  if (text.includes("CRASH")) {
    log("crash on " + name(uri));
    process.stderr.write("thread '<unnamed>' panicked at crates/oxc_linter/src/fixer/disable_fix.rs:52:22:\nrange end index 13 out of range for slice of length 0\n");
    process.exit(1);
  }
}
function handle(msg) {
  if (msg.method === "initialize") {
    if (fs.existsSync("die-on-init")) {
      log("died on initialize");
      process.exit(1);
    }
    log("start " + process.pid);
    send({ jsonrpc: "2.0", id: msg.id, result: { capabilities: { textDocumentSync: 1, diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false } } } });
  } else if (msg.method === "textDocument/didOpen") {
    got(msg.params.textDocument.uri, msg.params.textDocument.text);
  } else if (msg.method === "textDocument/didChange") {
    got(msg.params.textDocument.uri, msg.params.contentChanges[0].text);
  } else if (msg.method === "textDocument/didClose") {
    texts.delete(msg.params.textDocument.uri);
  } else if (msg.method === "textDocument/diagnostic") {
    const uri = msg.params.textDocument.uri;
    log("lint " + name(uri));
    const items = (texts.get(uri) || "").includes("debugger")
      ? [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 9 } }, severity: 1, code: "eslint(no-debugger)", source: "oxc", message: "`debugger` statement is not allowed" }]
      : [];
    send({ jsonrpc: "2.0", id: msg.id, result: { kind: "full", items } });
  } else if (msg.method === "exit") {
    process.exit(0);
  } else if (msg.id !== undefined && msg.method) {
    send({ jsonrpc: "2.0", id: msg.id, result: null });
  }
}
"#;

fn crash_project(name: &str, files: &[(&str, &str)]) -> Option<(Fixture, Repo)> {
    if ide_ts::find_node().is_none() {
        eprintln!("skipping {name}: node was not found");
        return None;
    }
    let fx = Fixture::new(SUITE, name);
    let repo = Repo::init(fx.path("repo"));
    repo.write(".oxlintrc.json", "{}\n");
    repo.write(".harwex/ide.toml", "[diagnostics]\nts = false\n");
    repo.write(".gitignore", "node_modules/\nfake-oxlint.log\ndie-on-init\n");
    repo.write("node_modules/oxlint/package.json", "{\"name\": \"oxlint\", \"version\": \"1.77.0\"}\n");
    repo.write("node_modules/oxlint/bin/oxlint", CRASHING_OXLINT);
    for (path, text) in files {
        repo.write(path, text);
    }
    repo.commit_all("init");
    Some((fx, repo))
}

fn fake_count(ide: &Ide, line: &str) -> usize {
    fake_log(ide).lines().filter(|l| *l == line).count()
}

fn starts(ide: &Ide) -> usize {
    fake_log(ide).lines().filter(|l| l.starts_with("start")).count()
}

fn diagnostics_failed(ide: &Ide) -> Vec<String> {
    ide.state().notifications.log().iter().filter(|n| n.title == "Diagnostics failed").map(|n| n.body.clone()).collect()
}

#[test]
fn oxlint_crash_quarantines_the_file_and_others_keep_linting() {
    let files = [("src/good.ts", "debugger;\n"), ("src/bad.ts", "CRASH;\ndebugger;\n"), ("src/other.ts", "debugger;\n")];
    let Some((_fx, repo)) = crash_project("oxlint_crash_quarantine", &files) else { return };
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/good.ts");
    ide.wait_until("oxlint problems", |ide| has(ide, "oxlint(no-debugger)"));

    // The crash quarantines bad.ts: one quiet info row, no toast.
    ide.open_file("src/bad.ts");
    ide.wait_until("the crash row", |ide| has(ide, "oxlint(crash)"));
    ide.settle();
    let p = problems(&ide);
    assert_eq!(p, vec![(0, 0, ProblemSeverity::Weak, "oxlint(crash)".to_string())], "{}", fake_log(&ide));
    let message = ide.state().ws.tabs.active_editor().map(|e| e.problems.current[0].message.clone()).unwrap_or_default();
    assert!(message.contains("oxlint crashed on this file") && message.contains("disable_fix.rs:52:22"), "{message}");
    assert!(ide.state().notifications.toast_titles().is_empty(), "{:?}", ide.state().notifications.toast_titles());
    let crashes = fake_count(&ide, "crash on bad.ts");

    // Edits of the quarantined file are not sent again.
    ide.click_at(ide.caret_pos(1, 9));
    ide.type_text("\n");
    ide.settle();
    ide.type_text("x");
    ide.settle();
    assert!(has(&ide, "oxlint(crash)"));
    assert_eq!(fake_count(&ide, "crash on bad.ts"), crashes, "{}", fake_log(&ide));

    // Other files get diagnostics from a restarted server.
    ide.open_file("src/other.ts");
    ide.wait_until("other.ts problems", |ide| has(ide, "oxlint(no-debugger)"));
    assert_eq!(starts(&ide), 2, "one restart, started by the next lint: {}", fake_log(&ide));
    ide.open_file("src/good.ts");
    ide.click_at(ide.caret_pos(1, 0));
    ide.type_text("\n");
    ide.settle();
    assert!(has(&ide, "oxlint(no-debugger)"));
    assert_eq!(fake_count(&ide, "crash on bad.ts"), crashes, "the restart does not reopen bad.ts: {}", fake_log(&ide));
    assert!(diagnostics_failed(&ide).is_empty() && ide.state().notifications.toast_titles().is_empty(), "{:?}", diagnostics_failed(&ide));

    // Once bad.ts changes on disk, it is linted again.
    ide.open_file("src/bad.ts");
    ide.cmd(Key::A);
    ide.type_text("debugger;\n");
    ide.settle();
    assert!(has(&ide, "oxlint(crash)"), "an unsaved edit does not lift the quarantine");
    ide.cmd(Key::S);
    ide.wait_for("saved", |s| !s.ws.tabs.active_tab().unwrap().is_dirty());
    ide.type_text("\n");
    ide.wait_until("bad.ts linted again", |ide| has(ide, "oxlint(no-debugger)"));
    ide.settle();
    assert!(!has(&ide, "oxlint(crash)"), "{:?}", problems(&ide));
    assert!(fake_count(&ide, "lint bad.ts") >= 1, "{}", fake_log(&ide));
    assert!(ide.state().notifications.toast_titles().is_empty(), "{:?}", ide.state().notifications.toast_titles());
}

#[test]
fn oxlint_crashing_on_three_files_in_a_row_stops_with_one_toast() {
    let files = [("src/a.ts", "CRASH;\n"), ("src/b.ts", "CRASH;\n"), ("src/c.ts", "CRASH;\n"), ("src/d.ts", "debugger;\n")];
    let Some((_fx, repo)) = crash_project("oxlint_crash_three_files", &files) else { return };
    let mut ide = Ide::open(SUITE, &repo.dir);
    for f in ["src/a.ts", "src/b.ts"] {
        ide.open_file(f);
        ide.wait_until("the crash row", |ide| has(ide, "oxlint(crash)"));
    }
    assert!(diagnostics_failed(&ide).is_empty(), "{:?}", diagnostics_failed(&ide));
    ide.open_file("src/c.ts");
    ide.wait_until("the stop toast", |ide| !diagnostics_failed(ide).is_empty());
    ide.open_file("src/d.ts");
    ide.settle();
    let failed = diagnostics_failed(&ide);
    assert_eq!(failed.len(), 1, "{failed:?}");
    assert!(failed[0].contains("crashed on 3 different files"), "{failed:?}");
    assert_eq!(starts(&ide), 3, "no server after the stop: {}", fake_log(&ide));
    assert!(!has(&ide, "oxlint(no-debugger)"));
}

#[test]
fn oxlint_dying_on_initialize_stops_after_three_tries_with_one_toast() {
    let Some((_fx, repo)) = crash_project("oxlint_dies_on_initialize", &[("src/app.ts", "debugger;\n")]) else { return };
    std::fs::write(repo.dir.join("die-on-init"), "").expect("marker");
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/app.ts");
    ide.wait_until("the stop toast", |ide| !diagnostics_failed(ide).is_empty());
    ide.click_at(ide.caret_pos(1, 0));
    ide.type_text("x");
    ide.settle();
    ide.type_text("y");
    ide.settle();
    let failed = diagnostics_failed(&ide);
    assert_eq!(failed.len(), 1, "{failed:?}");
    assert!(failed[0].contains("exited 3 times in a row while it started"), "{failed:?}");
    assert_eq!(fake_count(&ide, "died on initialize"), 3, "{}", fake_log(&ide));
    assert_eq!(ide.state().notifications.toast_titles(), vec!["Diagnostics failed".to_string()]);
}
