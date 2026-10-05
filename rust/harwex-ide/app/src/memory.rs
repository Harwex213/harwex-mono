//! The memory indicator in the status bar, like IDEA's "2766 of 5100M" widget.
//!
//! The total covers harwex-ide and every process it started (language servers and their
//! helpers) for all open projects. The tooltip lists the active project's processes by group.
//! The processes of the other open projects (`Workspace::owned_pids` and their child trees)
//! add up to one "Other projects" line. Two kinds of subtrees stay out of it: terminal shells (the user runs anything
//! there) and git commands. A worker thread samples every `interval` (15 s by default,
//! `[memory] interval_secs` in `.harwex/ide.toml`) and posts the result to the UI thread.
//!
//! macOS reads the physical footprint (`proc_pid_rusage` → `ri_phys_footprint`, the number
//! Activity Monitor shows) and walks the tree with `proc_listchildpids`. Linux reads RSS
//! from `/proc`. `ProcessSource` hides the platform, so tests can feed a fake tree.
//!
//! Zombies (`<defunct>`, exited children that their parent never waited for) get no row. Each
//! row counts the zombies directly below it (`ProcRow::defunct`), and the tooltip shows one
//! "N defunct" line under that row. oxlint leaves one per type-aware lint (task 070).

use std::collections::{HashMap, HashSet};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};

use egui::{vec2, Align2, CornerRadius, FontId, Rect, RichText, Sense, Ui};

use crate::jobs::Jobs;
use crate::state::AppState;
use crate::theme;

pub type Pid = u32;

pub const DEFAULT_INTERVAL: Duration = Duration::from_secs(15);
/// A tree larger than this is cut off; the walk must stay cheap.
const MAX_PROCESSES: usize = 512;

/// One process as the OS reports it.
#[derive(Clone, Debug)]
pub struct ProcStat {
    pub name: String,
    /// Bytes: physical footprint on macOS, RSS elsewhere.
    pub memory: u64,
    /// User plus system CPU time since the process started, in nanoseconds.
    pub cpu_ns: u64,
    /// An exited process its parent has not waited for. It holds a pid slot and no memory.
    pub zombie: bool,
}

/// Where the sampler reads processes from. The real one asks the OS; tests use a fake tree.
pub trait ProcessSource: Send + Sync + 'static {
    fn self_pid(&self) -> Pid;
    /// Appends the direct children of `pid` to `out`.
    fn children(&self, pid: Pid, out: &mut Vec<Pid>);
    /// `None` when the process is gone or not readable.
    fn stat(&self, pid: Pid) -> Option<ProcStat>;
    /// Installed RAM in bytes, the scale of the fill bar.
    fn physical_ram(&self) -> u64;
    /// The clock of a sample. A fake source returns fixed steps, so CPU% is stable in tests.
    fn now(&self) -> Instant {
        Instant::now()
    }
}

/// Which sampler the app runs (`AppOptions::memory`).
#[derive(Clone, Default)]
pub enum MemorySource {
    /// The OS source, except in deterministic (snapshot) mode: live numbers would change the
    /// pixels of every status bar snapshot.
    #[default]
    Auto,
    Off,
    Real,
    Custom(Arc<dyn ProcessSource>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Kind {
    Ide,
    LanguageServer,
    Other,
    /// Processes owned by a workspace that is not active, with their child trees.
    OtherProjects,
}

impl Kind {
    pub fn title(self) -> &'static str {
        match self {
            Kind::Ide => "IDE itself",
            Kind::LanguageServer => "Language servers",
            Kind::Other => "Other",
            Kind::OtherProjects => "Other projects",
        }
    }
}

#[derive(Clone, Debug)]
pub struct ProcRow {
    pub pid: Pid,
    pub name: String,
    pub kind: Kind,
    pub memory: u64,
    /// Percent of one core since the previous sample. `None` for the first sample of a process.
    pub cpu: Option<f32>,
    /// Zombie children of this process. They get no rows of their own.
    pub defunct: u32,
}

#[derive(Clone, Debug)]
pub struct Sample {
    /// Sorted by kind, then by memory, largest first.
    pub rows: Vec<ProcRow>,
    pub total: u64,
    pub ram: u64,
    pub taken: Instant,
    /// CPU time the sampling thread spent on this sample.
    pub cost: Duration,
    /// Counts samples from 1, so tests can wait for the next one.
    pub seq: u64,
}

impl Sample {
    pub fn group_total(&self, kind: Kind) -> u64 {
        self.rows.iter().filter(|r| r.kind == kind).map(|r| r.memory).sum()
    }
}

/// The direct child that roots a language server subtree. Its descendants (proc-macro servers,
/// `cargo check`, typings installers) count with it.
fn classify(name: &str) -> Kind {
    let lang = name.contains("rust-analyzer") || name.contains("tsserver") || matches!(name, "node" | "tsc" | "tsgo");
    if lang {
        Kind::LanguageServer
    } else {
        Kind::Other
    }
}

/// ide-git and the app run git as a direct child, so a direct child named git roots a git
/// subtree (git-remote-https, ssh and the rest stay inside it).
fn is_git(name: &str) -> bool {
    name == "git" || name.starts_with("git-")
}

/// Walks the tree and keeps the CPU counters of the previous sample for CPU%.
pub struct Sampler {
    source: Arc<dyn ProcessSource>,
    prev: HashMap<Pid, u64>,
    prev_at: Option<Instant>,
    seq: u64,
}

impl Sampler {
    pub fn new(source: Arc<dyn ProcessSource>) -> Sampler {
        Sampler { source, prev: HashMap::new(), prev_at: None, seq: 0 }
    }

