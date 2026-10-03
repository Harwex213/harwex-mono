//! Text edits from a server (`WorkspaceEdit`) in editor coordinates, and the file operation
//! requests that produce them (`workspace/willRenameFiles`).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};

use crate::client::LspClient;
use crate::features::FileTexts;
use crate::uri::path_to_uri;
use crate::{Error, Location, Reference};

/// The name prefix of the probe rename behind [`LspClient::file_usages`].
pub const PROBE_PREFIX: &str = "__harwex_probe_";

/// One replacement in a file. Lines are 0-based, columns are 0-based chars of the text the
/// server saw (the editor text for open files, the disk text otherwise).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TextEdit {
    pub start_line: usize,
    pub start_column: usize,
    pub end_line: usize,
    pub end_column: usize,
    pub new_text: String,
}

/// The edits for one file, in the order the server sent them. They never overlap.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileEdit {
    pub path: PathBuf,
    pub edits: Vec<TextEdit>,
}

impl LspClient {
    /// `workspace/willRenameFiles`: the edits the server wants before files or folders move
    /// (imports, `mod` declarations). Call it before the move; the paths still exist then.
    pub fn will_rename_files(&self, renames: &[(PathBuf, PathBuf)], timeout: Duration) -> Result<Vec<FileEdit>, Error> {
        let result = self.request("workspace/willRenameFiles", rename_params(renames), timeout)?;
        Ok(parse_workspace_edit(&mut self.file_texts(), &result))
    }

    /// `workspace/didRenameFiles`, after the move. Files under the old paths are closed first,
    /// so the server forgets their old names.
    pub fn did_rename_files(&self, renames: &[(PathBuf, PathBuf)], timeout: Duration) -> Result<(), Error> {
        for (old, _) in renames {
            self.close_under(old);
        }
        // A stopped server reads the new layout when it starts; starting it just to tell it
        // would be waste.
        if !self.is_running() {
            return Ok(());
        }
        self.notify("workspace/didRenameFiles", rename_params(renames), timeout)
    }

    /// Who refers to a file or folder: the places a rename of it would edit (imports, `mod`
    /// declarations, paths). Asks `willRenameFiles` for a probe name next to it; nothing moves.
    pub fn file_usages(&self, path: &Path, timeout: Duration) -> Result<Vec<Reference>, Error> {
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let probe = path.with_file_name(format!("{PROBE_PREFIX}{name}"));
        let edits = self.will_rename_files(&[(path.to_path_buf(), probe)], timeout)?;
        let mut files = self.file_texts();
        let mut out = Vec::new();
        for file in &edits {
            let index = files.index(&file.path);
            for e in &file.edits {
                out.push(Reference {
                    location: Location { path: file.path.clone(), line: e.start_line, column: e.start_column },
                    end_line: e.end_line,
                    end_column: e.end_column,
                    line_text: index.as_ref().map(|i| i.line(e.start_line).to_string()).unwrap_or_default(),
                    is_definition: false,
                    is_write: false,
                });
            }
        }
        Ok(out)
    }

    /// Closes every open file at `prefix` or below it (a deleted or moved folder).
    pub fn close_under(&self, prefix: &Path) {
        for path in self.open_paths() {
            if path.starts_with(prefix) {
                self.close(&path);
            }
        }
    }

    pub(crate) fn file_texts(&self) -> FileTexts<impl Fn(&Path) -> Option<Arc<str>> + '_> {
        FileTexts::new(|p| self.open_text(p), self.config().line_breaks)
    }
}

fn rename_params(renames: &[(PathBuf, PathBuf)]) -> Value {
    let files: Vec<Value> = renames.iter().map(|(o, n)| json!({"oldUri": path_to_uri(o), "newUri": path_to_uri(n)})).collect();
    json!({"files": files})
}

/// `WorkspaceEdit` to per-file edits. Reads `documentChanges` (text document edits; create,
/// rename and delete operations are skipped) or else `changes`. Edits of one file are merged.
pub(crate) fn parse_workspace_edit<F: Fn(&Path) -> Option<Arc<str>>>(files: &mut FileTexts<F>, edit: &Value) -> Vec<FileEdit> {
    let mut raw: Vec<(String, &Value)> = Vec::new();
    if let Some(changes) = edit["documentChanges"].as_array() {
        for change in changes {
            // A resource operation has `kind`; a text document edit has `textDocument`.
            if let Some(uri) = change["textDocument"]["uri"].as_str() {
                raw.push((uri.to_string(), &change["edits"]));
            }
        }
    } else if let Some(changes) = edit["changes"].as_object() {
        for (uri, edits) in changes {
            raw.push((uri.clone(), edits));
        }
    }
    let mut out: Vec<FileEdit> = Vec::new();
    let mut by_path: HashMap<PathBuf, usize> = HashMap::new();
    for (uri, edits) in raw {
        let Some(path) = files.path(&uri) else { continue };
        let index = files.index(&path);
        let converted: Vec<TextEdit> = edits
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .map(|e| {
                let range = &e["range"];
                let (start_line, start_column) = crate::features::convert(index.as_ref(), &range["start"]);
                let (end_line, end_column) = crate::features::convert(index.as_ref(), &range["end"]);
                // A snippet edit (`AnnotatedTextEdit` / `SnippetTextEdit`) still has `newText`.
                let new_text = e["newText"].as_str().unwrap_or_default().to_string();
                TextEdit { start_line, start_column, end_line, end_column, new_text }
            })
            .collect();
        if converted.is_empty() {
            continue;
        }
        match by_path.get(&path) {
            Some(&i) => out[i].edits.extend(converted),
            None => {
                by_path.insert(path.clone(), out.len());
                out.push(FileEdit { path, edits: converted });
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::position::LineBreaks;

    #[test]
    fn reads_changes_and_document_changes() {
        let mut files = FileTexts::new(|_| Some(Arc::from("import { a } from \"./😀a\";\n")), LineBreaks::Lsp);
        let range = json!({"start": {"line": 0, "character": 19}, "end": {"line": 0, "character": 24}});
        let changes = json!({"changes": {"file:///nonexistent/b.ts": [{"range": range, "newText": "./x"}]}});
        let edits = parse_workspace_edit(&mut files, &changes);
        assert_eq!(edits.len(), 1);
        assert_eq!(edits[0].path, PathBuf::from("/nonexistent/b.ts"));
        // The emoji is two UTF-16 units and one char.
        assert_eq!(edits[0].edits[0], TextEdit { start_line: 0, start_column: 19, end_line: 0, end_column: 23, new_text: "./x".into() });

        let doc = json!({"documentChanges": [
            {"textDocument": {"uri": "file:///nonexistent/b.ts", "version": 1}, "edits": [{"range": range, "newText": "./y"}]},
            {"kind": "rename", "oldUri": "file:///nonexistent/a.ts", "newUri": "file:///nonexistent/c.ts"},
            {"textDocument": {"uri": "file:///nonexistent/b.ts", "version": 1}, "edits": [{"range": range, "newText": "./z"}]},
        ]});
        let edits = parse_workspace_edit(&mut files, &doc);
        assert_eq!(edits.len(), 1, "edits of one file are merged and resource operations skipped");
        let texts: Vec<&str> = edits[0].edits.iter().map(|e| e.new_text.as_str()).collect();
        assert_eq!(texts, ["./y", "./z"]);
        assert!(parse_workspace_edit(&mut files, &Value::Null).is_empty());
    }
}
