//! Side-by-side diff tabs. The history agent calls `open_commit_diff` from the log.
//!
//! Both panes scroll through one "virtual" coordinate: unchanged runs count once, and a hunk
//! counts as many lines as its taller side. Each pane maps that coordinate to its own line, so
//! the two sides stay aligned at every hunk, like IDEA. Only visible lines are laid out, and
//! highlight spans are cached for the visible window, so a 10k-line diff costs the same per
//! frame as a short one.
//!
//! The working-tree side (HEAD vs working tree, a revision vs local) is editable, like IDEA:
//! - The file is open in an editor tab: the app lends that tab while the diff draws
//!   (`CustomTab::shared_editor`, `TabEnv::editor`), and the right pane edits its `Document`.
//!   One buffer, one undo history; the tab shows the dirty mark, and Cmd+S saves it.
//! - The file is not open: the diff loads a hidden `Document` on a worker and edits it. It saves
//!   `SAVE_DEBOUNCE` after the last edit, on focus loss and on close (IDEA auto-saves). An editor
//!   tab that opens for the file takes the unsaved document over (`adopt_hidden`).
//! - After every edit the hunks are recomputed on a worker from a rope snapshot (`Relayout`);
//!   the UI thread only compares doc versions.

use std::any::Any;
use std::collections::HashMap;
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use egui::text::{LayoutJob, TextFormat};
use egui::{pos2, vec2, Align2, Color32, CursorIcon, Event, EventFilter, FontId, Id, Key, Mesh, Modifiers, PointerButton, Pos2, Rect, RichText, Sense, Shape, Stroke, Ui, ViewportCommand};
use ide_editor::{ClickChain, Document, EditorTheme, HlKind, Language, Position, Selection, Span, TextSnapshot, CHAIN_DIST};
use ide_git::{DiffHunk, DiffSide, FileDiff, LineKind, Oid, Repo};

use crate::jobs::Jobs;
use crate::state::{AppCommand, AppState, TabEnv};
use crate::tabs::{CustomTab, TabContent, TabId};
use crate::theme;

mod edit;
mod select;
use edit::Edit;
use select::{Move, PaneSel};
pub use select::Side;

/// How long the hidden document waits after its last edit before it saves (as the Find
/// preview, `preview::SAVE_DEBOUNCE`).
pub const SAVE_DEBOUNCE: Duration = Duration::from_millis(500);
const LINE_H: f32 = 18.0;
const RIBBON_W: f32 = 36.0;
const SCROLLBAR_W: f32 = 12.0;
/// Longer lines are cut for display; nobody reads column 3000 in a diff.
const MAX_COLS: usize = 3000;

#[derive(Clone, Copy, PartialEq, Eq)]
enum HunkKind {
    Inserted,
    Deleted,
    Modified,
}

impl HunkKind {
    fn of(h: &DiffHunk) -> HunkKind {
        if h.old_lines.is_empty() {
            HunkKind::Inserted
        } else if h.new_lines.is_empty() {
            HunkKind::Deleted
        } else {
            HunkKind::Modified
        }
    }
    fn bg(self) -> Color32 {
        match self {
            HunkKind::Inserted => theme::T.diff_inserted_bg,
            HunkKind::Deleted => theme::T.diff_deleted_bg,
            HunkKind::Modified => theme::T.diff_modified_bg,
        }
    }
    fn word(self) -> Color32 {
        match self {
            HunkKind::Inserted => theme::T.diff_inserted_word,
            HunkKind::Deleted => theme::T.diff_deleted_word,
            HunkKind::Modified => theme::T.diff_modified_word,
        }
    }
    fn edge(self) -> Color32 {
        match self {
            HunkKind::Inserted => theme::T.diff_inserted_edge,
            HunkKind::Deleted => theme::T.diff_deleted_edge,
            HunkKind::Modified => theme::T.diff_modified_edge,
        }
    }
}

#[derive(Clone)]
enum Source {
    /// HEAD vs the file on disk (or the unsaved editor buffer).
    Worktree { abs: PathBuf, rel: PathBuf },
    /// Parent vs commit. `abs` is the file's place in the working tree.
    Commit { oid: Oid, rel: PathBuf, abs: PathBuf },
    /// The combined change of several log commits (`Repo::diff_commits_file`).
    Commits { oids: Vec<Oid>, rel: PathBuf, abs: PathBuf },
    /// A revision vs the file on disk (Compare with Local).
    RevLocal { rev: String, rel: PathBuf, abs: PathBuf },
}

/// One side of the diff.
struct Pane {
    doc: Document,
    lines: usize,
    /// Hunk index per line, `u32::MAX` outside hunks. After an edit on the live side it may be
    /// a line short or long until the worker's relayout lands; readers use `get`.
    hunk_of: Vec<u32>,
    /// Changed char-column ranges per line (word-level highlight).
    inline: HashMap<usize, Vec<Range<usize>>>,
    spans: SpanCache,
    max_cols: usize,
    exists: bool,
}

impl Pane {
    fn new(text: &str, language: Language, exists: bool) -> Pane {
        let mut doc = Document::from_text(text, language);
        // Parse on the worker that builds the model, so the first frame does not stall.
        doc.wait_syntax();
        let lines = doc_lines(&doc);
        let max_cols = text_max_cols(text);
        Pane { doc, lines, hunk_of: Vec::new(), inline: HashMap::new(), spans: SpanCache::default(), max_cols, exists }
    }
}

/// Lines the diff shows for a document: a final line break ends the last line instead of
/// starting an empty one.
fn doc_lines(doc: &Document) -> usize {
    let n = doc.line_count();
    if doc.len_chars() == 0 {
        0
    } else if doc.line_len(n - 1) == 0 {
        n - 1
    } else {
        n
    }
}

/// The widest line in display columns (tabs as 4), capped at `MAX_COLS`.
fn text_max_cols(text: &str) -> usize {
    text.split('\n').map(|l| l.chars().map(|c| if c == '\t' { 4 } else { 1 }).sum::<usize>().min(MAX_COLS)).max().unwrap_or(0)
}

/// Highlight spans of the lines around the view, rebuilt when the document or its tree changes.
#[derive(Default)]
struct SpanCache {
    key: Option<(u64, u64)>,
    start: usize,
    lines: Vec<Vec<Span>>,
}

impl SpanCache {
    /// Fills the cache for `range` (plus a margin) in one highlight call.
    fn ensure(&mut self, doc: &mut Document, total: usize, range: Range<usize>) {
        let key = doc.highlight_version();
        let range = range.start.min(total)..range.end.min(total);
        if self.key == Some(key) && range.start >= self.start && range.end <= self.start + self.lines.len() {
            return;
        }
        let from = range.start.saturating_sub(40);
        let to = (range.end + 40).min(total);
        self.key = Some(key);
        self.start = from;
        self.lines = doc.highlight(from..to);
    }

    fn get(&self, line: usize) -> &[Span] {
        line.checked_sub(self.start).and_then(|i| self.lines.get(i)).map_or(&[], Vec::as_slice)
    }
}

/// A run of the virtual coordinate: either unchanged lines or one hunk.
#[derive(Clone, Copy)]
struct Segment {
    v0: f64,
    len: f64,
    old0: usize,
    old_len: usize,
    new0: usize,
    new_len: usize,
    hunk: Option<usize>,
}

/// Where the hunks fall on each side: per-line marks and the shared scroll coordinate.
struct Layout {
    old_hunk_of: Vec<u32>,
    old_inline: HashMap<usize, Vec<Range<usize>>>,
    new_hunk_of: Vec<u32>,
    new_inline: HashMap<usize, Vec<Range<usize>>>,
    segments: Vec<Segment>,
    total: f64,
}

fn layout(hunks: &[DiffHunk], old_lines: usize, new_lines: usize) -> Layout {
    let mut old_hunk_of = vec![u32::MAX; old_lines];
    let mut new_hunk_of = vec![u32::MAX; new_lines];
    let (mut old_inline, mut new_inline) = (HashMap::new(), HashMap::new());
    for (hi, h) in hunks.iter().enumerate() {
        for l in h.old_lines.clone() {
            if let Some(s) = old_hunk_of.get_mut(l) {
                *s = hi as u32;
            }
        }
        for l in h.new_lines.clone() {
            if let Some(s) = new_hunk_of.get_mut(l) {
                *s = hi as u32;
            }
        }
        for p in &h.pairs {
            if p.kind != LineKind::Changed {
                continue;
            }
            if let (Some(o), false) = (p.old, p.old_inline.is_empty()) {
                old_inline.insert(o, p.old_inline.clone());
            }
            if let (Some(n), false) = (p.new, p.new_inline.is_empty()) {
                new_inline.insert(n, p.new_inline.clone());
            }
        }
    }
    let mut segments = Vec::with_capacity(hunks.len() * 2 + 1);
    let (mut o, mut n, mut v) = (0usize, 0usize, 0f64);
    let push_equal = |segments: &mut Vec<Segment>, o: &mut usize, n: &mut usize, v: &mut f64, upto_old: usize| {
        let len = upto_old.saturating_sub(*o);
        if len > 0 {
            segments.push(Segment { v0: *v, len: len as f64, old0: *o, old_len: len, new0: *n, new_len: len, hunk: None });
            *o += len;
            *n += len;
            *v += len as f64;
        }
    };
    for (hi, h) in hunks.iter().enumerate() {
        push_equal(&mut segments, &mut o, &mut n, &mut v, h.old_lines.start);
        // Re-sync in case the hunk list skipped lines on one side.
        o = h.old_lines.start;
        n = h.new_lines.start;
        let (ol, nl) = (h.old_lines.len(), h.new_lines.len());
        let len = ol.max(nl).max(1) as f64;
        segments.push(Segment { v0: v, len, old0: o, old_len: ol, new0: n, new_len: nl, hunk: Some(hi) });
        o += ol;
        n += nl;
        v += len;
    }
    let rest = old_lines.saturating_sub(o).max(new_lines.saturating_sub(n));
    if rest > 0 {
        segments.push(Segment { v0: v, len: rest as f64, old0: o, old_len: rest, new0: n, new_len: rest, hunk: None });
        v += rest as f64;
    }
    Layout { old_hunk_of, old_inline, new_hunk_of, new_inline, segments, total: v }
}

