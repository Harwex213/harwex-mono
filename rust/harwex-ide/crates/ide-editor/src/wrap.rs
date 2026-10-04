//! Soft wrap: the second row layout strategy (see `layout.rs`). A long line of plain text or
//! Markdown breaks into visual rows at the viewport width. Code files never come here.
//!
//! A visual row is a window of display columns of its logical line, so the row galley is the
//! same `line_job` the unwrapped layout uses for the windows of very long lines.

use std::borrow::Cow;
use std::cell::{Cell, RefCell};
use std::ops::Range;
use std::sync::Arc;

use egui::{Galley, Pos2};
use ropey::RopeSlice;

use crate::document::{Document, Position};
use crate::editing::{self, advance};
use crate::language::Language;
use crate::layout::{CaretMoves, RowLayout};
use crate::view::line_at_y;

/// Where a visual row starts inside its logical line: a char column, its display column and
/// its byte offset in the line text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RowStart {
    pub char: usize,
    pub col: usize,
    pub byte: usize,
}

/// Whether a file wraps when it opens: Markdown, `.txt` and plain text without an extension
/// (LICENSE, notes). Other unknown extensions (`.toml`, `.py`, `.sh`) are code and stay
/// unwrapped, like IDEA's default "*.md; *.txt".
pub fn default_for(path: &std::path::Path, language: Language) -> bool {
    match language {
        Language::Markdown => true,
        Language::Plain => match path.extension().and_then(|e| e.to_str()) {
            None => true,
            Some(e) => matches!(e.to_ascii_lowercase().as_str(), "txt" | "text"),
        },
        _ => false,
    }
}

/// Languages that may use the soft-wrap strategy at all. Code always uses `NoWrap`.
pub fn allowed(language: Language) -> bool {
    matches!(language, Language::Markdown | Language::Plain)
}

/// The leading whitespace of `text` in display columns. Continuation rows are indented by it,
/// like IDEA, unless it takes more than half the width.
pub fn continuation_indent(text: &str, cols: usize) -> usize {
    let mut d = 0;
    for c in text.chars() {
        if c != ' ' && c != '\t' {
            break;
        }
        d = advance(d, c);
    }
    if d * 2 <= cols {
        d
    } else {
        0
    }
}

/// Walks the greedy wrap of `text` at `cols` display columns and reports the start of every
/// row after the first. A row breaks after the last whitespace that fits; a word longer than
/// the row breaks before the char that does not fit. Whitespace never forces a break (it hangs
/// past the edge), and the leading whitespace of the line is no break point. Every row holds at
/// least one char.
fn scan(text: &str, cols: usize, mut on_row: impl FnMut(RowStart)) {
    let cols = cols.max(1);
    let indent = continuation_indent(text, cols);
    let mut avail = cols;
    let mut row = RowStart { char: 0, col: 0, byte: 0 };
    let mut opp: Option<RowStart> = None;
    let mut leading = true;
    let mut d = 0;
    for (i, (b, c)) in text.char_indices().enumerate() {
        let next = advance(d, c);
        if c == ' ' || c == '\t' {
            if !leading {
                opp = Some(RowStart { char: i + 1, col: next, byte: b + 1 });
            }
            d = next;
            continue;
        }
        leading = false;
        while next - row.col > avail && i > row.char {
            let at = match opp.take() {
                Some(o) if o.char > row.char => o,
                _ => RowStart { char: i, col: d, byte: b },
            };
            on_row(at);
            row = at;
            avail = cols - indent;
        }
        d = next;
    }
}

/// Row starts of `text` wrapped at `cols`, the first row (0, 0) included.
pub fn breaks(text: &str, cols: usize) -> Vec<RowStart> {
    let mut out = vec![RowStart { char: 0, col: 0, byte: 0 }];
    if !fits(text, cols) {
        scan(text, cols, |r| out.push(r));
    }
    out
}

/// The number of visual rows of `text` at `cols`.
pub fn count_rows(text: &str, cols: usize) -> usize {
    if fits(text, cols) {
        return 1;
    }
    let mut n = 1;
    scan(text, cols, |_| n += 1);
    n
}

/// A line no wider in bytes than the row and without tabs fits without a scan: its display
/// width is at most its byte length.
fn fits(text: &str, cols: usize) -> bool {
    text.len() <= cols.max(1) && !text.as_bytes().contains(&b'\t')
}