    /// One sample with no other projects open. See `sample_with`.
    pub fn sample(&mut self, excluded: &[Pid]) -> Sample {
        self.sample_with(excluded, &[])
    }

    /// One sample. `excluded` are terminal shells: they and their subtrees are skipped, and
    /// the walk never lists their children. `others` are the processes of the workspaces that
    /// are not active: they and their subtrees count as `Kind::OtherProjects`.
    pub fn sample_with(&mut self, excluded: &[Pid], others: &[Pid]) -> Sample {
        let cpu_start = thread_cpu_time();
        let src = &*self.source;
        let now = src.now();
        let wall = self.prev_at.map(|p| now.saturating_duration_since(p).as_nanos() as f64).filter(|w| *w > 0.0);
        let mut rows: Vec<ProcRow> = Vec::new();
        let mut cpu_now = HashMap::new();
        let mut seen = HashSet::new();
        let mut kids = Vec::new();
        let me = src.self_pid();
        // `None` marks a direct child: its name decides its kind, or that it is skipped. The
        // last field is the parent's row index, where a zombie child is counted.
        let mut stack: Vec<(Pid, Option<Kind>, Option<usize>)> = vec![(me, Some(Kind::Ide), None)];
        while let Some((pid, kind, parent)) = stack.pop() {
            if rows.len() >= MAX_PROCESSES || excluded.contains(&pid) || !seen.insert(pid) {
                continue;
            }
            let Some(st) = src.stat(pid) else { continue };
            if st.zombie {
                // A zombie has no name and no memory: a row would read "? 0.0 MB".
                if let Some(row) = parent.and_then(|i| rows.get_mut(i)) {
                    row.defunct += 1;
                }
                continue;
            }
            let kind = match kind {
                // An owned pid may sit at any depth (a server started through a wrapper).
                _ if others.contains(&pid) => Kind::OtherProjects,
                Some(k) => k,
                None if is_git(&st.name) => continue,
                None => classify(&st.name),
            };
            src.children(pid, &mut kids);
            let child_kind = if pid == me { None } else { Some(kind) };
            let index = rows.len();
            stack.extend(kids.drain(..).map(|c| (c, child_kind, Some(index))));
            let cpu = match (self.prev.get(&pid), wall) {
                (Some(&before), Some(w)) => Some((st.cpu_ns.saturating_sub(before) as f64 / w * 100.0) as f32),
                _ => None,
            };
            cpu_now.insert(pid, st.cpu_ns);
            rows.push(ProcRow { pid, name: st.name, kind, memory: st.memory, cpu, defunct: 0 });
        }
        rows.sort_by(|a, b| a.kind.cmp(&b.kind).then(b.memory.cmp(&a.memory)).then(a.pid.cmp(&b.pid)));
        self.prev = cpu_now;
        self.prev_at = Some(now);
        self.seq += 1;
        let total = rows.iter().map(|r| r.memory).sum();
        let cost = thread_cpu_time().saturating_sub(cpu_start);
        Sample { rows, total, ram: src.physical_ram(), taken: now, cost, seq: self.seq }
    }
}

/// Zombies anywhere below `root`. `OxlintSource` restarts its server when they pile up. The
/// walk stops after `MAX_PROCESSES` living processes, like a sample.
pub fn defunct_in_tree(src: &dyn ProcessSource, root: Pid) -> usize {
    let mut stack = vec![root];
    let mut seen = HashSet::new();
    let mut kids = Vec::new();
    let mut zombies = 0;
    while let Some(pid) = stack.pop() {
        if seen.len() >= MAX_PROCESSES || !seen.insert(pid) {
            continue;
        }
        src.children(pid, &mut kids);
        for kid in kids.drain(..) {
            match src.stat(kid) {
                Some(st) if st.zombie => zombies += 1,
                Some(_) => stack.push(kid),
                None => {}
            }
        }
    }
    zombies
}

enum Msg {
    Exclude(Vec<Pid>),
    Others(Vec<Pid>),
    Interval(Duration),
    Now,
}

/// The UI side: the latest sample and the channel to the sampling thread. The thread stops
/// when this drops.
pub struct MemoryMonitor {
    tx: Option<Sender<Msg>>,
    pub sample: Option<Arc<Sample>>,
    pub interval: Duration,
    /// The shell pids last sent to the thread, so a frame sends only changes.
    sent_excluded: Vec<Pid>,
    /// The pids of the other projects last sent to the thread.
    sent_others: Vec<Pid>,
    /// Pids that count as other projects on top of the workspaces' own. Tests set it: a fake
    /// process tree has no real servers to own.
    pub extra_others: Vec<Pid>,
    /// The menu a press on the widget opens (Restart Language Servers).
    pub menu_open: bool,
}

impl Default for MemoryMonitor {
    fn default() -> Self {
        MemoryMonitor { tx: None, sample: None, interval: DEFAULT_INTERVAL, sent_excluded: Vec::new(), sent_others: Vec::new(), extra_others: Vec::new(), menu_open: false }
    }
}

impl MemoryMonitor {
    /// Starts the sampling thread. The first sample is taken at once.
    pub fn start(&mut self, source: Arc<dyn ProcessSource>, jobs: Jobs) {
        let (tx, rx) = channel();
        let mut interval = self.interval;
        let spawned = std::thread::Builder::new().name("memory sampler".into()).spawn(move || {
            let mut sampler = Sampler::new(source);
            let mut excluded: Vec<Pid> = Vec::new();
            let mut others: Vec<Pid> = Vec::new();
            let mut next = Instant::now();
            loop {
                match rx.recv_timeout(next.saturating_duration_since(Instant::now())) {
                    Ok(Msg::Exclude(pids)) => {
                        excluded = pids;
                        continue;
                    }
                    Ok(Msg::Others(pids)) => {
                        others = pids;
                        continue;
                    }
                    Ok(Msg::Interval(d)) => {
                        next = next.checked_sub(interval).map_or(next, |n| n + d);
                        interval = d;
                        continue;
                    }
                    Ok(Msg::Now) | Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => return,
                }
                let sample = Arc::new(sampler.sample_with(&excluded, &others));
                next = Instant::now() + interval;
                jobs.post(move |state| state.memory.sample = Some(sample));
            }
        });
        // Without the thread the widget stays hidden; nothing else depends on it.
        self.tx = spawned.ok().map(|_| tx);
    }

