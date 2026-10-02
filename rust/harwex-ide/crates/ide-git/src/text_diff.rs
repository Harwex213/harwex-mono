//! Pure text algorithms behind the diff viewer and the gutter bars. No repository access, so
//! the app can also call them directly, e.g. to diff two editor buffers.

use std::ops::Range;
use std::time::{Duration, Instant};

use similar::{capture_diff_slices_deadline, Algorithm, DiffTag};

use crate::diff::{DiffHunk, LineChange, LineChangeKind, LineKind, LinePair};

/// A line diff on a huge, completely rewritten file must not stall the worker forever;
/// past the deadline `similar` falls back to a coarser but still correct diff.
const LINE_DIFF_DEADLINE: Duration = Duration::from_millis(1500);
/// Word diff is only worth it for blocks a person reads line by line.
const MAX_WORD_DIFF_LINES: usize = 400;
const MAX_WORD_DIFF_TOKENS: usize = 40_000;

/// Lines without their terminators. A trailing newline does not create an empty last line.
pub(crate) fn split_lines(text: &str) -> Vec<&str> {
    line_spans(text)
        .into_iter()
        .map(|r| {
            let line = &text[r];
            let line = line.strip_suffix('\n').unwrap_or(line);
            line.strip_suffix('\r').unwrap_or(line)
        })
        .collect()
}

/// Byte ranges of each line including its terminator, for rebuilding text exactly.
fn line_spans(text: &str) -> Vec<Range<usize>> {
    let mut spans = Vec::new();
    let mut start = 0;
    for (i, b) in text.bytes().enumerate() {
        if b == b'\n' {
            spans.push(start..i + 1);
            start = i + 1;
        }
    }
    if start < text.len() {
        spans.push(start..text.len());
    }
    spans
}

/// Changed blocks as (old line range, new line range). Adjacent delete/insert/replace ops
/// are merged so one visual change is one block.
fn changed_blocks(old: &[&str], new: &[&str]) -> Vec<(Range<usize>, Range<usize>)> {
    let deadline = Some(Instant::now() + LINE_DIFF_DEADLINE);
    let ops = capture_diff_slices_deadline(Algorithm::Patience, old, new, deadline);
    let mut blocks: Vec<(Range<usize>, Range<usize>)> = Vec::new();
    for op in ops {
        let (tag, o, n) = op.as_tag_tuple();
        if tag == DiffTag::Equal {
            continue;
        }
        if let Some(last) = blocks.last_mut() {
            if last.0.end == o.start && last.1.end == n.start {
                last.0.end = o.end;
                last.1.end = n.end;
                continue;
            }
        }
        blocks.push((o, n));
    }
    blocks
}

/// Side-by-side hunks between two texts. Hunks hold only changed lines; the viewer shows
/// both full texts and uses the hunks for backgrounds, ribbons and F7 navigation.
pub fn diff_texts(old_text: &str, new_text: &str) -> Vec<DiffHunk> {
    let old = split_lines(old_text);
    let new = split_lines(new_text);
    changed_blocks(&old, &new)
        .into_iter()
        .map(|(o, n)| build_hunk(&old, &new, o, n))
        .collect()
}

fn build_hunk(old: &[&str], new: &[&str], o: Range<usize>, n: Range<usize>) -> DiffHunk {
    let paired = o.len().min(n.len());
    let mut pairs = Vec::with_capacity(o.len().max(n.len()));
    for i in 0..o.len().max(n.len()) {
        let old_line = (i < o.len()).then(|| o.start + i);
        let new_line = (i < n.len()).then(|| n.start + i);
        let kind = if i < paired {
            LineKind::Changed
        } else if old_line.is_some() {
            LineKind::Deleted
        } else {
            LineKind::Inserted
        };
        pairs.push(LinePair {
            kind,
            old: old_line,
            new: new_line,
            old_inline: Vec::new(),
            new_inline: Vec::new(),
        });
    }
    if !o.is_empty() && !n.is_empty() && o.len() <= MAX_WORD_DIFF_LINES && n.len() <= MAX_WORD_DIFF_LINES {
        if let Some((old_marks, new_marks)) = word_diff(&old[o.clone()], &new[n.clone()]) {
            // Each line of the block sits in exactly one pair, at its offset in the block.
            for (line, cols) in old_marks {
                pairs[line].old_inline.push(cols);
            }
            for (line, cols) in new_marks {
                pairs[line].new_inline.push(cols);
            }
        }
    }
    DiffHunk { old_lines: o, new_lines: n, pairs }
}

