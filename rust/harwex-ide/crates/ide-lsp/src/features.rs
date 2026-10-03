//! Navigation requests on top of [`LspClient`]: definition-like requests, references and
//! hover, with results converted to editor coordinates.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};

use crate::client::{read_text, LspClient};
use crate::position::{LineBreaks, LineIndex};
use crate::uri::{path_to_uri, uri_to_path};
use crate::{Error, Location, Reference};

/// A hover result: the markdown (or plain text) the server sent, and the hovered range in
/// editor coordinates.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hover {
    pub markdown: String,
    pub line: usize,
    pub column: usize,
    pub end_line: usize,
    pub end_column: usize,
}

impl LspClient {
    /// `TextDocumentPositionParams` for an editor position, and the line table of the text
    /// the server sees. Opens the file from disk if the editor has not opened it.
    pub fn position_params(&self, path: &Path, line: usize, column: usize, timeout: Duration) -> Result<(Value, LineIndex), Error> {
        let text = self.ensure_open(path, timeout)?;
        let index = LineIndex::with_breaks(text, self.config().line_breaks);
        let (line, character) = index.to_lsp(line, column);
        let params = json!({
            "textDocument": {"uri": path_to_uri(path)},
            "position": {"line": line, "character": character},
        });
        Ok((params, index))
    }

    /// A request that answers `Location | Location[] | LocationLink[] | null`:
    /// `textDocument/definition`, `declaration`, `typeDefinition`, `implementation`, or an
    /// extension with the same shape.
    pub fn locations(&self, method: &str, path: &Path, line: usize, column: usize, timeout: Duration) -> Result<Vec<Location>, Error> {
        let (params, _) = self.position_params(path, line, column, timeout)?;
        let result = self.request(method, params, timeout)?;
        Ok(parse_locations(&mut self.file_texts(), &result))
    }

    /// `textDocument/references` with the declaration included. LSP references carry no
    /// flags: the declaration is where `definition` lands, and writes come from the document
    /// highlights of the requested file.
    pub fn references(&self, path: &Path, line: usize, column: usize, timeout: Duration) -> Result<Vec<Reference>, Error> {
        let (mut params, _) = self.position_params(path, line, column, timeout)?;
        let position = params.clone();
        params["context"] = json!({"includeDeclaration": true});
        let result = self.request("textDocument/references", params, timeout)?;
        let mut files = self.file_texts();
        let definitions: HashSet<Location> = self
            .request("textDocument/definition", position.clone(), timeout)
            .map(|r| parse_locations(&mut files, &r).into_iter().collect())
            .unwrap_or_default();
        let writes: HashSet<(usize, usize)> = self
            .request("textDocument/documentHighlight", position, timeout)
            .ok()
            .and_then(|r| r.as_array().cloned())
            .unwrap_or_default()
            .iter()
            .filter(|h| h["kind"] == 3)
            .map(|h| {
                let index = files.index(path);
                convert(index.as_ref(), &h["range"]["start"])
            })
            .collect();
        let items = result.as_array().map(Vec::as_slice).unwrap_or_default();
        Ok(items
            .iter()
            .filter_map(|r| {
                let file = files.path(r["uri"].as_str()?)?;
                let index = files.index(&file);
                let (line, column) = convert(index.as_ref(), &r["range"]["start"]);
                let (end_line, end_column) = convert(index.as_ref(), &r["range"]["end"]);
                let line_text = index.as_ref().map(|i| i.line(line).to_string()).unwrap_or_default();
                let location = Location { path: file.clone(), line, column };
                Some(Reference {
                    is_definition: definitions.contains(&location),
                    is_write: file == path && writes.contains(&(line, column)),
                    location,
                    end_line,
                    end_column,
                    line_text,
                })
            })
            .collect())
    }

    /// `textDocument/hover`. `None` when the server has nothing or only whitespace there.
    pub fn hover(&self, path: &Path, line: usize, column: usize, timeout: Duration) -> Result<Option<Hover>, Error> {
        let (params, index) = self.position_params(path, line, column, timeout)?;
        let result = self.request("textDocument/hover", params, timeout)?;
        Ok(parse_hover(&result, &index, line, column))
    }
}

