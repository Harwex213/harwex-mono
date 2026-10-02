//! One tsserver child process and the files it has open.

use std::collections::HashMap;
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use serde_json::{json, Value};

use crate::locate::prepend_path;
use crate::protocol::read_message;
use crate::position::LineIndex;
use crate::Error;

/// Keeps the last bytes of tsserver's stderr, so a crash report says why it died.
const STDERR_TAIL: usize = 4096;

pub(crate) struct OpenFile {
    pub(crate) text: Arc<str>,
    /// Set for files we opened from disk on our own, because a request named a file the editor
    /// never opened. tsserver stops reading an open file from disk, so we re-read it when the
    /// mtime moves; editor-opened files get their text through `change` instead.
    disk_mtime: Option<SystemTime>,
}

struct State {
    process: Option<Process>,
    /// Survives restarts: a fresh process gets every file re-opened with its last text.
    open: HashMap<PathBuf, OpenFile>,
}

struct Process {
    child: Child,
    stdin: ChildStdin,
    /// Waiting requests by `seq`. The reader thread removes an entry when its response arrives.
    pending: Arc<Mutex<HashMap<u64, Sender<Value>>>>,
    /// Cleared by the reader under the `pending` lock when stdout closes, so a request either
    /// registers before the clear (and sees its sender dropped) or sees the flag and fails fast.
    alive: Arc<AtomicBool>,
    stderr_tail: Arc<Mutex<String>>,
    next_seq: u64,
}

impl Process {
    fn is_running(&mut self) -> bool {
        self.alive.load(Ordering::SeqCst) && matches!(self.child.try_wait(), Ok(None))
    }

    fn send(&mut self, command: &str, arguments: Value) -> Result<u64, Error> {
        self.next_seq += 1;
        let seq = self.next_seq;
        let msg = json!({"seq": seq, "type": "request", "command": command, "arguments": arguments});
        let mut line = msg.to_string();
        line.push('\n');
        self.stdin
            .write_all(line.as_bytes())
            .and_then(|_| self.stdin.flush())
            .map_err(|_| Error::ServerDied(self.stderr()))?;
        Ok(seq)
    }