/// The rows of one logical line.
#[derive(Clone, Debug)]
pub struct LineRows {
    pub indent: usize,
    pub starts: Vec<RowStart>,
    /// Chars in the line.
    pub len: usize,
}

impl LineRows {
    pub fn new(text: &str, cols: usize) -> LineRows {
        LineRows { indent: continuation_indent(text, cols.max(1)), starts: breaks(text, cols), len: text.chars().count() }
    }

    pub fn count(&self) -> usize {
        self.starts.len()
    }

    /// The row that holds char column `col`. A column on a row boundary belongs to the next
    /// row, so the caret there is drawn at that row's start.
    pub fn row_of(&self, col: usize) -> usize {
        self.starts.partition_point(|s| s.char <= col).saturating_sub(1)
    }

    /// The chars of row `k`.
    pub fn chars(&self, k: usize) -> Range<usize> {
        let end = self.starts.get(k + 1).map_or(self.len, |s| s.char);
        self.starts[k].char..end
    }

    /// The display columns of row `k` inside the logical line.
    pub fn cols(&self, k: usize, text_cols: usize) -> Range<usize> {
        let end = self.starts.get(k + 1).map_or(text_cols, |s| s.col);
        self.starts[k].col..end
    }

    /// Display columns between the text origin and the row's first glyph.
    pub fn x_offset(&self, k: usize) -> usize {
        if k == 0 {
            0
        } else {
            self.indent
        }
    }

    /// The bytes of row `k` in the line text.
    pub fn bytes(&self, k: usize, text_len: usize) -> Range<usize> {
        let end = self.starts.get(k + 1).map_or(text_len, |s| s.byte);
        self.starts[k].byte..end
    }

    /// The display column of char column `col` on row `k`, counted from the row start, so a
    /// long line costs only its row.
    pub fn display_col(&self, text: &str, k: usize, col: usize) -> usize {
        let s = self.starts[k];
        let mut d = s.col;
        for c in text[s.byte..].chars().take(col.saturating_sub(s.char)) {
            d = advance(d, c);
        }
        d
    }

    /// The char column on row `k` nearest to display column `target` of the line (the same
    /// rounding as `col_from_display`), between the row's first char and its end.
    pub fn col_at(&self, text: &str, k: usize, target: f32) -> usize {
        let s = self.starts[k];
        let end = self.chars(k).end;
        let mut d = s.col;
        for (i, c) in text[s.byte..].chars().take(end - s.char).enumerate() {
            let next = advance(d, c);
            if target < (d + next) as f32 / 2.0 {
                return s.char + i;
            }
            d = next;
        }
        end
    }

    /// The end of row `k`: after its last char. On a row that is not the last this is the
    /// next row's start, and a caret there needs the "leans back" side to be drawn on row `k`.
    pub fn row_end(&self, k: usize) -> usize {
        self.chars(k).end
    }

    /// True when column `col` is the end of row `k` and the start of the next row: the caret
    /// there has two sides (IDEA's affinity).
    pub fn is_boundary(&self, k: usize, col: usize) -> bool {
        k + 1 < self.count() && col == self.starts[k + 1].char
    }
}

/// Lines per block of the prefix sums.
const BLOCK: usize = 256;
/// Chars a sweep re-wraps per frame. A file below it re-wraps in one frame.
pub(crate) const SWEEP_CHARS: usize = 1 << 20;

/// The visual row count of every line, with block prefix sums, so line↔row lookups cost at
/// most one block of adds. Counts of lines that a sweep has not reached yet are estimates
/// (the count at the old width, or 1); visible lines are always exact.
pub(crate) struct WrapMap {
    cols: usize,
    version: u64,
    rows: Vec<u32>,
    /// First row of each block of `BLOCK` lines.
    blocks: Vec<usize>,
    total: usize,
    /// The next line a running sweep re-wraps.
    sweep: Option<usize>,
    /// The first block whose prefix sum is out of date.
    dirty: usize,
    /// Bumps whenever a count changes.
    gen: u64,
    valid: bool,
    /// The rows of the last few long lines, keyed by (line, doc version, width), so a frame
    /// on a giant line scans it once, not once per use.
    long: Vec<(usize, u64, usize, Arc<LineRows>)>,
}

