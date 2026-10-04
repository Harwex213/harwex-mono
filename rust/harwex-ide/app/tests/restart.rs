//! Restart Language Servers from the memory indicator's menu (task 037).
//!
//! Most tests swap the TypeScript server for `FakeServer`: an in-process `LanguageServer` that
//! records what it is sent and owns a real `sleep` child as its "process", so a test can check
//! that the old process is gone. One test restarts a real tsserver (TypeScript 5 from
//! `target/tools/`). Stop / Start Language Servers and the persisted off state are covered
//! at the end.

mod common;

use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use common::*;
use egui::Key;
use harwex_ide::lang::restart::{language_servers, restart_language_servers, Action, Scope};
use harwex_ide::lang::{HoverInfo, LangId, LanguageServer, Location, Reference};
use harwex_ide::memory::{MemorySource, Pid, ProcStat, ProcessSource};
use harwex_ide::nav::NavKind;

const SUITE: &str = "restart";
const A_TS: &str = "export function target(): number {\n  return 1;\n}\n";
const B_TS: &str = "import { target } from \"./a\";\n\nconsole.log(target());\n";

#[derive(Clone, Debug, PartialEq, Eq)]
enum Ev {
    Open(PathBuf, String),
    Change(PathBuf, String),
    Close(PathBuf),
    Locations(PathBuf),
    Shutdown,
}

/// A TypeScript server stand-in. Its "process" is a `sleep` child that starts with the first
/// open file, like a real server. `locations` answers with `target`, line 0, column 16.
struct FakeServer {
    events: Mutex<Vec<Ev>>,
    child: Mutex<Option<Child>>,
    /// When set, the next `locations` waits for a message here before it answers.
    gate: Mutex<Option<Receiver<()>>>,
    target: PathBuf,
}

impl FakeServer {
    fn new(target: PathBuf) -> Arc<FakeServer> {
        Arc::new(FakeServer { events: Mutex::default(), child: Mutex::default(), gate: Mutex::default(), target })
    }

    fn record(&self, ev: Ev) {
        self.events.lock().unwrap().push(ev);
    }

    fn events(&self) -> Vec<Ev> {
        self.events.lock().unwrap().clone()
    }

    fn clear(&self) {
        self.events.lock().unwrap().clear();
    }

    fn start(&self) {
        let mut child = self.child.lock().unwrap();
        if child.is_none() {
            *child = Some(Command::new("sleep").arg("600").spawn().expect("spawn sleep"));
        }
    }

    fn pid(&self) -> Option<u32> {
        self.child.lock().unwrap().as_ref().map(Child::id)
    }

    /// Holds the next `locations` call until the returned sender sends.
    fn hold_next_answer(&self) -> Sender<()> {
        let (tx, rx) = channel();
        *self.gate.lock().unwrap() = Some(rx);
        tx
    }
}

impl LanguageServer for FakeServer {
    fn open(&self, path: &Path, text: &str) {
        self.start();
        self.record(Ev::Open(path.to_path_buf(), text.to_string()));
    }
    fn change(&self, path: &Path, text: &str) {
        self.record(Ev::Change(path.to_path_buf(), text.to_string()));
    }
    fn close(&self, path: &Path) {
        self.record(Ev::Close(path.to_path_buf()));
    }
    fn locations(&self, _kind: NavKind, path: &Path, _line: usize, _column: usize) -> Result<Vec<Location>, String> {
        self.record(Ev::Locations(path.to_path_buf()));
        let gate = self.gate.lock().unwrap().take();
        if let Some(gate) = gate {
            let _ = gate.recv_timeout(Duration::from_secs(30));
        }
        Ok(vec![Location { path: self.target.clone(), line: 0, column: 16 }])
    }
    fn references(&self, _path: &Path, _line: usize, _column: usize) -> Result<Vec<Reference>, String> {
        Ok(Vec::new())
    }
    fn hover(&self, _path: &Path, _line: usize, _column: usize) -> Result<Option<HoverInfo>, String> {
        Ok(None)
    }
    fn status(&self, _path: &Path) -> Option<String> {
        None
    }
    fn stop_idle(&self, _idle: Duration) -> Vec<String> {
        Vec::new()
    }
    fn running(&self) -> usize {
        usize::from(self.child.lock().unwrap().is_some())
    }
    fn take_notice(&self) -> Option<(String, String)> {
        None
    }
    fn shutdown(&self) {
        if let Some(mut c) = self.child.lock().unwrap().take() {
            let _ = c.kill();
            let _ = c.wait();
        }
        self.record(Ev::Shutdown);
    }
    fn pids(&self) -> Vec<u32> {
        self.pid().into_iter().collect()
    }
}