struct Model {
    diff: FileDiff,
    old: Pane,
    new: Pane,
    segments: Vec<Segment>,
    total: f64,
    /// Text the new side was built from, for "did anything change" checks on reload.
    new_text: String,
    /// The old text, shared with relayout workers without a copy per keystroke.
    old_shared: Arc<str>,
}

impl Model {
    fn build(diff: FileDiff, new_override: Option<String>) -> Model {
        let mut diff = diff;
        if let Some(buf) = new_override {
            if !diff.binary && buf != diff.new_text {
                diff.hunks = ide_git::diff_texts(&diff.old_text, &buf);
                diff.new_text = buf;
                diff.new_exists = true;
            }
        }
        let language = Language::from_path(&diff.path);
        let mut old = Pane::new(&diff.old_text, language, diff.old_exists);
        let mut new = Pane::new(&diff.new_text, language, diff.new_exists);
        let l = layout(&diff.hunks, old.lines, new.lines);
        (old.hunk_of, old.inline, new.hunk_of, new.inline) = (l.old_hunk_of, l.old_inline, l.new_hunk_of, l.new_inline);
        let new_text = diff.new_text.clone();
        let old_shared = Arc::from(diff.old_text.as_str());
        Model { diff, old, new, segments: l.segments, total: l.total, new_text, old_shared }
    }

    /// Takes the hunks a worker computed for the edited working-tree text.
    fn apply(&mut self, r: Relayout) {
        let l = r.layout;
        (self.old.hunk_of, self.old.inline, self.new.hunk_of, self.new.inline) = (l.old_hunk_of, l.old_inline, l.new_hunk_of, l.new_inline);
        self.segments = l.segments;
        self.total = l.total;
        self.diff.hunks = r.hunks;
        self.diff.new_exists = true;
        self.new.lines = r.new_lines;
        self.new.max_cols = r.new_max_cols;
        self.new_text = r.new_text;
    }

    /// Line (fractional) shown at virtual position `t` on one side.
    fn map(&self, t: f64, old_side: bool) -> f64 {
        if self.segments.is_empty() {
            return t;
        }
        let i = self.segments.partition_point(|s| s.v0 <= t).saturating_sub(1);
        let s = self.segments[i];
        let frac = ((t - s.v0) / s.len).clamp(0.0, 1.0);
        let (start, len) = if old_side { (s.old0, s.old_len) } else { (s.new0, s.new_len) };
        if s.hunk.is_none() {
            // Past the last segment the shorter side simply runs out.
            return start as f64 + (t - s.v0).max(0.0);
        }
        start as f64 + frac * len as f64
    }

    /// Virtual position of (fractional) line `line` on one side: the inverse of `map`.
    fn unmap(&self, line: f64, old_side: bool) -> f64 {
        if self.segments.is_empty() {
            return line;
        }
        let start_of = |s: &Segment| if old_side { s.old0 } else { s.new0 } as f64;
        let i = self.segments.partition_point(|s| start_of(s) <= line).saturating_sub(1);
        let s = self.segments[i];
        let (start, len) = if old_side { (s.old0, s.old_len) } else { (s.new0, s.new_len) };
        let d = (line - start as f64).max(0.0);
        match s.hunk {
            None => s.v0 + d,
            Some(_) if len == 0 => s.v0 + s.len,
            Some(_) => s.v0 + d / len as f64 * s.len,
        }
    }

    fn pane(&self, side: Side) -> &Pane {
        match side {
            Side::Old => &self.old,
            Side::New => &self.new,
        }
    }

    fn hunk_v0(&self, hunk: usize) -> f64 {
        self.segments.iter().find(|s| s.hunk == Some(hunk)).map_or(0.0, |s| s.v0)
    }
}

/// The hunks of the edited working-tree text, computed on a worker.
struct Relayout {
    hunks: Vec<DiffHunk>,
    layout: Layout,
    new_lines: usize,
    new_max_cols: usize,
    new_text: String,
}

impl Relayout {
    fn compute(old: &str, new: TextSnapshot, old_lines: usize, new_lines: usize) -> Relayout {
        let new_text = new.file_text();
        let hunks = ide_git::diff_texts(old, &new_text);
        let layout = layout(&hunks, old_lines, new_lines);
        Relayout { new_max_cols: text_max_cols(&new_text), hunks, layout, new_lines, new_text }
    }
}

/// Which document the live side shows: an editor tab's, or the hidden one (by generation).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DocRef {
    Tab(TabId),
    Hidden(u64),
}

/// The editable working-tree side.
#[derive(Default)]
struct Live {
    /// The file's document while no editor tab holds it.
    hidden: Option<Document>,
    /// Bumped whenever `hidden` changes, so a late save result never marks another document.
    hidden_gen: u64,
    loading: bool,
    load_failed: bool,
    /// The document and version the drawn hunks were computed from.
    computed: Option<(DocRef, u64)>,
    relayout_running: bool,
    /// An unsaved edit of the hidden document; it saves `SAVE_DEBOUNCE` later.
    edited_at: Option<Instant>,
    saving: bool,
    had_focus: bool,
    /// Highlight spans of the live document (the model's new pane caches its own copy's).
    spans: SpanCache,
}

enum Load {
    Loading,
    Failed(String),
    Ready(Box<Model>),
}

pub struct DiffTab {
    key: String,
    title: String,
    tooltip: String,
    source: Source,
    load: Load,
    /// Top of the view in virtual lines.
    t: f64,
    hscroll: f32,
    /// Hunk F7 / Shift+F7 last moved to; cleared by manual scrolling.
    current: Option<usize>,
    goto_first: bool,
    reloading: bool,
    /// A reload was asked for while one ran; it runs again when the first one lands.
    reload_pending: bool,
    view_lines: f64,
    dragging_thumb: Option<f32>,
    /// The caret and selection; on one side only, like IDEA.
    sel: Option<PaneSel>,
    /// The presses of the current multi-click (press-based, like the editor).
    chain: ClickChain,
    /// A primary press in a pane is held: moves extend the selection on its side.
    drag: bool,
    /// Where the last frame drew the panes, for tests that aim at a char.
    geom: Option<Geom>,
    /// Bumped by every new model, so a relayout of an older model is dropped.
    model_gen: u64,
    live: Live,
}

/// One pane as drawn last frame.
#[derive(Clone, Copy)]
struct PaneGeom {
    rect: Rect,
    /// Line (fractional) at the pane's top edge.
    top: f64,
}

#[derive(Clone, Copy)]
struct Geom {
    old: PaneGeom,
    new: PaneGeom,
    gutter_w: f32,
    hscroll: f32,
    char_w: f32,
}

impl DiffTab {
    fn new(source: Source) -> DiffTab {
        let (key, title, tooltip) = match &source {
            Source::Worktree { rel, .. } => {
                (format!("diff:wt:{}", rel.display()), format!("{} (Diff)", name_of(rel)), format!("{}: HEAD vs working tree", rel.display()))
            }
            Source::Commit { oid, rel, .. } => {
                let short = &oid.to_string()[..8];
                (format!("diff:{oid}:{}", rel.display()), format!("{} @ {short}", name_of(rel)), format!("{}: changes in {short}", rel.display()))
            }
            Source::Commits { oids, rel, .. } => {
                let ids: Vec<String> = oids.iter().map(|o| o.to_string()[..8].to_string()).collect();
                let n = oids.len();
                (format!("diff:{}:{}", ids.join(","), rel.display()), format!("{} @ {n} commits", name_of(rel)), format!("{}: changes in {}", rel.display(), ids.join(", ")))
            }
            Source::RevLocal { rev, rel, .. } => {
                let short = &rev[..rev.len().min(8)];
                (format!("diff:local:{rev}:{}", rel.display()), format!("{} ({short} vs Local)", name_of(rel)), format!("{}: {short} vs the working tree", rel.display()))
            }
        };
        DiffTab { key, title, tooltip, source, load: Load::Loading, t: 0.0, hscroll: 0.0, current: None, goto_first: true, reloading: false, reload_pending: false, view_lines: 30.0, dragging_thumb: None, sel: None, chain: ClickChain::default(), drag: false, geom: None, model_gen: 0, live: Live::default() }
    }

    fn set_model(&mut self, model: Model) {
        let keep = matches!(self.load, Load::Ready(_));
        self.load = Load::Ready(Box::new(model));
        self.model_gen += 1;
        self.live.load_failed = false;
        // A reload keeps the selection where it was; the text under it may have changed. The
        // live side clamps to its document while it draws.
        let live = self.editable_source();
        if let (Some(sel), Load::Ready(m)) = (&mut self.sel, &self.load) {
            if sel.side == Side::Old || !live {
                sel.clamp(m.pane(sel.side).doc.len_chars());
            }
        }
        if !keep {
            self.goto_first = true;
        }
        self.clamp();
    }

    fn model(&self) -> Option<&Model> {
        match &self.load {
            Load::Ready(m) => Some(m),
            _ => None,
        }
    }

    fn max_t(&self) -> f64 {
        self.model().map_or(0.0, |m| (m.total - self.view_lines + 3.0).max(0.0))
    }

    fn clamp(&mut self) {
        self.t = self.t.clamp(0.0, self.max_t());
    }

    fn go_to_hunk(&mut self, hunk: usize) {
        let Some(m) = self.model() else { return };
        let v = m.hunk_v0(hunk);
        self.t = v - (self.view_lines / 3.0).floor();
        self.current = Some(hunk);
        self.clamp();
    }

    fn step(&mut self, forward: bool) {
        let Some(m) = self.model() else { return };
        let n = m.diff.hunks.len();
        if n == 0 {
            return;
        }
        let next = match self.current {
            Some(c) if forward => (c + 1 < n).then_some(c + 1),
            Some(c) => c.checked_sub(1),
            None => {
                let anchor = self.t + (self.view_lines / 3.0).floor();
                if forward {
                    (0..n).find(|&h| m.hunk_v0(h) > anchor + 0.5)
                } else {
                    (0..n).rev().find(|&h| m.hunk_v0(h) < anchor - 0.5)
                }
            }
        };
        if let Some(h) = next {
            self.go_to_hunk(h);
        }
    }

    /// Number of changed blocks, once the diff is loaded.
    pub fn hunk_count(&self) -> Option<usize> {
        self.model().map(|m| m.diff.hunks.len())
    }

