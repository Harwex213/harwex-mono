//! Editing commands. They work on a `Document` plus one `Selection` and know nothing about egui,
//! so they are unit-testable and reusable by the app (e.g. for scripted edits).

use std::ops::Range;

use crate::document::{is_word_char, Document, EditKind, Selection};

pub const TAB_WIDTH: usize = 4;

#[derive(Clone, Copy, PartialEq, Eq)]
enum CharClass {
    Word,
    Space,
    Newline,
    Punct,
}

fn class(c: char) -> CharClass {
    if c == '\n' {
        CharClass::Newline
    } else if c.is_whitespace() {
        CharClass::Space
    } else if is_word_char(c) {
        CharClass::Word
    } else {
        CharClass::Punct
    }
}

/// Display column of `col` in a line, expanding tabs.
pub fn display_col(line: &str, col: usize) -> usize {
    let mut d = 0;
    for c in line.chars().take(col) {
        d = advance(d, c);
    }
    d
}

pub(crate) fn advance(d: usize, c: char) -> usize {
    if c == '\t' {
        (d / TAB_WIDTH + 1) * TAB_WIDTH
    } else {
        d + 1
    }
}

/// Char column for a display column, rounding to the nearest char boundary.
pub fn col_from_display(line: &str, target: f32) -> usize {
    let mut d = 0usize;
    for (i, c) in line.chars().enumerate() {
        let next = advance(d, c);
        if target < (d + next) as f32 / 2.0 {
            return i;
        }
        d = next;
    }
    line.chars().count()
}

pub fn word_right(doc: &Document, idx: usize) -> usize {
    let len = doc.len_chars();
    let mut i = idx;
    if i >= len {
        return len;
    }
    if doc.char_at(i) == Some('\n') {
        return i + 1;
    }
    while i < len && doc.char_at(i).map(class) == Some(CharClass::Space) {
        i += 1;
    }
    if let Some(c) = doc.char_at(i).map(class) {
        if c != CharClass::Newline {
            while i < len && doc.char_at(i).map(class) == Some(c) {
                i += 1;
            }
        }
    }
    i
}

pub fn word_left(doc: &Document, idx: usize) -> usize {
    let mut i = idx;
    if i == 0 {
        return 0;
    }
    if doc.char_at(i - 1) == Some('\n') {
        return i - 1;
    }
    while i > 0 && doc.char_at(i - 1).map(class) == Some(CharClass::Space) {
        i -= 1;
    }
    if i > 0 {
        let c = class(doc.char_at(i - 1).unwrap_or(' '));
        if c != CharClass::Newline {
            while i > 0 && doc.char_at(i - 1).map(class) == Some(c) {
                i -= 1;
            }
        }
    }
    i
}

/// Word (or run of same-class chars) under `idx`, for double-click.
pub fn word_range(doc: &Document, idx: usize) -> Range<usize> {
    let pos = doc.char_to_position(idx);
    if let Some(r) = doc.word_at(pos) {
        return doc.position_to_char(r.start)..doc.position_to_char(r.end);
    }
    let line = doc.line_start(pos.line);
    let end = doc.line_end(pos.line);
    let Some(c) = doc.char_at(idx).filter(|_| idx < end).map(class) else {
        return idx..idx;
    };
    let mut s = idx;
    while s > line && doc.char_at(s - 1).map(class) == Some(c) {
        s -= 1;
    }
    let mut e = idx;
    while e < end && doc.char_at(e).map(class) == Some(c) {
        e += 1;
    }
    s..e
}

fn leading_ws(line: &str) -> &str {
    let n = line.len() - line.trim_start_matches([' ', '\t']).len();
    &line[..n]
}

/// Cmd+Left / Home: first non-blank char, or column 0 if already there.
pub fn smart_home(doc: &Document, idx: usize) -> usize {
    let pos = doc.char_to_position(idx);
    let line = doc.line(pos.line);
    let indent = leading_ws(&line).chars().count();
    let start = doc.line_start(pos.line);
    if pos.column == indent {
        start
    } else {
        start + indent
    }
}

