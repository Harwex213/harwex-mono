use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::ops::Range;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use egui::text::{LayoutJob, LayoutSection};
use egui::{
    Align, Align2, Button, CursorIcon, Event, EventFilter, FontId, Galley, Id, Key,
    Layout, Modifiers, Pos2, Rect, ScrollArea, Sense, Stroke, TextFormat, Ui, UiBuilder, Vec2,
    ViewportCommand,
};

use crate::carets::{self, Carets};
use crate::document::{Document, EditKind, Position, Selection};
use crate::editing::{self, col_from_display, display_col};
use crate::find::{FindState, MAX_MATCHES};
use crate::find_bar::{self, BarCmd, BarEnv, BarIds, HISTORY_LEN};
use crate::search::{FindOptions, Matcher};
use crate::highlight::{HlKind, Span};
use crate::theme::EditorTheme;

/// Extra per-line marks drawn in the gutter (git change bars).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum GutterMark {
    Added,
    Modified,
    /// Lines were deleted just above this line.
    Deleted,
}

/// How a problem is drawn: a red, orange or grey wave, or a grey dotted line for unused code
/// and hints.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum ProblemSeverity {
    Error,
    Warning,
    /// IDEA's "weak warning" (LSP information).
    Weak,
    /// Unused code and hints.
    Unused,
}

impl ProblemSeverity {
    pub const ALL: [ProblemSeverity; 4] = [ProblemSeverity::Error, ProblemSeverity::Warning, ProblemSeverity::Weak, ProblemSeverity::Unused];
}

/// A problem underline in char indices of the current text. The app keeps the list sorted by
/// `start` and shifts it through edits.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct ProblemMark {
    pub start: usize,
    pub end: usize,
    pub severity: ProblemSeverity,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EditorAction {
    /// Context menu, Cmd+B, Cmd+click.
    GoToDeclaration(Position),
    /// Context menu "Go to Source Definition" (real .js in node_modules).
    GoToSourceDefinition(Position),
    /// Context menu, Cmd+Shift+B.
    GoToTypeDefinition(Position),
    /// Context menu, Alt+F7.
    FindUsages(Position),
    /// Context menu "Git > Annotate with Git Blame".
    GitAnnotate,
    /// Context menu "Git > Show History".
    GitShowHistory,
    /// Context menu "Git > Rollback Lines" (only if lines changed).
    GitRollbackLines,
}

pub struct EditorResponse {
    pub changed: bool,
    /// Set when the user picked an item in the editor context menu or used its shortcut.
    pub action: Option<EditorAction>,
    /// The document position under the mouse, for hover info.
    pub hover: Option<Position>,
    /// A click on the line number / change bar column, with the line it hit.
    pub gutter_clicked: Option<usize>,
    /// A click on the annotation (blame) column, with the line it hit.
    pub annotation_clicked: Option<usize>,
    /// Caret position after this frame, for the status bar.
    pub cursor: Position,
    pub has_focus: bool,
    /// The text area's response; lets the app attach tooltips or its own popups.
    pub response: egui::Response,
}

struct HighlightCache {
    version: (u64, u64),
    lines: Range<usize>,
    spans: Vec<Vec<Span>>,
}

static NEXT_STATE_ID: AtomicU64 = AtomicU64::new(1);

/// Per-tab view state: carets, scroll and render caches.
pub struct EditorState {
    id: u64,
    carets: Carets,
    /// Display column per caret that Up/Down try to keep, so moving through a short line does not
    /// lose it. Empty when no vertical move ran last.
    preferred_cols: Vec<usize>,
    /// Alt+Shift+drag or middle drag: the anchor line and display column of the column selection.
    column_drag: Option<(usize, f32)>,
    /// Alt pressed twice and held: Up and Down clone the caret (IDEA's Clone Caret Above/Below).
    alt_tap: AltTap,
    /// The selections Ctrl+G added, in order, so Ctrl+Shift+G removes the last one.
    occurrences: Vec<Selection>,
    /// The Ctrl+G run started from a word under the caret, so it matches whole words only.
    occurrence_words: bool,
    /// Select All Occurrences waits for the find bar's search to finish.
    select_all_pending: bool,
    /// Scrollbar marks of the carets: the key they were built for and their y fractions.
    caret_marks: (u64, Vec<f32>),
    scroll: Vec2,
    /// The scroll offset the text was drawn with last frame. The scroll area reports its offset
    /// after this frame's wheel input, so during a scroll `scroll` is already one step ahead of
    /// the pixels on screen. Hit tests and the gutter use this one.
    drawn_scroll: Vec2,
    viewport: Vec2,
    pending_reveal: Option<Position>,
    pending_selection: Option<(Position, Position)>,
    pending_focus: bool,
    dragging: bool,
    /// What the running drag extends by.
    drag_unit: DragUnit,
    /// The presses of the running multi-click.
    click_chain: ClickChain,
    menu_pos: Position,
    cursor_pos: Position,
    highlight: Option<HighlightCache>,
    /// Line galleys keyed by a hash of their text, spans and style. Keying by content instead of
    /// line number keeps entries valid when lines above are inserted or deleted.
    galleys: HashMap<u64, (Arc<Galley>, u64)>,
    frame: u64,
    geometry: Option<EditorGeometry>,
    /// Measured column advance, keyed by (font size, pixels per point).
    advance: Option<(u32, u32, f32)>,
    /// The galleys drawn last frame, for hit-testing this frame's pointer input against the
    /// glyphs the user actually sees. The vector is reused across frames.
    drawn: Vec<DrawnLine>,
    find: FindState,
    /// A match to scroll into view on the next frame.
    find_scroll: Option<Range<usize>>,
    /// Scrollbar marks of the matches: the key they were built for and their y fractions.
    find_marks: (u64, Vec<f32>),
    /// Scrollbar marks of the problems, per severity, with the key they were built for.
    problem_marks: (u64, Vec<(ProblemSeverity, f32)>),
}

#[derive(Clone, Copy)]
struct AltTap {
    held: bool,
    last_press: f64,
    armed: bool,
}

impl Default for AltTap {
    fn default() -> Self {
        AltTap { held: false, last_press: f64::NEG_INFINITY, armed: false }
    }
}

/// A drag after a single press extends by chars, after a double press by words, after a triple
/// press by lines. Word and Line hold the range the chain selected on its last press.
#[derive(Clone, Debug)]
enum DragUnit {
    Char,
    Word(Range<usize>),
    Line(Range<usize>),
}

/// The presses of one multi-click (IDEA's model): each press within the double-click interval
/// of the one before and near it. egui's own click count is not used: it counts on release,
/// ignores the position and calls a click "triple" up to twice the interval after the first.
/// The app counts the double clicks of all its widgets with it too (`clicks.rs`).
#[derive(Clone, Copy, Debug)]
pub struct ClickChain {
    count: u32,
    time: f64,
    pos: Pos2,
}

impl Default for ClickChain {
    fn default() -> Self {
        ClickChain { count: 0, time: f64::NEG_INFINITY, pos: Pos2::ZERO }
    }
}

impl ClickChain {
    /// Counts a plain press at `pos` and returns its place in the chain (1, 2, 3, ...).
    pub fn press(&mut self, time: f64, pos: Pos2, delay: f64, max_dist: f32) -> u32 {
        let goes_on = self.count > 0 && time - self.time <= delay && self.pos.distance(pos) <= max_dist;
        self.count = if goes_on { self.count + 1 } else { 1 };
        self.time = time;
        self.pos = pos;
        self.count
    }

    /// A modified press (Shift, Alt, Cmd, middle) ends the chain.
    pub fn reset(&mut self) {
        *self = ClickChain::default();
    }
}

/// The longest distance between two presses of one multi-click, in points.
pub const CHAIN_DIST: f32 = 6.0;

/// The longest pause between the two Alt presses of a double tap.
const ALT_DOUBLE_TAP: f64 = 0.4;

/// The last search of the session, shared by every tab through egui's memory. A bar opened
/// without a selection starts from it, like IDEA.
#[derive(Clone, Default)]
struct LastFind {
    query: String,
    opts: FindOptions,
}

/// Past replacements of the session, newest first, shared by every tab.
#[derive(Clone, Default)]
struct ReplaceHistory(Vec<String>);

fn session_id() -> Id {
    Id::new("ide-editor-find-session")
}

/// One line as drawn last frame.
struct DrawnLine {
    line: usize,
    /// First display column in the galley (non-zero for windows of very long lines).
    window_start: usize,
    galley: Arc<Galley>,
}

/// Where the last frame put things on screen. Tests aim pointer events with it; a popup can
/// anchor at a character.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EditorGeometry {
    pub text_rect: Rect,
    pub gutter_rect: Rect,
    /// Screen position of line 0, display column 0 (scroll applied).
    pub origin: Pos2,
    pub char_w: f32,
    pub line_h: f32,
    /// Width of the annotation (blame) column at the left of the gutter; 0 when hidden.
    pub annotation_w: f32,
    /// Left edge of the change-mark bars.
    pub mark_x: f32,
    /// Pixels per point the rows were snapped with.
    pub ppp: f32,
}

impl EditorGeometry {
    /// Center of the character cell at `pos` (tabs expanded like the renderer does).
    pub fn char_center(&self, doc: &Document, pos: Position) -> Pos2 {
        let col = display_col(&doc.line(pos.line), pos.column) as f32;
        Pos2::new(self.origin.x + (col + 0.5) * self.char_w, self.row_center(pos.line))
    }

    /// Screen y of the top of `line`'s row, as drawn.
    pub fn row_top(&self, line: usize) -> f32 {
        row_top(self.origin.y, self.line_h, self.ppp, line as isize)
    }

