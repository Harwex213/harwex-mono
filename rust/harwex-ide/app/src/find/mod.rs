//! Find in Files (Cmd+Shift+F) and Replace in Files (Cmd+Shift+R).
//!
//! The popup (`popup.rs`) searches as the user types: each change restarts a capped search
//! (`POPUP_CAP` hits) on a worker after a short debounce, cancels the previous run, and streams
//! the hits in file by file. Open in Find Window runs a search capped at `FIND_WINDOW_CAP` on a
//! worker. Replace All has no cap: a count pass keeps only per-file counts, then the write pass
//! searches and writes one file at a time, so memory stays bounded for any number of hits.
//!
//! The search walks non-ignored, non-excluded files (In Project, Directory) or a fixed file
//! list (Open Files, Changed Files). Plain text uses a memchr finder; whole words and regex use
//! `regex`. Replace writes open documents through the edit API (one undo step each) and closed
//! files on workers.

mod history;
mod popup;
mod source;

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use ide_editor::{EditKind, Position};

pub use crate::find_window::SearchScope;
pub use history::{load_storage, save_storage, FindHistory, STORAGE_FIND_HISTORY};
pub use popup::{show_dialog, take_keys};
pub use source::{Disk, Overlay, Snapshot, TextSource};

use crate::notifications::Level;
use crate::preview::FilePreview;
use crate::state::AppState;

#[derive(Clone, Debug)]
pub struct FindHit {
    pub path: PathBuf,
    pub line: usize,
    /// Char column of the match start.
    pub column: usize,
    /// Char column just past the match on its first line (a multiline match shows that line).
    pub end_column: usize,
    pub line_text: String,
    /// The whole matched text, line breaks included; checked again before a replace writes.
    pub matched: String,
    /// The text that replaces it (Replace in Files; regex groups expanded).
    pub replacement: Option<String>,
    /// Checked in the replace preview.
    pub include: bool,
}

impl FindHit {
    /// (line, char column) just past the whole match: on a later line for a multiline match.
    pub fn end(&self) -> (usize, usize) {
        span_end(self.line, self.column, &self.matched)
    }
}

/// Where `text` ends when it starts at (line, column).
fn span_end(line: usize, column: usize, text: &str) -> (usize, usize) {
    match text.rfind('\n') {
        None => (line, column + text.chars().count()),
        Some(i) => (line + text.matches('\n').count(), text[i + 1..].chars().count()),
    }
}

/// What to search for.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Query {
    pub text: String,
    pub case_sensitive: bool,
    pub whole_words: bool,
    pub regex: bool,
    /// `Some` for Replace in Files.
    pub replacement: Option<String>,
}

/// The "where to search" tabs of the popup.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Where {
    #[default]
    Project,
    Directory,
    Scope,
}

/// The choices of the Scope tab.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum NamedScope {
    #[default]
    OpenFiles,
    ChangedFiles,
}

impl NamedScope {
    pub fn title(self) -> &'static str {
        match self {
            NamedScope::OpenFiles => "Open Files",
            NamedScope::ChangedFiles => "Changed Files",
        }
    }
}

/// Identifies one hit across result updates (streaming, re-sorting, replaces).
pub type HitKey = (PathBuf, usize, usize);

#[derive(Default)]
pub struct FindInFiles {
    pub dialog_open: bool,
    pub query: String,
    pub case_sensitive: bool,
    pub whole_words: bool,
    pub regex: bool,
    /// `⏎` toggle: Enter inserts a newline into the query instead of opening the result.
    pub multiline: bool,
    /// Replace in Files: the popup has a replacement field and Replace / Replace All.
    pub replace_mode: bool,
    pub replacement: String,
    /// File mask checkbox and pattern (`*.ts, !*.test.ts`).
    pub mask_on: bool,
    pub mask: String,
    pub where_: Where,
    /// The Directory tab's path field, as typed.
    pub directory: String,
    pub recursive: bool,
    pub named: NamedScope,
    /// "Open results in new tab" (Open in Find Window).
    pub new_tab: bool,
    pub results: FileHits,
    pub searched_for: String,
    /// The query, scope and mask the results belong to.
    pub searched: Option<(Query, SearchScope, Option<String>)>,
    pub searching: bool,
    /// The popup's cap cut the results off ("100+ matches").
    pub truncated: bool,
    pub took_ms: f64,
    /// A broken regex, shown instead of results.
    pub error: Option<String>,
    pub replacing: bool,
    /// The selected result row.
    pub selected: Option<HitKey>,
    /// The user picked the row (keys, press) since the search started; the final list keeps it.
    user_selected: bool,
    pub preview: FilePreview,
    /// egui time at which the debounced search starts.
    debounce_at: Option<f64>,
    focus: bool,
    /// Set by `open_dialog`: the press that opened the popup must not count as a press outside.
    just_opened: bool,
    /// The query is selected once on open, so typing replaces it.
    select_query: bool,
    /// The selected row moved by a key; the list scrolls to it once.
    scroll_to_selected: bool,
    keys: popup::PopupKeys,
    /// The open dropdown and the rect it hangs from.
    menu: Option<(popup::Menu, egui::Rect)>,
    generation: u64,
    cancel: Option<Arc<AtomicBool>>,
    /// Replace All waits for "Replace N occurrences in M files?" while this is `Some`.
    pub replace_confirm: Option<ReplaceConfirm>,
    confirm_generation: u64,
}

/// The Replace All question. The uncapped count runs while the dialog shows.
pub struct ReplaceConfirm {
    generation: u64,
    /// The query that was counted; Replace writes with exactly this one.
    query: Query,
    /// Matches per file, sorted by path; `None` while the count runs. Only counts are kept,
    /// so a huge result set costs one entry per file.
    pub files: Option<Vec<(PathBuf, usize)>>,
    cancel: Arc<AtomicBool>,
}

impl ReplaceConfirm {
    /// (occurrences, files) that Replace would write; `None` while counting.
    pub fn counts(&self) -> Option<(usize, usize)> {
        let files = self.files.as_ref()?;
        if self.query.replacement.is_none() {
            return Some((0, 0));
        }
        Some(files.iter().filter(|(_, n)| *n > 0).fold((0, 0), |(n, f), (_, k)| (n + k, f + 1)))
    }
}

