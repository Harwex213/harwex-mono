//! Colors for `Language::Conf`: `.conf`, `.cfg`, `.ini`, `.properties`, `.env`, `.editorconfig`,
//! `.gitconfig`, `.npmrc` and nginx-style `.conf` files.
//!
//! These files share no grammar. tree-sitter-ini needs `=` and keeps a value as one opaque token
//! (no strings, numbers or booleans), and an nginx grammar turns an INI-style `.conf` into error
//! nodes. So each line is lexed on its own here. A line's colors never depend on the lines above
//! it, so the cost is the visible lines and nothing needs a tree or a worker.
//!
//! A line is a comment (`#`, `;`), a `[section]`, an Apache `<Tag>` or a statement. A statement
//! starts with a key. The key ends at `=`, `:` or a space. A key followed only by a space
//! (`listen 80;`, `key value`) counts as a key when the line is not indented or ends with `;`,
//! `{` or `}`; an indented line without them is a continued INI value. With a space key, `;`,
//! `{` and `}` end the statement, and the next word is a key again (`server { listen 80; }`).

use std::ops::Range;

use ropey::Rope;

use crate::highlight::{HlKind, Span};

/// Lines longer than this are not colored: a minified line would cost its length on every repaint.
const MAX_LINE: usize = 64 << 10;

/// Colored spans per line for `lines`.
pub(crate) fn conf_spans(rope: &Rope, lines: Range<usize>) -> Vec<Vec<Span>> {
    let mut buf = Vec::new();
    lines
        .map(|line| {
            let mut spans = Vec::new();
            if line >= rope.len_lines() {
                return spans;
            }
            let slice = rope.line(line);
            if slice.len_bytes() > MAX_LINE {
                return spans;
            }
            buf.clear();
            buf.extend(slice.bytes());
            line_spans(&buf, &mut spans);
            spans
        })
        .collect()
}

/// Spans of one line, in byte offsets from its start. The line break is never colored.
pub(crate) fn line_spans(line: &[u8], out: &mut Vec<Span>) {
    let mut end = line.len();
    while end > 0 && matches!(line[end - 1], b'\n' | b'\r') {
        end -= 1;
    }
    let mut lx = Lexer {
        b: &line[..end],
        out,
    };
    let start = lx.skip_ws(0);
    let Some(&first) = lx.b.get(start) else {
        return;
    };
    match first {
        b'#' | b';' => {
            lx.push(start, end, HlKind::Comment);
            return;
        }
        b'[' => {
            if let Some(close) = lx.find(start, b']') {
                lx.section(start, close + 1);
                lx.values(close + 1, false);
                return;
            }
        }
        b'<' => {
            if let Some(close) = lx.find(start, b'>') {
                lx.push(start, close + 1, HlKind::Tag);
                lx.values(close + 1, false);
                return;
            }
        }
        _ => {}
    }
    let last =
        lx.b.iter()
            .rposition(|c| !c.is_ascii_whitespace())
            .map(|i| lx.b[i]);
    let space_keys = start == 0 || matches!(last, Some(b';' | b'{' | b'}'));
    lx.statements(start, space_keys);
}

struct Lexer<'a, 'o> {
    b: &'a [u8],
    out: &'o mut Vec<Span>,
}

impl Lexer<'_, '_> {
    fn push(&mut self, start: usize, end: usize, kind: HlKind) {
        if start >= end {
            return;
        }
        if let Some(last) = self.out.last_mut() {
            if last.kind == kind && last.end as usize == start {
                last.end = end as u32;
                return;
            }
        }
        self.out.push(Span {
            start: start as u32,
            end: end as u32,
            kind,
        });
    }

    fn skip_ws(&self, mut i: usize) -> usize {
        while i < self.b.len() && self.b[i].is_ascii_whitespace() {
            i += 1;
        }
        i
    }

    fn find(&self, from: usize, c: u8) -> Option<usize> {
        self.b[from..]
            .iter()
            .position(|&x| x == c)
            .map(|p| from + p)
    }

