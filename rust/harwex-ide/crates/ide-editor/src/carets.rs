//! Multiple carets: the selection set and the commands that run at every caret as one undo step.
//!
//! The set is sorted by position and never holds overlapping selections. One selection is the
//! primary: the caret the status bar, navigation and scrolling follow.

use std::ops::Range;

use crate::document::{Document, EditKind, Selection};
use crate::editing;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Carets {
    sels: Vec<Selection>,
    primary: usize,
}

impl Default for Carets {
    fn default() -> Self {
        Carets::single(Selection::default())
    }
}

impl Carets {
    pub fn single(sel: Selection) -> Carets {
        Carets { sels: vec![sel], primary: 0 }
    }

    /// Sorts and merges `sels`. `primary` indexes `sels` before sorting. An empty list becomes
    /// one caret at 0.
    pub fn from_vec(sels: Vec<Selection>, primary: usize) -> Carets {
        if sels.is_empty() {
            return Carets::default();
        }
        let primary = primary.min(sels.len() - 1);
        let mut c = Carets { sels, primary };
        c.normalize();
        c
    }

    pub fn primary(&self) -> Selection {
        self.sels[self.primary]
    }

    pub fn primary_index(&self) -> usize {
        self.primary
    }

    /// Every selection, sorted by position.
    pub fn all(&self) -> &[Selection] {
        &self.sels
    }

    pub fn len(&self) -> usize {
        self.sels.len()
    }

    pub fn is_empty(&self) -> bool {
        self.sels.is_empty()
    }

    pub fn is_multi(&self) -> bool {
        self.sels.len() > 1
    }

    /// Replaces the primary selection and merges what it now overlaps.
    pub fn set_primary(&mut self, sel: Selection) {
        self.sels[self.primary] = sel;
        self.normalize();
    }

    /// Adds a selection and makes it the primary.
    pub fn push(&mut self, sel: Selection) {
        self.sels.push(sel);
        self.primary = self.sels.len() - 1;
        self.normalize();
    }

    /// Alt+click: removes the caret at `idx` when one is there (and it is not the only one),
    /// otherwise adds a caret there.
    pub fn toggle(&mut self, idx: usize) {
        if let Some(i) = self.sels.iter().position(|s| s.head == idx || (s.start() < idx && idx < s.end())) {
            if self.sels.len() > 1 {
                self.remove(i);
            }
            return;
        }
        self.push(Selection::caret(idx));
    }

    /// Removes one selection. The primary moves to the selection before it in the set.
    pub fn remove(&mut self, i: usize) {
        if self.sels.len() <= 1 || i >= self.sels.len() {
            return;
        }
        self.sels.remove(i);
        if self.primary > i || self.primary == self.sels.len() {
            self.primary = self.primary.saturating_sub(1);
        } else if self.primary == i {
            self.primary = i.saturating_sub(1);
        }
    }

    /// Esc: only the primary stays.
    pub fn collapse(&mut self) {
        let p = self.primary();
        *self = Carets::single(p);
    }

    /// Clamps every selection into a text of `len` chars.
    pub fn clamp(&mut self, len: usize) {
        if self.sels.iter().all(|s| s.anchor <= len && s.head <= len) {
            return;
        }
        for s in &mut self.sels {
            s.anchor = s.anchor.min(len);
            s.head = s.head.min(len);
        }
        self.normalize();
    }

    /// Applies `f` to every selection, then merges the ones that now overlap.
    pub fn map(&mut self, mut f: impl FnMut(usize, Selection) -> Selection) {
        for (i, s) in self.sels.iter_mut().enumerate() {
            *s = f(i, *s);
        }
        self.normalize();
    }

    /// The selections that touch the char range `r` (for drawing one line).
    pub fn touching(&self, r: Range<usize>) -> &[Selection] {
        let a = self.sels.partition_point(|s| s.end() < r.start);
        let b = self.sels.partition_point(|s| s.start() <= r.end);
        &self.sels[a..b.max(a)]
    }

    fn sorted_and_apart(&self) -> bool {
        self.sels.windows(2).all(|w| w[0].start() <= w[1].start() && !overlaps(&w[0], &w[1]))
    }