/// Only the IDE itself, so the memory indicator shows in deterministic mode.
struct OneProcess;

impl ProcessSource for OneProcess {
    fn self_pid(&self) -> Pid {
        42000
    }
    fn children(&self, _pid: Pid, _out: &mut Vec<Pid>) {}
    fn stat(&self, pid: Pid) -> Option<ProcStat> {
        (pid == 42000).then(|| ProcStat { name: "harwex-ide".into(), memory: 300 * 1024 * 1024, cpu_ns: 0 })
    }
    fn physical_ram(&self) -> u64 {
        32 * 1024 * 1024 * 1024
    }
}

fn alive(pid: u32) -> bool {
    Command::new("kill").args(["-0", &pid.to_string()]).stderr(std::process::Stdio::null()).status().is_ok_and(|s| s.success())
}

fn fake_project(dir: PathBuf) -> Repo {
    let r = Repo::init(dir);
    r.write("src/a.ts", A_TS);
    r.write("src/b.ts", B_TS);
    r.commit_all("Two files");
    r
}

fn canonical(p: PathBuf) -> PathBuf {
    std::fs::canonicalize(&p).unwrap_or(p)
}

/// The IDE on `dir` with the memory indicator shown, after its first sample.
fn open_ide(dir: &Path) -> Ide {
    let mut options = test_options(Some(dir));
    options.memory = MemorySource::Custom(Arc::new(OneProcess));
    let mut ide = Ide::with_options(SUITE, options, None);
    ide.wait_for("a memory sample", |s| s.memory.sample.is_some());
    ide.settle();
    ide
}

/// `fake_project` with the fake TypeScript server, `a.ts` and `b.ts` open, `b.ts` active.
fn open_with_fake(fx: &Fixture) -> (Ide, Arc<FakeServer>, PathBuf, PathBuf) {
    let repo = fake_project(fx.path("repo"));
    let mut ide = open_ide(&repo.dir);
    let (a, b) = (canonical(repo.dir.join("src/a.ts")), canonical(repo.dir.join("src/b.ts")));
    let fake = FakeServer::new(a.clone());
    ide.state_mut().ws.langs.set_server(LangId::TypeScript, fake.clone());
    ide.open_file("src/a.ts");
    ide.open_file("src/b.ts");
    (ide, fake, a, b)
}

fn active_path(ide: &Ide) -> PathBuf {
    ide.state().ws.tabs.active_editor().map(|e| e.path.clone()).unwrap_or_default()
}