    /// The change F7 / Shift+F7 last moved to.
    pub fn current_hunk(&self) -> Option<usize> {
        self.current
    }

    /// First new-side line of hunk `i`.
    pub fn hunk_new_start(&self, i: usize) -> Option<usize> {
        self.model().and_then(|m| m.diff.hunks.get(i)).map(|h| h.new_lines.start)
    }

    /// The document a side shows outside a frame: the hidden document on the live side, else
    /// the model's copy. While an editor tab holds the file, read its document instead.
    fn side_doc(&self, side: Side) -> Option<&Document> {
        match (side, &self.live.hidden) {
            (Side::New, Some(h)) => Some(h),
            _ => self.model().map(|m| &m.pane(side).doc),
        }
    }

    /// The side of the caret and its selected text (empty for a bare caret).
    pub fn selection(&self) -> Option<(Side, String)> {
        let sel = self.sel.as_ref()?;
        let doc = self.side_doc(sel.side)?;
        let len = doc.len_chars();
        let r = sel.range();
        Some((sel.side, doc.slice(r.start.min(len)..r.end.min(len))))
    }

    /// The caret's side and position (0-based line and char column).
    pub fn caret(&self) -> Option<(Side, Position)> {
        let sel = self.sel.as_ref()?;
        let doc = self.side_doc(sel.side)?;
        Some((sel.side, doc.char_to_position(sel.head.min(doc.len_chars()))))
    }

    /// The text of one side, as the diff shows it (see `side_doc`).
    pub fn side_text(&self, side: Side) -> Option<String> {
        self.side_doc(side).map(Document::text)
    }

    /// The working-tree file's document while no editor tab holds it.
    pub fn hidden_doc(&self) -> Option<&Document> {
        self.live.hidden.as_ref()
    }

    /// The hunks follow the current text of the live side: no relayout is due or running.
    pub fn hunks_current(&self) -> bool {
        !self.live.relayout_running && !self.reloading
    }

    /// The right side is the working-tree file and can be edited.
    fn editable_source(&self) -> bool {
        matches!(self.source, Source::Worktree { .. } | Source::RevLocal { .. }) && !self.is_binary()
    }

    fn abs(&self) -> &Path {
        match &self.source {
            Source::Worktree { abs, .. } | Source::Commit { abs, .. } | Source::Commits { abs, .. } | Source::RevLocal { abs, .. } => abs,
        }
    }

    /// Screen point in the middle of char `col` (no tabs before it) of `line` on `side`, as drawn
    /// last frame. Tests aim pointer events with it.
    pub fn char_center(&self, side: Side, line: usize, col: usize) -> Option<Pos2> {
        let g = self.geom?;
        let p = match side {
            Side::Old => g.old,
            Side::New => g.new,
        };
        let x = p.rect.min.x + g.gutter_w - g.hscroll + (col as f32 + 0.5) * g.char_w;
        let y = p.rect.min.y + ((line as f64 - p.top) as f32) * LINE_H + LINE_H / 2.0;
        Some(pos2(x, y))
    }

    pub fn is_binary(&self) -> bool {
        self.model().is_some_and(|m| m.diff.binary)
    }

    fn rel(&self) -> &Path {
        match &self.source {
            Source::Worktree { rel, .. } | Source::Commit { rel, .. } | Source::Commits { rel, .. } | Source::RevLocal { rel, .. } => rel,
        }
    }
}

fn name_of(p: &Path) -> String {
    p.file_name().map_or_else(|| p.display().to_string(), |n| n.to_string_lossy().into_owned())
}

impl CustomTab for DiffTab {
    fn key(&self) -> String {
        self.key.clone()
    }
    fn title(&self) -> String {
        self.title.clone()
    }
    fn tooltip(&self) -> String {
        self.tooltip.clone()
    }
    fn file_path(&self) -> Option<PathBuf> {
        Some(self.abs().to_path_buf())
    }
    fn shared_editor(&self) -> Option<PathBuf> {
        self.editable_source().then(|| self.abs().to_path_buf())
    }
    fn has_pending_work(&self) -> bool {
        self.live.edited_at.is_some()
    }
    fn on_close(&mut self, env: &mut TabEnv) {
        save_hidden(env.jobs, self, true);
    }
    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
    fn ui(&mut self, ui: &mut Ui, env: &mut TabEnv) {
        let body_id = crate::workspace::wid(("diff-body", &self.key));
        toolbar(self, ui, env, body_id);
        match &self.load {
            Load::Loading => {
                ui.add_space(20.0);
                ui.horizontal(|ui| {
                    ui.add_space(20.0);
                    ui.add(egui::Spinner::new());
                    ui.label("Loading diff...");
                });
                return;
            }
            Load::Failed(e) => {
                ui.add_space(20.0);
                ui.label(RichText::new(format!("Cannot load the diff: {e}")).color(theme::T.error));
                return;
            }
            Load::Ready(m) if m.diff.binary => {
                ui.add_space(20.0);
                ui.vertical_centered(|ui| ui.label(RichText::new("Binary files differ").color(theme::T.text_dim)));
                return;
            }
            Load::Ready(_) => {}
        }
        let editable = self.editable_source();
        let mut editor = env.editor.take().filter(|(_, e)| editable && !e.read_only);
        if editor.is_some() && self.live.hidden.is_some() {
            // An editor tab holds the file now (`adopt_hidden` took unsaved edits over).
            save_hidden(env.jobs, self, true);
            self.live.hidden = None;
            self.live.hidden_gen += 1;
        }
        let new_exists = self.model().is_some_and(|m| m.diff.new_exists);
        if editable && editor.is_none() && self.live.hidden.is_none() && new_exists && !self.live.loading && !self.live.load_failed {
            load_hidden(env.jobs, self);
        }
        let mut hidden = self.live.hidden.take();
        let doc_ref = match &editor {
            Some((id, _)) => Some(DocRef::Tab(*id)),
            None => hidden.as_ref().map(|_| DocRef::Hidden(self.live.hidden_gen)),
        };
        let live_doc = match editor.as_mut() {
            Some((_, e)) => Some(&mut e.doc),
            None => hidden.as_mut(),
        };
        let out = body(self, ui, env.editor_theme, body_id, live_doc);
        let live_doc = match editor.as_mut() {
            Some((_, e)) => Some(&mut e.doc),
            None => hidden.as_mut(),
        };
        if let (Some(r), Some(doc)) = (doc_ref, live_doc) {
            relayout_if_changed(self, env.jobs, r, doc);
        }
        self.live.hidden = hidden;
        if out.edited {
            match editor.as_mut() {
                Some((_, e)) => {
                    // The tab's language server sync and gutter marks wait for a quiet period.
                    e.last_edit = Instant::now();
                    e.problems.refresh(&e.doc);
                }
                None => {
                    self.live.edited_at = Some(Instant::now());
                    ui.ctx().request_repaint_after(SAVE_DEBOUNCE);
                }
            }
        }
        if self.live.had_focus && !out.has_focus && self.live.edited_at.is_some() {
            save_hidden(env.jobs, self, false);
        }
        self.live.had_focus = out.has_focus;
        if let Some(text) = out.copied {
            // The clipboard belongs to the platform; a tab reaches `AppState` only through a job.
            env.jobs.post(move |state| {
                let ctx = state.ctx.clone();
                state.platform.copy_text(&ctx, &text);
            });
        }
    }
}

fn toolbar(tab: &mut DiffTab, ui: &mut Ui, env: &mut TabEnv, body_id: Id) {
    let focused = ui.ctx().memory(|m| m.focused());
    let keys_ok = focused.is_none() || focused == Some(body_id);
    let (f7, shift_f7, f4) = if keys_ok {
        // Shift+F7 first: consume_key ignores an extra Shift, so a plain-F7 check would also
        // take Shift+F7 and move forward instead of back.
        ui.input_mut(|i| {
            let shift_f7 = i.consume_key(egui::Modifiers::SHIFT, Key::F7);
            (i.consume_key(egui::Modifiers::NONE, Key::F7), shift_f7, i.consume_key(egui::Modifiers::NONE, Key::F4))
        })
    } else {
        (false, false, false)
    };
    let (hunks, identical) = tab.model().map_or((0, false), |m| (m.diff.hunks.len(), m.diff.hunks.is_empty() && !m.diff.binary));
    let mut jump = f4;
    egui::Frame::NONE.fill(theme::T.island_bg).inner_margin(egui::Margin::symmetric(8, 3)).show(ui, |ui| {
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 4.0;
            if ui.add_enabled(hunks > 0, egui::Button::new("Prev").small()).on_hover_text("Previous Difference (⇧F7)").clicked() || shift_f7 {
                tab.step(false);
            }
            if ui.add_enabled(hunks > 0, egui::Button::new("Next").small()).on_hover_text("Next Difference (F7)").clicked() || f7 {
                tab.step(true);
            }
            if matches!(tab.source, Source::Worktree { .. }) && ui.add(egui::Button::new("Jump to Source").small()).on_hover_text("F4").clicked() {
                jump = true;
            }
            ui.add_space(8.0);
            let label = if tab.model().is_none() {
                String::new()
            } else if identical {
                "Contents are identical".to_string()
            } else {
                format!("{hunks} difference{}", if hunks == 1 { "" } else { "s" })
            };
            ui.label(RichText::new(label).size(theme::T.font.small).color(theme::T.text_dim));
            if tab.reloading {
                ui.add(egui::Spinner::new().size(theme::T.font.small));
            }
        });
    });
    if jump {
        if let (Source::Worktree { abs, .. }, Some(m)) = (&tab.source, tab.model()) {
            let line = match tab.current {
                Some(h) => m.diff.hunks.get(h).map_or(0, |h| h.new_lines.start),
                None => m.map(tab.t + (tab.view_lines / 3.0).floor(), false) as usize,
            };
            env.commands.push(AppCommand::OpenLocation { path: abs.clone(), pos: Some(Position::new(line.min(m.new.lines.saturating_sub(1)), 0)) });
        }
    }
}

struct Metrics {
    char_w: f32,
    font: FontId,
}

/// What a frame of the body did.
struct BodyOut {
    /// Text that Copy or Cut put on the clipboard.
    copied: Option<String>,
    /// The live document changed.
    edited: bool,
    has_focus: bool,
}