    /// The line whose drawn row holds `y`. Negative above line 0; past the end is not clamped.
    pub fn line_at(&self, y: f32) -> isize {
        line_at_y(self.origin.y, self.line_h, self.ppp, y)
    }

    fn row_center(&self, line: usize) -> f32 {
        (self.row_top(line) + self.row_top(line + 1)) / 2.0
    }

    /// A point on the change-mark bar of `line`.
    pub fn mark_center(&self, line: usize) -> Pos2 {
        Pos2::new(self.mark_x + MARK_W / 2.0, self.row_center(line))
    }

    /// A point inside the annotation column of `line`.
    pub fn annotation_center(&self, line: usize) -> Pos2 {
        Pos2::new(self.gutter_rect.min.x + self.annotation_w / 2.0, self.row_center(line))
    }
}

impl Default for EditorState {
    fn default() -> Self {
        EditorState::new()
    }
}

impl EditorState {
    pub fn new() -> EditorState {
        EditorState {
            id: NEXT_STATE_ID.fetch_add(1, Ordering::Relaxed),
            carets: Carets::default(),
            preferred_cols: Vec::new(),
            column_drag: None,
            alt_tap: AltTap::default(),
            occurrences: Vec::new(),
            occurrence_words: false,
            select_all_pending: false,
            caret_marks: (0, Vec::new()),
            scroll: Vec2::ZERO,
            drawn_scroll: Vec2::ZERO,
            viewport: Vec2::new(800.0, 600.0),
            pending_reveal: None,
            pending_selection: None,
            pending_focus: false,
            dragging: false,
            drag_unit: DragUnit::Char,
            click_chain: ClickChain::default(),
            menu_pos: Position::default(),
            cursor_pos: Position::default(),
            highlight: None,
            galleys: HashMap::new(),
            frame: 0,
            geometry: None,
            advance: None,
            drawn: Vec::new(),
            find: FindState::default(),
            find_scroll: None,
            find_marks: (0, Vec::new()),
            problem_marks: (0, Vec::new()),
        }
    }

    fn editor_id(&self) -> Id {
        Id::new(("ide-editor", self.id))
    }

    /// True when the keyboard focus is on this editor or its find bar.
    pub fn owns_focus(&self, ctx: &egui::Context) -> bool {
        let ids = BarIds::new(self.editor_id());
        ctx.memory(|m| m.focused()).is_some_and(|f| f == self.editor_id() || f == ids.query || f == ids.replace)
    }

    pub fn find(&self) -> &FindState {
        &self.find
    }

    pub fn find_mut(&mut self) -> &mut FindState {
        &mut self.find
    }

    /// Cmd+F (`replace == false`) and Cmd+R: opens the find bar and focuses the query.
    pub fn open_find(&mut self, doc: &Document, replace: bool) {
        self.find.open(doc, self.carets.primary(), replace);
    }

    /// Like `open_find`, with the selection set first (tests and callers without a frame in
    /// between).
    pub fn open_find_with_selection(&mut self, doc: &Document, sel: Selection, replace: bool) {
        let len = doc.len_chars();
        self.carets = Carets::single(Selection::new(sel.anchor.min(len), sel.head.min(len)));
        self.find.open(doc, self.carets.primary(), replace);
    }

    /// Esc: closes the bar and gives the focus back to the text.
    pub fn close_find(&mut self) {
        self.find.close();
        self.pending_focus = true;
    }

    /// Cmd+G, Enter: the next match. Works with the bar closed, with the last query.
    pub fn find_next(&mut self) {
        if self.find.query().is_empty() {
            self.find.seed = true;
        }
        self.find.go_next(self.carets.primary());
    }

    /// Shift+Cmd+G, Shift+Enter: the previous match.
    pub fn find_previous(&mut self) {
        if self.find.query().is_empty() {
            self.find.seed = true;
        }
        self.find.go_prev(self.carets.primary());
    }

    /// Replaces the current match and selects the next one.
    pub fn find_replace(&mut self, doc: &mut Document) {
        self.find.sync_selection(self.carets.primary());
        if let Some(sel) = self.find.replace(doc, self.carets.primary()) {
            self.carets = Carets::single(sel);
        }
        self.apply_find_reveal();
    }

    /// Replaces every match that is not excluded, as one undo step.
    pub fn find_replace_all(&mut self, doc: &mut Document) {
        if let Some(sel) = self.find.replace_all(doc, self.carets.primary()) {
            self.carets = Carets::single(sel);
        }
    }

    /// Excludes the current match from Replace and the counter, and moves on.
    pub fn find_exclude(&mut self, doc: &mut Document) {
        self.find.sync_selection(self.carets.primary());
        self.find.exclude(self.carets.primary());
        self.find.refresh(doc, false);
        self.apply_find_reveal();
    }

    /// Brings the matches up to date (blocking on a worker when `block`) and applies the
    /// navigation that resolved. The view does this every frame; tests call it directly.
    pub fn find_refresh(&mut self, doc: &mut Document, block: bool) {
        self.find.sync_selection(self.carets.primary());
        self.find.refresh(doc, block);
        self.apply_find_reveal();
        if self.select_all_pending && self.find.is_fresh(doc) {
            self.select_all_pending = false;
            self.select_find_matches();
        }
    }

    /// Selects the match the find state wants revealed and returns it for scrolling. With In
    /// Selection on, the selection stays and only the view moves.
    fn apply_find_reveal(&mut self) -> Option<Range<usize>> {
        let r = self.find.reveal.take()?;
        if !self.find.in_selection() {
            self.carets = Carets::single(Selection::new(r.start, r.end));
            self.preferred_cols.clear();
        }
        self.find_scroll = Some(r.clone());
        Some(r)
    }

    /// Screen geometry of the last frame; `None` before the first frame.
    pub fn geometry(&self) -> Option<EditorGeometry> {
        self.geometry
    }

    /// Move the cursor and scroll it to the center.
    pub fn reveal(&mut self, pos: Position) {
        self.pending_reveal = Some(pos);
        self.pending_selection = None;
    }

    /// Caret position as of the last frame.
    pub fn cursor(&self) -> Position {
        self.cursor_pos
    }

    /// Raw selection of the primary caret in char indices, as of the last frame.
    pub fn selection(&self) -> Selection {
        self.carets.primary()
    }

    /// Every caret and selection, sorted by position.
    pub fn carets(&self) -> &Carets {
        &self.carets
    }

    /// Replaces every caret (tests, scripted edits). Out-of-range selections are clamped on
    /// the next frame.
    pub fn set_carets(&mut self, carets: Carets) {
        self.carets = carets;
        self.preferred_cols.clear();
        self.occurrences.clear();
    }

    /// Ctrl+G (IDEA's Add Selection for Next Occurrence). A bare caret selects its word first;
    /// then each press adds the next occurrence of the primary selection, wrapping at the end.
    pub fn add_next_occurrence(&mut self, doc: &Document) {
        let p = self.carets.primary();
        if p.is_empty() {
            let Some(w) = doc.word_at(doc.char_to_position(p.head)) else { return };
            let r = doc.position_to_char(w.start)..doc.position_to_char(w.end);
            self.carets.set_primary(Selection::new(r.start, r.end));
            self.occurrences = vec![self.carets.primary()];
            self.occurrence_words = true;
            self.preferred_cols.clear();
            return;
        }
        if self.occurrences.last() != Some(&p) {
            // A new run: the selection was made by hand.
            self.occurrences = vec![p];
            self.occurrence_words = false;
        }
        let query = doc.slice(p.range());
        let Some(matcher) = occurrence_matcher(&query, self.occurrence_words) else { return };
        let taken = |r: &Range<usize>| self.carets.all().iter().any(|s| s.range() == *r);
        let Some(r) = next_occurrence(doc, &matcher, p.end(), &taken) else { return };
        let sel = Selection::new(r.start, r.end);
        self.carets.push(sel);
        self.occurrences.push(sel);
        self.preferred_cols.clear();
        self.find_scroll = Some(r);
    }

    /// Ctrl+Shift+G: removes the occurrence Ctrl+G added last.
    pub fn remove_last_occurrence(&mut self) {
        if !self.carets.is_multi() {
            return;
        }
        let p = self.carets.primary();
        self.carets.remove(self.carets.primary_index());
        if self.occurrences.last() == Some(&p) {
            self.occurrences.pop();
        }
        // The primary goes back to the occurrence added before it.
        if let Some(prev) = self.occurrences.last() {
            if let Some(i) = self.carets.all().iter().position(|s| s == prev) {
                let mut v = self.carets.all().to_vec();
                let sel = v.remove(i);
                v.push(sel);
                let n = v.len();
                self.carets = Carets::from_vec(v, n - 1);
            }
        }
        self.preferred_cols.clear();
        self.find_scroll = Some(self.carets.primary().range());
    }

    /// Ctrl+Cmd+G (IDEA's Select All Occurrences). With the find bar open it selects every match
    /// of the query that is not excluded and closes the bar. Otherwise it selects every
    /// occurrence of the word under the caret or of the selection.
    pub fn select_all_occurrences(&mut self, doc: &mut Document) {
        self.pending_focus = true;
        if self.find.is_open() && !self.find.query().is_empty() {
            self.find.refresh(doc, false);
            if self.find.is_fresh(doc) {
                self.select_find_matches();
            } else {
                self.select_all_pending = true;
            }
            return;
        }
        let p = self.carets.primary();
        let (range, words) = if p.is_empty() {
            let Some(w) = doc.word_at(doc.char_to_position(p.head)) else { return };
            (doc.position_to_char(w.start)..doc.position_to_char(w.end), true)
        } else {
            (p.range(), false)
        };
        let query = doc.slice(range.clone());
        let Some(matcher) = occurrence_matcher(&query, words) else { return };
        let (found, _) = matcher.find(&doc.text(), 0, MAX_MATCHES);
        let primary = found.iter().position(|r| *r == range).unwrap_or(0);
        let sels = found.into_iter().map(|r| Selection::new(r.start, r.end)).collect();
        self.carets = Carets::from_vec(sels, primary);
        self.occurrences.clear();
        self.preferred_cols.clear();
    }