/// Lines at least this long (in bytes) keep their rows in `WrapMap::long`.
const LONG_ROWS: usize = 4096;

impl Default for WrapMap {
    fn default() -> Self {
        WrapMap { cols: 0, version: 0, rows: Vec::new(), blocks: Vec::new(), total: 0, sweep: None, dirty: usize::MAX, gen: 0, valid: false, long: Vec::new() }
    }
}

/// A line of the rope without its `\n`, borrowed when it lies in one chunk.
fn slice_text(s: RopeSlice<'_>) -> Cow<'_, str> {
    let n = s.len_chars();
    let s = if n > 0 && s.char(n - 1) == '\n' { s.slice(..n - 1) } else { s };
    match s.as_str() {
        Some(t) => Cow::Borrowed(t),
        None => Cow::Owned(s.to_string()),
    }
}

impl WrapMap {
    pub fn gen(&self) -> u64 {
        self.gen
    }

    pub fn cols(&self) -> usize {
        self.cols
    }

    pub fn sweeping(&self) -> bool {
        self.sweep.is_some()
    }

    /// The rows of `line` (its text is `text`) at `cols`. Long lines come from a small cache.
    pub fn line_rows(&mut self, version: u64, line: usize, text: &str, cols: usize) -> Arc<LineRows> {
        if text.len() < LONG_ROWS {
            return Arc::new(LineRows::new(text, cols));
        }
        if let Some(e) = self.long.iter().find(|e| e.0 == line && e.1 == version && e.2 == cols) {
            return e.3.clone();
        }
        let rows = Arc::new(LineRows::new(text, cols));
        if self.long.len() >= 8 {
            self.long.remove(0);
        }
        self.long.push((line, version, cols, rows.clone()));
        rows
    }

    /// Forgets everything; the next `sync` starts over.
    pub fn reset(&mut self) {
        *self = WrapMap { gen: self.gen + 1, ..WrapMap::default() };
    }

    /// Brings the counts up to date with the text and the width, and runs one sweep slice.
    pub fn sync(&mut self, doc: &Document, cols: usize) {
        let n = doc.line_count().max(1);
        if !self.valid {
            self.rows = vec![1; n];
            self.cols = cols;
            self.version = doc.version();
            self.sweep = Some(0);
            self.valid = true;
            self.dirty = 0;
            self.gen += 1;
        }
        if doc.version() != self.version {
            match doc.changes_since(self.version) {
                Some(changes) if !changes.is_empty() => self.apply_changes(doc, &changes),
                Some(_) => {}
                None => {
                    self.rows.resize(n, 1);
                    self.sweep = Some(0);
                    self.mark(0);
                }
            }
            self.version = doc.version();
        }
        if self.rows.len() != n {
            // A change the envelope missed (it never should): count everything again.
            self.rows.resize(n, 1);
            self.sweep = Some(0);
            self.mark(0);
        }
        if cols != self.cols {
            self.cols = cols;
            self.sweep = Some(0);
        }
        if let Some(from) = self.sweep {
            self.run_sweep(doc, from);
        }
        self.fix();
    }

    fn apply_changes(&mut self, doc: &Document, changes: &[crate::document::TextChange]) {
        // One envelope over all changes, in chars of the current text.
        let (mut lo, mut hi) = (usize::MAX, 0);
        for c in changes {
            if lo == usize::MAX {
                lo = c.start;
                hi = c.start + c.inserted;
            } else {
                lo = c.map(lo, false).min(c.start);
                hi = c.map(hi, true).max(c.start + c.inserted);
            }
        }
        let n = doc.line_count();
        let l0 = doc.char_to_position(lo).line;
        let l1 = doc.char_to_position(hi).line.max(l0);
        let delta = n as isize - self.rows.len() as isize;
        let old_end = ((l1 as isize - delta + 1).max(l0 as isize) as usize).min(self.rows.len());
        let l0 = l0.min(self.rows.len());
        if l1 - l0 > 4096 {
            // A wide spread of edits (Replace All, many carets): estimate and sweep.
            self.rows.splice(l0..old_end, std::iter::repeat_n(1, (l1 + 1).min(n) - l0));
            self.sweep = Some(self.sweep.map_or(l0, |s| s.min(l0)));
        } else {
            let version = doc.version();
            let cols = self.cols;
            let fresh: Vec<u32> = (l0..(l1 + 1).min(n))
                .map(|l| {
                    let text = doc.line(l);
                    if text.len() < LONG_ROWS {
                        count_rows(&text, cols) as u32
                    } else {
                        // The view needs the rows of this line again this frame.
                        self.line_rows(version, l, &text, cols).count() as u32
                    }
                })
                .collect();
            self.rows.splice(l0..old_end, fresh);
            if let Some(s) = self.sweep {
                // The sweep cursor follows the lines it was about to read.
                self.sweep = Some(if s > l1 { (s as isize + delta).max(l0 as isize) as usize } else { s });
            }
        }
        self.mark(l0);
    }

    fn run_sweep(&mut self, doc: &Document, from: usize) {
        let n = self.rows.len();
        let mut budget = SWEEP_CHARS;
        let mut line = from;
        let mut changed_from = usize::MAX;
        for s in doc.rope().lines_at(from.min(doc.line_count())) {
            if line >= n || budget == 0 {
                break;
            }
            let len = s.len_chars();
            let count = count_rows(&slice_text(s), self.cols) as u32;
            if self.rows[line] != count {
                self.rows[line] = count;
                changed_from = changed_from.min(line);
            }
            budget = budget.saturating_sub(len.max(1));
            line += 1;
        }
        self.sweep = (line < n).then_some(line);
        if changed_from != usize::MAX {
            self.mark(changed_from);
        }
    }

    /// Sets the exact count of a line the view just wrapped.
    pub fn set(&mut self, line: usize, count: usize) {
        if let Some(r) = self.rows.get_mut(line) {
            if *r as usize != count {
                *r = count as u32;
                self.mark(line);
            }
        }
    }

    fn mark(&mut self, line: usize) {
        self.dirty = self.dirty.min(line / BLOCK);
        self.gen += 1;
    }

    /// Rebuilds the prefix sums from the first dirty block.
    pub fn fix(&mut self) {
        if self.dirty == usize::MAX {
            return;
        }
        let nb = self.rows.len().div_ceil(BLOCK);
        self.blocks.resize(nb, 0);
        let from = self.dirty.min(nb);
        let mut acc = if from == 0 { 0 } else { self.blocks[from - 1] + self.block_sum(from - 1) };
        for b in from..nb {
            self.blocks[b] = acc;
            acc += self.block_sum(b);
        }
        self.total = acc;
        self.dirty = usize::MAX;
    }

    fn block_sum(&self, b: usize) -> usize {
        let end = ((b + 1) * BLOCK).min(self.rows.len());
        self.rows[b * BLOCK..end].iter().map(|&r| r as usize).sum()
    }

    pub fn total(&self) -> usize {
        self.total.max(1)
    }

    pub fn line_count(&self) -> usize {
        self.rows.len()
    }

    pub fn rows(&self, line: usize) -> usize {
        self.rows.get(line).map_or(1, |&r| r as usize)
    }

    /// The first visual row of `line`. Past the last line it is the row count.
    pub fn row_of_line(&self, line: usize) -> usize {
        if line >= self.rows.len() {
            return self.total;
        }
        let b = line / BLOCK;
        self.blocks[b] + self.rows[b * BLOCK..line].iter().map(|&r| r as usize).sum::<usize>()
    }

    /// The line that holds visual `row`, and the row inside it. Past the end it is the last
    /// line with a row index past its count.
    pub fn line_of_row(&self, row: usize) -> (usize, usize) {
        if self.rows.is_empty() {
            return (0, row);
        }
        let b = self.blocks.partition_point(|&s| s <= row).saturating_sub(1);
        let mut first = self.blocks[b];
        let end = ((b + 1) * BLOCK).min(self.rows.len());
        for line in b * BLOCK..end {
            let r = self.rows[line] as usize;
            if row < first + r || line + 1 == self.rows.len() {
                return (line, row - first);
            }
            first += r;
        }
        let last = self.rows.len() - 1;
        (last, row - self.row_of_line(last))
    }
}

/// One visual row as drawn last frame, for hit tests against the real glyphs.
pub(crate) struct DrawnRow {
    pub line: usize,
    /// The row inside its line.
    pub row: usize,
    /// The galley's left edge, relative to the text origin.
    pub x: f32,
    pub galley: Arc<Galley>,
}

/// The fractional glyph column at `xr` (relative to the galley's left edge). Past the last
/// glyph it continues in `char_w` steps.
fn glyph_col(g: &Galley, xr: f32, char_w: f32) -> f32 {
    let glyphs = g.rows.first().map_or(&[][..], |r| &r.glyphs[..]);
    if xr < 0.0 || glyphs.is_empty() {
        return xr / char_w;
    }
    let i = glyphs.partition_point(|g| g.pos.x + g.advance_width <= xr);
    match glyphs.get(i) {
        Some(g) => i as f32 + ((xr - g.pos.x) / g.advance_width.max(0.01)).clamp(0.0, 1.0),
        None => {
            let last = glyphs[glyphs.len() - 1];
            glyphs.len() as f32 + (xr - last.pos.x - last.advance_width) / char_w
        }
    }
}

/// The wrap width a map was built for; a map that never synced wraps nothing.
fn map_cols(map: &WrapMap) -> usize {
    if map.cols() == 0 {
        usize::MAX / 4
    } else {
        map.cols()
    }
}

/// Hit tests of the soft-wrapped layout, against the rows drawn last frame.
pub(crate) struct SoftWrap<'a> {
    pub map: &'a RefCell<WrapMap>,
    pub drawn: &'a [DrawnRow],
    /// Screen position of row 0, display column 0.
    pub origin: Pos2,
    pub line_h: f32,
    pub ppp: f32,
    pub char_w: f32,
    /// Set by `hit` when the point lies past the end of a wrapped row: the caret leans back.
    pub lean: Cell<bool>,
}