/// Open in Find Window and the Find window's ⟳ show at most this many hits. Each hit is a row
/// with its line text, so a bigger list costs memory and frame time for no use; the tab says
/// "5000+ results, showing the first 5000 found" when the cap cuts it off.
pub const FIND_WINDOW_CAP: usize = 5000;
/// The popup stops counting here and shows `100+ matches`.
pub const POPUP_CAP: usize = 100;
/// Seconds between the last change and the start of the live search.
pub const DEBOUNCE_SECS: f64 = 0.15;

impl FindInFiles {
    /// State for a newly opened project. The running search is cancelled, and the generation
    /// keeps counting so a late result of the old project cannot match a new request.
    pub fn reset(&mut self) {
        if let Some(c) = self.cancel.take() {
            c.store(true, Ordering::Relaxed);
        }
        if let Some(c) = self.replace_confirm.take() {
            c.cancel.store(true, Ordering::Relaxed);
        }
        let generation = self.generation + 1;
        *self = FindInFiles { generation, recursive: true, ..Default::default() };
    }

    /// Opens the popup. `initial` (the editor selection) replaces the query when it is one line.
    pub fn open_dialog(&mut self, initial: Option<String>) {
        if let Some(q) = initial.filter(|q| !q.is_empty() && (self.multiline || !q.contains('\n'))) {
            self.query = q;
        }
        self.dialog_open = true;
        self.focus = true;
        self.just_opened = true;
        self.select_query = true;
        self.menu = None;
        // The first frame starts the search at once.
        self.debounce_at = Some(f64::NEG_INFINITY);
    }

    /// Opens Find (or Replace) in Files for a folder (the Directory tab), or with the last
    /// choice of tab when `scope` is `None`.
    pub fn open_scoped(&mut self, scope: Option<PathBuf>, replace: bool) {
        if let Some(dir) = scope {
            self.where_ = Where::Directory;
            self.directory = dir.display().to_string();
            self.recursive = true;
        }
        self.replace_mode = replace;
        self.open_dialog(None);
    }

    pub fn close(&mut self) {
        self.dialog_open = false;
        self.menu = None;
        self.debounce_at = None;
        if let Some(c) = self.replace_confirm.take() {
            c.cancel.store(true, Ordering::Relaxed);
        }
    }

    pub fn hit_count(&self) -> usize {
        self.results.iter().map(|(_, h)| h.len()).sum()
    }

    /// Every hit in list order.
    pub fn hits(&self) -> impl Iterator<Item = &FindHit> {
        self.results.iter().flat_map(|(_, h)| h)
    }

    pub fn selected_index(&self) -> Option<usize> {
        let key = self.selected.as_ref()?;
        self.hits().position(|h| hit_key(h) == *key)
    }

    pub fn selected_hit(&self) -> Option<&FindHit> {
        let key = self.selected.as_ref()?;
        self.hits().find(|h| hit_key(h) == *key)
    }

    /// Selects the hit at list index `i` (clamped).
    pub fn select_index(&mut self, i: usize) {
        let n = self.hit_count();
        self.selected = if n == 0 { None } else { self.hits().nth(i.min(n - 1)).map(hit_key) };
    }

    /// The live search waits for its debounce, or the preview loads or saves.
    pub fn has_pending_debounce(&self) -> bool {
        self.dialog_open && (self.debounce_at.is_some() || self.preview.is_pending())
    }

    /// A field or toggle changed: search again once the user pauses.
    pub fn schedule(&mut self, now: f64) {
        self.debounce_at = Some(now + DEBOUNCE_SECS);
    }

    pub fn current_query(&self) -> Query {
        Query {
            text: self.query.clone(),
            case_sensitive: self.case_sensitive,
            whole_words: self.whole_words,
            regex: self.regex,
            replacement: self.replace_mode.then(|| self.replacement.clone()),
        }
    }

    /// The mask in effect: `None` while the checkbox is off or the field is empty.
    pub fn current_mask(&self) -> Option<String> {
        let m = self.mask.trim();
        (self.mask_on && !m.is_empty()).then(|| m.to_string())
    }

    /// Where the search looks. A Directory tab with an empty field searches the project.
    pub fn search_scope(&self, project_root: &Path) -> SearchScope {
        match self.where_ {
            Where::Project => SearchScope::Project,
            Where::Directory => {
                let typed = self.directory.trim();
                if typed.is_empty() {
                    return SearchScope::Project;
                }
                let path = Path::new(typed);
                let path = if path.is_absolute() { path.to_path_buf() } else { project_root.join(path) };
                SearchScope::Directory { path, recursive: self.recursive }
            }
            Where::Scope => match self.named {
                NamedScope::OpenFiles => SearchScope::OpenFiles,
                NamedScope::ChangedFiles => SearchScope::ChangedFiles,
            },
        }
    }

    /// Adds one file's hits as the worker finds them, sorted by path and within the cap.
    fn add_streamed(&mut self, path: PathBuf, hits: Vec<FindHit>) {
        let total = self.hit_count();
        if total >= POPUP_CAP {
            self.truncated = true;
            return;
        }
        let at = self.results.partition_point(|(p, _)| *p < path);
        if self.results.get(at).is_some_and(|(p, _)| *p == path) {
            return;
        }
        let mut hits = hits;
        if total + hits.len() > POPUP_CAP {
            hits.truncate(POPUP_CAP - total);
            self.truncated = true;
        }
        self.results.insert(at, (path, hits));
        if self.selected.is_none() {
            self.select_index(0);
        }
    }
}

/// Excluded (`.harwex/ide.toml`), library (`node_modules`, Cargo sources) or outside the
/// project: the popup draws the file name grey.
pub fn is_dim(path: &Path, root: &Path, excluded: &[PathBuf]) -> bool {
    !path.starts_with(root) || excluded.iter().any(|e| path.starts_with(e)) || crate::lang::is_library_path(path)
}

pub fn hit_key(h: &FindHit) -> HitKey {
    (h.path.clone(), h.line, h.column)
}

enum Engine {
    Literal { finder: memchr::memmem::Finder<'static>, case_sensitive: bool },
    Regex(regex::bytes::Regex),
}

impl Engine {
    fn new(q: &Query) -> Result<Engine, String> {
        if !q.regex && !q.whole_words {
            let needle: Vec<u8> = if q.case_sensitive { q.text.as_bytes().to_vec() } else { q.text.as_bytes().to_ascii_lowercase() };
            return Ok(Engine::Literal { finder: memchr::memmem::Finder::new(&needle).into_owned(), case_sensitive: q.case_sensitive });
        }
        let body = if q.regex { q.text.clone() } else { regex::escape(&q.text) };
        let pattern = if q.whole_words { format!(r"\b(?:{body})\b") } else { body };
        regex::bytes::RegexBuilder::new(&pattern).case_insensitive(!q.case_sensitive).multi_line(true).build().map(Engine::Regex).map_err(|e| e.to_string())
    }