    fn select_find_matches(&mut self) {
        let caret = self.carets.primary().start();
        let sels: Vec<Selection> =
            self.find.matches().iter().filter(|m| !m.excluded).map(|m| Selection::new(m.range.start, m.range.end)).collect();
        if sels.is_empty() {
            return;
        }
        let primary = sels.iter().position(|s| s.start() >= caret).unwrap_or(0);
        self.carets = Carets::from_vec(sels, primary);
        self.occurrences.clear();
        self.preferred_cols.clear();
        self.close_find();
    }

    /// Double Alt + Up/Down (IDEA's Clone Caret Above/Below): a new primary caret one line
    /// above or below the primary, at the same display column.
    pub fn clone_caret(&mut self, doc: &Document, up: bool) {
        let p = self.carets.primary();
        let pos = doc.char_to_position(p.head);
        if (up && pos.line == 0) || (!up && pos.line + 1 >= doc.line_count()) {
            return;
        }
        let want = self.preferred_cols.get(self.carets.primary_index()).copied().unwrap_or_else(|| display_col(&doc.line(pos.line), pos.column));
        let to = editing::vertical(doc, p.head, if up { -1 } else { 1 }, want);
        self.carets.push(Selection::caret(to));
        // Every caret keeps the column, so the next clone lines up.
        self.preferred_cols = vec![want; self.carets.len()];
        self.find_scroll = Some(to..to);
    }

    /// Selects from `anchor` to `head` on the next frame, without scrolling.
    pub fn set_selection(&mut self, anchor: Position, head: Position) {
        self.pending_selection = Some((anchor, head));
    }

    /// Gives the editor keyboard focus on the next frame (e.g. after opening a tab).
    pub fn request_focus(&mut self) {
        self.pending_focus = true;
    }

    pub fn scroll_offset(&self) -> Vec2 {
        self.scroll
    }

    /// Drops render caches, e.g. after changing fonts.
    pub fn clear_caches(&mut self) {
        self.highlight = None;
        self.galleys.clear();
        self.advance = None;
        self.drawn.clear();
    }

    /// Moves the primary caret and drops the others (a plain click).
    fn set_head(&mut self, idx: usize, extend: bool) {
        let mut p = self.carets.primary();
        p.head = idx;
        if !extend {
            p.anchor = idx;
        }
        self.carets = Carets::single(p);
    }
}

pub struct EditorView<'a> {
    doc: &'a mut Document,
    state: &'a mut EditorState,
    marks: &'a [(usize, GutterMark)],
    annotations: &'a [String],
    problems: &'a [ProblemMark],
    theme: Option<&'a EditorTheme>,
    font_size: f32,
    read_only: bool,
}

const MARK_W: f32 = 5.0;
const TEXT_PAD: f32 = 6.0;
/// Lines longer than this (in display columns) are laid out in windows around the visible part.
const LONG_LINE: usize = 2000;
const LONG_LINE_WINDOW: usize = 1024;

enum MenuCmd {
    Action(EditorAction),
    Cut,
    Copy,
    Paste,
    Comment,
}

impl<'a> EditorView<'a> {
    pub fn new(doc: &'a mut Document, state: &'a mut EditorState) -> Self {
        EditorView { doc, state, marks: &[], annotations: &[], problems: &[], theme: None, font_size: 13.0, read_only: false }
    }

    /// Problems to underline and to mark on the scrollbar, sorted by `start`.
    pub fn problems(mut self, problems: &'a [ProblemMark]) -> Self {
        self.problems = problems;
        self
    }

    pub fn gutter_marks(mut self, marks: &'a [(usize, GutterMark)]) -> Self {
        self.marks = marks;
        self
    }

    /// Per-line text for an annotation column (git blame), indexed by line. Empty hides it.
    pub fn annotations(mut self, annotations: &'a [String]) -> Self {
        self.annotations = annotations;
        self
    }

    pub fn theme(mut self, theme: &'a EditorTheme) -> Self {
        self.theme = Some(theme);
        self
    }

    pub fn font_size(mut self, size: f32) -> Self {
        self.font_size = size;
        self
    }

    /// Ignores every edit (typing, paste, cut, undo, Git rollback stays the app's business).
    /// Navigation, selection, copy and the context-menu actions keep working.
    pub fn read_only(mut self, read_only: bool) -> Self {
        self.read_only = read_only;
        self
    }