/// One keyboard or clipboard request, in the order the frame got them.
enum Input {
    Move(Move, bool),
    Edit(Edit),
}

/// The document a side shows this frame: the live one on the new side, else the model's copy.
fn doc_for<'a>(model: &'a Model, live: Option<&'a Document>, side: Side) -> &'a Document {
    match (side, live) {
        (Side::New, Some(d)) => d,
        _ => &model.pane(side).doc,
    }
}

/// Draws the panes and handles their input. `live` is the working-tree document when the new
/// side is editable.
fn body(tab: &mut DiffTab, ui: &mut Ui, theme_e: &EditorTheme, body_id: Id, mut live: Option<&mut Document>) -> BodyOut {
    let mut out = BodyOut { copied: None, edited: false, has_focus: false };
    let font = theme::T.mono_font();
    // The laid-out column step, like the editor (`ide_editor::column_advance`).
    let char_w = ui.fonts(|f| ide_editor::column_advance(f, &font));
    let metrics = Metrics { char_w, font };
    let full = ui.available_rect_before_wrap();
    let title_h = 22.0;
    let area = Rect::from_min_max(pos2(full.min.x, full.min.y + title_h), full.max);
    let resp = ui.interact(area, body_id, Sense::click_and_drag());
    if resp.clicked() || resp.drag_started() {
        resp.request_focus();
    }
    ui.allocate_rect(full, Sense::hover());

    let Load::Ready(model) = &mut tab.load else { return out };
    tab.view_lines = (area.height() / LINE_H) as f64;
    // The live text may have changed under the caret (typing in the editor tab, a reload).
    if let (Some(doc), Some(sel)) = (live.as_deref(), tab.sel.as_mut()) {
        if sel.side == Side::New {
            sel.clamp(doc.len_chars());
        }
    }
    let old_lines = model.old.lines;
    let new_lines = match live.as_deref() {
        Some(doc) => {
            // The empty line after a final line break shows while the caret is on it.
            let base = doc_lines(doc);
            let on_last = tab.sel.as_ref().is_some_and(|s| s.side == Side::New && doc.char_to_position(s.head).line >= base);
            if on_last { doc.line_count() } else { base }
        }
        None => model.new.lines,
    };
    let side_lines = |side: Side| if side == Side::Old { old_lines } else { new_lines };

    // Input: wheel, keys, scrollbar.
    let pane_w = ((area.width() - RIBBON_W - SCROLLBAR_W) / 2.0).max(50.0);
    let left = Rect::from_min_size(area.min, vec2(pane_w, area.height()));
    let ribbon = Rect::from_min_size(pos2(left.max.x, area.min.y), vec2(RIBBON_W, area.height()));
    let right = Rect::from_min_size(pos2(ribbon.max.x, area.min.y), vec2(pane_w, area.height()));
    let bar = Rect::from_min_max(pos2(right.max.x, area.min.y), area.max);
    let gutter_w = |lines: usize| (lines.max(1).to_string().len().max(3) as f32) * char_w + 14.0;
    let gw = gutter_w(old_lines.max(new_lines));
    let text_w = pane_w - gw;

    // Mouse selection, hit-tested against the layout the user saw: this frame's scroll input is
    // applied below.
    let pane_rect = |side: Side| if side == Side::Old { left } else { right };
    let hit_at = |model: &Model, doc: &Document, side: Side, t: f64, hscroll: f32, pos: Pos2| -> usize {
        let top = model.map(t, side == Side::Old);
        hit(ui, doc, side_lines(side), pane_rect(side), top, gw, hscroll, pos, &metrics, theme_e)
    };
    // Read the options before `input`: its closure holds the context lock, and egui's lock is
    // not re-entrant, so a ctx call inside it deadlocks the frame.
    let delay = ui.ctx().options(|o| o.input_options.max_double_click_delay);
    let (presses, time, pointer, primary_down, stable_dt) = ui.input(|i| {
        let presses: Vec<(Pos2, PointerButton, Modifiers)> = i
            .events
            .iter()
            .filter_map(|e| match e {
                Event::PointerButton { pos, button, pressed: true, modifiers } => Some((*pos, *button, *modifiers)),
                _ => None,
            })
            .collect();
        (presses, i.time, i.pointer.latest_pos(), i.pointer.primary_down(), i.stable_dt)
    });
    let on_body = |pos: Pos2| ui.ctx().layer_id_at(pos) == Some(ui.layer_id()) && ui.clip_rect().contains(pos);
    for (pos, button, mods) in presses {
        let side = if left.contains(pos) {
            Side::Old
        } else if right.contains(pos) {
            Side::New
        } else {
            continue;
        };
        if !on_body(pos) {
            continue;
        }
        let doc = doc_for(model, live.as_deref(), side);
        let at = hit_at(model, doc, side, tab.t, tab.hscroll, pos);
        match button {
            PointerButton::Primary => {
                if mods.shift {
                    tab.chain.reset();
                    match &mut tab.sel {
                        Some(sel) if sel.side == side => {
                            sel.unit = select::Unit::Char;
                            sel.extend(doc, at);
                        }
                        _ => tab.sel = Some(PaneSel::caret(side, at)),
                    }
                } else if mods.alt || mods.command || mods.ctrl {
                    tab.chain.reset();
                    tab.sel = Some(PaneSel::caret(side, at));
                } else {
                    let count = tab.chain.press(time, pos, delay, CHAIN_DIST);
                    tab.sel = Some(PaneSel::press(side, doc, at, count));
                }
                tab.drag = true;
                resp.request_focus();
            }
            PointerButton::Secondary => {
                tab.chain.reset();
                // A right press inside the selection keeps it for the menu's Copy.
                let inside = tab.sel.as_ref().is_some_and(|s| s.side == side && !s.is_empty() && s.range().contains(&at));
                if !inside {
                    tab.sel = Some(PaneSel::caret(side, at));
                }
                resp.request_focus();
            }
            _ => tab.chain.reset(),
        }
        if side == Side::New {
            // A caret moved by the mouse ends the typing undo step, like the editor.
            if let Some(d) = live.as_deref_mut() {
                d.seal_undo_group();
            }
        }
    }
    let mut dt = 0.0f64;
    if tab.drag && !primary_down {
        tab.drag = false;
    }
    if let (true, Some(pos), Some(side)) = (tab.drag, pointer, tab.sel.as_ref().map(|s| s.side)) {
        // Past an edge the view scrolls, faster the farther the pointer is; both sides follow.
        let pr = pane_rect(side);
        let speed = |d: f32| (12.0 + d / 2.0) as f64 * stable_dt as f64;
        if pos.y < pr.min.y {
            dt -= speed(pr.min.y - pos.y);
        } else if pos.y > pr.max.y {
            dt += speed(pos.y - pr.max.y);
        }
        let text_x = pr.min.x + gw;
        if pos.x < text_x && tab.hscroll > 0.0 {
            tab.hscroll -= (speed(text_x - pos.x) * char_w as f64) as f32;
        } else if pos.x > pr.max.x {
            tab.hscroll += (speed(pos.x - pr.max.x) * char_w as f64) as f32;
        }
        let inner = pos2(pos.x, pos.y.clamp(pr.min.y + 1.0, pr.max.y - 1.0));
        let doc = doc_for(model, live.as_deref(), side);
        let at = hit_at(model, doc, side, tab.t, tab.hscroll, inner);
        if let Some(sel) = &mut tab.sel {
            sel.extend(doc, at);
        }
        if dt != 0.0 || pos.x < text_x || pos.x > pr.max.x {
            ui.ctx().request_repaint();
        }
    }

    let hovered = ui.rect_contains_pointer(area);
    if hovered {
        let d = ui.input(|i| i.smooth_scroll_delta);
        dt -= (d.y / LINE_H) as f64;
        tab.hscroll -= d.x;
    }
    // Only the working-tree side takes edits; the other side and commit diffs stay read-only.
    let editable = live.is_some() && tab.sel.as_ref().is_some_and(|s| s.side == Side::New);
    out.has_focus = resp.has_focus();
    if out.has_focus {
        // The arrows (and Tab on the editable side) act on the caret; without the filter egui
        // would move the focus instead.
        ui.memory_mut(|m| m.set_focus_lock_filter(body_id, EventFilter { horizontal_arrows: true, vertical_arrows: true, tab: editable, escape: false }));
        let page = (tab.view_lines - 2.0).max(1.0) as usize;
        let (select_all, copy, inputs) = ui.input_mut(|i| {
            let all = i.consume_key(Modifiers::COMMAND, Key::A);
            let copy_key = i.consume_key(Modifiers::COMMAND, Key::C);
            // A read-only side treats Cut as Copy, like a read-only editor.
            let copy = copy_key || i.events.iter().any(|e| matches!(e, Event::Copy) || (!editable && matches!(e, Event::Cut)));
            let mods = i.modifiers;
            let inputs: Vec<Input> = i
                .events
                .iter()
                .filter_map(|e| match key_move(e, page) {
                    Some((mv, extend)) => Some(Input::Move(mv, extend)),
                    None if editable => edit::edit_of(e, mods).map(Input::Edit),
                    None => None,
                })
                .collect();
            (all, copy, inputs)
        });
        if select_all {
            let side = tab.sel.as_ref().map_or(Side::New, |s| s.side);
            let len = doc_for(model, live.as_deref(), side).len_chars();
            tab.sel = Some(PaneSel { anchor: 0, head: len, ..PaneSel::caret(side, len) });
        }
        if let Some(sel) = &mut tab.sel {
            let mut moved = false;
            for input in inputs {
                match input {
                    Input::Move(mv, extend) => {
                        select::apply_move(sel, doc_for(model, live.as_deref(), sel.side), mv, extend);
                        match mv {
                            Move::Up(n) if n > 1 => dt -= n as f64,
                            Move::Down(n) if n > 1 => dt += n as f64,
                            _ => {}
                        }
                        if sel.side == Side::New {
                            if let Some(d) = live.as_deref_mut() {
                                d.seal_undo_group();
                            }
                        }
                        moved = true;
                    }
                    Input::Edit(e) => {
                        let Some(doc) = live.as_deref_mut() else { continue };
                        let (s, cut) = edit::apply(doc, Selection::new(sel.anchor, sel.head), &e);
                        *sel = PaneSel { anchor: s.anchor, ..PaneSel::caret(Side::New, s.head) };
                        if cut.is_some() {
                            out.copied = cut;
                        }
                        out.edited = true;
                        moved = true;
                    }
                }
            }
            if moved {
                tab.current = None;
                // Keep the caret on screen: the page moves above already scrolled.
                let side = sel.side;
                let doc = doc_for(model, live.as_deref(), side);
                let pos = doc.char_to_position(sel.head);
                let old_side = side == Side::Old;
                let t = tab.t + dt;
                let top = model.map(t, old_side);
                let line = pos.line as f64;
                let rows = tab.view_lines.floor().max(1.0);
                if line < top {
                    dt = model.unmap(line, old_side) - tab.t;
                } else if line + 1.0 > top + rows {
                    dt = model.unmap(line + 1.0 - rows, old_side) - tab.t;
                }
                let text = doc.line(pos.line);
                let x = display_col(&text, pos.column) as f32 * char_w;
                if x < tab.hscroll {
                    tab.hscroll = x;
                } else if x > tab.hscroll + text_w - 2.0 * char_w {
                    tab.hscroll = x - text_w + 2.0 * char_w;
                }
            }
            if copy && !sel.is_empty() {
                out.copied = Some(doc_for(model, live.as_deref(), sel.side).slice(sel.range()));
            }
        } else {
            // No caret yet: the keys scroll the view.
            for input in inputs {
                match input {
                    Input::Move(Move::Up(n), _) => dt -= n as f64,
                    Input::Move(Move::Down(n), _) => dt += n as f64,
                    _ => {}
                }
            }
        }
    }
    let editable = live.is_some() && tab.sel.as_ref().is_some_and(|s| s.side == Side::New);
    let has_sel = tab.sel.as_ref().is_some_and(|s| !s.is_empty());
    let (mut menu_cut, mut menu_copy, mut menu_paste, mut menu_all) = (false, false, false, false);
    resp.context_menu(|ui| {
        ui.set_min_width(180.0);
        if editable && ui.add(egui::Button::new("Cut").shortcut_text("⌘X")).clicked() {
            menu_cut = true;
            ui.close_menu();
        }
        if ui.add_enabled(has_sel, egui::Button::new("Copy").shortcut_text("⌘C")).clicked() {
            menu_copy = true;
            ui.close_menu();
        }
        if editable && ui.add(egui::Button::new("Paste").shortcut_text("⌘V")).clicked() {
            menu_paste = true;
            ui.close_menu();
        }
        if ui.add(egui::Button::new("Select All").shortcut_text("⌘A")).clicked() {
            menu_all = true;
            ui.close_menu();
        }
    });
    if menu_cut || menu_copy || menu_paste || menu_all {
        // The press on the menu took the focus away.
        resp.request_focus();
    }
    if menu_paste {
        // The text arrives as `Event::Paste` next frame, like the editor's menu Paste.
        ui.ctx().send_viewport_cmd(ViewportCommand::RequestPaste);
    }
    if menu_all {
        let side = tab.sel.as_ref().map_or(Side::New, |s| s.side);
        let len = doc_for(model, live.as_deref(), side).len_chars();
        tab.sel = Some(PaneSel { anchor: 0, head: len, ..PaneSel::caret(side, len) });
    }
    if let (true, Some(sel)) = (menu_copy, &tab.sel) {
        out.copied = Some(doc_for(model, live.as_deref(), sel.side).slice(sel.range()));
    }
    if let (true, Some(sel), Some(doc)) = (menu_cut, tab.sel.as_mut(), live.as_deref_mut()) {
        let (s, cut) = edit::apply(doc, Selection::new(sel.anchor, sel.head), &Edit::Cut);
        *sel = PaneSel { anchor: s.anchor, ..PaneSel::caret(Side::New, s.head) };
        out.copied = cut;
        out.edited = true;
    }

    let total = model.total.max(1.0);
    let max_t = (model.total - tab.view_lines + 3.0).max(0.0);
    // Scrollbar: click jumps, drag moves the thumb.
    let bar_resp = ui.interact(bar, body_id.with("bar"), Sense::click_and_drag());
    let thumb_h = ((tab.view_lines / total) as f32 * bar.height()).clamp(24.0, bar.height());
    let thumb_range = (bar.height() - thumb_h).max(1.0);
    if let Some(p) = bar_resp.interact_pointer_pos() {
        if bar_resp.drag_started() || bar_resp.clicked() {
            let thumb_y = bar.min.y + (tab.t / max_t.max(1.0)) as f32 * thumb_range;
            let grab = if (thumb_y..thumb_y + thumb_h).contains(&p.y) { p.y - thumb_y } else { thumb_h / 2.0 };
            tab.dragging_thumb = Some(grab);
        }
        if let Some(grab) = tab.dragging_thumb {
            let frac = ((p.y - grab - bar.min.y) / thumb_range).clamp(0.0, 1.0);
            tab.t = frac as f64 * max_t;
            tab.current = None;
        }
    }
    if bar_resp.drag_stopped() || (!bar_resp.dragged() && !bar_resp.clicked()) {
        tab.dragging_thumb = None;
    }
    if bar_resp.hovered() {
        ui.ctx().set_cursor_icon(CursorIcon::Default);
    } else if hovered && (left.contains(ui.input(|i| i.pointer.hover_pos()).unwrap_or_default()) || right.contains(ui.input(|i| i.pointer.hover_pos()).unwrap_or_default())) {
        ui.ctx().set_cursor_icon(CursorIcon::Text);
    }
    if dt != 0.0 {
        tab.t += dt;
        tab.current = None;
    }
    if std::mem::take(&mut tab.goto_first) {
        tab.t = 0.0;
        if !model.diff.hunks.is_empty() {
            let v = model.hunk_v0(0);
            if v + 1.0 > tab.view_lines * 0.66 {
                tab.t = v - (tab.view_lines / 3.0).floor();
            }
        }
    }
    tab.t = tab.t.clamp(0.0, max_t);
    let new_cols = live.as_deref().map_or(model.new.max_cols, |d| d.max_line_chars().min(MAX_COLS));
    let max_cols = model.old.max_cols.max(new_cols) as f32;
    tab.hscroll = tab.hscroll.clamp(0.0, (max_cols * char_w - text_w + 3.0 * char_w).max(0.0));

    let painter = ui.painter_at(full);
    painter.rect_filled(full, 0.0, theme_e.background);

    // Titles above each pane. A read-only side shows a lock, like IDEA.
    let (old_title, new_title) = side_titles(&tab.source, &model.diff);
    let title_l = Rect::from_min_size(full.min, vec2(pane_w, title_h));
    let title_r = Rect::from_min_size(pos2(right.min.x, full.min.y), vec2(pane_w + SCROLLBAR_W, title_h));
    for (r, text, read_only) in [(title_l, old_title, true), (title_r, new_title, live.is_none())] {
        painter.rect_filled(r, 0.0, theme::T.tab_bar_bg);
        let mut x = r.min.x + 8.0;
        if read_only {
            crate::icons::paint(&painter, Rect::from_center_size(pos2(x + 5.0, r.center().y), vec2(10.0, 10.0)), crate::icons::Icon::Lock, theme::T.text_dim);
            x += 16.0;
        }
        painter.text(pos2(x, r.center().y), Align2::LEFT_CENTER, text, theme::T.small_font(), theme::T.text);
    }
    painter.rect_filled(Rect::from_min_size(pos2(left.max.x, full.min.y), vec2(RIBBON_W, title_h)), 0.0, theme::T.tab_bar_bg);
    painter.hline(full.x_range(), area.min.y - 0.5, Stroke::new(1.0_f32, theme::T.border));

    let t = tab.t;
    let top_old = model.map(t, true);
    let top_new = model.map(t, false);
    let focused = resp.has_focus();
    let marks = |side: Side| -> Marks {
        match &tab.sel {
            Some(s) if s.side == side => Marks { sel: s.range(), caret: focused.then_some(s.head) },
            _ => Marks { sel: 0..0, caret: None },
        }
    };
    let (marks_old, marks_new) = (marks(Side::Old), marks(Side::New));
    let hunks = &model.diff.hunks;
    let old = &mut model.old;
    let old_view = PaneView { doc: &mut old.doc, lines: old.lines, hunk_of: &old.hunk_of, inline: &old.inline, spans: &mut old.spans, exists: old.exists };
    draw_pane(&ui.painter_at(left), left, old_view, hunks, top_old, tab.hscroll, gw, &metrics, theme_e, true, &marks_old);
    let new = &mut model.new;
    let new_view = match live.as_deref_mut() {
        Some(doc) => PaneView { doc, lines: new_lines, hunk_of: &new.hunk_of, inline: &new.inline, spans: &mut tab.live.spans, exists: true },
        None => PaneView { doc: &mut new.doc, lines: new.lines, hunk_of: &new.hunk_of, inline: &new.inline, spans: &mut new.spans, exists: new.exists },
    };
    draw_pane(&ui.painter_at(right), right, new_view, hunks, top_new, tab.hscroll, gw, &metrics, theme_e, false, &marks_new);
    draw_ribbons(&ui.painter_at(ribbon), ribbon, model, top_old, top_new);
    draw_scrollbar(&painter, bar, model, tab.t, max_t, thumb_h, thumb_range, bar_resp.hovered() || tab.dragging_thumb.is_some());
    tab.geom = Some(Geom { old: PaneGeom { rect: left, top: top_old }, new: PaneGeom { rect: right, top: top_new }, gutter_w: gw, hscroll: tab.hscroll, char_w });

    // A pane may still be parsing in the background; poll until its colors arrive.
    let new_ready = match live {
        Some(d) => d.syntax_ready(),
        None => model.new.doc.syntax_ready(),
    };
    if !model.old.doc.syntax_ready() || !new_ready {
        ui.ctx().request_repaint_after(std::time::Duration::from_millis(50));
    }
    out
}