    pub fn running(&self) -> bool {
        self.tx.is_some()
    }

    pub fn set_interval(&mut self, d: Duration) {
        if d != self.interval {
            self.interval = d;
            self.send(Msg::Interval(d));
        }
    }

    /// Takes a sample now instead of waiting for the timer (tests).
    pub fn sample_now(&self) {
        self.send(Msg::Now);
    }

    /// Sends the shell pids to the thread when they changed since the last call. Allocates
    /// only on a change, so it can run every frame.
    pub fn exclude(&mut self, pids: impl Iterator<Item = Pid> + Clone) {
        if self.tx.is_none() || pids.clone().eq(self.sent_excluded.iter().copied()) {
            return;
        }
        self.sent_excluded = pids.collect();
        self.send(Msg::Exclude(self.sent_excluded.clone()));
    }

    /// Sends the pids owned by the workspaces that are not active, when they changed since the
    /// last call. Allocates only on a change, so it can run every frame.
    pub fn others(&mut self, pids: impl Iterator<Item = Pid> + Clone) {
        if self.tx.is_none() || pids.clone().eq(self.sent_others.iter().copied()) {
            return;
        }
        self.sent_others = pids.collect();
        self.send(Msg::Others(self.sent_others.clone()));
    }

    fn send(&self, msg: Msg) {
        if let Some(tx) = &self.tx {
            let _ = tx.send(msg);
        }
    }
}

/// The status bar widget. Hidden until the first sample arrives.
pub fn status_widget(s: &mut AppState, ui: &mut Ui) {
    let shells: Vec<Pid> = s.all_ws().flat_map(|w| w.terminals.shell_pids()).collect();
    s.memory.exclude(shells.iter().copied());
    let active = s.active_id();
    let mut others: Vec<Pid> = s.all_ws().filter(|w| w.id != active).flat_map(|w| w.owned_pids()).collect();
    others.extend_from_slice(&s.memory.extra_others);
    s.memory.others(others.iter().copied());
    let Some(sample) = s.memory.sample.clone() else { return };
    let t = &theme::T;
    let off = s.ws.langs.is_off();
    let text = format!("{} of {}M", mib(sample.total), mib(sample.ram));
    let font = FontId::proportional(t.font.small);
    let galley = ui.painter().layout_no_wrap(text, font.clone(), t.text);
    // Stop Language Servers: the widget says so, so a dead Cmd+B has a visible reason.
    let off_galley = off.then(|| ui.painter().layout_no_wrap("servers off".into(), font, t.text_dim));
    let off_w = off_galley.as_ref().map_or(0.0, |g| g.size().x + 10.0);
    let size = vec2(galley.size().x + 16.0 + off_w, 18.0);
    let (rect, response) = ui.allocate_exact_size(size, Sense::click());
    response.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, "Memory indicator"));
    if crate::clicks::pressed(&response) {
        s.memory.menu_open = !s.memory.menu_open;
    }
    let radius = CornerRadius::from(t.radius.small);
    let track = if response.hovered() || s.memory.menu_open { t.hover } else { t.memory_track };
    ui.painter().rect_filled(rect, radius, track);
    let share = if sample.ram > 0 { (sample.total as f64 / sample.ram as f64).clamp(0.0, 1.0) as f32 } else { 0.0 };
    if share > 0.0 {
        let fill = Rect::from_min_size(rect.min, vec2((rect.width() * share).max(2.0), rect.height()));
        ui.painter().rect_filled(fill, radius, t.memory_fill);
    }
    let text_rect = Rect::from_min_size(rect.min, vec2(rect.width() - off_w, rect.height()));
    ui.painter().galley(Align2::CENTER_CENTER.align_size_within_rect(galley.size(), text_rect).min, galley, t.text);
    if let Some(g) = off_galley {
        let at = Align2::RIGHT_CENTER.align_size_within_rect(g.size(), rect.shrink2(vec2(8.0, 0.0))).min;
        ui.painter().galley(at, g, t.text_dim);
    }
    if s.memory.menu_open {
        menu(s, ui.ctx(), rect);
        return;
    }
    let deterministic = s.deterministic;
    let interval = s.memory.interval;
    response.on_hover_ui(|ui| {
        tooltip(ui, &sample, interval, deterministic);
        if off {
            ui.label(RichText::new("Language servers of this project are stopped.").size(theme::T.font.small).color(theme::T.warning));
        }
    });
}

