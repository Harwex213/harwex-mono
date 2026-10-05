//! Cancel of long actions: the running-jobs widget in the status bar (elapsed time, ×, the
//! "still running — Cancel?" hint), a hung `git blame` killed with its process group, and
//! oxlint whose type-aware backend hangs.
//!
//! It has its own test binary, outside `tests/app`: it sets `HARWEX_GIT`, which ide-git reads
//! once per process, and `HARWEX_LINT_TIMEOUT_MS` for the whole process.
//!
//! Git runs through a fake `git` (`HARWEX_GIT`): it passes every command to the real git,
//! except `blame` while the repository holds `.git/hang-blame`. The oxlint test uses a fake
//! `oxlint --lsp` written in JS and a fake `tsgolint` that never answers.

mod common;

use std::path::{Path, PathBuf};
use std::sync::Once;
use std::time::{Duration, Instant};

use common::*;

const SUITE: &str = "cancel";

static FAKE_GIT: Once = Once::new();

fn make_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).expect("chmod");
}

/// The real git on PATH, found before `HARWEX_GIT` points the app at the fake.
fn real_git() -> PathBuf {
    let paths = std::env::var_os("PATH").expect("PATH");
    std::env::split_paths(&paths).map(|d| d.join("git")).find(|p| p.is_file()).expect("git on PATH")
}

/// Points the app's git at the fake. Every git CLI run of this test binary goes through it, so
/// it must be in place before the first one (`ide_git` reads `HARWEX_GIT` once).
fn use_fake_git() {
    init();
    FAKE_GIT.call_once(|| {
        let dir = Path::new(FIXTURE_ROOT).join(SUITE).join("fake-git-bin");
        std::fs::create_dir_all(&dir).expect("fake git dir");
        let script = dir.join("git");
        let body = format!(
            "#!/bin/sh\n\
             top=$(pwd -P)\n\
             if [ \"$1\" = blame ] && [ -e \"$top/.git/hang-blame\" ]; then\n\
             \x20 sh -c 'trap \"\" TERM; echo $$ > \"$0/.git/blame-child.pid\"; while :; do sleep 1; done' \"$top\" &\n\
             \x20 wait\n\
             fi\n\
             exec '{}' \"$@\"\n",
            real_git().display()
        );
        std::fs::write(&script, body).expect("write fake git");
        make_executable(&script);
        // Runs once, before this binary's first git command.
        std::env::set_var("HARWEX_GIT", &script);
    });
}

fn alive(pid: i32) -> bool {
    std::process::Command::new("kill").args(["-0", &pid.to_string()]).stderr(std::process::Stdio::null()).status().is_ok_and(|s| s.success())
}

