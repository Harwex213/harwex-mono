//! Row layout strategies: how logical lines become screen rows. `NoWrap` is the layout every
//! code file uses: one row per line, horizontal scroll. `SoftWrap` (`wrap.rs`) breaks long lines
//! of plain text and Markdown into visual rows. The view asks the strategy of the frame for hit
//! tests, caret moves and scroll targets, so the two never mix.

use std::ops::Range;

use egui::Pos2;

use crate::document::{Document, Position};
use crate::editing::{self, col_from_display, display_col};
use crate::view::{display_col_at, line_at_y, DrawnLine};

/// Screen hit tests against what the last frame drew.
pub(crate) trait RowLayout {
    /// The logical line under screen `y`, clamped to the document.
    fn line_under(&self, doc: &Document, y: f32) -> usize;
    /// The char boundary nearest to `p`.
    fn hit(&self, doc: &Document, p: Pos2) -> usize;
    /// The line and fractional display column under `p`, for column selection.
    fn cell(&self, doc: &Document, p: Pos2) -> (usize, f32);
    /// The line of a gutter press at `y`; `None` above the first or below the last row.
    fn gutter_line(&self, doc: &Document, y: f32) -> Option<usize>;
    /// The char under `p` (not the nearest boundary); `None` past the end of its row.
    fn hover(&self, doc: &Document, p: Pos2) -> Option<Position>;
    /// After `hit`: the index is the end of a wrapped row, drawn at that row's end (soft wrap
    /// only).
    fn leans(&self) -> bool {
        false
    }
}

/// Caret moves that depend on rows, and the content-space place of a char for scrolling.
pub(crate) trait CaretMoves {
    /// The x that Up and Down keep, in display columns from the text origin.
    fn x_col(&self, doc: &Document, idx: usize) -> usize;
    /// `rows` rows up (negative) or down, at the x `want`.
    fn vertical(&self, doc: &Document, idx: usize, rows: isize, want: usize) -> usize;
    fn home(&self, doc: &Document, idx: usize) -> usize;
    fn end(&self, doc: &Document, idx: usize) -> usize;
    /// Where `idx` sits in the content: (display columns from the text origin, visual row).
    fn place(&self, doc: &Document, idx: usize) -> (usize, usize);
}

/// A folded run of lines: the lines hide behind one placeholder row that shows `label`. The
/// app owns the list (`EditorState::set_folds`); the view only draws it and reports a click.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Fold {
    pub lines: Range<usize>,
    pub label: String,
}

/// Row and line mapping of the unwrapped layout with folds. Without folds a row is a line,
/// and every call returns at once. The fold list is short (a merge window's unchanged runs),
/// so a linear walk is cheaper than a prefix table that would need rebuilding per edit.
#[derive(Clone, Copy)]
pub(crate) struct FoldMap<'a> {
    pub folds: &'a [Fold],
}

impl FoldMap<'_> {
    pub fn is_empty(&self) -> bool {
        self.folds.is_empty()
    }

    /// The row of `line`; a hidden line gives its fold's row.
    pub fn row_of_line(&self, line: usize) -> usize {
        let mut hidden = 0;
        for f in self.folds {
            if f.lines.end <= line {
                hidden += f.lines.len() - 1;
            } else if f.lines.start <= line {
                return f.lines.start - hidden;
            } else {
                break;
            }
        }
        line - hidden
    }

    /// The first line of `row`, and the fold index when the row is a fold's placeholder.
    pub fn line_of_row(&self, row: usize) -> (usize, Option<usize>) {
        let mut hidden = 0;
        for (i, f) in self.folds.iter().enumerate() {
            let fold_row = f.lines.start - hidden;
            if row < fold_row {
                break;
            }
            if row == fold_row {
                return (f.lines.start, Some(i));
            }
            hidden += f.lines.len() - 1;
        }
        (row + hidden, None)
    }

    /// The fold that hides `line`, if any.
    pub fn fold_of_line(&self, line: usize) -> Option<usize> {
        self.folds.iter().position(|f| f.lines.contains(&line))
    }

    pub fn rows(&self, line_count: usize) -> usize {
        line_count.saturating_sub(self.folds.iter().map(|f| f.lines.len() - 1).sum::<usize>())
    }
}

/// Keeps the folds that fit the document: sorted, non-empty, inside the text, not
/// overlapping.
pub(crate) fn valid_folds(folds: &mut Vec<Fold>, line_count: usize) {
    folds.retain(|f| !f.lines.is_empty() && f.lines.end <= line_count);
    folds.sort_by_key(|f| f.lines.start);
    let mut end = 0;
    folds.retain(|f| {
        let ok = f.lines.start >= end;
        if ok {
            end = f.lines.end;
        }
        ok
    });
}