#[test]
fn restart_reopens_dirty_files_on_a_new_process() {
    let fx = Fixture::new(SUITE, "restart_reopens_dirty_files_on_a_new_process");
    let (mut ide, fake, a, b) = open_with_fake(&fx);
    // An unsaved edit in b.ts: the new server must get it, not the disk text.
    let p = ide.caret_pos(0, 0);
    ide.click_at(p);
    ide.type_text("// dirty\n");
    ide.settle();
    let dirty = format!("// dirty\n{B_TS}");
    assert!(fake.events().contains(&Ev::Change(b.clone(), dirty.clone())), "{:?}", fake.events());
    let old = fake.pid().expect("the fake server runs");
    assert!(alive(old));

    // A press opens the menu; the tooltip does not cover it.
    ide.click("Memory indicator");
    assert!(ide.has("Restart Language Servers"), "{:?}", ide.labels());
    assert!(!ide.has("Restart Language Servers (All Projects)"), "one project open");
    assert!(!ide.shows_text("Language servers"), "no tooltip while the menu is open");
    ide.snapshot("menu");

    fake.clear();
    ide.click("Restart Language Servers");
    ide.settle();
    assert!(!ide.has("Restart Language Servers"), "the menu closes");
    assert!(!alive(old), "the old process {old} is gone");
    let new = fake.pid().expect("a new process started with the first open file");
    assert_ne!(new, old);
    assert!(alive(new));
    let events = fake.events();
    assert_eq!(events.first(), Some(&Ev::Shutdown), "{events:?}");
    let last_stop = events.iter().rposition(|e| *e == Ev::Shutdown).unwrap();
    let opens: Vec<&Ev> = events[last_stop..].iter().filter(|e| matches!(e, Ev::Open(..))).collect();
    assert_eq!(opens, vec![&Ev::Open(a.clone(), A_TS.to_string()), &Ev::Open(b.clone(), dirty)], "{events:?}");
    assert!(ide.state().notifications.toast_titles().contains(&"Language servers restarted".to_string()));
    assert!(ide.shows_text("2 open files were sent to the new servers."));

    // Go to Declaration works on the new server.
    let p = ide.caret_pos(3, 14);
    ide.click_at(p);
    ide.cmd(Key::B);
    let target = a.clone();
    ide.wait_until("jump to a.ts", move |ide| active_path(ide) == target);
    assert_eq!(ide.cursor(), (0, 16));
}

#[test]
fn answer_from_before_the_restart_is_dropped() {
    let fx = Fixture::new(SUITE, "answer_from_before_the_restart_is_dropped");
    let (mut ide, fake, a, b) = open_with_fake(&fx);
    let release = fake.hold_next_answer();
    let p = ide.caret_pos(2, 14);
    ide.click_at(p);
    ide.cmd(Key::B);
    let f = fake.clone();
    ide.wait_until("the request reached the server", move |_| f.events().iter().any(|e| matches!(e, Ev::Locations(_))));

    restart_language_servers(ide.state_mut(), Scope::Active);
    // The early stop runs beside the request that holds the TypeScript queue.
    let f = fake.clone();
    ide.wait_until("the early stop", move |_| f.events().contains(&Ev::Shutdown));
    // The old server answers now, after the restart: the answer must not move the caret.
    release.send(()).unwrap();
    ide.settle();
    assert_eq!(active_path(&ide), b, "the stale answer was dropped");
    assert!(ide.state().ws.nav.popup.is_none());
    assert!(fake.events().contains(&Ev::Open(b.clone(), B_TS.to_string())));

    let p = ide.caret_pos(2, 14);
    ide.click_at(p);
    ide.cmd(Key::B);
    let target = a.clone();
    ide.wait_until("jump to a.ts", move |ide| active_path(ide) == target);
}

#[test]
fn all_projects_restart_every_workspace() {
    let fx = Fixture::new(SUITE, "all_projects_restart_every_workspace");
    let (mut ide, fake, _a, _b) = open_with_fake(&fx);
    let first = ide.state().active_id();
    let other = fake_project(fx.path("other"));
    let other_root = canonical(other.dir.clone());
    let second = ide.state_mut().open_workspace(other_root.clone());
    ide.wait_for("second project", move |s| s.workspaces().iter().any(|w| w.id == second && w.root.is_some()));
    ide.settle();
    let fake2 = FakeServer::new(other_root.join("src/a.ts"));
    let f2 = fake2.clone();
    ide.state_mut().with_ws(second, move |s| s.ws.langs.set_server(LangId::TypeScript, f2));
    ide.open_file("src/a.ts");
    let old2 = fake2.pid().expect("second server runs");
    // The first project's server keeps running in the background.
    let old1 = fake.pid().expect("first server runs");
    assert_ne!(ide.state().active_id(), first);

    ide.click("Memory indicator");
    ide.click("Restart Language Servers (All Projects)");
    ide.settle();
    assert!(!alive(old1) && !alive(old2), "both old processes are gone");
    assert!(fake.events().contains(&Ev::Shutdown) && fake2.events().contains(&Ev::Shutdown));
    assert_ne!(fake.pid(), Some(old1));
    assert_ne!(fake2.pid(), Some(old2));
    let toasts = ide.state().notifications.toast_titles();
    assert_eq!(toasts.iter().filter(|t| *t == "Language servers restarted").count(), 1, "one toast for all projects: {toasts:?}");
}

