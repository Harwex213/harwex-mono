//! One language server process and the files it has open.
//!
//! The wire format is JSON-RPC 2.0 in `Content-Length` frames in both directions. A reader
//! thread routes responses to their waiters by id. It answers the server's own requests
//! (`workspace/configuration`, `client/registerCapability`, `window/workDoneProgress/create`)
//! at once, because a server may wait for those answers before it serves ours.

use std::collections::{BTreeMap, HashMap};
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use serde_json::{json, Value};

use crate::framing::{frame, read_message};
use crate::position::LineBreaks;
use crate::uri::path_to_uri;
use crate::Error;

/// How much of the server's stderr is kept for crash messages.
const STDERR_TAIL: usize = 4096;

/// Called on the reader thread for every notification the server sends (`$/progress`,
/// `window/logMessage`, extensions). It must not block.
pub type NotificationHandler = Arc<dyn Fn(&str, &Value) + Send + Sync>;
/// Answers one item of a `workspace/configuration` request (`{"section": ...}`).
pub type ConfigurationHandler = Arc<dyn Fn(&Value) -> Value + Send + Sync>;

/// Everything needed to start and talk to one server. Nothing here is language-specific;
/// a language adapter fills it in.
#[derive(Clone)]
pub struct ClientConfig {
    /// Short name for thread names and error texts, e.g. "rust-analyzer".
    pub name: String,
    pub program: PathBuf,
    pub args: Vec<String>,
    /// Working directory of the process. `None` keeps ours.
    pub cwd: Option<PathBuf>,
    /// Extra environment variables for the process.
    pub env: Vec<(String, String)>,
    /// The workspace folder (`rootUri`, `workspaceFolders`).
    pub root: Option<PathBuf>,
    /// `ClientCapabilities` sent in `initialize`.
    pub capabilities: Value,
    /// `initializationOptions`; left out of `initialize` when `None`.
    pub initialization_options: Option<Value>,
    /// `languageId` of a document in `didOpen`.
    pub language_id: fn(&Path) -> &'static str,
    /// Line terminators the server counts (affects every position conversion).
    pub line_breaks: LineBreaks,
    /// Answers `workspace/configuration`. Without it every item gets `null` ("defaults").
    pub configuration: Option<ConfigurationHandler>,
    pub on_notification: Option<NotificationHandler>,
    /// Spawning and `initialize` can take longer than a tiny request timeout, so the
    /// handshake waits at least this long.
    pub min_initialize_timeout: Duration,
}

impl ClientConfig {
    pub fn new(name: impl Into<String>, program: impl Into<PathBuf>) -> ClientConfig {
        ClientConfig {
            name: name.into(),
            program: program.into(),
            args: Vec::new(),
            cwd: None,
            env: Vec::new(),
            root: None,
            capabilities: default_capabilities(),
            initialization_options: None,
            language_id: |_| "plaintext",
            line_breaks: LineBreaks::Lsp,
            configuration: None,
            on_notification: None,
            min_initialize_timeout: Duration::from_secs(10),
        }
    }
}

/// Client capabilities for navigation: UTF-16 positions, links for definitions, markdown
/// hover, server-initiated progress and pulled configuration.
pub fn default_capabilities() -> Value {
    json!({
        "general": {"positionEncodings": ["utf-16"]},
        "textDocument": {
            "synchronization": {"dynamicRegistration": false, "didSave": false},
            "definition": {"linkSupport": true},
            "declaration": {"linkSupport": true},
            "typeDefinition": {"linkSupport": true},
            "implementation": {"linkSupport": true},
            "references": {},
            "documentHighlight": {},
            "hover": {"contentFormat": ["markdown", "plaintext"]},
        },
        "workspace": {"configuration": true, "workspaceFolders": true},
        "window": {"workDoneProgress": true},
    })
}

/// One running `$/progress` (work done) report.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Progress {
    pub token: String,
    pub title: String,
    pub message: Option<String>,
    pub percentage: Option<u32>,
}

type ProgressMap = Arc<Mutex<BTreeMap<String, Progress>>>;

struct OpenFile {
    text: Arc<str>,
    version: i64,
    /// Set for files opened from disk because a request named a file the editor never opened.
    /// They are re-read when the mtime moves.
    disk_mtime: Option<SystemTime>,
}

struct State {
    process: Option<Process>,
    /// Survives restarts: a fresh process gets every file re-opened with its last text.
    open: HashMap<PathBuf, OpenFile>,
    last_activity: Instant,
}