    pub fn show(self, ui: &mut Ui) -> EditorResponse {
        let EditorView { doc, state, marks, annotations, problems, theme, font_size, read_only } = self;
        let default_theme;
        let theme = match theme {
            Some(t) => t,
            None => {
                default_theme = EditorTheme::default();
                &default_theme
            }
        };
        state.frame += 1;

        let font = FontId::monospace(font_size);
        let ppp = ui.ctx().pixels_per_point();
        let char_w = match state.advance {
            Some((size, p, w)) if size == font_size.to_bits() && p == ppp.to_bits() => w,
            _ => {
                let w = ui.fonts(|f| column_advance(f, &font));
                state.advance = Some((font_size.to_bits(), ppp.to_bits(), w));
                w
            }
        };
        let row_h = ui.fonts(|f| f.row_height(&font));
        let line_h = (row_h * 1.25).round();

        // External edits (rollback, reload) can shrink the text under a stale selection.
        state.carets.clamp(doc.len_chars());
        if let Some((a, h)) = state.pending_selection.take() {
            state.carets = Carets::single(Selection::new(doc.position_to_char(a), doc.position_to_char(h)));
        }

        let full = ui.available_rect_before_wrap();
        ui.allocate_rect(full, Sense::hover());
        let id = state.editor_id();
        let version_before = doc.version();

        // The find bar takes the top of the editor. Its actions run before the text handles
        // input, so a Replace shows in this frame.
        let bar_ids = BarIds::new(id);
        if state.find.seed {
            let last = ui.data(|d| d.get_temp::<LastFind>(session_id())).unwrap_or_default();
            state.find.seed_from(&last.query, &last.opts);
        }
        state.find.sync_selection(state.carets.primary());
        let mut rect = full;
        if state.find.is_open() {
            let fresh = state.find.is_fresh(doc);
            let history = ui.data(|d| d.get_temp::<ReplaceHistory>(session_id())).unwrap_or_default();
            let h = find_bar::height(&state.find, read_only).min(full.height());
            let bar_rect = Rect::from_min_size(full.min, Vec2::new(full.width(), h));
            rect.min.y += h;
            let env = BarEnv { theme, read_only, fresh, history: &history.0 };
            let cmds = find_bar::show(ui, bar_rect, &mut state.find, &bar_ids, &env);
            for cmd in cmds {
                match cmd {
                    BarCmd::Next => state.find.go_next(state.carets.primary()),
                    BarCmd::Prev => state.find.go_prev(state.carets.primary()),
                    BarCmd::SelectAll => state.select_all_occurrences(doc),
                    BarCmd::Replace if !read_only => state.find_replace(doc),
                    BarCmd::ReplaceAll if !read_only => state.find_replace_all(doc),
                    BarCmd::Exclude => state.find_exclude(doc),
                    BarCmd::Close => state.close_find(),
                    BarCmd::Replace | BarCmd::ReplaceAll => {}
                }
            }
        }
        if let Some(r) = state.find.used_replacement.take().filter(|r| !r.is_empty()) {
            ui.data_mut(|d| {
                let h = d.get_temp_mut_or_default::<ReplaceHistory>(session_id());
                h.0.retain(|x| x != &r);
                h.0.insert(0, r);
                h.0.truncate(HISTORY_LEN);
            });
        }
        if state.find.is_open() && !state.find.query().is_empty() {
            ui.data_mut(|d| {
                let last = d.get_temp_mut_or_default::<LastFind>(session_id());
                if last.query != state.find.query() || &last.opts != state.find.options() {
                    *last = LastFind { query: state.find.query().to_string(), opts: state.find.options().clone() };
                }
            });
        }
        ui.painter().rect_filled(rect, 0.0, theme.background);

        let line_count = doc.line_count();
        let digits = line_count.to_string().len().max(2) as f32;
        let ann_chars = annotations.iter().map(|a| a.chars().count()).max().unwrap_or(0).min(40);
        let ann_w = if ann_chars > 0 { (ann_chars as f32 + 2.0) * char_w } else { 0.0 };
        let numbers_w = (digits + 2.0) * char_w;
        let gutter_w = ann_w + numbers_w + MARK_W + 6.0;
        let gutter_rect = Rect::from_min_size(rect.min, Vec2::new(gutter_w, rect.height()));
        let text_rect = Rect::from_min_max(Pos2::new(rect.min.x + gutter_w, rect.min.y), rect.max);

        let resp = ui.interact(text_rect, id, Sense::click_and_drag());
        let gutter_resp = ui.interact(gutter_rect, id.with("gutter"), Sense::click());
        // Accessibility names, which UI tests also use to find the editor.
        let name = doc.path().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        resp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Other, true, format!("Editor {name}")));
        gutter_resp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Other, true, format!("Gutter {name}")));

        let mut out_action = None;
        let mut gutter_clicked = None;
        let mut annotation_clicked = None;
        let mut caret_moved = false;

        if std::mem::take(&mut state.pending_focus) {
            resp.request_focus();
        }

        let modifiers = ui.input(|i| i.modifiers);
        let origin = text_rect.min + Vec2::new(TEXT_PAD, 0.0) - state.drawn_scroll;
        let drawn = std::mem::take(&mut state.drawn);
        // Column boundary nearest to `p`, measured on the glyphs drawn last frame when the line
        // was on screen.
        // The line under `y`, clamped to the document. Rows are drawn at `row_top`, so hit
        // tests use the same snapped boundaries.
        let line_under = |y: f32| -> usize { (line_at_y(origin.y, line_h, ppp, y).max(0) as usize).min(line_count.saturating_sub(1)) };
        let hit = |doc: &Document, p: Pos2| -> usize {
            let line = line_under(p.y);
            let text = doc.line(line);
            let d = display_col_at(&drawn, line, p.x - origin.x, char_w);
            doc.line_start(line) + col_from_display(&text, d)
        };

        // Mouse. The caret moves on press, not on release, so drag-select starts where the
        // button went down.
        let (pressed, down, middle_pressed, middle_down, pointer) = ui.input(|i| {
            (
                i.pointer.primary_pressed(),
                i.pointer.primary_down(),
                i.pointer.button_pressed(egui::PointerButton::Middle),
                i.pointer.button_down(egui::PointerButton::Middle),
                i.pointer.interact_pos(),
            )
        });
        // Fractional display column and line under `p`, for column selection.
        let cell = |p: Pos2| -> (usize, f32) {
            let line = line_under(p.y);
            (line, display_col_at(&drawn, line, p.x - origin.x, char_w).max(0.0))
        };
        if (pressed || middle_pressed) && resp.hovered() {
            if let Some(p) = pointer {
                resp.request_focus();
                let idx = hit(doc, p);
                let plain = pressed && !modifiers.shift && !modifiers.alt && !modifiers.command;
                let count = if plain {
                    let now = ui.input(|i| i.time);
                    let delay = ui.ctx().options(|o| o.input_options.max_double_click_delay);
                    state.click_chain.press(now, p, delay, CHAIN_DIST)
                } else {
                    state.click_chain.reset();
                    1
                };
                if middle_pressed || (modifiers.alt && modifiers.shift) {
                    state.column_drag = Some(cell(p));
                    state.dragging = false;
                } else if modifiers.alt && !modifiers.command {
                    state.carets.toggle(idx);
                    state.dragging = false;
                } else if count == 1 {
                    state.set_head(idx, modifiers.shift);
                    state.drag_unit = DragUnit::Char;
                    state.dragging = !modifiers.command;
                } else {
                    // IDEA: the second press selects the word, every later press of the same
                    // chain the whole line. Acting on the press keeps the selection while the
                    // button is down, so the chain never shows a bare caret in between.
                    let r = if count == 2 { editing::word_range(doc, idx) } else { line_range(doc, line_under(p.y)) };
                    state.carets = Carets::single(Selection::new(r.start, r.end));
                    state.drag_unit = if count == 2 { DragUnit::Word(r) } else { DragUnit::Line(r) };
                    state.dragging = true;
                }
                state.preferred_cols.clear();
                state.occurrences.clear();
                doc.seal_undo_group();
            }
        }
        if let Some((line0, col0)) = state.column_drag {
            if down || middle_down {
                if let Some(p) = pointer {
                    let (line1, col1) = cell(p);
                    state.carets = column_selection(doc, line0, col0, line1, col1);
                    if !text_rect.contains(p) {
                        caret_moved = true;
                        ui.ctx().request_repaint();
                    }
                }
            } else {
                state.column_drag = None;
            }
        }
        if state.dragging {
            if down {
                if let Some(p) = pointer {
                    let idx = hit(doc, p);
                    let old = state.carets.primary();
                    let sel = match &state.drag_unit {
                        DragUnit::Char => Selection::new(old.anchor, idx),
                        DragUnit::Word(r0) => span_units(r0, editing::word_range(doc, idx)),
                        DragUnit::Line(r0) => span_units(r0, line_range(doc, line_under(p.y))),
                    };
                    if sel != old {
                        state.carets = Carets::single(sel);
                    }
                    if !text_rect.contains(p) {
                        caret_moved = true;
                        ui.ctx().request_repaint();
                    }
                }
            } else {
                state.dragging = false;
            }
        }
        if resp.clicked() && modifiers.command {
            if let Some(p) = resp.interact_pointer_pos() {
                let idx = hit(doc, p);
                state.carets = Carets::single(Selection::caret(idx));
                out_action = Some(EditorAction::GoToDeclaration(doc.char_to_position(idx)));
            }
        }
        if resp.secondary_clicked() {
            if let Some(p) = resp.interact_pointer_pos() {
                resp.request_focus();
                let idx = hit(doc, p);
                // Like IDEA: keep the selections when right-clicking inside one, so "Copy" works.
                let inside = state.carets.all().iter().any(|s| !s.is_empty() && s.start() <= idx && idx <= s.end());
                if !inside {
                    state.carets = Carets::single(Selection::caret(idx));
                }
                state.menu_pos = doc.char_to_position(idx);
                state.preferred_cols.clear();
            }
        }
        if gutter_resp.clicked() {
            if let Some(p) = gutter_resp.interact_pointer_pos() {
                let line = line_at_y(origin.y, line_h, ppp, p.y);
                if line >= 0 && (line as usize) < line_count {
                    let line = line as usize;
                    if p.x < gutter_rect.min.x + ann_w {
                        annotation_clicked = Some(line);
                    } else {
                        gutter_clicked = Some(line);
                    }
                }
            }
        }

        // Keyboard.
        let has_focus = resp.has_focus();
        if has_focus {
            ui.memory_mut(|m| {
                m.set_focus_lock_filter(
                    id,
                    EventFilter { tab: true, horizontal_arrows: true, vertical_arrows: true, escape: true },
                )
            });
            let page = ((state.viewport.y / line_h) as usize).saturating_sub(1).max(1);
            // Alt pressed twice and held arms Clone Caret Above/Below.
            let now = ui.input(|i| i.time);
            let tap = &mut state.alt_tap;
            if modifiers.alt && !tap.held {
                tap.armed = now - tap.last_press < ALT_DOUBLE_TAP;
                tap.last_press = now;
            } else if !modifiers.alt {
                tap.armed = false;
            }
            tap.held = modifiers.alt;
            let events = ui.input(|i| i.events.clone());
            for ev in events {
                match ev {
                    Event::Key { key: Key::Escape, pressed: true, .. } if state.find.is_open() => {
                        state.close_find();
                    }
                    Event::Key { key: key @ (Key::ArrowUp | Key::ArrowDown), pressed: true, modifiers: m, .. }
                        if state.alt_tap.armed && m.alt && !m.shift && !m.command =>
                    {
                        state.clone_caret(doc, key == Key::ArrowUp);
                        // Alt stays armed while held; a later press starts a new double tap.
                        state.alt_tap.last_press = f64::NEG_INFINITY;
                        caret_moved = true;
                    }
                    Event::Text(t) => {
                        if read_only || modifiers.command || modifiers.ctrl || t.is_empty() {
                            continue;
                        }
                        let single = t.chars().count() == 1;
                        carets::edit_each(doc, &mut state.carets, |doc, sel, _| {
                            if single {
                                editing::type_char(doc, sel, &t);
                            } else {
                                insert_other(doc, sel, &t);
                            }
                        });
                        state.preferred_cols.clear();
                        caret_moved = true;
                    }
                    Event::Copy => {
                        ui.ctx().copy_text(carets::copy_text(doc, &state.carets));
                    }
                    Event::Cut if read_only => {
                        ui.ctx().copy_text(carets::copy_text(doc, &state.carets));
                    }
                    Event::Cut => {
                        ui.ctx().copy_text(carets::cut(doc, &mut state.carets));
                        caret_moved = true;
                    }
                    Event::Paste(_) if read_only => {}
                    Event::Paste(t) => {
                        carets::paste(doc, &mut state.carets, &t);
                        caret_moved = true;
                    }
                    Event::Key { key, pressed: true, modifiers: m, .. } => {
                        // Any other key between the two Alt taps cancels the double tap.
                        state.alt_tap.last_press = f64::NEG_INFINITY;
                        if read_only && is_edit_key(key, m) {
                            continue;
                        }
                        if let Some(action) = on_key(doc, state, key, m, page) {
                            out_action = Some(action);
                        }
                        caret_moved = true;
                    }
                    _ => {}
                }
            }
        }

        // Context menu. Commands are collected first and applied after the closure, which keeps
        // the borrow of `doc` simple.
        let mut menu_cmd = None;
        let menu_pos = state.menu_pos;
        let sel_lines = editing::selected_lines(doc, &state.carets.primary());
        let lines_changed = marks.iter().any(|(l, _)| sel_lines.contains(l));
        let has_comment = doc.language().comment_tokens().is_some();
        resp.context_menu(|ui| {
            ui.set_min_width(220.0);
            let mut item = |ui: &mut Ui, label: &str, shortcut: &str, enabled: bool, cmd: MenuCmd| {
                let b = Button::new(label).shortcut_text(shortcut);
                if ui.add_enabled(enabled, b).clicked() {
                    menu_cmd = Some(cmd);
                    ui.close_menu();
                }
            };
            item(ui, "Go to Declaration", "⌘B", true, MenuCmd::Action(EditorAction::GoToDeclaration(menu_pos)));
            item(ui, "Go to Source Definition", "", true, MenuCmd::Action(EditorAction::GoToSourceDefinition(menu_pos)));
            item(ui, "Go to Type Definition", "⇧⌘B", true, MenuCmd::Action(EditorAction::GoToTypeDefinition(menu_pos)));
            item(ui, "Find Usages", "⌥F7", true, MenuCmd::Action(EditorAction::FindUsages(menu_pos)));
            ui.separator();
            item(ui, "Cut", "⌘X", !read_only, MenuCmd::Cut);
            item(ui, "Copy", "⌘C", true, MenuCmd::Copy);
            item(ui, "Paste", "⌘V", !read_only, MenuCmd::Paste);
            ui.separator();
            item(ui, "Comment with Line Comment", "⌘/", has_comment && !read_only, MenuCmd::Comment);
            ui.separator();
            ui.menu_button("Git", |ui| {
                ui.set_min_width(200.0);
                let mut git = |ui: &mut Ui, label: &str, enabled: bool, a: EditorAction| {
                    if ui.add_enabled(enabled, Button::new(label)).clicked() {
                        menu_cmd = Some(MenuCmd::Action(a));
                        ui.close_menu();
                    }
                };
                git(ui, "Annotate with Git Blame", true, EditorAction::GitAnnotate);
                git(ui, "Show History", true, EditorAction::GitShowHistory);
                git(ui, "Rollback Lines", lines_changed && !read_only, EditorAction::GitRollbackLines);
            });
        });
        // The press on a menu item took the focus away from the editor. Every item hands it
        // back, so Cmd+Z and typing act on the editor at once. The app may move it on (a new
        // tab, a popup) later in the same frame.
        if menu_cmd.is_some() {
            resp.request_focus();
        }
        match menu_cmd {
            Some(MenuCmd::Action(a)) => out_action = Some(a),
            Some(MenuCmd::Cut) => {
                ui.ctx().copy_text(carets::cut(doc, &mut state.carets));
                caret_moved = true;
            }
            Some(MenuCmd::Copy) => ui.ctx().copy_text(carets::copy_text(doc, &state.carets)),
            // egui cannot read the clipboard directly; this makes the integration send a Paste
            // event next frame, which the keyboard path above handles. The focus from above
            // makes sure of that.
            Some(MenuCmd::Paste) => {
                ui.ctx().send_viewport_cmd(ViewportCommand::RequestPaste);
            }
            Some(MenuCmd::Comment) => {
                carets::toggle_comment(doc, &mut state.carets);
                caret_moved = true;
            }
            None => {}
        }

        state.find_refresh(doc, false);
        if state.find.is_searching() {
            // The worker answers without an input event, so poll until it lands.
            ui.ctx().request_repaint_after(Duration::from_millis(16));
        }

        let changed = doc.version() != version_before;
        let line_count = doc.line_count();

        // Scrolling target for this frame.
        let view = text_rect.size();
        state.viewport = view;
        let content = Vec2::new(
            (doc.max_line_chars() as f32 + 8.0) * char_w + TEXT_PAD * 2.0,
            line_count as f32 * line_h + (view.y - 3.0 * line_h).max(0.0),
        );
        let mut new_scroll = None;
        if let Some(pos) = state.pending_reveal.take() {
            let idx = doc.position_to_char(pos);
            state.carets = Carets::single(Selection::caret(idx));
            state.preferred_cols.clear();
            let p = doc.char_to_position(idx);
            let x = display_col(&doc.line(p.line), p.column) as f32 * char_w;
            let y = p.line as f32 * line_h - view.y / 2.0 + line_h / 2.0;
            let sx = if x > view.x - 4.0 * char_w { x - view.x / 2.0 } else { 0.0 };
            new_scroll = Some(Vec2::new(sx.max(0.0), y.max(0.0)));
            doc.seal_undo_group();
        } else if let Some(r) = state.find_scroll.take() {
            // A match off screen is centered, like IDEA; one on screen does not move the view.
            let p = doc.char_to_position(r.start);
            let e = doc.char_to_position(r.end);
            let x0 = display_col(&doc.line(p.line), p.column) as f32 * char_w;
            let x1 = display_col(&doc.line(e.line), e.column) as f32 * char_w + TEXT_PAD;
            let y0 = p.line as f32 * line_h;
            let y1 = (e.line + 1) as f32 * line_h;
            let mut s = state.scroll;
            if y0 < s.y || y1 > s.y + view.y {
                s.y = (y0 - view.y / 2.0 + line_h / 2.0).clamp(0.0, (content.y - view.y).max(0.0));
            }
            if x0 < s.x || x1 > s.x + view.x - 4.0 * char_w {
                s.x = (x0 - view.x / 2.0).clamp(0.0, (content.x - view.x).max(0.0));
            }
            if s != state.scroll {
                new_scroll = Some(s);
            }
            doc.seal_undo_group();
        } else if caret_moved {
            let p = doc.char_to_position(state.carets.primary().head);
            let x = display_col(&doc.line(p.line), p.column) as f32 * char_w + TEXT_PAD;
            let y = p.line as f32 * line_h;
            let mut s = state.scroll;
            let margin_y = line_h;
            if y < s.y + margin_y * 0.0 {
                s.y = y;
            } else if y + line_h > s.y + view.y - margin_y {
                s.y = y + line_h - view.y + margin_y;
            }
            let margin_x = 4.0 * char_w;
            if x < s.x + margin_x {
                s.x = (x - margin_x * 4.0).max(0.0);
            } else if x > s.x + view.x - margin_x {
                s.x = x - view.x + margin_x * 4.0;
            }
            s.y = s.y.clamp(0.0, (content.y - view.y).max(0.0));
            s.x = s.x.clamp(0.0, (content.x - view.x).max(0.0));
            if s != state.scroll {
                new_scroll = Some(s);
            }
        }

        let caret_pos = doc.char_to_position(state.carets.primary().head);
        state.cursor_pos = caret_pos;

        // Text area.
        let theme_fp = theme.fingerprint();
        let mut child = ui.new_child(UiBuilder::new().max_rect(text_rect).layout(Layout::top_down(Align::Min)));
        let mut area = ScrollArea::both()
            .id_salt(id.with("scroll"))
            .auto_shrink([false, false])
            .drag_to_scroll(false);
        if let Some(s) = new_scroll {
            area = area.scroll_offset(s);
        }
        let hover_word = if modifiers.command && resp.hovered() {
            resp.hover_pos().map(|p| hit(doc, p)).and_then(|i| doc.word_at(doc.char_to_position(i)))
        } else {
            None
        };

        let mut drawn_buf = drawn;
        let find = &state.find;
        let find_matches = if find.is_open() { find.matches() } else { &[] };
        let find_in_selection = find.in_selection();
        let find_current = if find_in_selection { find.current() } else { None };
        let output = area.show_viewport(&mut child, |ui, viewport| {
            ui.set_min_size(content);
            let drawn_scroll = text_rect.min - ui.max_rect().min;
            let origin = ui.max_rect().min + Vec2::new(TEXT_PAD, 0.0);
            let first = ((viewport.min.y / line_h).floor().max(0.0) as usize).min(line_count);
            let last = ((viewport.max.y / line_h).ceil().max(0.0) as usize + 1).min(line_count);
            let visible = first..last;

            let version = doc.highlight_version();
            let cached = state
                .highlight
                .as_ref()
                .is_some_and(|c| c.version == version && c.lines.start <= first && c.lines.end >= last);
            if !cached {
                let margin = visible.len().max(60);
                let lines = first.saturating_sub(margin)..(last + margin).min(line_count);
                let spans = doc.highlight(lines.clone());
                state.highlight = Some(HighlightCache { version: doc.highlight_version(), lines, spans });
            }
            let hl = state.highlight.as_ref().expect("filled above");

            let painter = ui.painter().clone();
            let round = |v: f32| (v * ppp).round() / ppp;
            let full_left = ui.clip_rect().left();
            let full_right = ui.clip_rect().right();
            let text_y = ((line_h - row_h) / 2.0).round();
            let first_col = ((viewport.min.x - TEXT_PAD) / char_w).floor().max(0.0) as usize;
            let visible_cols = (viewport.width() / char_w).ceil() as usize + 2;
            let all_carets = &state.carets;
            // The problems that touch the visible lines: one pass over a short list, so each
            // line below only walks its own.
            let (vis_start, vis_end) = (doc.line_start(first), if last >= line_count { doc.len_chars() } else { doc.line_start(last) });
            let visible_problems: Vec<&ProblemMark> = problems[..problems.partition_point(|m| m.start <= vis_end)].iter().filter(|m| m.end >= vis_start).collect();

            let mut drawn_now = std::mem::take(&mut drawn_buf);
            drawn_now.clear();
            for line in visible {
                let y = row_top(origin.y, line_h, ppp, line as isize);
                let y_end = row_top(origin.y, line_h, ppp, line as isize + 1);
                let text = doc.line(line);
                let line_start = doc.line_start(line);
                let line_chars = text.chars().count();

                // The galley first: selection, underline and caret take their x from its glyphs.
                let spans: &[Span] = line
                    .checked_sub(hl.lines.start)
                    .and_then(|i| hl.spans.get(i))
                    .map_or(&[], |v| v.as_slice());
                let width_cols = if line_chars > LONG_LINE / 4 { display_col(&text, line_chars) } else { line_chars };
                let window = if width_cols > LONG_LINE {
                    let s = first_col.saturating_sub(LONG_LINE_WINDOW / 2) / LONG_LINE_WINDOW * LONG_LINE_WINDOW;
                    s..s + visible_cols + LONG_LINE_WINDOW * 2
                } else {
                    0..usize::MAX
                };
                let galley = if !text.is_empty() && window.start < width_cols {
                    let key = {
                        let mut h = DefaultHasher::new();
                        text.hash(&mut h);
                        spans.hash(&mut h);
                        window.start.hash(&mut h);
                        font_size.to_bits().hash(&mut h);
                        theme_fp.hash(&mut h);
                        h.finish()
                    };
                    let frame = state.frame;
                    Some(match state.galleys.get_mut(&key) {
                        Some((g, used)) => {
                            *used = frame;
                            g.clone()
                        }
                        None => {
                            let job = line_job(&text, spans, window.clone(), &font, theme);
                            let g = ui.fonts(|f| f.layout_job(job));
                            state.galleys.insert(key, (g.clone(), frame));
                            g
                        }
                    })
                } else {
                    None
                };
                // Screen x of the galley's left edge; the galley is drawn there, snapped to pixels.
                let galley_x = round(origin.x + window.start as f32 * char_w);
                let col_x = |d: usize| -> f32 {
                    match &galley {
                        Some(g) if d >= window.start => galley_x + galley_col_x(g, d - window.start, char_w, ppp),
                        _ => origin.x + d as f32 * char_w,
                    }
                };

                let ls = line_start;
                let le = line_start + line_chars;
                // The carets and selections on this line: a binary search, so 10k carets cost
                // nothing on lines without them.
                let here = all_carets.touching(ls..le);
                if here.iter().any(|s| s.is_empty() && s.head >= ls && s.head <= le) {
                    painter.rect_filled(
                        Rect::from_min_max(Pos2::new(full_left, y), Pos2::new(full_right, y_end)),
                        0.0,
                        theme.current_line,
                    );
                }

                for sel in here.iter().filter(|s| !s.is_empty()) {
                    let sel_range = sel.range();
                    let a = sel_range.start.max(ls);
                    let b = sel_range.end.min(le);
                    let covers_newline = sel_range.start <= le && sel_range.end > le;
                    if a < b || covers_newline && a <= le {
                        let x0 = col_x(display_col(&text, a - ls));
                        let mut x1 = col_x(display_col(&text, b.max(a) - ls));
                        if covers_newline {
                            x1 += char_w;
                        }
                        painter.rect_filled(Rect::from_min_max(Pos2::new(x0, y), Pos2::new(x1, y_end)), 0.0, theme.selection);
                    }
                }

                // Matches paint over the selection, so In Selection still shows them.
                if !find_matches.is_empty() {
                    let le = line_start + line_chars;
                    let mut i = find_matches.partition_point(|m| m.range.end <= line_start);
                    while let Some(m) = find_matches.get(i) {
                        if m.range.start > le {
                            break;
                        }
                        let a = m.range.start.max(line_start);
                        let b = m.range.end.min(le);
                        let x0 = col_x(display_col(&text, a - line_start));
                        let mut x1 = col_x(display_col(&text, b.max(a) - line_start));
                        if m.range.end > le {
                            x1 += char_w;
                        }
                        if !find_in_selection && here.iter().any(|s| s.range() == m.range) {
                            // The current match is the selection; it keeps the selection color.
                            i += 1;
                            continue;
                        }
                        let r = Rect::from_min_max(Pos2::new(x0, y), Pos2::new(x1.max(x0 + 1.0), y_end));
                        if m.excluded {
                            painter.rect_stroke(r, 0.0, Stroke::new(1.0_f32, theme.find_excluded), egui::StrokeKind::Inside);
                        } else if find_current.as_ref() == Some(&m.range) {
                            painter.rect_filled(r, 0.0, theme.find_current);
                        } else {
                            painter.rect_filled(r, 0.0, theme.find_match);
                        }
                        i += 1;
                    }
                }

                if let Some(g) = &galley {
                    painter.galley(Pos2::new(galley_x, y + text_y), g.clone(), theme.foreground);
                }

                for m in visible_problems.iter().filter(|m| m.start <= le && m.end >= ls && !(m.end == ls && m.start < ls)) {
                    let a = m.start.max(ls) - ls;
                    let b = m.end.min(le) - ls;
                    let x0 = col_x(display_col(&text, a));
                    // An empty range (a missing token) still gets one char of underline.
                    let x1 = if b > a { col_x(display_col(&text, b)) } else { x0 + char_w };
                    let uy = y + text_y + row_h + 1.0;
                    let color = theme.problem(m.severity);
                    if m.severity == ProblemSeverity::Unused {
                        dotted(&painter, x0, x1, uy, color);
                    } else {
                        wave(&painter, x0, x1, uy, color);
                    }
                }

                if let Some(w) = &hover_word {
                    if w.start.line == line {
                        let x0 = col_x(display_col(&text, w.start.column));
                        let x1 = col_x(display_col(&text, w.end.column));
                        let uy = y + text_y + row_h;
                        painter.line_segment([Pos2::new(x0, uy), Pos2::new(x1, uy)], Stroke::new(1.0_f32, theme.link));
                    }
                }

                for sel in here.iter().filter(|s| s.head >= ls && s.head <= le) {
                    let x = round(col_x(display_col(&text, sel.head - ls)));
                    let color = if has_focus { theme.caret } else { theme.caret_unfocused() };
                    painter.rect_filled(Rect::from_min_max(Pos2::new(x - 1.0, y), Pos2::new(x + 1.0, y_end)), 0.0, color);
                }
                if let Some(galley) = galley {
                    drawn_now.push(DrawnLine { line, window_start: window.start, galley });
                }
            }
            (drawn_now, drawn_scroll)
        });
        (state.drawn, state.drawn_scroll) = output.inner;
        state.scroll = output.state.offset;

        if state.carets.is_multi() {
            let key = {
                let mut h = DefaultHasher::new();
                (state.carets.all(), line_count, text_rect.height().to_bits(), line_h.to_bits()).hash(&mut h);
                h.finish()
            };
            if state.caret_marks.0 != key {
                let marks = scroll_marks(doc, state.carets.all(), |s| s.head, text_rect.height(), content.y, line_h);
                state.caret_marks = (key, marks);
            }
            let painter = ui.painter_at(text_rect);
            for &y in &state.caret_marks.1 {
                let r = Rect::from_min_size(Pos2::new(text_rect.right() - 7.0, text_rect.top() + y), Vec2::new(6.0, 2.0));
                painter.rect_filled(r, 0.0, theme.caret_scroll_mark);
            }
        }
        if state.find.is_open() && !state.find.matches().is_empty() {
            let key = {
                let mut h = DefaultHasher::new();
                (state.find.gen, doc.version(), line_count, text_rect.height().to_bits(), line_h.to_bits()).hash(&mut h);
                h.finish()
            };
            if state.find_marks.0 != key {
                state.find_marks = (key, scroll_marks(doc, state.find.matches(), |m| m.range.start, text_rect.height(), content.y, line_h));
            }
            let painter = ui.painter_at(text_rect);
            for &y in &state.find_marks.1 {
                let r = Rect::from_min_size(Pos2::new(text_rect.right() - 7.0, text_rect.top() + y), Vec2::new(6.0, 2.0));
                painter.rect_filled(r, 0.0, theme.find_scroll_mark);
            }
        }

        if !problems.is_empty() {
            let key = {
                let mut h = DefaultHasher::new();
                (problems, line_count, text_rect.height().to_bits(), line_h.to_bits()).hash(&mut h);
                h.finish()
            };
            if state.problem_marks.0 != key {
                let mut out = Vec::new();
                // Weaker first, so an error band is drawn over a warning at the same y.
                for sev in ProblemSeverity::ALL.into_iter().rev() {
                    let starts: Vec<usize> = problems.iter().filter(|m| m.severity == sev).map(|m| m.start).collect();
                    out.extend(scroll_marks(doc, &starts, |s| *s, text_rect.height(), content.y, line_h).into_iter().map(|y| (sev, y)));
                }
                state.problem_marks = (key, out);
            }
            let painter = ui.painter_at(text_rect);
            for &(sev, y) in &state.problem_marks.1 {
                let r = Rect::from_min_size(Pos2::new(text_rect.right() - 7.0, text_rect.top() + y), Vec2::new(6.0, 2.0));
                painter.rect_filled(r, 0.0, theme.problem(sev));
            }
        }

        // Evict galleys not drawn recently, but only once the cache is clearly larger than a
        // screenful, so normal scrolling never pays for it.
        if state.galleys.len() > 3000 {
            let keep_after = state.frame.saturating_sub(30);
            state.galleys.retain(|_, (_, used)| *used >= keep_after);
        }

        // Gutter, painted after the scroll area so it uses this frame's offset.
        let painter = ui.painter_at(gutter_rect);
        painter.rect_filled(gutter_rect, 0.0, theme.gutter_background);
        painter.line_segment(
            [Pos2::new(gutter_rect.right() - 0.5, gutter_rect.top()), Pos2::new(gutter_rect.right() - 0.5, gutter_rect.bottom())],
            Stroke::new(1.0_f32, theme.gutter_separator),
        );
        let top = text_rect.top() - state.drawn_scroll.y;
        let first = ((state.drawn_scroll.y / line_h).floor().max(0.0) as usize).min(line_count);
        let last = (((state.drawn_scroll.y + view.y) / line_h).ceil() as usize + 1).min(line_count);
        let numbers_right = gutter_rect.min.x + ann_w + numbers_w;
        let text_y = ((line_h - row_h) / 2.0).round();
        // Lines with a caret, among the visible ones.
        let mut caret_rows = vec![false; last.saturating_sub(first)];
        for s in state.carets.touching(doc.line_start(first)..doc.line_start(last)) {
            let l = doc.char_to_position(s.head).line;
            if let Some(row) = l.checked_sub(first).and_then(|i| caret_rows.get_mut(i)) {
                *row = true;
            }
        }
        for line in first..last {
            let y = row_top(top, line_h, ppp, line as isize);
            let current = caret_rows.get(line - first).copied().unwrap_or(false);
            let color = if current { theme.line_number_current } else { theme.line_number };
            painter.text(
                Pos2::new(numbers_right - char_w, y + text_y),
                Align2::RIGHT_TOP,
                (line + 1).to_string(),
                font.clone(),
                color,
            );
            if let Some(a) = annotations.get(line) {
                if !a.is_empty() {
                    let a: String = a.chars().take(40).collect();
                    painter.text(Pos2::new(gutter_rect.min.x + char_w * 0.5, y + text_y), Align2::LEFT_TOP, a, font.clone(), theme.annotation);
                }
            }
        }
        let mark_x = numbers_right + 1.0;
        state.geometry = Some(EditorGeometry {
            text_rect,
            gutter_rect,
            origin: Pos2::new(text_rect.min.x + TEXT_PAD - state.drawn_scroll.x, top),
            char_w,
            line_h,
            annotation_w: ann_w,
            mark_x,
            ppp,
        });
        for &(line, mark) in marks {
            if line < first || line > last {
                continue;
            }
            let y = row_top(top, line_h, ppp, line as isize);
            let y_end = row_top(top, line_h, ppp, line as isize + 1);
            match mark {
                GutterMark::Added | GutterMark::Modified => {
                    let color = if mark == GutterMark::Added { theme.mark_added } else { theme.mark_modified };
                    painter.rect_filled(
                        Rect::from_min_max(Pos2::new(mark_x, y), Pos2::new(mark_x + MARK_W, y_end)),
                        0.0,
                        color,
                    );
                }
                GutterMark::Deleted => {
                    let tip = Pos2::new(mark_x + MARK_W + 2.0, y);
                    painter.add(egui::Shape::convex_polygon(
                        vec![Pos2::new(mark_x, y - 4.0), tip, Pos2::new(mark_x, y + 4.0)],
                        theme.mark_deleted,
                        Stroke::NONE,
                    ));
                }
            }
        }

        let hover = if resp.hovered() {
            resp.hover_pos().and_then(|p| {
                let line = line_at_y(origin.y, line_h, ppp, p.y);
                if line < 0 || line as usize >= line_count {
                    return None;
                }
                let line = line as usize;
                let text = doc.line(line);
                // The char under the pointer, not the nearest boundary.
                let d = display_col_at(&state.drawn, line, p.x - origin.x, char_w);
                let col = col_from_display(&text, d - 0.5);
                (col < text.chars().count()).then_some(Position::new(line, col))
            })
        } else {
            None
        };
        if resp.hovered() {
            let icon = if hover_word.is_some() { CursorIcon::PointingHand } else { CursorIcon::Text };
            ui.ctx().set_cursor_icon(icon);
        }
        if !doc.syntax_ready() {
            // A background parse finishes without any input event, so poll until it lands.
            ui.ctx().request_repaint_after(Duration::from_millis(16));
        }

        EditorResponse {
            changed,
            action: out_action,
            hover,
            gutter_clicked,
            annotation_clicked,
            cursor: caret_pos,
            has_focus,
            response: resp,
        }
    }
}

