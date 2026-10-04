//! Problems in open files: TypeScript errors from the TS server, lint errors from oxlint and
//! ESLint.
//!
//! - Which sources check a file is decided per package (`strategy`): the TS server already
//!   runs for navigation, so no extra type checker starts. oxlint runs where a package has
//!   it configured.
//! - Only open files are checked. After an edit the request waits 300 ms, older requests in
//!   the queues are skipped, and the previous results stay visible, shifted through the
//!   edit journal, until new ones arrive. A save asks again at once.
//! - TS requests go through the TypeScript queue of `state.ws.langs`, after the text sync.
//!   Linters run on `state.ws.langs.lint`, one queue thread for every `LintSource`.
//! - The UI (squiggles, scrollbar marks, the counts widget, F2, the Problems window) reads
//!   only `Problem`s, so a new source plugs in as a `LintSource` and a `SourceId`.

pub mod eslint;
pub mod oxlint;
pub mod problems;
pub mod strategy;

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use ide_editor::{Document, Position, ProblemMark, ProblemSeverity, TextChange};
use ide_lsp::{Diagnostic, Severity};

use crate::jobs::Jobs;
use crate::lang::LangId;
use crate::state::AppState;
use crate::tabs::TabId;
use strategy::{EslintPlan, Markers, OxlintPlan, Plan};

/// How long typing must rest before the files are checked again.
pub const DEBOUNCE: Duration = Duration::from_millis(300);

/// Where a problem comes from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum SourceId {
    TypeScript,
    Oxlint,
    Eslint,
}

impl SourceId {
    pub fn name(self) -> &'static str {
        match self {
            SourceId::TypeScript => "ts",
            SourceId::Oxlint => "oxlint",
            SourceId::Eslint => "eslint",
        }
    }
}

/// One problem in char indices of the text at the version its file result holds.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Problem {
    pub start: usize,
    pub end: usize,
    pub severity: ProblemSeverity,
    pub message: String,
    pub source: SourceId,
    /// `2322`, `eslint(no-debugger)`.
    pub code: Option<String>,
}

impl Problem {
    /// "ts(2322)", "oxlint(no-debugger)" or "eslint(no-debugger)", as IDEA names the inspection.
    pub fn origin(&self) -> String {
        match (self.source, &self.code) {
            (SourceId::TypeScript, Some(code)) => format!("ts({code})"),
            (SourceId::Oxlint, Some(code)) => {
                // oxlint codes read "eslint(no-debugger)"; the rule name is in the parens.
                let rule = code.split_once('(').map_or(code.as_str(), |(_, r)| r.trim_end_matches(')'));
                format!("oxlint({rule})")
            }
            // ESLint codes are the rule ids: "no-debugger", "@typescript-eslint/no-floating-promises".
            (SourceId::Eslint, Some(rule)) => format!("eslint({rule})"),
            (s, None) => s.name().to_string(),
        }
    }

    /// The full code as the tool reports it, when it says more than `origin`.
    pub fn code_detail(&self) -> Option<&str> {
        match (self.source, &self.code) {
            (SourceId::Oxlint, Some(code)) => Some(code),
            _ => None,
        }
    }
}

/// LSP severity to how the editor draws it.
pub fn severity(d: &Diagnostic) -> ProblemSeverity {
    match d.severity {
        _ if d.unnecessary => ProblemSeverity::Unused,
        Severity::Error => ProblemSeverity::Error,
        Severity::Warning => ProblemSeverity::Warning,
        Severity::Information => ProblemSeverity::Weak,
        Severity::Hint => ProblemSeverity::Unused,
    }
}

/// Diagnostics (lines and char columns of `text`) as problems in char indices of `text`.
/// Lines break at `\n` like the servers count them; a `\r` before it belongs to the line.
pub fn to_problems(text: &str, source: SourceId, diags: &[Diagnostic]) -> Vec<Problem> {
    let mut starts = vec![0usize];
    let mut lens = Vec::new();
    let mut chars = 0usize;
    let mut line_chars = 0usize;
    for c in text.chars() {
        chars += 1;
        if c == '\n' {
            lens.push(line_chars);
            starts.push(chars);
            line_chars = 0;
        } else {
            line_chars += 1;
        }
    }
    lens.push(line_chars);
    let at = |line: usize, col: usize| -> usize {
        match starts.get(line) {
            Some(&s) => s + col.min(lens[line]),
            None => chars,
        }
    };
    let mut out: Vec<Problem> = diags
        .iter()
        .map(|d| {
            let start = at(d.line, d.column);
            Problem {
                start,
                end: at(d.end_line, d.end_column).max(start),
                severity: severity(d),
                message: d.message.trim().to_string(),
                source,
                code: d.code.clone(),
            }
        })
        .collect();
    out.sort_by_key(|p| (p.start, p.severity));
    out
}

