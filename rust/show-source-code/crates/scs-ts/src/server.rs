//! One tsserver child process. Requests go to stdin as one JSON line each; responses come back
//! on stdout as `Content-Length: N\r\n\r\n<N bytes of JSON>` frames.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::Error;

pub(crate) struct Server {
    child: Child,
    stdin: ChildStdin,
    responses: Receiver<Value>,
    stderr_tail: Arc<Mutex<String>>,
    next_seq: u64,
}

impl Server {
    pub(crate) fn spawn(node: &Path, tsserver: &Path, root: &Path) -> Result<Server, Error> {
        let mut cmd = Command::new(node);
        cmd.arg(tsserver)
            .args(["--disableAutomaticTypingAcquisition", "--suppressDiagnosticEvents", "--noGetErrOnBackgroundUpdate", "--locale", "en"])
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = cmd.spawn().map_err(Error::Spawn)?;
        let stdin = child.stdin.take().ok_or_else(|| Error::ServerDied(String::new()))?;
        let stdout = child.stdout.take().ok_or_else(|| Error::ServerDied(String::new()))?;
        let stderr = child.stderr.take();
        let (tx, responses) = mpsc::channel();
        thread::Builder::new()
            .name("tsserver-reader".into())
            .spawn(move || {
                let mut reader = BufReader::with_capacity(1 << 16, stdout);
                while let Some(msg) = read_message(&mut reader) {
                    if msg["type"] == "response" && tx.send(msg).is_err() {
                        break;
                    }
                }
            })
            .map_err(Error::Spawn)?;
        let stderr_tail: Arc<Mutex<String>> = Arc::default();
        if let Some(mut stderr) = stderr {
            let tail = stderr_tail.clone();
            let _ = thread::Builder::new().name("tsserver-stderr".into()).spawn(move || {
                let mut buf = [0u8; 4096];
                while let Ok(n @ 1..) = stderr.read(&mut buf) {
                    let mut t = tail.lock().unwrap_or_else(|e| e.into_inner());
                    t.push_str(&String::from_utf8_lossy(&buf[..n]));
                    if t.len() > 8192 {
                        let cut = t.len() - 4096;
                        let cut = (cut..t.len()).find(|&i| t.is_char_boundary(i)).unwrap_or(t.len());
                        t.drain(..cut);
                    }
                }
            });
        }
        let mut server = Server { child, stdin, responses, stderr_tail, next_seq: 0 };
        // Auto-import scanning of every package.json costs seconds and resolution never needs it.
        server.notify("configure", json!({"hostInfo": "show-code-source", "preferences": {"includePackageJsonAutoImports": "off"}}))?;
        Ok(server)
    }

    fn send(&mut self, command: &str, arguments: Value) -> Result<u64, Error> {
        self.next_seq += 1;
        let msg = json!({"seq": self.next_seq, "type": "request", "command": command, "arguments": arguments});
        let mut line = msg.to_string();
        line.push('\n');
        self.stdin.write_all(line.as_bytes()).and_then(|_| self.stdin.flush()).map_err(|_| Error::ServerDied(self.stderr()))?;
        Ok(self.next_seq)
    }

    /// A request whose response nobody waits for (`open`, `close`, `configure`).
    pub(crate) fn notify(&mut self, command: &str, arguments: Value) -> Result<(), Error> {
        self.send(command, arguments).map(|_| ())
    }

    /// Sends a request and blocks until its response. `Null` when tsserver has no answer.
    pub(crate) fn request(&mut self, command: &str, arguments: Value, timeout: Duration) -> Result<Value, Error> {
        let seq = self.send(command, arguments)?;
        let deadline = Instant::now() + timeout;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match self.responses.recv_timeout(left) {
                // Late answers to earlier requests (a timed-out one, `configure`) are skipped.
                Ok(msg) if msg["request_seq"].as_u64() != Some(seq) => continue,
                Ok(msg) => {
                    if msg["success"].as_bool() == Some(true) {
                        return Ok(msg.get("body").cloned().unwrap_or(Value::Null));
                    }
                    return Ok(Value::Null);
                }
                Err(RecvTimeoutError::Timeout) => return Err(Error::Timeout(command.to_string())),
                Err(RecvTimeoutError::Disconnected) => return Err(Error::ServerDied(self.stderr())),
            }
        }
    }

    fn stderr(&self) -> String {
        self.stderr_tail.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.send("exit", json!({}));
        let deadline = Instant::now() + Duration::from_millis(300);
        while Instant::now() < deadline && matches!(self.child.try_wait(), Ok(None)) {
            thread::sleep(Duration::from_millis(10));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Reads one frame. Blank lines between frames are skipped. `None` at the end of the stream.
fn read_message(reader: &mut impl BufRead) -> Option<Value> {
    let mut len = None;
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line).ok()? == 0 {
            return None;
        }
        let l = line.trim();
        if l.is_empty() {
            if len.is_some() {
                break;
            }
            continue;
        }
        if let Some(v) = l.strip_prefix("Content-Length:") {
            len = v.trim().parse::<usize>().ok();
        }
    }
    let mut body = vec![0u8; len?];
    reader.read_exact(&mut body).ok()?;
    // A malformed frame is skipped, not fatal: Null is not a response, so the reader goes on.
    Some(serde_json::from_slice(&body).unwrap_or(Value::Null))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_frames_with_blank_lines_between() {
        let body = r#"{"type":"response","request_seq":1}"#;
        let data = format!("Content-Length: {}\r\n\r\n{body}\n\nContent-Length: 2\r\n\r\n{{}}", body.len());
        let mut r = std::io::Cursor::new(data.into_bytes());
        assert_eq!(read_message(&mut r).unwrap()["request_seq"], 1);
        assert_eq!(read_message(&mut r).unwrap(), json!({}));
        assert!(read_message(&mut r).is_none());
    }
}