pub fn line_end_of(doc: &Document, idx: usize) -> usize {
    doc.line_end(doc.char_to_position(idx).line)
}

/// Moves `lines` up (negative) or down keeping the display column `want`.
pub fn vertical(doc: &Document, idx: usize, lines: isize, want: usize) -> usize {
    let pos = doc.char_to_position(idx);
    let last = doc.line_count().saturating_sub(1) as isize;
    let target = pos.line as isize + lines;
    if target < 0 {
        return 0;
    }
    if target > last {
        return doc.len_chars();
    }
    let line = target as usize;
    let text = doc.line(line);
    doc.line_start(line) + col_from_display(&text, want as f32)
}

pub fn insert_text(doc: &mut Document, sel: &mut Selection, text: &str) {
    let r = sel.range();
    let kind = if r.is_empty() && text.chars().count() == 1 { EditKind::Insert } else { EditKind::Other };
    let after = Selection::caret(r.start + text.chars().count());
    doc.edit(r, text, *sel, after, kind);
    *sel = after;
}

/// Typing a closing bracket on a blank line pulls it back one indent level.
pub fn type_char(doc: &mut Document, sel: &mut Selection, text: &str) {
    if sel.is_empty() && matches!(text, "}" | "]" | ")") {
        let pos = doc.char_to_position(sel.head);
        let line = doc.line(pos.line);
        let before: String = line.chars().take(pos.column).collect();
        let unit = doc.indent();
        if !before.is_empty() && before.chars().all(|c| c == ' ' || c == '\t') && line.trim().is_empty() {
            let cut = if before.ends_with('\t') { 1 } else { unit.width.min(before.len()) };
            let start = sel.head - cut;
            let after = Selection::caret(start + 1);
            doc.edit(start..sel.head, text, *sel, after, EditKind::Other);
            *sel = after;
            return;
        }
    }
    insert_text(doc, sel, text);
}

pub fn delete_range(doc: &mut Document, sel: &mut Selection, range: Range<usize>) {
    if range.is_empty() {
        return;
    }
    let after = Selection::caret(range.start);
    doc.edit(range, "", *sel, after, EditKind::Delete);
    *sel = after;
}

pub fn backspace(doc: &mut Document, sel: &mut Selection, word: bool) {
    if !sel.is_empty() {
        let r = sel.range();
        let after = Selection::caret(r.start);
        doc.edit(r, "", *sel, after, EditKind::Other);
        *sel = after;
        return;
    }
    let head = sel.head;
    if head == 0 {
        return;
    }
    let start = if word {
        word_left(doc, head)
    } else {
        // Inside leading spaces, delete back to the previous indent stop like IDEA does. No
        // line copy: this runs once per caret.
        let rope = doc.rope();
        let after_space = rope.char(head - 1) == ' ';
        let column = if after_space { head - rope.line_to_char(rope.char_to_line(head)) } else { 0 };
        let width = doc.indent().width;
        if after_space && !doc.indent().use_tabs && rope.slice(head - column..head).chars().all(|c| c == ' ') {
            let cut = match column % width {
                0 => width,
                r => r,
            };
            head - cut
        } else {
            head - 1
        }
    };
    delete_range(doc, sel, start..head);
}

pub fn delete_forward(doc: &mut Document, sel: &mut Selection, word: bool) {
    if !sel.is_empty() {
        let r = sel.range();
        let after = Selection::caret(r.start);
        doc.edit(r, "", *sel, after, EditKind::Other);
        *sel = after;
        return;
    }
    let head = sel.head;
    let end = if word { word_right(doc, head) } else { (head + 1).min(doc.len_chars()) };
    if end > head {
        let after = Selection::caret(head);
        doc.edit(head..end, "", *sel, after, EditKind::Delete);
        *sel = after;
    }
}