    /// Sorts by position and merges overlapping selections. Two carets at one spot merge; two
    /// non-empty selections that only touch stay apart (the occurrences of `aa` in `aaaa`).
    pub fn normalize(&mut self) {
        if self.sorted_and_apart() {
            return;
        }
        let primary = self.primary;
        let mut items: Vec<(Selection, bool)> = self.sels.iter().enumerate().map(|(i, s)| (*s, i == primary)).collect();
        items.sort_by_key(|(s, _)| (s.start(), s.end()));
        let mut out: Vec<Selection> = Vec::with_capacity(items.len());
        let mut out_primary = 0;
        let mut last_primary = false;
        for (s, p) in items {
            if let Some(cur) = out.last_mut() {
                if overlaps(cur, &s) {
                    let start = cur.start().min(s.start());
                    let end = cur.end().max(s.end());
                    // The merged selection keeps the direction of the primary, else the first.
                    let forward = if p { s.anchor <= s.head } else { cur.anchor <= cur.head };
                    *cur = if forward { Selection::new(start, end) } else { Selection::new(end, start) };
                    if p {
                        last_primary = true;
                        out_primary = out.len() - 1;
                    }
                    continue;
                }
            }
            out.push(s);
            if p {
                last_primary = true;
                out_primary = out.len() - 1;
            }
        }
        debug_assert!(last_primary);
        self.sels = out;
        self.primary = out_primary;
    }
}

fn overlaps(a: &Selection, b: &Selection) -> bool {
    let (a, b) = if a.start() <= b.start() { (a, b) } else { (b, a) };
    b.start() < a.end() || ((a.is_empty() || b.is_empty()) && b.start() <= a.end())
}

/// Runs a single-caret command at every caret as one undo step. The carets run bottom-up, so
/// each one edits text the carets above it have not touched yet. `f` gets the caret's index.
pub fn edit_each(doc: &mut Document, carets: &mut Carets, mut f: impl FnMut(&mut Document, &mut Selection, usize)) {
    if !carets.is_multi() {
        let mut s = carets.primary();
        f(doc, &mut s, 0);
        *carets = Carets::single(s);
        return;
    }
    let before = carets.clone();
    let n = before.len();
    doc.begin_group();
    let mut out = Vec::with_capacity(n);
    out.resize(n, Selection::default());
    let mut deltas = vec![0isize; n];
    // The lowest char an edit touched so far. Text below it is still the original text.
    let mut lo = usize::MAX;
    for i in (0..n).rev() {
        let s0 = before.sels[i];
        if s0.end() > lo {
            // An edit of a caret below (Backspace over an indent) swallowed this one.
            out[i] = Selection::caret(s0.start().min(lo));
            continue;
        }
        let len0 = doc.len_chars();
        let mut s = s0;
        f(doc, &mut s, i);
        deltas[i] = doc.len_chars() as isize - len0 as isize;
        out[i] = s;
        lo = lo.min(doc.group_low().unwrap_or(usize::MAX));
    }
    // Each caret moves by what the carets above it inserted or removed.
    let len = doc.len_chars();
    let mut acc = 0isize;
    for (s, d) in out.iter_mut().zip(&deltas) {
        let shift = |v: usize| (v as isize + acc).clamp(0, len as isize) as usize;
        *s = Selection::new(shift(s.anchor), shift(s.head));
        acc += d;
    }
    let after = Carets::from_vec(out, before.primary);
    doc.end_group(&before, &after);
    *carets = after;
}

/// Applies line edits (ordered bottom-up, not overlapping) as one undo step and moves every
/// caret with them.
pub(crate) fn apply_line_edits(doc: &mut Document, carets: &mut Carets, mut edits: Vec<(Range<usize>, String)>, kind: EditKind) {
    if edits.is_empty() {
        return;
    }
    let before = carets.clone();
    edits.sort_by_key(|e| std::cmp::Reverse(e.0.start));
    let shifts = Shifts::new(&edits);
    let mut after = carets.clone();
    after.map(|_, s| Selection::new(shifts.map(s.anchor), shifts.map(s.head)));
    doc.transact_carets(edits, &before, &after, kind);
    *carets = after;
}

