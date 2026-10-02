//! A client for TypeScript's own `tsserver`.
//!
//! Module resolution (`paths`, `exports`, workspaces, `node_modules`) is left to tsserver on
//! purpose: reimplementing it would never match what `tsc` does.
//!
//! All calls block. The app calls them from worker threads; `TsService` is `Clone` and
//! `Send + Sync`, and requests from several threads run concurrently up to tsserver itself,
//! which answers one request at a time.

mod locate;
mod position;
mod protocol;
mod server;

use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};

pub use locate::{find_global_tsserver, find_local_tsserver, find_node};
use position::LineIndex;
use server::{lock, read_text, Server};

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(5);

/// 0-based line, 0-based column in chars.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Location {
    pub path: PathBuf,
    pub line: usize,
    pub column: usize,
}

/// One entry of a Find Usages list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reference {
    pub location: Location,
    /// End of the referenced name, same coordinates as `location`.
    pub end_line: usize,
    pub end_column: usize,
    /// The whole line that contains the reference, without the line break.
    pub line_text: String,
    pub is_definition: bool,
    pub is_write: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuickInfoTag {
    pub name: String,
    pub text: String,
}

/// Hover information.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuickInfo {
    /// tsserver's element kind: "function", "const", "interface", ...
    pub kind: String,
    pub kind_modifiers: String,
    /// The signature line, e.g. `function greet(name: string): string`.
    pub display: String,
    pub documentation: String,
    pub tags: Vec<QuickInfoTag>,
    /// Span of the hovered identifier, 0-based, columns in chars.
    pub line: usize,
    pub column: usize,
    pub end_line: usize,
    pub end_column: usize,
}