/// Lines touched by the selection. A selection ending at column 0 does not include that line,
/// matching what users expect after selecting whole lines with Shift+Down.
pub fn selected_lines(doc: &Document, sel: &Selection) -> Range<usize> {
    let s = doc.char_to_position(sel.start());
    let e = doc.char_to_position(sel.end());
    let last = if e.line > s.line && e.column == 0 { e.line - 1 } else { e.line };
    s.line..last + 1
}

pub fn delete_line(doc: &mut Document, sel: &mut Selection) {
    let lines = selected_lines(doc, sel);
    let start = doc.line_start(lines.start);
    let mut end = doc.line_start(lines.end);
    let mut s = start;
    if lines.end >= doc.line_count() {
        // Last line has no trailing newline; eat the one before it instead.
        end = doc.len_chars();
        s = s.saturating_sub(1);
    }
    let after = Selection::caret(s.min(doc.len_chars()));
    doc.edit(s..end, "", *sel, after, EditKind::Other);
    let line = lines.start.min(doc.line_count() - 1);
    *sel = Selection::caret(doc.line_start(line));
}

pub fn newline(doc: &mut Document, sel: &mut Selection) {
    let r = sel.range();
    let pos = doc.char_to_position(r.start);
    let line = doc.line(pos.line);
    let before: String = line.chars().take(pos.column).collect();
    let indent = leading_ws(&before).to_string();
    let prev = before.trim_end().chars().last();
    let next_char = doc.char_at(r.end).filter(|c| *c != '\n');
    let opens = matches!(prev, Some('{' | '[' | '('));
    let unit = doc.indent().unit();
    let mut text = String::from("\n");
    text.push_str(&indent);
    let caret_offset;
    if opens {
        text.push_str(&unit);
        caret_offset = text.chars().count();
        let closes = matches!((prev, next_char), (Some('{'), Some('}')) | (Some('['), Some(']')) | (Some('('), Some(')')));
        if closes {
            text.push('\n');
            text.push_str(&indent);
        }
    } else {
        caret_offset = text.chars().count();
    }
    let after = Selection::caret(r.start + caret_offset);
    doc.edit(r, &text, *sel, after, EditKind::Other);
    *sel = after;
}

/// Maps a char index through edits applied in order (`start`, removed len, inserted len).
fn map_index(mut idx: usize, edits: &[(usize, usize, usize)]) -> usize {
    for &(start, removed, inserted) in edits {
        if idx >= start + removed {
            idx = idx + inserted - removed;
        } else if idx > start {
            idx = start + inserted.min(idx - start);
        }
    }
    idx
}

fn apply_line_edits(doc: &mut Document, sel: &mut Selection, edits: Vec<(Range<usize>, String)>) {
    let shape: Vec<(usize, usize, usize)> =
        edits.iter().map(|(r, t)| (r.start, r.len(), t.chars().count())).collect();
    let after = Selection::new(map_index(sel.anchor, &shape), map_index(sel.head, &shape));
    doc.transact(edits, *sel, after, EditKind::Other);
    *sel = after;
}

/// Tab: indent every selected line when the selection spans lines, otherwise insert up to the
/// next indent stop.
pub fn tab(doc: &mut Document, sel: &mut Selection) {
    let lines = selected_lines(doc, sel);
    let unit = doc.indent();
    if sel.is_empty() {
        if unit.use_tabs {
            insert_text(doc, sel, "\t");
        } else {
            let pos = doc.char_to_position(sel.start());
            let d = display_col(&doc.line(pos.line), pos.column);
            let n = unit.width - d % unit.width;
            insert_text(doc, sel, &" ".repeat(n));
        }
        return;
    }
    let lines: Vec<usize> = lines.collect();
    let edits = indent_edits(doc, &lines);
    apply_line_edits(doc, sel, edits);
}

