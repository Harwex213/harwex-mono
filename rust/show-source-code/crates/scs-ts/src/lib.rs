//! Import resolution through TypeScript's own tsserver, so module resolution (package.json
//! `exports`, `types`, tsconfig `paths`, symlinked workspaces) is exactly what TypeScript does.
//!
//! The import specifiers are found by a lexical scan (`scan`); tsserver then answers "go to
//! definition" on each specifier string, which yields the file the module resolves to.
//! Calls block for as long as tsserver takes (seconds per project on first touch), so the app
//! runs them on a worker thread. Nothing here needs node at compile time.

pub mod cache;
mod locate;
mod scan;
mod server;

use std::path::{Path, PathBuf};
use std::time::Duration;

pub use locate::{find_node, find_tsserver};
pub use scan::{scan_imports, Specifier};

use serde_json::json;

/// How long one request may take. The first request of a project loads the whole program.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug)]
pub enum Error {
    NodeNotFound,
    TypeScriptNotFound,
    Spawn(std::io::Error),
    ServerDied(String),
    Timeout(String),
    Io(PathBuf, std::io::Error),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::NodeNotFound => write!(f, "node not found"),
            Error::TypeScriptNotFound => write!(f, "node_modules/typescript not found"),
            Error::Spawn(e) => write!(f, "cannot start tsserver: {e}"),
            Error::ServerDied(tail) => write!(f, "tsserver exited: {}", tail.lines().last().unwrap_or("")),
            Error::Timeout(cmd) => write!(f, "tsserver did not answer {cmd}"),
            Error::Io(p, e) => write!(f, "{}: {e}", p.display()),
        }
    }
}

impl std::error::Error for Error {}

/// One import of a file and the file TypeScript resolves it to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Import {
    pub specifier: String,
    /// 0-based line of the specifier.
    pub line: usize,
    /// Canonical path of the module file; `None` when TypeScript cannot resolve it.
    pub target: Option<PathBuf>,
}

/// The package part of a bare specifier: `@scope/name/deep` gives `@scope/name`, `lib/x`
/// gives `lib`. Relative and absolute specifiers give `None`.
pub fn package_of(specifier: &str) -> Option<&str> {
    if specifier.starts_with('.') || specifier.starts_with('/') || specifier.is_empty() {
        return None;
    }
    let mut parts = specifier.splitn(3, '/');
    let first = parts.next()?;
    if first.starts_with('@') {
        let second = parts.next()?;
        Some(&specifier[..first.len() + 1 + second.len()])
    } else {
        Some(first)
    }
}

/// A running tsserver for one workspace.
pub struct Resolver {
    server: server::Server,
}

impl Resolver {
    /// Finds node and the workspace's `node_modules/typescript/lib/tsserver.js`, and starts it.
    pub fn start(root: &Path) -> Result<Resolver, Error> {
        let tsserver = find_tsserver(root).ok_or(Error::TypeScriptNotFound)?;
        let node = find_node().ok_or(Error::NodeNotFound)?;
        Self::start_with(&node, &tsserver, root)
    }

    pub fn start_with(node: &Path, tsserver: &Path, root: &Path) -> Result<Resolver, Error> {
        Ok(Resolver { server: server::Server::spawn(node, tsserver, root)? })
    }

    /// Resolves the imports of `file` whose specifier passes `keep`. The file is opened only
    /// for the duration of the call.
    pub fn resolve_file(&mut self, file: &Path, keep: &dyn Fn(&str) -> bool) -> Result<Vec<Import>, Error> {
        let text = std::fs::read_to_string(file).map_err(|e| Error::Io(file.to_path_buf(), e))?;
        let specs: Vec<Specifier> = scan_imports(&text).into_iter().filter(|s| keep(&s.text)).collect();
        if specs.is_empty() {
            return Ok(Vec::new());
        }
        self.server.notify("open", json!({"file": file, "fileContent": text}))?;
        let mut out = Vec::with_capacity(specs.len());
        let mut result = Ok(());
        for s in specs {
            // tsserver positions are 1-based, columns in UTF-16 units.
            let args = json!({"file": file, "line": s.line + 1, "offset": s.col_utf16 + 1});
            match self.server.request("definition", args, REQUEST_TIMEOUT) {
                Ok(body) => {
                    let target = body.as_array().and_then(|defs| defs.first()).and_then(|d| d["file"].as_str()).map(PathBuf::from);
                    // Real paths, so they match the canonical paths of discovery.
                    let target = target.map(|t| t.canonicalize().unwrap_or(t));
                    out.push(Import { specifier: s.text, line: s.line, target });
                }
                Err(e) => {
                    result = Err(e);
                    break;
                }
            }
        }
        let _ = self.server.notify("close", json!({"file": file}));
        result.map(|()| out)
    }
}