const MENU_ROW_H: f32 = 26.0;
const MENU_PAD: f32 = 6.0;
const MENU_W: f32 = 300.0;

/// The widget's menu, above the status bar at the widget's right edge. Rows act on the press.
/// A press outside it or Escape closes it.
fn menu(s: &mut AppState, ctx: &egui::Context, widget: Rect) {
    use crate::lang::restart::{language_servers, Action, Scope};
    let t = &theme::T;
    let mut rows = if s.ws.langs.is_off() {
        vec![("Start Language Servers", Scope::Active, Action::Start)]
    } else {
        vec![("Restart Language Servers", Scope::Active, Action::Restart), ("Stop Language Servers", Scope::Active, Action::Stop)]
    };
    let projects: Vec<bool> = s.all_ws().filter(|w| w.project.is_some()).map(|w| w.langs.is_off()).collect();
    if projects.len() > 1 {
        if projects.iter().any(|off| !off) {
            rows.push(("Restart Language Servers (All Projects)", Scope::All, Action::Restart));
            rows.push(("Stop Language Servers (All Projects)", Scope::All, Action::Stop));
        }
        if projects.iter().any(|off| *off) {
            rows.push(("Start Language Servers (All Projects)", Scope::All, Action::Start));
        }
    }
    let frame = egui::Frame::popup(&ctx.style())
        .fill(t.popup_bg)
        .stroke(egui::Stroke::new(1.0_f32, t.popup_border))
        .corner_radius(CornerRadius::same(t.radius.popup as u8))
        .inner_margin(egui::Margin::same(MENU_PAD as i8))
        .shadow(t.popup_shadow());
    let margin = frame.total_margin().sum();
    let height = rows.len() as f32 * MENU_ROW_H;
    let screen = ctx.screen_rect();
    let x = (widget.max.x - MENU_W - margin.x).max(screen.min.x);
    let pos = egui::pos2(x, widget.min.y - 4.0 - height - margin.y);
    let mut chosen = None;
    let area = egui::Area::new(egui::Id::new("memory-menu")).order(egui::Order::Foreground).fixed_pos(pos).constrain(false).show(ctx, |ui| {
        frame.show(ui, |ui| {
            // An explicit size: an Area otherwise offers its content last frame's size.
            ui.set_width(MENU_W);
            ui.set_height(height);
            let origin = ui.min_rect().min;
            for (i, (label, scope, action)) in rows.iter().enumerate() {
                let row = Rect::from_min_size(origin + vec2(0.0, i as f32 * MENU_ROW_H), vec2(MENU_W, MENU_ROW_H));
                let resp = ui.interact(row, egui::Id::new(("memory-menu-row", *label)), Sense::click());
                crate::util::label_widget(&resp, egui::WidgetType::Button, *label);
                if resp.hovered() {
                    ui.painter().rect_filled(row, t.radius.row, t.selection);
                }
                let color = if resp.hovered() { t.text_bright } else { t.text };
                ui.painter().text(egui::pos2(row.min.x + 10.0, row.center().y), Align2::LEFT_CENTER, *label, t.ui_font(), color);
                if crate::clicks::pressed(&resp) {
                    chosen = Some((*scope, *action));
                }
            }
        });
    });
    let menu_rect = area.response.rect;
    let pressed_outside = ctx.input(|i| i.pointer.any_pressed() && i.pointer.interact_pos().is_some_and(|p| !menu_rect.contains(p) && !widget.contains(p)));
    let escape = ctx.input_mut(|i| i.consume_key(egui::Modifiers::NONE, egui::Key::Escape));
    if pressed_outside || escape {
        s.memory.menu_open = false;
    }
    if let Some((scope, action)) = chosen {
        s.memory.menu_open = false;
        language_servers(s, scope, action);
    }
}