/// One row per logical line.
pub(crate) struct NoWrap<'a> {
    /// Screen position of line 0, display column 0, as drawn last frame.
    pub origin: Pos2,
    pub line_h: f32,
    pub ppp: f32,
    pub char_w: f32,
    pub line_count: usize,
    pub drawn: &'a [DrawnLine],
    pub folds: FoldMap<'a>,
}

impl NoWrap<'_> {
    /// The line under screen `y` (a fold row gives its first line), unclamped below 0.
    fn line_at(&self, y: f32) -> isize {
        let row = line_at_y(self.origin.y, self.line_h, self.ppp, y);
        if row < 0 || self.folds.is_empty() {
            return row;
        }
        self.folds.line_of_row(row as usize).0 as isize
    }

    /// The fold whose placeholder row holds screen `y`.
    pub fn fold_at(&self, y: f32) -> Option<usize> {
        let row = line_at_y(self.origin.y, self.line_h, self.ppp, y);
        if row < 0 || self.folds.is_empty() {
            return None;
        }
        self.folds.line_of_row(row as usize).1
    }
}

impl RowLayout for NoWrap<'_> {
    // Rows are drawn at `row_top`, so hit tests use the same snapped boundaries.
    fn line_under(&self, _doc: &Document, y: f32) -> usize {
        (self.line_at(y).max(0) as usize).min(self.line_count.saturating_sub(1))
    }

    // Column boundary nearest to `p`, measured on the glyphs drawn last frame when the line
    // was on screen.
    fn hit(&self, doc: &Document, p: Pos2) -> usize {
        let line = self.line_under(doc, p.y);
        let text = doc.line(line);
        let d = display_col_at(self.drawn, line, p.x - self.origin.x, self.char_w);
        doc.line_start(line) + col_from_display(&text, d)
    }

    fn cell(&self, doc: &Document, p: Pos2) -> (usize, f32) {
        let line = self.line_under(doc, p.y);
        (line, display_col_at(self.drawn, line, p.x - self.origin.x, self.char_w).max(0.0))
    }

    fn gutter_line(&self, _doc: &Document, y: f32) -> Option<usize> {
        let line = self.line_at(y);
        (line >= 0 && (line as usize) < self.line_count).then_some(line as usize)
    }

    fn hover(&self, doc: &Document, p: Pos2) -> Option<Position> {
        let line = self.line_at(p.y);
        if line < 0 || line as usize >= doc.line_count() || self.fold_at(p.y).is_some() {
            return None;
        }
        let line = line as usize;
        let text = doc.line(line);
        // The char under the pointer, not the nearest boundary.
        let d = display_col_at(self.drawn, line, p.x - self.origin.x, self.char_w);
        let col = col_from_display(&text, d - 0.5);
        (col < text.chars().count()).then_some(Position::new(line, col))
    }
}

/// Caret moves of the unwrapped layout: logical lines. Up and Down step over a fold.
pub(crate) struct LineMoves<'a> {
    pub folds: FoldMap<'a>,
}

impl CaretMoves for LineMoves<'_> {
    fn x_col(&self, doc: &Document, idx: usize) -> usize {
        let p = doc.char_to_position(idx);
        display_col(&doc.line(p.line), p.column)
    }

    fn vertical(&self, doc: &Document, idx: usize, rows: isize, want: usize) -> usize {
        if self.folds.is_empty() {
            return editing::vertical(doc, idx, rows, want);
        }
        let line = doc.char_to_position(idx).line;
        let last = doc.line_count().saturating_sub(1);
        let row = self.folds.row_of_line(line) as isize + rows;
        if row < 0 {
            return 0;
        }
        let total = self.folds.rows(doc.line_count());
        if row as usize >= total {
            return doc.len_chars();
        }
        // A fold row is not text: the caret lands on the line past it, in the move's direction.
        let target = match self.folds.line_of_row(row as usize) {
            (_, Some(i)) if rows > 0 => (self.folds.folds[i].lines.end).min(last),
            (_, Some(i)) => self.folds.folds[i].lines.start.saturating_sub(1),
            (l, None) => l,
        };
        editing::vertical(doc, idx, target as isize - line as isize, want)
    }

    fn home(&self, doc: &Document, idx: usize) -> usize {
        editing::smart_home(doc, idx)
    }

    fn end(&self, doc: &Document, idx: usize) -> usize {
        editing::line_end_of(doc, idx)
    }

    fn place(&self, doc: &Document, idx: usize) -> (usize, usize) {
        let p = doc.char_to_position(idx);
        (display_col(&doc.line(p.line), p.column), self.folds.row_of_line(p.line))
    }
}
