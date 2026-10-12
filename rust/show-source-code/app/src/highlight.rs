//! A small per-line lexer for card bodies: keywords, strings, comments, numbers and type-like
//! names. Cards show at most a few dozen lines, so it runs every frame for the visible ones.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Plain,
    Keyword,
    String,
    Comment,
    Number,
    Type,
}

const KEYWORDS: &[&str] = &[
    "abstract", "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "debugger", "declare", "default", "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for", "from", "function", "get", "if", "implements", "import", "in", "instanceof", "interface", "keyof", "let", "module", "namespace", "new", "null", "of", "private", "protected", "public", "readonly", "return", "satisfies", "set", "static", "super", "switch", "this", "throw", "true", "try", "type", "typeof", "undefined", "var", "void", "while", "yield",
];

/// Splits `line` into colored runs (byte ranges). `in_block` carries an open `/* */` comment
/// from the previous line and is updated for the next one.
pub fn line(line: &str, in_block: &mut bool) -> Vec<(std::ops::Range<usize>, Kind)> {
    let b = line.as_bytes();
    let mut out: Vec<(std::ops::Range<usize>, Kind)> = Vec::new();
    let mut push = |r: std::ops::Range<usize>, k: Kind| {
        if r.is_empty() {
            return;
        }
        match out.last_mut() {
            Some((last, lk)) if *lk == k && last.end == r.start => last.end = r.end,
            _ => out.push((r, k)),
        }
    };
    let mut i = 0;
    if *in_block {
        match line.find("*/") {
            Some(end) => {
                push(0..end + 2, Kind::Comment);
                i = end + 2;
                *in_block = false;
            }
            None => {
                push(0..b.len(), Kind::Comment);
                return out;
            }
        }
    }
    while i < b.len() {
        let c = b[i];
        let start = i;
        if c == b'/' && b.get(i + 1) == Some(&b'/') {
            push(i..b.len(), Kind::Comment);
            break;
        } else if c == b'/' && b.get(i + 1) == Some(&b'*') {
            match line[i + 2..].find("*/") {
                Some(end) => i = i + 2 + end + 2,
                None => {
                    i = b.len();
                    *in_block = true;
                }
            }
            push(start..i, Kind::Comment);
        } else if c == b'"' || c == b'\'' || c == b'`' {
            i += 1;
            while i < b.len() && b[i] != c {
                i += if b[i] == b'\\' { 2 } else { 1 };
            }
            i = (i + 1).min(b.len());
            push(start..i, Kind::String);
        } else if c.is_ascii_digit() {
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'.' || b[i] == b'_') {
                i += 1;
            }
            push(start..i, Kind::Number);
        } else if c.is_ascii_alphabetic() || c == b'_' || c == b'$' {
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_' || b[i] == b'$') {
                i += 1;
            }
            let word = &line[start..i];
            let kind = if KEYWORDS.contains(&word) {
                Kind::Keyword
            } else if c.is_ascii_uppercase() {
                Kind::Type
            } else {
                Kind::Plain
            };
            push(start..i, kind);
        } else {
            // Advance by a whole char, so ranges stay on char boundaries.
            i += line[i..].chars().next().map_or(1, char::len_utf8);
            push(start..i, Kind::Plain);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(s: &str) -> Vec<(&str, Kind)> {
        let mut b = false;
        line(s, &mut b).into_iter().map(|(r, k)| (&s[r], k)).collect()
    }

    #[test]
    fn colors_basic_tokens() {
        assert_eq!(
            kinds("const x = \"a\"; // hi"),
            [("const", Kind::Keyword), (" x = ", Kind::Plain), ("\"a\"", Kind::String), ("; ", Kind::Plain), ("// hi", Kind::Comment)]
        );
        assert_eq!(kinds("Store<S> 42"), [("Store", Kind::Type), ("<", Kind::Plain), ("S", Kind::Type), ("> ", Kind::Plain), ("42", Kind::Number)]);
    }

    #[test]
    fn block_comments_span_lines() {
        let mut b = false;
        assert_eq!(line("a /* b", &mut b).last().unwrap().1, Kind::Comment);
        assert!(b);
        let rest = line("c */ d", &mut b);
        assert_eq!(rest[0], (0..4, Kind::Comment));
        assert!(!b);
    }
}