/// One indent unit at the start of every non-empty line of `lines` (ascending), bottom-up.
pub(crate) fn indent_edits(doc: &Document, lines: &[usize]) -> Vec<(Range<usize>, String)> {
    let text = doc.indent().unit();
    lines
        .iter()
        .rev()
        .filter(|&&l| doc.line_len(l) > 0)
        .map(|&l| {
            let s = doc.line_start(l);
            (s..s, text.clone())
        })
        .collect()
}

/// Removes one indent level from every line of `lines` (ascending), bottom-up.
pub(crate) fn dedent_edits(doc: &Document, lines: &[usize]) -> Vec<(Range<usize>, String)> {
    let width = doc.indent().width;
    lines
        .iter()
        .rev()
        .filter_map(|&l| {
            let s = doc.line_start(l);
            let first = doc.char_at(s);
            let n = if first == Some('\t') {
                1
            } else {
                (0..width.min(doc.line_len(l))).take_while(|&i| doc.char_at(s + i) == Some(' ')).count()
            };
            (n > 0).then(|| (s..s + n, String::new()))
        })
        .collect()
}

pub fn dedent(doc: &mut Document, sel: &mut Selection) {
    let lines: Vec<usize> = selected_lines(doc, sel).collect();
    let edits = dedent_edits(doc, &lines);
    if !edits.is_empty() {
        apply_line_edits(doc, sel, edits);
    }
}

/// Cmd+/. Comments every selected line at the shallowest indent, or uncomments when all non-blank
/// lines are already commented.
pub fn toggle_comment(doc: &mut Document, sel: &mut Selection) {
    let lines: Vec<usize> = selected_lines(doc, sel).collect();
    let Some(edits) = comment_edits(doc, &lines) else {
        return;
    };
    apply_line_edits(doc, sel, edits);
    // IDEA moves the caret down after commenting a single line so repeated Cmd+/ walks the file.
    if lines.len() == 1 && sel.is_empty() {
        let pos = doc.char_to_position(sel.head);
        if pos.line + 1 < doc.line_count() {
            *sel = Selection::caret(doc.position_to_char(crate::Position::new(pos.line + 1, pos.column)));
        }
    }
}

/// The edits of Cmd+/ for `lines` (ascending), bottom-up. `None` when the language has no
/// comment syntax or every line is blank.
pub(crate) fn comment_edits(doc: &Document, lines: &[usize]) -> Option<Vec<(Range<usize>, String)>> {
    let (open, close) = doc.language().comment_tokens()?;
    let texts: Vec<String> = lines.iter().map(|&l| doc.line(l)).collect();
    let non_blank: Vec<(usize, &String)> =
        lines.iter().copied().zip(texts.iter()).filter(|(_, t)| !t.trim().is_empty()).collect();
    if non_blank.is_empty() {
        return None;
    }
    let all_commented = non_blank.iter().all(|(_, t)| t.trim_start().starts_with(open));
    let mut edits = Vec::new();
    if all_commented {
        for &(l, t) in non_blank.iter().rev() {
            let s = doc.line_start(l);
            let indent = leading_ws(t).chars().count();
            let rest = &t[leading_ws(t).len()..];
            let mut n = open.chars().count();
            if rest[open.len()..].starts_with(' ') {
                n += 1;
            }
            if !close.is_empty() {
                let trimmed = t.trim_end();
                if let Some(body) = trimmed.strip_suffix(close) {
                    let mut cs = body.chars().count();
                    if body.ends_with(' ') {
                        cs -= 1;
                    }
                    edits.push((s + cs..s + trimmed.chars().count(), String::new()));
                }
            }
            edits.push((s + indent..s + indent + n, String::new()));
        }
    } else {
        let min_indent = non_blank.iter().map(|(_, t)| leading_ws(t).chars().count()).min().unwrap_or(0);
        for &(l, t) in non_blank.iter().rev() {
            let s = doc.line_start(l);
            if !close.is_empty() {
                let e = s + t.chars().count();
                edits.push((e..e, format!(" {close}")));
            }
            edits.push((s + min_indent..s + min_indent, format!("{open} ")));
        }
    }
    Some(edits)
}

