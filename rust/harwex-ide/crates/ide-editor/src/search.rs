//! The find bar's matcher: plain text or regex, case, whole words, multiline, filters by
//! highlight kind and the replacement template. No UI and no state here; `find.rs` drives it.

use std::ops::Range;

use regex::{Regex, RegexBuilder};
use ropey::Rope;
use tree_sitter::Tree;

use crate::document::is_word_char;
use crate::highlight::{self, HighlightConfig, HlKind, Span};

/// Where a match may sit, judged by the highlight kind of its first and last char.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum SearchFilter {
    #[default]
    Anywhere,
    InComments,
    InStringLiterals,
    ExceptComments,
    ExceptStringLiterals,
    ExceptCommentsAndStringLiterals,
}

impl SearchFilter {
    pub const ALL: [SearchFilter; 6] = [
        SearchFilter::Anywhere,
        SearchFilter::InComments,
        SearchFilter::InStringLiterals,
        SearchFilter::ExceptComments,
        SearchFilter::ExceptStringLiterals,
        SearchFilter::ExceptCommentsAndStringLiterals,
    ];

    pub fn label(self) -> &'static str {
        match self {
            SearchFilter::Anywhere => "Anywhere",
            SearchFilter::InComments => "In Comments",
            SearchFilter::InStringLiterals => "In String Literals",
            SearchFilter::ExceptComments => "Except Comments",
            SearchFilter::ExceptStringLiterals => "Except String Literals",
            SearchFilter::ExceptCommentsAndStringLiterals => "Except Comments and String Literals",
        }
    }

    fn accepts(self, kind: HlKind) -> bool {
        let comment = matches!(kind, HlKind::Comment | HlKind::DocComment);
        let string = matches!(kind, HlKind::String | HlKind::Escape);
        match self {
            SearchFilter::Anywhere => true,
            SearchFilter::InComments => comment,
            SearchFilter::InStringLiterals => string,
            SearchFilter::ExceptComments => !comment,
            SearchFilter::ExceptStringLiterals => !string,
            SearchFilter::ExceptCommentsAndStringLiterals => !comment && !string,
        }
    }
}

/// The toggles of the search row.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct FindOptions {
    pub match_case: bool,
    pub words: bool,
    pub regex: bool,
    /// The query may contain line breaks. Without it a regex match never crosses a line end.
    pub multiline: bool,
    pub filter: SearchFilter,
}

/// A compiled query.
#[derive(Clone, Debug)]
pub struct Matcher {
    re: Regex,
    words: bool,
    /// Regex without multiline mode: searched line by line, so `\s` never eats a line break.
    by_line: bool,
    /// Line breaks a match can span; `None` means any number (multiline regex).
    span_lines: Option<usize>,
    pub(crate) filter: SearchFilter,
}

impl Matcher {
    /// `Ok(None)` for an empty query. `Err` carries the regex error for the counter.
    pub fn new(query: &str, opts: &FindOptions) -> Result<Option<Matcher>, String> {
        if query.is_empty() {
            return Ok(None);
        }
        let pattern = if opts.regex { query.to_string() } else { regex::escape(query) };
        let re = RegexBuilder::new(&pattern)
            .case_insensitive(!opts.match_case)
            .multi_line(true)
            .build()
            .map_err(|e| e.to_string().lines().last().unwrap_or("bad regex").trim().to_string())?;
        let span_lines = if opts.regex && opts.multiline { None } else { Some(query.matches('\n').count()) };
        Ok(Some(Matcher { re, words: opts.words, by_line: opts.regex && !opts.multiline, span_lines, filter: opts.filter }))
    }

    /// Line breaks a match may span, `None` when unbounded.
    pub fn span_lines(&self) -> Option<usize> {
        self.span_lines
    }

    /// Char ranges of the non-empty matches in `text`, offset by `base`. Stops after `limit`
    /// matches and then reports `true`.
    pub fn find(&self, text: &str, base: usize, limit: usize) -> (Vec<Range<usize>>, bool) {
        let mut bytes = Vec::new();
        let mut capped = false;
        if self.by_line {
            let mut off = 0;
            for line in text.split('\n') {
                capped = self.find_bytes(line, off, limit, &mut bytes);
                if capped {
                    break;
                }
                off += line.len() + 1;
            }
        } else {
            capped = self.find_bytes(text, 0, limit, &mut bytes);
        }
        (bytes_to_chars(text, base, &bytes), capped)
    }

    fn find_bytes(&self, hay: &str, off: usize, limit: usize, out: &mut Vec<Range<usize>>) -> bool {
        let mut at = 0;
        while at <= hay.len() {
            let Some(m) = self.re.find_at(hay, at) else { break };
            if m.is_empty() || (self.words && !word_bounded(hay, m.start(), m.end())) {
                // Retry one char later: a longer word may still hold a bounded match.
                at = m.start() + hay[m.start()..].chars().next().map_or(1, char::len_utf8);
                continue;
            }
            if out.len() >= limit {
                return true;
            }
            out.push(off + m.start()..off + m.end());
            at = m.end();
        }
        false
    }

