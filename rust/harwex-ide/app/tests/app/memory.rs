//! The memory indicator in the status bar: the widget and its tooltip over a fake process tree,
//! and the real process source (a spawned child is counted, a terminal shell subtree and git
//! are not, one sample costs well under 1 ms of CPU).

use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::common::*;
use egui::Key;
use harwex_ide::memory::{Kind, MemorySource, Pid, ProcStat, ProcessSource, RealSource, Sampler};

const SUITE: &str = "memory";
const MB: u64 = 1024 * 1024;

/// A fixed tree: the IDE, tsserver with its typings installer, rust-analyzer with its
/// proc-macro server, a git command, cargo, and the TypeScript server of another project (41050,
/// with a helper 41051). The clock moves 15 s per sample, so CPU% is
/// the same on every run.
struct FakeTree {
    base: Instant,
    samples: AtomicU64,
}

impl FakeTree {
    fn new() -> FakeTree {
        FakeTree { base: Instant::now(), samples: AtomicU64::new(0) }
    }
}

impl ProcessSource for FakeTree {
    fn self_pid(&self) -> Pid {
        41000
    }
    fn children(&self, pid: Pid, out: &mut Vec<Pid>) {
        out.extend_from_slice(match pid {
            41000 => &[41010, 41020, 41030, 41040, 41050],
            41050 => &[41051],
            41010 => &[41011],
            41020 => &[41021],
            41030 => &[41031],
            _ => &[],
        });
    }
    fn stat(&self, pid: Pid) -> Option<ProcStat> {
        let (name, mb, cpu_per_sample_ms) = match pid {
            41000 => ("harwex-ide", 312, 450),
            41010 => ("node", 186, 1200),
            41011 => ("node", 41, 0),
            41020 => ("rust-analyzer", 1240, 6300),
            41021 => ("rust-analyzer-proc-macro-srv", 24, 30),
            41030 => ("git", 9, 100),
            41031 => ("git-remote-https", 12, 100),
            41040 => ("cargo", 18, 75),
            41050 => ("node", 520, 900),
            41051 => ("node", 64, 0),
            _ => return None,
        };
        let k = self.samples.load(Ordering::SeqCst);
        Some(ProcStat { name: name.into(), memory: mb * MB, cpu_ns: k * cpu_per_sample_ms * 1_000_000, zombie: false })
    }
    fn physical_ram(&self) -> u64 {
        32 * 1024 * MB
    }
    fn now(&self) -> Instant {
        let k = self.samples.fetch_add(1, Ordering::SeqCst) + 1;
        self.base + Duration::from_secs(15 * k)
    }
}

fn seq(ide: &Ide) -> u64 {
    ide.state().memory.sample.as_ref().map_or(0, |s| s.seq)
}

fn wait_sample(ide: &mut Ide, after: u64) {
    ide.wait_until("a memory sample", move |ide| seq(ide) > after);
}

#[test]
fn widget_and_tooltip() {
    let fx = Fixture::new(SUITE, "widget_and_tooltip");
    let repo = basic_repo(fx.path("repo"));
    let mut options = test_options(Some(&repo.dir));
    options.memory = MemorySource::Custom(Arc::new(FakeTree::new()));
    let mut ide = Ide::with_options(SUITE, options, None);
    wait_sample(&mut ide, 0);
    // The first sample has no ownership sets yet: the other project's server counts as ours.
    let first = ide.state().memory.sample.clone().unwrap();
    assert_eq!(first.group_total(Kind::OtherProjects), 0);
    // The fake tree has no workspace to own 41050, so the test names it. The next frame sends
    // it to the thread, before the sample request on the same channel.
    ide.state_mut().memory.extra_others = vec![41050];
    ide.step();
    // The second sample has CPU% for every process.
    ide.state().memory.sample_now();
    wait_sample(&mut ide, 1);
    let sample = ide.state().memory.sample.clone().unwrap();
    assert_eq!(sample.total, (312 + 186 + 41 + 1240 + 24 + 18 + 520 + 64) * MB, "git and its helper are left out; other projects count");
    assert_eq!(sample.group_total(Kind::LanguageServer), (186 + 41 + 1240 + 24) * MB, "only the active project's servers");
    assert_eq!(sample.group_total(Kind::OtherProjects), (520 + 64) * MB);
    assert_eq!(sample.rows.iter().find(|r| r.pid == 41020).unwrap().cpu, Some(42.0));
    assert!(ide.has("Memory indicator"), "{:?}", ide.labels());
    ide.snapshot("status_bar");

    ide.hover("Memory indicator");
    ide.wait_until("memory tooltip", |ide| ide.shows_text("Language servers"));
    for text in ["IDE itself", "1.5 GB", "312 MB", "Other", "  rust-analyzer-proc-macro-srv", "42.0%", "Other projects", "584 MB", "Sampled every 15 s"] {
        assert!(ide.shows_text(text), "{text:?} missing");
    }
    assert!(!ide.shows_text("git-remote-https"));
    assert!(!ide.shows_text("41050"), "other projects are one line, not one row per process");
    ide.snapshot_here("tooltip");
}