#[derive(Debug)]
pub enum Error {
    /// No `node` on PATH, in the login shell or in the usual install locations.
    NodeNotFound,
    /// No `node_modules/typescript` above the file and no global install.
    TsServerNotFound(PathBuf),
    Spawn(std::io::Error),
    Io(PathBuf, std::io::Error),
    Timeout { command: String, after: Duration },
    /// The process exited. Carries the tail of its stderr. The next call restarts it.
    ServerDied(String),
    /// tsserver answered with `success: false`.
    Server(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::NodeNotFound => write!(f, "node not found"),
            Error::TsServerNotFound(p) => write!(f, "no typescript installation found for {}", p.display()),
            Error::Spawn(e) => write!(f, "failed to start tsserver: {e}"),
            Error::Io(p, e) => write!(f, "{}: {e}", p.display()),
            Error::Timeout { command, after } => write!(f, "tsserver `{command}` timed out after {after:?}"),
            Error::ServerDied(stderr) if stderr.trim().is_empty() => write!(f, "tsserver exited"),
            Error::ServerDied(stderr) => write!(f, "tsserver exited: {}", stderr.trim()),
            Error::Server(m) => write!(f, "tsserver: {m}"),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::Spawn(e) | Error::Io(_, e) => Some(e),
            _ => None,
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;

/// One tsserver process per `tsserver.js` path, started lazily on first use.
///
/// Cheap to clone; clones share the processes.
#[derive(Clone)]
pub struct TsService {
    inner: Arc<Inner>,
}

struct Inner {
    servers: Mutex<HashMap<PathBuf, Arc<Server>>>,
    /// Directory -> tsserver.js. Walking up and stat-ing on every call would add up.
    lookup: Mutex<HashMap<PathBuf, Option<PathBuf>>>,
    timeout_ms: AtomicU64,
}

impl Drop for Inner {
    fn drop(&mut self) {
        for server in lock(&self.servers).values() {
            server.shutdown();
        }
    }
}

impl Default for TsService {
    fn default() -> Self {
        Self::new()
    }
}

impl TsService {
    pub fn new() -> TsService {
        TsService {
            inner: Arc::new(Inner {
                servers: Mutex::default(),
                lookup: Mutex::default(),
                timeout_ms: AtomicU64::new(DEFAULT_TIMEOUT.as_millis() as u64),
            }),
        }
    }

    /// Per-request timeout. The first request in a big project includes project loading,
    /// which can exceed the 5 s default; a timed-out request can simply be retried.
    pub fn set_timeout(&self, timeout: Duration) {
        self.inner.timeout_ms.store(timeout.as_millis() as u64, Ordering::Relaxed);
    }

    pub fn timeout(&self) -> Duration {
        Duration::from_millis(self.inner.timeout_ms.load(Ordering::Relaxed))
    }

    /// Opens a file with the editor's text. Never fails: problems surface on the next request.
    pub fn open(&self, path: &Path, text: &str) {
        let path = normalize(path);
        if let Ok(server) = self.server_for(&path) {
            server.open(&path, text);
        }
    }

    /// Replaces the whole text of an open file (opens it if needed).
    pub fn change(&self, path: &Path, text: &str) {
        let path = normalize(path);
        if let Ok(server) = self.server_for(&path) {
            server.change(&path, text);
        }
    }

    pub fn close(&self, path: &Path) {
        let path = normalize(path);
        if let Ok(server) = self.server_for(&path) {
            server.close(&path);
        }
    }

    /// Go to Declaration. In a dependency this lands in its `.d.ts`.
    pub fn definition(&self, path: &Path, line: usize, column: usize) -> Result<Vec<Location>> {
        let (server, body) = self.position_request(path, line, column, "definitionAndBoundSpan")?;
        Ok(self.locations(&server, &body["definitions"]))
    }

    /// Go to Source Definition: the real `.js` in `node_modules` instead of the `.d.ts`.
    /// Falls back to `definition` when tsserver finds nothing or does not know the command
    /// (TypeScript before 4.7).
    pub fn source_definition(&self, path: &Path, line: usize, column: usize) -> Result<Vec<Location>> {
        match self.position_request(path, line, column, "findSourceDefinition") {
            Ok((server, body)) => {
                let found = self.locations(&server, &body);
                if !found.is_empty() {
                    return Ok(found);
                }
            }
            Err(Error::Server(_)) => {}
            Err(e) => return Err(e),
        }
        self.definition(path, line, column)
    }

    pub fn type_definition(&self, path: &Path, line: usize, column: usize) -> Result<Vec<Location>> {
        let (server, body) = self.position_request(path, line, column, "typeDefinition")?;
        Ok(self.locations(&server, &body))
    }

    pub fn references(&self, path: &Path, line: usize, column: usize) -> Result<Vec<Reference>> {
        let (server, body) = self.position_request(path, line, column, "references")?;
        let mut files = FileTexts::new(&server);
        let refs = body["refs"].as_array().map(Vec::as_slice).unwrap_or_default();
        Ok(refs
            .iter()
            .filter_map(|r| {
                let file = PathBuf::from(r["file"].as_str()?);
                let index = files.index(&file);
                let (line, column) = convert(index.as_ref(), &r["start"]);
                let (end_line, end_column) = convert(index.as_ref(), &r["end"]);
                let line_text = match &index {
                    Some(index) => index.line(line).to_string(),
                    None => r["lineText"].as_str().unwrap_or_default().to_string(),
                };
                Some(Reference {
                    location: Location { path: file, line, column },
                    end_line,
                    end_column,
                    line_text,
                    is_definition: r["isDefinition"].as_bool().unwrap_or(false),
                    is_write: r["isWriteAccess"].as_bool().unwrap_or(false),
                })
            })
            .collect())
    }

    pub fn quick_info(&self, path: &Path, line: usize, column: usize) -> Result<Option<QuickInfo>> {
        let (server, body) = self.position_request(path, line, column, "quickinfo")?;
        if body.is_null() {
            return Ok(None);
        }
        let file = normalize(path);
        let mut files = FileTexts::new(&server);
        let index = files.index(&file);
        let (line, column) = convert(index.as_ref(), &body["start"]);
        let (end_line, end_column) = convert(index.as_ref(), &body["end"]);
        let tags = body["tags"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .map(|t| QuickInfoTag {
                name: t["name"].as_str().unwrap_or_default().to_string(),
                text: display_text(&t["text"]),
            })
            .collect();
        Ok(Some(QuickInfo {
            kind: body["kind"].as_str().unwrap_or_default().to_string(),
            kind_modifiers: body["kindModifiers"].as_str().unwrap_or_default().to_string(),
            display: body["displayString"].as_str().unwrap_or_default().to_string(),
            documentation: display_text(&body["documentation"]),
            tags,
            line,
            column,
            end_line,
            end_column,
        }))
    }

    /// Stops every tsserver. The service stays usable: the next call starts a fresh process.
    pub fn shutdown(&self) {
        let servers: Vec<Arc<Server>> = lock(&self.inner.servers).drain().map(|(_, s)| s).collect();
        for server in servers {
            server.shutdown();
        }
    }

    /// Kills the tsserver that serves `path`, as a crash would. For tests of the restart path.
    #[doc(hidden)]
    pub fn kill_server_for(&self, path: &Path) {
        if let Ok(server) = self.server_for(&normalize(path)) {
            server.kill();
        }
    }

    fn position_request(&self, path: &Path, line: usize, column: usize, command: &str) -> Result<(Arc<Server>, Value)> {
        let path = normalize(path);
        let server = self.server_for(&path)?;
        let text = server.ensure_open(&path)?;
        let (line, offset) = LineIndex::new(text).ts_pos(line, column);
        let body = server.request(
            command,
            json!({"file": path, "line": line, "offset": offset}),
            self.timeout(),
        )?;
        Ok((server, body))
    }

    fn locations(&self, server: &Server, spans: &Value) -> Vec<Location> {
        let mut files = FileTexts::new(server);
        let spans = spans.as_array().map(Vec::as_slice).unwrap_or_default();
        let mut out: Vec<Location> = Vec::new();
        for span in spans {
            let Some(file) = span["file"].as_str() else { continue };
            let path = PathBuf::from(file);
            let index = files.index(&path);
            let (line, column) = convert(index.as_ref(), &span["start"]);
            let location = Location { path, line, column };
            // Overloads and merged declarations can repeat the same spot.
            if !out.contains(&location) {
                out.push(location);
            }
        }
        out
    }

    fn server_for(&self, path: &Path) -> Result<Arc<Server>> {
        let dir = path.parent().unwrap_or(path).to_path_buf();
        let cached = lock(&self.inner.lookup).get(&dir).cloned();
        let tsserver = match cached {
            Some(found) => found,
            None => {
                let found = find_local_tsserver(&dir).or_else(find_global_tsserver);
                lock(&self.inner.lookup).insert(dir, found.clone());
                found
            }
        };
        let tsserver = tsserver.ok_or_else(|| Error::TsServerNotFound(path.to_path_buf()))?;
        let mut servers = lock(&self.inner.servers);
        if let Some(server) = servers.get(&tsserver) {
            return Ok(server.clone());
        }
        let node = find_node().ok_or(Error::NodeNotFound)?;
        // A global install lives in .../lib/node_modules too, but its parent is not a project,
        // so only a tsserver found by walking up gives a project root.
        let is_local = path.parent().and_then(find_local_tsserver).as_ref() == Some(&tsserver);
        let root = if is_local { locate::project_root_of(&tsserver) } else { None };
        let server = Arc::new(Server::new(node, tsserver.clone(), root));
        servers.insert(tsserver, server.clone());
        Ok(server)
    }
}

/// Line tables of result files, built once per response. Open files use the editor's text,
/// because the disk copy may be older than what tsserver answered about.
struct FileTexts<'a> {
    server: &'a Server,
    cache: HashMap<PathBuf, Option<Rc<LineIndex>>>,
}

impl<'a> FileTexts<'a> {
    fn new(server: &'a Server) -> FileTexts<'a> {
        FileTexts {
            server,
            cache: HashMap::new(),
        }
    }

    fn index(&mut self, path: &Path) -> Option<Rc<LineIndex>> {
        let server = self.server;
        self.cache
            .entry(path.to_path_buf())
            .or_insert_with(|| {
                let text = server.open_text(path).or_else(|| read_text(path).ok().map(Arc::from))?;
                Some(Rc::new(LineIndex::new(text)))
            })
            .clone()
    }
}

/// tsserver `{line, offset}` to 0-based (line, char column). Without the file text the
/// offset is taken as chars, which is right for ASCII lines.
fn convert(index: Option<&Rc<LineIndex>>, pos: &Value) -> (usize, usize) {
    let line = pos["line"].as_u64().unwrap_or(1) as usize;
    let offset = pos["offset"].as_u64().unwrap_or(1) as usize;
    match index {
        Some(index) => index.editor_pos(line, offset),
        None => (line.saturating_sub(1), offset.saturating_sub(1)),
    }
}

/// Documentation arrives as a string or as display parts, depending on preferences.
fn display_text(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts.iter().filter_map(|p| p["text"].as_str()).collect(),
        _ => String::new(),
    }
}

/// tsserver reports module results by real path (`/private/var/...`, workspace packages
/// behind symlinks). Using real paths for our own files too keeps one name per file.
fn normalize(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_send_sync<T: Send + Sync + Clone>() {}

    #[test]
    fn service_is_shareable() {
        assert_send_sync::<TsService>();
    }

    #[test]
    fn display_text_accepts_both_shapes() {
        assert_eq!(display_text(&json!("doc")), "doc");
        assert_eq!(display_text(&json!([{"text": "a", "kind": "text"}, {"text": "b"}])), "ab");
        assert_eq!(display_text(&Value::Null), "");
    }
}
