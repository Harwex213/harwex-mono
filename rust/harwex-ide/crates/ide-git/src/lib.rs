//! Git logic for harwex-ide. No UI.
//!
//! Reads go through libgit2 (`git2`) because it is fast and needs no child process.
//! Anything that writes the index or the worktree, and every network operation, goes through
//! the `git` CLI. The CLI runs hooks, credential helpers, SSH agents and clean/smudge filters
//! (git-lfs), which libgit2 would silently skip and so corrupt LFS files or bypass hooks.
//!
//! Every function blocks. The app calls them from a worker thread.

mod branches;
mod cli;
mod diff;
mod graph;
mod log;
mod ops;
mod status;
mod text_diff;

use std::fmt;
use std::path::{Component, Path, PathBuf};

pub use git2::Oid;

pub use branches::{BranchInfo, Branches};
pub use cli::CommandOutcome;
pub use diff::{DiffHunk, DiffSide, FileDiff, LineChange, LineChangeKind, LineKind, LinePair};
pub use graph::{layout as graph_layout, GraphEdge, GraphRow};
pub use log::{BlameLine, ChangedFile, CommitDetails, CommitInfo, LogFilter, RefKind, RefLabel};
pub use ops::{ConflictChoice, ConflictSides, RepoState, ResetMode, StashEntry};
pub use status::{ChangeKind, CommitOutcome, FileChange};
pub use text_diff::{diff_texts, line_changes_between};

#[derive(Debug)]
pub enum Error {
    Git(git2::Error),
    Io(std::io::Error),
    /// A git CLI command exited with a non-zero status. The outcome holds stderr for the UI.
    Command(CommandOutcome),
    Other(String),
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
        Ok(Repo { workdir })
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
