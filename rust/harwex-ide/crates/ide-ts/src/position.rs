//! The only place where positions cross the API boundary.
//!
//! The public API is 0-based with columns in chars, because that is what the editor counts.
//! tsserver is 1-based for both line and offset, and its offset counts UTF-16 code units.
//! Every conversion goes through [`LineIndex`], so the two conventions never mix elsewhere.

use std::sync::Arc;

/// Line table for one text, split by the same rules as TypeScript's `computeLineStarts`.
///
/// tsserver numbers lines by its own rules (LF, CRLF, lone CR, U+2028, U+2029), so the
/// column conversion must use the same split, or a file with a lone CR shifts every line.
pub(crate) struct LineIndex {
    text: Arc<str>,
    /// Byte range of each line's content, without the line terminator.
    lines: Vec<(usize, usize)>,
}

impl LineIndex {
    pub(crate) fn new(text: impl Into<Arc<str>>) -> LineIndex {
        let text: Arc<str> = text.into();
        let mut lines = Vec::new();
        let mut start = 0;
        let mut iter = text.char_indices().peekable();
        while let Some((i, c)) = iter.next() {
            match c {
                '\r' => {
                    lines.push((start, i));
                    if let Some(&(_, '\n')) = iter.peek() {
                        iter.next();
                        start = i + 2;
                    } else {
                        start = i + 1;
                    }
                }
                '\n' => {
                    lines.push((start, i));
                    start = i + 1;
                }
                '\u{2028}' | '\u{2029}' => {
                    lines.push((start, i));
                    start = i + c.len_utf8();
                }
                _ => {}
            }
        }
        lines.push((start, text.len()));
        LineIndex { text, lines }
    }

    /// Text of a 0-based line without its terminator; empty when the line does not exist.
    pub(crate) fn line(&self, line: usize) -> &str {
        match self.lines.get(line) {
            Some(&(start, end)) => &self.text[start..end],
            None => "",
        }
    }

    /// tsserver position just past the last character of the text.
    pub(crate) fn ts_end(&self) -> (usize, usize) {
        self.ts_pos(self.lines.len() - 1, usize::MAX)
    }

    /// 0-based (line, char column) to tsserver's 1-based (line, UTF-16 offset).
    ///
    /// Columns past the end of the line clamp to the end, so a stale cursor still asks
    /// tsserver something sensible instead of failing.
    pub(crate) fn ts_pos(&self, line: usize, column: usize) -> (usize, usize) {
        let line = line.min(self.lines.len() - 1);
        let utf16: usize = self.line(line).chars().take(column).map(char::len_utf16).sum();
        (line + 1, utf16 + 1)
    }

    /// tsserver's 1-based (line, UTF-16 offset) to 0-based (line, char column).
    pub(crate) fn editor_pos(&self, line: usize, offset: usize) -> (usize, usize) {
        let line = line.saturating_sub(1);
        let target = offset.saturating_sub(1);
        let mut units = 0;
        let mut chars = 0;
        for c in self.line(line).chars() {
            if units >= target {
                break;
            }
            units += c.len_utf16();
            chars += 1;
        }
        (line, chars)
    }
}

#[cfg(test)]
mod tests {
    use super::LineIndex;

    #[test]
    fn splits_lines_like_typescript() {
        let index = LineIndex::new("a\nb\r\nc\rd\u{2028}e");
        let lines: Vec<&str> = (0..5).map(|i| index.line(i)).collect();
        assert_eq!(lines, ["a", "b", "c", "d", "e"]);
        assert_eq!(index.line(5), "");
    }

    #[test]
    fn ascii_is_one_based() {
        let index = LineIndex::new("let x = 1;\nfoo();");
        assert_eq!(index.ts_pos(1, 0), (2, 1));
        assert_eq!(index.editor_pos(2, 1), (1, 0));
        assert_eq!(index.ts_pos(0, 4), (1, 5));
        assert_eq!(index.editor_pos(1, 5), (0, 4));
    }

    #[test]
    fn astral_chars_count_two_utf16_units() {
        // Each emoji is one char but two UTF-16 code units.
        let index = LineIndex::new("const s = \"😀😀\"; greet(s);");
        let column = "const s = \"😀😀\"; ".chars().count();
        assert_eq!(index.ts_pos(0, column), (1, column + 2 + 1));
        assert_eq!(index.editor_pos(1, column + 2 + 1), (0, column));
    }

    #[test]
    fn bmp_non_ascii_is_one_unit() {
        let index = LineIndex::new("é = ü;");
        assert_eq!(index.ts_pos(0, 4), (1, 5));
        assert_eq!(index.editor_pos(1, 5), (0, 4));
    }

    #[test]
    fn end_position_covers_trailing_newline() {
        assert_eq!(LineIndex::new("ab\n").ts_end(), (2, 1));
        assert_eq!(LineIndex::new("a😀").ts_end(), (1, 4));
        assert_eq!(LineIndex::new("").ts_end(), (1, 1));
    }

    #[test]
    fn clamps_out_of_range() {
        let index = LineIndex::new("ab");
        assert_eq!(index.ts_pos(0, 99), (1, 3));
        assert_eq!(index.ts_pos(7, 0), (1, 1));
        assert_eq!(index.editor_pos(1, 99), (0, 2));
        assert_eq!(index.editor_pos(0, 0), (0, 0));
    }
}