/// Maps char indices through non-overlapping edits in O(log n) each.
struct Shifts {
    /// Ascending: (start, removed, inserted) in the text before the edits.
    edits: Vec<(usize, usize, usize)>,
    /// prefix[k]: total change of the first k edits.
    prefix: Vec<isize>,
}

impl Shifts {
    fn new(edits_desc: &[(Range<usize>, String)]) -> Shifts {
        let edits: Vec<(usize, usize, usize)> =
            edits_desc.iter().rev().map(|(r, t)| (r.start, r.len(), t.chars().count())).collect();
        let mut prefix = Vec::with_capacity(edits.len() + 1);
        prefix.push(0isize);
        for &(_, rem, ins) in &edits {
            let last = *prefix.last().expect("starts with 0");
            prefix.push(last + ins as isize - rem as isize);
        }
        Shifts { edits, prefix }
    }

    /// Like `editing::map_index`: an index at an insertion moves past it, an index inside a
    /// replaced range stays inside the new text.
    fn map(&self, idx: usize) -> usize {
        let k = self.edits.partition_point(|&(s, rem, _)| s + rem <= idx);
        let base = (idx as isize + self.prefix[k]).max(0) as usize;
        match self.edits.get(k) {
            Some(&(s, _, ins)) if idx > s => (s as isize + self.prefix[k]) as usize + ins.min(idx - s),
            _ => base,
        }
    }
}

/// The lines touched by any caret, ascending and without repeats.
pub(crate) fn caret_lines(doc: &Document, carets: &Carets) -> Vec<usize> {
    let mut out: Vec<usize> = Vec::new();
    for s in carets.all() {
        for l in editing::selected_lines(doc, s) {
            if out.last().is_none_or(|&last| l > last) {
                out.push(l);
            }
        }
    }
    out
}

/// Text for Copy: each caret's selection (or its whole line) joined with line breaks.
pub fn copy_text(doc: &Document, carets: &Carets) -> String {
    if !carets.is_multi() {
        return copy_one(doc, &carets.primary());
    }
    if carets.all().iter().all(|s| s.is_empty()) {
        // Whole lines, each once, like a single-caret line copy.
        return caret_lines(doc, carets).into_iter().map(|l| format!("{}\n", doc.line(l))).collect();
    }
    let parts: Vec<String> = carets.all().iter().filter(|s| !s.is_empty()).map(|s| doc.slice(s.range())).collect();
    parts.join("\n")
}

fn copy_one(doc: &Document, sel: &Selection) -> String {
    if sel.is_empty() {
        let line = doc.char_to_position(sel.head).line;
        let mut s = doc.line(line);
        s.push('\n');
        s
    } else {
        doc.slice(sel.range())
    }
}

/// Paste at every caret. Text with as many lines as there are carets puts one line at each
/// caret, like IDEA.
pub fn paste(doc: &mut Document, carets: &mut Carets, text: &str) {
    let n = carets.len();
    let body = text.strip_suffix('\n').unwrap_or(text);
    let parts: Vec<&str> = body.split('\n').collect();
    let spread = n > 1 && parts.len() == n;
    edit_each(doc, carets, |doc, sel, i| {
        let t = if spread { parts[i] } else { text };
        let r = sel.range();
        let after = Selection::caret(r.start + t.chars().count());
        doc.edit(r, t, *sel, after, EditKind::Other);
        *sel = after;
    });
}

/// Cut: copies like `copy_text`, then removes each selection, or each caret's line.
pub fn cut(doc: &mut Document, carets: &mut Carets) -> String {
    let text = copy_text(doc, carets);
    edit_each(doc, carets, |doc, sel, _| {
        if sel.is_empty() {
            editing::delete_line(doc, sel);
        } else {
            let r = sel.range();
            let after = Selection::caret(r.start);
            doc.edit(r, "", *sel, after, EditKind::Other);
            *sel = after;
        }
    });
    text
}

/// Tab at every caret: indents the lines of all carets when any caret holds a selection,
/// otherwise inserts up to the next indent stop at each caret.
pub fn tab(doc: &mut Document, carets: &mut Carets) {
    if carets.all().iter().all(|s| s.is_empty()) {
        edit_each(doc, carets, |doc, sel, _| editing::tab(doc, sel));
        return;
    }
    let lines = caret_lines(doc, carets);
    let edits = editing::indent_edits(doc, &lines);
    apply_line_edits(doc, carets, edits, EditKind::Other);
}