#[derive(Clone, Copy)]
struct Token<'a> {
    text: &'a str,
    /// Line offset in the block; a newline token has its own line index and no columns.
    line: usize,
    col: usize,
    len: usize,
}

/// Words, whitespace runs and single punctuation chars. Splitting punctuation apart keeps a
/// change of `a.b` to `a.c` from highlighting the whole expression.
fn tokenize<'a>(lines: &[&'a str]) -> Vec<Token<'a>> {
    let mut tokens = Vec::new();
    for (line_idx, line) in lines.iter().enumerate() {
        let mut col = 0;
        let mut iter = line.char_indices().peekable();
        while let Some((start, c)) = iter.next() {
            let class = char_class(c);
            let mut end = start + c.len_utf8();
            let mut len = 1;
            if class != 2 {
                while let Some(&(i, next)) = iter.peek() {
                    if char_class(next) != class {
                        break;
                    }
                    end = i + next.len_utf8();
                    len += 1;
                    iter.next();
                }
            }
            tokens.push(Token { text: &line[start..end], line: line_idx, col, len });
            col += len;
        }
        tokens.push(Token { text: "\n", line: line_idx, col, len: 0 });
    }
    tokens
}

fn char_class(c: char) -> u8 {
    if c.is_alphanumeric() || c == '_' {
        0
    } else if c.is_whitespace() {
        1
    } else {
        2
    }
}

type Marks = Vec<(usize, Range<usize>)>;

/// Changed char ranges per line on both sides of a replaced block.
fn word_diff(old: &[&str], new: &[&str]) -> Option<(Marks, Marks)> {
    let old_tokens = tokenize(old);
    let new_tokens = tokenize(new);
    if old_tokens.len() + new_tokens.len() > MAX_WORD_DIFF_TOKENS {
        return None;
    }
    let a: Vec<&str> = old_tokens.iter().map(|t| t.text).collect();
    let b: Vec<&str> = new_tokens.iter().map(|t| t.text).collect();
    let deadline = Some(Instant::now() + Duration::from_millis(200));
    let ops = capture_diff_slices_deadline(Algorithm::Patience, &a, &b, deadline);
    let mut old_marks = Vec::new();
    let mut new_marks = Vec::new();
    for op in ops {
        let (tag, o, n) = op.as_tag_tuple();
        if tag == DiffTag::Equal {
            continue;
        }
        mark(&old_tokens[o], &mut old_marks);
        mark(&new_tokens[n], &mut new_marks);
    }
    Some((old_marks, new_marks))
}

fn mark(tokens: &[Token], out: &mut Marks) {
    for t in tokens {
        if t.len == 0 {
            continue;
        }
        let range = t.col..t.col + t.len;
        if let Some((line, last)) = out.last_mut() {
            if *line == t.line && last.end == range.start {
                last.end = range.end;
                continue;
            }
        }
        out.push((t.line, range));
    }
}

/// Gutter bars between a base text (HEAD) and the current buffer.
pub fn line_changes_between(old_text: &str, new_text: &str) -> Vec<LineChange> {
    let old = split_lines(old_text);
    let new = split_lines(new_text);
    changed_blocks(&old, &new)
        .into_iter()
        .map(|(o, n)| {
            let kind = if o.is_empty() {
                LineChangeKind::Added
            } else if n.is_empty() {
                LineChangeKind::Deleted
            } else {
                LineChangeKind::Modified
            };
            let mut old_text = old[o.clone()].join("\n");
            if !o.is_empty() {
                old_text.push('\n');
            }
            LineChange { kind, lines: n, old_lines: o, old_text }
        })
        .collect()
}