    /// `[section]` as a keyword; a quoted part (`[remote "origin"]`) as a string.
    fn section(&mut self, start: usize, end: usize) {
        let mut i = start;
        let mut run = start;
        while i < end {
            if self.b[i] == b'"' {
                self.push(run, i, HlKind::Keyword);
                let close = self
                    .find(i + 1, b'"')
                    .map_or(end - 1, |c| (c + 1).min(end - 1));
                self.push(i, close, HlKind::String);
                i = close;
                run = close;
            } else {
                i += 1;
            }
        }
        self.push(run, end, HlKind::Keyword);
    }

    /// Statements from `i` to the line end. `space_keys`: a key may end at a space, and `;`, `{`,
    /// `}` start the next statement.
    fn statements(&mut self, mut i: usize, space_keys: bool) {
        let mut first = true;
        loop {
            i = self.skip_ws(i);
            let Some(&c) = self.b.get(i) else {
                return;
            };
            if space_keys && matches!(c, b';' | b'{' | b'}') {
                i += 1;
                continue;
            }
            if c == b'#' {
                self.push(i, self.b.len(), HlKind::Comment);
                return;
            }
            // dotenv: `export KEY=value`.
            if first && self.b[i..].starts_with(b"export ") {
                self.push(i, i + 6, HlKind::Keyword);
                i = self.skip_ws(i + 6);
            }
            first = false;
            let key_start = i;
            while i < self.b.len() && !is_key_end(self.b[i]) {
                i += 1;
            }
            let key_end = i;
            let sep = self.skip_ws(key_end);
            if key_end > key_start && matches!(self.b.get(sep), Some(b'=' | b':')) {
                self.push(key_start, key_end, HlKind::Property);
                self.values(sep + 1, false);
                return;
            }
            if key_end == key_start || !space_keys {
                self.values(key_start, false);
                return;
            }
            self.push(key_start, key_end, HlKind::Property);
            i = self.values(key_end, true);
        }
    }

    /// Values from `i`: strings, `$variables`, numbers, booleans and a trailing `#` comment.
    /// With `statement_end`, stops after `;`, `{` or `}` and returns the position after it.
    fn values(&mut self, mut i: usize, statement_end: bool) -> usize {
        let len = self.b.len();
        while i < len {
            let c = self.b[i];
            let at_token = i == 0 || self.b[i - 1].is_ascii_whitespace();
            match c {
                _ if c.is_ascii_whitespace() => i += 1,
                b'#' if at_token => {
                    self.push(i, len, HlKind::Comment);
                    return len;
                }
                b'"' | b'\''
                    if at_token || matches!(self.b[i - 1], b'=' | b':' | b'(' | b'[' | b',') =>
                {
                    i = self.string(i, true);
                }
                b'$' => match self.variable_end(i) {
                    Some(e) => {
                        self.push(i, e, HlKind::Constant);
                        i = e;
                    }
                    None => i += 1,
                },
                b';' | b'{' | b'}' if statement_end => return i + 1,
                b';' | b'{' | b'}' | b',' => i += 1,
                _ => {
                    let start = i;
                    while i < len && !is_word_end(self.b[i]) {
                        i += 1;
                    }
                    let word = &self.b[start..i];
                    if is_number(word) {
                        self.push(start, i, HlKind::Number);
                    } else if is_boolean(word) {
                        self.push(start, i, HlKind::Builtin);
                    }
                }
            }
        }
        len
    }

    /// A quoted string from `i` to its closing quote or the line end. In double quotes `\x` is an
    /// escape, and with `vars` `$VAR` is a variable (dotenv, nginx). Returns the position after it.
    fn string(&mut self, i: usize, vars: bool) -> usize {
        let q = self.b[i];
        let len = self.b.len();
        let mut run = i;
        let mut j = i + 1;
        while j < len {
            let c = self.b[j];
            if c == q {
                self.push(run, j + 1, HlKind::String);
                return j + 1;
            }
            if q == b'"' && c == b'\\' && j + 1 < len {
                self.push(run, j, HlKind::String);
                self.push(j, j + 2, HlKind::Escape);
                j += 2;
                run = j;
                continue;
            }
            if vars && q == b'"' && c == b'$' {
                if let Some(e) = self.variable_end(j) {
                    self.push(run, j, HlKind::String);
                    self.push(j, e, HlKind::Constant);
                    j = e;
                    run = j;
                    continue;
                }
            }
            j += 1;
        }
        self.push(run, len, HlKind::String);
        len
    }