/// A visual row under a screen y: its line, the line's rows and the row inside them.
struct RowHit {
    line: usize,
    k: usize,
    text: String,
    rows: Arc<LineRows>,
    /// The y is on a real row (not above the first or below the last).
    inside: bool,
}

impl SoftWrap<'_> {
    fn row_under(&self, doc: &Document, y: f32) -> RowHit {
        let mut map = self.map.borrow_mut();
        let r = line_at_y(self.origin.y, self.line_h, self.ppp, y);
        let inside = r >= 0 && (r as usize) < map.total();
        let (line, k) = map.line_of_row(r.max(0) as usize);
        let line = line.min(doc.line_count().saturating_sub(1));
        let text = doc.line(line);
        let cols = map_cols(&map);
        let rows = map.line_rows(doc.version(), line, &text, cols);
        let k = k.min(rows.count() - 1);
        RowHit { line, k, text, rows, inside }
    }

    /// The fractional display column of `x` inside the logical line, on row `h.k`.
    fn col_at(&self, h: &RowHit, x: f32) -> f32 {
        let base = h.rows.starts[h.k].col as f32;
        match self.drawn.iter().find(|d| d.line == h.line && d.row == h.k) {
            Some(d) => base + glyph_col(&d.galley, x - (self.origin.x + d.x), self.char_w),
            None => base + (x - self.origin.x) / self.char_w - h.rows.x_offset(h.k) as f32,
        }
    }
}

