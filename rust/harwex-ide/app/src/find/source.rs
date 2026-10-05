//! Where a text search reads a file. The search asks only for the bytes of a path; the caller
//! decides whether they come from the disk or from somewhere else.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Files above this size are skipped on disk.
pub const MAX_FILE: u64 = 4 * 1024 * 1024;

/// The text of a path, for a search on a worker thread.
pub trait TextSource: Send + Sync {
    /// The bytes of `path`, or `None` when it is no searchable file (missing, a folder, too big).
    fn read(&self, path: &Path) -> Option<Vec<u8>>;
}

/// Reads the disk.
#[derive(Clone, Copy, Debug, Default)]
pub struct Disk;

impl TextSource for Disk {
    fn read(&self, path: &Path) -> Option<Vec<u8>> {
        let meta = path.metadata().ok()?;
        if !meta.is_file() || meta.len() > MAX_FILE {
            return None;
        }
        std::fs::read(path).ok()
    }
}

/// Text that is turned into a string only on the worker (a rope clone, for example).
pub type Snapshot = Box<dyn Fn() -> String + Send + Sync>;

/// Some paths read from snapshots, every other path from the disk.
#[derive(Default)]
pub struct Overlay {
    texts: HashMap<PathBuf, Snapshot>,
}

impl Overlay {
    pub fn new(texts: impl IntoIterator<Item = (PathBuf, Snapshot)>) -> Overlay {
        Overlay { texts: texts.into_iter().collect() }
    }
}

impl TextSource for Overlay {
    fn read(&self, path: &Path) -> Option<Vec<u8>> {
        match self.texts.get(path) {
            Some(text) => Some(text().into_bytes()),
            None => Disk.read(path),
        }
    }
}