    /// The end of `$name`, `$1` or `${...}` at `i`, or `None` for a lone `$`.
    fn variable_end(&self, i: usize) -> Option<usize> {
        match self.b.get(i + 1)? {
            b'{' => self.find(i + 2, b'}').map(|c| c + 1),
            c if c.is_ascii_alphanumeric() || *c == b'_' => {
                let mut e = i + 1;
                while e < self.b.len() && (self.b[e].is_ascii_alphanumeric() || self.b[e] == b'_') {
                    e += 1;
                }
                Some(e)
            }
            _ => None,
        }
    }
}

fn is_key_end(c: u8) -> bool {
    c.is_ascii_whitespace() || matches!(c, b'=' | b':' | b';' | b'{' | b'}' | b'"' | b'\'')
}

fn is_word_end(c: u8) -> bool {
    c.is_ascii_whitespace() || matches!(c, b'$' | b';' | b'{' | b'}' | b',')
}

/// `80`, `-1`, `1.5`, `0x1F`, and nginx sizes and times (`512k`, `30s`, `10ms`). Versions and
/// addresses (`1.2.3`, `127.0.0.1`) are not numbers.
fn is_number(w: &[u8]) -> bool {
    let w = w
        .strip_prefix(b"-")
        .or_else(|| w.strip_prefix(b"+"))
        .unwrap_or(w);
    if let Some(hex) = w.strip_prefix(b"0x").or_else(|| w.strip_prefix(b"0X")) {
        return !hex.is_empty() && hex.iter().all(u8::is_ascii_hexdigit);
    }
    let int = w.iter().take_while(|c| c.is_ascii_digit()).count();
    if int == 0 {
        return false;
    }
    let mut rest = &w[int..];
    if let Some(frac) = rest.strip_prefix(b".") {
        let n = frac.iter().take_while(|c| c.is_ascii_digit()).count();
        if n == 0 {
            return false;
        }
        rest = &frac[n..];
    }
    rest.len() <= 2 && rest.iter().all(u8::is_ascii_alphabetic)
}

fn is_boolean(w: &[u8]) -> bool {
    ["true", "false", "yes", "no", "on", "off"]
        .iter()
        .any(|b| w.eq_ignore_ascii_case(b.as_bytes()))
}

/// YAML files over `Language::YAML_MAX_TREE_LINES` lines have no tree (see there). Each line
/// is lexed on its own: keys before `:`, quoted and plain scalars, numbers, booleans and `null`,
/// anchors, aliases, tags, document markers, directives and comments. A block scalar's lines
/// (`|`, `>`) cannot be told apart without the lines above, so they are lexed like other lines.
pub(crate) fn yaml_spans(rope: &Rope, lines: Range<usize>) -> Vec<Vec<Span>> {
    let mut buf = Vec::new();
    lines
        .map(|line| {
            let mut spans = Vec::new();
            if line >= rope.len_lines() {
                return spans;
            }
            let slice = rope.line(line);
            if slice.len_bytes() > MAX_LINE {
                return spans;
            }
            buf.clear();
            buf.extend(slice.bytes());
            yaml_line_spans(&buf, &mut spans);
            spans
        })
        .collect()
}

pub(crate) fn yaml_line_spans(line: &[u8], out: &mut Vec<Span>) {
    let mut end = line.len();
    while end > 0 && matches!(line[end - 1], b'\n' | b'\r') {
        end -= 1;
    }
    let mut lx = Lexer {
        b: &line[..end],
        out,
    };
    let b = lx.b;
    if b.first() == Some(&b'%') {
        lx.push(0, end, HlKind::Keyword);
        return;
    }
    let mut i = 0;
    if (b.starts_with(b"---") || b.starts_with(b"..."))
        && b.get(3).is_none_or(u8::is_ascii_whitespace)
    {
        lx.push(0, 3, HlKind::Keyword);
        i = 3;
    }
    i = lx.skip_ws(i);
    // Sequence entries and complex-key markers before the content: `- - key: v`, `? key`.
    while matches!(b.get(i), Some(b'-' | b'?')) && b.get(i + 1).is_none_or(u8::is_ascii_whitespace)
    {
        i = lx.skip_ws(i + 1);
    }
    lx.yaml_values(i, 0);
}