impl RowLayout for SoftWrap<'_> {
    fn line_under(&self, doc: &Document, y: f32) -> usize {
        self.row_under(doc, y).line
    }

    fn hit(&self, doc: &Document, p: Pos2) -> usize {
        let h = self.row_under(doc, p.y);
        let d = self.col_at(&h, p.x);
        let col = h.rows.col_at(&h.text, h.k, d);
        self.lean.set(h.rows.is_boundary(h.k, col));
        doc.line_start(h.line) + col
    }

    fn cell(&self, doc: &Document, p: Pos2) -> (usize, f32) {
        let h = self.row_under(doc, p.y);
        (h.line, self.col_at(&h, p.x).max(0.0))
    }

    fn gutter_line(&self, doc: &Document, y: f32) -> Option<usize> {
        let h = self.row_under(doc, y);
        h.inside.then_some(h.line)
    }

    fn leans(&self) -> bool {
        self.lean.get()
    }

    fn hover(&self, doc: &Document, p: Pos2) -> Option<Position> {
        let h = self.row_under(doc, p.y);
        if !h.inside {
            return None;
        }
        let col = h.rows.col_at(&h.text, h.k, self.col_at(&h, p.x) - 0.5);
        (col < h.rows.chars(h.k).end).then_some(Position::new(h.line, col))
    }
}