    /// How many matches `bytes` has; nothing per match is kept.
    fn count(&self, bytes: &[u8]) -> usize {
        match self {
            Engine::Literal { finder, case_sensitive } => {
                if *case_sensitive {
                    finder.find_iter(bytes).count()
                } else {
                    finder.find_iter(&bytes.to_ascii_lowercase()).count()
                }
            }
            Engine::Regex(re) => re.find_iter(bytes).filter(|m| !m.is_empty()).count(),
        }
    }

    /// Byte ranges of the matches in `bytes`, with the replacement of each when asked.
    fn matches(&self, bytes: &[u8], replacement: Option<&str>, limit: usize) -> Vec<(usize, usize, Option<String>)> {
        let mut out = Vec::new();
        match self {
            Engine::Literal { finder, case_sensitive } => {
                let lowered;
                let hay = if *case_sensitive {
                    bytes
                } else {
                    lowered = bytes.to_ascii_lowercase();
                    &lowered
                };
                let len = finder.needle().len();
                for at in finder.find_iter(hay) {
                    // A multiline query matches across lines; the list shows its first line.
                    out.push((at, at + len, replacement.map(str::to_string)));
                    if out.len() >= limit {
                        break;
                    }
                }
            }
            Engine::Regex(re) => {
                for caps in re.captures_iter(bytes) {
                    let Some(m) = caps.get(0) else { continue };
                    // An empty match has nothing to show or replace.
                    if m.is_empty() {
                        continue;
                    }
                    let rep = replacement.map(|r| {
                        let mut dst = Vec::new();
                        caps.expand(r.as_bytes(), &mut dst);
                        String::from_utf8_lossy(&dst).into_owned()
                    });
                    out.push((m.start(), m.end(), rep));
                    if out.len() >= limit {
                        break;
                    }
                }
            }
        }
        out
    }
}

/// A file mask: comma-separated globs (`*` and `?`); a leading `!` excludes. A pattern with a
/// `/` matches the end of the path, any other the file name. Case-insensitive, like macOS.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Mask {
    include: Vec<String>,
    exclude: Vec<String>,
}

impl Mask {
    pub fn parse(text: &str) -> Mask {
        let mut m = Mask::default();
        for part in text.split(',').map(str::trim).filter(|p| !p.is_empty()) {
            match part.strip_prefix('!') {
                Some(p) if !p.trim().is_empty() => m.exclude.push(p.trim().to_lowercase()),
                Some(_) => {}
                None => m.include.push(part.to_lowercase()),
            }
        }
        m
    }

    pub fn matches(&self, path: &Path) -> bool {
        let full = path.to_string_lossy().to_lowercase();
        let name = path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
        let hit = |p: &String| if p.contains('/') { glob(&format!("*{p}"), &full) } else { glob(p, &name) };
        (self.include.is_empty() || self.include.iter().any(hit)) && !self.exclude.iter().any(hit)
    }
}

/// `*` matches any run of chars, `?` one char.
fn glob(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    let (mut pi, mut ti) = (0, 0);
    let mut star: Option<(usize, usize)> = None;
    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some((pi, ti));
            pi += 1;
        } else if let Some((sp, st)) = star {
            pi = sp + 1;
            ti = st + 1;
            star = Some((sp, st + 1));
        } else {
            return false;
        }
    }
    p[pi..].iter().all(|c| *c == '*')
}

/// What a search reads.
#[derive(Clone, Debug)]
pub enum Targets {
    /// Every non-ignored file under `root`; `max_depth` 1 lists only its own files.
    Walk { root: PathBuf, max_depth: Option<usize> },
    /// Exactly these files (Open Files, Changed Files), ignore rules or not.
    Files(Vec<PathBuf>),
}

/// The files of `scope`. Built on the UI thread from state it already holds.
pub fn targets(state: &AppState, scope: &SearchScope) -> Option<Targets> {
    let root = state.ws.project.as_ref()?.root.clone();
    Some(match scope {
        SearchScope::Project => Targets::Walk { root, max_depth: None },
        SearchScope::Directory { path, recursive } => Targets::Walk { root: path.clone(), max_depth: (!recursive).then_some(1) },
        SearchScope::OpenFiles => Targets::Files(state.ws.tabs.editors().map(|e| e.path.clone()).collect()),
        SearchScope::ChangedFiles => {
            let mut files: Vec<PathBuf> = state.ws.git.status.iter().filter(|(_, k)| **k != ide_git::ChangeKind::Deleted).map(|(p, _)| p.clone()).collect();
            files.sort();
            Targets::Files(files)
        }
    })
}

/// The open documents with unsaved edits as a text source, so a search sees the buffers and
/// not the stale disk. Only rope clones are taken here; the text is built on the worker.
pub fn unsaved_buffers(state: &AppState) -> Overlay {
    Overlay::new(state.ws.tabs.editors().filter(|e| e.doc.is_dirty()).map(|e| {
        let rope = e.doc.rope().clone();
        let text: Snapshot = Box::new(move || rope.to_string());
        (e.path.clone(), text)
    }))
}

/// Hits grouped by file, sorted by path.
pub type FileHits = Vec<(PathBuf, Vec<FindHit>)>;

/// Searches `root` (a project or a folder in it). `skip` lists excluded folders. Returns the
/// hits and whether the hit limit cut them off.
pub fn search(root: &Path, query: &Query, skip: &[PathBuf], cancel: &AtomicBool) -> Result<(FileHits, bool), String> {
    search_with(&Targets::Walk { root: root.to_path_buf(), max_depth: None }, &Disk, query, None, skip, cancel, FIND_WINDOW_CAP, &|_, _| {})
}