fn wait_pid_file(path: &Path) -> i32 {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if let Some(pid) = std::fs::read_to_string(path).ok().and_then(|s| s.trim().parse().ok()) {
            return pid;
        }
        assert!(Instant::now() < deadline, "{} was never written", path.display());
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn assert_dies(pid: i32, what: &str) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while alive(pid) {
        if Instant::now() > deadline {
            let _ = std::process::Command::new("kill").args(["-9", &pid.to_string()]).status();
            panic!("{what} (pid {pid}) survived");
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn annotate(ide: &mut Ide) {
    let p = ide.caret_pos(0, 0);
    ide.right_click_at(p);
    ide.hover("Git");
    ide.wait_until("git submenu", |ide| ide.has("Annotate with Git Blame"));
    ide.click("Annotate with Git Blame");
}

fn toasts(ide: &Ide) -> Vec<String> {
    ide.state().notifications.toast_titles()
}

#[test]
fn hung_annotate_is_cancelled_from_the_status_bar_and_runs_again() {
    use_fake_git();
    let fx = Fixture::new(SUITE, "annotate");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/util.ts");
    // The hint shows at once instead of after 30 s.
    ide.state().jobs.set_still_running_after(Duration::ZERO);
    let pid_file = repo.dir.join(".git/blame-child.pid");
    std::fs::write(repo.dir.join(".git/hang-blame"), "").expect("marker");
    annotate(&mut ide);
    ide.wait_until("the running job in the status bar", |ide| ide.has("Running: Annotating"));
    let first = wait_pid_file(&pid_file);
    ide.wait_until("the hint", |ide| ide.shows_text("Annotating — still running, Cancel?"));
    ide.snapshot_running("annotate_still_running");

    // A second hung blame: the widget counts it, and its list has a × per job.
    std::fs::remove_file(&pid_file).expect("pid file");
    ide.open_file_running("src/app.ts");
    annotate(&mut ide);
    ide.wait_for("two jobs", |s| s.jobs.running().len() == 2);
    let second = wait_pid_file(&pid_file);
    ide.wait_until("the count", |ide| ide.shows_text("Annotating — still running, Cancel?  +1"));
    ide.click("Running: Annotating");
    ide.wait_until("the list", |ide| ide.has("Cancel Annotating in the list (2)"));
    ide.snapshot_running("running_jobs_list");
    ide.click("Cancel Annotating in the list (2)");
    ide.wait_for("one job left", |s| s.jobs.running().len() == 1);
    assert_dies(second, "child of the second hung git blame");
    assert!(alive(first), "the other job still runs");

    ide.click("Cancel Annotating");
    ide.wait_for("the job ends", |s| s.jobs.running().is_empty());
    ide.settle();
    assert_dies(first, "child of the first hung git blame");
    let titles = toasts(&ide);
    assert_eq!(titles.iter().filter(|t| *t == "Cancelled: Annotating").count(), 2, "{titles:?}");
    assert!(!titles.iter().any(|t| t == "Annotate failed"), "a cancel is no error: {titles:?}");
    assert!(ide.state().ws.tabs.list.iter().filter_map(|t| t.editor()).all(|e| e.annotations.is_empty()));

    // The next Annotate starts a new git blame, and this one answers.
    std::fs::remove_file(repo.dir.join(".git/hang-blame")).expect("marker");
    ide.dismiss_toasts();
    annotate(&mut ide);
    ide.wait_for("blame", |s| s.ws.tabs.active_editor().is_some_and(|e| !e.annotations.is_empty()));
    ide.settle();
    assert_eq!(ide.state().ws.tabs.active_editor().expect("editor").annotations.len(), 8);
}

#[test]
fn closing_annotations_stops_the_hung_blame_quietly() {
    use_fake_git();
    let fx = Fixture::new(SUITE, "annotate_close");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/util.ts");
    std::fs::write(repo.dir.join(".git/hang-blame"), "").expect("marker");
    annotate(&mut ide);
    ide.wait_until("the running job in the status bar", |ide| ide.has("Running: Annotating"));
    let child = wait_pid_file(&repo.dir.join(".git/blame-child.pid"));
    // The same menu entry closes the annotations; the running blame is no longer wanted.
    annotate(&mut ide);
    ide.wait_for("the job ends", |s| s.jobs.running().is_empty());
    ide.settle();
    assert_dies(child, "child of the hung git blame");
    assert!(toasts(&ide).is_empty(), "no toast for a blame nobody waits for: {:?}", toasts(&ide));
}

/// A fake `oxlint --lsp`: with type-aware on, a diagnostic request starts `tsgolint` and is
/// never answered, like oxlint 1.77 behind a tsgolint that cannot start. Without type-aware it
/// reports one `no-debugger`. Every start is logged to `fake-oxlint.log` in the root.
const FAKE_OXLINT: &str = r#"const fs = require("fs");
const cp = require("child_process");
const log = (line) => fs.appendFileSync("fake-oxlint.log", line + "\n");
let typeAware = false;
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
function handle(msg) {
  if (msg.method === "initialize") {
    const options = (msg.params.initializationOptions || [])[0];
    typeAware = !!(options && options.options && options.options.typeAware);
    log("start typeAware=" + typeAware);
    send({ jsonrpc: "2.0", id: msg.id, result: { capabilities: { textDocumentSync: 1, diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false } } } });
  } else if (msg.method === "textDocument/diagnostic") {
    if (typeAware) {
      cp.spawn(process.env.OXLINT_TSGOLINT_PATH, [], { stdio: "ignore" });
      log("diagnostic waits for tsgolint");
      return;
    }
    log("diagnostic answered");
    send({ jsonrpc: "2.0", id: msg.id, result: { kind: "full", items: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 9 } }, severity: 1, code: "eslint(no-debugger)", source: "oxc", message: "`debugger` statement is not allowed" }] } });
  } else if (msg.method === "exit") {
    process.exit(0);
  } else if (msg.id !== undefined && msg.method) {
    send({ jsonrpc: "2.0", id: msg.id, result: null });
  }
}
"#;