/// Moves problems through raw edits. A problem keeps its text: an insert at its start pushes
/// it right, an insert at its end does not grow it. A problem whose text was deleted goes.
pub fn shift(problems: &mut Vec<Problem>, changes: &[TextChange]) {
    for c in changes {
        problems.retain_mut(|p| {
            let was_empty = p.start == p.end;
            let covered = c.removed > 0 && p.start >= c.start && p.end <= c.start + c.removed && !was_empty;
            if covered {
                return false;
            }
            let start = c.map(p.start, was_empty || p.start != c.start || c.removed == 0);
            let end = c.map(p.end, false).max(start);
            p.start = start;
            p.end = end;
            true
        });
    }
    problems.sort_by_key(|p| (p.start, p.severity));
}

/// The diagnostics of one source for a file, at the doc version they belong to.
struct SourceResult {
    version: u64,
    problems: Vec<Problem>,
}

/// Per editor tab: the plan, the last results per source and what is in flight.
#[derive(Default)]
pub struct FileProblems {
    pub plan: Option<Plan>,
    detecting: bool,
    results: BTreeMap<SourceId, SourceResult>,
    /// The doc version the last request was made for.
    requested: Option<u64>,
    /// Ask again even though the version did not move (after a save).
    pub force: bool,
    /// The newest request; queued older ones are skipped.
    latest: Arc<AtomicU64>,
    /// Bumped when a result lands, so the merged list is rebuilt.
    results_gen: u64,
    current_for: Option<(u64, u64)>,
    /// Every source's problems at the current doc version, sorted by start.
    pub current: Vec<Problem>,
    /// `current` for the editor widget.
    pub marks: Vec<ProblemMark>,
}

impl FileProblems {
    /// Shifts the results to the doc's version and rebuilds `current` and `marks` when
    /// anything moved. Cheap when nothing did.
    pub fn refresh(&mut self, doc: &Document) {
        let key = (doc.version(), self.results_gen);
        if self.current_for == Some(key) {
            return;
        }
        for r in self.results.values_mut() {
            if r.version != doc.version() {
                // When the journal no longer reaches back, they stay where they were.
                if let Some(changes) = doc.changes_since(r.version) {
                    shift(&mut r.problems, &changes);
                }
                r.version = doc.version();
            }
        }
        let len = doc.len_chars();
        self.current = self.results.values().flat_map(|r| r.problems.iter().cloned()).filter(|p| p.start <= len).collect();
        self.current.sort_by_key(|p| (p.start, p.severity));
        self.marks = self.current.iter().map(|p| ProblemMark { start: p.start, end: p.end.min(len), severity: p.severity }).collect();
        self.current_for = Some(key);
    }

    /// Whether any source answered for this file (the widget shows nothing before).
    pub fn checked(&self) -> bool {
        !self.results.is_empty()
    }

    pub fn count(&self, severity: ProblemSeverity) -> usize {
        self.current.iter().filter(|p| p.severity == severity).count()
    }

    /// Errors and warnings (weak warnings count as warnings), for the widget.
    pub fn counts(&self) -> (usize, usize) {
        let e = self.count(ProblemSeverity::Error);
        let w = self.count(ProblemSeverity::Warning) + self.count(ProblemSeverity::Weak);
        (e, w)
    }

    /// The problems under char `idx`.
    pub fn at(&self, idx: usize) -> Vec<&Problem> {
        self.current.iter().filter(|p| p.start <= idx && (idx < p.end || p.start == p.end && idx == p.start)).collect()
    }

    /// Whether a check is waiting for its debounce, its detection or its answer.
    pub fn pending(&self, version: u64) -> bool {
        self.detecting || self.plan.is_some() && (self.requested != Some(version) || self.force)
    }

