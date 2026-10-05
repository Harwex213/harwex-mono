//! Git logic for harwex-ide. No UI.
//!
//! Reads go through libgit2 (`git2`) because it is fast and needs no child process.
//! Anything that writes the index or the worktree, and every network operation, goes through
//! the `git` CLI. The CLI runs hooks, credential helpers, SSH agents and clean/smudge filters
//! (git-lfs), which libgit2 would silently skip and so corrupt LFS files or bypass hooks.
//!
//! Every function blocks. The app calls them from a worker thread.

mod branches;
mod cancel;
mod cli;
mod diff;
mod graph;
mod log;
mod ops;
mod selection;
mod status;
mod text_diff;

use std::fmt;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::time::Duration;

pub use git2::Oid;

pub use branches::{BranchInfo, Branches, TagInfo};
pub use cancel::CancelScope;
pub use cli::{CommandEvent, CommandOutcome};
pub use diff::{DiffHunk, DiffSide, FileDiff, LineChange, LineChangeKind, LineKind, LinePair};
pub use graph::{layout as graph_layout, ArrowDir, GraphArrow, GraphEdge, GraphRow, LONG_EDGE_ROWS};
pub use log::{BlameLine, ChangedFile, CommitDetails, CommitInfo, LogFilter, RefKind, RefLabel};
pub use selection::{BranchCompare, COMPARE_LIMIT};
pub use ops::{ConflictChoice, ConflictSides, PushTarget, RepoState, ResetMode, StashEntry};
pub use status::{ChangeKind, CommitOutcome, FileChange, GitStamp};
pub use text_diff::{diff_texts, line_changes_between};

#[derive(Debug)]
pub enum Error {
    Git(git2::Error),
    Io(std::io::Error),
    /// A git CLI command exited with a non-zero status. The outcome holds stderr for the UI.
    Command(CommandOutcome),
    /// The command was stopped because the caller's cancel flag was set (`CancelScope`).
    Cancelled { command: String },
    /// The command ran longer than its limit and was stopped.
    Timeout { command: String, after: Duration },
    Other(String),
}

/// The text every cancelled command reports. The app recognises it and shows one
/// "Cancelled" toast instead of an error.
pub const CANCELLED: &str = "cancelled by the user";

impl Error {
    pub fn is_cancelled(&self) -> bool {
        matches!(self, Error::Cancelled { .. })
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Git(e) => write!(f, "git: {}", e.message()),
            Error::Io(e) => write!(f, "io: {e}"),
            Error::Command(o) => {
                let msg = o.stderr.trim();
                let msg = if msg.is_empty() { o.stdout.trim() } else { msg };
                write!(f, "`{}` failed: {}", o.command, msg)
            }
            Error::Cancelled { command } => write!(f, "`{command}` {CANCELLED}"),
            Error::Timeout { command, after } => write!(
                f,
                "`{command}` did not finish in {} s and was stopped. If git does not even start, macOS may be scanning new binaries (syspolicyd).",
                after.as_secs()
            ),
            Error::Other(s) => f.write_str(s),
        }
    }
}

impl std::error::Error for Error {}

impl From<git2::Error> for Error {
    fn from(e: git2::Error) -> Self {
        Error::Git(e)
    }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Io(e)
    }
}

pub type Result<T> = std::result::Result<T, Error>;

/// A handle to a repository's working tree.
///
/// It stores only paths. `git2::Repository` is not `Sync`, so every call opens its own
/// handle; opening costs well under a millisecond, and the `Repo` can then be shared freely
/// between worker threads.
#[derive(Debug, Clone)]
pub struct Repo {
    workdir: PathBuf,
    /// Where CLI runs are reported. Clones share it, so ids stay unique across workers.
    sink: Option<Arc<CommandSink>>,
    /// The git binary for this handle; `None` uses the global lookup (`HARWEX_GIT`, PATH).
    git: Option<PathBuf>,
    /// Replaces every per-command time limit (tests).
    timeout: Option<Duration>,
}