pub(crate) fn parse_hover(result: &Value, index: &LineIndex, line: usize, column: usize) -> Option<Hover> {
    if result.is_null() {
        return None;
    }
    let markdown = hover_markdown(&result["contents"]);
    if markdown.trim().is_empty() {
        return None;
    }
    let range = &result["range"];
    let (start, end) = if range.is_object() {
        (
            index.from_lsp(u(&range["start"]["line"]), u(&range["start"]["character"])),
            index.from_lsp(u(&range["end"]["line"]), u(&range["end"]["character"])),
        )
    } else {
        ((line, column), (line, column))
    };
    Some(Hover { markdown, line: start.0, column: start.1, end_line: end.0, end_column: end.1 })
}

/// `MarkupContent`, a `MarkedString` or an array of them, as one markdown text.
pub fn hover_markdown(contents: &Value) -> String {
    match contents {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts.iter().map(hover_markdown).collect::<Vec<_>>().join("\n\n"),
        Value::Object(o) => {
            let value = o.get("value").and_then(Value::as_str).unwrap_or_default();
            match o.get("language").and_then(Value::as_str) {
                Some(lang) => format!("```{lang}\n{value}\n```"),
                None => value.to_string(),
            }
        }
        _ => String::new(),
    }
}

/// Splits hover markdown into the code shown as the signature and the rest as documentation.
///
/// Leading code blocks are the signature (rust-analyzer sends two: the module path, then the
/// item). Everything after them, without `---` rules, is documentation.
pub fn split_hover_markdown(markdown: &str) -> (String, String) {
    let mut code: Vec<String> = Vec::new();
    let mut rest = markdown.trim_start();
    while let Some(after) = rest.strip_prefix("```") {
        // Skip the language name on the fence line.
        let body = after.split_once('\n').map_or("", |(_, b)| b);
        let (block, tail) = match body.find("\n```") {
            Some(end) => (&body[..end], body[end + 4..].split_once('\n').map_or("", |(_, t)| t)),
            None => (body, ""),
        };
        let block = block.trim();
        if !block.is_empty() {
            code.push(block.to_string());
        }
        rest = tail.trim_start();
    }
    let doc: Vec<&str> = rest.lines().filter(|l| l.trim() != "---").collect();
    (code.join("\n"), doc.join("\n").trim().to_string())
}

/// `Location`, `Location[]` or `LocationLink[]` to editor locations. A link points at the
/// declared name (`targetSelectionRange`). Repeated spots are dropped.
pub(crate) fn parse_locations<F: Fn(&Path) -> Option<Arc<str>>>(files: &mut FileTexts<F>, result: &Value) -> Vec<Location> {
    let items: &[Value] = match result {
        Value::Array(items) => items,
        Value::Null => &[],
        one => std::slice::from_ref(one),
    };
    let mut out: Vec<Location> = Vec::new();
    for item in items {
        let (uri, range) = match item.get("targetUri") {
            Some(uri) => (uri, &item["targetSelectionRange"]),
            None => (&item["uri"], &item["range"]),
        };
        let Some(path) = uri.as_str().and_then(|u| files.path(u)) else { continue };
        let index = files.index(&path);
        let (line, column) = convert(index.as_ref(), &range["start"]);
        let location = Location { path, line, column };
        if !out.contains(&location) {
            out.push(location);
        }
    }
    out
}

fn u(v: &Value) -> usize {
    v.as_u64().unwrap_or(0) as usize
}

/// LSP `{line, character}` to editor (line, char column). Without the file text the
/// character is taken as chars, which is right for ASCII lines.
pub(crate) fn convert(index: Option<&Rc<LineIndex>>, pos: &Value) -> (usize, usize) {
    let (line, character) = (u(&pos["line"]), u(&pos["character"]));
    match index {
        Some(index) => index.from_lsp(line, character),
        None => (line, character),
    }
}

/// Line tables of result files, built once per response. Open files use the editor's text,
/// because the disk copy may be older than what the server answered about.
pub(crate) struct FileTexts<F: Fn(&Path) -> Option<Arc<str>>> {
    open_text: F,
    breaks: LineBreaks,
    cache: HashMap<PathBuf, Option<Rc<LineIndex>>>,
    uris: HashMap<String, Option<PathBuf>>,
}

