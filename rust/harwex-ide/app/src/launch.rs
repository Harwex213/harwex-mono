//! Which folder to open at startup. `main.rs` gathers the facts (arguments, cwd, TTY); the
//! decision is a pure function so it can be tested without starting a process.

use std::path::{Path, PathBuf};

/// The folder to open, or `None` to fall back to the stored last folder.
///
/// - An explicit path argument always wins.
/// - Started from a terminal, the IDE opens the current directory. A start counts as "from a
///   terminal" when the cwd is not `/` or when stdin/stdout is a TTY.
/// - Spotlight, the Dock and Finder start apps with cwd `/` and no TTY. Then the IDE reopens the
///   last folder.
///
/// `args` are the arguments after the program name, with the hidden test hooks already removed.
/// Flags (`--x`) and the `-psn_...` process serial number older macOS versions pass to apps are
/// not paths.
pub fn startup_folder(args: &[String], cwd: Option<&Path>, tty: bool) -> Option<PathBuf> {
    if let Some(arg) = args.iter().find(|a| !a.starts_with('-')) {
        return Some(PathBuf::from(arg));
    }
    let cwd = cwd?;
    let from_terminal = cwd != Path::new("/") || tty;
    from_terminal.then(|| cwd.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn explicit_path_wins() {
        let got = startup_folder(&args(&["/work/other"]), Some(Path::new("/work/here")), true);
        assert_eq!(got, Some(PathBuf::from("/work/other")));
        let got = startup_folder(&args(&["rel/dir"]), Some(Path::new("/")), false);
        assert_eq!(got, Some(PathBuf::from("rel/dir")));
    }

    #[test]
    fn terminal_start_opens_cwd() {
        assert_eq!(startup_folder(&[], Some(Path::new("/work/here")), false), Some(PathBuf::from("/work/here")));
        assert_eq!(startup_folder(&[], Some(Path::new("/work/here")), true), Some(PathBuf::from("/work/here")));
        // `cd / && harwex-ide` in a terminal: the TTY says it is a terminal start.
        assert_eq!(startup_folder(&[], Some(Path::new("/")), true), Some(PathBuf::from("/")));
    }

    #[test]
    fn spotlight_start_reopens_last_folder() {
        assert_eq!(startup_folder(&[], Some(Path::new("/")), false), None);
        // The process serial number is not a folder.
        assert_eq!(startup_folder(&args(&["-psn_0_12345"]), Some(Path::new("/")), false), None);
    }

    #[test]
    fn flags_are_not_paths() {
        assert_eq!(startup_folder(&args(&["--verbose"]), Some(Path::new("/work")), false), Some(PathBuf::from("/work")));
    }

    #[test]
    fn unknown_cwd_falls_back() {
        assert_eq!(startup_folder(&[], None, true), None);
    }
}