    /// The replacement for the match at `range` (bytes) of `hay`, which holds the whole lines
    /// around it so anchors see the same context as the search did.
    pub fn replacement(&self, hay: &str, range: Range<usize>, template: &Template, preserve: bool) -> String {
        let caps = if template.has_groups() {
            let caps = if self.by_line {
                // The search saw each line alone, so the captures must not run past its end.
                let le = hay[range.end..].find('\n').map_or(hay.len(), |i| range.end + i);
                self.re.captures_at(&hay[..le], range.start)
            } else {
                self.re.captures_at(hay, range.start)
            };
            caps.filter(|c| c.get(0).is_some_and(|m| m.start() == range.start))
        } else {
            None
        };
        let mut out = String::new();
        for piece in &template.0 {
            match piece {
                Piece::Text(t) => out.push_str(t),
                Piece::Group(i) => {
                    if let Some(m) = caps.as_ref().and_then(|c| c.get(*i)) {
                        out.push_str(m.as_str());
                    }
                }
                Piece::Named(n) => {
                    if let Some(m) = caps.as_ref().and_then(|c| c.name(n)) {
                        out.push_str(m.as_str());
                    }
                }
            }
        }
        if preserve {
            preserve_case(&hay[range], &out)
        } else {
            out
        }
    }
}

fn word_bounded(hay: &str, start: usize, end: usize) -> bool {
    let before = hay[..start].chars().next_back();
    let after = hay[end..].chars().next();
    !before.is_some_and(is_word_char) && !after.is_some_and(is_word_char)
}