/// The search behind every entry point. `targets` names the files, `source` gives their text.
/// It stops once `limit` hits are found (the result then says it was cut off) or `cancel` is
/// set. `on_file` sees each file's hits as they are found.
#[allow(clippy::too_many_arguments)]
pub fn search_with(
    targets: &Targets,
    source: &dyn TextSource,
    query: &Query,
    mask: Option<&Mask>,
    skip: &[PathBuf],
    cancel: &AtomicBool,
    limit: usize,
    on_file: &(dyn Fn(&Path, &[FindHit]) + Sync),
) -> Result<(FileHits, bool), String> {
    let engine = Engine::new(query)?;
    let out: Mutex<FileHits> = Mutex::default();
    let total = AtomicUsize::new(0);
    let visit = |path: &Path| {
        if mask.is_some_and(|m| !m.matches(path)) {
            return;
        }
        let Some(bytes) = source.read(path) else { return };
        let Some(hits) = file_hits(path, &bytes, &engine, query, limit) else { return };
        on_file(path, &hits);
        total.fetch_add(hits.len(), Ordering::Relaxed);
        crate::lang::lock(&out).push((path.to_path_buf(), hits));
    };
    let stop = || cancel.load(Ordering::Relaxed) || total.load(Ordering::Relaxed) >= limit;
    walk(targets, skip, &stop, &visit);
    let mut v = out.into_inner().unwrap_or_default();
    v.sort_by(|a, b| a.0.cmp(&b.0));
    let truncated = total.load(Ordering::Relaxed) >= limit;
    Ok((v, truncated))
}

/// Counts the matches per file with no cap (Replace All's question). Only the counts are kept,
/// sorted by path; files without a match are left out. `cancel` stops the walk.
pub fn count_with(
    targets: &Targets,
    source: &dyn TextSource,
    query: &Query,
    mask: Option<&Mask>,
    skip: &[PathBuf],
    cancel: &AtomicBool,
) -> Result<Vec<(PathBuf, usize)>, String> {
    let engine = Engine::new(query)?;
    let out: Mutex<Vec<(PathBuf, usize)>> = Mutex::default();
    let visit = |path: &Path| {
        if mask.is_some_and(|m| !m.matches(path)) {
            return;
        }
        let Some(bytes) = source.read(path) else { return };
        if is_binary(&bytes) {
            return;
        }
        let n = engine.count(&bytes);
        if n > 0 {
            crate::lang::lock(&out).push((path.to_path_buf(), n));
        }
    };
    walk(targets, skip, &|| cancel.load(Ordering::Relaxed), &visit);
    let mut v = out.into_inner().unwrap_or_default();
    v.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(v)
}

/// Calls `visit` for every file of `targets` until `stop` says so; a walk runs on all cores.
fn walk(targets: &Targets, skip: &[PathBuf], stop: &(dyn Fn() -> bool + Sync), visit: &(dyn Fn(&Path) + Sync)) {
    match targets {
        Targets::Files(files) => {
            for f in files {
                if stop() {
                    break;
                }
                visit(f);
            }
        }
        Targets::Walk { root, max_depth } => {
            let skip = skip.to_vec();
            let walker = ignore::WalkBuilder::new(root)
                .hidden(false)
                .max_depth(*max_depth)
                .filter_entry(move |e| e.file_name() != ".git" && !skip.iter().any(|s| e.path() == s))
                .build_parallel();
            walker.run(|| {
                Box::new(move |entry| {
                    if stop() {
                        return ignore::WalkState::Quit;
                    }
                    let Ok(e) = entry else { return ignore::WalkState::Continue };
                    if e.file_type().is_some_and(|t| t.is_file()) {
                        visit(e.path());
                    }
                    ignore::WalkState::Continue
                })
            });
        }
    }
}

/// A NUL byte near the start marks a binary file; the search skips it.
fn is_binary(bytes: &[u8]) -> bool {
    memchr::memchr(0, &bytes[..bytes.len().min(8000)]).is_some()
}

/// The first `limit` hits of one file, or `None` when it has none or is binary.
fn file_hits(path: &Path, bytes: &[u8], engine: &Engine, query: &Query, limit: usize) -> Option<Vec<FindHit>> {
    if is_binary(bytes) {
        return None;
    }
    let found = engine.matches(bytes, query.replacement.as_deref(), limit);
    let mut hits = Vec::new();
    let mut line_starts_cache: (usize, usize) = (0, 0); // (byte offset scanned, line count)
    for (at, end, replacement) in found {
        let line_start = memchr::memrchr(b'\n', &bytes[..at]).map_or(0, |i| i + 1);
        let line_end = memchr::memchr(b'\n', &bytes[at..]).map_or(bytes.len(), |i| at + i);
        // Count lines incrementally: matches arrive in order.
        let (scanned, count) = line_starts_cache;
        let line = count + memchr::memchr_iter(b'\n', &bytes[scanned..line_start]).count();
        line_starts_cache = (line_start, line);
        let text = String::from_utf8_lossy(&bytes[line_start..line_end]);
        let column = String::from_utf8_lossy(&bytes[line_start..at]).chars().count();
        // A multiline match shows its first line (without a CRLF's `\r`) and keeps all of
        // its text for Replace.
        let first_end = if end > line_end { line_end - usize::from(bytes[..line_end].ends_with(b"\r")).min(line_end - at) } else { end };
        let shown = String::from_utf8_lossy(&bytes[at..first_end]).chars().count();
        let matched = String::from_utf8_lossy(&bytes[at..end]).into_owned();
        hits.push(FindHit {
            path: path.to_path_buf(),
            line,
            column,
            end_column: column + shown,
            line_text: text.trim_end_matches('\r').chars().take(300).collect(),
            matched,
            replacement,
            include: true,
        });
    }
    (!hits.is_empty()).then_some(hits)
}

/// Starts the popup's live search: capped at `POPUP_CAP`, the hits stream in file by file.
pub fn start(state: &mut AppState) {
    let Some(project_root) = state.ws.project.as_ref().map(|p| p.root.clone()) else { return };
    let f = &mut state.ws.find;
    f.debounce_at = None;
    if let Some(c) = f.cancel.take() {
        c.store(true, Ordering::Relaxed);
    }
    f.generation += 1;
    f.error = None;
    f.results.clear();
    f.truncated = false;
    f.selected = None;
    f.user_selected = false;
    f.searched_for = f.query.clone();
    if f.query.is_empty() {
        f.searching = false;
        f.searched = None;
        return;
    }
    let cancel = Arc::new(AtomicBool::new(false));
    f.cancel = Some(cancel.clone());
    f.searching = true;
    let query = f.current_query();
    let scope = f.search_scope(&project_root);
    let mask_text = f.current_mask();
    f.searched = Some((query.clone(), scope.clone(), mask_text.clone()));
    let generation = f.generation;
    let Some(targets) = targets(state, &scope) else { return };
    let source = unsaved_buffers(state);
    let skip = state.ws.tree.excluded.clone();
    let started = Instant::now();
    let jobs = state.jobs.clone();
    state.jobs.spawn_quiet(
        move || {
            let mask = mask_text.as_deref().map(Mask::parse);
            let stream = |path: &Path, hits: &[FindHit]| {
                let (path, hits) = (path.to_path_buf(), hits.to_vec());
                jobs.post(move |state| {
                    if state.ws.find.generation == generation {
                        state.ws.find.add_streamed(path, hits);
                    }
                });
            };
            // One past the cap tells "100+" from exactly 100.
            search_with(&targets, &source, &query, mask.as_ref(), &skip, &cancel, POPUP_CAP + 1, &stream)
        },
        move |state, res| {
            let f = &mut state.ws.find;
            if f.generation != generation {
                return;
            }
            f.searching = false;
            f.cancel = None;
            f.took_ms = started.elapsed().as_secs_f64() * 1000.0;
            match res {
                Ok((mut results, truncated)) => {
                    f.truncated = truncated;
                    cap_hits(&mut results, POPUP_CAP);
                    f.results = results;
                    // Streaming selected whatever came first; the first row wins.
                    if !f.user_selected || f.selected_index().is_none() {
                        f.select_index(0);
                    }
                    let n = f.hit_count();
                    let ms = f.took_ms;
                    state.timings.log(format!("find in files: {n} hits in {ms:.0} ms"));
                }
                Err(e) => {
                    f.results.clear();
                    f.selected = None;
                    f.error = Some(e);
                }
            }
        },
    );
}