/// `FakeTree` plus 25 zombies under the tsserver `node` (41010): oxlint's unreaped tsgolint
/// children look like this.
struct WithZombies(FakeTree);

impl ProcessSource for WithZombies {
    fn self_pid(&self) -> Pid {
        self.0.self_pid()
    }
    fn children(&self, pid: Pid, out: &mut Vec<Pid>) {
        self.0.children(pid, out);
        if pid == 41010 {
            out.extend(41100..41125);
        }
    }
    fn stat(&self, pid: Pid) -> Option<ProcStat> {
        if (41100..41125).contains(&pid) {
            return Some(ProcStat { name: String::new(), memory: 0, cpu_ns: 0, zombie: true });
        }
        self.0.stat(pid)
    }
    fn physical_ram(&self) -> u64 {
        self.0.physical_ram()
    }
    fn now(&self) -> Instant {
        self.0.now()
    }
}

#[test]
fn zombies_are_one_defunct_line() {
    let fx = Fixture::new(SUITE, "zombies_are_one_defunct_line");
    let repo = basic_repo(fx.path("repo"));
    let mut options = test_options(Some(&repo.dir));
    options.memory = MemorySource::Custom(Arc::new(WithZombies(FakeTree::new())));
    let mut ide = Ide::with_options(SUITE, options, None);
    wait_sample(&mut ide, 0);
    let sample = ide.state().memory.sample.clone().unwrap();
    assert!(sample.rows.iter().all(|r| !(41100..41125).contains(&r.pid)), "no row per zombie: {:?}", sample.rows);
    assert_eq!(sample.rows.iter().find(|r| r.pid == 41010).unwrap().defunct, 25);
    ide.hover("Memory indicator");
    ide.wait_until("memory tooltip", |ide| ide.shows_text("Language servers"));
    assert!(ide.shows_text("    25 defunct"));
    assert!(!ide.shows_text("41100"), "zombies get no rows");
    assert!(!ide.shows_text("  ?"), "no nameless rows");
    ide.snapshot_here("tooltip_defunct");
}