/// Reverts every change that touches `lines` of `new_text` back to `old_text`.
pub(crate) fn rollback_lines_between(old_text: &str, new_text: &str, lines: Range<usize>) -> String {
    let old = split_lines(old_text);
    let new = split_lines(new_text);
    let old_spans = line_spans(old_text);
    let new_spans = line_spans(new_text);
    // A caret without a selection still means "the change on this line".
    let sel = if lines.is_empty() { lines.start..lines.start + 1 } else { lines };
    let mut out = String::with_capacity(new_text.len());
    let mut cursor = 0;
    for (o, n) in changed_blocks(&old, &new) {
        let hit = if n.is_empty() {
            // Deleted lines sit between n.start - 1 and n.start; either neighbour selects them.
            sel.start <= n.start && n.start <= sel.end
        } else {
            n.start < sel.end && sel.start < n.end
        };
        if !hit {
            continue;
        }
        let keep_end = new_spans.get(n.start).map_or(new_text.len(), |r| r.start);
        out.push_str(&new_text[cursor..keep_end]);
        if !o.is_empty() {
            if !out.is_empty() && !out.ends_with('\n') {
                out.push('\n');
            }
            let from = old_spans[o.start].start;
            let to = old_spans[o.end - 1].end;
            out.push_str(&old_text[from..to]);
        }
        cursor = new_spans.get(n.end).map_or(new_text.len(), |r| r.start);
    }
    out.push_str(&new_text[cursor..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hunks_pair_lines_and_mark_words() {
        let old = "a\nlet x = 1;\nc\n";
        let new = "a\nlet y = 1;\nnew\nc\n";
        let hunks = diff_texts(old, new);
        assert_eq!(hunks.len(), 1);
        let h = &hunks[0];
        assert_eq!(h.old_lines, 1..2);
        assert_eq!(h.new_lines, 1..3);
        assert_eq!(h.pairs[0].kind, LineKind::Changed);
        assert_eq!(h.pairs[0].old_inline, vec![4..5]);
        assert_eq!(h.pairs[0].new_inline, vec![4..5]);
        assert_eq!(h.pairs[1].kind, LineKind::Inserted);
        assert_eq!(h.pairs[1].new, Some(2));
    }

    #[test]
    fn line_changes_kinds() {
        let old = "1\n2\n3\n4\n";
        let new = "1\nX\n3\nadded\n";
        let ch = line_changes_between(old, new);
        assert_eq!(ch.len(), 2);
        assert_eq!(ch[0].kind, LineChangeKind::Modified);
        assert_eq!(ch[1].lines, 3..4);

        let ch = line_changes_between("1\n2\n3\n", "1\n3\n");
        assert_eq!(ch[0].kind, LineChangeKind::Deleted);
        assert_eq!(ch[0].lines, 1..1);
        assert_eq!(ch[0].old_text, "2\n");

        let ch = line_changes_between("1\n", "1\n2\n");
        assert_eq!(ch[0].kind, LineChangeKind::Added);
        assert_eq!(ch[0].lines, 1..2);
    }

    #[test]
    fn rollback_only_selected_change() {
        let old = "a\nb\nc\nd\ne\n";
        let new = "a\nB\nc\nd\nE\nf\n";
        assert_eq!(rollback_lines_between(old, new, 1..2), "a\nb\nc\nd\nE\nf\n");
        assert_eq!(rollback_lines_between(old, new, 4..4), "a\nB\nc\nd\ne\n");
        // Deleted line restored when the caret is on the following line.
        assert_eq!(rollback_lines_between("a\nb\nc\n", "a\nc\n", 1..1), "a\nb\nc\n");
        // Final line without newline.
        assert_eq!(rollback_lines_between("a\nb\n", "a", 0..1), "a\nb\n");
        assert_eq!(rollback_lines_between("a\r\nb\r\n", "a\r\nx\r\n", 1..2), "a\r\nb\r\n");
    }
}
