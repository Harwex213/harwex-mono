//! A client for TypeScript's own language servers: `tsserver` (TypeScript 6 and older, run
//! with node) and the native TypeScript 7 server (`tsc --lsp --stdio`, or `tsgo`), which
//! speaks LSP.
//!
//! Module resolution (`paths`, `exports`, workspaces, `node_modules`) is left to the server on
//! purpose: reimplementing it would never match what `tsc` does.
//!
//! All calls block. The app calls them from worker threads; `TsService` is `Clone` and
//! `Send + Sync`, and requests from several threads run concurrently up to the server itself.

mod locate;
mod lsp;
mod position;
mod protocol;
mod server;

use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};

pub use locate::{
    find_global_tsserver, find_global_typescript, find_local_tsserver, find_node, find_typescript, Installation,
    NativeServer, TsServerJs,
};
use lsp::LspServer;
use position::LineIndex;
use server::{lock, read_text, Server};

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(5);

/// 0-based line, 0-based column in chars (`Location`), and one entry of a Find Usages list
/// (`Reference`). Shared with every other language through `ide-lsp`.
pub use ide_lsp::{Location, Reference};

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
    /// No usable TypeScript server above the file and no global install. `searched` says what
    /// was found and what is missing (a version without `tsserver.js`, a missing native exe).
    NotFound { file: PathBuf, searched: Vec<String> },
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
            Error::NotFound { file, searched } => {
                write!(f, "no TypeScript server for {}", file.display())?;
                if !searched.is_empty() {
                    write!(f, ": {}", searched.join("; "))?;
                }
                Ok(())
            }
            Error::Spawn(e) => write!(f, "failed to start the TypeScript server: {e}"),
            Error::Io(p, e) => write!(f, "{}: {e}", p.display()),
            Error::Timeout { command, after } => write!(f, "TypeScript server `{command}` timed out after {after:?}"),
            Error::ServerDied(stderr) if stderr.trim().is_empty() => write!(f, "TypeScript server exited"),
            Error::ServerDied(stderr) => write!(f, "TypeScript server exited: {}", stderr.trim()),
            Error::Server(m) => write!(f, "TypeScript server: {m}"),
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

/// Which kind of server answers for a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BackendKind {
    /// `tsserver.js` run with node.
    TsServer,
    /// The native TypeScript 7 server over LSP.
    NativeLsp,
}

/// What serves a file: for the status bar and for error reports.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendInfo {
    pub kind: BackendKind,
    /// TypeScript version from the package's `package.json`.
    pub version: String,
    /// `tsserver.js` or the native executable.
    pub program: PathBuf,
    /// The directory that owns `node_modules`; `None` for a global install.
    pub project_root: Option<PathBuf>,
    /// A `tsserver.js` that is also installed (for example `@typescript/old`). Go to Source
    /// Definition uses it when the native server does not support that request.
    pub tsserver_fallback: Option<PathBuf>,
}

impl BackendInfo {
    /// Short text for the status bar, e.g. "TS 7.0.2 native" or "TS 5.9.3 tsserver".
    pub fn label(&self) -> String {
        match self.kind {
            BackendKind::NativeLsp => format!("TS {} native", self.version),
            BackendKind::TsServer => format!("TS {} tsserver", self.version),
        }
    }
}

/// Which backend to use when a project has both a native server and a `tsserver.js`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum BackendPreference {
    /// The native server when there is one: it is much faster.
    #[default]
    Native,
    /// `tsserver.js` when there is one (for comparisons and as an escape hatch).
    TsServer,
}

/// One server process per program (and per project root for the native server), started
/// lazily on first use.
///
/// Cheap to clone; clones share the processes.
#[derive(Clone)]
pub struct TsService {
    inner: Arc<Inner>,
}

type Lookup = std::result::Result<Arc<Installation>, Arc<Vec<String>>>;
/// A native server process is shared by files with the same executable and project root.
type LspKey = (PathBuf, Option<PathBuf>);

