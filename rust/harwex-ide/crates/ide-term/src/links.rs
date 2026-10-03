//! Detection of `path:line:col` references and URLs in terminal output.
//!
//! Compilers and linters print locations in a few shapes: `src/a.rs:12:5` (rustc, tsc --pretty
//! false, eslint unix, grep -n), `src/a.ts(12,5)` (tsc default) and plain paths. The detector
//! works on one logical line of cells and only reports text that looks like a path. Whether the
//! file exists is checked separately by [`resolve`], because that needs the disk.
//!
//! URLs come from two sources. OSC 8 hyperlinks carry their URI in the cells, and their text
//! may differ from it ([`hyperlink_at`]). Plain `http://`, `https://` and `file://` text is
//! found by [`url_at`].

use std::path::{Path, PathBuf};

use alacritty_terminal::term::cell::Hyperlink;

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

/// A URL found in a line. `start..end` are cell indices into the line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UrlHit {
    pub url: String,
    pub start: usize,
    pub end: usize,
}

const URL_SCHEMES: &[&str] = &["https://", "http://", "file://"];

/// Characters that can be part of a URL in terminal text. Non-ASCII letters are allowed
/// (IRIs); box drawing and `…` are not, so a frame border or a truncated URL ends it.
fn is_url_char(c: char) -> bool {
    if c.is_ascii() {
        c.is_ascii_graphic() && !matches!(c, '"' | '<' | '>' | '`' | '\\' | '^' | '{' | '}' | '|')
    } else {
        c.is_alphanumeric()
    }
}

/// Shortens `[start, end)` past punctuation that ends a sentence or closes a bracket the URL
/// did not open: "(see https://a.b/c)." links "https://a.b/c".
fn trim_url_end(line: &[char], start: usize, mut end: usize) -> usize {
    const TRAIL: &[char] = &['.', ',', ';', ':', '!', '?', '\'', '"'];
    loop {
        if end <= start {
            return end;
        }
        let last = line[end - 1];
        if TRAIL.contains(&last) {
            end -= 1;
            continue;
        }
        let open = match last {
            ')' => '(',
            ']' => '[',
            '}' => '{',
            _ => return end,
        };
        let body = &line[start..end];
        let opens = body.iter().filter(|&&c| c == open).count();
        let closes = body.iter().filter(|&&c| c == last).count();
        if closes > opens {
            end -= 1;
        } else {
            return end;
        }
    }
}

/// Finds a plain-text `http://`, `https://` or `file://` URL that covers cell `col` of `line`.
pub fn url_at(line: &[char], col: usize) -> Option<UrlHit> {
    if col >= line.len() || !is_url_char(line[col]) {
        return None;
    }
    // The run of URL characters around `col`; a scheme can only start inside it.
    let mut run_start = col;
    while run_start > 0 && is_url_char(line[run_start - 1]) {
        run_start -= 1;
    }
    let mut run_end = col + 1;
    while run_end < line.len() && is_url_char(line[run_end]) {
        run_end += 1;
    }
    let run = &line[run_start..run_end];
    // The last scheme at or before `col` wins: "a=https://x,https://y" has two URLs.
    let mut start = None;
    for i in (0..=(col - run_start)).rev() {
        let at_word_start = i == 0 || !run[i - 1].is_ascii_alphanumeric();
        if at_word_start && URL_SCHEMES.iter().any(|s| starts_with(&run[i..], s)) {
            start = Some(i);
            break;
        }
    }
    let start = run_start + start?;
    let scheme_len = URL_SCHEMES
        .iter()
        .find(|s| starts_with(&line[start..], s))
        .map_or(0, |s| s.len());
    // A following scheme ends this URL ("https://a,https://b" is two links).
    let mut end = run_end;
    for i in start + scheme_len..run_end {
        let at_word_start = !line[i - 1].is_ascii_alphanumeric();
        if at_word_start && URL_SCHEMES.iter().any(|s| starts_with(&line[i..run_end], s)) {
            end = i;
            break;
        }
    }
    let end = trim_url_end(line, start, end);
    if end <= start + scheme_len || col >= end {
        return None;
    }
    Some(UrlHit {
        url: line[start..end].iter().collect(),
        start,
        end,
    })
}

fn starts_with(chars: &[char], prefix: &str) -> bool {
    chars.len() >= prefix.len()
        && prefix
            .chars()
            .zip(chars)
            .all(|(p, &c)| c.eq_ignore_ascii_case(&p))
}

/// Finds the OSC 8 hyperlink at cell `col`: the run of neighbouring cells that carry the same
/// link (same id and URI). `cells` holds one entry per cell of the line.
pub fn hyperlink_at(cells: &[Option<Hyperlink>], col: usize) -> Option<UrlHit> {
    let link = cells.get(col)?.as_ref()?;
    let same = |c: &Option<Hyperlink>| c.as_ref() == Some(link);
    let mut start = col;
    while start > 0 && same(&cells[start - 1]) {
        start -= 1;
    }
    let mut end = col + 1;
    while end < cells.len() && same(&cells[end]) {
        end += 1;
    }
    Some(UrlHit {
        url: link.uri().to_string(),
        start,
        end,
    })
}

