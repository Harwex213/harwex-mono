//! Detection of `path:line:col` references in terminal output.
//!
//! Compilers and linters print locations in a few shapes: `src/a.rs:12:5` (rustc, tsc --pretty
//! false, eslint unix, grep -n), `src/a.ts(12,5)` (tsc default) and plain paths. The detector
//! works on one logical line of cells and only reports text that looks like a path. Whether the
//! file exists is checked separately by [`resolve`], because that needs the disk.

use std::path::{Path, PathBuf};

/// A path-like token found in a line. `start..end` are cell indices into the line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PathHit {
    pub path: String,
    /// 1-based, as printed.
    pub line: Option<usize>,
    /// 1-based, as printed.
    pub column: Option<usize>,
    pub start: usize,
    pub end: usize,
}

fn is_separator(c: char) -> bool {
    c.is_whitespace()
        || matches!(
            c,
            '"' | '\'' | '`' | '<' | '>' | '|' | ';' | '{' | '}' | '=' | '\0'
        )
}

fn parse_number(s: &str) -> Option<usize> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

/// Splits `path:line:col`, `path:line` or `path(line,col)` into parts.
fn split_location(token: &str) -> (&str, Option<usize>, Option<usize>) {
    // tsc: `file.ts(12,5)`
    if let Some(body) = token.strip_suffix(')') {
        if let Some(open) = body.rfind('(') {
            let inside = &body[open + 1..];
            let mut parts = inside.splitn(2, ',');
            let line = parts.next().and_then(parse_number);
            let column = parts.next().and_then(parse_number);
            if line.is_some() {
                return (&body[..open], line, column);
            }
        }
    }
    let mut path = token;
    let mut numbers = Vec::new();
    while numbers.len() < 2 {
        match path.rfind(':') {
            Some(i) => match parse_number(&path[i + 1..]) {
                Some(n) => {
                    numbers.push(n);
                    path = &path[..i];
                }
                None => break,
            },
            None => break,
        }
    }
    match numbers.as_slice() {
        [line] => (path, Some(*line), None),
        [column, line] => (path, Some(*line), Some(*column)),
        _ => (path, None, None),
    }
}

fn looks_like_path(path: &str) -> bool {
    if path.is_empty() || path.contains("://") || path.starts_with('-') {
        return false;
    }
    if !path.chars().any(|c| c.is_alphabetic()) {
        return false;
    }
    if path.contains('/') {
        return true;
    }
    // A bare name needs an extension that is not purely numeric (rules out "1.5", "v2.0").
    match path.rsplit_once('.') {
        Some((stem, ext)) => {
            !stem.is_empty()
                && !ext.is_empty()
                && ext.chars().all(|c| c.is_ascii_alphanumeric())
                && ext.chars().any(|c| c.is_ascii_alphabetic())
        }
        None => false,
    }
}

/// Finds the path-like token under cell `col` of `line`.
pub fn path_at(line: &[char], col: usize) -> Option<PathHit> {
    if col >= line.len() || is_separator(line[col]) {
        return None;
    }
    let mut start = col;
    while start > 0 && !is_separator(line[start - 1]) {
        start -= 1;
    }
    let mut end = col + 1;
    while end < line.len() && !is_separator(line[end]) {
        end += 1;
    }

    // Trim wrapping punctuation that is not part of the path: "(see src/a.rs:3)." and "[src/a.ts]".
    const LEAD: &[char] = &['(', '[', ','];
    const TRAIL: &[char] = &['.', ',', ':', ']', '!', '?'];
    while start < end && LEAD.contains(&line[start]) {
        start += 1;
    }
    loop {
        while end > start && TRAIL.contains(&line[end - 1]) {
            end -= 1;
        }
        // A closing paren is kept only when it ends a tsc `(line,col)` suffix with its own `(`.
        if end > start && line[end - 1] == ')' {
            let opens = line[start..end].iter().filter(|&&c| c == '(').count();
            let closes = line[start..end].iter().filter(|&&c| c == ')').count();
            if closes > opens {
                end -= 1;
                continue;
            }
        }
        break;
    }
    if start >= end || col < start || col >= end {
        return None;
    }

    let token: String = line[start..end].iter().collect();
    let token = token.strip_prefix("file://").unwrap_or(&token);
    let (path, line_no, column) = split_location(token);
    if !looks_like_path(path) {
        return None;
    }
    Some(PathHit {
        path: path.to_string(),
        line: line_no,
        column,
        start,
        end,
    })
}