fn tooltip(ui: &mut Ui, sample: &Sample, interval: Duration, deterministic: bool) {
    let t = &theme::T;
    ui.set_min_width(320.0);
    let small = |text: String| RichText::new(text).size(t.font.small);
    ui.label(small(format!("Memory: {} of {} RAM", size_text(sample.total), size_text(sample.ram))).color(t.text_bright));
    ui.add_space(4.0);
    // One grid for all groups, so the columns line up across them.
    egui::Grid::new("memory-rows").num_columns(4).spacing(vec2(14.0, 3.0)).show(ui, |ui| {
        // Numbers are right-aligned in fixed-width cells; a right-to-left layout alone would
        // stretch the column to the tooltip's width.
        let right = |ui: &mut Ui, w: f32, text: RichText| {
            let (rect, _) = ui.allocate_exact_size(vec2(w, t.font.small + 4.0), Sense::hover());
            ui.new_child(egui::UiBuilder::new().max_rect(rect).layout(egui::Layout::right_to_left(egui::Align::Center))).label(text);
        };
        for kind in [Kind::Ide, Kind::LanguageServer, Kind::Other] {
            let mut rows = sample.rows.iter().filter(|r| r.kind == kind).peekable();
            if rows.peek().is_none() {
                continue;
            }
            ui.label(small(kind.title().into()).color(t.text_dim));
            ui.label("");
            right(ui, 64.0, small(size_text(sample.group_total(kind))).color(t.text_dim));
            ui.label("");
            ui.end_row();
            for r in rows {
                ui.label(small(format!("  {}", r.name)).color(t.text));
                ui.label(small(r.pid.to_string()).color(t.text_dim));
                right(ui, 64.0, small(size_text(r.memory)).color(t.text));
                let cpu = r.cpu.map_or_else(|| "–".to_string(), |c| format!("{c:.1}%"));
                right(ui, 48.0, small(cpu).color(t.text_dim));
                ui.end_row();
                if r.defunct > 0 {
                    ui.label(small(format!("    {} defunct", r.defunct)).color(t.text_dim));
                    ui.end_row();
                }
            }
        }
        // One line for all other projects: the rows above stay about the project in view.
        let others = sample.group_total(Kind::OtherProjects);
        if sample.rows.iter().any(|r| r.kind == Kind::OtherProjects) {
            ui.label(small(Kind::OtherProjects.title().into()).color(t.text_dim));
            ui.label("");
            right(ui, 64.0, small(size_text(others)).color(t.text_dim));
            ui.label("");
            ui.end_row();
        }
    });
    ui.add_space(6.0);
    ui.label(small("Terminal shells and git commands are not counted.".into()).color(t.text_dim));
    if deterministic {
        ui.label(small(format!("Sampled every {} s", interval.as_secs())).color(t.text_dim));
        return;
    }
    let elapsed = sample.taken.elapsed();
    ui.label(small(format!("{} · sample took {:.2} ms", timer_text(elapsed, interval), sample.cost.as_secs_f64() * 1000.0)).color(t.text_dim));
    // The timer ticks once a second, and only while the tooltip is open.
    let to_next_second = Duration::from_secs(1) - Duration::from_nanos(elapsed.subsec_nanos() as u64);
    ui.ctx().request_repaint_after(to_next_second);
}

/// "updated 7 s ago · next in 8 s".
pub fn timer_text(elapsed: Duration, interval: Duration) -> String {
    let ago = elapsed.as_secs();
    let next = interval.saturating_sub(elapsed).as_secs_f64().ceil() as u64;
    format!("updated {ago} s ago · next in {next} s")
}

fn mib(bytes: u64) -> u64 {
    bytes / (1024 * 1024)
}

/// "84 MB", "1.6 GB", "4.2 MB".
pub fn size_text(bytes: u64) -> String {
    let mb = bytes as f64 / (1024.0 * 1024.0);
    if mb >= 1024.0 {
        format!("{:.1} GB", mb / 1024.0)
    } else if mb >= 10.0 {
        format!("{mb:.0} MB")
    } else {
        format!("{mb:.1} MB")
    }
}

/// CPU time of the calling thread, to measure what one sample costs.
fn thread_cpu_time() -> Duration {
    #[cfg(unix)]
    {
        let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
        // SAFETY: clock_gettime writes one timespec we own.
        if unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut ts) } == 0 {
            return Duration::new(ts.tv_sec as u64, ts.tv_nsec as u32);
        }
    }
    Duration::ZERO
}

// libc deprecates its copy in favour of the mach2 crate; one declaration is cheaper.
#[cfg(target_os = "macos")]
#[repr(C)]
struct MachTimebase {
    numer: u32,
    denom: u32,
}

#[cfg(target_os = "macos")]
extern "C" {
    fn mach_timebase_info(info: *mut MachTimebase) -> libc::c_int;
}

/// The OS process source.
pub struct RealSource {
    #[cfg(target_os = "macos")]
    timebase: (u64, u64),
}

