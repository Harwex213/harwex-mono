use std::ops::Range;

use ropey::Rope;
use tree_sitter::{Node, Query, QueryCursor, StreamingIterator, TextProvider, Tree};

use crate::language::kind_for_capture;

/// Color class of a span. `None` is plain text; it exists so a per-byte paint buffer can use 0.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Default)]
#[repr(u8)]
pub enum HlKind {
    #[default]
    None = 0,
    Keyword,
    String,
    Escape,
    Number,
    Comment,
    DocComment,
    Function,
    Macro,
    Type,
    Property,
    Constant,
    Builtin,
    Variable,
    Parameter,
    Operator,
    Punctuation,
    Tag,
    Attribute,
    Title,
    Link,
}

impl HlKind {
    pub const COUNT: usize = 21;

    fn from_u8(v: u8) -> HlKind {
        // Only values written by `paint` reach here, and those come from real variants.
        const ALL: [HlKind; HlKind::COUNT] = [
            HlKind::None,
            HlKind::Keyword,
            HlKind::String,
            HlKind::Escape,
            HlKind::Number,
            HlKind::Comment,
            HlKind::DocComment,
            HlKind::Function,
            HlKind::Macro,
            HlKind::Type,
            HlKind::Property,
            HlKind::Constant,
            HlKind::Builtin,
            HlKind::Variable,
            HlKind::Parameter,
            HlKind::Operator,
            HlKind::Punctuation,
            HlKind::Tag,
            HlKind::Attribute,
            HlKind::Title,
            HlKind::Link,
        ];
        ALL.get(v as usize).copied().unwrap_or(HlKind::None)
    }
}

/// A colored run inside one line, in byte offsets relative to the line start.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Span {
    pub start: u32,
    pub end: u32,
    pub kind: HlKind,
}

pub struct HighlightConfig {
    pub(crate) language: tree_sitter::Language,
    pub(crate) query: Query,
    /// Capture index -> color class, resolved once so the hot loop never touches strings.
    kinds: Vec<Option<HlKind>>,
}

impl HighlightConfig {
    /// Builds the query from several sources. Grammar crates are versioned independently, so a
    /// shared query (the JS one reused for TS) can name a node the other grammar lacks. Instead
    /// of losing all highlighting, the offending top-level pattern is dropped and compile retried.
    pub(crate) fn new(language: tree_sitter::Language, sources: &[&str]) -> Option<HighlightConfig> {
        let mut source = sources.join("\n");
        for _ in 0..64 {
            match Query::new(&language, &source) {
                Ok(query) => {
                    let kinds = query
                        .capture_names()
                        .iter()
                        .map(|n| kind_for_capture(n))
                        .collect();
                    return Some(HighlightConfig { language, query, kinds });
                }
                Err(err) => {
                    let range = top_level_pattern_at(&source, err.offset)?;
                    source.replace_range(range, "");
                }
            }
        }
        None
    }
}

/// Finds the byte range of the top-level query pattern that contains `offset`.
fn top_level_pattern_at(source: &str, offset: usize) -> Option<Range<usize>> {
    let bytes = source.as_bytes();
    let mut depth = 0i32;
    let mut i = 0;
    let mut start: Option<usize> = None;
    let mut in_string = false;
    while i < bytes.len() {
        let c = bytes[i];
        if in_string {
            if c == b'\\' {
                i += 2;
                continue;
            }
            if c == b'"' {
                in_string = false;
            }
            i += 1;
            continue;
        }
        match c {
            b';' => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
                continue;
            }
            b'"' | b'(' | b'[' => {
                if depth == 0 {
                    // A new pattern starts here, so the previous one (with its trailing
                    // captures and quantifiers) ends here.
                    if let Some(s) = start {
                        if offset >= s && offset < i {
                            return Some(s..i);
                        }
                    }
                    start = Some(i);
                }
                if c == b'"' {
                    in_string = true;
                } else {
                    depth += 1;
                }
            }
            b')' | b']' => {
                depth -= 1;
            }
            _ => {}
        }
        i += 1;
    }
    let s = start?;
    (offset >= s).then_some(s..bytes.len())
}

/// Feeds rope chunks to tree-sitter predicates (`#match?`, `#eq?`) without copying the file.
pub(crate) struct RopeProvider<'a>(pub &'a Rope);

pub(crate) struct ChunksBytes<'a>(ropey::iter::Chunks<'a>);

