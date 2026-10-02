//! One native TypeScript server process (`tsc --lsp --stdio` of TypeScript 7, or `tsgo`) and
//! the files it has open.
//!
//! The protocol work (framing, routing, server requests, sync, timeouts, restart) is
//! `ide_lsp::LspClient`. This file only says how to start the TypeScript server and maps
//! errors to `ide_ts::Error`.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use ide_lsp::{ClientConfig, Hover, LineBreaks, LspClient};
use serde_json::json;

use crate::{Error, Location, Reference};

/// Spawning and `initialize` take a few milliseconds; a tiny request timeout must not make
/// the server unusable, so the handshake gets at least this long.
const MIN_INITIALIZE_TIMEOUT: Duration = Duration::from_secs(10);

pub(crate) struct LspServer {
    client: LspClient,
}

impl LspServer {
    pub(crate) fn new(exe: PathBuf, project_root: Option<PathBuf>) -> LspServer {
        let mut config = ClientConfig::new("tsc-lsp", exe);
        config.args = vec!["--lsp".into(), "--stdio".into()];
        config.cwd = project_root.clone();
        config.root = project_root;
        config.language_id = language_id;
        // TypeScript numbers lines with U+2028 and U+2029 as terminators.
        config.line_breaks = LineBreaks::Unicode;
        config.min_initialize_timeout = MIN_INITIALIZE_TIMEOUT;
        config.capabilities = json!({
            "general": {"positionEncodings": ["utf-16"]},
            "textDocument": {
                "synchronization": {"dynamicRegistration": false, "didSave": false},
                "definition": {"linkSupport": true},
                "typeDefinition": {"linkSupport": true},
                "references": {},
                "documentHighlight": {},
                "hover": {"contentFormat": ["markdown", "plaintext"]},
            },
            "workspace": {"configuration": true, "workspaceFolders": true},
            "window": {"workDoneProgress": false},
        });
        LspServer { client: LspClient::new(config) }
    }

    pub(crate) fn open(&self, path: &Path, text: &str, timeout: Duration) {
        self.client.open(path, text, timeout);
    }

    /// Replaces the whole text of an open file (opens it if needed).
    pub(crate) fn change(&self, path: &Path, text: &str, timeout: Duration) {
        self.client.change(path, text, timeout);
    }

    pub(crate) fn close(&self, path: &Path) {
        self.client.close(path);
    }

    /// The text the server sees for `path`, opening the file from disk if nobody opened it.
    pub(crate) fn ensure_open(&self, path: &Path, timeout: Duration) -> Result<Arc<str>, Error> {
        self.client.ensure_open(path, timeout).map_err(map_err)
    }

    /// Whether the server answers `custom/textDocument/sourceDefinition` (TypeScript 7 does).
    pub(crate) fn supports_source_definition(&self, timeout: Duration) -> Result<bool, Error> {
        let caps = self.client.capabilities(timeout).map_err(map_err)?;
        Ok(caps["experimental"]["customSourceDefinitionProvider"] == true || caps["customSourceDefinitionProvider"] == true)
    }

    pub(crate) fn locations(&self, method: &str, path: &Path, line: usize, column: usize, timeout: Duration) -> Result<Vec<Location>, Error> {
        self.client.locations(method, path, line, column, timeout).map_err(map_err)
    }

    pub(crate) fn references(&self, path: &Path, line: usize, column: usize, timeout: Duration) -> Result<Vec<Reference>, Error> {
        self.client.references(path, line, column, timeout).map_err(map_err)
    }

    pub(crate) fn hover(&self, path: &Path, line: usize, column: usize, timeout: Duration) -> Result<Option<Hover>, Error> {
        self.client.hover(path, line, column, timeout).map_err(map_err)
    }

    /// Asks the server to shut down and exit, then reaps it. Open files are forgotten too.
    pub(crate) fn shutdown(&self) {
        self.client.shutdown();
    }

    pub(crate) fn kill(&self) {
        self.client.kill();
    }
}

fn map_err(e: ide_lsp::Error) -> Error {
    match e {
        ide_lsp::Error::Spawn(e) => Error::Spawn(e),
        ide_lsp::Error::Io(p, e) => Error::Io(p, e),
        ide_lsp::Error::Timeout { method, after } => Error::Timeout { command: method, after },
        ide_lsp::Error::ServerDied(stderr) => Error::ServerDied(stderr),
        ide_lsp::Error::Server { code: ide_lsp::METHOD_NOT_FOUND, message } => Error::Server(format!("method not supported: {message}")),
        ide_lsp::Error::Server { message, .. } => Error::Server(message),
    }
}

fn language_id(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or_default() {
        "tsx" => "typescriptreact",
        "js" | "mjs" | "cjs" => "javascript",
        "jsx" => "javascriptreact",
        "json" => "json",
        _ => "typescript",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_keep_their_meaning() {
        let e = map_err(ide_lsp::Error::Server { code: ide_lsp::METHOD_NOT_FOUND, message: "nope".into() });
        assert!(matches!(e, Error::Server(m) if m.contains("not supported")));
        let e = map_err(ide_lsp::Error::Server { code: -32603, message: "boom".into() });
        assert!(matches!(e, Error::Server(m) if m == "boom"));
        let e = map_err(ide_lsp::Error::Timeout { method: "textDocument/hover".into(), after: Duration::from_secs(1) });
        assert!(matches!(e, Error::Timeout { command, .. } if command == "textDocument/hover"));
    }

    #[test]
    fn language_ids() {
        assert_eq!(language_id(Path::new("/a/b.tsx")), "typescriptreact");
        assert_eq!(language_id(Path::new("/a/b.mjs")), "javascript");
        assert_eq!(language_id(Path::new("/a/b.ts")), "typescript");
    }
}