/// True for the schemes the app may hand to the system opener. A terminal program controls
/// OSC 8 URIs, so anything else (`javascript:`, `ssh:`, custom app schemes) is refused.
pub fn is_openable_url(url: &str) -> bool {
    let Some((scheme, rest)) = url.split_once(':') else {
        return false;
    };
    !rest.is_empty()
        && ["http", "https", "file", "mailto"]
            .iter()
            .any(|s| scheme.eq_ignore_ascii_case(s))
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

    fn url(text: &str, needle: &str) -> Option<String> {
        let chars: Vec<char> = text.chars().collect();
        let byte = text.find(needle).expect("needle in text");
        let col = text[..byte].chars().count();
        url_at(&chars, col).map(|h| h.url)
    }

    #[test]
    fn urls_in_text() {
        let u = |s: &str| Some(s.to_string());
        assert_eq!(url("see https://example.com/a.js", "example"), u("https://example.com/a.js"));
        assert_eq!(url("see https://example.com/a.js", "https"), u("https://example.com/a.js"));
        assert_eq!(url("open http://localhost:3000/x?a=1&b=2#top now", "local"), u("http://localhost:3000/x?a=1&b=2#top"));
        assert_eq!(url("file:///tmp/report.html", "report"), u("file:///tmp/report.html"));
        assert_eq!(url("HTTPS://EXAMPLE.COM", "EXAMPLE"), u("HTTPS://EXAMPLE.COM"));
        // Not on the URL, or no URL at all.
        assert_eq!(url("see https://example.com now", "now"), None);
        assert_eq!(url("see https://example.com now", "see"), None);
        assert_eq!(url("https:// alone", "alone"), None);
        assert_eq!(url("xhttps://example.com", "example"), None);
        assert_eq!(url("ftp://example.com", "example"), None);
    }

    #[test]
    fn url_trailing_punctuation() {
        let u = |s: &str| Some(s.to_string());
        for text in [
            "Docs: https://a.dev/x.",
            "Docs: https://a.dev/x,",
            "Docs: https://a.dev/x;",
            "Docs: https://a.dev/x:",
            "Docs: 'https://a.dev/x'",
            "Docs: \"https://a.dev/x\"",
            "Docs (https://a.dev/x).",
            "Docs [https://a.dev/x]",
            "Docs {https://a.dev/x}",
            "Docs <https://a.dev/x>",
            "│ https://a.dev/x│",
            "https://a.dev/x…",
        ] {
            assert_eq!(url(text, "a.dev"), u("https://a.dev/x"), "{text}");
        }
        // Balanced parens belong to the URL (Wikipedia), an unbalanced one does not.
        assert_eq!(
            url("(https://en.wikipedia.org/wiki/Rust_(language))", "wiki"),
            u("https://en.wikipedia.org/wiki/Rust_(language)")
        );
        assert_eq!(url("https://a.dev/q?x[0]=1", "a.dev"), u("https://a.dev/q?x[0]=1"));
    }

    #[test]
    fn two_urls_in_one_token() {
        let text = "https://a.dev/1,https://b.dev/2";
        assert_eq!(url(text, "a.dev").as_deref(), Some("https://a.dev/1"));
        assert_eq!(url(text, "b.dev").as_deref(), Some("https://b.dev/2"));
    }

    #[test]
    fn url_range_covers_a_wrapped_line() {
        // A logical line of two 10-column rows: the URL runs across the soft wrap.
        let text = "go https://a.dev/long/path ok";
        let chars: Vec<char> = text.chars().collect();
        let hit = url_at(&chars, 12).unwrap();
        assert_eq!(hit.url, "https://a.dev/long/path");
        assert_eq!((hit.start, hit.end), (3, 26));
        assert_eq!(url_at(&chars, 25).unwrap().url, hit.url);
    }

    #[test]
    fn osc8_hyperlinks() {
        let a = Hyperlink::new(Some("1"), "https://a.dev/".to_string());
        let b = Hyperlink::new(Some("2"), "https://b.dev/".to_string());
        let cells = vec![None, Some(a.clone()), Some(a.clone()), Some(b.clone()), None];
        let hit = hyperlink_at(&cells, 2).unwrap();
        assert_eq!((hit.url.as_str(), hit.start, hit.end), ("https://a.dev/", 1, 3));
        let hit = hyperlink_at(&cells, 3).unwrap();
        assert_eq!((hit.url.as_str(), hit.start, hit.end), ("https://b.dev/", 3, 4));
        assert_eq!(hyperlink_at(&cells, 0), None);
        assert_eq!(hyperlink_at(&cells, 9), None);
    }

    #[test]
    fn openable_schemes() {
        for ok in ["https://a.dev", "HTTP://a.dev", "file:///tmp/x", "mailto:a@b.dev"] {
            assert!(is_openable_url(ok), "{ok}");
        }
        for bad in ["javascript:alert(1)", "ssh://host", "vscode://x", "https:", "no-scheme"] {
            assert!(!is_openable_url(bad), "{bad}");
        }
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
