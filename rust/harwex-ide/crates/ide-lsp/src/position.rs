//! Position conversion between the editor and LSP.
//!
//! The editor counts 0-based lines and 0-based columns in chars. LSP counts 0-based lines and
//! 0-based characters in UTF-16 code units (`positionEncoding: utf-16`, the only encoding every
//! server supports). Every conversion goes through [`LineIndex`], so the two never mix.

use std::sync::Arc;

/// Which characters end a line.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum LineBreaks {
    /// LF, CRLF and a lone CR, as the LSP specification says.
    #[default]
    Lsp,
    /// The LSP set plus U+2028 and U+2029. TypeScript (`computeLineStarts`) and JavaScript
    /// count those as line terminators too, so a TS server's line numbers need them.
    Unicode,
}

/// Line table for one text.
pub struct LineIndex {
    text: Arc<str>,
    /// Byte range of each line's content, without the line terminator.
    lines: Vec<(usize, usize)>,
}

impl LineIndex {
    /// Lines split by the LSP rules.
    pub fn new(text: impl Into<Arc<str>>) -> LineIndex {
        LineIndex::with_breaks(text, LineBreaks::Lsp)
    }

    pub fn with_breaks(text: impl Into<Arc<str>>, breaks: LineBreaks) -> LineIndex {
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
                '\u{2028}' | '\u{2029}' if breaks == LineBreaks::Unicode => {
                    lines.push((start, i));
                    start = i + c.len_utf8();
                }
                _ => {}
            }
        }
        lines.push((start, text.len()));
        LineIndex { text, lines }
    }

    /// Number of lines; a text that ends with a line break has an empty last line.
    pub fn line_count(&self) -> usize {
        self.lines.len()
    }

    /// Text of a 0-based line without its terminator; empty when the line does not exist.
    pub fn line(&self, line: usize) -> &str {
        match self.lines.get(line) {
            Some(&(start, end)) => &self.text[start..end],
            None => "",
        }
    }

    /// Editor (line, char column) to LSP (line, UTF-16 character).
    ///
    /// Out-of-range positions clamp to the last line and the end of the line, so a stale caret
    /// still asks the server something sensible instead of failing.
    pub fn to_lsp(&self, line: usize, column: usize) -> (usize, usize) {
        let line = line.min(self.lines.len() - 1);
        let utf16: usize = self.line(line).chars().take(column).map(char::len_utf16).sum();
        (line, utf16)
    }

    /// LSP (line, UTF-16 character) to editor (line, char column). A character inside a
    /// surrogate pair rounds up to the next char; one past the end clamps to the end.
    pub fn from_lsp(&self, line: usize, character: usize) -> (usize, usize) {
        let mut units = 0;
        let mut chars = 0;
        for c in self.line(line).chars() {
            if units >= character {
                break;
            }
            units += c.len_utf16();
            chars += 1;
        }
        (line, chars)
    }

    /// LSP position just past the last character of the text.
    pub fn lsp_end(&self) -> (usize, usize) {
        self.to_lsp(self.lines.len() - 1, usize::MAX)
    }
}

#[cfg(test)]
mod tests {
    use super::{LineBreaks, LineIndex};

    #[test]
    fn lsp_breaks_ignore_unicode_separators() {
        let index = LineIndex::new("a\nb\r\nc\rd\u{2028}e");
        let lines: Vec<&str> = (0..index.line_count()).map(|i| index.line(i)).collect();
        assert_eq!(lines, ["a", "b", "c", "d\u{2028}e"]);
        let index = LineIndex::with_breaks("a\nb\r\nc\rd\u{2028}e", LineBreaks::Unicode);
        let lines: Vec<&str> = (0..index.line_count()).map(|i| index.line(i)).collect();
        assert_eq!(lines, ["a", "b", "c", "d", "e"]);
        assert_eq!(index.line(5), "");
    }

    #[test]
    fn astral_chars_count_two_utf16_units() {
        let index = LineIndex::new("a\nconst s = \"😀😀\"; greet(s);");
        let column = "const s = \"😀😀\"; ".chars().count();
        assert_eq!(index.to_lsp(1, column), (1, column + 2));
        assert_eq!(index.from_lsp(1, column + 2), (1, column));
        assert_eq!(index.to_lsp(0, 0), (0, 0));
        assert_eq!(index.from_lsp(0, 0), (0, 0));
    }

    #[test]
    fn bmp_non_ascii_is_one_unit() {
        let index = LineIndex::new("é = ü;");
        assert_eq!(index.to_lsp(0, 4), (0, 4));
        assert_eq!(index.from_lsp(0, 4), (0, 4));
    }

    #[test]
    fn clamps_out_of_range() {
        let index = LineIndex::new("ab");
        assert_eq!(index.to_lsp(0, 99), (0, 2));
        assert_eq!(index.to_lsp(7, 0), (0, 0));
        assert_eq!(index.from_lsp(0, 99), (0, 2));
        // Inside a surrogate pair: the char that starts there is counted.
        assert_eq!(LineIndex::new("😀x").from_lsp(0, 1), (0, 1));
    }

    #[test]
    fn end_position_covers_trailing_newline() {
        assert_eq!(LineIndex::new("ab\n").lsp_end(), (1, 0));
        assert_eq!(LineIndex::new("a😀").lsp_end(), (0, 3));
        assert_eq!(LineIndex::new("").lsp_end(), (0, 0));
    }
}