impl<F: Fn(&Path) -> Option<Arc<str>>> FileTexts<F> {
    pub(crate) fn new(open_text: F, breaks: LineBreaks) -> FileTexts<F> {
        FileTexts { open_text, breaks, cache: HashMap::new(), uris: HashMap::new() }
    }

    pub(crate) fn index(&mut self, path: &Path) -> Option<Rc<LineIndex>> {
        let open_text = &self.open_text;
        let breaks = self.breaks;
        self.cache
            .entry(path.to_path_buf())
            .or_insert_with(|| {
                let text = open_text(path).or_else(|| read_text(path).ok().map(Arc::from))?;
                Some(Rc::new(LineIndex::with_breaks(text, breaks)))
            })
            .clone()
    }

    /// The canonical path of a result URI, so a result names a file the same way the editor
    /// does (real path, on-disk case).
    pub(crate) fn path(&mut self, uri: &str) -> Option<PathBuf> {
        self.uris.entry(uri.to_string()).or_insert_with(|| uri_to_path(uri).map(|p| canonical(&p))).clone()
    }
}

/// Servers report results by real path (`/private/var/...`, packages behind symlinks).
/// Using real paths everywhere keeps one name per file.
pub fn canonical(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locations_accept_links_and_plain_locations() {
        let mut files = FileTexts::new(|_| Some(Arc::from("let 😀 = 1;\nx")), LineBreaks::Lsp);
        let links = json!([{"targetUri": "file:///nonexistent/a.ts", "targetRange": {"start": {"line": 0, "character": 0}},
            "targetSelectionRange": {"start": {"line": 0, "character": 6}}}]);
        let locs = parse_locations(&mut files, &links);
        assert_eq!(locs, [Location { path: PathBuf::from("/nonexistent/a.ts"), line: 0, column: 5 }]);
        let one = json!({"uri": "file:///nonexistent/b.ts", "range": {"start": {"line": 1, "character": 0}}});
        assert_eq!(parse_locations(&mut files, &one)[0].line, 1);
        assert!(parse_locations(&mut files, &Value::Null).is_empty());
        let twice = json!([one, one]);
        assert_eq!(parse_locations(&mut files, &twice).len(), 1);
    }

    #[test]
    fn hover_contents_of_every_shape() {
        assert_eq!(hover_markdown(&json!({"kind": "markdown", "value": "a"})), "a");
        assert_eq!(hover_markdown(&json!({"language": "ts", "value": "x"})), "```ts\nx\n```");
        assert_eq!(hover_markdown(&json!(["a", "b"])), "a\n\nb");
    }

    #[test]
    fn hover_range_is_converted() {
        let index = LineIndex::new("😀 abc");
        let result = json!({"contents": {"kind": "markdown", "value": "x"}, "range": {"start": {"line": 0, "character": 3}, "end": {"line": 0, "character": 6}}});
        let h = parse_hover(&result, &index, 0, 2).unwrap();
        assert_eq!((h.line, h.column, h.end_line, h.end_column), (0, 2, 0, 5));
        assert!(parse_hover(&json!({"contents": ""}), &index, 0, 0).is_none());
        assert!(parse_hover(&Value::Null, &index, 0, 0).is_none());
    }

    #[test]
    fn rust_analyzer_hover_splits_into_signature_and_docs() {
        let md = "\n```rust\nide_git::repo\n```\n\n```rust\nimpl Repo\npub fn status(&self) -> Result<Vec<FileChange>>\n```\n\n---\n\nStaged, unstaged and untracked changes.\n\n```rust\nlet x = 1;\n```";
        let (display, doc) = split_hover_markdown(md);
        assert_eq!(display, "ide_git::repo\nimpl Repo\npub fn status(&self) -> Result<Vec<FileChange>>");
        assert_eq!(doc, "Staged, unstaged and untracked changes.\n\n```rust\nlet x = 1;\n```");
        assert_eq!(split_hover_markdown("plain text"), (String::new(), "plain text".to_string()));
    }
}