impl Lexer<'_, '_> {
    /// Scalars, flow collections and properties from `i`. `depth` counts open `[` and `{`.
    fn yaml_values(&mut self, mut i: usize, mut depth: usize) {
        let len = self.b.len();
        while i < len {
            let c = self.b[i];
            let at_token = i == 0 || self.b[i - 1].is_ascii_whitespace() || is_flow(self.b[i - 1]);
            match c {
                _ if c.is_ascii_whitespace() => i += 1,
                b'#' if at_token => {
                    self.push(i, len, HlKind::Comment);
                    return;
                }
                b'[' | b'{' => {
                    depth += 1;
                    i += 1;
                }
                b']' | b'}' => {
                    depth = depth.saturating_sub(1);
                    i += 1;
                }
                b',' => i += 1,
                b':' if self
                    .b
                    .get(i + 1)
                    .is_none_or(|n| n.is_ascii_whitespace() || is_flow(*n)) =>
                {
                    i += 1
                }
                b'-' if depth == 0 && self.b.get(i + 1).is_none_or(u8::is_ascii_whitespace) => {
                    i += 1
                }
                b'&' | b'*' | b'!' => {
                    let e = self.yaml_token_end(i);
                    self.push(
                        i,
                        e,
                        if c == b'!' {
                            HlKind::Keyword
                        } else {
                            HlKind::Type
                        },
                    );
                    i = e;
                }
                b'|' | b'>' if depth == 0 => {
                    // A block scalar header: `|`, `>-`, `|2+`.
                    i += 1;
                    while i < len && matches!(self.b[i], b'-' | b'+' | b'0'..=b'9') {
                        i += 1;
                    }
                }
                b'"' | b'\'' => {
                    let e = self.yaml_quoted_end(i);
                    if self.yaml_key_follows(e, depth) {
                        self.push(i, e, HlKind::Property);
                    } else if c == b'"' {
                        self.string(i, false);
                    } else {
                        self.push(i, e, HlKind::String);
                    }
                    i = e;
                }
                _ => {
                    let e = self.yaml_plain_end(i, depth);
                    let kind = if self.yaml_key_follows(e, depth) {
                        HlKind::Property
                    } else {
                        let word = &self.b[i..e];
                        if is_yaml_number(word) {
                            HlKind::Number
                        } else if is_yaml_builtin(word) {
                            HlKind::Builtin
                        } else {
                            HlKind::String
                        }
                    };
                    self.push(i, e, kind);
                    i = e.max(i + 1);
                }
            }
        }
    }

    fn yaml_token_end(&self, mut i: usize) -> usize {
        while i < self.b.len()
            && !self.b[i].is_ascii_whitespace()
            && !matches!(self.b[i], b',' | b'[' | b']' | b'{' | b'}')
        {
            i += 1;
        }
        i
    }

    /// The end of a quoted scalar at `i`: after its closing quote, or the line end.
    fn yaml_quoted_end(&self, i: usize) -> usize {
        let q = self.b[i];
        let mut j = i + 1;
        while j < self.b.len() {
            if q == b'"' && self.b[j] == b'\\' {
                j += 2;
                continue;
            }
            if self.b[j] == q {
                // `''` is an escaped quote inside a single-quoted scalar.
                if q == b'\'' && self.b.get(j + 1) == Some(&b'\'') {
                    j += 2;
                    continue;
                }
                return j + 1;
            }
            j += 1;
        }
        self.b.len()
    }

