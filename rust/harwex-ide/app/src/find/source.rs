//! Where a text search reads a file. The search asks only for the bytes of a path; the caller
//! decides whether they come from the disk or from somewhere else.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Files above this size are skipped on disk.
pub const MAX_FILE: u64 = 4 * 1024 * 1024;

/// The text of a path, for a search on a worker thread.
pub trait TextSource: Send + Sync {
    /// The bytes of `path`, or `None` when it is no searchable file (missing, a folder, too big,
    /// binary on disk).
    fn read(&self, path: &Path) -> Option<Vec<u8>>;
}

/// Reads the disk.
#[derive(Clone, Copy, Debug, Default)]
pub struct Disk;

/// The first block of a file decides whether it is binary (a NUL byte in it).
pub const PROBE: usize = 8000;

impl TextSource for Disk {
    /// One open, one `fstat` and the reads. A binary file costs one small read: the search
    /// skips it anyway, and a big tree holds many images and archives.
    fn read(&self, path: &Path) -> Option<Vec<u8>> {
        use std::io::Read;
        if is_binary_name(path) {
            return None;
        }
        let mut options = std::fs::OpenOptions::new();
        options.read(true);
        // A FIFO must not block the open; a regular file ignores the flag.
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::custom_flags(&mut options, libc::O_NONBLOCK);
        let mut file = options.open(path).ok()?;
        let meta = file.metadata().ok()?;
        if !meta.is_file() || meta.len() > MAX_FILE {
            return None;
        }
        let mut bytes = Vec::with_capacity(meta.len() as usize + 1);
        (&mut file).take(PROBE as u64).read_to_end(&mut bytes).ok()?;
        if memchr::memchr(0, &bytes).is_some() {
            return None;
        }
        file.read_to_end(&mut bytes).ok()?;
        Some(bytes)
    }
}

/// File types that are always binary. The search skips them without an open: a big tree holds
/// tens of thousands of images.
const BINARY_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "ico", "icns", "bmp", "tiff", "psd", "zip", "jar", "gz", "tgz", "bz2", "xz", "7z", "rar", "woff", "woff2", "ttf",
    "otf", "eot", "pdf", "mp3", "mp4", "mov", "wav", "ogg", "class", "so", "dylib", "dll", "exe", "a", "o", "rlib", "wasm", "bin", "fbx", "blend", "uasset",
    "umap",
];

fn is_binary_name(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.len() <= 7 && BINARY_EXTENSIONS.iter().any(|b| e.eq_ignore_ascii_case(b)))
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