/// Keeps the first `cap` hits in path order. Returns whether any hit was dropped.
pub(crate) fn cap_hits(results: &mut FileHits, cap: usize) -> bool {
    let mut left = cap;
    let mut dropped = false;
    results.retain_mut(|(_, hits)| {
        dropped |= hits.len() > left;
        hits.truncate(left);
        left -= hits.len();
        !hits.is_empty()
    });
    dropped
}

/// The popup's current query, scope and mask, with the files and texts a worker searches.
struct PopupSearch {
    query: Query,
    scope: SearchScope,
    mask_text: Option<String>,
    targets: Targets,
    source: Overlay,
    skip: Vec<PathBuf>,
}

fn popup_search(state: &AppState) -> Option<PopupSearch> {
    let project_root = state.ws.project.as_ref()?.root.clone();
    let f = &state.ws.find;
    let (query, scope, mask_text) = (f.current_query(), f.search_scope(&project_root), f.current_mask());
    let targets = targets(state, &scope)?;
    Some(PopupSearch { query, scope, mask_text, targets, source: unsaved_buffers(state), skip: state.ws.tree.excluded.clone() })
}

/// Per closed file: how many matches Replace All wrote, or why it failed.
type Written = Vec<(PathBuf, Result<usize, String>)>;

/// Open in Find Window (Cmd+Enter): the hits, up to `FIND_WINDOW_CAP`, go to a Find tab; the
/// popup closes.
pub fn open_in_find_window(state: &mut AppState) {
    if state.ws.find.query.is_empty() {
        return;
    }
    let new_tab = state.ws.find.new_tab;
    popup::remember(state);
    popup::close(state);
    let Some(PopupSearch { query, scope, mask_text, targets, source, skip }) = popup_search(state) else { return };
    let generation = state.project_generation();
    let label = format!("Searching for \"{}\"", query.text);
    state.jobs.spawn(
        label,
        {
            let query = query.clone();
            let mask_text = mask_text.clone();
            move || {
                let mask = mask_text.as_deref().map(Mask::parse);
                // One past the cap tells the tab it was cut off.
                let cancel = AtomicBool::new(false);
                search_with(&targets, &source, &query, mask.as_ref(), &skip, &cancel, FIND_WINDOW_CAP + 1, &|_, _| {})
            }
        },
        move |state, res| {
            if state.project_generation() != generation {
                return;
            }
            match res {
                Ok((hits, _)) => crate::find_window::open_text_results(state, query, scope, mask_text, hits, new_tab),
                Err(e) => state.notifications.error("Invalid pattern", e),
            }
        },
    );
}

/// Replace All in the popup: asks "Replace N occurrences in M files?" first. The uncapped count
/// runs on a worker while the question shows; `confirm_replace_all` writes.
pub fn replace_everything(state: &mut AppState) {
    let f = &state.ws.find;
    if f.query.is_empty() || f.replacing || f.replace_confirm.is_some() {
        return;
    }
    let Some(PopupSearch { query, mask_text, targets, source, skip, .. }) = popup_search(state) else { return };
    let f = &mut state.ws.find;
    f.confirm_generation += 1;
    let generation = f.confirm_generation;
    let cancel = Arc::new(AtomicBool::new(false));
    f.replace_confirm = Some(ReplaceConfirm { generation, query: query.clone(), files: None, cancel: cancel.clone() });
    let label = format!("Counting \"{}\"", query.text);
    let project = state.project_generation();
    state.jobs.spawn(
        label,
        move || {
            let mask = mask_text.as_deref().map(Mask::parse);
            count_with(&targets, &source, &query, mask.as_ref(), &skip, &cancel)
        },
        move |state, res| {
            if state.project_generation() != project {
                return;
            }
            let f = &mut state.ws.find;
            if !f.replace_confirm.as_ref().is_some_and(|c| c.generation == generation) {
                return;
            }
            match res {
                Ok(files) => {
                    if let Some(c) = f.replace_confirm.as_mut() {
                        c.files = Some(files);
                    }
                }
                Err(e) => {
                    f.replace_confirm = None;
                    state.notifications.error("Invalid pattern", e);
                }
            }
        },
    );
}

/// Replace in the confirmation: writes every counted file, then the popup closes.
pub fn confirm_replace_all(state: &mut AppState) {
    let f = &mut state.ws.find;
    if !f.replace_confirm.as_ref().and_then(ReplaceConfirm::counts).is_some_and(|(n, _)| n > 0) {
        return;
    }
    let Some(ReplaceConfirm { query, files: Some(files), .. }) = f.replace_confirm.take() else { return };
    popup::remember(state);
    popup::close(state);
    replace_counted(state, query, files);
}

/// Cancel in the confirmation: nothing is written, and the popup gets the keys again.
pub fn cancel_replace_all(state: &mut AppState) {
    let f = &mut state.ws.find;
    if let Some(c) = f.replace_confirm.take() {
        c.cancel.store(true, Ordering::Relaxed);
    }
    f.focus = true;
}