impl RealSource {
    /// `None` on platforms without an implementation.
    pub fn new() -> Option<RealSource> {
        #[cfg(target_os = "macos")]
        {
            let mut tb = MachTimebase { numer: 0, denom: 0 };
            // SAFETY: mach_timebase_info fills the struct we pass.
            unsafe { mach_timebase_info(&mut tb) };
            let timebase = if tb.denom == 0 { (1, 1) } else { (tb.numer as u64, tb.denom as u64) };
            Some(RealSource { timebase })
        }
        #[cfg(target_os = "linux")]
        {
            Some(RealSource {})
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            None
        }
    }
}

#[cfg(target_os = "macos")]
impl ProcessSource for RealSource {
    fn self_pid(&self) -> Pid {
        std::process::id()
    }

    fn children(&self, pid: Pid, out: &mut Vec<Pid>) {
        let mut buf = [0 as libc::pid_t; 128];
        // SAFETY: the buffer size is passed in bytes; the call returns the number of pids.
        let n = unsafe { libc::proc_listchildpids(pid as libc::pid_t, buf.as_mut_ptr().cast(), std::mem::size_of_val(&buf) as libc::c_int) };
        if n <= 0 {
            return;
        }
        let n = n as usize;
        if n < buf.len() {
            out.extend(buf[..n].iter().map(|&p| p as Pid));
            return;
        }
        // A full buffer may have been cut off: ask again with room to spare.
        let mut big = vec![0 as libc::pid_t; 8192];
        // SAFETY: as above.
        let n = unsafe { libc::proc_listchildpids(pid as libc::pid_t, big.as_mut_ptr().cast(), (big.len() * std::mem::size_of::<libc::pid_t>()) as libc::c_int) };
        if n > 0 {
            out.extend(big[..(n as usize).min(big.len())].iter().map(|&p| p as Pid));
        }
    }

    fn stat(&self, pid: Pid) -> Option<ProcStat> {
        // SAFETY: rusage_info_v4 is plain data; proc_pid_rusage fills it for flavor V4.
        let mut info: libc::rusage_info_v4 = unsafe { std::mem::zeroed() };
        let ok = unsafe { libc::proc_pid_rusage(pid as libc::c_int, libc::RUSAGE_INFO_V4, (&mut info as *mut libc::rusage_info_v4).cast()) };
        if ok != 0 {
            return None;
        }
        let mut name = [0u8; 64];
        // SAFETY: proc_name writes at most `len` bytes and returns the length.
        let len = unsafe { libc::proc_name(pid as libc::c_int, name.as_mut_ptr().cast(), name.len() as u32) };
        // The times are mach absolute time units, not nanoseconds, on Apple Silicon.
        let ticks = info.ri_user_time + info.ri_system_time;
        let cpu_ns = (ticks as u128 * self.timebase.0 as u128 / self.timebase.1 as u128) as u64;
        // Only a zombie has no name, so a living process pays no extra call.
        if len <= 0 && is_zombie(pid) {
            return Some(ProcStat { name: String::new(), memory: 0, cpu_ns, zombie: true });
        }
        let name = if len > 0 { String::from_utf8_lossy(&name[..len as usize]).into_owned() } else { "?".to_string() };
        Some(ProcStat { name, memory: info.ri_phys_footprint, cpu_ns, zombie: false })
    }

    fn physical_ram(&self) -> u64 {
        let mut ram: u64 = 0;
        let mut len = std::mem::size_of::<u64>();
        // SAFETY: hw.memsize is a u64; sysctlbyname writes at most `len` bytes.
        let ok = unsafe { libc::sysctlbyname(c"hw.memsize".as_ptr(), (&mut ram as *mut u64).cast(), &mut len, std::ptr::null_mut(), 0) };
        if ok == 0 {
            ram
        } else {
            0
        }
    }
}

/// A zombie keeps its rusage (its parent's `wait` reads it), but `proc_pidinfo` answers
/// `ESRCH` for it. Call it only after `proc_pid_rusage` succeeded for `pid`.
#[cfg(target_os = "macos")]
fn is_zombie(pid: Pid) -> bool {
    // SAFETY: proc_bsdshortinfo is plain data; proc_pidinfo fills at most `size` bytes of it.
    let mut info: libc::proc_bsdshortinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdshortinfo>() as libc::c_int;
    let n = unsafe { libc::proc_pidinfo(pid as libc::c_int, libc::PROC_PIDT_SHORTBSDINFO, 0, (&mut info as *mut libc::proc_bsdshortinfo).cast(), size) };
    if n == size {
        return info.pbsi_status == libc::SZOMB;
    }
    std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
}

#[cfg(target_os = "linux")]
impl ProcessSource for RealSource {
    fn self_pid(&self) -> Pid {
        std::process::id()
    }