/// The caret move a key event asks for, with Shift held or not. macOS keys: Alt moves by
/// words, Cmd to the line or text edges.
fn key_move(e: &Event, page: usize) -> Option<(Move, bool)> {
    let Event::Key { key, pressed: true, modifiers: m, .. } = e else { return None };
    let mv = match key {
        Key::ArrowLeft if m.command => Move::LineStart,
        Key::ArrowLeft if m.alt => Move::WordLeft,
        Key::ArrowLeft => Move::Left,
        Key::ArrowRight if m.command => Move::LineEnd,
        Key::ArrowRight if m.alt => Move::WordRight,
        Key::ArrowRight => Move::Right,
        Key::ArrowUp if m.command => Move::DocStart,
        Key::ArrowUp => Move::Up(1),
        Key::ArrowDown if m.command => Move::DocEnd,
        Key::ArrowDown => Move::Down(1),
        Key::Home if m.command => Move::DocStart,
        Key::Home => Move::LineStart,
        Key::End if m.command => Move::DocEnd,
        Key::End => Move::LineEnd,
        Key::PageUp => Move::Up(page),
        Key::PageDown => Move::Down(page),
        _ => return None,
    };
    Some((mv, m.shift))
}

/// The char index under `pos` in one pane. A press left of the text is column 0; one below the
/// last line is the end of that line.
#[allow(clippy::too_many_arguments)]
fn hit(ui: &Ui, doc: &Document, lines: usize, rect: Rect, top: f64, gutter_w: f32, hscroll: f32, pos: Pos2, m: &Metrics, th: &EditorTheme) -> usize {
    if lines == 0 {
        return 0;
    }
    let line_f = top + ((pos.y - rect.min.y) / LINE_H) as f64;
    if line_f < 0.0 {
        return 0;
    }
    let line = line_f.floor() as usize;
    if line >= lines {
        return doc.line_end(lines - 1);
    }
    let text = doc.line(line);
    let x = pos.x.max(rect.min.x + gutter_w) - (rect.min.x + gutter_w - hscroll);
    let display = if x <= 0.0 {
        0
    } else {
        // The same galley the pane draws (cached by egui), so a hit matches the glyphs.
        let galley = ui.fonts(|f| f.layout_job(line_job(&text, &[], m, th)));
        galley.cursor_from_pos(vec2(x, LINE_H / 2.0)).ccursor.index
    };
    doc.line_start(line) + select::char_col(&text, display).min(doc.line_len(line))
}