#[test]
fn real_zombie_is_detected() {
    let Some(source) = real() else { return };
    // `true` exits at once; nobody waits for it until `wait` below, so it is a zombie meanwhile.
    let mut child = Command::new("true").spawn().unwrap();
    let pid = child.id();
    let deadline = Instant::now() + Duration::from_secs(10);
    while !source.stat(pid).is_some_and(|s| s.zombie) {
        assert!(Instant::now() < deadline, "pid {pid} never showed as a zombie");
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(!source.stat(std::process::id()).unwrap().zombie);
    let s = Sampler::new(source.clone()).sample(&[]);
    assert!(!s.rows.iter().any(|r| r.pid == pid), "the zombie gets no row");
    assert!(s.rows.iter().find(|r| r.pid == std::process::id()).unwrap().defunct >= 1);
    child.wait().unwrap();
}

#[test]
fn interval_comes_from_ide_toml() {
    let fx = Fixture::new(SUITE, "interval_comes_from_ide_toml");
    let repo = basic_repo(fx.path("repo"));
    std::fs::create_dir_all(repo.dir.join(".harwex")).unwrap();
    std::fs::write(repo.dir.join(".harwex/ide.toml"), "[memory]\ninterval_secs = 3\n").unwrap();
    let mut options = test_options(Some(&repo.dir));
    options.memory = MemorySource::Custom(Arc::new(FakeTree::new()));
    let mut ide = Ide::with_options(SUITE, options, None);
    assert_eq!(ide.state().memory.interval, Duration::from_secs(3));
    wait_sample(&mut ide, 0);
    // No `sample_now`: the timer alone brings the next sample.
    let first = seq(&ide);
    let start = Instant::now();
    wait_sample(&mut ide, first);
    assert!(start.elapsed() < Duration::from_secs(10), "took {:?}", start.elapsed());
}

#[test]
fn deterministic_mode_hides_the_real_indicator() {
    let fx = Fixture::new(SUITE, "deterministic_mode_hides_the_real_indicator");
    let repo = basic_repo(fx.path("repo"));
    let ide = Ide::open(SUITE, &repo.dir);
    assert!(!ide.state().memory.running());
    assert!(!ide.has("Memory indicator"));
}

fn real() -> Option<Arc<RealSource>> {
    let source = RealSource::new().map(Arc::new);
    if source.is_none() {
        eprintln!("skipping: no process source on this platform");
    }
    source
}

struct Kill(Child);

impl Drop for Kill {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
fn real_child_is_counted_and_git_is_not() {
    let Some(source) = real() else { return };
    let sleep = Kill(Command::new("sleep").arg("30").spawn().unwrap());
    // `hash-object --stdin` waits for its input, so it stays alive during the sample.
    let git = Kill(Command::new("git").args(["hash-object", "--stdin"]).stdin(Stdio::piped()).spawn().unwrap());
    let mut sampler = Sampler::new(source);
    let s = sampler.sample(&[]);
    let me = s.rows.iter().find(|r| r.pid == std::process::id()).expect("the IDE process itself");
    assert_eq!(me.kind, Kind::Ide);
    assert!(me.memory > MB, "{me:?}");
    let child = s.rows.iter().find(|r| r.pid == sleep.0.id()).expect("the spawned child is counted");
    assert_eq!((child.name.as_str(), child.kind), ("sleep", Kind::Other));
    assert!(child.memory > 0);
    assert!(!s.rows.iter().any(|r| r.pid == git.0.id()), "git is left out");
    assert!(s.ram > s.total);
}

#[test]
fn terminal_shell_subtree_is_excluded() {
    let Some(source) = real() else { return };
    let fx = Fixture::new(SUITE, "terminal_shell_subtree_is_excluded");
    let repo = basic_repo(fx.path("repo"));
    let mut options = test_options(Some(&repo.dir));
    options.memory = MemorySource::Real;
    let mut ide = Ide::with_options(SUITE, options, None);
    ide.key_mods(ALT, Key::F12);
    ide.wait_for("terminal spawned", |s| !s.ws.terminals.is_empty());
    let screen = |ide: &Ide| ide.state().ws.terminals.terminal(0).map(|t| t.screen_text()).unwrap_or_default();
    ide.wait_until("shell prompt", move |ide| screen(ide).lines().any(|l| l.starts_with('$')));
    ide.type_text("sleep 300 & echo SLEEP_PID=$!\n");
    ide.wait_until("sleep pid", move |ide| screen(ide).lines().any(|l| l.starts_with("SLEEP_PID=")));
    let text = screen(&ide);
    let sleep: Pid = text.lines().find_map(|l| l.strip_prefix("SLEEP_PID=")).unwrap().trim().parse().unwrap();
    let shell = ide.state().ws.terminals.terminal(0).unwrap().process_id().unwrap();
    let mut kids = Vec::new();
    source.children(shell, &mut kids);
    assert!(kids.contains(&sleep), "sleep {sleep} runs under the shell {shell}: {kids:?}");

    // The frames above sent the shell pid to the sampler before this request.
    let before = seq(&ide);
    ide.state().memory.sample_now();
    wait_sample(&mut ide, before);
    let sample = ide.state().memory.sample.clone().unwrap();
    assert!(sample.rows.iter().any(|r| r.pid == std::process::id()));
    assert!(!sample.rows.iter().any(|r| r.pid == shell || r.pid == sleep), "shell {shell} and sleep {sleep} are left out: {:?}", sample.rows);
    ide.type_text("kill %1\n");
}

/// Budget: one sample costs well under 1 ms of CPU (docs/timings.md).
#[test]
fn sampling_cost_budget() {
    let Some(source) = real() else { return };
    let _kids: Vec<Kill> = (0..8).map(|_| Kill(Command::new("sleep").arg("30").spawn().unwrap())).collect();
    let mut sampler = Sampler::new(source);
    sampler.sample(&[]);
    let mut costs: Vec<Duration> = (0..30).map(|_| sampler.sample(&[]).cost).collect();
    costs.sort();
    let rows = sampler.sample(&[]).rows.len();
    let median = costs[costs.len() / 2];
    eprintln!("memory sample: {rows} processes, median {:?}, max {:?}", median, costs[costs.len() - 1]);
    assert!(median < Duration::from_micros(500), "median sample cost {median:?}");
}
