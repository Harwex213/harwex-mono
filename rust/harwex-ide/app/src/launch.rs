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
    let from_terminal = !launcher_cwd(cwd) || tty;
    from_terminal.then(|| cwd.to_path_buf())
}

/// Whether `cwd` is the directory a launcher starts apps in, not one the user picked.
#[cfg(not(windows))]
fn launcher_cwd(cwd: &Path) -> bool {
    cwd == Path::new("/")
}

/// Explorer and Start-menu shortcuts start an app in its own folder, some launchers in
/// `System32`. The release build has no console, so the TTY check never helps there.
#[cfg(windows)]
fn launcher_cwd(cwd: &Path) -> bool {
    let exe_dir = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf));
    let system_root = std::env::var_os("SystemRoot").map(PathBuf::from);
    is_launcher_dir(cwd, exe_dir.as_deref(), system_root.as_deref())
}

#[cfg_attr(not(any(windows, test)), allow(dead_code))]
fn is_launcher_dir(cwd: &Path, exe_dir: Option<&Path>, system_root: Option<&Path>) -> bool {
    let same = |a: &Path, b: &Path| a.to_string_lossy().eq_ignore_ascii_case(&b.to_string_lossy());
    cwd.parent().is_none() || exe_dir.is_some_and(|d| same(cwd, d)) || system_root.is_some_and(|r| cwd.starts_with(r) || same(cwd, r))
}

/// The folder as the running instance must see it: canonical when it exists, else made
/// absolute against `cwd`. The new process is not the UI thread, so it may block on the disk.
pub fn handoff_folder(folder: &Path, cwd: Option<&Path>) -> PathBuf {
    if let Ok(real) = dunce::canonicalize(folder) {
        return real;
    }
    match cwd {
        Some(cwd) if folder.is_relative() => cwd.join(folder),
        _ => folder.to_path_buf(),
    }
}

/// `--new-instance` starts a separate IDE even when one already runs.
pub fn take_new_instance_flag(args: &mut Vec<String>) -> bool {
    let before = args.len();
    args.retain(|a| a != "--new-instance");
    args.len() != before
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
    fn new_instance_flag_is_removed() {
        let mut a = args(&["--new-instance", "dir"]);
        assert!(take_new_instance_flag(&mut a));
        assert_eq!(a, args(&["dir"]));
        assert!(!take_new_instance_flag(&mut a));
    }

    #[test]
    fn handoff_folder_is_absolute() {
        let tmp = std::env::temp_dir();
        let real = dunce::canonicalize(&tmp).expect("canonical temp dir");
        assert_eq!(handoff_folder(&tmp, None), real);
        assert_eq!(handoff_folder(Path::new("no/such/dir"), Some(Path::new("/work"))), PathBuf::from("/work/no/such/dir"));
    }

    #[test]
    fn windows_launch_dirs() {
        let (exe, sys) = (Path::new("/apps/harwex"), Path::new("/win"));
        assert!(is_launcher_dir(Path::new("/"), Some(exe), Some(sys)));
        assert!(is_launcher_dir(Path::new("/apps/harwex"), Some(exe), Some(sys)));
        assert!(is_launcher_dir(Path::new("/win/System32"), Some(exe), Some(sys)));
        assert!(!is_launcher_dir(Path::new("/work/project"), Some(exe), Some(sys)));
        assert!(!is_launcher_dir(Path::new("/work/project"), None, None));
    }

    #[test]
    fn unknown_cwd_falls_back() {
        assert_eq!(startup_folder(&[], None, true), None);
    }
}