/// Caret moves by visual rows. Rows come from the line text, so moves need no row table;
/// only `place` (scroll targets) reads it.
pub(crate) struct RowMoves<'a> {
    pub cols: usize,
    pub map: &'a RefCell<WrapMap>,
    /// Caret heads on a row boundary that sit at the end of the upper row.
    pub lean_in: RefCell<Vec<usize>>,
    /// The move targets that land on a row end and lean back.
    pub lean_out: RefCell<Vec<usize>>,
}

impl RowMoves<'_> {
    fn rows(&self, doc: &Document, line: usize, text: &str) -> Arc<LineRows> {
        self.map.borrow_mut().line_rows(doc.version(), line, text, self.cols)
    }

    fn at(&self, doc: &Document, idx: usize) -> (usize, String, Arc<LineRows>, usize) {
        let p = doc.char_to_position(idx);
        let text = doc.line(p.line);
        let rows = self.rows(doc, p.line, &text);
        let mut k = rows.row_of(p.column);
        if k > 0 && rows.starts[k].char == p.column && self.lean_in.borrow().contains(&idx) {
            k -= 1;
        }
        (p.line, text, rows, k)
    }

    /// `col` on row `k` of `line` as a char index, noting the side when it is a row end.
    fn land(&self, doc: &Document, line: usize, rows: &LineRows, k: usize, col: usize) -> usize {
        let idx = doc.line_start(line) + col;
        if rows.is_boundary(k, col) {
            self.lean_out.borrow_mut().push(idx);
        }
        idx
    }
}