struct Inner {
    /// tsserver processes by `tsserver.js` path.
    servers: Mutex<HashMap<PathBuf, Arc<Server>>>,
    /// Native processes by (executable, project root).
    lsp: Mutex<HashMap<LspKey, Arc<LspServer>>>,
    /// Directory -> installation. Walking up and stat-ing on every call would add up.
    lookup: Mutex<HashMap<PathBuf, Lookup>>,
    timeout_ms: AtomicU64,
    prefer_tsserver: AtomicBool,
}

impl Drop for Inner {
    fn drop(&mut self) {
        for server in lock(&self.servers).values() {
            server.shutdown();
        }
        for server in lock(&self.lsp).values() {
            server.shutdown();
        }
    }
}

impl Default for TsService {
    fn default() -> Self {
        Self::new()
    }
}

/// The server that answers for one file.
enum Backend {
    TsServer(Arc<Server>),
    Native {
        lsp: Arc<LspServer>,
        fallback: Option<TsServerJs>,
        project_root: Option<PathBuf>,
    },
}

impl TsService {
    pub fn new() -> TsService {
        TsService {
            inner: Arc::new(Inner {
                servers: Mutex::default(),
                lsp: Mutex::default(),
                lookup: Mutex::default(),
                timeout_ms: AtomicU64::new(DEFAULT_TIMEOUT.as_millis() as u64),
                prefer_tsserver: AtomicBool::new(false),
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

    /// Set it before the first request: files already open stay with their server.
    pub fn set_backend_preference(&self, preference: BackendPreference) {
        self.inner
            .prefer_tsserver
            .store(preference == BackendPreference::TsServer, Ordering::Relaxed);
    }

    /// Which server answers for `path`. Only locates it; nothing is started.
    pub fn backend(&self, path: &Path) -> Result<BackendInfo> {
        let path = normalize(path);
        let install = self.installation(&path)?;
        Ok(match self.choose(&install) {
            Choice::Native(native) => BackendInfo {
                kind: BackendKind::NativeLsp,
                version: native.version.clone(),
                program: native.exe.clone(),
                project_root: install.project_root.clone(),
                tsserver_fallback: install.tsserver.as_ref().map(|t| t.path.clone()),
            },
            Choice::TsServer(js) => BackendInfo {
                kind: BackendKind::TsServer,
                version: js.version.clone(),
                program: js.path.clone(),
                project_root: install.project_root.clone(),
                tsserver_fallback: None,
            },
        })
    }

    /// Opens a file with the editor's text. Never fails: problems surface on the next request.
    pub fn open(&self, path: &Path, text: &str) {
        let path = normalize(path);
        match self.server_for(&path) {
            Ok(Backend::TsServer(server)) => server.open(&path, text),
            Ok(Backend::Native { lsp, .. }) => lsp.open(&path, text, self.timeout()),
            Err(_) => {}
        }
    }

    /// Replaces the whole text of an open file (opens it if needed).
    pub fn change(&self, path: &Path, text: &str) {
        let path = normalize(path);
        match self.server_for(&path) {
            Ok(Backend::TsServer(server)) => server.change(&path, text),
            Ok(Backend::Native { lsp, fallback, .. }) => {
                lsp.change(&path, text, self.timeout());
                // A fallback tsserver that has the file open must see the edit too.
                if let Some(server) = fallback.and_then(|js| self.running_tsserver(&js.path)) {
                    if server.open_text(&path).is_some() {
                        server.change(&path, text);
                    }
                }
            }
            Err(_) => {}
        }
    }

    pub fn close(&self, path: &Path) {
        let path = normalize(path);
        match self.server_for(&path) {
            Ok(Backend::TsServer(server)) => server.close(&path),
            Ok(Backend::Native { lsp, fallback, .. }) => {
                lsp.close(&path);
                if let Some(server) = fallback.and_then(|js| self.running_tsserver(&js.path)) {
                    server.close(&path);
                }
            }
            Err(_) => {}
        }
    }

    /// Go to Declaration. In a dependency this lands in its `.d.ts`.
    pub fn definition(&self, path: &Path, line: usize, column: usize) -> Result<Vec<Location>> {
        let path = normalize(path);
        match self.server_for(&path)? {
            Backend::TsServer(server) => {
                let body = self.ts_position_request(&server, &path, line, column, "definitionAndBoundSpan")?;
                Ok(ts_locations(&server, &body["definitions"]))
            }
            Backend::Native { lsp, .. } => lsp.locations("textDocument/definition", &path, line, column, self.timeout()),
        }
    }

    /// Go to Source Definition: the real `.js` in `node_modules` instead of the `.d.ts`.
    /// Falls back to `definition` when the server finds nothing or does not know the request
    /// (TypeScript before 4.7). A native server without the request uses an installed
    /// `tsserver.js` (`@typescript/old`) when there is one.
    pub fn source_definition(&self, path: &Path, line: usize, column: usize) -> Result<Vec<Location>> {
        let path = normalize(path);
        match self.server_for(&path)? {
            Backend::TsServer(server) => {
                match self.ts_position_request(&server, &path, line, column, "findSourceDefinition") {
                    Ok(body) => {
                        let found = ts_locations(&server, &body);
                        if !found.is_empty() {
                            return Ok(found);
                        }
                    }
                    Err(Error::Server(_)) => {}
                    Err(e) => return Err(e),
                }
            }
            Backend::Native {
                lsp,
                fallback,
                project_root,
            } => {
                if lsp.supports_source_definition(self.timeout())? {
                    match lsp.locations("custom/textDocument/sourceDefinition", &path, line, column, self.timeout()) {
                        Ok(found) if !found.is_empty() => return Ok(found),
                        Ok(_) | Err(Error::Server(_)) => {}
                        Err(e) => return Err(e),
                    }
                } else if let Some(server) = fallback.and_then(|js| self.tsserver(&js.path, project_root).ok()) {
                    // The tsserver must see the editor's text, not the disk copy.
                    let text = lsp.ensure_open(&path, self.timeout())?;
                    server.change(&path, &text);
                    if let Ok(body) = self.ts_position_request(&server, &path, line, column, "findSourceDefinition") {
                        let found = ts_locations(&server, &body);
                        if !found.is_empty() {
                            return Ok(found);
                        }
                    }
                }
            }
        }
        self.definition(&path, line, column)
    }

    pub fn type_definition(&self, path: &Path, line: usize, column: usize) -> Result<Vec<Location>> {
        let path = normalize(path);
        match self.server_for(&path)? {
            Backend::TsServer(server) => {
                let body = self.ts_position_request(&server, &path, line, column, "typeDefinition")?;
                Ok(ts_locations(&server, &body))
            }
            Backend::Native { lsp, .. } => lsp.locations("textDocument/typeDefinition", &path, line, column, self.timeout()),
        }
    }

    pub fn references(&self, path: &Path, line: usize, column: usize) -> Result<Vec<Reference>> {
        let path = normalize(path);
        match self.server_for(&path)? {
            Backend::TsServer(server) => {
                let body = self.ts_position_request(&server, &path, line, column, "references")?;
                Ok(ts_references(&server, &body))
            }
            Backend::Native { lsp, .. } => lsp.references(&path, line, column, self.timeout()),
        }
    }

    pub fn quick_info(&self, path: &Path, line: usize, column: usize) -> Result<Option<QuickInfo>> {
        let path = normalize(path);
        match self.server_for(&path)? {
            Backend::TsServer(server) => {
                let body = self.ts_position_request(&server, &path, line, column, "quickinfo")?;
                Ok(ts_quick_info(&server, &path, &body))
            }
            Backend::Native { lsp, .. } => Ok(lsp.hover(&path, line, column, self.timeout())?.map(lsp_quick_info)),
        }
    }

    /// Stops every server. The service stays usable: the next call starts a fresh process.
    pub fn shutdown(&self) {
        let servers: Vec<Arc<Server>> = lock(&self.inner.servers).drain().map(|(_, s)| s).collect();
        for server in servers {
            server.shutdown();
        }
        let servers: Vec<Arc<LspServer>> = lock(&self.inner.lsp).drain().map(|(_, s)| s).collect();
        for server in servers {
            server.shutdown();
        }
    }

    /// Kills the server that serves `path`, as a crash would. For tests of the restart path.
    #[doc(hidden)]
    pub fn kill_server_for(&self, path: &Path) {
        match self.server_for(&normalize(path)) {
            Ok(Backend::TsServer(server)) => server.kill(),
            Ok(Backend::Native { lsp, .. }) => lsp.kill(),
            Err(_) => {}
        }
    }

    fn ts_position_request(&self, server: &Server, path: &Path, line: usize, column: usize, command: &str) -> Result<Value> {
        let text = server.ensure_open(path)?;
        let (line, offset) = LineIndex::new(text).ts_pos(line, column);
        server.request(
            command,
            json!({"file": path, "line": line, "offset": offset}),
            self.timeout(),
        )
    }

    fn installation(&self, path: &Path) -> Result<Arc<Installation>> {
        let dir = path.parent().unwrap_or(path).to_path_buf();
        let cached = lock(&self.inner.lookup).get(&dir).cloned();
        let found = match cached {
            Some(found) => found,
            None => {
                let found = match find_typescript(&dir) {
                    Ok(install) => Ok(Arc::new(install)),
                    Err(mut notes) => match find_global_typescript() {
                        Ok(install) => Ok(Arc::new(install)),
                        Err(global) => {
                            notes.extend(global);
                            Err(Arc::new(notes))
                        }
                    },
                };
                lock(&self.inner.lookup).insert(dir, found.clone());
                found
            }
        };
        found.map_err(|notes| Error::NotFound {
            file: path.to_path_buf(),
            searched: notes.to_vec(),
        })
    }

    fn choose<'a>(&self, install: &'a Installation) -> Choice<'a> {
        let prefer_tsserver = self.inner.prefer_tsserver.load(Ordering::Relaxed);
        match (&install.native, &install.tsserver) {
            (Some(_), Some(js)) if prefer_tsserver => Choice::TsServer(js),
            (Some(native), _) => Choice::Native(native),
            (None, Some(js)) => Choice::TsServer(js),
            // `find_typescript` never returns an installation without a server.
            (None, None) => unreachable!("installation without a server"),
        }
    }

    fn server_for(&self, path: &Path) -> Result<Backend> {
        let install = self.installation(path)?;
        match self.choose(&install) {
            Choice::Native(native) => {
                let key = (native.exe.clone(), install.project_root.clone());
                let lsp = lock(&self.inner.lsp)
                    .entry(key)
                    .or_insert_with(|| Arc::new(LspServer::new(native.exe.clone(), install.project_root.clone())))
                    .clone();
                Ok(Backend::Native {
                    lsp,
                    fallback: install.tsserver.clone(),
                    project_root: install.project_root.clone(),
                })
            }
            Choice::TsServer(js) => Ok(Backend::TsServer(self.tsserver(&js.path, install.project_root.clone())?)),
        }
    }

    fn tsserver(&self, tsserver_js: &Path, project_root: Option<PathBuf>) -> Result<Arc<Server>> {
        let mut servers = lock(&self.inner.servers);
        if let Some(server) = servers.get(tsserver_js) {
            return Ok(server.clone());
        }
        let node = find_node().ok_or(Error::NodeNotFound)?;
        let server = Arc::new(Server::new(node, tsserver_js.to_path_buf(), project_root));
        servers.insert(tsserver_js.to_path_buf(), server.clone());
        Ok(server)
    }

    fn running_tsserver(&self, tsserver_js: &Path) -> Option<Arc<Server>> {
        lock(&self.inner.servers).get(tsserver_js).cloned()
    }
}

enum Choice<'a> {
    Native(&'a NativeServer),
    TsServer(&'a TsServerJs),
}

fn ts_locations(server: &Server, spans: &Value) -> Vec<Location> {
    let mut files = FileTexts::new(|p| server.open_text(p));
    let spans = spans.as_array().map(Vec::as_slice).unwrap_or_default();
    let mut out: Vec<Location> = Vec::new();
    for span in spans {
        let Some(file) = span["file"].as_str() else { continue };
        let path = PathBuf::from(file);
        let index = files.index(&path);
        let (line, column) = ts_convert(index.as_ref(), &span["start"]);
        let location = Location { path, line, column };
        // Overloads and merged declarations can repeat the same spot.
        if !out.contains(&location) {
            out.push(location);
        }
    }
    out
}

fn ts_references(server: &Server, body: &Value) -> Vec<Reference> {
    let mut files = FileTexts::new(|p| server.open_text(p));
    let refs = body["refs"].as_array().map(Vec::as_slice).unwrap_or_default();
    refs.iter()
        .filter_map(|r| {
            let file = PathBuf::from(r["file"].as_str()?);
            let index = files.index(&file);
            let (line, column) = ts_convert(index.as_ref(), &r["start"]);
            let (end_line, end_column) = ts_convert(index.as_ref(), &r["end"]);
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
        .collect()
}

fn ts_quick_info(server: &Server, file: &Path, body: &Value) -> Option<QuickInfo> {
    if body.is_null() {
        return None;
    }
    let mut files = FileTexts::new(|p| server.open_text(p));
    let index = files.index(file);
    let (line, column) = ts_convert(index.as_ref(), &body["start"]);
    let (end_line, end_column) = ts_convert(index.as_ref(), &body["end"]);
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
    Some(QuickInfo {
        kind: body["kind"].as_str().unwrap_or_default().to_string(),
        kind_modifiers: body["kindModifiers"].as_str().unwrap_or_default().to_string(),
        display: body["displayString"].as_str().unwrap_or_default().to_string(),
        documentation: display_text(&body["documentation"]),
        tags,
        line,
        column,
        end_line,
        end_column,
    })
}

/// Hover to `QuickInfo`. The native server sends markdown: a ```typescript block with the
/// signature, then the documentation, then one `*@tag*` paragraph per JSDoc tag.
fn lsp_quick_info(hover: ide_lsp::Hover) -> QuickInfo {
    let (display, documentation, tags) = parse_hover_markdown(&hover.markdown);
    QuickInfo {
        kind: hover_kind(&display),
        kind_modifiers: String::new(),
        display,
        documentation,
        tags,
        line: hover.line,
        column: hover.column,
        end_line: hover.end_line,
        end_column: hover.end_column,
    }
}

/// Splits hover markdown into (signature, documentation, tags).
fn parse_hover_markdown(markdown: &str) -> (String, String, Vec<QuickInfoTag>) {
    let mut display = String::new();
    let mut rest = markdown;
    if let Some(after) = markdown.trim_start().strip_prefix("```") {
        // Skip the language name on the fence line.
        let body = after.split_once('\n').map_or("", |(_, b)| b);
        let (code, tail) = match body.find("\n```") {
            Some(end) => (&body[..end], body[end + 4..].split_once('\n').map_or("", |(_, t)| t)),
            None => (body, ""),
        };
        display = code.trim().to_string();
        rest = tail;
    }
    let mut doc = String::new();
    let mut tags: Vec<(String, String)> = Vec::new();
    for line in rest.lines() {
        if let Some(name) = line.strip_prefix("*@").and_then(|l| l.split_once('*')) {
            tags.push((name.0.to_string(), name.1.to_string()));
            continue;
        }
        let target = match tags.last_mut() {
            Some((_, text)) => text,
            None => &mut doc,
        };
        // Code fences of `@example` are markup, not text.
        if line.trim_start().starts_with("```") {
            continue;
        }
        target.push('\n');
        target.push_str(line);
    }
    let tags = tags
        .into_iter()
        .map(|(name, text)| {
            let text = text.trim();
            let text = text.strip_prefix('—').map(str::trim_start).unwrap_or(text);
            // `@param` reads "`name` — text"; tsserver gives "name text".
            let text = match text.strip_prefix('`').and_then(|t| t.split_once('`')) {
                Some((param, after)) => {
                    let after = after.trim_start();
                    let after = after.strip_prefix('—').map(str::trim_start).unwrap_or(after);
                    format!("{param} {after}").trim().to_string()
                }
                None => text.to_string(),
            };
            QuickInfoTag { name, text }
        })
        .collect();
    (display, doc.trim().to_string(), tags)
}

/// tsserver-like element kind from a signature line: "(alias) function f" -> "alias",
/// "const x: number" -> "const".
fn hover_kind(display: &str) -> String {
    if let Some(inner) = display.strip_prefix('(').and_then(|d| d.split_once(')')) {
        return inner.0.to_string();
    }
    let word = display.split_whitespace().next().unwrap_or_default();
    match word {
        "function" | "const" | "let" | "var" | "class" | "interface" | "type" | "enum" | "module" | "import" => word.to_string(),
        "namespace" => "module".to_string(),
        _ => String::new(),
    }
}

/// Line tables of result files, built once per response. Open files use the editor's text,
/// because the disk copy may be older than what the server answered about.
struct FileTexts<F: Fn(&Path) -> Option<Arc<str>>> {
    open_text: F,
    cache: HashMap<PathBuf, Option<Rc<LineIndex>>>,
}

impl<F: Fn(&Path) -> Option<Arc<str>>> FileTexts<F> {
    fn new(open_text: F) -> FileTexts<F> {
        FileTexts {
            open_text,
            cache: HashMap::new(),
        }
    }

    fn index(&mut self, path: &Path) -> Option<Rc<LineIndex>> {
        let open_text = &self.open_text;
        self.cache
            .entry(path.to_path_buf())
            .or_insert_with(|| {
                let text = open_text(path).or_else(|| read_text(path).ok().map(Arc::from))?;
                Some(Rc::new(LineIndex::new(text)))
            })
            .clone()
    }

}

/// tsserver `{line, offset}` to 0-based (line, char column). Without the file text the
/// offset is taken as chars, which is right for ASCII lines.
fn ts_convert(index: Option<&Rc<LineIndex>>, pos: &Value) -> (usize, usize) {
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

/// Servers report module results by real path (`/private/var/...`, workspace packages
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

    #[test]
    fn hover_markdown_splits_signature_docs_and_tags() {
        let md = "```typescript\nfunction add(a: number, b: number): number\n```\nAdds.\n\n*@param* `a` \u{2014} first one\n\n*@returns* \u{2014} the sum\n\n*@example*\n```tsx\nadd(1, 2)\n```\n";
        let (display, doc, tags) = parse_hover_markdown(md);
        assert_eq!(display, "function add(a: number, b: number): number");
        assert_eq!(doc, "Adds.");
        let tags: Vec<(&str, &str)> = tags.iter().map(|t| (t.name.as_str(), t.text.as_str())).collect();
        assert_eq!(tags, [("param", "a first one"), ("returns", "the sum"), ("example", "add(1, 2)")]);
        assert_eq!(hover_kind(&display), "function");
        assert_eq!(hover_kind("(alias) function greet(name: string): string"), "alias");
        assert_eq!(hover_kind("namespace N"), "module");

        let (display, doc, tags) = parse_hover_markdown("```typescript\nlet x: number\n```\n");
        assert_eq!((display.as_str(), doc.as_str(), tags.len()), ("let x: number", "", 0));
    }

    #[test]
    fn not_found_message_says_what_was_searched() {
        let e = Error::NotFound {
            file: PathBuf::from("/p/a.ts"),
            searched: vec!["x is TypeScript 7.0.2 (native), but y is missing".into(), "no global typescript".into()],
        };
        assert_eq!(e.to_string(), "no TypeScript server for /p/a.ts: x is TypeScript 7.0.2 (native), but y is missing; no global typescript");
    }
}