/// Shift+Tab: removes one indent level from every caret line.
pub fn dedent(doc: &mut Document, carets: &mut Carets) {
    let lines = caret_lines(doc, carets);
    let edits = editing::dedent_edits(doc, &lines);
    apply_line_edits(doc, carets, edits, EditKind::Other);
}

/// Cmd+/: comments or uncomments the lines of every caret together.
pub fn toggle_comment(doc: &mut Document, carets: &mut Carets) {
    if !carets.is_multi() {
        let mut s = carets.primary();
        editing::toggle_comment(doc, &mut s);
        *carets = Carets::single(s);
        return;
    }
    let lines = caret_lines(doc, carets);
    if let Some(edits) = editing::comment_edits(doc, &lines) {
        apply_line_edits(doc, carets, edits, EditKind::Other);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Language;

    fn doc(text: &str) -> Document {
        Document::from_text(text, Language::TypeScript)
    }

    fn carets(at: &[usize]) -> Carets {
        Carets::from_vec(at.iter().map(|&i| Selection::caret(i)).collect(), 0)
    }

    fn heads(c: &Carets) -> Vec<usize> {
        c.all().iter().map(|s| s.head).collect()
    }

    #[test]
    fn merges_and_sorts() {
        let c = Carets::from_vec(vec![Selection::new(5, 8), Selection::caret(2), Selection::caret(6), Selection::caret(2)], 2);
        assert_eq!(c.all(), &[Selection::caret(2), Selection::new(5, 8)]);
        assert_eq!(c.primary(), Selection::new(5, 8), "the primary survives a merge");
        // Touching non-empty selections stay apart; a caret at the edge merges.
        let c = Carets::from_vec(vec![Selection::new(0, 2), Selection::new(2, 4)], 0);
        assert_eq!(c.len(), 2);
        let c = Carets::from_vec(vec![Selection::new(0, 2), Selection::caret(2)], 1);
        assert_eq!(c.all(), &[Selection::new(0, 2)]);
        // A merge keeps the primary's direction.
        let c = Carets::from_vec(vec![Selection::new(0, 3), Selection::new(5, 2)], 1);
        assert_eq!(c.all(), &[Selection::new(5, 0)]);
    }

    #[test]
    fn toggle_adds_and_removes() {
        let mut c = carets(&[3]);
        c.toggle(7);
        assert_eq!(heads(&c), vec![3, 7]);
        assert_eq!(c.primary().head, 7);
        c.toggle(3);
        assert_eq!(heads(&c), vec![7]);
        c.toggle(7);
        assert_eq!(heads(&c), vec![7], "the last caret stays");
    }

    #[test]
    fn typing_at_every_caret_is_one_undo_step() {
        let mut d = doc("ab\nab\nab\n");
        let mut c = carets(&[1, 4, 7]);
        for ch in ["x", "y"] {
            edit_each(&mut d, &mut c, |d, s, _| editing::type_char(d, s, ch));
        }
        assert_eq!(d.text(), "axyb\naxyb\naxyb\n");
        assert_eq!(heads(&c), vec![3, 8, 13]);
        let restored = d.undo_carets().expect("undo");
        assert_eq!(d.text(), "ab\nab\nab\n");
        assert_eq!(heads(&restored), vec![1, 4, 7]);
        let redone = d.redo_carets().expect("redo");
        assert_eq!(d.text(), "axyb\naxyb\naxyb\n");
        assert_eq!(heads(&redone), vec![3, 8, 13]);
    }

    #[test]
    fn backspace_merges_carets_it_swallows() {
        let mut d = doc("abcd");
        let mut c = carets(&[2, 3]);
        edit_each(&mut d, &mut c, |d, s, _| editing::backspace(d, s, false));
        assert_eq!(d.text(), "ad");
        assert_eq!(heads(&c), vec![1]);
        // Indent-stop backspace over another caret.
        let mut d = doc("    x");
        let mut c = carets(&[2, 4]);
        edit_each(&mut d, &mut c, |d, s, _| editing::backspace(d, s, false));
        assert_eq!(d.text(), "x");
        assert_eq!(heads(&c), vec![0]);
    }

    #[test]
    fn enter_keeps_indent_at_every_caret() {
        let mut d = doc("  a\n  b\n");
        let mut c = carets(&[3, 7]);
        edit_each(&mut d, &mut c, |d, s, _| editing::newline(d, s));
        assert_eq!(d.text(), "  a\n  \n  b\n  \n");
        assert_eq!(heads(&c), vec![6, 13]);
    }

    #[test]
    fn paste_spreads_lines_over_carets() {
        let mut d = doc("a\nb\nc\n");
        let mut c = carets(&[1, 3, 5]);
        paste(&mut d, &mut c, "1\n2\n3\n");
        assert_eq!(d.text(), "a1\nb2\nc3\n");
        let mut c = carets(&[1, 4]);
        paste(&mut d, &mut c, "-");
        assert_eq!(d.text(), "a-1\nb-2\nc3\n");
        assert!(d.undo().is_some());
        assert_eq!(d.text(), "a1\nb2\nc3\n");
    }

    #[test]
    fn copy_and_cut_join_with_newlines() {
        let mut d = doc("foo bar\nbaz qux\n");
        let mut c = Carets::from_vec(vec![Selection::new(0, 3), Selection::new(8, 11)], 0);
        assert_eq!(copy_text(&d, &c), "foo\nbaz");
        assert_eq!(cut(&mut d, &mut c), "foo\nbaz");
        assert_eq!(d.text(), " bar\n qux\n");
        assert_eq!(heads(&c), vec![0, 5]);
        let c = carets(&[1, 2, 6]);
        assert_eq!(copy_text(&d, &c), " bar\n qux\n");
    }

    #[test]
    fn tab_and_comment_touch_each_line_once() {
        let mut d = doc("a\nb\n");
        let mut c = Carets::from_vec(vec![Selection::new(0, 1), Selection::caret(1), Selection::new(2, 3)], 0);
        tab(&mut d, &mut c);
        assert_eq!(d.text(), "  a\n  b\n");
        dedent(&mut d, &mut c);
        assert_eq!(d.text(), "a\nb\n");
        let mut c = carets(&[0, 1, 2]);
        toggle_comment(&mut d, &mut c);
        assert_eq!(d.text(), "// a\n// b\n");
        assert_eq!(heads(&c), vec![3, 4, 8]);
        toggle_comment(&mut d, &mut c);
        assert_eq!(d.text(), "a\nb\n");
    }

    #[test]
    fn batched_edits_keep_tree_and_journal_in_sync() {
        let text: String = (0..60).map(|i| format!("const a{i} = {i};\n")).collect();
        let mut d = doc(&text);
        d.wait_syntax();
        let v0 = d.version();
        let at: Vec<usize> = (0..60).map(|l| d.line_start(l) + 6).collect();
        let mut c = carets(&at);
        edit_each(&mut d, &mut c, |d, s, _| editing::insert_text(d, s, "\"x\" + "));
        d.wait_syntax();
        let fresh = &mut doc(&d.text());
        fresh.wait_syntax();
        assert_eq!(d.highlight(0..61), fresh.highlight(0..61));
        let changes = d.changes_since(v0).expect("journal");
        assert_eq!(changes.len(), 1, "one spanning change");
        assert_eq!(changes[0].map(0, false), 0);
        assert_eq!(changes[0].map(text.chars().count(), true), d.len_chars());
        d.undo();
        d.wait_syntax();
        assert_eq!(d.text(), text);
        let fresh = &mut doc(&text);
        fresh.wait_syntax();
        assert_eq!(d.highlight(0..61), fresh.highlight(0..61));
    }

    #[test]
    fn shifts_match_sequential_mapping() {
        let edits = vec![(10..12, "xyz".to_string()), (5..5, "ab".to_string()), (0..2, String::new())];
        let s = Shifts::new(&edits);
        assert_eq!(s.map(0), 0);
        assert_eq!(s.map(1), 0);
        assert_eq!(s.map(3), 1);
        assert_eq!(s.map(5), 5, "an insertion pushes the caret past it");
        assert_eq!(s.map(11), 11, "inside a replaced range");
        assert_eq!(s.map(12), 13);
        assert_eq!(s.map(20), 21);
    }
}