/// A tsgolint that never starts working and ignores SIGTERM.
const FAKE_TSGOLINT: &str = "#!/bin/sh\ntrap '' TERM\necho $$ >> \"$(pwd -P)/tsgolint.pids\"\nwhile :; do sleep 1; done\n";

fn oxlint_problems(ide: &Ide) -> Vec<String> {
    let Some(e) = ide.state().ws.tabs.active_editor() else { return Vec::new() };
    e.problems.current.iter().map(|p| p.origin()).collect()
}

#[test]
fn oxlint_timeout_kills_tsgolint_and_lints_without_type_aware() {
    if ide_ts::find_node().is_none() {
        eprintln!("skipping oxlint_timeout_kills_tsgolint_and_lints_without_type_aware: node was not found");
        return;
    }
    use_fake_git();
    // Process-wide; only this test of the binary lints.
    std::env::set_var("HARWEX_LINT_TIMEOUT_MS", "1500");
    let fx = Fixture::new(SUITE, "oxlint_timeout");
    let repo = Repo::init(fx.path("repo"));
    let (os, arch) = harwex_ide::diagnostics::strategy::node_os_arch();
    repo.write(".oxlintrc.json", "{}\n");
    repo.write(".harwex/ide.toml", "[diagnostics]\nts = false\n");
    repo.write(".gitignore", "node_modules/\nfake-oxlint.log\ntsgolint.pids\n");
    repo.write("node_modules/oxlint/package.json", "{\"name\": \"oxlint\", \"version\": \"1.77.0\"}\n");
    repo.write("node_modules/oxlint/bin/oxlint", FAKE_OXLINT);
    let tsgolint = format!("node_modules/@oxlint-tsgolint/{os}-{arch}/tsgolint");
    repo.write(&tsgolint, FAKE_TSGOLINT);
    make_executable(&repo.dir.join(&tsgolint));
    repo.write("src/app.ts", "debugger;\n");
    repo.commit_all("init");

    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/app.ts");
    ide.wait_until("oxlint problems without type-aware rules", |ide| oxlint_problems(ide).contains(&"oxlint(no-debugger)".to_string()));
    ide.settle();
    let tsgolint_pid = wait_pid_file(&repo.dir.join("tsgolint.pids"));
    assert_dies(tsgolint_pid, "fake tsgolint of the timed-out server");
    let titles = toasts(&ide);
    assert_eq!(titles, vec!["oxlint type-aware rules turned off".to_string()], "one clear toast");
    let body = ide.state().notifications.log().iter().find(|n| n.title == titles[0]).map(|n| n.body.clone()).unwrap_or_default();
    assert!(body.contains("tsgolint") && body.contains(".harwex/ide.toml"), "{body}");

    // An edit lints again, still without type-aware: no new type-aware server, no new toast.
    ide.click_at(ide.caret_pos(0, 9));
    ide.type_text("\n");
    ide.wait_until("the second lint", |ide| std::fs::read_to_string(ide.root().join("fake-oxlint.log")).unwrap_or_default().matches("diagnostic answered").count() >= 2);
    ide.settle();
    let log = std::fs::read_to_string(repo.dir.join("fake-oxlint.log")).expect("fake log");
    let starts: Vec<&str> = log.lines().filter(|l| l.starts_with("start")).collect();
    assert_eq!(starts, ["start typeAware=true", "start typeAware=false"], "{log}");
    assert_eq!(std::fs::read_to_string(repo.dir.join("tsgolint.pids")).expect("pids").lines().count(), 1, "tsgolint ran once");
    assert_eq!(toasts(&ide).len(), 1, "{:?}", toasts(&ide));
}
