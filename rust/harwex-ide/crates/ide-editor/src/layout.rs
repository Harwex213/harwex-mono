//! Row layout strategies: how logical lines become screen rows. `NoWrap` is the layout every
//! code file uses: one row per line, horizontal scroll. `SoftWrap` (`wrap.rs`) breaks long lines
//! of plain text and Markdown into visual rows. The view asks the strategy of the frame for hit
//! tests, caret moves and scroll targets, so the two never mix.

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

/// One row per logical line.
pub(crate) struct NoWrap<'a> {
    /// Screen position of line 0, display column 0, as drawn last frame.
    pub origin: Pos2,
    pub line_h: f32,
    pub ppp: f32,
    pub char_w: f32,
    pub line_count: usize,
    pub drawn: &'a [DrawnLine],
}

impl RowLayout for NoWrap<'_> {
    // Rows are drawn at `row_top`, so hit tests use the same snapped boundaries.
    fn line_under(&self, _doc: &Document, y: f32) -> usize {
        (line_at_y(self.origin.y, self.line_h, self.ppp, y).max(0) as usize).min(self.line_count.saturating_sub(1))
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
        let line = line_at_y(self.origin.y, self.line_h, self.ppp, y);
        (line >= 0 && (line as usize) < self.line_count).then_some(line as usize)
    }

    fn hover(&self, doc: &Document, p: Pos2) -> Option<Position> {
        let line = line_at_y(self.origin.y, self.line_h, self.ppp, p.y);
        if line < 0 || line as usize >= doc.line_count() {
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

/// Caret moves of the unwrapped layout: logical lines.
pub(crate) struct LineMoves;

impl CaretMoves for LineMoves {
    fn x_col(&self, doc: &Document, idx: usize) -> usize {
        let p = doc.char_to_position(idx);
        display_col(&doc.line(p.line), p.column)
    }

    fn vertical(&self, doc: &Document, idx: usize, rows: isize, want: usize) -> usize {
        editing::vertical(doc, idx, rows, want)
    }

    fn home(&self, doc: &Document, idx: usize) -> usize {
        editing::smart_home(doc, idx)
    }

    fn end(&self, doc: &Document, idx: usize) -> usize {
        editing::line_end_of(doc, idx)
    }

    fn place(&self, doc: &Document, idx: usize) -> (usize, usize) {
        let p = doc.char_to_position(idx);
        (display_col(&doc.line(p.line), p.column), p.line)
    }
}