#[derive(Debug)]
struct CommandSink {
    tx: Sender<CommandEvent>,
    next_id: AtomicU64,
}

// The app moves a `Repo` into worker threads.
const _: fn() = || {
    fn check<T: Send + Sync>() {}
    check::<Repo>();
};

impl Repo {
    /// Finds the repository that contains `path`. Bare repositories are rejected because the
    /// IDE always works on a checkout.
    pub fn discover(path: &Path) -> Result<Repo> {
        let repo = git2::Repository::discover(path)?;
        let workdir = repo
            .workdir()
            .ok_or_else(|| Error::Other("bare repositories are not supported".into()))?;
        // Canonical form, so that absolute paths from the app (which may come through a
        // symlink such as /var -> /private/var on macOS) can be made relative reliably.
        let workdir = workdir.canonicalize().unwrap_or_else(|_| workdir.to_path_buf());
        Ok(Repo { workdir, sink: None, git: None, timeout: None })
    }

    /// Reports every git CLI command of this handle and its clones (start and finish) to
    /// `tx`. Clone the `Repo` after this call so workers share the sink. Reads through
    /// libgit2 are not commands and are not reported.
    pub fn set_command_sink(&mut self, tx: Sender<CommandEvent>) {
        self.sink = Some(Arc::new(CommandSink { tx, next_id: AtomicU64::new(1) }));
    }

    /// Builder form of `set_command_sink`.
    pub fn with_command_sink(mut self, tx: Sender<CommandEvent>) -> Repo {
        self.set_command_sink(tx);
        self
    }

    /// Runs `git` from `program` instead of the global lookup (tests use a fake git).
    pub fn with_git_binary(mut self, program: impl Into<PathBuf>) -> Repo {
        self.git = Some(program.into());
        self
    }

    /// One time limit for every command of this handle, instead of the per-command defaults.
    pub fn with_timeout(mut self, limit: Duration) -> Repo {
        self.timeout = Some(limit);
        self
    }

    pub fn workdir(&self) -> &Path {
        &self.workdir
    }

    pub(crate) fn open(&self) -> Result<git2::Repository> {
        Ok(git2::Repository::open(&self.workdir)?)
    }

    /// Turns an absolute or workdir-relative path into a workdir-relative one.
    pub(crate) fn rel(&self, path: &Path) -> PathBuf {
        if !path.is_absolute() {
            return normalize(path);
        }
        if let Ok(r) = path.strip_prefix(&self.workdir) {
            return normalize(r);
        }
        // The file may be deleted, so canonicalize the deepest existing ancestor instead.
        let mut existing = path;
        let mut tail = Vec::new();
        while let Some(parent) = existing.parent() {
            if let Some(name) = existing.file_name() {
                tail.push(name.to_os_string());
            }
            existing = parent;
            if let Ok(canon) = existing.canonicalize() {
                if let Ok(r) = canon.strip_prefix(&self.workdir) {
                    let mut out = r.to_path_buf();
                    for part in tail.iter().rev() {
                        out.push(part);
                    }
                    return normalize(&out);
                }
                break;
            }
        }
        normalize(path)
    }

    pub(crate) fn abs(&self, rel: &Path) -> PathBuf {
        self.workdir.join(rel)
    }
}

fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// libgit2 wants '/'-separated repository paths.
pub(crate) fn git_path(rel: &Path) -> String {
    let s = rel.to_string_lossy();
    if std::path::MAIN_SEPARATOR == '/' {
        s.into_owned()
    } else {
        s.replace(std::path::MAIN_SEPARATOR, "/")
    }
}

/// Text of a blob or file as shown to the user. Invalid UTF-8 is replaced instead of failing,
/// so a Latin-1 file still opens in the diff viewer.
pub(crate) fn bytes_to_text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

/// Same heuristic as git: a NUL byte in the first 8000 bytes means binary.
pub(crate) fn is_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8000).any(|&b| b == 0)
}
