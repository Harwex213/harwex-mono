//! Text selection in the diff panes. Each side keeps its own caret and selection, like IDEA:
//! a selection never spans both sides. Both sides are read-only, so the only text commands are
//! the moves, Select All and Copy.
//!
//! The rules follow the editor (`ide_editor::EditorView`): presses are counted on press with
//! `ClickChain` (1 caret, 2 word, 3 and more the line), a drag extends by the unit of its press,
//! and Shift, Alt and Cmd presses end the chain.

use std::ops::Range;

use ide_editor::{editing, Document};

/// One side of the side-by-side diff.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    /// The left side: HEAD, the parent commit or the older revision.
    Old,
    /// The right side: the working tree or the newer revision.
    New,
}

/// What a drag extends by: the unit of the press that started it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Unit {
    Char,
    Word,
    Line,
}

/// The caret and selection of one side, as char indices into that side's text.
#[derive(Clone, Debug)]
pub(super) struct PaneSel {
    pub side: Side,
    pub anchor: usize,
    pub head: usize,
    pub unit: Unit,
    /// The word or line the press selected. A word or line drag always keeps it.
    pub origin: Range<usize>,
    /// The char column Up and Down aim at, kept across vertical moves.
    pub goal_col: Option<usize>,
}

impl PaneSel {
    pub fn caret(side: Side, at: usize) -> PaneSel {
        PaneSel { side, anchor: at, head: at, unit: Unit::Char, origin: at..at, goal_col: None }
    }

    /// The selection a press with chain count `count` makes at `at`.
    pub fn press(side: Side, doc: &Document, at: usize, count: u32) -> PaneSel {
        let (unit, range) = match count {
            0 | 1 => (Unit::Char, at..at),
            2 => (Unit::Word, editing::word_range(doc, at)),
            _ => (Unit::Line, line_range(doc, at)),
        };
        PaneSel { side, anchor: range.start, head: range.end, unit, origin: range, goal_col: None }
    }

    pub fn range(&self) -> Range<usize> {
        self.anchor.min(self.head)..self.anchor.max(self.head)
    }

    pub fn is_empty(&self) -> bool {
        self.anchor == self.head
    }

    /// Moves the head to `at` (a drag or a Shift press), by the unit of the press.
    pub fn extend(&mut self, doc: &Document, at: usize) {
        self.goal_col = None;
        let o = self.origin.clone();
        let (start, end) = match self.unit {
            Unit::Char => {
                self.head = at;
                return;
            }
            Unit::Word => {
                let w = editing::word_range(doc, at);
                (w.start, w.end)
            }
            Unit::Line => {
                let l = line_range(doc, at);
                (l.start, l.end)
            }
        };
        if start < o.start {
            self.anchor = o.end;
            self.head = start;
        } else {
            self.anchor = o.start;
            self.head = end.max(o.end);
        }
    }

    /// Keeps the indices inside a text that changed under the selection (a reload).
    pub fn clamp(&mut self, len: usize) {
        self.anchor = self.anchor.min(len);
        self.head = self.head.min(len);
        self.origin = self.origin.start.min(len)..self.origin.end.min(len);
    }
}

/// The line under `at`, with its line break: what a third press selects.
pub(super) fn line_range(doc: &Document, at: usize) -> Range<usize> {
    let line = doc.char_to_position(at).line;
    doc.line_start(line)..doc.line_start(line + 1).max(doc.line_end(line))
}

/// A caret move from the keyboard.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Move {
    Left,
    Right,
    WordLeft,
    WordRight,
    Up(usize),
    Down(usize),
    LineStart,
    LineEnd,
    DocStart,
    DocEnd,
}