fn side_titles(source: &Source, d: &FileDiff) -> (String, String) {
    let old_path = d.old_path.as_ref().unwrap_or(&d.path).display().to_string();
    let new_path = d.path.display().to_string();
    let missing = |exists: bool| if exists { "" } else { "  (does not exist)" };
    match source {
        Source::Worktree { .. } => (format!("HEAD  {old_path}{}", missing(d.old_exists)), format!("Working tree  {new_path}{}", missing(d.new_exists))),
        Source::Commit { oid, .. } => {
            let short = &oid.to_string()[..8];
            (format!("{short}^  {old_path}{}", missing(d.old_exists)), format!("{short}  {new_path}{}", missing(d.new_exists)))
        }
        Source::Commits { oids, .. } => {
            let (first, last) = (oids.first().map(|o| o.to_string()[..8].to_string()).unwrap_or_default(), oids.last().map(|o| o.to_string()[..8].to_string()).unwrap_or_default());
            (format!("before {first}  {old_path}{}", missing(d.old_exists)), format!("{last}  {new_path}{}", missing(d.new_exists)))
        }
        Source::RevLocal { rev, .. } => (format!("{}  {old_path}{}", &rev[..rev.len().min(8)], missing(d.old_exists)), format!("Working tree  {new_path}{}", missing(d.new_exists))),
    }
}

/// The selection (char range, may be empty) and the drawn caret of one pane.
struct Marks {
    sel: Range<usize>,
    caret: Option<usize>,
}

/// What one pane draws: the model's copy of a side, or the live document with the model's marks.
struct PaneView<'a> {
    doc: &'a mut Document,
    lines: usize,
    hunk_of: &'a [u32],
    inline: &'a HashMap<usize, Vec<Range<usize>>>,
    spans: &'a mut SpanCache,
    exists: bool,
}

#[allow(clippy::too_many_arguments)]
fn draw_pane(painter: &egui::Painter, rect: Rect, pane: PaneView, hunks: &[DiffHunk], top: f64, hscroll: f32, gutter_w: f32, m: &Metrics, th: &EditorTheme, old_side: bool, marks: &Marks) {
    let first = top.floor().max(0.0) as usize;
    let count = (rect.height() / LINE_H).ceil() as usize + 2;
    let last = (first + count).min(pane.lines);
    let y_of = |line: f64| rect.min.y + ((line - top) as f32) * LINE_H;
    let text_x = rect.min.x + gutter_w;
    painter.rect_filled(Rect::from_min_max(rect.min, pos2(text_x - 4.0, rect.max.y)), 0.0, th.gutter_background);

    if !pane.exists && pane.lines == 0 {
        painter.text(rect.center(), Align2::CENTER_CENTER, "File does not exist", theme::T.ui_font(), theme::T.text_dim);
    }

    // Empty-side hunks: a thin line at the gap the ribbon points to.
    for h in hunks {
        let range = if old_side { &h.old_lines } else { &h.new_lines };
        if range.is_empty() {
            let y = y_of(range.start as f64);
            if y >= rect.min.y - 2.0 && y <= rect.max.y + 2.0 {
                painter.hline(rect.x_range(), y, Stroke::new(1.0_f32, HunkKind::of(h).edge()));
            }
        }
    }
    if first >= last {
        return;
    }
    pane.spans.ensure(pane.doc, pane.lines, first..last);
    let text_clip = Rect::from_min_max(pos2(text_x, rect.min.y), rect.max);
    let text_painter = painter.with_clip_rect(text_clip.intersect(painter.clip_rect()));
    for line in first..last {
        let y = y_of(line as f64);
        let row = Rect::from_min_size(pos2(rect.min.x, y), vec2(rect.width(), LINE_H));
        // The live side may be a line ahead of its marks until the relayout lands.
        let h = pane.hunk_of.get(line).and_then(|&i| hunks.get(i as usize));
        let kind = h.map(HunkKind::of);
        if let (Some(k), Some(h)) = (kind, h) {
            painter.rect_filled(row, 0.0, k.bg());
            // Edges at the hunk boundaries, like IDEA's thin outline.
            let range = if old_side { &h.old_lines } else { &h.new_lines };
            if line == range.start {
                painter.hline(rect.x_range(), y, Stroke::new(1.0_f32, k.edge()));
            }
            if line + 1 == range.end {
                painter.hline(rect.x_range(), y + LINE_H, Stroke::new(1.0_f32, k.edge()));
            }
        }
        painter.text(pos2(text_x - 10.0, y + LINE_H / 2.0), Align2::RIGHT_CENTER, (line + 1).to_string(), theme::T.mono_small_font(), th.line_number);

        let text = pane.doc.line(line);
        let x0 = text_x - hscroll;
        let spans = pane.spans.get(line);
        let job = line_job(&text, spans, m, th);
        let galley = text_painter.layout_job(job);
        // X from the galley itself: glyph advances are rounded to pixels, so a constant char
        // width drifts by a column over a long line.
        let x_at = |col: usize| -> f32 {
            let c = display_col(&text, col);
            galley.pos_from_ccursor(egui::text::CCursor::new(c)).min.x
        };
        if let (Some(k), Some(ranges)) = (kind, pane.inline.get(&line)) {
            for r in ranges {
                let a = x_at(r.start);
                let b = x_at(r.end).max(a + m.char_w * 0.5);
                let wr = Rect::from_min_max(pos2(x0 + a, y + 1.0), pos2(x0 + b, y + LINE_H - 1.0));
                text_painter.rect_filled(wr, 2.0, k.word());
            }
        }
        let ls = pane.doc.line_start(line);
        let le = ls + pane.doc.line_len(line);
        let sel = &marks.sel;
        if !sel.is_empty() && sel.start <= le && sel.end > ls {
            let a = x_at(sel.start.max(ls) - ls);
            let mut b = x_at(sel.end.min(le) - ls);
            if sel.end > le {
                // The line break is selected too: show it as a half-column, like the editor.
                b += m.char_w * 0.5;
            }
            text_painter.rect_filled(Rect::from_min_max(pos2(x0 + a, y), pos2(x0 + b, y + LINE_H)), 0.0, th.selection);
        }
        let caret_x = marks.caret.filter(|c| (ls..=le).contains(c)).map(|c| x0 + x_at(c - ls));
        text_painter.galley(pos2(x0, y + (LINE_H - galley.size().y) / 2.0), galley, th.foreground);
        if let Some(x) = caret_x {
            text_painter.vline(x, y..=y + LINE_H, Stroke::new(2.0_f32, th.caret));
        }
    }
}

/// Display column of char column `col`: tabs are shown as 4 spaces.
fn display_col(text: &str, col: usize) -> usize {
    text.chars().take(col).map(|c| if c == '\t' { 4 } else { 1 }).sum()
}

fn line_job(text: &str, spans: &[Span], m: &Metrics, th: &EditorTheme) -> LayoutJob {
    let mut job = LayoutJob { break_on_newline: false, ..Default::default() };
    let cut = text.char_indices().nth(MAX_COLS).map_or(text.len(), |(i, _)| i);
    let text = &text[..cut];
    let push = |job: &mut LayoutJob, s: &str, kind: HlKind| {
        if s.is_empty() {
            return;
        }
        let fmt = TextFormat { font_id: m.font.clone(), color: th.color(kind), ..Default::default() };
        if s.contains('\t') {
            job.append(&s.replace('\t', "    "), 0.0, fmt);
        } else {
            job.append(s, 0.0, fmt);
        }
    };
    let mut at = 0usize;
    for sp in spans {
        let (s, e) = (sp.start as usize, (sp.end as usize).min(text.len()));
        if s < at || s >= e || !text.is_char_boundary(s) || !text.is_char_boundary(e) {
            continue;
        }
        push(&mut job, &text[at..s], HlKind::None);
        push(&mut job, &text[s..e], sp.kind);
        at = e;
    }
    push(&mut job, &text[at..], HlKind::None);
    job
}