/// Turns a detected path into an existing file, trying each base directory in order.
/// `~` expands to `$HOME`. Returns `None` when nothing exists on disk.
pub fn resolve(path: &str, bases: &[&Path]) -> Option<PathBuf> {
    let expanded = if let Some(rest) = path.strip_prefix("~/") {
        PathBuf::from(std::env::var_os("HOME")?).join(rest)
    } else {
        PathBuf::from(path)
    };
    if expanded.is_absolute() {
        return expanded.exists().then_some(expanded);
    }
    bases
        .iter()
        .map(|base| base.join(&expanded))
        .find(|p| p.exists())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(text: &str, needle: &str) -> Option<PathHit> {
        let chars: Vec<char> = text.chars().collect();
        let byte = text.find(needle).expect("needle in text");
        let col = text[..byte].chars().count();
        path_at(&chars, col)
    }

    fn parts(hit: Option<PathHit>) -> Option<(String, Option<usize>, Option<usize>)> {
        hit.map(|h| (h.path, h.line, h.column))
    }

    #[test]
    fn rust_and_grep_style() {
        assert_eq!(
            parts(at("  --> src/main.rs:12:5", "main")),
            Some(("src/main.rs".into(), Some(12), Some(5)))
        );
        assert_eq!(
            parts(at("src/lib.rs:7: fn x()", "lib")),
            Some(("src/lib.rs".into(), Some(7), None))
        );
        assert_eq!(
            parts(at("error at /abs/path/file.ts:3:14.", "file")),
            Some(("/abs/path/file.ts".into(), Some(3), Some(14)))
        );
    }

    #[test]
    fn tsc_style() {
        assert_eq!(
            parts(at("src/app.tsx(40,12): error TS2322", "app")),
            Some(("src/app.tsx".into(), Some(40), Some(12)))
        );
        assert_eq!(
            parts(at("(see ./a/b.ts)", "b.ts")),
            Some(("./a/b.ts".into(), None, None))
        );
    }

    #[test]
    fn plain_names_and_ranges() {
        let hit = at("modified:   Cargo.toml", "Cargo").unwrap();
        assert_eq!(hit.path, "Cargo.toml");
        assert_eq!((hit.start, hit.end), (12, 22));
        assert_eq!(
            parts(at("open 'pkg/x.json'", "x.json")),
            Some(("pkg/x.json".into(), None, None))
        );
        // The click position must be inside the token.
        assert_eq!(at("a.rs b", " b"), None);
    }

    #[test]
    fn rejects_non_paths() {
        assert_eq!(at("version 1.5 released", "1.5"), None);
        assert_eq!(at("see https://example.com/a.js", "example"), None);
        assert_eq!(at("run --flag=x.y", "flag"), None);
        assert_eq!(at("hello world", "world"), None);
        assert_eq!(at("12:30:01", "30"), None);
    }

    #[test]
    fn resolve_checks_disk() {
        let dir = std::env::temp_dir();
        let name = format!("ide-term-link-{}.txt", std::process::id());
        std::fs::write(dir.join(&name), "x").unwrap();
        assert_eq!(
            resolve(&name, &[Path::new("/nonexistent"), &dir]),
            Some(dir.join(&name))
        );
        assert_eq!(resolve("definitely-missing.rs", &[&dir]), None);
        std::fs::remove_file(dir.join(&name)).unwrap();
    }
}
