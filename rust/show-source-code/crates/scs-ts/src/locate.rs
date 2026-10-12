//! Finding `node` and the workspace's `tsserver.js`.
//!
//! A macOS app started outside a terminal gets a minimal PATH, so node installed by nvm or
//! Homebrew is invisible to a plain PATH lookup. The search also asks the login shell and probes
//! the usual install locations.

use std::env;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, Instant};

const TSSERVER_REL: &str = "node_modules/typescript/lib/tsserver.js";

/// `node`, found once per process: the search may spawn a shell.
pub fn find_node() -> Option<PathBuf> {
    static NODE: OnceLock<Option<PathBuf>> = OnceLock::new();
    NODE.get_or_init(search_node).clone()
}

/// The first `node_modules/typescript/lib/tsserver.js` walking up from `dir`.
pub fn find_tsserver(dir: &Path) -> Option<PathBuf> {
    dir.ancestors().map(|d| d.join(TSSERVER_REL)).find(|p| p.is_file())
}

fn search_node() -> Option<PathBuf> {
    if let Some(path) = env::var_os("SCS_NODE").map(PathBuf::from) {
        if is_executable(&path) {
            return Some(path);
        }
    }
    if let Some(path) = env::var_os("PATH").and_then(|p| env::split_paths(&p).map(|d| d.join("node")).find(|p| is_executable(p))) {
        return Some(path);
    }
    // `-l` alone skips .zshrc, where nvm usually lives, hence the interactive retry.
    if let Ok(shell) = env::var("SHELL") {
        for flags in ["-lc", "-ilc"] {
            let mut cmd = Command::new(&shell);
            cmd.arg(flags).arg("command -v node");
            if let Some(out) = run_with_timeout(cmd, Duration::from_secs(5)) {
                // Interactive shells may print banners; the answer is the last absolute path.
                if let Some(p) = out.lines().rev().map(str::trim).filter(|l| l.starts_with('/')).map(PathBuf::from).find(|p| is_executable(p)) {
                    return Some(p);
                }
            }
        }
    }
    let home = env::var_os("HOME").map(PathBuf::from);
    if let Some(p) = home.as_deref().and_then(newest_nvm_node) {
        return Some(p);
    }
    let mut fixed = vec![PathBuf::from("/opt/homebrew/bin/node"), PathBuf::from("/usr/local/bin/node")];
    if let Some(home) = &home {
        fixed.push(home.join(".volta/bin/node"));
    }
    fixed.into_iter().find(|p| is_executable(p))
}

fn newest_nvm_node(home: &Path) -> Option<PathBuf> {
    let mut versions: Vec<(Vec<u64>, PathBuf)> = std::fs::read_dir(home.join(".nvm/versions/node"))
        .ok()?
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let key = name.trim_start_matches('v').split('.').map(|n| n.parse().unwrap_or(0)).collect();
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
        path.metadata().map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

/// A hung login shell must not hang the lookup, so the command is killed after `timeout`.
fn run_with_timeout(mut cmd: Command, timeout: Duration) -> Option<String> {
    let mut child = cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
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