fn draw_ribbons(painter: &egui::Painter, rect: Rect, m: &Model, top_old: f64, top_new: f64) {
    let y_old = |l: usize| rect.min.y + ((l as f64 - top_old) as f32) * LINE_H;
    let y_new = |l: usize| rect.min.y + ((l as f64 - top_new) as f32) * LINE_H;
    let (x0, x1) = (rect.min.x, rect.max.x);
    for h in &m.diff.hunks {
        let (a0, a1) = (y_old(h.old_lines.start), y_old(h.old_lines.end));
        let (b0, b1) = (y_new(h.new_lines.start), y_new(h.new_lines.end));
        if a1.max(b1) < rect.min.y - 2.0 || a0.min(b0) > rect.max.y + 2.0 {
            continue;
        }
        let kind = HunkKind::of(h);
        // Smoothstep curves between the sides; a mesh because the band is not convex.
        let steps = 16;
        let mut mesh = Mesh::default();
        let mut top_pts = Vec::with_capacity(steps + 1);
        let mut bot_pts = Vec::with_capacity(steps + 1);
        for i in 0..=steps {
            let f = i as f32 / steps as f32;
            let s = f * f * (3.0 - 2.0 * f);
            let x = x0 + (x1 - x0) * f;
            let yt = a0 + (b0 - a0) * s;
            let yb = (a1 + (b1 - a1) * s).max(yt + 0.01);
            top_pts.push(pos2(x, yt));
            bot_pts.push(pos2(x, yb));
            mesh.colored_vertex(pos2(x, yt), kind.bg());
            mesh.colored_vertex(pos2(x, yb), kind.bg());
            if i > 0 {
                let k = (i as u32) * 2;
                mesh.add_triangle(k - 2, k - 1, k);
                mesh.add_triangle(k - 1, k, k + 1);
            }
        }
        painter.add(Shape::mesh(mesh));
        painter.add(Shape::line(top_pts, Stroke::new(1.0_f32, kind.edge())));
        painter.add(Shape::line(bot_pts, Stroke::new(1.0_f32, kind.edge())));
    }
}

#[allow(clippy::too_many_arguments)]
fn draw_scrollbar(painter: &egui::Painter, bar: Rect, m: &Model, t: f64, max_t: f64, thumb_h: f32, thumb_range: f32, active: bool) {
    painter.rect_filled(bar, 0.0, theme::T.scrollbar_track);
    let total = m.total.max(1.0);
    // Change markers along the track, like IDEA's error stripe.
    for (hi, h) in m.diff.hunks.iter().enumerate() {
        let v = m.hunk_v0(hi);
        let len = h.old_lines.len().max(h.new_lines.len()).max(1) as f64;
        let y0 = bar.min.y + (v / total) as f32 * bar.height();
        let y1 = (bar.min.y + ((v + len) / total) as f32 * bar.height()).max(y0 + 2.0);
        painter.rect_filled(Rect::from_min_max(pos2(bar.min.x + 3.0, y0), pos2(bar.max.x - 3.0, y1)), 0.0, HunkKind::of(h).edge());
    }
    let thumb_y = bar.min.y + (t / max_t.max(1.0)) as f32 * thumb_range;
    let thumb = Rect::from_min_size(pos2(bar.min.x + 1.0, thumb_y), vec2(bar.width() - 2.0, thumb_h));
    let c = if active { theme::T.scrollbar_thumb_active } else { theme::T.scrollbar_thumb };
    painter.rect_filled(thumb, 3.0, c);
}


// ---------------------------------------------------------------------------------------------
// Opening and loading.

fn rel_and_abs(repo: &Repo, path: &Path) -> (PathBuf, PathBuf) {
    let workdir = repo.workdir();
    if path.is_absolute() {
        // Callers pass canonical paths (editor tabs, the change list, the workdir join), so
        // no canonicalize here: it would touch the disk on the UI thread.
        let rel = path.strip_prefix(workdir).map(Path::to_path_buf).unwrap_or_else(|_| path.to_path_buf());
        (rel, path.to_path_buf())
    } else {
        (path.to_path_buf(), workdir.join(path))
    }
}

/// Opens (or focuses) a diff tab: HEAD vs the working tree for `path`.
pub fn open_worktree_diff(state: &mut AppState, path: &Path) {
    let Some(repo) = state.ws.git.repo.clone() else { return };
    let (rel, abs) = rel_and_abs(&repo, path);
    open(state, Source::Worktree { abs, rel });
}

/// True when the active tab is a HEAD vs working tree diff, the kind the Commit window opens.
pub fn active_is_worktree_diff(state: &mut AppState) -> bool {
    let Some(id) = state.ws.tabs.active else { return false };
    match state.ws.tabs.get_mut(id).map(|t| &mut t.content) {
        Some(crate::tabs::TabContent::Custom(c)) => c.as_any_mut().downcast_ref::<DiffTab>().is_some_and(|d| matches!(d.source, Source::Worktree { .. })),
        _ => false,
    }
}

/// Shows the working tree diff of `path` in the active worktree diff tab, like IDEA's preview
/// diff: the tab keeps its place in the strip and no new tab opens. A diff of `path` that is
/// already open elsewhere is activated instead, so one file never has two tabs.
pub fn show_in_active_worktree_diff(state: &mut AppState, path: &Path) {
    let Some(repo) = state.ws.git.repo.clone() else { return };
    if !active_is_worktree_diff(state) {
        return;
    }
    let Some(id) = state.ws.tabs.active else { return };
    let (rel, abs) = rel_and_abs(&repo, path);
    let tab = DiffTab::new(Source::Worktree { abs, rel });
    let key = tab.key.clone();
    if let Some(open) = state.ws.tabs.custom_by_key(&key) {
        state.ws.tabs.activate(open);
        return;
    }
    let AppState { ws, jobs, .. } = state;
    if let Some(t) = ws.tabs.get_mut(id) {
        // The replaced diff's unsaved edits go to disk first.
        if let TabContent::Custom(c) = &mut t.content {
            if let Some(old) = c.as_any_mut().downcast_mut::<DiffTab>() {
                save_hidden(jobs, old, true);
            }
        }
        t.content = TabContent::Custom(Box::new(tab));
    }
    reload(state, &key);
}

/// Opens (or focuses) a diff tab for `path` as changed by commit `oid` (parent vs commit).
pub fn open_commit_diff(state: &mut AppState, oid: ide_git::Oid, path: &Path) {
    let Some(repo) = state.ws.git.repo.clone() else { return };
    let (rel, abs) = rel_and_abs(&repo, path);
    open(state, Source::Commit { oid, rel, abs });
}

/// Opens a diff tab for `path` over several log commits: before the oldest one that changes
/// it vs after the newest one. One commit is `open_commit_diff`.
pub fn open_commits_diff(state: &mut AppState, oids: &[ide_git::Oid], path: &Path) {
    if let [one] = oids {
        return open_commit_diff(state, *one, path);
    }
    let Some(repo) = state.ws.git.repo.clone() else { return };
    let (rel, abs) = rel_and_abs(&repo, path);
    open(state, Source::Commits { oids: oids.to_vec(), rel, abs });
}

/// Opens a diff tab: `path` at revision `rev` vs the file on disk (Compare with Local).
pub fn open_rev_local_diff(state: &mut AppState, rev: &str, path: &Path) {
    let Some(repo) = state.ws.git.repo.clone() else { return };
    let (rel, abs) = rel_and_abs(&repo, path);
    open(state, Source::RevLocal { rev: rev.to_string(), rel, abs });
}

fn open(state: &mut AppState, source: Source) {
    let tab = DiffTab::new(source.clone());
    let key = tab.key.clone();
    if state.ws.tabs.custom_by_key(&key).is_some() {
        state.ws.tabs.open_custom(Box::new(tab));
        reload(state, &key);
        return;
    }
    state.ws.tabs.open_custom(Box::new(tab));
    reload(state, &key);
}

/// The live document of an editable diff: the file's editor tab, else the diff's hidden one.
fn live_snapshot(state: &mut AppState, key: &str) -> Option<(DocRef, u64, TextSnapshot)> {
    let tab = state.ws.tabs.custom_mut::<DiffTab>(key)?;
    if !tab.editable_source() {
        return None;
    }
    let abs = tab.abs().to_path_buf();
    let hidden = tab.live.hidden.as_ref().map(|h| (DocRef::Hidden(tab.live.hidden_gen), h.version(), h.text_snapshot()));
    match state.ws.tabs.editor_by_path(&abs).and_then(|id| state.ws.tabs.editor_mut(id).map(|e| (id, e))) {
        Some((id, e)) if !e.read_only => Some((DocRef::Tab(id), e.doc.version(), e.doc.text_snapshot())),
        _ => hidden,
    }
}

/// The file's bytes for a clean hidden document: (hidden generation, doc version, bytes).
type DiskRead = (u64, u64, Vec<u8>);

fn reload(state: &mut AppState, key: &str) {
    let Some(repo) = state.ws.git.repo.clone() else { return };
    let Some(tab) = state.ws.tabs.custom_mut::<DiffTab>(key) else { return };
    if tab.reloading {
        tab.reload_pending = true;
        return;
    }
    tab.reloading = true;
    let source = tab.source.clone();
    let prev_texts = tab.model().map(|m| (m.diff.old_text.clone(), m.new_text.clone()));
    // A clean hidden document follows the disk like an editor tab (the watcher's reload).
    let reread = tab.live.hidden.as_ref().filter(|h| !h.is_dirty()).map(|h| (tab.live.hidden_gen, h.version(), tab.abs().to_path_buf()));
    let live = live_snapshot(state, key);
    let live_ref = live.as_ref().map(|(r, v, _)| (*r, *v));
    let key = key.to_string();
    let label = format!("Loading diff of {}", name_of(match &source {
        Source::Worktree { rel, .. } | Source::Commit { rel, .. } | Source::Commits { rel, .. } | Source::RevLocal { rel, .. } => rel,
    }));
    state.jobs.spawn(
        label,
        move || {
            let diff = match &source {
                Source::Worktree { rel, .. } => repo.diff_file(rel, DiffSide::HeadVsWorktree),
                Source::Commit { oid, rel, .. } => repo.diff_commit_file(oid, rel),
                Source::Commits { oids, rel, .. } => repo.diff_commits_file(oids, rel),
                Source::RevLocal { rev, rel, .. } => repo.diff_with_working_tree_file(rev, rel),
            };
            let disk = reread.and_then(|(gen, version, path)| std::fs::read(path).ok().map(|b| (gen, version, b)));
            match diff {
                Ok(d) => {
                    // The working-tree side shows the document the user edits, as the file holds it.
                    let buffer = live.map(|(_, _, snap)| snap.file_text());
                    let new_text = buffer.as_ref().unwrap_or(&d.new_text);
                    if prev_texts.as_ref().is_some_and(|(o, n)| *o == d.old_text && n == new_text) {
                        return Ok((None, disk));
                    }
                    Ok((Some(Model::build(d, buffer)), disk))
                }
                Err(e) => Err(e.to_string()),
            }
        },
        move |state, res: Result<(Option<Model>, Option<DiskRead>), String>| {
            let Some(tab) = state.ws.tabs.custom_mut::<DiffTab>(&key) else { return };
            tab.reloading = false;
            match res {
                Ok((model, disk)) => {
                    if let Some(m) = model {
                        tab.set_model(m);
                    }
                    if live_ref.is_some() {
                        tab.live.computed = live_ref;
                    }
                    if let Some((gen, version, bytes)) = disk {
                        if let Some(h) = tab.live.hidden.as_mut().filter(|h| tab.live.hidden_gen == gen && h.version() == version && !h.is_dirty()) {
                            h.reload_from_bytes(&bytes);
                        }
                    }
                }
                Err(e) => {
                    if !matches!(tab.load, Load::Ready(_)) {
                        tab.load = Load::Failed(e);
                    }
                }
            }
            if std::mem::take(&mut tab.reload_pending) {
                reload(state, &key);
            }
        },
    );
}

