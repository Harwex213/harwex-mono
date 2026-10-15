//! Backups before a save (Settings › System › Files › "Back up files before saving"): the
//! previous version of a file goes into `<backup dir>/<hash of path>/<millis>-<name>`.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// A file larger than this gets no backup.
pub const BACKUP_MAX_BYTES: u64 = 1 << 20;
/// Backups kept per file; the oldest go first.
pub const BACKUPS_PER_FILE: usize = 5;
/// A file's backups that are all older than this are removed at startup.
pub const BACKUP_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 3600);
/// The file in a backup folder that names the original path.
pub(crate) const ORIGIN_FILE: &str = "origin";

/// Copies the current content of `path` into `<dir>/<hash of path>/<millis>-<name>` unless the
/// file is missing, bigger than `BACKUP_MAX_BYTES`, or already holds `new`. Keeps the newest
/// `BACKUPS_PER_FILE`. Returns the backup's path.
pub fn backup(dir: &Path, path: &Path, new: &[u8]) -> std::io::Result<Option<PathBuf>> {
    let Ok(meta) = std::fs::metadata(path) else { return Ok(None) };
    if !meta.is_file() || meta.len() > BACKUP_MAX_BYTES {
        return Ok(None);
    }
    let old = std::fs::read(path)?;
    if old == new {
        return Ok(None);
    }
    let folder = backup_folder(dir, path);
    std::fs::create_dir_all(&folder)?;
    let origin = folder.join(ORIGIN_FILE);
    if !origin.exists() {
        std::fs::write(&origin, path.display().to_string())?;
    }
    let millis = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_millis());
    let name = path.file_name().map_or_else(|| "file".into(), |n| n.to_string_lossy().into_owned());
    // Two saves in one millisecond get distinct names; the order stays by name.
    let mut n = 0;
    let target = loop {
        let t = folder.join(format!("{millis:014}-{n:02}-{name}"));
        if !t.exists() {
            break t;
        }
        n += 1;
    };
    std::fs::write(&target, &old)?;
    let mut kept = backups_of(&folder);
    while kept.len() > BACKUPS_PER_FILE {
        let _ = std::fs::remove_file(kept.remove(0));
    }
    Ok(Some(target))
}

/// The backup folder of one file: a stable FNV-1a hash of its path.
pub fn backup_folder(dir: &Path, path: &Path) -> PathBuf {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in path.as_os_str().as_encoded_bytes() {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    dir.join(format!("{h:016x}"))
}

/// The backups in one file's folder, oldest first.
pub fn backups_of(folder: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = std::fs::read_dir(folder).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.file_name().is_some_and(|n| n != ORIGIN_FILE)).collect();
    out.sort();
    out
}

/// Removes the folders of files whose newest backup is older than `max_age`. Blocking.
pub fn prune_backups(dir: &Path, max_age: Duration) {
    let now = SystemTime::now();
    for folder in std::fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.is_dir()) {
        let newest = backups_of(&folder).iter().filter_map(|p| p.metadata().and_then(|m| m.modified()).ok()).max();
        if newest.is_none_or(|t| now.duration_since(t).unwrap_or_default() > max_age) {
            let _ = std::fs::remove_dir_all(&folder);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::save::write_file;

    #[test]
    fn backups_keep_the_previous_versions() {
        let root = std::env::temp_dir().join(format!("harwex-save-backups-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let dir = root.join("backups");
        let file = root.join("a.txt");
        // A new file has no previous version.
        write_file(&file, b"v0", Some(&dir)).unwrap();
        assert!(!dir.exists());
        for i in 1..=7 {
            write_file(&file, format!("v{i}").as_bytes(), Some(&dir)).unwrap();
        }
        // The same text again makes no backup.
        write_file(&file, b"v7", Some(&dir)).unwrap();
        let folder = backup_folder(&dir, &file);
        let kept: Vec<String> = backups_of(&folder).iter().map(|p| std::fs::read_to_string(p).unwrap()).collect();
        assert_eq!(kept, ["v2", "v3", "v4", "v5", "v6"]);
        assert_eq!(std::fs::read_to_string(folder.join(ORIGIN_FILE)).unwrap(), file.display().to_string());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "v7");
        // A big file gets none.
        let big = root.join("big.bin");
        std::fs::write(&big, vec![b'x'; BACKUP_MAX_BYTES as usize + 1]).unwrap();
        assert_eq!(backup(&dir, &big, b"small").unwrap(), None);
        prune_backups(&dir, Duration::from_secs(3600));
        assert!(folder.exists(), "fresh backups stay");
        prune_backups(&dir, Duration::ZERO);
        assert!(!folder.exists(), "old backups go");
        let _ = std::fs::remove_dir_all(&root);
    }
}