/// Replace in the popup: the selected match only; the selection moves to the next one.
pub fn replace_selected(state: &mut AppState) {
    let Some(hit) = state.ws.find.selected_hit().cloned() else { return };
    let Some(rep) = hit.replacement.clone() else { return };
    let index = state.ws.find.selected_index().unwrap_or(0);
    match state.ws.tabs.editor_by_path(&hit.path) {
        Some(id) => {
            if replace_in_doc(state, id, std::slice::from_ref(&hit)) == 0 {
                warn_changed(state, 1);
                return;
            }
        }
        None => {
            let (path, one) = (hit.path.clone(), vec![hit.clone()]);
            let changed = hit.path.clone();
            state.ws.find.replacing = true;
            state.jobs.spawn(
                "Replacing in files",
                move || replace_in_file(&path, &one),
                move |state, res| {
                    state.ws.find.replacing = false;
                    match res {
                        Ok(0) => warn_changed(state, 1),
                        Ok(_) => {
                            let paths: HashSet<PathBuf> = std::iter::once(changed).collect();
                            state.on_fs_batch(crate::watcher::FsBatch { paths, structure_changed: false, git_changed: true });
                        }
                        Err(e) => state.notifications.error("Replace failed", e),
                    }
                },
            );
        }
    }
    // The hit leaves the list. The later hits of its file move by the size change: those on
    // its last line by columns, those below by lines.
    let (old_line, old_col) = hit.end();
    let (new_line, new_col) = span_end(hit.line, hit.column, &rep);
    let f = &mut state.ws.find;
    for (path, hits) in &mut f.results {
        if *path != hit.path {
            continue;
        }
        hits.retain(|h| !(h.line == hit.line && h.column == hit.column));
        for h in hits.iter_mut().filter(|h| (h.line, h.column) >= (old_line, old_col)) {
            if h.line == old_line {
                let width = h.end_column - h.column;
                h.column = new_col + (h.column - old_col);
                h.end_column = h.column + width;
            }
            h.line = h.line + new_line - old_line;
        }
    }
    f.results.retain(|(_, h)| !h.is_empty());
    f.select_index(index);
}

/// Some hits no longer matched the text (edited since the search) and were left alone.
fn warn_changed(state: &mut AppState, n: usize) {
    let what = if n == 1 { "1 occurrence".to_string() } else { format!("{n} occurrences") };
    state.notifications.warn("Replace in Files", format!("Skipped {what}: the text changed since the search."));
}

/// Applies the hits to one open document as one undo step and saves it. Returns how many
/// hits still matched the text. The document keeps LF lines, so a CRLF match from the disk is
/// compared and replaced with LF.
fn replace_in_doc(state: &mut AppState, id: crate::tabs::TabId, hits: &[FindHit]) -> usize {
    let Some(e) = state.ws.tabs.editor_mut(id) else { return 0 };
    let mut edits: Vec<(std::ops::Range<usize>, String)> = Vec::new();
    for h in hits {
        let Some(rep) = &h.replacement else { continue };
        if h.line >= e.doc.line_count() || e.doc.line(h.line).trim_end_matches(['\n', '\r']).chars().count() < h.column {
            continue;
        }
        let matched = h.matched.replace("\r\n", "\n");
        let s = e.doc.position_to_char(Position::new(h.line, h.column));
        let end = s + matched.chars().count();
        if e.doc.slice(s..end) != matched || edits.iter().any(|(r, _)| r.start < end && s < r.end) {
            continue;
        }
        edits.push((s..end, rep.replace("\r\n", "\n")));
    }
    if edits.is_empty() {
        return 0;
    }
    edits.sort_by_key(|(r, _)| std::cmp::Reverse(r.start));
    let n = edits.len();
    let sel = e.view.selection();
    e.doc.seal_undo_group();
    e.doc.transact(edits, sel, sel, EditKind::Other);
    e.doc.seal_undo_group();
    state.save_tab(id, false);
    n
}

/// Replace All's write pass over the counted files. Each file is searched again and written
/// right away, so a worker holds one file's matches at a time, never the whole result set.
/// Closed files are written on workers; open documents get their hits from a snapshot of the
/// buffer and are written through the edit API (one undo step each). A file with fewer
/// matches than counted (edited since the count) is reported as skipped.
fn replace_counted(state: &mut AppState, query: Query, counted: Vec<(PathBuf, usize)>) {
    let open: Vec<PathBuf> = counted.iter().filter(|(p, _)| state.ws.tabs.editor_by_path(p).is_some()).map(|(p, _)| p.clone()).collect();
    let closed: Vec<PathBuf> = counted.iter().filter(|(p, _)| state.ws.tabs.editor_by_path(p).is_none()).map(|(p, _)| p.clone()).collect();
    let docs = Overlay::new(state.ws.tabs.editors().filter(|e| open.contains(&e.path)).map(|e| {
        let rope = e.doc.rope().clone();
        let text: Snapshot = Box::new(move || rope.to_string());
        (e.path.clone(), text)
    }));
    state.ws.find.replacing = true;
    state.jobs.spawn(
        "Replacing in files",
        move || -> Result<(FileHits, Written), String> {
            let engine = Engine::new(&query)?;
            let no = AtomicBool::new(false);
            let (open_hits, _) = search_with(&Targets::Files(open), &docs, &query, None, &[], &no, usize::MAX, &|_, _| {})?;
            Ok((open_hits, replace_in_closed_files(&closed, &engine, &query)))
        },
        move |state, res| {
            state.ws.find.replacing = false;
            let (open_hits, written) = match res {
                Ok(v) => v,
                Err(e) => {
                    state.notifications.error("Replace failed", e);
                    return;
                }
            };
            let mut done: std::collections::HashMap<PathBuf, usize> = std::collections::HashMap::new();
            let mut failed: HashSet<PathBuf> = HashSet::new();
            for (path, r) in written {
                match r {
                    Ok(n) => {
                        done.insert(path, n);
                    }
                    Err(e) => {
                        state.notifications.error("Replace failed", e);
                        failed.insert(path);
                    }
                }
            }
            for (path, hits) in open_hits {
                // A document closed since the snapshot is skipped, not written from stale hits.
                if let Some(id) = state.ws.tabs.editor_by_path(&path) {
                    let n = replace_in_doc(state, id, &hits);
                    done.insert(path, n);
                }
            }
            let n: usize = done.values().sum();
            let f = done.values().filter(|&&n| n > 0).count();
            state.notifications.log_only(Level::Info, "Replace in Files", format!("Replaced {n} occurrences in {f} files."));
            // A file that failed to read or write already has its own error.
            let skipped: usize = counted.iter().filter(|(p, _)| !failed.contains(p)).map(|(p, c)| c.saturating_sub(done.get(p).copied().unwrap_or(0))).sum();
            if skipped > 0 {
                warn_changed(state, skipped);
            }
            let paths: HashSet<PathBuf> = counted.into_iter().map(|(p, _)| p).collect();
            state.on_fs_batch(crate::watcher::FsBatch { paths, structure_changed: false, git_changed: true });
            if state.ws.find.dialog_open {
                start(state);
            }
        },
    );
}