impl<'a> Iterator for ChunksBytes<'a> {
    type Item = &'a [u8];
    fn next(&mut self) -> Option<&'a [u8]> {
        self.0.next().map(str::as_bytes)
    }
}

impl<'a> TextProvider<&'a [u8]> for RopeProvider<'a> {
    type I = ChunksBytes<'a>;
    fn text(&mut self, node: Node) -> Self::I {
        let len = self.0.len_bytes();
        let range = node.start_byte().min(len)..node.end_byte().min(len);
        ChunksBytes(self.0.byte_slice(range).chunks())
    }
}

/// Never paint more than this many bytes at once; a huge minified line would otherwise allocate
/// a buffer the size of the file every time it scrolls into view.
const MAX_PAINT_BYTES: usize = 4 << 20;

/// Computes colored spans for `lines`. Only that byte range is queried, so the cost depends on
/// what is visible, not on file size.
pub(crate) fn highlight_lines(
    rope: &Rope,
    tree: &Tree,
    config: &HighlightConfig,
    lines: Range<usize>,
) -> Vec<Vec<Span>> {
    let line_count = rope.len_lines();
    let lines = lines.start.min(line_count)..lines.end.min(line_count);
    let mut out = vec![Vec::new(); lines.len()];
    if lines.is_empty() {
        return out;
    }
    let start_byte = rope.line_to_byte(lines.start);
    let end_byte = rope.line_to_byte(lines.end).min(start_byte + MAX_PAINT_BYTES);
    if end_byte <= start_byte {
        return out;
    }

    let mut captured: Vec<(usize, usize, HlKind, usize)> = Vec::new();
    let mut cursor = QueryCursor::new();
    cursor.set_byte_range(start_byte..end_byte);
    let mut matches = cursor.matches(&config.query, tree.root_node(), RopeProvider(rope));
    while let Some(m) = matches.next() {
        for cap in m.captures() {
            let Some(Some(kind)) = config.kinds.get(cap.index as usize) else {
                continue;
            };
            let s = cap.node.start_byte().max(start_byte);
            let e = cap.node.end_byte().min(end_byte);
            if s < e {
                captured.push((s, e, *kind, m.pattern_index));
            }
        }
    }

    let paint = paint(&captured, start_byte, end_byte);

    for (i, line) in lines.clone().enumerate() {
        let ls = rope.line_to_byte(line);
        let le = rope.line_to_byte(line + 1).min(end_byte);
        if ls >= end_byte {
            break;
        }
        let spans = &mut out[i];
        let mut run_start = ls;
        let mut run_kind = 0u8;
        for b in ls..le {
            let k = paint[b - start_byte];
            if k != run_kind {
                if run_kind != 0 && b > run_start {
                    spans.push(Span {
                        start: (run_start - ls) as u32,
                        end: (b - ls) as u32,
                        kind: HlKind::from_u8(run_kind),
                    });
                }
                run_start = b;
                run_kind = k;
            }
        }
        if run_kind != 0 && le > run_start {
            spans.push(Span {
                start: (run_start - ls) as u32,
                end: (le - ls) as u32,
                kind: HlKind::from_u8(run_kind),
            });
        }
    }
    out
}

/// Resolves overlapping captures into one kind per byte. Wider nodes are painted first so nested
/// nodes (an identifier inside a call) show through. For the same node, the later pattern wins:
/// the bundled queries list generic rules like `(identifier) @variable` first.
fn paint(captured: &[(usize, usize, HlKind, usize)], start: usize, end: usize) -> Vec<u8> {
    let mut order: Vec<usize> = (0..captured.len()).collect();
    order.sort_by(|&a, &b| {
        let (sa, ea, _, pa) = captured[a];
        let (sb, eb, _, pb) = captured[b];
        (eb - sb).cmp(&(ea - sa)).then(pa.cmp(&pb))
    });
    let mut buf = vec![0u8; end - start];
    for i in order {
        let (s, e, kind, _) = captured[i];
        buf[s - start..e - start].fill(kind as u8);
    }
    buf
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bad_pattern_is_dropped_not_fatal() {
        let src = "; comment (x)\n(identifier) @variable\n(no_such_node) @keyword\n[\"const\" \"let\"] @keyword\n";
        let cfg = HighlightConfig::new(tree_sitter_javascript::LANGUAGE.into(), &[src]).expect("compiles");
        assert_eq!(cfg.query.pattern_count(), 2);
    }
}