    fn stderr(&self) -> String {
        lock(&self.stderr_tail).clone()
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub(crate) struct Server {
    node: PathBuf,
    tsserver_js: PathBuf,
    project_root: Option<PathBuf>,
    state: Mutex<State>,
}

impl Server {
    pub(crate) fn new(node: PathBuf, tsserver_js: PathBuf, project_root: Option<PathBuf>) -> Server {
        Server {
            node,
            tsserver_js,
            project_root,
            state: Mutex::new(State {
                process: None,
                open: HashMap::new(),
            }),
        }
    }

    pub(crate) fn open(&self, path: &Path, text: &str) {
        let mut state = lock(&self.state);
        let text: Arc<str> = Arc::from(text);
        // Errors are dropped on purpose: the file is remembered, and the next request
        // restarts the process and re-opens it, which reports the error to someone who waits.
        if self.ensure_running(&mut state).is_ok() {
            let args = self.open_args(path, &text);
            let _ = state.process.as_mut().map(|p| p.send("open", args));
        }
        state.open.insert(path.to_path_buf(), OpenFile { text, disk_mtime: None });
    }

    pub(crate) fn change(&self, path: &Path, text: &str) {
        let mut state = lock(&self.state);
        if !state.open.contains_key(path) {
            drop(state);
            return self.open(path, text);
        }
        let text: Arc<str> = Arc::from(text);
        // Restart first: a fresh process re-opens the old text, and the change below then
        // applies on top of exactly that text.
        if self.ensure_running(&mut state).is_ok() {
            let old = state.open[path].text.clone();
            let args = full_replace_args(path, &old, &text);
            let _ = state.process.as_mut().map(|p| p.send("updateOpen", args));
        }
        state.open.insert(path.to_path_buf(), OpenFile { text, disk_mtime: None });
    }

    pub(crate) fn close(&self, path: &Path) {
        let mut state = lock(&self.state);
        if state.open.remove(path).is_none() {
            return;
        }
        // No restart just to close: a fresh process does not have the file open anyway.
        if let Some(p) = state.process.as_mut().filter(|p| p.alive.load(Ordering::SeqCst)) {
            let _ = p.send("close", json!({"file": path}));
        }
    }

    /// The text tsserver sees for `path`, opening the file from disk if nobody opened it.
    /// tsserver answers "No Project" for files that are not open, hence the implicit open.
    pub(crate) fn ensure_open(&self, path: &Path) -> Result<Arc<str>, Error> {
        let mut state = lock(&self.state);
        self.ensure_running(&mut state)?;
        if let Some(file) = state.open.get(path) {
            let Some(old_mtime) = file.disk_mtime else {
                return Ok(file.text.clone());
            };
            let mtime = mtime(path);
            if mtime == Some(old_mtime) {
                return Ok(file.text.clone());
            }
            let old = file.text.clone();
            let text: Arc<str> = read_text(path)?.into();
            let args = full_replace_args(path, &old, &text);
            self.process(&mut state)?.send("updateOpen", args)?;
            state.open.insert(path.to_path_buf(), OpenFile { text: text.clone(), disk_mtime: mtime });
            return Ok(text);
        }
        let mtime = mtime(path);
        let text: Arc<str> = read_text(path)?.into();
        let args = self.open_args(path, &text);
        self.process(&mut state)?.send("open", args)?;
        state.open.insert(
            path.to_path_buf(),
            OpenFile {
                text: text.clone(),
                // Without an mtime we could never notice a change, so fall back to "now";
                // the first mismatch then reloads once.
                disk_mtime: Some(mtime.unwrap_or_else(SystemTime::now)),
            },
        );
        Ok(text)
    }

    /// Text of an open file, for converting result positions without touching the disk.
    pub(crate) fn open_text(&self, path: &Path) -> Option<Arc<str>> {
        lock(&self.state).open.get(path).map(|f| f.text.clone())
    }

    /// Sends a request and blocks until its response or the timeout.
    /// Returns the response body; `Null` when tsserver has nothing to say at that position.
    pub(crate) fn request(&self, command: &str, arguments: Value, timeout: Duration) -> Result<Value, Error> {
        let (rx, pending, stderr_tail, seq) = {
            let mut state = lock(&self.state);
            self.ensure_running(&mut state)?;
            let process = self.process(&mut state)?;
            let (tx, rx) = mpsc::channel();
            // `send` takes the next seq; the state lock keeps it from moving meanwhile, and the
            // entry must exist before the write or a fast response would find no waiter.
            let seq = process.next_seq + 1;
            {
                let mut pending = lock(&process.pending);
                if !process.alive.load(Ordering::SeqCst) {
                    return Err(Error::ServerDied(process.stderr()));
                }
                pending.insert(seq, tx);
            }
            if let Err(e) = process.send(command, arguments) {
                lock(&process.pending).remove(&seq);
                return Err(e);
            }
            (rx, process.pending.clone(), process.stderr_tail.clone(), seq)
        };
        let response = match rx.recv_timeout(timeout) {
            Ok(response) => response,
            Err(RecvTimeoutError::Timeout) => {
                // The late response, if it ever comes, finds no entry and is dropped.
                lock(&pending).remove(&seq);
                return Err(Error::Timeout {
                    command: command.to_string(),
                    after: timeout,
                });
            }
            Err(RecvTimeoutError::Disconnected) => return Err(Error::ServerDied(lock(&stderr_tail).clone())),
        };
        if response["success"].as_bool() == Some(true) {
            return Ok(response.get("body").cloned().unwrap_or(Value::Null));
        }
        let message = response["message"].as_str().unwrap_or("request failed").to_string();
        // tsserver reports "nothing here" (whitespace, keywords) as a failure; it is not one.
        if message.starts_with("No content available") {
            return Ok(Value::Null);
        }
        Err(Error::Server(message))
    }

    /// Asks tsserver to exit and reaps it. Open files are forgotten too, because shutdown means
    /// the caller is done with this server.
    pub(crate) fn shutdown(&self) {
        let mut state = lock(&self.state);
        state.open.clear();
        if let Some(mut process) = state.process.take() {
            let _ = process.send("exit", json!({}));
            let deadline = Instant::now() + Duration::from_millis(500);
            while Instant::now() < deadline && matches!(process.child.try_wait(), Ok(None)) {
                thread::sleep(Duration::from_millis(10));
            }
            // Drop kills it if it is still running.
        }
    }

    pub(crate) fn kill(&self) {
        if let Some(p) = lock(&self.state).process.as_mut() {
            let _ = p.child.kill();
            let _ = p.child.wait();
        }
    }

    fn process<'a>(&self, state: &'a mut MutexGuard<'_, State>) -> Result<&'a mut Process, Error> {
        state
            .process
            .as_mut()
            .ok_or_else(|| Error::ServerDied(String::new()))
    }

    fn ensure_running(&self, state: &mut MutexGuard<'_, State>) -> Result<(), Error> {
        if let Some(p) = state.process.as_mut() {
            if p.is_running() {
                return Ok(());
            }
        }
        // Drop the dead process first so its pending requests fail instead of waiting.
        state.process = None;
        let mut process = self.spawn()?;
        let _ = process.send(
            "configure",
            json!({
                "hostInfo": "harwex-ide",
                // Scanning every package.json for auto-imports costs seconds on a big
                // workspace, and navigation never needs it.
                "preferences": {"includePackageJsonAutoImports": "off"},
            }),
        );
        let opens: Vec<Value> = state
            .open
            .iter()
            .map(|(path, file)| self.open_args(path, &file.text))
            .collect();
        for args in opens {
            process.send("open", args)?;
        }
        state.process = Some(process);
        Ok(())
    }

    fn spawn(&self) -> Result<Process, Error> {
        let mut cmd = Command::new(&self.node);
        cmd.arg(&self.tsserver_js)
            .args([
                "--disableAutomaticTypingAcquisition",
                "--suppressDiagnosticEvents",
                "--noGetErrOnBackgroundUpdate",
                "--locale",
                "en",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if self.project_root.is_some() {
            cmd.arg("--useInferredProjectPerProjectRoot");
        }
        if let Some(dir) = self.node.parent() {
            cmd.env("PATH", prepend_path(dir));
        }
        if let Some(root) = &self.project_root {
            cmd.current_dir(root);
        }
        let mut child = cmd.spawn().map_err(Error::Spawn)?;
        let stdin = child.stdin.take().ok_or_else(|| Error::ServerDied(String::new()))?;
        let stdout = child.stdout.take().ok_or_else(|| Error::ServerDied(String::new()))?;
        let stderr = child.stderr.take();

        let pending: Arc<Mutex<HashMap<u64, Sender<Value>>>> = Arc::default();
        let alive = Arc::new(AtomicBool::new(true));
        let stderr_tail: Arc<Mutex<String>> = Arc::default();

        {
            let pending = pending.clone();
            let alive = alive.clone();
            thread::Builder::new()
                .name("tsserver-reader".into())
                .spawn(move || reader_loop(stdout, pending, alive))
                .map_err(Error::Spawn)?;
        }
        if let Some(mut stderr) = stderr {
            let tail = stderr_tail.clone();
            let _ = thread::Builder::new().name("tsserver-stderr".into()).spawn(move || {
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
        Ok(Process {
            child,
            stdin,
            pending,
            alive,
            stderr_tail,
            next_seq: 0,
        })
    }

    fn open_args(&self, path: &Path, text: &str) -> Value {
        let mut args = json!({"file": path, "fileContent": text});
        if let Some(kind) = script_kind(path) {
            args["scriptKindName"] = kind.into();
        }
        if let Some(root) = &self.project_root {
            args["projectRootPath"] = json!(root);
        }
        args
    }
}

fn reader_loop(
    stdout: std::process::ChildStdout,
    pending: Arc<Mutex<HashMap<u64, Sender<Value>>>>,
    alive: Arc<AtomicBool>,
) {
    // tsserver can send multi-megabyte bodies (references in a big project); a large buffer
    // keeps the syscall count down.
    let mut reader = BufReader::with_capacity(1 << 16, stdout);
    while let Ok(Some(msg)) = read_message(&mut reader) {
        if msg["type"] != "response" {
            // Events (projectLoadingStart, telemetry, ...) are not used yet.
            continue;
        }
        let Some(seq) = msg["request_seq"].as_u64() else {
            continue;
        };
        if let Some(tx) = lock(&pending).remove(&seq) {
            let _ = tx.send(msg);
        }
    }
    let mut pending = lock(&pending);
    alive.store(false, Ordering::SeqCst);
    // Dropping the senders wakes every waiter with Disconnected right away.
    pending.clear();
}

/// `updateOpen` that replaces the whole old text. The plan accepts full-text sync for now;
/// the end position must be computed in tsserver's coordinates of the old text.
fn full_replace_args(path: &Path, old: &str, new: &str) -> Value {
    let (end_line, end_offset) = LineIndex::new(old).ts_end();
    json!({
        "changedFiles": [{
            "fileName": path,
            "textChanges": [{
                "start": {"line": 1, "offset": 1},
                "end": {"line": end_line, "offset": end_offset},
                "newText": new,
            }],
        }],
    })
}

fn script_kind(path: &Path) -> Option<&'static str> {
    Some(match path.extension()?.to_str()? {
        "ts" | "mts" | "cts" => "TS",
        "tsx" => "TSX",
        "js" | "mjs" | "cjs" => "JS",
        "jsx" => "JSX",
        _ => return None,
    })
}

fn mtime(path: &Path) -> Option<SystemTime> {
    path.metadata().and_then(|m| m.modified()).ok()
}

pub(crate) fn read_text(path: &Path) -> Result<String, Error> {
    let bytes = std::fs::read(path).map_err(|e| Error::Io(path.to_path_buf(), e))?;
    Ok(String::from_utf8(bytes).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned()))
}

/// A poisoned lock only means another thread panicked mid-request; the maps stay usable.
pub(crate) fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}
