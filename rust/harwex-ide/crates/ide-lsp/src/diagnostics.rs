//! Diagnostics: pulled with `textDocument/diagnostic` (LSP 3.17) or kept from the last
//! `textDocument/publishDiagnostics` the server pushed. Both end up as [`Diagnostic`]s in
//! editor coordinates, converted with the text the server saw.

use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};

use crate::client::LspClient;
use crate::position::LineIndex;
use crate::uri::path_to_uri;
use crate::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Severity {
    Error,
    Warning,
    Information,
    Hint,
}

impl Severity {
    /// LSP `DiagnosticSeverity`; a missing value means error, as most servers intend.
    pub fn from_lsp(v: &Value) -> Severity {
        match v.as_u64() {
            Some(2) => Severity::Warning,
            Some(3) => Severity::Information,
            Some(4) => Severity::Hint,
            _ => Severity::Error,
        }
    }
}

/// One problem in a file. 0-based lines, char columns.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Diagnostic {
    pub line: usize,
    pub column: usize,
    pub end_line: usize,
    pub end_column: usize,
    pub severity: Severity,
    /// `2322`, `eslint(no-debugger)`; `None` when the server sent none.
    pub code: Option<String>,
    /// `ts`, `oxc`; `None` when the server sent none.
    pub source: Option<String>,
    pub message: String,
    /// Tagged `Unnecessary` (unused code): drawn faded, not underlined.
    pub unnecessary: bool,
}

impl LspClient {
    /// Whether the server answers `textDocument/diagnostic`. Starts the server if needed.
    pub fn supports_pull_diagnostics(&self, timeout: Duration) -> Result<bool, Error> {
        Ok(self.capabilities(timeout)?.get("diagnosticProvider").is_some_and(|v| !v.is_null() && *v != false))
    }

    /// Diagnostics of an open file: pulled when the server supports it, else the last pushed
    /// ones (empty before the first push). Positions use the text the server has for `path`.
    pub fn diagnostics(&self, path: &Path, timeout: Duration) -> Result<Vec<Diagnostic>, Error> {
        let text = self.ensure_open(path, timeout)?;
        let index = LineIndex::with_breaks(text, self.config().line_breaks);
        if self.supports_pull_diagnostics(timeout)? {
            let result = self.request("textDocument/diagnostic", json!({"textDocument": {"uri": path_to_uri(path)}}), timeout)?;
            // A full report has `items`; an "unchanged" report cannot happen without a
            // `previousResultId`, which we never send.
            return Ok(parse_diagnostics(&result["items"], &index));
        }
        Ok(self.pushed(path).map(|raw| parse_diagnostics(&raw, &index)).unwrap_or_default())
    }
}

/// An array of LSP `Diagnostic`s in editor coordinates, sorted by position.
pub fn parse_diagnostics(items: &Value, index: &LineIndex) -> Vec<Diagnostic> {
    let items = items.as_array().map(Vec::as_slice).unwrap_or_default();
    let mut out: Vec<Diagnostic> = items
        .iter()
        .map(|d| {
            let r = &d["range"];
            let (line, column) = index.from_lsp(u(&r["start"]["line"]), u(&r["start"]["character"]));
            let (end_line, end_column) = index.from_lsp(u(&r["end"]["line"]), u(&r["end"]["character"]));
            let code = match &d["code"] {
                Value::String(s) => Some(s.clone()),
                Value::Number(n) => Some(n.to_string()),
                _ => None,
            };
            let unnecessary = d["tags"].as_array().is_some_and(|t| t.iter().any(|t| t == 1));
            Diagnostic {
                line,
                column,
                end_line,
                end_column,
                severity: Severity::from_lsp(&d["severity"]),
                code,
                source: d["source"].as_str().map(str::to_string),
                message: d["message"].as_str().unwrap_or_default().to_string(),
                unnecessary,
            }
        })
        .collect();
    out.sort_by_key(|d| (d.line, d.column, d.severity));
    out
}

fn u(v: &Value) -> usize {
    v.as_u64().unwrap_or(0) as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lsp_diagnostics_convert_utf16_codes_and_tags() {
        let index = LineIndex::new("let 😀 = x;\nfoo");
        let items = json!([
            {"range": {"start": {"line": 1, "character": 0}, "end": {"line": 1, "character": 3}}, "severity": 2, "code": "eslint(eqeqeq)", "source": "oxc", "message": "w"},
            {"range": {"start": {"line": 0, "character": 9}, "end": {"line": 0, "character": 10}}, "severity": 1, "code": 2304, "source": "ts", "message": "Cannot find name 'x'."},
            {"range": {"start": {"line": 0, "character": 4}, "end": {"line": 0, "character": 6}}, "severity": 4, "tags": [1], "message": "unused"},
        ]);
        let d = parse_diagnostics(&items, &index);
        assert_eq!(d.len(), 3);
        assert_eq!((d[0].column, d[0].end_column, d[0].severity, d[0].unnecessary), (4, 5, Severity::Hint, true));
        assert_eq!((d[1].column, d[1].code.as_deref(), d[1].source.as_deref()), (8, Some("2304"), Some("ts")));
        assert_eq!((d[2].line, d[2].severity, d[2].code.as_deref()), (1, Severity::Warning, Some("eslint(eqeqeq)")));
        assert_eq!(Severity::from_lsp(&Value::Null), Severity::Error);
        assert!(parse_diagnostics(&Value::Null, &index).is_empty());
    }
}