type Pending = Arc<Mutex<HashMap<u64, Sender<Value>>>>;

struct Process {
    child: Child,
    /// Shared with the reader thread, which writes the answers to server requests.
    writer: Arc<Mutex<ChildStdin>>,
    pending: Pending,
    /// Cleared by the reader under the `pending` lock when stdout closes.
    alive: Arc<AtomicBool>,
    stderr_tail: Arc<Mutex<String>>,
    next_id: u64,
    /// `capabilities` from the `initialize` result.
    capabilities: Value,
}

impl Process {
    fn is_running(&mut self) -> bool {
        self.alive.load(Ordering::SeqCst) && matches!(self.child.try_wait(), Ok(None))
    }

    fn stderr(&self) -> String {
        lock(&self.stderr_tail).clone()
    }

    fn notify(&self, method: &str, params: Value) -> Result<(), Error> {
        let msg = json!({"jsonrpc": "2.0", "method": method, "params": params});
        write(&self.writer, &msg).map_err(|_| Error::ServerDied(self.stderr()))
    }

    /// Sends a request and returns its id and the channel its response arrives on.
    fn start_request(&mut self, method: &str, params: Option<Value>) -> Result<(u64, mpsc::Receiver<Value>), Error> {
        self.next_id += 1;
        let id = self.next_id;
        let (tx, rx) = mpsc::channel();
        {
            let mut pending = lock(&self.pending);
            if !self.alive.load(Ordering::SeqCst) {
                return Err(Error::ServerDied(self.stderr()));
            }
            // The entry must exist before the write, or a fast response would find no waiter.
            pending.insert(id, tx);
        }
        let mut msg = json!({"jsonrpc": "2.0", "id": id, "method": method});
        // `shutdown` must have no params at all; some servers reject `null`.
        if let Some(params) = params {
            msg["params"] = params;
        }
        if write(&self.writer, &msg).is_err() {
            lock(&self.pending).remove(&id);
            return Err(Error::ServerDied(self.stderr()));
        }
        Ok((id, rx))
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// A client for one server process. `Send + Sync`: requests from several threads run
/// concurrently; the state lock is held only while a message is written.
///
/// The process starts lazily on the first call that needs it. If it dies, the next call
/// starts a new one and re-opens every open file with its last text.
pub struct LspClient {
    config: ClientConfig,
    state: Mutex<State>,
    progress: ProgressMap,
    spawns: AtomicUsize,
}

impl LspClient {
    pub fn new(config: ClientConfig) -> LspClient {
        LspClient {
            config,
            state: Mutex::new(State {
                process: None,
                open: HashMap::new(),
                last_activity: Instant::now(),
            }),
            progress: Arc::default(),
            spawns: AtomicUsize::new(0),
        }
    }

    pub fn config(&self) -> &ClientConfig {
        &self.config
    }

    /// Opens a file with the editor's text, or sends the new text if it is open already.
    /// Never fails: the file is remembered, and the next request restarts the process and
    /// re-opens it, which reports the error to someone who waits.
    pub fn open(&self, path: &Path, text: &str, timeout: Duration) {
        let mut state = lock(&self.state);
        state.last_activity = Instant::now();
        let text: Arc<str> = Arc::from(text);
        let version = state.open.get(path).map_or(1, |f| f.version + 1);
        let was_open = state.open.contains_key(path);
        // Recorded first, so a process started below opens it during its handshake.
        state.open.insert(path.to_path_buf(), OpenFile { text: text.clone(), version, disk_mtime: None });
        let running = state.process.as_mut().is_some_and(Process::is_running);
        if !running {
            // A fresh process re-opens everything in `state.open`, this file included.
            let _ = self.ensure_running(&mut state, timeout);
            return;
        }
        if let Some(p) = state.process.as_ref() {
            // A failed write means the process is dying; the restart re-opens the file.
            let _ = if was_open {
                p.notify("textDocument/didChange", change_params(path, version, &text))
            } else {
                p.notify("textDocument/didOpen", self.open_params(path, version, &text))
            };
        }
    }

    /// Replaces the whole text of an open file (opens it if needed).
    pub fn change(&self, path: &Path, text: &str, timeout: Duration) {
        self.open(path, text, timeout);
    }

    pub fn close(&self, path: &Path) {
        let mut state = lock(&self.state);
        state.last_activity = Instant::now();
        if state.open.remove(path).is_none() {
            return;
        }
        // No restart just to close: a fresh process does not have the file open anyway.
        if let Some(p) = state.process.as_ref().filter(|p| p.alive.load(Ordering::SeqCst)) {
            let _ = p.notify("textDocument/didClose", json!({"textDocument": {"uri": path_to_uri(path)}}));
        }
    }

    /// The text the server sees for `path`, opening the file from disk if nobody opened it.
    pub fn ensure_open(&self, path: &Path, timeout: Duration) -> Result<Arc<str>, Error> {
        let mut state = lock(&self.state);
        state.last_activity = Instant::now();
        self.ensure_running(&mut state, timeout)?;
        if let Some(file) = state.open.get(path) {
            let Some(old_mtime) = file.disk_mtime else {
                return Ok(file.text.clone());
            };
            let mtime = mtime(path);
            if mtime == Some(old_mtime) {
                return Ok(file.text.clone());
            }
            let version = file.version + 1;
            let text: Arc<str> = read_text(path)?.into();
            process(&state)?.notify("textDocument/didChange", change_params(path, version, &text))?;
            state.open.insert(path.to_path_buf(), OpenFile { text: text.clone(), version, disk_mtime: mtime });
            return Ok(text);
        }
        let mtime = mtime(path);
        let text: Arc<str> = read_text(path)?.into();
        process(&state)?.notify("textDocument/didOpen", self.open_params(path, 1, &text))?;
        state.open.insert(
            path.to_path_buf(),
            OpenFile {
                text: text.clone(),
                version: 1,
                // Without an mtime a change could never be noticed, so fall back to "now".
                disk_mtime: Some(mtime.unwrap_or_else(SystemTime::now)),
            },
        );
        Ok(text)
    }

    /// Text of an open file, for converting result positions without touching the disk.
    pub fn open_text(&self, path: &Path) -> Option<Arc<str>> {
        lock(&self.state).open.get(path).map(|f| f.text.clone())
    }

    /// Files the editor opened (not the ones a request opened from disk).
    pub fn editor_files(&self) -> usize {
        lock(&self.state).open.values().filter(|f| f.disk_mtime.is_none()).count()
    }

    /// `capabilities` of the `initialize` result. Starts the server if needed.
    pub fn capabilities(&self, timeout: Duration) -> Result<Value, Error> {
        let mut state = lock(&self.state);
        self.ensure_running(&mut state, timeout)?;
        Ok(process(&state)?.capabilities.clone())
    }

    /// Whether the process is running now. Starts nothing.
    pub fn is_running(&self) -> bool {
        lock(&self.state).process.as_mut().is_some_and(Process::is_running)
    }

    /// Time since the last open, change, close or request; `None` when no process runs.
    pub fn idle_for(&self) -> Option<Duration> {
        let mut state = lock(&self.state);
        let running = state.process.as_mut().is_some_and(Process::is_running);
        running.then(|| state.last_activity.elapsed())
    }

    /// How many processes this client has started, restarts included.
    pub fn spawn_count(&self) -> usize {
        self.spawns.load(Ordering::SeqCst)
    }

    /// Work-done progress reports that have begun and not ended, oldest token first.
    pub fn progress(&self) -> Vec<Progress> {
        lock(&self.progress).values().cloned().collect()
    }

    /// Sends a notification. Starts the server if needed.
    pub fn notify(&self, method: &str, params: Value, timeout: Duration) -> Result<(), Error> {
        let mut state = lock(&self.state);
        self.ensure_running(&mut state, timeout)?;
        process(&state)?.notify(method, params)
    }

    /// Sends a request and blocks until its response or the timeout. Returns `result`, which
    /// is `Null` when the server has nothing at that position. A timeout cancels the request
    /// on the server (`$/cancelRequest`); a late response is dropped.
    pub fn request(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, Error> {
        let (rx, id, writer, pending, stderr_tail) = {
            let mut state = lock(&self.state);
            state.last_activity = Instant::now();
            self.ensure_running(&mut state, timeout)?;
            let p = state.process.as_mut().ok_or_else(|| Error::ServerDied(String::new()))?;
            let (id, rx) = p.start_request(method, Some(params))?;
            (rx, id, p.writer.clone(), p.pending.clone(), p.stderr_tail.clone())
        };
        let response = match rx.recv_timeout(timeout) {
            Ok(response) => response,
            Err(RecvTimeoutError::Timeout) => {
                lock(&pending).remove(&id);
                let _ = write(&writer, &json!({"jsonrpc": "2.0", "method": "$/cancelRequest", "params": {"id": id}}));
                return Err(Error::Timeout { method: method.to_string(), after: timeout });
            }
            Err(RecvTimeoutError::Disconnected) => return Err(Error::ServerDied(lock(&stderr_tail).clone())),
        };
        lock(&self.state).last_activity = Instant::now();
        response_result(response)
    }

    /// Asks the server to shut down and exit, then reaps it. Open files are forgotten too.
    pub fn shutdown(&self) {
        let mut state = lock(&self.state);
        state.open.clear();
        if let Some(mut p) = state.process.take() {
            if let Ok((_, rx)) = p.start_request("shutdown", None) {
                let _ = rx.recv_timeout(Duration::from_millis(500));
            }
            let _ = p.notify("exit", Value::Null);
            let deadline = Instant::now() + Duration::from_millis(500);
            while Instant::now() < deadline && matches!(p.child.try_wait(), Ok(None)) {
                thread::sleep(Duration::from_millis(10));
            }
            // Drop kills it if it is still running.
        }
        lock(&self.progress).clear();
    }

    /// Kills the process, as a crash would. The next call restarts it.
    pub fn kill(&self) {
        if let Some(p) = lock(&self.state).process.as_mut() {
            let _ = p.child.kill();
            let _ = p.child.wait();
        }
    }

    fn open_params(&self, path: &Path, version: i64, text: &str) -> Value {
        json!({
            "textDocument": {
                "uri": path_to_uri(path),
                "languageId": (self.config.language_id)(path),
                "version": version,
                "text": text,
            }
        })
    }

    fn ensure_running(&self, state: &mut MutexGuard<'_, State>, timeout: Duration) -> Result<(), Error> {
        if let Some(p) = state.process.as_mut() {
            if p.is_running() {
                return Ok(());
            }
        }
        // Drop the dead process first so its pending requests fail instead of waiting.
        state.process = None;
        lock(&self.progress).clear();
        let mut p = self.spawn()?;
        let (_, rx) = p.start_request("initialize", Some(self.initialize_params()))?;
        let wait = timeout.max(self.config.min_initialize_timeout);
        let result = match rx.recv_timeout(wait) {
            Ok(response) => response_result(response)?,
            Err(RecvTimeoutError::Timeout) => return Err(Error::Timeout { method: "initialize".into(), after: wait }),
            Err(RecvTimeoutError::Disconnected) => return Err(Error::ServerDied(p.stderr())),
        };
        p.capabilities = result["capabilities"].clone();
        p.notify("initialized", json!({}))?;
        for (path, file) in &state.open {
            p.notify("textDocument/didOpen", self.open_params(path, file.version, &file.text))?;
        }
        state.process = Some(p);
        Ok(())
    }

    fn initialize_params(&self) -> Value {
        let (root_uri, folders) = match &self.config.root {
            Some(root) => {
                let name = root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                let uri = path_to_uri(root);
                (json!(uri), json!([{"uri": uri, "name": name}]))
            }
            None => (Value::Null, Value::Null),
        };
        let mut params = json!({
            "processId": std::process::id(),
            "clientInfo": {"name": "harwex-ide"},
            "locale": "en",
            "rootUri": root_uri,
            "workspaceFolders": folders,
            "capabilities": self.config.capabilities,
        });
        if let Some(options) = &self.config.initialization_options {
            params["initializationOptions"] = options.clone();
        }
        params
    }

    fn spawn(&self) -> Result<Process, Error> {
        let mut cmd = Command::new(&self.config.program);
        cmd.args(&self.config.args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        if let Some(cwd) = &self.config.cwd {
            cmd.current_dir(cwd);
        }
        for (k, v) in &self.config.env {
            cmd.env(k, v);
        }
        let mut child = cmd.spawn().map_err(Error::Spawn)?;
        self.spawns.fetch_add(1, Ordering::SeqCst);
        let stdin = child.stdin.take().ok_or_else(|| Error::ServerDied(String::new()))?;
        let stdout = child.stdout.take().ok_or_else(|| Error::ServerDied(String::new()))?;
        let stderr = child.stderr.take();

        let writer = Arc::new(Mutex::new(stdin));
        let pending: Pending = Arc::default();
        let alive = Arc::new(AtomicBool::new(true));
        let stderr_tail: Arc<Mutex<String>> = Arc::default();
        {
            let reader = Reader {
                writer: writer.clone(),
                pending: pending.clone(),
                alive: alive.clone(),
                progress: self.progress.clone(),
                configuration: self.config.configuration.clone(),
                on_notification: self.config.on_notification.clone(),
            };
            thread::Builder::new()
                .name(format!("{}-reader", self.config.name))
                .spawn(move || reader.run(stdout))
                .map_err(Error::Spawn)?;
        }
        if let Some(stderr) = stderr {
            keep_stderr_tail(stderr, stderr_tail.clone(), &format!("{}-stderr", self.config.name));
        }
        Ok(Process { child, writer, pending, alive, stderr_tail, next_id: 0, capabilities: Value::Null })
    }
}

impl Drop for LspClient {
    fn drop(&mut self) {
        self.shutdown();
    }
}

struct Reader {
    writer: Arc<Mutex<ChildStdin>>,
    pending: Pending,
    alive: Arc<AtomicBool>,
    progress: ProgressMap,
    configuration: Option<ConfigurationHandler>,
    on_notification: Option<NotificationHandler>,
}

impl Reader {
    fn run(self, stdout: std::process::ChildStdout) {
        // References in a big project can be megabytes; a large buffer keeps reads few.
        let mut reader = BufReader::with_capacity(1 << 16, stdout);
        while let Ok(Some(msg)) = read_message(&mut reader) {
            if let Some(method) = msg["method"].as_str() {
                match msg.get("id") {
                    // A request from the server.
                    Some(id) => {
                        let result = server_request_result(method, &msg["params"], self.configuration.as_ref());
                        let _ = write(&self.writer, &json!({"jsonrpc": "2.0", "id": id, "result": result}));
                    }
                    None => {
                        if method == "$/progress" {
                            track_progress(&self.progress, &msg["params"]);
                        }
                        if let Some(handler) = &self.on_notification {
                            handler(method, &msg["params"]);
                        }
                    }
                }
                continue;
            }
            let Some(id) = msg["id"].as_u64() else { continue };
            if let Some(tx) = lock(&self.pending).remove(&id) {
                let _ = tx.send(msg);
            }
        }
        let mut pending = lock(&self.pending);
        self.alive.store(false, Ordering::SeqCst);
        // Dropping the senders wakes every waiter with Disconnected right away.
        pending.clear();
        drop(pending);
        lock(&self.progress).clear();
    }
}

fn track_progress(progress: &ProgressMap, params: &Value) {
    let token = match &params["token"] {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    let value = &params["value"];
    let mut map = lock(progress);
    match value["kind"].as_str() {
        Some("begin") => {
            map.insert(
                token.clone(),
                Progress {
                    token,
                    title: value["title"].as_str().unwrap_or_default().to_string(),
                    message: value["message"].as_str().map(str::to_string),
                    percentage: value["percentage"].as_u64().map(|p| p as u32),
                },
            );
        }
        Some("report") => {
            if let Some(p) = map.get_mut(&token) {
                if let Some(m) = value["message"].as_str() {
                    p.message = Some(m.to_string());
                }
                if let Some(pct) = value["percentage"].as_u64() {
                    p.percentage = Some(pct as u32);
                }
            }
        }
        Some("end") => {
            map.remove(&token);
        }
        _ => {}
    }
}

fn process<'a>(state: &'a MutexGuard<'_, State>) -> Result<&'a Process, Error> {
    state.process.as_ref().ok_or_else(|| Error::ServerDied(String::new()))
}

fn write(writer: &Mutex<ChildStdin>, msg: &Value) -> std::io::Result<()> {
    let mut w = lock(writer);
    w.write_all(&frame(msg))?;
    w.flush()
}

/// The answer to a request the server sends to us.
pub(crate) fn server_request_result(method: &str, params: &Value, configuration: Option<&ConfigurationHandler>) -> Value {
    match method {
        // One entry per requested section; `null` means "use your defaults".
        "workspace/configuration" => {
            let items = params["items"].as_array().map(Vec::as_slice).unwrap_or_default();
            Value::Array(items.iter().map(|item| configuration.map_or(Value::Null, |c| c(item))).collect())
        }
        "workspace/applyEdit" => json!({"applied": false}),
        "workspace/workspaceFolders" => Value::Null,
        // registerCapability, unregisterCapability, workDoneProgress/create,
        // showMessageRequest, refresh requests: `null` is a valid success result.
        _ => Value::Null,
    }
}

pub(crate) fn response_result(mut response: Value) -> Result<Value, Error> {
    if let Some(error) = response.get("error") {
        let code = error["code"].as_i64().unwrap_or_default();
        let message = error["message"].as_str().unwrap_or("request failed").to_string();
        return Err(Error::Server { code, message });
    }
    Ok(response.get_mut("result").map(Value::take).unwrap_or(Value::Null))
}

/// A full-text change: a content change without a range replaces the whole document.
fn change_params(path: &Path, version: i64, text: &str) -> Value {
    json!({
        "textDocument": {"uri": path_to_uri(path), "version": version},
        "contentChanges": [{"text": text}],
    })
}

pub(crate) fn mtime(path: &Path) -> Option<SystemTime> {
    path.metadata().and_then(|m| m.modified()).ok()
}

/// Reads a file as text; invalid UTF-8 is replaced instead of failing.
pub fn read_text(path: &Path) -> Result<String, Error> {
    let bytes = std::fs::read(path).map_err(|e| Error::Io(path.to_path_buf(), e))?;
    Ok(String::from_utf8(bytes).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned()))
}

/// Keeps the last 4 KB of a child's stderr on a thread, for crash messages.
pub fn keep_stderr_tail(mut stderr: impl Read + Send + 'static, tail: Arc<Mutex<String>>, name: &str) {
    let _ = thread::Builder::new().name(name.into()).spawn(move || {
        let mut buf = [0u8; 1024];
        while let Ok(n) = stderr.read(&mut buf) {
            if n == 0 {
                break;
            }
            let mut tail = lock(&tail);
            tail.push_str(&String::from_utf8_lossy(&buf[..n]));
            if tail.len() > STDERR_TAIL {
                let mut cut = tail.len() - STDERR_TAIL;
                while !tail.is_char_boundary(cut) {
                    cut += 1;
                }
                tail.drain(..cut);
            }
        }
    });
}

/// A poisoned lock only means another thread panicked mid-request; the maps stay usable.
pub fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_requests_get_answers() {
        let items = json!({"items": [{"section": "typescript"}, {"section": "js/ts"}]});
        assert_eq!(server_request_result("workspace/configuration", &items, None), json!([null, null]));
        let config: ConfigurationHandler = Arc::new(|item| json!({"section": item["section"]}));
        assert_eq!(
            server_request_result("workspace/configuration", &items, Some(&config)),
            json!([{"section": "typescript"}, {"section": "js/ts"}])
        );
        assert_eq!(server_request_result("client/registerCapability", &Value::Null, None), Value::Null);
        assert_eq!(server_request_result("window/workDoneProgress/create", &Value::Null, None), Value::Null);
        assert_eq!(server_request_result("workspace/applyEdit", &Value::Null, None), json!({"applied": false}));
    }

    #[test]
    fn error_responses_become_errors() {
        let r = response_result(json!({"id": 1, "error": {"code": -32601, "message": "nope"}}));
        assert!(matches!(r, Err(Error::Server { code: -32601, ref message }) if message == "nope"));
        assert_eq!(response_result(json!({"id": 1, "result": null})).unwrap(), Value::Null);
        assert_eq!(response_result(json!({"id": 1, "result": [1]})).unwrap(), json!([1]));
        assert_eq!(response_result(json!({"id": 1})).unwrap(), Value::Null);
    }

    #[test]
    fn progress_begin_report_end() {
        let map: ProgressMap = Arc::default();
        track_progress(&map, &json!({"token": "idx", "value": {"kind": "begin", "title": "Indexing", "percentage": 0}}));
        track_progress(&map, &json!({"token": 7, "value": {"kind": "begin", "title": "Loading"}}));
        track_progress(&map, &json!({"token": "idx", "value": {"kind": "report", "message": "3/10", "percentage": 30}}));
        let list: Vec<Progress> = lock(&map).values().cloned().collect();
        assert_eq!(list.len(), 2);
        let idx = list.iter().find(|p| p.token == "idx").unwrap();
        assert_eq!((idx.title.as_str(), idx.message.as_deref(), idx.percentage), ("Indexing", Some("3/10"), Some(30)));
        track_progress(&map, &json!({"token": "idx", "value": {"kind": "end"}}));
        track_progress(&map, &json!({"token": 7, "value": {"kind": "end"}}));
        assert!(lock(&map).is_empty());
    }
}