/// IDEA's error underline: a wave with a 4 px period under the text.
fn wave(painter: &egui::Painter, x0: f32, x1: f32, y: f32, color: egui::Color32) {
    let mut points = Vec::with_capacity(((x1 - x0) / 2.0) as usize + 2);
    let mut x = x0;
    let mut up = false;
    while x < x1 {
        points.push(Pos2::new(x, if up { y - 1.0 } else { y + 1.0 }));
        x += 2.0;
        up = !up;
    }
    points.push(Pos2::new(x1, if up { y - 1.0 } else { y + 1.0 }));
    painter.add(egui::Shape::line(points, Stroke::new(1.0_f32, color)));
}

/// A dotted underline for unused code and hints.
fn dotted(painter: &egui::Painter, x0: f32, x1: f32, y: f32, color: egui::Color32) {
    let mut x = x0;
    while x < x1 {
        painter.rect_filled(Rect::from_min_size(Pos2::new(x, y), Vec2::new(1.0, 1.0)), 0.0, color);
        x += 3.0;
    }
}

/// Y offsets (from the track top) of the 2-px bands of the scrollbar that hold a match. The
/// cost depends on the track height, not on the number of matches.
/// Screen y of the top of `line`'s row. Rows are snapped to physical pixels like everything
/// egui draws; drawing and every hit test go through this one function, so each pixel belongs
/// to exactly one line.
fn row_top(origin_y: f32, line_h: f32, ppp: f32, line: isize) -> f32 {
    ((origin_y + line as f32 * line_h) * ppp).round() / ppp
}