    /// The end of a plain scalar at `i`: before ` #`, before `: ` (or `:` at the end), and in a
    /// flow collection before `,`, `]`, `}`. Trailing spaces are left out.
    fn yaml_plain_end(&self, i: usize, depth: usize) -> usize {
        let len = self.b.len();
        let mut j = i;
        while j < len {
            let c = self.b[j];
            if c == b'#' && j > i && self.b[j - 1].is_ascii_whitespace() {
                break;
            }
            if c == b':'
                && self
                    .b
                    .get(j + 1)
                    .is_none_or(|n| n.is_ascii_whitespace() || (depth > 0 && is_flow(*n)))
            {
                break;
            }
            if depth > 0 && matches!(c, b',' | b']' | b'}' | b'[' | b'{') {
                break;
            }
            j += 1;
        }
        while j > i && self.b[j - 1].is_ascii_whitespace() {
            j -= 1;
        }
        j
    }

    /// Whether a `:` that makes the scalar ending at `e` a key comes next.
    fn yaml_key_follows(&self, e: usize, depth: usize) -> bool {
        let k = self.skip_ws(e);
        self.b.get(k) == Some(&b':')
            && self
                .b
                .get(k + 1)
                .is_none_or(|n| n.is_ascii_whitespace() || (depth > 0 && is_flow(*n)))
    }
}

fn is_flow(c: u8) -> bool {
    matches!(c, b',' | b'[' | b']' | b'{' | b'}')
}

/// The core schema's numbers: `3`, `-1.5`, `1e3`, `0x1F`, `0o17`, `.inf`, `.nan`.
fn is_yaml_number(w: &[u8]) -> bool {
    let w = w
        .strip_prefix(b"-")
        .or_else(|| w.strip_prefix(b"+"))
        .unwrap_or(w);
    if [&b".inf"[..], b".Inf", b".INF", b".nan", b".NaN", b".NAN"].contains(&w) {
        return true;
    }
    if let Some(d) = w.strip_prefix(b"0x") {
        return !d.is_empty() && d.iter().all(u8::is_ascii_hexdigit);
    }
    if let Some(d) = w.strip_prefix(b"0o") {
        return !d.is_empty() && d.iter().all(|c| (b'0'..=b'7').contains(c));
    }
    let digits = |s: &[u8]| s.iter().take_while(|c| c.is_ascii_digit()).count();
    let int = digits(w);
    let mut rest = &w[int..];
    let mut frac = 0;
    if let Some(r) = rest.strip_prefix(b".") {
        frac = digits(r);
        rest = &r[frac..];
    }
    if int + frac == 0 {
        return false;
    }
    if let Some(r) = rest.strip_prefix(b"e").or_else(|| rest.strip_prefix(b"E")) {
        let r = r
            .strip_prefix(b"-")
            .or_else(|| r.strip_prefix(b"+"))
            .unwrap_or(r);
        let n = digits(r);
        return n > 0 && n == r.len();
    }
    rest.is_empty()
}

/// The core schema's booleans and nulls.
fn is_yaml_builtin(w: &[u8]) -> bool {
    [
        &b"true"[..],
        b"True",
        b"TRUE",
        b"false",
        b"False",
        b"FALSE",
        b"null",
        b"Null",
        b"NULL",
        b"~",
    ]
    .contains(&w)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(line: &str) -> Vec<(&str, HlKind)> {
        let mut out = Vec::new();
        line_spans(line.as_bytes(), &mut out);
        out.iter()
            .map(|s| (&line[s.start as usize..s.end as usize], s.kind))
            .collect()
    }

    #[test]
    fn numbers_are_whole_words() {
        for w in ["80", "-1", "1.5", "0x1F", "512k", "30s", "10ms"] {
            assert!(is_number(w.as_bytes()), "{w}");
        }
        for w in ["1.2.3", "127.0.0.1", "v1", "1.", "0x", "8080/tcp", "1abc"] {
            assert!(!is_number(w.as_bytes()), "{w}");
        }
    }

    #[test]
    fn line_break_and_unclosed_quote() {
        use HlKind::*;
        assert_eq!(kinds("# c\r\n"), [("# c", Comment)]);
        assert_eq!(kinds("a = \"open\n"), [("a", Property), ("\"open", String)]);
        assert_eq!(kinds("   \n"), []);
        // A quote inside a word is text, not a string start.
        assert_eq!(kinds("msg = don't stop\n"), [("msg", Property)]);
    }
}