/// Recomputes the hunks on a worker when the live document is not the one they came from.
/// At most one relayout runs; the next frame starts another if the text moved on meanwhile.
fn relayout_if_changed(tab: &mut DiffTab, jobs: &Jobs, doc_ref: DocRef, doc: &Document) {
    let now = (doc_ref, doc.version());
    if tab.live.computed == Some(now) || tab.live.relayout_running || tab.reloading {
        return;
    }
    let Some(m) = tab.model() else { return };
    let (old, old_lines, new_lines) = (m.old_shared.clone(), m.old.lines, doc_lines(doc));
    let snap = doc.text_snapshot();
    tab.live.computed = Some(now);
    tab.live.relayout_running = true;
    let (key, gen) = (tab.key.clone(), tab.model_gen);
    jobs.spawn_quiet(
        move || Relayout::compute(&old, snap, old_lines, new_lines),
        move |state, r| {
            let Some(tab) = state.ws.tabs.custom_mut::<DiffTab>(&key) else { return };
            tab.live.relayout_running = false;
            // A reload replaced the model meanwhile (a commit may have changed the old side).
            if tab.model_gen != gen {
                tab.live.computed = None;
                return;
            }
            if let Load::Ready(m) = &mut tab.load {
                m.apply(r);
                if tab.current.is_some_and(|c| c >= m.diff.hunks.len()) {
                    tab.current = None;
                }
            }
        },
    );
}

/// Loads the working-tree file into a hidden document, for a diff whose file has no editor tab.
fn load_hidden(jobs: &Jobs, tab: &mut DiffTab) {
    tab.live.loading = true;
    let (path, key) = (tab.abs().to_path_buf(), tab.key.clone());
    jobs.spawn_quiet(
        {
            let path = path.clone();
            move || Document::open(&path).map_err(|e| e.to_string())
        },
        move |state, res| {
            let has_tab = state.ws.tabs.editor_by_path(&path).is_some();
            let Some(tab) = state.ws.tabs.custom_mut::<DiffTab>(&key) else { return };
            tab.live.loading = false;
            match res {
                Ok(doc) if !has_tab && tab.live.hidden.is_none() => {
                    tab.live.hidden = Some(doc);
                    tab.live.hidden_gen += 1;
                }
                Ok(_) => {}
                Err(_) => tab.live.load_failed = true,
            }
        },
    );
}

/// Writes the hidden document's unsaved edits on a worker. A write that is already running
/// makes this one wait for the next tick, unless `now` (the diff closes).
fn save_hidden(jobs: &Jobs, tab: &mut DiffTab, now: bool) {
    tab.live.edited_at = None;
    let Some(h) = tab.live.hidden.as_mut() else { return };
    if !h.is_dirty() {
        return;
    }
    if tab.live.saving && !now {
        tab.live.edited_at = Some(Instant::now());
        return;
    }
    tab.live.saving = true;
    let (text, token) = h.save_snapshot();
    let (path, key, gen) = (tab.abs().to_path_buf(), tab.key.clone(), tab.live.hidden_gen);
    jobs.spawn_quiet(
        move || std::fs::write(&path, text).map(|()| path.clone()).map_err(|e| format!("{}: {e}", path.display())),
        move |state, res| {
            if let Some(tab) = state.ws.tabs.custom_mut::<DiffTab>(&key) {
                tab.live.saving = false;
                if let (Ok(_), Some(h), true) = (&res, tab.live.hidden.as_mut(), tab.live.hidden_gen == gen) {
                    h.mark_saved(token);
                }
            }
            match res {
                // No watcher in tests, and the watcher is slow: refresh status and gutters now.
                Ok(path) => state.on_fs_batch(crate::watcher::FsBatch { paths: std::iter::once(path).collect(), structure_changed: false, git_changed: false }),
                Err(e) => state.notifications.error("Save failed", e),
            }
        },
    );
}

/// Saves the hidden documents whose last edit rested `SAVE_DEBOUNCE`. Runs every frame, so a
/// pending save lands while the diff is not drawn.
pub fn tick(state: &mut AppState) {
    let AppState { ws, jobs, ctx, .. } = state;
    let mut wake: Option<Duration> = None;
    for t in ws.tabs.list.iter_mut() {
        let TabContent::Custom(c) = &mut t.content else { continue };
        let Some(d) = c.as_any_mut().downcast_mut::<DiffTab>() else { continue };
        let Some(at) = d.live.edited_at else { continue };
        let rest = at.elapsed();
        if rest >= SAVE_DEBOUNCE {
            save_hidden(jobs, d, false);
        } else {
            let left = SAVE_DEBOUNCE - rest;
            wake = Some(wake.map_or(left, |w| w.min(left)));
        }
    }
    if let Some(w) = wake {
        ctx.request_repaint_after(w);
    }
}

/// Save All: writes every diff's unsaved hidden document now.
pub fn save_hidden_all(state: &mut AppState) {
    let AppState { ws, jobs, .. } = state;
    for t in ws.tabs.list.iter_mut() {
        if let TabContent::Custom(c) = &mut t.content {
            if let Some(d) = c.as_any_mut().downcast_mut::<DiffTab>() {
                save_hidden(jobs, d, false);
            }
        }
    }
}

/// An editor tab opens for `path`: it takes over a diff's unsaved hidden document, so the
/// edits and their undo history stay one buffer. A clean hidden document is dropped; the tab's
/// fresh read wins.
pub fn adopt_hidden(state: &mut AppState, path: &Path) -> Option<Document> {
    let mut found = None;
    for t in state.ws.tabs.list.iter_mut() {
        let TabContent::Custom(c) = &mut t.content else { continue };
        let Some(d) = c.as_any_mut().downcast_mut::<DiffTab>() else { continue };
        if !d.editable_source() || d.abs() != path {
            continue;
        }
        let Some(h) = d.live.hidden.take() else { continue };
        d.live.hidden_gen += 1;
        d.live.edited_at = None;
        if h.is_dirty() && found.is_none() {
            found = Some(h);
        }
    }
    found
}

/// Cmd+S in an editable diff: saves the file's editor tab, or the hidden document. Returns
/// false when the active tab is no such diff.
pub fn save_active(state: &mut AppState) -> bool {
    let Some(id) = state.ws.tabs.active else { return false };
    let abs = match state.ws.tabs.get_mut(id).map(|t| &mut t.content) {
        Some(TabContent::Custom(c)) => match c.as_any_mut().downcast_mut::<DiffTab>() {
            Some(d) if d.editable_source() => d.abs().to_path_buf(),
            _ => return false,
        },
        _ => return false,
    };
    if let Some(editor) = state.ws.tabs.editor_by_path(&abs) {
        state.save_tab(editor, false);
        return true;
    }
    let AppState { ws, jobs, .. } = state;
    if let Some(TabContent::Custom(c)) = ws.tabs.get_mut(id).map(|t| &mut t.content) {
        if let Some(d) = c.as_any_mut().downcast_mut::<DiffTab>() {
            save_hidden(jobs, d, false);
        }
    }
    true
}

/// Worktree diffs follow the file: every status refresh (after saves and external edits)
/// re-reads them. Unchanged texts are detected on the worker and cost no UI work.
pub fn on_git_refreshed(state: &mut AppState) {
    let keys: Vec<String> = state
        .ws.tabs
        .list
        .iter_mut()
        .filter_map(|t| match &mut t.content {
            TabContent::Custom(c) => c.as_any_mut().downcast_mut::<DiffTab>().filter(|d| matches!(d.source, Source::Worktree { .. } | Source::RevLocal { .. })).map(|d| d.key.clone()),
            _ => None,
        })
        .collect();
    for key in keys {
        reload(state, &key);
    }
}

/// Test hook: presses F7 `n` times on the active diff tab and logs where it landed.
pub fn test_next(state: &mut AppState, n: usize) {
    let Some(id) = state.ws.tabs.active else { return };
    let Some(TabContent::Custom(c)) = state.ws.tabs.get_mut(id).map(|t| &mut t.content) else { return };
    let Some(tab) = c.as_any_mut().downcast_mut::<DiffTab>() else { return };
    for _ in 0..n {
        tab.step(true);
    }
    match &tab.load {
        Load::Ready(_) => {}
        _ => eprintln!("[test] diff {}: not loaded", tab.rel().display()),
    }
    if let Some(m) = tab.model() {
        eprintln!("[test] diff {}: {} hunks, {} / {} lines, current {:?}, t {:.1}, view {:.1}, hunk starts {:?}", tab.rel().display(), m.diff.hunks.len(), m.old.lines, m.new.lines, tab.current, tab.t, tab.view_lines, (0..m.diff.hunks.len()).map(|h| m.hunk_v0(h)).collect::<Vec<_>>());
    }
}