/// The line whose row (from `row_top(line)` up to `row_top(line + 1)`) holds `y`.
fn line_at_y(origin_y: f32, line_h: f32, ppp: f32, y: f32) -> isize {
    // Snapping moves a boundary by at most half a pixel, so the unsnapped guess is off by one
    // at most.
    let mut line = ((y - origin_y) / line_h).floor() as isize;
    if y < row_top(origin_y, line_h, ppp, line) {
        line -= 1;
    } else if y >= row_top(origin_y, line_h, ppp, line + 1) {
        line += 1;
    }
    line
}

/// The chars of `line` plus its line break.
fn line_range(doc: &Document, line: usize) -> Range<usize> {
    let end = if line + 1 < doc.line_count() { doc.line_start(line + 1) } else { doc.len_chars() };
    doc.line_start(line)..end
}

/// A drag by words or lines: from the unit the chain selected to the unit under the pointer.
/// The selection keeps the first unit whole, like IDEA.
fn span_units(first: &Range<usize>, under: Range<usize>) -> Selection {
    if under.start < first.start {
        Selection::new(first.end, under.start)
    } else {
        Selection::new(first.start, under.end.max(first.end))
    }
}

fn scroll_marks<T>(doc: &Document, items: &[T], start: impl Fn(&T) -> usize, track_h: f32, content_h: f32, line_h: f32) -> Vec<f32> {
    let mut out = Vec::new();
    let line_count = doc.line_count();
    if track_h <= 0.0 || content_h <= 0.0 {
        return out;
    }
    let per_px = content_h / track_h / line_h;
    let mut y = 0.0;
    while y < track_h {
        let l0 = ((y * per_px).floor() as usize).min(line_count);
        let l1 = (((y + 2.0) * per_px).ceil() as usize).max(l0 + 1).min(line_count);
        if l0 >= line_count {
            break;
        }
        let c0 = doc.line_start(l0);
        let c1 = if l1 >= line_count { doc.len_chars() + 1 } else { doc.line_start(l1) };
        let i = items.partition_point(|m| start(m) < c0);
        if items.get(i).is_some_and(|m| start(m) < c1) {
            out.push(y);
        }
        y += 2.0;
    }
    out
}