/// Searches and writes the closed files on all cores, one file per thread at a time. Returns
/// how many matches each file got replaced, or its error.
fn replace_in_closed_files(files: &[PathBuf], engine: &Engine, query: &Query) -> Written {
    let out: Mutex<Written> = Mutex::default();
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get()).min(8);
    let chunk = files.len().div_ceil(threads).max(1);
    std::thread::scope(|scope| {
        for part in files.chunks(chunk) {
            let out = &out;
            scope.spawn(move || {
                for path in part {
                    let r = replace_all_in_file(path, engine, query);
                    crate::lang::lock(out).push((path.clone(), r));
                }
            });
        }
    });
    out.into_inner().unwrap_or_default()
}

/// Replaces every match of `query` in one file. A missing, too big or binary file gets none.
/// The bytes between matches are copied as they are, line breaks included.
fn replace_all_in_file(path: &Path, engine: &Engine, query: &Query) -> Result<usize, String> {
    let Some(rep) = query.replacement.as_deref() else { return Ok(0) };
    let Some(bytes) = Disk.read(path) else { return Ok(0) };
    if is_binary(&bytes) {
        return Ok(0);
    }
    let found = engine.matches(&bytes, Some(rep), usize::MAX);
    if found.is_empty() {
        return Ok(0);
    }
    let mut out = Vec::with_capacity(bytes.len());
    let mut last = 0;
    for (at, end, with) in &found {
        out.extend_from_slice(&bytes[last..*at]);
        out.extend_from_slice(with.as_deref().unwrap_or(rep).as_bytes());
        last = *end;
    }
    out.extend_from_slice(&bytes[last..]);
    std::fs::write(path, out).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(found.len())
}

