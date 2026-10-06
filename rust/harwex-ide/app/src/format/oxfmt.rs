//! oxfmt, the oxc formatter, run as a CLI: `node <package>/bin/oxfmt --stdin-filepath=<file>`
//! with the buffer on stdin and the formatted text on stdout.
//!
//! The CLI and not `oxfmt --lsp`: one format costs one short process (about 50 ms on a
//! 20k-line file), oxfmt reads the nearest `.oxfmtrc.json(c)` above the file path on every
//! run, so a config edit applies at once, and nothing stays running between saves
//! (architecture rule 5). A language server would need a lifetime, an idle stop and a
//! document sync for a request that the user makes a few times a minute.
//!
//! The install is the project's own: the nearest `node_modules/oxfmt` from the file's folder
//! up, like oxlint (`diagnostics/strategy.rs`). Nothing is downloaded and nothing global is used.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// An oxfmt package found for a file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OxfmtInstall {
    /// `<dir>/node_modules/oxfmt`, as found (not canonicalized).
    pub package: PathBuf,
    pub version: String,
}

/// The nearest `node_modules/oxfmt` from `dir` up. Blocking: a few `stat` calls per level.
pub fn find(dir: &Path) -> Option<OxfmtInstall> {
    dir.ancestors().map(|d| d.join("node_modules/oxfmt")).find(|p| p.join("bin/oxfmt").is_file()).map(|package| OxfmtInstall { version: version(&package).unwrap_or_default(), package })
}

fn version(package: &Path) -> Option<String> {
    let text = std::fs::read_to_string(package.join("package.json")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    json["version"].as_str().map(str::to_string)
}

/// Why a format did not produce text. The file is then saved as it is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FormatError {
    /// No `node_modules/oxfmt` above the file.
    NotInstalled,
    NoNode,
    /// oxfmt rejected the text (a syntax error) or the file type. The text is oxfmt's message.
    Rejected(String),
    Timeout(Duration),
    Cancelled,
    /// The process could not start or broke its pipes.
    Failed(String),
}

impl FormatError {
    /// One status bar line.
    pub fn title(&self) -> String {
        match self {
            FormatError::NotInstalled => "oxfmt is not installed (node_modules/oxfmt)".into(),
            FormatError::NoNode => "oxfmt needs node, and node was not found".into(),
            FormatError::Rejected(msg) if msg.contains("Unsupported file type") => "oxfmt does not format this file type".into(),
            FormatError::Rejected(_) => "oxfmt could not parse the file".into(),
            FormatError::Timeout(d) => format!("oxfmt took longer than {} s", d.as_secs_f32()),
            FormatError::Cancelled => "oxfmt was cancelled".into(),
            FormatError::Failed(msg) => format!("oxfmt failed: {msg}"),
        }
    }

    /// oxfmt's own output, for the Notifications log.
    pub fn body(&self) -> String {
        match self {
            FormatError::Rejected(msg) | FormatError::Failed(msg) => msg.clone(),
            _ => String::new(),
        }
    }
}

/// Formats `text` as the file at `path`. Blocking: call it on a worker. The child is killed
/// when `cancel` turns true or `timeout` runs out.
pub fn format(install: &OxfmtInstall, path: &Path, text: &str, timeout: Duration, cancel: &AtomicBool) -> Result<String, FormatError> {
    let node = ide_ts::find_node().ok_or(FormatError::NoNode)?;
    let mut cmd = Command::new(&node);
    cmd.arg(install.package.join("bin/oxfmt")).arg(format!("--stdin-filepath={}", path.display()));
    // oxfmt looks for its config from the file path, not from the working directory; the
    // file's folder is still the least surprising one for a config that reads relative paths.
    cmd.current_dir(path.parent().filter(|d| d.is_dir()).unwrap_or(Path::new("/")));
    if let Some(dir) = node.parent() {
        let path_var = std::env::var_os("PATH").map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        cmd.env("PATH", format!("{}:{path_var}", dir.display()));
    }
    cmd.env("NO_COLOR", "1").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| FormatError::Failed(format!("cannot start {}: {e}", node.display())))?;
    // stdin, stdout and stderr each get a thread: a big file fills a pipe buffer otherwise.
    let mut stdin = child.stdin.take().expect("piped stdin");
    let input = text.to_string();
    let writer = std::thread::spawn(move || {
        let _ = stdin.write_all(input.as_bytes());
    });
    let read = |mut r: Box<dyn Read + Send>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = r.read_to_end(&mut buf);
            buf
        })
    };
    let out = read(Box::new(child.stdout.take().expect("piped stdout")));
    let err = read(Box::new(child.stderr.take().expect("piped stderr")));
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(e) => return Err(FormatError::Failed(e.to_string())),
        }
        let stop = if cancel.load(Ordering::SeqCst) {
            Some(FormatError::Cancelled)
        } else if start.elapsed() >= timeout {
            Some(FormatError::Timeout(timeout))
        } else {
            None
        };
        if let Some(why) = stop {
            let _ = child.kill();
            let _ = child.wait();
            return Err(why);
        }
        std::thread::sleep(Duration::from_millis(5));
    };
    let _ = writer.join();
    let stdout = out.join().unwrap_or_default();
    let stderr = String::from_utf8_lossy(&err.join().unwrap_or_default()).trim().to_string();
    if !status.success() {
        let msg = if stderr.is_empty() { format!("exit status {status}") } else { stderr };
        return Err(FormatError::Rejected(msg));
    }
    let formatted = String::from_utf8(stdout).map_err(|_| FormatError::Failed("the output is not UTF-8".into()))?;
    // The document keeps LF lines and writes the file's own line ends on save.
    Ok(if formatted.contains('\r') { formatted.replace("\r\n", "\n") } else { formatted })
}