    fn children(&self, pid: Pid, out: &mut Vec<Pid>) {
        let Ok(tasks) = std::fs::read_dir(format!("/proc/{pid}/task")) else { return };
        for task in tasks.flatten() {
            if let Ok(text) = std::fs::read_to_string(task.path().join("children")) {
                out.extend(text.split_whitespace().filter_map(|p| p.parse::<Pid>().ok()));
            }
        }
    }

    fn stat(&self, pid: Pid) -> Option<ProcStat> {
        // SAFETY: sysconf only reads system constants.
        let (page, tick) = unsafe { (libc::sysconf(libc::_SC_PAGESIZE) as u64, libc::sysconf(libc::_SC_CLK_TCK).max(1) as u64) };
        let statm = std::fs::read_to_string(format!("/proc/{pid}/statm")).ok()?;
        let resident: u64 = statm.split_whitespace().nth(1)?.parse().ok()?;
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        // Fields after the parenthesised name: state is field 3, utime 14, stime 15.
        let rest = &stat[stat.rfind(')')? + 2..];
        let fields: Vec<&str> = rest.split_whitespace().collect();
        let ticks: u64 = fields.get(11)?.parse::<u64>().ok()? + fields.get(12)?.parse::<u64>().ok()?;
        let name = std::fs::read_to_string(format!("/proc/{pid}/comm")).map(|n| n.trim().to_string()).unwrap_or_else(|_| "?".into());
        let zombie = fields.first() == Some(&"Z");
        Some(ProcStat { name, memory: resident * page, cpu_ns: ticks * 1_000_000_000 / tick, zombie })
    }