/// Converts sorted byte ranges of `text` to char ranges, in one pass.
fn bytes_to_chars(text: &str, base: usize, ranges: &[Range<usize>]) -> Vec<Range<usize>> {
    let mut out = Vec::with_capacity(ranges.len());
    let mut byte = 0;
    let mut chars = base;
    for r in ranges {
        chars += text[byte..r.start].chars().count();
        let len = text[r.clone()].chars().count();
        out.push(chars..chars + len);
        chars += len;
        byte = r.end;
    }
    out
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Piece {
    Text(String),
    Group(usize),
    Named(String),
}

/// A parsed replacement. In regex mode `$1`, `${name}`, `$$`, `\n`, `\t`, `\r` and `\\` are
/// expanded; in plain mode the text is literal.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Template(Vec<Piece>);

impl Template {
    pub fn parse(s: &str, regex: bool) -> Template {
        if !regex {
            return Template(vec![Piece::Text(s.to_string())]);
        }
        let mut pieces = Vec::new();
        let mut text = String::new();
        let mut it = s.chars().peekable();
        while let Some(c) = it.next() {
            match (c, it.peek().copied()) {
                ('\\', Some(n)) => {
                    it.next();
                    match n {
                        'n' => text.push('\n'),
                        't' => text.push('\t'),
                        'r' => text.push('\r'),
                        other => text.push(other),
                    }
                }
                ('$', Some('$')) => {
                    it.next();
                    text.push('$');
                }
                ('$', Some(d)) if d.is_ascii_digit() => {
                    let mut n = 0usize;
                    while let Some(d) = it.peek().and_then(|c| c.to_digit(10)) {
                        n = n * 10 + d as usize;
                        it.next();
                    }
                    pieces.push(Piece::Text(std::mem::take(&mut text)));
                    pieces.push(Piece::Group(n));
                }
                ('$', Some('{')) => {
                    it.next();
                    let name: String = it.by_ref().take_while(|&c| c != '}').collect();
                    pieces.push(Piece::Text(std::mem::take(&mut text)));
                    match name.parse::<usize>() {
                        Ok(n) => pieces.push(Piece::Group(n)),
                        Err(_) => pieces.push(Piece::Named(name)),
                    }
                }
                _ => text.push(c),
            }
        }
        pieces.push(Piece::Text(text));
        pieces.retain(|p| !matches!(p, Piece::Text(t) if t.is_empty()));
        Template(pieces)
    }

    fn has_groups(&self) -> bool {
        self.0.iter().any(|p| !matches!(p, Piece::Text(_)))
    }
}

/// IDEA's Preserve Case: `FOO` makes the replacement upper case, `Foo` capitalizes its first
/// letter, anything else (`foo`, `fooBar`) leaves it as typed.
pub fn preserve_case(matched: &str, replacement: &str) -> String {
    let letters: Vec<char> = matched.chars().filter(|c| c.is_alphabetic()).collect();
    let Some(&first) = letters.first() else { return replacement.to_string() };
    if letters.len() > 1 && letters.iter().all(|c| c.is_uppercase()) {
        return replacement.to_uppercase();
    }
    if first.is_uppercase() {
        let mut chars = replacement.chars();
        return match chars.next() {
            Some(c) => c.to_uppercase().chain(chars).collect(),
            None => String::new(),
        };
    }
    replacement.to_string()
}

/// Lines highlighted per query call while filtering. Bigger batches cost more memory for the
/// paint buffer; smaller ones repeat the query setup.
const FILTER_BATCH_LINES: usize = 512;

/// Drops the matches whose first or last char the filter rejects. Without a tree every char
/// counts as plain code.
pub(crate) fn apply_filter(
    rope: &Rope,
    syntax: Option<&(Tree, &'static HighlightConfig)>,
    filter: SearchFilter,
    matches: &mut Vec<Range<usize>>,
) {
    if filter == SearchFilter::Anywhere || matches.is_empty() {
        return;
    }
    let Some((tree, config)) = syntax else {
        matches.retain(|_| filter.accepts(HlKind::None));
        return;
    };
    let mut batch: Option<(usize, Vec<Vec<Span>>)> = None;
    let mut kind_at = |idx: usize| -> HlKind {
        let line = rope.char_to_line(idx);
        let fresh = batch.as_ref().is_some_and(|(s, spans)| line >= *s && line < s + spans.len());
        if !fresh {
            let spans = highlight::highlight_lines(rope, tree, config, line..line + FILTER_BATCH_LINES);
            batch = Some((line, spans));
        }
        let (s, spans) = batch.as_ref().expect("filled above");
        let byte = (rope.char_to_byte(idx) - rope.line_to_byte(line)) as u32;
        spans[line - s].iter().find(|sp| sp.start <= byte && byte < sp.end).map_or(HlKind::None, |sp| sp.kind)
    };
    matches.retain(|m| filter.accepts(kind_at(m.start)) && filter.accepts(kind_at(m.end - 1)));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn find(q: &str, opts: FindOptions, text: &str) -> Vec<String> {
        let m = Matcher::new(q, &opts).expect("valid").expect("non-empty");
        let chars: Vec<char> = text.chars().collect();
        m.find(text, 0, usize::MAX).0.into_iter().map(|r| chars[r].iter().collect()).collect()
    }

    #[test]
    fn case_and_words() {
        let text = "Foo foo food FOO _foo";
        assert_eq!(find("foo", FindOptions::default(), text), ["Foo", "foo", "foo", "FOO", "foo"]);
        assert_eq!(find("foo", FindOptions { match_case: true, ..Default::default() }, text), ["foo", "foo", "foo"]);
        assert_eq!(find("foo", FindOptions { words: true, ..Default::default() }, text), ["Foo", "foo", "FOO"]);
    }

    #[test]
    fn words_retry_inside_a_longer_word() {
        // The first candidate "aa" at 0 is part of "aaa"; the bounded one comes later.
        assert_eq!(find("aa", FindOptions { words: true, ..Default::default() }, "aaa aa"), ["aa"]);
    }

    #[test]
    fn regex_groups_and_escapes_in_replacement() {
        let opts = FindOptions { regex: true, ..Default::default() };
        let m = Matcher::new(r"(\w+)=(\d+)", &opts).unwrap().unwrap();
        let hay = "x a=1 b=22";
        let (found, _) = m.find(hay, 0, usize::MAX);
        assert_eq!(found, [2..5, 6..10]);
        let t = Template::parse(r"$2:$1\n${1}\t$$", true);
        assert_eq!(m.replacement(hay, 6..10, &t, false), "22:b\nb\t$");
        // Plain mode keeps the text literal.
        assert_eq!(Template::parse(r"$1\n", false), Template(vec![Piece::Text(r"$1\n".into())]));
    }

    #[test]
    fn multiline_plain_and_regex() {
        let text = "a\nb\na\nb\n";
        assert_eq!(find("a\nb", FindOptions { multiline: true, ..Default::default() }, text), ["a\nb", "a\nb"]);
        // A single-line regex never crosses a line end, even with \s.
        let single = FindOptions { regex: true, ..Default::default() };
        assert_eq!(find(r"a\s+b", single, text), Vec::<String>::new());
        let multi = FindOptions { regex: true, multiline: true, ..Default::default() };
        assert_eq!(find(r"a\s+b", multi, text), ["a\nb", "a\nb"]);
        assert_eq!(find(r"^b$", FindOptions { regex: true, ..Default::default() }, text), ["b", "b"]);
    }

    #[test]
    fn char_offsets_with_multibyte_text() {
        let m = Matcher::new("x", &FindOptions::default()).unwrap().unwrap();
        assert_eq!(m.find("äöx€x", 10, usize::MAX).0, [12..13, 14..15]);
    }

    #[test]
    fn limit_reports_capped() {
        let m = Matcher::new("a", &FindOptions::default()).unwrap().unwrap();
        let (found, capped) = m.find("aaaa", 0, 3);
        assert_eq!((found.len(), capped), (3, true));
    }

    #[test]
    fn bad_regex_is_an_error() {
        assert!(Matcher::new("(", &FindOptions { regex: true, ..Default::default() }).is_err());
        assert!(Matcher::new("", &FindOptions::default()).unwrap().is_none());
    }

    #[test]
    fn preserve_case_rules() {
        assert_eq!(preserve_case("foo", "bar"), "bar");
        assert_eq!(preserve_case("Foo", "bar"), "Bar");
        assert_eq!(preserve_case("FOO", "bar"), "BAR");
        assert_eq!(preserve_case("fooBar", "bazQux"), "bazQux");
        assert_eq!(preserve_case("123", "x"), "x");
    }
}