/// Cmd+D: duplicates the selection, or the current line(s) when nothing is selected.
pub fn duplicate(doc: &mut Document, sel: &mut Selection) {
    if !sel.is_empty() {
        let r = sel.range();
        let text = doc.slice(r.clone());
        let n = text.chars().count();
        let after = Selection::new(r.end, r.end + n);
        doc.edit(r.end..r.end, &text, *sel, after, EditKind::Other);
        *sel = after;
        return;
    }
    let lines = selected_lines(doc, sel);
    let start = doc.line_start(lines.start);
    let end = doc.line_end(lines.end - 1);
    let mut text = String::from("\n");
    text.push_str(&doc.slice(start..end));
    let n = text.chars().count();
    let after = Selection::caret(sel.head + n);
    doc.edit(end..end, &text, *sel, after, EditKind::Other);
    *sel = after;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Language;

    fn doc(text: &str) -> Document {
        Document::from_text(text, Language::TypeScript)
    }

    #[test]
    fn enter_indents_after_brace() {
        let mut d = doc("function f() {}\n");
        let mut sel = Selection::caret(14);
        newline(&mut d, &mut sel);
        assert_eq!(d.text(), "function f() {\n  \n}\n");
        assert_eq!(d.char_to_position(sel.head), crate::Position::new(1, 2));
    }

    #[test]
    fn comment_roundtrip() {
        let mut d = doc("  a();\n  b();\n");
        let mut sel = Selection::new(0, 13);
        toggle_comment(&mut d, &mut sel);
        assert_eq!(d.text(), "  // a();\n  // b();\n");
        toggle_comment(&mut d, &mut sel);
        assert_eq!(d.text(), "  a();\n  b();\n");
    }

    #[test]
    fn css_comment_roundtrip() {
        let mut d = Document::from_text("a { color: red; }\n", Language::Css);
        let mut sel = Selection::new(0, 3);
        toggle_comment(&mut d, &mut sel);
        assert_eq!(d.text(), "/* a { color: red; } */\n");
        toggle_comment(&mut d, &mut sel);
        assert_eq!(d.text(), "a { color: red; }\n");
    }

    #[test]
    fn tab_and_dedent_lines() {
        let mut d = doc("a\nb\n");
        let mut sel = Selection::new(0, 3);
        tab(&mut d, &mut sel);
        assert_eq!(d.text(), "  a\n  b\n");
        dedent(&mut d, &mut sel);
        assert_eq!(d.text(), "a\nb\n");
    }

    #[test]
    fn duplicate_line() {
        let mut d = doc("abc\nx");
        let mut sel = Selection::caret(1);
        duplicate(&mut d, &mut sel);
        assert_eq!(d.text(), "abc\nabc\nx");
        assert_eq!(sel.head, 5);
    }

    #[test]
    fn undo_groups_typing_by_word() {
        let mut d = doc("");
        let mut sel = Selection::caret(0);
        for c in "foo bar".chars() {
            type_char(&mut d, &mut sel, &c.to_string());
        }
        assert_eq!(d.text(), "foo bar");
        d.undo();
        assert_eq!(d.text(), "foo");
        d.undo();
        assert_eq!(d.text(), "");
        d.redo();
        d.redo();
        assert_eq!(d.text(), "foo bar");
    }

    #[test]
    fn word_moves() {
        let d = doc("foo.bar  baz");
        assert_eq!(word_right(&d, 0), 3);
        assert_eq!(word_right(&d, 3), 4);
        assert_eq!(word_right(&d, 7), 12);
        assert_eq!(word_left(&d, 12), 9);
        assert_eq!(word_left(&d, 9), 4);
    }

    #[test]
    fn delete_last_line() {
        let mut d = doc("a\nb");
        let mut sel = Selection::caret(3);
        delete_line(&mut d, &mut sel);
        assert_eq!(d.text(), "a");
    }
}