fn insert_other(doc: &mut Document, sel: &mut Selection, text: &str) {
    let r = sel.range();
    let after = Selection::caret(r.start + text.chars().count());
    doc.edit(r, text, *sel, after, EditKind::Other);
    *sel = after;
}

/// Keys that change the text. A read-only view drops them before `on_key`.
fn is_edit_key(key: Key, m: Modifiers) -> bool {
    match key {
        Key::Backspace | Key::Delete | Key::Enter | Key::Tab => true,
        Key::Z | Key::D | Key::Slash => m.command,
        Key::Y => m.ctrl && !m.mac_cmd,
        _ => false,
    }
}

fn on_key(doc: &mut Document, state: &mut EditorState, key: Key, m: Modifiers, page: usize) -> Option<EditorAction> {
    let shift = m.shift;
    let before = state.carets.clone();
    let primary = before.primary();
    let head = primary.head;
    let mut keep_col = false;
    let mut action = None;
    // Moves every caret's head; without Shift the selection collapses to it.
    let move_heads = |state: &mut EditorState, f: &dyn Fn(Selection) -> usize| {
        state.carets.map(|_, s| {
            let to = f(s);
            if shift { Selection::new(s.anchor, to) } else { Selection::caret(to) }
        });
    };
    match key {
        Key::ArrowLeft => move_heads(state, &|s: Selection| {
            if m.command {
                editing::smart_home(doc, s.head)
            } else if m.alt {
                editing::word_left(doc, s.head)
            } else if !s.is_empty() && !shift {
                s.start()
            } else {
                s.head.saturating_sub(1)
            }
        }),
        Key::ArrowRight => move_heads(state, &|s: Selection| {
            if m.command {
                editing::line_end_of(doc, s.head)
            } else if m.alt {
                editing::word_right(doc, s.head)
            } else if !s.is_empty() && !shift {
                s.end()
            } else {
                (s.head + 1).min(doc.len_chars())
            }
        }),
        Key::ArrowUp | Key::ArrowDown | Key::PageUp | Key::PageDown => {
            let up = matches!(key, Key::ArrowUp | Key::PageUp);
            if m.command && matches!(key, Key::ArrowUp | Key::ArrowDown) {
                let to = if up { 0 } else { doc.len_chars() };
                move_heads(state, &|_| to);
            } else {
                let n = if matches!(key, Key::PageUp | Key::PageDown) { page } else { 1 } as isize;
                let lines = if up { -n } else { n };
                let kept = std::mem::take(&mut state.preferred_cols);
                let fresh = kept.len() != state.carets.len();
                let mut wants = Vec::with_capacity(state.carets.len());
                for (i, s) in state.carets.all().iter().enumerate() {
                    wants.push(if fresh {
                        let p = doc.char_to_position(s.head);
                        display_col(&doc.line(p.line), p.column)
                    } else {
                        kept[i]
                    });
                }
                state.carets.map(|i, s| {
                    let to = editing::vertical(doc, s.head, lines, wants[i]);
                    if shift { Selection::new(s.anchor, to) } else { Selection::caret(to) }
                });
                if state.carets.len() == wants.len() {
                    state.preferred_cols = wants;
                }
                keep_col = true;
            }
        }
        Key::Home => move_heads(state, &|s: Selection| editing::smart_home(doc, s.head)),
        Key::End => move_heads(state, &|s: Selection| editing::line_end_of(doc, s.head)),
        Key::Backspace => {
            if m.command {
                carets::edit_each(doc, &mut state.carets, |doc, sel, _| editing::delete_line(doc, sel));
            } else {
                carets::edit_each(doc, &mut state.carets, |doc, sel, _| editing::backspace(doc, sel, m.alt));
            }
        }
        Key::Delete => carets::edit_each(doc, &mut state.carets, |doc, sel, _| editing::delete_forward(doc, sel, m.alt)),
        Key::Enter => carets::edit_each(doc, &mut state.carets, |doc, sel, _| {
            if shift {
                *sel = Selection::caret(editing::line_end_of(doc, sel.head));
            }
            editing::newline(doc, sel);
        }),
        Key::Tab => {
            if shift {
                carets::dedent(doc, &mut state.carets);
            } else {
                carets::tab(doc, &mut state.carets);
            }
        }
        Key::Escape => {
            if state.carets.is_multi() {
                state.carets.collapse();
            } else {
                state.carets = Carets::single(Selection::caret(head));
            }
            state.occurrences.clear();
        }
        Key::A if m.command => state.carets = Carets::single(Selection::new(0, doc.len_chars())),
        Key::Z if m.command => {
            let restored = if shift { doc.redo_carets() } else { doc.undo_carets() };
            if let Some(mut c) = restored {
                c.clamp(doc.len_chars());
                state.carets = c;
            }
        }
        Key::Y if m.ctrl && !m.mac_cmd => {
            if let Some(mut c) = doc.redo_carets() {
                c.clamp(doc.len_chars());
                state.carets = c;
            }
        }
        Key::D if m.command => carets::edit_each(doc, &mut state.carets, |doc, sel, _| editing::duplicate(doc, sel)),
        Key::Slash if m.command => carets::toggle_comment(doc, &mut state.carets),
        Key::G if m.ctrl && !m.command => {
            if shift {
                state.remove_last_occurrence();
            } else {
                state.add_next_occurrence(doc);
            }
            keep_col = true;
        }
        Key::B if m.command => {
            let p = doc.char_to_position(head);
            action = Some(if shift { EditorAction::GoToTypeDefinition(p) } else { EditorAction::GoToDeclaration(p) });
        }
        Key::F7 if m.alt => action = Some(EditorAction::FindUsages(doc.char_to_position(head))),
        _ => {}
    }
    if !keep_col {
        state.preferred_cols.clear();
    }
    if state.carets != before {
        doc.seal_undo_group();
    }
    action
}