/// Applies `mv` to `sel`. With `extend` (Shift) the anchor stays; without it a selection first
/// collapses to its edge in the direction of a Left or Right move.
pub(super) fn apply_move(sel: &mut PaneSel, doc: &Document, mv: Move, extend: bool) {
    let len = doc.len_chars();
    let head = sel.head.min(len);
    let r = sel.range();
    let pos = doc.char_to_position(head);
    let mut goal = None;
    let to = match mv {
        Move::Left if !extend && !sel.is_empty() => r.start,
        Move::Right if !extend && !sel.is_empty() => r.end,
        Move::Left => head.saturating_sub(1),
        Move::Right => (head + 1).min(len),
        Move::WordLeft => editing::word_left(doc, head),
        Move::WordRight => editing::word_right(doc, head),
        Move::Up(n) | Move::Down(n) => {
            let col = sel.goal_col.unwrap_or(pos.column);
            goal = Some(col);
            let last = doc.line_count().saturating_sub(1);
            let line = if matches!(mv, Move::Up(_)) { pos.line.checked_sub(n) } else { Some(pos.line + n).filter(|&l| l <= last) };
            match line {
                Some(l) => doc.line_start(l) + col.min(doc.line_len(l)),
                // Past the first or last line the caret goes to the text's edge, like the editor.
                None if matches!(mv, Move::Up(_)) => 0,
                None => len,
            }
        }
        Move::LineStart => doc.line_start(pos.line),
        Move::LineEnd => doc.line_end(pos.line),
        Move::DocStart => 0,
        Move::DocEnd => len,
    };
    sel.head = to;
    if !extend {
        sel.anchor = to;
    }
    sel.unit = Unit::Char;
    sel.origin = to..to;
    sel.goal_col = goal;
}

/// The char column a display column (tabs drawn as 4 spaces) falls on. A column inside a tab
/// rounds to the nearer edge of the tab.
pub(super) fn char_col(text: &str, display: usize) -> usize {
    let mut d = 0usize;
    for (i, c) in text.chars().enumerate() {
        let w = if c == '\t' { 4 } else { 1 };
        if display < d + w {
            return if display - d < w.div_ceil(2) { i } else { i + 1 };
        }
        d += w;
    }
    text.chars().count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ide_editor::Language;

    fn doc(text: &str) -> Document {
        Document::from_text(text, Language::Plain)
    }

    #[test]
    fn presses_select_caret_word_and_line() {
        let d = doc("let alpha = 1;\nnext\n");
        let s = PaneSel::press(Side::Old, &d, 6, 1);
        assert_eq!(s.range(), 6..6);
        let s = PaneSel::press(Side::Old, &d, 6, 2);
        assert_eq!(d.slice(s.range()), "alpha");
        let s = PaneSel::press(Side::Old, &d, 6, 3);
        assert_eq!(d.slice(s.range()), "let alpha = 1;\n");
    }

    #[test]
    fn word_drag_keeps_the_pressed_word() {
        let d = doc("one two three");
        let mut s = PaneSel::press(Side::New, &d, 5, 2);
        s.extend(&d, 10);
        assert_eq!(d.slice(s.range()), "two three");
        s.extend(&d, 1);
        assert_eq!(d.slice(s.range()), "one two");
        assert_eq!(s.head, 0);
    }

    #[test]
    fn line_drag_extends_by_lines() {
        let d = doc("a\nbb\nccc\n");
        let mut s = PaneSel::press(Side::New, &d, 3, 3);
        s.extend(&d, 7);
        assert_eq!(d.slice(s.range()), "bb\nccc\n");
        s.extend(&d, 0);
        assert_eq!(d.slice(s.range()), "a\nbb\n");
    }

    #[test]
    fn moves_collapse_extend_and_keep_the_goal_column() {
        let d = doc("abcdef\nxy\nlonger line\n");
        let mut s = PaneSel::caret(Side::Old, 4);
        apply_move(&mut s, &d, Move::Down(1), false);
        assert_eq!(d.char_to_position(s.head).column, 2);
        apply_move(&mut s, &d, Move::Down(1), false);
        assert_eq!(d.char_to_position(s.head).column, 4, "the goal column survives the short line");
        apply_move(&mut s, &d, Move::Right, true);
        apply_move(&mut s, &d, Move::Right, true);
        assert_eq!(s.range().len(), 2);
        let end = s.range().end;
        apply_move(&mut s, &d, Move::Right, false);
        assert_eq!((s.anchor, s.head), (end, end), "Right collapses to the end");
        apply_move(&mut s, &d, Move::LineEnd, true);
        assert_eq!(d.slice(s.range()), " line");
    }

    #[test]
    fn display_columns_map_through_tabs() {
        assert_eq!(char_col("\tab", 0), 0);
        assert_eq!(char_col("\tab", 1), 0);
        assert_eq!(char_col("\tab", 2), 1);
        assert_eq!(char_col("\tab", 4), 1);
        assert_eq!(char_col("\tab", 5), 2);
        assert_eq!(char_col("\tab", 9), 3);
    }
}