impl CaretMoves for RowMoves<'_> {
    fn x_col(&self, doc: &Document, idx: usize) -> usize {
        let (_, text, rows, k) = self.at(doc, idx);
        let col = doc.char_to_position(idx).column;
        rows.x_offset(k) + rows.display_col(&text, k, col) - rows.starts[k].col
    }

    fn vertical(&self, doc: &Document, idx: usize, n: isize, want: usize) -> usize {
        let (mut line, mut text, mut rows, mut k) = self.at(doc, idx);
        let last = doc.line_count().saturating_sub(1);
        for _ in 0..n.unsigned_abs() {
            if n < 0 {
                if k > 0 {
                    k -= 1;
                } else if line == 0 {
                    return 0;
                } else {
                    line -= 1;
                    text = doc.line(line);
                    rows = self.rows(doc, line, &text);
                    k = rows.count() - 1;
                }
            } else if k + 1 < rows.count() {
                k += 1;
            } else if line >= last {
                return doc.len_chars();
            } else {
                line += 1;
                text = doc.line(line);
                rows = self.rows(doc, line, &text);
                k = 0;
            }
        }
        let d = rows.starts[k].col + want.saturating_sub(rows.x_offset(k));
        let col = rows.col_at(&text, k, d as f32);
        self.land(doc, line, &rows, k, col)
    }

    /// IDEA: the first press goes to the start of the visual row, the next one to the logical
    /// line (first non-blank, then column 0).
    fn home(&self, doc: &Document, idx: usize) -> usize {
        let (line, _, rows, k) = self.at(doc, idx);
        let start = rows.starts[k].char;
        if k > 0 && doc.char_to_position(idx).column != start {
            doc.line_start(line) + start
        } else {
            editing::smart_home(doc, idx)
        }
    }

    /// The end of the visual row first, then the end of the logical line.
    fn end(&self, doc: &Document, idx: usize) -> usize {
        let (line, _, rows, k) = self.at(doc, idx);
        let end = rows.row_end(k);
        if k + 1 < rows.count() && doc.char_to_position(idx).column != end {
            self.land(doc, line, &rows, k, end)
        } else {
            editing::line_end_of(doc, idx)
        }
    }

    fn place(&self, doc: &Document, idx: usize) -> (usize, usize) {
        let (line, _, _, k) = self.at(doc, idx);
        (self.x_col(doc, idx), self.map.borrow().row_of_line(line) + k)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::{EditKind, Selection};

    fn rows_of(text: &str, cols: usize) -> Vec<String> {
        let chars: Vec<char> = text.chars().collect();
        let b = breaks(text, cols);
        (0..b.len())
            .map(|k| {
                let end = b.get(k + 1).map_or(chars.len(), |s| s.char);
                chars[b[k].char..end].iter().collect()
            })
            .collect()
    }

    #[test]
    fn breaks_after_the_last_space_that_fits() {
        // The space after "bbb" hangs past the edge.
        assert_eq!(rows_of("aaa bbb ccc", 7), ["aaa bbb ", "ccc"]);
        assert_eq!(rows_of("aaa bbb ccc", 6), ["aaa ", "bbb ", "ccc"]);
        assert_eq!(rows_of("aaa bbb ccc", 11), ["aaa bbb ccc"]);
        assert_eq!(rows_of("short", 10), ["short"]);
        assert_eq!(count_rows("aaa bbb ccc", 4), 3);
    }

    #[test]
    fn long_words_break_hard() {
        assert_eq!(rows_of("abcdefghij", 4), ["abcd", "efgh", "ij"]);
        assert_eq!(rows_of("ab abcdefghij", 4), ["ab ", "abcd", "efgh", "ij"]);
    }

    #[test]
    fn continuation_rows_keep_the_indent() {
        // Indent 2: rows after the first have 8 - 2 = 6 columns.
        assert_eq!(rows_of("  aaa bbb ccc ddd", 8), ["  aaa ", "bbb ", "ccc ", "ddd"]);
        let r = LineRows::new("  aaa bbb ccc ddd", 8);
        assert_eq!((r.indent, r.x_offset(0), r.x_offset(1)), (2, 0, 2));
        // An indent over half the width is dropped.
        assert_eq!(continuation_indent("      x", 10), 0);
    }

    #[test]
    fn spaces_hang_and_leading_space_is_no_break() {
        assert_eq!(rows_of("aaa      bbb", 5), ["aaa      ", "bbb"]);
        assert_eq!(rows_of("    abcdefgh", 8), ["    abcd", "efgh"]);
    }

    #[test]
    fn row_lookup_on_boundaries() {
        let r = LineRows::new("aaa bbb ccc", 4);
        assert_eq!(r.count(), 3);
        assert_eq!((r.row_of(0), r.row_of(3), r.row_of(4), r.row_of(11)), (0, 0, 1, 2));
        assert_eq!(r.chars(1), 4..8);
        assert_eq!((r.row_end(0), r.row_end(2)), (4, 11));
        assert!(r.is_boundary(0, 4) && !r.is_boundary(2, 11) && !r.is_boundary(0, 3));
    }

    #[test]
    fn map_follows_edits() {
        let mut doc = Document::from_text("aaa bbb ccc\nx\naaa bbb\n", Language::Plain);
        let mut m = WrapMap::default();
        m.sync(&doc, 4);
        assert_eq!((0..4).map(|l| m.rows(l)).collect::<Vec<_>>(), [3, 1, 2, 1]);
        assert_eq!(m.total(), 7);
        assert_eq!(m.row_of_line(2), 4);
        assert_eq!(m.line_of_row(5), (2, 1));
        assert_eq!(m.line_of_row(99), (3, 99 - 6));

        // Insert a wrapped line above, then join two lines.
        let s = Selection::caret(12);
        doc.edit(12..12, "ddd eee\n", s, s, EditKind::Other);
        m.sync(&doc, 4);
        assert_eq!((0..5).map(|l| m.rows(l)).collect::<Vec<_>>(), [3, 2, 1, 2, 1]);
        doc.edit(11..12, " ", s, s, EditKind::Other);
        m.sync(&doc, 4);
        assert_eq!(doc.line(0), "aaa bbb ccc ddd eee");
        assert_eq!((0..4).map(|l| m.rows(l)).collect::<Vec<_>>(), [5, 1, 2, 1]);
        assert_eq!(m.total(), 9);

        // A new width re-wraps every line.
        m.sync(&doc, 100);
        assert_eq!(m.total(), 4);
    }

    #[test]
    fn many_lines_cross_blocks() {
        let text: String = (0..1000).map(|i| if i % 3 == 0 { "aaa bbb\n" } else { "a\n" }).collect();
        let doc = Document::from_text(&text, Language::Plain);
        let mut m = WrapMap::default();
        m.sync(&doc, 4);
        let mut row = 0;
        for l in 0..doc.line_count() {
            assert_eq!(m.row_of_line(l), row, "line {l}");
            assert_eq!(m.line_of_row(row), (l, 0));
            row += m.rows(l);
        }
        assert_eq!(m.total(), row);
    }
}