/// One selection per line from `line0` to `line1`, between two display columns. Lines shorter
/// than the columns get a caret at their end.
fn column_selection(doc: &Document, line0: usize, col0: f32, line1: usize, col1: f32) -> Carets {
    let lines: Vec<usize> = if line0 <= line1 { (line0..=line1).collect() } else { (line1..=line0).rev().collect() };
    let mut sels = Vec::with_capacity(lines.len());
    for &l in &lines {
        let text = doc.line(l);
        let s = doc.line_start(l);
        sels.push(Selection::new(s + col_from_display(&text, col0), s + col_from_display(&text, col1)));
    }
    // The primary is the line under the pointer.
    let n = sels.len();
    Carets::from_vec(sels, n - 1)
}

/// The matcher for Ctrl+G and Select All Occurrences: case-sensitive, whole words when the
/// query came from the word under the caret.
fn occurrence_matcher(query: &str, words: bool) -> Option<Matcher> {
    let opts = FindOptions { match_case: true, words, multiline: query.contains('\n'), ..FindOptions::default() };
    Matcher::new(query, &opts).ok().flatten()
}

/// The first occurrence at or after `from` that `taken` rejects not, wrapping at the end. It
/// searches growing windows of lines, so a near hit in a big file costs little.
fn next_occurrence(doc: &Document, matcher: &Matcher, from: usize, taken: &dyn Fn(&Range<usize>) -> bool) -> Option<Range<usize>> {
    let total = doc.line_count();
    let span = matcher.span_lines().unwrap_or(total);
    let first = doc.char_to_position(from).line;
    // Lines `first..total`, then `0..=first` after the wrap.
    for (start, end, min) in [(first, total, from), (0, (first + 1).min(total), 0)] {
        let mut a = start;
        let mut n = 1024;
        while a < end {
            let b = (a + n).min(end);
            let hay_end = if b + span >= total { doc.len_chars() } else { doc.line_start(b + span) };
            let base = doc.line_start(a);
            // A match belongs to the window its start is in.
            let limit = doc.line_start(b);
            let text = doc.slice(base..hay_end);
            let (found, _) = matcher.find(&text, base, MAX_MATCHES);
            if let Some(r) = found.into_iter().find(|r| r.start >= min && (r.start < limit || b == total) && !taken(r)) {
                return Some(r);
            }
            a = b;
            n *= 2;
        }
    }
    None
}

/// Builds the layout job for one line (or one window of a long line), expanding tabs so the
/// monospace column math in the view matches what is drawn.
fn line_job(text: &str, spans: &[Span], window: Range<usize>, font: &FontId, theme: &EditorTheme) -> LayoutJob {
    let mut job = LayoutJob::default();
    job.wrap.max_width = f32::INFINITY;
    job.break_on_newline = false;
    let mut out = String::with_capacity(text.len().min(window.len()));
    let mut sections: Vec<LayoutSection> = Vec::new();
    let mut d = 0usize;
    let mut si = 0usize;
    let mut cur_kind = HlKind::None;
    let mut sec_start = 0usize;
    for (b, c) in text.char_indices() {
        let next = editing::advance(d, c);
        if d >= window.end {
            break;
        }
        while si < spans.len() && spans[si].end as usize <= b {
            si += 1;
        }
        let kind = match spans.get(si) {
            Some(s) if (s.start as usize) <= b => s.kind,
            _ => HlKind::None,
        };
        if next > window.start {
            if kind != cur_kind && out.len() > sec_start {
                sections.push(section(sec_start..out.len(), cur_kind, font, theme));
                sec_start = out.len();
            }
            cur_kind = kind;
            if c == '\t' {
                for _ in d.max(window.start)..next {
                    out.push(' ');
                }
            } else if c.is_control() {
                // Stray CR or other controls would otherwise draw as a missing-glyph box.
                out.push(' ');
            } else {
                out.push(c);
            }
        }
        d = next;
    }
    if out.len() > sec_start {
        sections.push(section(sec_start..out.len(), cur_kind, font, theme));
    }
    job.text = out;
    job.sections = sections;
    job
}

fn section(range: Range<usize>, kind: HlKind, font: &FontId, theme: &EditorTheme) -> LayoutSection {
    LayoutSection {
        leading_space: 0.0,
        byte_range: range,
        format: TextFormat { font_id: font.clone(), color: theme.color(kind), ..Default::default() },
    }
}

/// Width of one column of `font` as egui lays it out. egui snaps each glyph to the pixel grid,
/// so the real step between glyphs is the nominal advance rounded to pixels. Column math with
/// the nominal `glyph_width` drifts by a fraction of a pixel per column.
pub fn column_advance(fonts: &egui::epaint::Fonts, font: &FontId) -> f32 {
    const N: usize = 64;
    let g = fonts.layout_no_wrap("0".repeat(N), font.clone(), Default::default());
    match g.rows.first().map(|r| &r.glyphs[..]) {
        Some([first, .., last]) => (last.pos.x - first.pos.x) / (N - 1) as f32,
        _ => fonts.glyph_width(font, '0'),
    }
}

/// X of display column `i` inside a line galley, relative to the galley. Columns past the
/// last glyph continue with `char_w`.
fn galley_col_x(g: &Galley, i: usize, char_w: f32, ppp: f32) -> f32 {
    let glyphs = g.rows.first().map_or(&[][..], |r| &r.glyphs[..]);
    match (glyphs.get(i), glyphs.last()) {
        (Some(gl), _) => gl.pos.x,
        (None, Some(last)) => {
            // Where egui would put the next glyph: the end, snapped to the pixel grid.
            let end = ((last.pos.x + last.advance_width) * ppp).round() / ppp;
            end + (i - glyphs.len()) as f32 * char_w
        }
        (None, None) => i as f32 * char_w,
    }
}

/// The fractional display column at `x` (relative to the text origin) on `line`, measured on
/// the glyphs drawn last frame. Lines that were not drawn fall back to `char_w` steps.
fn display_col_at(drawn: &[DrawnLine], line: usize, x: f32, char_w: f32) -> f32 {
    let fallback = x / char_w;
    let Some(d) = drawn.iter().find(|d| d.line == line) else { return fallback };
    let xr = x - d.window_start as f32 * char_w;
    let glyphs = d.galley.rows.first().map_or(&[][..], |r| &r.glyphs[..]);
    if xr < 0.0 || glyphs.is_empty() {
        return fallback;
    }
    let i = glyphs.partition_point(|g| g.pos.x + g.advance_width <= xr);
    let col = match glyphs.get(i) {
        Some(g) => i as f32 + ((xr - g.pos.x) / g.advance_width.max(0.01)).clamp(0.0, 1.0),
        None => {
            let last = glyphs[glyphs.len() - 1];
            glyphs.len() as f32 + (xr - last.pos.x - last.advance_width) / char_w
        }
    };
    d.window_start as f32 + col
}