    /// Forgets the plan and the results (the settings changed). The tab is checked again.
    pub fn reset(&mut self) {
        let latest = self.latest.clone();
        latest.fetch_add(1, Ordering::SeqCst);
        *self = FileProblems { latest, ..Default::default() };
    }
}

/// What the lint queue runs a source with.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum LintTarget {
    Oxlint(OxlintPlan),
    Eslint(EslintPlan),
}

impl LintTarget {
    pub fn source(&self) -> SourceId {
        match self {
            LintTarget::Oxlint(_) => SourceId::Oxlint,
            LintTarget::Eslint(_) => SourceId::Eslint,
        }
    }
}

/// A linter process family. Calls block; the lint queue thread makes them.
pub trait LintSource: Send + Sync + 'static {
    fn id(&self) -> SourceId;
    /// Lints the editor's `text` of `path`.
    fn lint(&self, target: &LintTarget, path: &Path, text: &str) -> Result<Vec<Diagnostic>, String>;
    /// The editor closed the file.
    fn close(&self, path: &Path);
    /// Stops servers idle for `idle` with no open file. Returns a name per stopped server.
    fn stop_idle(&self, idle: Duration) -> Vec<String>;
    fn running(&self) -> usize;
    fn shutdown(&self);
    /// Process ids of the running linter servers. Must not wait on a busy server.
    fn pids(&self) -> Vec<u32> {
        Vec::new()
    }
}

type LintDone = Box<dyn FnOnce(Option<Result<Vec<Diagnostic>, String>>) + Send>;

enum LintCmd {
    Lint { target: LintTarget, path: PathBuf, text: String, latest: Arc<AtomicU64>, generation: u64, done: LintDone },
    Close(PathBuf),
    Reset,
    IdleTimeout(Duration),
}