/// Replaces the hits in one file; a hit may span lines. A hit whose text is no longer at its
/// place is skipped. Line breaks are kept as they are (the match carries its own). Returns how
/// many hits were replaced.
pub fn replace_in_file(path: &Path, hits: &[FindHit]) -> Result<usize, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let line_starts: Vec<usize> = std::iter::once(0).chain(text.match_indices('\n').map(|(i, _)| i + 1)).collect();
    let mut edits: Vec<(usize, usize, &str)> = Vec::new();
    for h in hits {
        let Some(rep) = h.replacement.as_deref() else { continue };
        let Some(&line_start) = line_starts.get(h.line) else { continue };
        let line_end = line_starts.get(h.line + 1).map_or(text.len(), |&n| n - 1);
        let Some(at) = text[line_start..line_end].char_indices().map(|(i, _)| line_start + i).chain(std::iter::once(line_end)).nth(h.column) else { continue };
        let end = at + h.matched.len();
        if text.get(at..end) != Some(h.matched.as_str()) || edits.iter().any(|&(s, e, _)| s < end && at < e) {
            continue;
        }
        edits.push((at, end, rep));
    }
    if edits.is_empty() {
        return Ok(0);
    }
    edits.sort_by_key(|&(at, _, _)| at);
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    for &(at, end, rep) in &edits {
        out.push_str(&text[last..at]);
        out.push_str(rep);
        last = end;
    }
    out.push_str(&text[last..]);
    std::fs::write(path, out).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(edits.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn hits(root: &Path, q: Query) -> Vec<(String, usize, usize, Option<String>)> {
        let (r, _) = search(root, &q, &[], &AtomicBool::new(false)).unwrap();
        r.into_iter().flat_map(|(_, h)| h).map(|h| (h.matched, h.line, h.column, h.replacement)).collect()
    }

    #[test]
    fn words_regex_case_and_replacement() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        std::fs::write(root.join("a.ts"), "let addOne = add(1);\nADD(2);\r\nadd_x\n").unwrap();
        let q = |text: &str| Query { text: text.into(), ..Default::default() };
        assert_eq!(hits(&root, q("add")).len(), 4, "plain, case-insensitive");
        assert_eq!(hits(&root, Query { case_sensitive: true, ..q("add") }).len(), 3);
        let words = hits(&root, Query { whole_words: true, ..q("add") });
        assert_eq!(words.iter().map(|h| (h.1, h.2)).collect::<Vec<_>>(), [(0, 13), (1, 0)]);
        let re = hits(&root, Query { regex: true, case_sensitive: true, replacement: Some("call_$1".into()), ..q(r"add\((\d)\)") });
        assert_eq!(re, [("add(1)".to_string(), 0, 13, Some("call_1".to_string()))]);
        assert!(search(&root, &Query { regex: true, ..q("(") }, &[], &AtomicBool::new(false)).is_err());

        // Replacing keeps CRLF lines and skips a hit whose text moved.
        let path = root.join("a.ts");
        let (r, _) = search(&root, &Query { whole_words: true, replacement: Some("plus".into()), ..q("add") }, &[], &AtomicBool::new(false)).unwrap();
        let mut found = r[0].1.clone();
        found.push(FindHit { matched: "zzz".into(), ..found[0].clone() });
        assert_eq!(replace_in_file(&path, &found).unwrap(), 2);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "let addOne = plus(1);\nplus(2);\r\nadd_x\n");
    }

    #[test]
    fn scope_and_exclusions() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        for rel in ["src/a.ts", "dist/a.js", "src/sub/b.ts"] {
            let p = root.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, "needle\n").unwrap();
        }
        let q = Query { text: "needle".into(), ..Default::default() };
        let no = AtomicBool::new(false);
        assert_eq!(search(&root, &q, &[], &no).unwrap().0.len(), 3);
        assert_eq!(search(&root, &q, &[root.join("dist")], &no).unwrap().0.len(), 2);
        assert_eq!(search(&root.join("src/sub"), &q, &[], &no).unwrap().0.len(), 1);
        let flat = Targets::Walk { root: root.join("src"), max_depth: Some(1) };
        assert_eq!(search_with(&flat, &Disk, &q, None, &[], &no, 10, &|_, _| {}).unwrap().0.len(), 1, "not recursive");
        let mask = Mask::parse("*.ts, !b.*");
        let (r, _) = search_with(&Targets::Walk { root: root.clone(), max_depth: None }, &Disk, &q, Some(&mask), &[], &no, 10, &|_, _| {}).unwrap();
        assert_eq!(r.iter().map(|(p, _)| p.strip_prefix(&root).unwrap().to_path_buf()).collect::<Vec<_>>(), [PathBuf::from("src/a.ts")]);
    }

    #[test]
    fn multiline_matches_replace_across_lines() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        let (lf, crlf) = (root.join("a.ts"), root.join("c.ts"));
        std::fs::write(&lf, "let a = 1;\nlet b = 2;\nend\n").unwrap();
        std::fs::write(&crlf, "x\r\nlet a = 1;\r\nlet b = 2;\r\n").unwrap();
        let no = AtomicBool::new(false);

        // A two-line literal: the row shows its first line, Replace takes all of it.
        let q = Query { text: "1;\nlet b".into(), replacement: Some("1; let b".into()), ..Default::default() };
        let (r, _) = search(&root, &q, &[], &no).unwrap();
        let h = &r[0].1[0];
        assert_eq!((h.line, h.column, h.end_column, h.end()), (0, 8, 10, (1, 5)));
        assert_eq!(h.line_text, "let a = 1;");
        assert_eq!(replace_in_file(&lf, &r[0].1).unwrap(), 1);
        assert_eq!(std::fs::read_to_string(&lf).unwrap(), "let a = 1; let b = 2;\nend\n");

        // A regex with groups across CRLF lines.
        let q = Query { text: r"let (\w) = (\d);\r?\nlet (\w) = (\d);".into(), regex: true, replacement: Some("let [$1, $3] = [$2, $4];".into()), ..Default::default() };
        let (r, _) = search(&root, &q, &[], &no).unwrap();
        assert_eq!(r.len(), 1, "a.ts is one line now");
        let h = &r[0].1[0];
        assert_eq!((h.line, h.end_column, h.end()), (1, 10, (2, 10)), "the shown part leaves the \\r out");
        assert_eq!(h.replacement.as_deref(), Some("let [a, b] = [1, 2];"));
        assert_eq!(replace_in_file(&crlf, &r[0].1).unwrap(), 1);
        assert_eq!(std::fs::read_to_string(&crlf).unwrap(), "x\r\nlet [a, b] = [1, 2];\r\n");

        // The guard: text changed since the search is left alone.
        std::fs::write(&crlf, "x\r\nlet a = 1;\r\nlet b = 2;\r\n").unwrap();
        let (r, _) = search(&root, &q, &[], &no).unwrap();
        std::fs::write(&crlf, "x\r\nlet a = 1;\r\nlet c = 2;\r\n").unwrap();
        assert_eq!(replace_in_file(&crlf, &r[0].1).unwrap(), 0);
        assert_eq!(std::fs::read_to_string(&crlf).unwrap(), "x\r\nlet a = 1;\r\nlet c = 2;\r\n");
    }

    #[test]
    fn the_search_reads_only_its_source() {
        struct Fake(HashMap<PathBuf, &'static str>);
        impl TextSource for Fake {
            fn read(&self, path: &Path) -> Option<Vec<u8>> {
                self.0.get(path).map(|t| t.as_bytes().to_vec())
            }
        }
        let files = ["/nowhere/a.ts", "/nowhere/b.ts", "/nowhere/missing.ts"].map(PathBuf::from);
        let fake = Fake(HashMap::from([(files[0].clone(), "let needle = 1;\nneedle();\n"), (files[1].clone(), "nothing\n")]));
        let q = Query { text: "needle".into(), ..Default::default() };
        let (r, truncated) = search_with(&Targets::Files(files.to_vec()), &fake, &q, None, &[], &AtomicBool::new(false), 10, &|_, _| {}).unwrap();
        assert!(!truncated);
        assert_eq!(r.iter().map(|(p, h)| (p.clone(), h.iter().map(|h| (h.line, h.column)).collect::<Vec<_>>())).collect::<Vec<_>>(), [(files[0].clone(), vec![(0, 4), (1, 0)])]);
    }

    #[test]
    fn count_and_replace_all_have_no_cap() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        let path = root.join("a.txt");
        std::fs::write(&path, "Add add\r\n".repeat(3000)).unwrap();
        let q = Query { text: "add".into(), replacement: Some("x".into()), ..Default::default() };
        let all = Targets::Walk { root: root.clone(), max_depth: None };
        assert_eq!(count_with(&all, &Disk, &q, None, &[], &AtomicBool::new(false)).unwrap(), [(path.clone(), 6000)]);
        assert!(count_with(&all, &Disk, &q, None, &[], &AtomicBool::new(true)).unwrap().is_empty(), "a cancelled count stops");
        assert_eq!(replace_all_in_file(&path, &Engine::new(&q).unwrap(), &q).unwrap(), 6000);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "x x\r\n".repeat(3000));
    }

    #[test]
    fn masks_and_globs() {
        let m = Mask::parse("*.ts, !*.test.ts");
        assert!(m.matches(Path::new("/p/src/a.ts")));
        assert!(m.matches(Path::new("/p/src/A.TS")), "case-insensitive");
        assert!(!m.matches(Path::new("/p/src/a.test.ts")));
        assert!(!m.matches(Path::new("/p/src/a.js")));
        assert!(Mask::parse("").matches(Path::new("/p/x")));
        assert!(Mask::parse("!*.md").matches(Path::new("/p/x.ts")));
        assert!(Mask::parse("src/*.ts").matches(Path::new("/p/src/a.ts")));
        assert!(!Mask::parse("src/*.ts").matches(Path::new("/p/lib/a.ts")));
        assert!(glob("a?c*", "abcdef") && !glob("a?c", "ac") && glob("*", "") && glob("**x", "yx"));
    }

    #[test]
    fn cap_keeps_the_first_hits_in_order() {
        let hit = |p: &str, line| FindHit {
            path: p.into(),
            line,
            column: 0,
            end_column: 1,
            line_text: String::new(),
            matched: String::new(),
            replacement: None,
            include: true,
        };
        let mut r: FileHits = vec![("a".into(), vec![hit("a", 0), hit("a", 1)]), ("b".into(), vec![hit("b", 0), hit("b", 1)]), ("c".into(), vec![hit("c", 0)])];
        cap_hits(&mut r, 3);
        assert_eq!(r.iter().map(|(p, h)| (p.display().to_string(), h.len())).collect::<Vec<_>>(), [("a".into(), 2), ("b".into(), 1)]);
    }
}
