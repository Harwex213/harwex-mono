//! Finding `node` and `tsserver.js`.
//!
//! A macOS GUI app starts with a minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), so `node`
//! installed by nvm or Homebrew is invisible to a plain PATH lookup. The lookup therefore also
//! asks the user's login shell and probes the usual install locations.

use std::env;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, Instant};

const TSSERVER_REL: &str = "node_modules/typescript/lib/tsserver.js";

/// `node`, found once per process. The search spawns a shell, so it must not repeat.
pub fn find_node() -> Option<PathBuf> {
    static NODE: OnceLock<Option<PathBuf>> = OnceLock::new();
    NODE.get_or_init(search_node).clone()
}

fn search_node() -> Option<PathBuf> {
    // An explicit override wins, so a user with an unusual setup is never stuck.
    if let Some(path) = env::var_os("HARWEX_NODE").map(PathBuf::from) {
        if is_executable(&path) {
            return Some(path);
        }
    }
    if let Some(path) = search_path("node") {
        return Some(path);
    }
    // The login shell knows the user's chosen node (nvm default, asdf, volta shims).
    // `-l` alone skips .zshrc, where nvm usually lives, hence the interactive retry.
    if let Ok(shell) = env::var("SHELL") {
        for flags in ["-lc", "-ilc"] {
            if let Some(path) = shell_lookup(&shell, flags) {
                return Some(path);
            }
        }
    }
    let home = env::var_os("HOME").map(PathBuf::from);
    if let Some(home) = &home {
        if let Some(path) = newest_nvm_node(home) {
            return Some(path);
        }
    }
    let mut fixed = vec![
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
    ];
    if let Some(home) = &home {
        fixed.push(home.join(".volta/bin/node"));
    }
    fixed.into_iter().find(|p| is_executable(p))
}

fn search_path(name: &str) -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    env::split_paths(&path)
        .map(|dir| dir.join(name))
        .find(|p| is_executable(p))
}

fn shell_lookup(shell: &str, flags: &str) -> Option<PathBuf> {
    let mut cmd = Command::new(shell);
    cmd.arg(flags).arg("command -v node");
    let out = run_with_timeout(cmd, Duration::from_secs(5))?;
    // Interactive shells may print banners; the answer is the last absolute path.
    out.lines()
        .rev()
        .map(str::trim)
        .filter(|l| l.starts_with('/'))
        .map(PathBuf::from)
        .find(|p| is_executable(p))
}

fn newest_nvm_node(home: &Path) -> Option<PathBuf> {
    let dir = home.join(".nvm/versions/node");
    let mut versions: Vec<(Vec<u64>, PathBuf)> = std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let key = name
                .trim_start_matches('v')
                .split('.')
                .map(|n| n.parse().unwrap_or(0))
                .collect();
            let node = e.path().join("bin/node");
            is_executable(&node).then_some((key, node))
        })
        .collect();
    versions.sort();
    versions.pop().map(|(_, p)| p)
}

fn is_executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

/// Runs a short helper command and returns its stdout. A hung login shell must not hang
/// the IDE, so the command is killed after `timeout`.
fn run_with_timeout(mut cmd: Command, timeout: Duration) -> Option<String> {
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = thread::spawn(move || {
        let mut s = String::new();
        let _ = stdout.read_to_string(&mut s);
        s
    });
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let out = reader.join().ok()?;
                return status.success().then_some(out);
            }
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

/// The first `node_modules/typescript/lib/tsserver.js` walking up from `dir`.
pub fn find_local_tsserver(dir: &Path) -> Option<PathBuf> {
    dir.ancestors()
        .map(|d| d.join(TSSERVER_REL))
        .find(|p| p.is_file())
}

/// A globally installed `typescript`, found once through `npm root -g`.
pub fn find_global_tsserver() -> Option<PathBuf> {
    static GLOBAL: OnceLock<Option<PathBuf>> = OnceLock::new();
    GLOBAL
        .get_or_init(|| {
            // Prefer the npm next to the node we run, for the same GUI PATH reason as above.
            let npm = find_node()
                .and_then(|n| n.parent().map(|d| d.join("npm")))
                .filter(|p| is_executable(p))
                .unwrap_or_else(|| PathBuf::from("npm"));
            let mut cmd = Command::new(npm);
            cmd.args(["root", "-g"]);
            if let Some(dir) = find_node().and_then(|n| n.parent().map(Path::to_path_buf)) {
                cmd.env("PATH", prepend_path(&dir));
            }
            let root = run_with_timeout(cmd, Duration::from_secs(10))?;
            let path = PathBuf::from(root.trim()).join("typescript/lib/tsserver.js");
            path.is_file().then_some(path)
        })
        .clone()
}

/// PATH with `dir` in front, so scripts with a `#!/usr/bin/env node` shebang find our node.
pub(crate) fn prepend_path(dir: &Path) -> std::ffi::OsString {
    let mut parts = vec![dir.to_path_buf()];
    if let Some(path) = env::var_os("PATH") {
        parts.extend(env::split_paths(&path));
    }
    env::join_paths(parts).unwrap_or_default()
}

/// The directory that owns `node_modules/typescript`, used as tsserver's project root.
pub(crate) fn project_root_of(tsserver_js: &Path) -> Option<PathBuf> {
    // .../<root>/node_modules/typescript/lib/tsserver.js
    let root = tsserver_js.ancestors().nth(4)?;
    (tsserver_js.ancestors().nth(3)?.file_name()? == "node_modules").then(|| root.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn walks_up_to_nearest_typescript() {
        let tmp = tempfile::tempdir().unwrap();
        let lib = tmp.path().join("node_modules/typescript/lib");
        std::fs::create_dir_all(&lib).unwrap();
        std::fs::write(lib.join("tsserver.js"), "").unwrap();
        let deep = tmp.path().join("packages/a/src");
        std::fs::create_dir_all(&deep).unwrap();
        let found = find_local_tsserver(&deep).unwrap();
        assert_eq!(found, lib.join("tsserver.js"));
        assert_eq!(project_root_of(&found).unwrap(), tmp.path());
    }

    #[test]
    fn global_root_without_node_modules_has_no_project_root() {
        let p = Path::new("/usr/lib/typescript/lib/tsserver.js");
        assert_eq!(project_root_of(p), None);
    }
}