#[test]
fn escape_and_a_press_outside_close_the_menu() {
    let fx = Fixture::new(SUITE, "escape_and_a_press_outside_close_the_menu");
    let repo = fake_project(fx.path("repo"));
    let mut ide = open_ide(&repo.dir);
    ide.click("Memory indicator");
    assert!(ide.has("Restart Language Servers"));
    ide.key(Key::Escape);
    assert!(!ide.has("Restart Language Servers"));
    ide.click("Memory indicator");
    assert!(ide.has("Restart Language Servers"));
    ide.click("Memory indicator");
    assert!(!ide.has("Restart Language Servers"), "a second press on the widget closes it");
    ide.click("Memory indicator");
    ide.click_at(egui::pos2(600.0, 300.0));
    assert!(!ide.has("Restart Language Servers"));
    // The tooltip still shows on hover.
    ide.hover("Memory indicator");
    ide.wait_until("memory tooltip", |ide| ide.shows_text("IDE itself"));
}

/// A real tsserver: the restart replaces its process, and Go to Declaration afterwards sees the
/// unsaved text (an inserted line moves `greet` down by one).
#[test]
fn real_tsserver_restarts_with_the_editor_text() {
    if skip_without_tsserver("real_tsserver_restarts_with_the_editor_text") {
        return;
    }
    let fx = Fixture::new(SUITE, "real_tsserver_restarts_with_the_editor_text");
    let repo = ts_project(fx.path("repo"));
    let mut ide = open_ide(&repo.dir);
    ide.open_file("src/main.ts");
    // Warm up: `greet` in `const message = greet("world");`.
    let p = ide.caret_pos(5, 17);
    ide.click_at(p);
    ide.cmd(Key::B);
    ide.wait_until("jump into fake-lib", |ide| active_path(ide).ends_with("fake-lib/index.d.ts"));
    ide.cmd(Key::OpenBracket);
    ide.wait_until("back to main.ts", |ide| active_path(ide).ends_with("src/main.ts"));
    ide.settle();
    let old = ide.state().ws.langs.pids();
    assert!(!old.is_empty() && old.iter().all(|p| alive(*p)), "{old:?}");

    let p = ide.caret_pos(0, 0);
    ide.click_at(p);
    ide.type_text("// unsaved\n");
    ide.click("Memory indicator");
    let started = Instant::now();
    ide.click("Restart Language Servers");
    ide.settle();
    eprintln!("restart took {:?}", started.elapsed());
    let gone = Instant::now();
    while old.iter().any(|p| alive(*p)) && gone.elapsed() < Duration::from_secs(5) {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(old.iter().all(|p| !alive(*p)), "old tsserver processes {old:?} are gone");

    let p = ide.caret_pos(6, 17);
    ide.click_at(p);
    ide.cmd(Key::B);
    ide.wait_until("jump into fake-lib after the restart", |ide| active_path(ide).ends_with("fake-lib/index.d.ts"));
    assert_eq!(ide.cursor(), (1, 24));
    let new = ide.state().ws.langs.pids();
    assert!(!new.is_empty() && new.iter().all(|p| !old.contains(p)), "old {old:?}, new {new:?}");
}

#[test]
fn stop_keeps_servers_off_and_start_reopens_the_files() {
    let fx = Fixture::new(SUITE, "stop_keeps_servers_off_and_start_reopens_the_files");
    let (mut ide, fake, a, b) = open_with_fake(&fx);
    let old = fake.pid().expect("the fake server runs");
    ide.click("Memory indicator");
    assert!(ide.has("Stop Language Servers"), "{:?}", ide.labels());
    ide.click("Stop Language Servers");
    ide.settle();
    assert!(!alive(old), "the old process {old} is gone");
    assert_eq!(fake.pid(), None);
    assert!(ide.state().ws.langs.is_off());
    assert!(ide.shows_text("servers off"), "the memory indicator shows the off state");
    assert!(ide.shows_text("Language servers off"), "the status bar hint");

    // Nothing starts the server again: an edit, a new file, Cmd+B, a hover.
    fake.clear();
    let p = ide.caret_pos(0, 0);
    ide.click_at(p);
    ide.type_text("// dirty\n");
    let root = ide.root();
    write(&root, "src/c.ts", B_TS);
    let c = canonical(root.join("src/c.ts"));
    ide.open_file("src/c.ts");
    let p = ide.caret_pos(2, 14);
    ide.click_at(p);
    ide.cmd(Key::B);
    ide.move_to(ide.char_pos(2, 14));
    ide.wait_real(Duration::from_millis(700));
    ide.settle();
    assert_eq!(fake.events(), Vec::<Ev>::new(), "the stopped server got nothing");
    assert_eq!(fake.pid(), None, "no lazy start");
    assert_eq!(active_path(&ide), c, "Cmd+B did nothing");
    assert!(ide.state().notifications.toast_titles().is_empty(), "no toasts: {:?}", ide.state().notifications.toast_titles());
    ide.snapshot("servers_off");

    ide.click("Memory indicator");
    assert!(ide.has("Start Language Servers"));
    assert!(!ide.has("Restart Language Servers") && !ide.has("Stop Language Servers"));
    ide.snapshot("menu_off");
    ide.click("Start Language Servers");
    ide.settle();
    assert!(!ide.state().ws.langs.is_off());
    let new = fake.pid().expect("Start opened the files on a new process");
    assert!(alive(new));
    let events = fake.events();
    for (path, text) in [(&a, A_TS.to_string()), (&b, format!("// dirty\n{B_TS}")), (&c, B_TS.to_string())] {
        assert!(events.contains(&Ev::Open(path.clone(), text)), "{} reopened with its editor text: {events:?}", path.display());
    }
    assert!(ide.state().notifications.toast_titles().contains(&"Language servers started".to_string()));
    let p = ide.caret_pos(2, 14);
    ide.click_at(p);
    ide.cmd(Key::B);
    let target = a.clone();
    ide.wait_until("jump to a.ts", move |ide| active_path(ide) == target);
}

#[test]
fn stopped_servers_stay_off_after_an_ide_restart() {
    let fx = Fixture::new(SUITE, "stopped_servers_stay_off_after_an_ide_restart");
    let repo = fake_project(fx.path("repo"));
    let root = canonical(repo.dir.clone());
    let mut storage = MemoryStorage::default();
    {
        let mut ide = open_ide(&repo.dir);
        ide.open_file("src/a.ts");
        language_servers(ide.state_mut(), Scope::Active, Action::Stop);
        ide.settle();
        assert!(ide.state().ws.langs.is_off());
        eframe::App::save(ide.harness.state_mut(), &mut storage);
    }
    assert_eq!(storage.map.get("languages_off").cloned(), Some(root.display().to_string()));

    let mut options = harwex_ide::AppOptions { restore_last_folder: true, ..test_options(None) };
    options.memory = MemorySource::Custom(Arc::new(OneProcess));
    let mut ide = Ide::with_options(SUITE, options, Some(&storage));
    ide.wait_for("a.ts restored", |s| s.ws.tabs.active_editor().is_some_and(|e| e.path.ends_with("src/a.ts")));
    ide.settle();
    let langs = &ide.state().ws.langs;
    assert!(langs.is_off(), "the project opens with its servers off");
    assert_eq!(langs.running(LangId::TypeScript), 0, "the restored file started no server");
    assert!(langs.pids().is_empty());
    assert!(ide.shows_text("Language servers off"));

    // Start clears the stored state.
    language_servers(ide.state_mut(), Scope::Active, Action::Start);
    ide.settle();
    eframe::App::save(ide.harness.state_mut(), &mut storage);
    assert_eq!(storage.map.get("languages_off").cloned(), Some(String::new()));
}