/// One queue thread for every linter, so a file's lint requests run in order and a newer
/// request makes the queued older ones no-ops.
pub struct LintQueue {
    tx: Sender<LintCmd>,
    queued: Arc<AtomicUsize>,
    sources: Arc<Vec<Arc<dyn LintSource>>>,
    /// Lint calls made and requests skipped as stale, per source (tests read them).
    counts: Arc<Mutex<HashMap<SourceId, LintCounts>>>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct LintCounts {
    pub runs: u64,
    pub skipped: u64,
}

impl LintQueue {
    pub fn new(sources: Vec<Arc<dyn LintSource>>, jobs: Option<Jobs>) -> LintQueue {
        let (tx, rx) = channel::<LintCmd>();
        let queued = Arc::new(AtomicUsize::new(0));
        let sources = Arc::new(sources);
        let counts: Arc<Mutex<HashMap<SourceId, LintCounts>>> = Arc::default();
        let (done_count, srcs, counted) = (queued.clone(), sources.clone(), counts.clone());
        let _ = std::thread::Builder::new().name("lint queue".into()).spawn(move || {
            let mut idle = crate::lang::config::DEFAULT_IDLE_TIMEOUT;
            let mut last_check = Instant::now();
            loop {
                let tick = (idle / 4).clamp(Duration::from_millis(50), Duration::from_secs(30));
                match rx.recv_timeout(tick.saturating_sub(last_check.elapsed())) {
                    Ok(cmd) => {
                        match cmd {
                            LintCmd::Lint { target, path, text, latest, generation, done } => {
                                let stale = latest.load(Ordering::SeqCst) != generation;
                                {
                                    let mut c = crate::lang::lock(&counted);
                                    let c = c.entry(target.source()).or_default();
                                    if stale {
                                        c.skipped += 1;
                                    } else {
                                        c.runs += 1;
                                    }
                                }
                                if stale {
                                    done(None);
                                } else if let Some(s) = srcs.iter().find(|s| s.id() == target.source()) {
                                    done(Some(s.lint(&target, &path, &text)));
                                } else {
                                    done(None);
                                }
                            }
                            LintCmd::Close(p) => srcs.iter().for_each(|s| s.close(&p)),
                            LintCmd::Reset => srcs.iter().for_each(|s| s.shutdown()),
                            LintCmd::IdleTimeout(d) => idle = d,
                        }
                        done_count.fetch_sub(1, Ordering::SeqCst);
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
                if last_check.elapsed() >= tick {
                    last_check = Instant::now();
                    let stopped: Vec<String> = srcs.iter().flat_map(|s| s.stop_idle(idle)).collect();
                    if let (Some(jobs), false) = (jobs.as_ref(), stopped.is_empty()) {
                        let secs = idle.as_secs_f64();
                        jobs.post(move |state| {
                            for name in stopped {
                                state.timings.log(format!("stopped {name}: idle for {secs:.1} s with no open file"));
                            }
                        });
                    }
                }
            }
            srcs.iter().for_each(|s| s.shutdown());
        });
        LintQueue { tx, queued, sources, counts }
    }

    pub fn counts(&self, source: SourceId) -> LintCounts {
        crate::lang::lock(&self.counts).get(&source).copied().unwrap_or_default()
    }

    fn send(&self, cmd: LintCmd) {
        self.queued.fetch_add(1, Ordering::SeqCst);
        if self.tx.send(cmd).is_err() {
            self.queued.fetch_sub(1, Ordering::SeqCst);
        }
    }

    pub fn queued(&self) -> usize {
        self.queued.load(Ordering::SeqCst)
    }

    pub fn close(&self, path: &Path) {
        self.send(LintCmd::Close(path.to_path_buf()));
    }

    /// Stops every linter: the settings changed. The next file starts them again.
    pub fn reset(&self) {
        self.send(LintCmd::Reset);
    }

    pub fn set_idle_timeout(&self, idle: Duration) {
        self.send(LintCmd::IdleTimeout(idle));
    }

    /// Linter processes running now (tests check lazy start and idle stop with it).
    pub fn running(&self, source: SourceId) -> usize {
        self.sources.iter().filter(|s| s.id() == source).map(|s| s.running()).sum()
    }

    pub fn pids(&self) -> Vec<u32> {
        self.sources.iter().flat_map(|s| s.pids()).collect()
    }

    pub fn sources(&self) -> Arc<Vec<Arc<dyn LintSource>>> {
        self.sources.clone()
    }

    pub fn shutdown(&self) {
        for s in self.sources.iter() {
            s.shutdown();
        }
    }
}

/// App-wide diagnostics state: the markers per directory (detection is cached), notes
/// already shown, and the request generation.
#[derive(Default)]
pub struct DiagnosticsState {
    markers: HashMap<PathBuf, Markers>,
    noted: Vec<String>,
    generation: u64,
}

impl DiagnosticsState {
    /// The project or its settings changed: detect again.
    pub fn reset(&mut self) {
        self.markers.clear();
        self.noted.clear();
    }
}

/// Starts detection, debounced checks and save-triggered checks for every open editor.
/// Called once per frame.
pub fn schedule(state: &mut AppState) {
    let mut wake: Option<Duration> = None;
    let mut detect = Vec::new();
    let mut due = Vec::new();
    for (id, e) in state.ws.tabs.editors_mut() {
        if LangId::for_path(&e.path) != Some(LangId::TypeScript) || e.read_only {
            continue;
        }
        let p = &mut e.problems;
        if p.plan.is_none() {
            if !p.detecting {
                detect.push((id, e.path.clone()));
            }
            continue;
        }
        let version = e.doc.version();
        if p.requested == Some(version) && !p.force {
            continue;
        }
        let rest = e.last_edit.elapsed();
        if p.requested.is_some() && !p.force && rest < DEBOUNCE {
            let left = DEBOUNCE - rest;
            wake = Some(wake.map_or(left, |w| w.min(left)));
            continue;
        }
        due.push(id);
    }
    for (id, path) in detect {
        start_detection(state, id, path);
    }
    for id in due {
        request(state, id);
    }
    if let Some(w) = wake {
        state.ctx.request_repaint_after(w);
    }
}

fn start_detection(state: &mut AppState, id: TabId, path: PathBuf) {
    let dir = path.parent().unwrap_or(&path).to_path_buf();
    if let Some(m) = state.ws.diagnostics.markers.get(&dir).cloned() {
        apply_markers(state, id, m);
        return;
    }
    if let Some(e) = state.ws.tabs.editor_mut(id) {
        e.problems.detecting = true;
    }
    let generation = state.project_generation();
    state.jobs.spawn_quiet(
        move || strategy::detect(&path),
        move |state, markers| {
            if state.project_generation() != generation {
                return;
            }
            state.ws.diagnostics.markers.insert(dir, markers.clone());
            if let Some(e) = state.ws.tabs.editor_mut(id) {
                e.problems.detecting = false;
            }
            apply_markers(state, id, markers);
        },
    );
}

fn apply_markers(state: &mut AppState, id: TabId, markers: Markers) {
    let config = state.ws.langs.config.diagnostics.clone();
    let Some(e) = state.ws.tabs.editor_mut(id) else { return };
    let plan = strategy::plan(e.lang == Some(LangId::TypeScript), &markers, &config);
    let notes = plan.notes.clone();
    e.problems.plan = Some(plan);
    for note in notes {
        if !state.ws.diagnostics.noted.contains(&note) {
            state.ws.diagnostics.noted.push(note.clone());
            state.notifications.log_only(crate::notifications::Level::Warning, "Diagnostics", note);
        }
    }
}

/// Asks every planned source for the tab's current text.
pub fn request(state: &mut AppState, id: TabId) {
    state.ws.diagnostics.generation += 1;
    let generation = state.ws.diagnostics.generation;
    let Some(e) = state.ws.tabs.editor_mut(id) else { return };
    let Some(plan) = e.problems.plan.clone() else { return };
    let version = e.doc.version();
    e.problems.requested = Some(version);
    e.problems.force = false;
    e.problems.latest.store(generation, Ordering::SeqCst);
    // Sources that are no longer planned (settings changed) lose their results.
    e.problems.results.retain(|s, _| match s {
        SourceId::TypeScript => plan.ts,
        SourceId::Oxlint => plan.oxlint.is_some(),
        SourceId::Eslint => plan.eslint.is_some(),
    });
    e.problems.results_gen += 1;
    if plan.is_empty() {
        return;
    }
    let path = e.path.clone();
    let text: Arc<str> = Arc::from(e.doc.text());
    let latest = e.problems.latest.clone();
    if plan.ts {
        crate::nav::flush_lsp(state, id);
        let (jobs, path, text, latest) = (state.jobs.clone(), path.clone(), text.clone(), latest.clone());
        state.ws.langs.bridge(LangId::TypeScript).run(move |server| {
            if latest.load(Ordering::SeqCst) != generation {
                return;
            }
            let result = server.diagnostics(&path).map(|d| d.map(|d| to_problems(&text, SourceId::TypeScript, &d)));
            jobs.post(move |state| deliver(state, id, generation, version, SourceId::TypeScript, result));
        });
    }
    let targets = plan.oxlint.map(LintTarget::Oxlint).into_iter().chain(plan.eslint.map(LintTarget::Eslint));
    for target in targets {
        let source = target.source();
        let (jobs, done_text) = (state.jobs.clone(), text.clone());
        state.ws.langs.lint.send(LintCmd::Lint {
            target,
            path: path.clone(),
            text: text.to_string(),
            latest: latest.clone(),
            generation,
            done: Box::new(move |result| {
                let Some(result) = result else { return };
                let result = result.map(|d| Some(to_problems(&done_text, source, &d)));
                jobs.post(move |state| deliver(state, id, generation, version, source, result));
            }),
        });
    }
}

fn deliver(state: &mut AppState, id: TabId, generation: u64, version: u64, source: SourceId, result: Result<Option<Vec<Problem>>, String>) {
    let Some(e) = state.ws.tabs.editor_mut(id) else { return };
    if e.problems.latest.load(Ordering::SeqCst) != generation {
        return;
    }
    match result {
        Ok(Some(problems)) => {
            e.problems.results.insert(source, SourceResult { version, problems });
            e.problems.results_gen += 1;
        }
        // The server has no diagnostics (not a TypeScript file it serves).
        Ok(None) => {}
        Err(err) => {
            e.problems.results.remove(&source);
            e.problems.results_gen += 1;
            let note = format!("{}: {err}", source.name());
            if !state.ws.diagnostics.noted.contains(&note) {
                state.ws.diagnostics.noted.push(note.clone());
                match source {
                    // Navigation already tells about a missing or broken TS server; a second
                    // notice for the same cause is noise.
                    SourceId::TypeScript => state.timings.log(format!("diagnostics failed: {note}")),
                    _ => state.notifications.warn("Diagnostics failed", note),
                }
            }
        }
    }
}

/// F2 (`forward`) and Shift+F2: the next or previous problem in the active editor, errors
/// first like IDEA, wrapping around the file.
pub fn goto_next(state: &mut AppState, forward: bool) {
    let Some(e) = state.ws.tabs.active_editor_mut() else { return };
    e.problems.refresh(&e.doc);
    let errors = e.problems.count(ProblemSeverity::Error) > 0;
    let starts: Vec<usize> = e
        .problems
        .current
        .iter()
        .filter(|p| p.severity != ProblemSeverity::Unused && (!errors || p.severity == ProblemSeverity::Error))
        .map(|p| p.start)
        .collect();
    if starts.is_empty() {
        return;
    }
    let caret = e.view.caret_char(&e.doc);
    let target = if forward {
        starts.iter().copied().find(|&s| s > caret).unwrap_or(starts[0])
    } else {
        starts.iter().rev().copied().find(|&s| s < caret).unwrap_or(starts[starts.len() - 1])
    };
    let pos = e.doc.char_to_position(target);
    e.view.reveal(pos);
    e.view.request_focus();
}

/// The hover text for problems under `pos`: (message, origin and code) per problem.
pub fn hover_lines(e: &crate::tabs::EditorTab, pos: Position) -> Vec<(ProblemSeverity, String, String)> {
    let idx = e.doc.position_to_char(pos);
    e.problems
        .at(idx)
        .into_iter()
        .map(|p| {
            let origin = match p.code_detail() {
                Some(code) if !p.origin().contains(code) => format!("{} {code}", p.origin()),
                _ => p.origin(),
            };
            (p.severity, p.message.clone(), origin)
        })
        .collect()
}

/// Rows for the Problems window: path, position, problem.
pub fn file_rows(e: &crate::tabs::EditorTab) -> Vec<(Position, &Problem)> {
    e.problems.current.iter().map(|p| (e.doc.char_to_position(p.start), p)).collect()
}

/// Every source and process for the tests and the log.
pub fn running(state: &AppState, source: SourceId) -> usize {
    match source {
        SourceId::TypeScript => state.ws.langs.running(LangId::TypeScript),
        other => state.ws.langs.lint.running(other),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn diag(line: usize, column: usize, end_line: usize, end_column: usize, severity: Severity, unnecessary: bool) -> Diagnostic {
        Diagnostic { line, column, end_line, end_column, severity, code: Some("2322".into()), source: None, message: " m ".into(), unnecessary }
    }

    #[test]
    fn severity_mapping() {
        assert_eq!(severity(&diag(0, 0, 0, 0, Severity::Error, false)), ProblemSeverity::Error);
        assert_eq!(severity(&diag(0, 0, 0, 0, Severity::Warning, false)), ProblemSeverity::Warning);
        assert_eq!(severity(&diag(0, 0, 0, 0, Severity::Information, false)), ProblemSeverity::Weak);
        assert_eq!(severity(&diag(0, 0, 0, 0, Severity::Hint, false)), ProblemSeverity::Unused);
        assert_eq!(severity(&diag(0, 0, 0, 0, Severity::Warning, true)), ProblemSeverity::Unused);
    }

    #[test]
    fn positions_become_char_indices() {
        let text = "ab😀c\r\nxyz\n";
        let p = to_problems(text, SourceId::TypeScript, &[diag(1, 1, 1, 3, Severity::Error, false), diag(0, 3, 0, 99, Severity::Warning, false), diag(9, 0, 9, 0, Severity::Error, false)]);
        assert_eq!((p[0].start, p[0].end), (3, 5), "a column past the line end stops at the line end (the \\r)");
        assert_eq!((p[1].start, p[1].end), (7, 9));
        assert_eq!((p[2].start, p[2].end), (10, 10), "a line past the end clamps to the end");
        assert_eq!(p[0].message, "m");
    }

    fn problem(start: usize, end: usize) -> Problem {
        Problem { start, end, severity: ProblemSeverity::Error, message: String::new(), source: SourceId::Oxlint, code: None }
    }

    fn spans(p: &[Problem]) -> Vec<(usize, usize)> {
        p.iter().map(|p| (p.start, p.end)).collect()
    }

    #[test]
    fn problems_follow_edits() {
        let mut p = vec![problem(10, 13), problem(20, 20), problem(30, 35)];
        // Typing 2 chars before the first problem moves all of them.
        shift(&mut p, &[TextChange { start: 2, removed: 0, inserted: 2 }]);
        assert_eq!(spans(&p), [(12, 15), (22, 22), (32, 37)]);
        // An insert at a problem's start pushes it; at its end it does not grow it.
        shift(&mut p, &[TextChange { start: 12, removed: 0, inserted: 1 }, TextChange { start: 16, removed: 0, inserted: 1 }]);
        assert_eq!(spans(&p), [(13, 16), (24, 24), (34, 39)]);
        // An edit inside a problem resizes it.
        shift(&mut p, &[TextChange { start: 35, removed: 2, inserted: 5 }]);
        assert_eq!(spans(&p), [(13, 16), (24, 24), (34, 42)]);
        // Deleting a problem's text removes it; an empty problem at the start of a deletion
        // stays at the deletion point.
        shift(&mut p, &[TextChange { start: 12, removed: 12, inserted: 0 }]);
        assert_eq!(spans(&p), [(12, 12), (22, 30)]);
    }

    /// A source whose first lint waits until the test lets it go.
    struct Gate {
        entered: std::sync::mpsc::SyncSender<()>,
        release: Mutex<std::sync::mpsc::Receiver<()>>,
    }

    impl LintSource for Gate {
        fn id(&self) -> SourceId {
            SourceId::Eslint
        }
        fn lint(&self, _: &LintTarget, _: &Path, text: &str) -> Result<Vec<Diagnostic>, String> {
            let _ = self.entered.send(());
            if text == "first" {
                let _ = crate::lang::lock(&self.release).recv();
            }
            Ok(Vec::new())
        }
        fn close(&self, _: &Path) {}
        fn stop_idle(&self, _: Duration) -> Vec<String> {
            Vec::new()
        }
        fn running(&self) -> usize {
            0
        }
        fn shutdown(&self) {}
    }

    #[test]
    fn requests_queued_behind_a_slow_lint_skip_all_but_the_newest() {
        let (entered_tx, entered) = std::sync::mpsc::sync_channel(8);
        let (release_tx, release_rx) = channel();
        let queue = LintQueue::new(vec![Arc::new(Gate { entered: entered_tx, release: Mutex::new(release_rx) })], None);
        let latest = Arc::new(AtomicU64::new(0));
        let (done_tx, done_rx) = channel::<(u64, bool)>();
        let target = || {
            let install = strategy::EslintInstall { root: "/w".into(), package: "/w/node_modules/eslint".into(), version: "10".into() };
            LintTarget::Eslint(EslintPlan { install, config_dir: "/w".into(), legacy: false, project: "/w".into() })
        };
        let send = |generation: u64, text: &str| {
            latest.store(generation, Ordering::SeqCst);
            let done_tx = done_tx.clone();
            queue.send(LintCmd::Lint {
                target: target(),
                path: "/w/a.ts".into(),
                text: text.into(),
                latest: latest.clone(),
                generation,
                done: Box::new(move |r| {
                    let _ = done_tx.send((generation, r.is_some()));
                }),
            });
        };
        send(1, "first");
        entered.recv_timeout(Duration::from_secs(5)).expect("the first lint runs");
        // Three edits while the first lint is still running: only the newest is linted.
        send(2, "second");
        send(3, "third");
        send(4, "fourth");
        release_tx.send(()).unwrap();
        let got: Vec<(u64, bool)> = (0..4).map(|_| done_rx.recv_timeout(Duration::from_secs(5)).expect("answer")).collect();
        assert_eq!(got, [(1, true), (2, false), (3, false), (4, true)]);
        assert_eq!(queue.counts(SourceId::Eslint), LintCounts { runs: 2, skipped: 2 });
    }

    #[test]
    fn eslint_origin_is_the_rule_id() {
        let p = Problem { source: SourceId::Eslint, code: Some("@typescript-eslint/no-floating-promises".into()), ..problem(0, 1) };
        assert_eq!(p.origin(), "eslint(@typescript-eslint/no-floating-promises)");
        assert_eq!(p.code_detail(), None);
        assert_eq!(Problem { code: None, ..p }.origin(), "eslint");
    }
}