    fn physical_ram(&self) -> u64 {
        // SAFETY: sysconf only reads system constants.
        unsafe { (libc::sysconf(libc::_SC_PHYS_PAGES).max(0) as u64) * (libc::sysconf(libc::_SC_PAGESIZE).max(0) as u64) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MB: u64 = 1024 * 1024;

    /// A tree: the IDE (1), tsserver under node (2, with a helper 3), rust-analyzer (4, with a
    /// proc-macro server 5), a terminal shell (6, running claude 7), git (8, with a remote
    /// helper 9) and rustc (10).
    struct Fake;

    impl ProcessSource for Fake {
        fn self_pid(&self) -> Pid {
            1
        }
        fn children(&self, pid: Pid, out: &mut Vec<Pid>) {
            out.extend_from_slice(match pid {
                1 => &[2, 4, 6, 8, 10],
                2 => &[3],
                4 => &[5],
                6 => &[7],
                8 => &[9],
                _ => &[],
            });
        }
        fn stat(&self, pid: Pid) -> Option<ProcStat> {
            let name = ["", "harwex-ide", "node", "node", "rust-analyzer", "rust-analyzer-proc-macro-srv", "zsh", "claude", "git", "git-remote-https", "rustc"][pid as usize];
            Some(ProcStat { name: name.into(), memory: pid as u64 * MB, cpu_ns: 0, zombie: false })
        }
        fn physical_ram(&self) -> u64 {
            16 * 1024 * MB
        }
    }

    #[test]
    fn groups_and_exclusions() {
        let mut sampler = Sampler::new(Arc::new(Fake));
        let s = sampler.sample(&[6]);
        let pids = |k: Kind| s.rows.iter().filter(|r| r.kind == k).map(|r| r.pid).collect::<Vec<_>>();
        assert_eq!(pids(Kind::Ide), vec![1]);
        assert_eq!(pids(Kind::LanguageServer), vec![5, 4, 3, 2], "largest first, helpers count with their server");
        assert_eq!(pids(Kind::Other), vec![10]);
        assert_eq!(s.total, (1 + 2 + 3 + 4 + 5 + 10) * MB, "the shell subtree (6, 7) and git (8, 9) are left out");
        assert!(s.rows.iter().all(|r| r.cpu.is_none()), "the first sample has no CPU%");
        assert_eq!(s.seq, 1);
    }

    /// `Fake` plus a second project: its tsserver (11, a `node` with a helper 12) and its
    /// terminal shell (13, running a build 14), all direct children of the IDE.
    struct TwoProjects;

    impl ProcessSource for TwoProjects {
        fn self_pid(&self) -> Pid {
            1
        }
        fn children(&self, pid: Pid, out: &mut Vec<Pid>) {
            match pid {
                1 => out.extend_from_slice(&[2, 4, 6, 8, 10, 11, 13]),
                11 => out.push(12),
                13 => out.push(14),
                _ => Fake.children(pid, out),
            }
        }
        fn stat(&self, pid: Pid) -> Option<ProcStat> {
            let name = match pid {
                11 | 12 => "node",
                13 => "zsh",
                14 => "cargo",
                _ => return Fake.stat(pid),
            };
            Some(ProcStat { name: name.into(), memory: pid as u64 * MB, cpu_ns: 0, zombie: false })
        }
        fn physical_ram(&self) -> u64 {
            Fake.physical_ram()
        }
    }

    #[test]
    fn background_project_lands_in_other_projects() {
        let mut sampler = Sampler::new(Arc::new(TwoProjects));
        // The UI sends every shell as excluded and the background workspace's owned pids
        // (its shell 13 and its server 11) as others.
        let s = sampler.sample_with(&[6, 13], &[13, 11]);
        let pids = |k: Kind| s.rows.iter().filter(|r| r.kind == k).map(|r| r.pid).collect::<Vec<_>>();
        assert_eq!(pids(Kind::Ide), vec![1]);
        assert_eq!(pids(Kind::LanguageServer), vec![5, 4, 3, 2], "only the active project's servers");
        assert_eq!(pids(Kind::Other), vec![10]);
        assert_eq!(pids(Kind::OtherProjects), vec![12, 11], "the server and its helper subtree");
        assert_eq!(s.group_total(Kind::OtherProjects), (11 + 12) * MB);
        assert_eq!(s.total, (1 + 2 + 3 + 4 + 5 + 10 + 11 + 12) * MB, "the total counts all projects; shells stay out");

        // Without the ownership sets the same server counts as the active project's.
        let s = sampler.sample(&[6, 13]);
        assert!(s.rows.iter().all(|r| r.kind != Kind::OtherProjects));
        assert_eq!(s.group_total(Kind::LanguageServer), (2 + 3 + 4 + 5 + 11 + 12) * MB);
    }

    #[test]
    fn owned_pid_below_a_wrapper_is_found() {
        // A background server 3 runs under the active project's node 2 (a wrapper).
        let mut sampler = Sampler::new(Arc::new(Fake));
        let s = sampler.sample_with(&[6], &[3]);
        let kind = |pid: Pid| s.rows.iter().find(|r| r.pid == pid).unwrap().kind;
        assert_eq!((kind(2), kind(3)), (Kind::LanguageServer, Kind::OtherProjects));
    }

    /// `Fake` plus 25 zombies under node 2 (100..125) and 2 under the IDE itself (200, 201).
    struct Zombies;

    impl ProcessSource for Zombies {
        fn self_pid(&self) -> Pid {
            1
        }
        fn children(&self, pid: Pid, out: &mut Vec<Pid>) {
            Fake.children(pid, out);
            match pid {
                1 => out.extend([200, 201]),
                2 => out.extend(100..125),
                _ => {}
            }
        }
        fn stat(&self, pid: Pid) -> Option<ProcStat> {
            if pid >= 100 {
                return Some(ProcStat { name: String::new(), memory: 0, cpu_ns: 0, zombie: true });
            }
            Fake.stat(pid)
        }
        fn physical_ram(&self) -> u64 {
            Fake.physical_ram()
        }
    }

    #[test]
    fn zombies_fold_into_their_parent_row() {
        let mut sampler = Sampler::new(Arc::new(Zombies));
        let s = sampler.sample(&[6]);
        assert!(s.rows.iter().all(|r| r.pid < 100), "no row per zombie: {:?}", s.rows);
        let defunct = |pid: Pid| s.rows.iter().find(|r| r.pid == pid).unwrap().defunct;
        assert_eq!((defunct(2), defunct(1), defunct(3), defunct(4)), (25, 2, 0, 0));
        assert_eq!(s.total, (1 + 2 + 3 + 4 + 5 + 10) * MB);
        assert_eq!(defunct_in_tree(&Zombies, 2), 25);
        assert_eq!(defunct_in_tree(&Zombies, 1), 27, "the walk goes through living children");
        assert_eq!(defunct_in_tree(&Zombies, 4), 0);
    }

    #[test]
    fn cpu_percent_between_samples() {
        struct Busy(std::sync::atomic::AtomicU64, Instant);
        impl ProcessSource for Busy {
            fn self_pid(&self) -> Pid {
                1
            }
            fn children(&self, _: Pid, _: &mut Vec<Pid>) {}
            fn stat(&self, _: Pid) -> Option<ProcStat> {
                Some(ProcStat { name: "harwex-ide".into(), memory: MB, cpu_ns: self.0.load(std::sync::atomic::Ordering::SeqCst), zombie: false })
            }
            fn physical_ram(&self) -> u64 {
                MB
            }
            fn now(&self) -> Instant {
                // 15 s between samples; 3 s of CPU time each.
                let ns = self.0.fetch_add(3_000_000_000, std::sync::atomic::Ordering::SeqCst);
                self.1 + Duration::from_nanos(ns * 5)
            }
        }
        let mut sampler = Sampler::new(Arc::new(Busy(Default::default(), Instant::now())));
        sampler.sample(&[]);
        let s = sampler.sample(&[]);
        assert_eq!(s.rows[0].cpu, Some(20.0));
    }

    #[test]
    fn texts() {
        assert_eq!(timer_text(Duration::from_millis(7_300), DEFAULT_INTERVAL), "updated 7 s ago · next in 8 s");
        assert_eq!(timer_text(Duration::from_secs(20), DEFAULT_INTERVAL), "updated 20 s ago · next in 0 s");
        assert_eq!(size_text(84 * MB), "84 MB");
        assert_eq!(size_text(MB * 42 / 10), "4.2 MB");
        assert_eq!(size_text(1638 * MB), "1.6 GB");
    }
}
