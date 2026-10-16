//! Small OS differences that many modules share: the home directory, executable names and
//! the PATH of a child process. Bigger platform code lives with its feature (`fileops`,
//! `memory`, `instance`).

use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// What the system calls its deleted-files folder, for menu and dialog text.
pub const TRASH: &str = if cfg!(windows) { "Recycle Bin" } else { "Trash" };

/// The system file manager, for "Open In ..." and its errors.
pub const FILE_MANAGER: &str = if cfg!(target_os = "macos") { "Finder" } else if cfg!(windows) { "Explorer" } else { "File Manager" };

/// The user's home: `HOME`, else `USERPROFILE` (Windows sets only that one).
pub fn home_dir() -> Option<PathBuf> {
    ["HOME", "USERPROFILE"].iter().filter_map(std::env::var_os).find(|v| !v.is_empty()).map(PathBuf::from)
}

/// The file name of an executable: `name.exe` on Windows.
pub fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// This process's PATH with `dir` in front, joined with the OS separator (`;` on Windows).
pub fn prepend_path(dir: &Path) -> OsString {
    let mut parts = vec![dir.to_path_buf()];
    if let Some(path) = std::env::var_os("PATH") {
        parts.extend(std::env::split_paths(&path));
    }
    std::env::join_paths(parts).unwrap_or_default()
}

/// `prepend_path` for configs that hold env values as strings (`ClientConfig::env`).
pub fn prepend_path_string(dir: &Path) -> String {
    prepend_path(dir).to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepend_uses_the_os_separator() {
        let dir = std::env::temp_dir();
        let joined = prepend_path_string(&dir);
        let first = std::env::split_paths(&joined).next().unwrap();
        assert_eq!(first, dir);
        assert!(exe("node").starts_with("node"));
    }
}
