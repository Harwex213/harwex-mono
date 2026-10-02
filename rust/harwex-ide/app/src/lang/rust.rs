//! Rust through rust-analyzer, one process per Cargo workspace (rule 6).
//!
//! - Locating: `rust.server` in `.harwex/ide.toml` (no fallback when set), else
//!   `HARWEX_RUST_ANALYZER`, `PATH`, `~/.cargo/bin`, then `rustup which rust-analyzer`. Each candidate must answer
//!   `--version`: the rustup proxy exists even when the component is not installed.
//! - Root: the topmost `Cargo.toml` with `[workspace]` above the file, else the nearest
//!   `Cargo.toml`. Dependency sources (`~/.cargo/registry`, `rust-src`) belong to the server
//!   that jumped there, so opening one never starts a server for a registry crate.
//! - Loading: rust-analyzer answers before its workspace is loaded, with empty results or
//!   "content modified". Requests retry while it reports `quiescent: false`
//!   (`experimental/serverStatus`) instead of saying "no definition" at once.

use std::collections::{BTreeSet, HashMap};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use ide_lsp::{default_capabilities, ClientConfig, LspClient};
use serde_json::{json, Value};

use super::config::{IdeConfig, RustConfig};
use super::{is_library_path, lock, HoverInfo, LangId, LanguageServer, Location, Reference};
use crate::nav::NavKind;

/// How long a request may take in total, retries while loading included. The first request
/// in a big workspace waits for `cargo metadata`, which can take seconds.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const INSTALL_HINT: &str = "Install it with `rustup component add rust-analyzer`, or set `server` under [rust] in .harwex/ide.toml.";

/// `$CARGO_HOME`, else `~/.cargo`.
pub fn cargo_home() -> Option<PathBuf> {
    if let Some(h) = std::env::var_os("CARGO_HOME") {
        return Some(PathBuf::from(h));
    }
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".cargo"))
}

/// Finds a working rust-analyzer. `Err` lists what was tried. Blocking (runs `--version`).
pub fn find_rust_analyzer(configured: Option<&Path>) -> Result<PathBuf, String> {
    let mut notes = Vec::new();
    let mut tried: Vec<PathBuf> = Vec::new();
    let mut check = |p: PathBuf, notes: &mut Vec<String>| -> Option<PathBuf> {
        if tried.contains(&p) {
            return None;
        }
        tried.push(p.clone());
        if !p.is_file() {
            return None;
        }
        match run_version(&p) {
            Ok(_) => Some(p),
            Err(e) => {
                notes.push(format!("{}: {e}", p.display()));
                None
            }
        }
    };
    if let Some(p) = configured {
        // An explicit path wins and has no fallback: silently running another binary would
        // hide the typo.
        if let Some(found) = check(p.to_path_buf(), &mut notes) {
            return Ok(found);
        }
        let why = notes.pop().unwrap_or_else(|| "no such file".into());
        return Err(format!("rust-analyzer was not found: rust.server in .harwex/ide.toml is {} ({why}). {INSTALL_HINT}", p.display()));
    }
    if let Some(p) = std::env::var_os("HARWEX_RUST_ANALYZER") {
        if let Some(found) = check(PathBuf::from(p), &mut notes) {
            return Ok(found);
        }
    }
    for dir in std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()) {
        if let Some(found) = check(dir.join("rust-analyzer"), &mut notes) {
            return Ok(found);
        }
    }
    let cargo_bin = cargo_home().map(|h| h.join("bin"));
    if let Some(bin) = &cargo_bin {
        if let Some(found) = check(bin.join("rust-analyzer"), &mut notes) {
            return Ok(found);
        }
    }
    let rustup = cargo_bin.map(|b| b.join("rustup")).filter(|p| p.is_file()).unwrap_or_else(|| PathBuf::from("rustup"));
    match output(Command::new(&rustup).args(["which", "rust-analyzer"])) {
        Ok(out) => {
            let p = PathBuf::from(out.trim());
            if let Some(found) = check(p, &mut notes) {
                return Ok(found);
            }
        }
        Err(e) => notes.push(format!("rustup which rust-analyzer: {e}")),
    }
    if notes.is_empty() {
        notes.push("not on PATH or in ~/.cargo/bin".into());
    }
    Err(format!("rust-analyzer was not found. {INSTALL_HINT}\n\nSearched: {}", notes.join("; ")))
}

fn run_version(exe: &Path) -> Result<String, String> {
    let out = output(Command::new(exe).arg("--version"))?;
    if out.starts_with("rust-analyzer") {
        Ok(out.trim().to_string())
    } else {
        Err(format!("unexpected --version output {:?}", out.trim()))
    }
}

/// Runs a short command with a 10 s limit and returns its stdout. A failure returns the
/// first stderr line, which is where rustup explains a missing component.
fn output(cmd: &mut Command) -> Result<String, String> {
    let mut child = cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(10);
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("timed out".into());
            }
        }
    };
    let mut stdout = String::new();
    let mut stderr = String::new();
    if let Some(mut s) = child.stdout.take() {
        let _ = s.read_to_string(&mut stdout);
    }
    if let Some(mut s) = child.stderr.take() {
        let _ = s.read_to_string(&mut stderr);
    }
    if status.success() {
        Ok(stdout)
    } else {
        Err(stderr.lines().next().unwrap_or("failed").trim().to_string())
    }
}

/// The Cargo workspace root of a file: the topmost directory above it whose `Cargo.toml` has
/// a `[workspace]` table, else the nearest directory with a `Cargo.toml`.
pub fn workspace_root(file: &Path) -> Option<PathBuf> {
    let mut nearest = None;
    let mut workspace = None;
    for dir in file.ancestors().skip(1) {
        let manifest = dir.join("Cargo.toml");
        if !manifest.is_file() {
            continue;
        }
        if nearest.is_none() {
            nearest = Some(dir.to_path_buf());
        }
        let has_workspace = std::fs::read_to_string(&manifest)
            .ok()
            .and_then(|t| t.parse::<toml::Table>().ok())
            .is_some_and(|t| t.contains_key("workspace"));
        if has_workspace {
            workspace = Some(dir.to_path_buf());
        }
    }
    workspace.or(nearest)
}

/// Why jumps into the standard library cannot work, if they cannot: rust-analyzer needs
/// the `rust-src` component (or `RUST_SRC_PATH`).
pub fn rust_src_missing() -> Option<String> {
    if let Some(p) = std::env::var_os("RUST_SRC_PATH") {
        return (!Path::new(&p).is_dir()).then(|| format!("RUST_SRC_PATH={} does not exist.", Path::new(&p).display()));
    }
    let rustc = cargo_home().map(|h| h.join("bin/rustc")).filter(|p| p.is_file()).unwrap_or_else(|| PathBuf::from("rustc"));
    let sysroot = output(Command::new(rustc).args(["--print", "sysroot"])).ok()?;
    let library = Path::new(sysroot.trim()).join("lib/rustlib/src/rust/library");
    (!library.is_dir()).then(|| format!("{} is missing. Install it with `rustup component add rust-src`.", library.display()))
}

/// `initializationOptions` (and the answer to `workspace/configuration`). Light by default:
/// no `cargo check` on save, no diagnostics (the IDE does not show them yet), and a separate
/// target directory so rust-analyzer's build-script runs never lock the user's `cargo build`.
pub fn init_options(cfg: &RustConfig) -> Value {
    let mut v = json!({
        "checkOnSave": cfg.check_on_save,
        "cargo": {"buildScripts": {"enable": cfg.build_scripts}, "targetDir": true},
        "procMacro": {"enable": cfg.proc_macros},
        "diagnostics": {"enable": false},
    });
    if let Some(extra) = &cfg.init {
        merge(&mut v, extra);
    }
    v
}

fn merge(base: &mut Value, extra: &Value) {
    match (base, extra) {
        (Value::Object(b), Value::Object(e)) => {
            for (k, v) in e {
                merge(b.entry(k.clone()).or_insert(Value::Null), v);
            }
        }
        (b, e) => *b = e.clone(),
    }
}

#[derive(Default)]
struct RaStatus {
    /// An `experimental/serverStatus` arrived since the start.
    got_status: bool,
    quiescent: bool,
    health: String,
    /// Running `$/progress` tokens.
    progress: BTreeSet<String>,
    started: Option<Instant>,
}

impl RaStatus {
    /// Still loading the workspace: empty answers may only mean "not yet".
    fn loading(&self) -> bool {
        if self.got_status {
            !self.quiescent
        } else {
            // A server without status notifications: trust progress, plus a short grace time.
            !self.progress.is_empty() || self.started.is_some_and(|s| s.elapsed() < Duration::from_secs(2))
        }
    }

    fn label(&self) -> String {
        if self.loading() || !self.progress.is_empty() {
            "rust-analyzer: indexing…".into()
        } else if self.health == "error" {
            "rust-analyzer: error".into()
        } else {
            "rust-analyzer".into()
        }
    }
}

type Status = Arc<(Mutex<RaStatus>, Condvar)>;

struct RaServer {
    root: PathBuf,
    client: LspClient,
    status: Status,
}

impl RaServer {
    fn new(exe: &Path, root: &Path, settings: Arc<Mutex<Value>>, repaint: Arc<dyn Fn() + Send + Sync>) -> RaServer {
        let status: Status = Arc::default();
        let mut config = ClientConfig::new("rust-analyzer", exe);
        config.root = Some(root.to_path_buf());
        config.cwd = Some(root.to_path_buf());
        config.language_id = |_| "rust";
        let mut caps = default_capabilities();
        caps["experimental"] = json!({"serverStatusNotification": true});
        config.capabilities = caps;
        config.initialization_options = Some(lock(&settings).clone());
        // rust-analyzer pulls its settings again after `didChangeConfiguration`.
        config.configuration = Some(Arc::new(move |item: &Value| {
            if item["section"] == "rust-analyzer" {
                lock(&settings).clone()
            } else {
                Value::Null
            }
        }));
        let st = status.clone();
        config.on_notification = Some(Arc::new(move |method: &str, params: &Value| {
            let (m, cv) = &*st;
            let mut s = lock(m);
            match method {
                "experimental/serverStatus" => {
                    s.got_status = true;
                    s.quiescent = params["quiescent"].as_bool().unwrap_or(true);
                    s.health = params["health"].as_str().unwrap_or("ok").to_string();
                }
                "$/progress" => {
                    let token = match &params["token"] {
                        Value::String(t) => t.clone(),
                        other => other.to_string(),
                    };
                    match params["value"]["kind"].as_str() {
                        Some("begin") => {
                            s.progress.insert(token);
                        }
                        Some("end") => {
                            s.progress.remove(&token);
                        }
                        _ => return,
                    }
                }
                _ => return,
            }
            drop(s);
            cv.notify_all();
            repaint();
        }));
        lock(&status.0).started = Some(Instant::now());
        RaServer { root: root.to_path_buf(), client: LspClient::new(config), status }
    }

    fn loading(&self) -> bool {
        lock(&self.status.0).loading()
    }

    /// Sleeps until the status changes or `until`.
    fn wait_for_status(&self, until: Instant) {
        let (m, cv) = &*self.status;
        let s = lock(m);
        let left = until.saturating_duration_since(Instant::now());
        let _ = cv.wait_timeout(s, left);
    }

    fn reset_status(&self) {
        let mut s = lock(&self.status.0);
        *s = RaStatus { started: Some(Instant::now()), ..Default::default() };
    }
}

pub struct RustService {
    repaint: Arc<dyn Fn() + Send + Sync>,
    config: Mutex<RustConfig>,
    /// The current `initializationOptions`, shared with every server's configuration answer.
    settings: Arc<Mutex<Value>>,
    /// Located once per configuration: `--version` probes cost a few milliseconds each.
    exe: Mutex<Option<Result<PathBuf, String>>>,
    servers: Mutex<HashMap<PathBuf, Arc<RaServer>>>,
    /// Open editor file -> the root of its server.
    files: Mutex<HashMap<PathBuf, PathBuf>>,
    /// Directory -> workspace root, so the walk up runs once per directory.
    roots: Mutex<HashMap<PathBuf, Option<PathBuf>>>,
    /// The server used last; dependency sources opened from a jump go to it.
    last_root: Mutex<Option<PathBuf>>,
    notice: Mutex<Option<(String, String)>>,
    warned_missing: AtomicBool,
    checked_src: AtomicBool,
    timeout: Duration,
}

impl RustService {
    pub fn new(repaint: Arc<dyn Fn() + Send + Sync>) -> RustService {
        let config = RustConfig::default();
        RustService {
            repaint,
            settings: Arc::new(Mutex::new(init_options(&config))),
            config: Mutex::new(config),
            exe: Mutex::default(),
            servers: Mutex::default(),
            files: Mutex::default(),
            roots: Mutex::default(),
            last_root: Mutex::default(),
            notice: Mutex::default(),
            warned_missing: AtomicBool::new(false),
            checked_src: AtomicBool::new(false),
            timeout: REQUEST_TIMEOUT,
        }
    }

    fn exe(&self) -> Result<PathBuf, String> {
        if let Some(found) = lock(&self.exe).clone() {
            return found;
        }
        // The probe runs without the lock: `status` reads it on the UI thread.
        let configured = lock(&self.config).server.clone();
        let found = find_rust_analyzer(configured.as_deref());
        *lock(&self.exe) = Some(found.clone());
        found
    }

    fn root_of(&self, path: &Path) -> Option<PathBuf> {
        let dir = path.parent()?.to_path_buf();
        if let Some(r) = lock(&self.roots).get(&dir) {
            return r.clone();
        }
        let root = workspace_root(path).map(|r| ide_lsp::canonical(&r));
        lock(&self.roots).insert(dir, root.clone());
        root
    }

    /// The server for a file, created (not started) if needed.
    fn server_for(&self, path: &Path) -> Result<Arc<RaServer>, String> {
        let known = lock(&self.files).get(path).cloned();
        let root = match known {
            Some(root) => root,
            None => {
                let last = lock(&self.last_root).clone().filter(|r| lock(&self.servers).contains_key(r));
                match (is_library_path(path), last) {
                    (true, Some(last)) => last,
                    _ => self.root_of(path).ok_or_else(|| format!("No Cargo.toml above {}.", path.display()))?,
                }
            }
        };
        let exe = match self.exe() {
            Ok(exe) => exe,
            Err(e) => {
                if !self.warned_missing.swap(true, Ordering::SeqCst) {
                    *lock(&self.notice) = Some(("rust-analyzer not found".into(), e.clone()));
                }
                return Err(e);
            }
        };
        if !self.checked_src.swap(true, Ordering::SeqCst) {
            if let Some(why) = rust_src_missing() {
                *lock(&self.notice) = Some(("Standard library sources are missing".into(), format!("{why} Go to Declaration into std, core and alloc needs them.")));
            }
        }
        *lock(&self.last_root) = Some(root.clone());
        let server = lock(&self.servers)
            .entry(root.clone())
            .or_insert_with(|| Arc::new(RaServer::new(&exe, &root, self.settings.clone(), self.repaint.clone())))
            .clone();
        Ok(server)
    }

    /// Runs a request, retrying while the server loads: empty answers wait for the next status
    /// change, "content modified" waits 100 ms. Gives up at the request timeout.
    fn retry<T>(&self, path: &Path, empty: impl Fn(&T) -> bool, f: impl Fn(&LspClient, Duration) -> ide_lsp::Result<T>) -> Result<T, String> {
        let server = self.server_for(path)?;
        let deadline = Instant::now() + self.timeout;
        loop {
            let left = deadline.saturating_duration_since(Instant::now()).max(Duration::from_secs(1));
            match f(&server.client, left) {
                Ok(v) if empty(&v) && server.loading() && Instant::now() < deadline => {
                    server.wait_for_status((Instant::now() + Duration::from_millis(500)).min(deadline));
                }
                Ok(v) => return Ok(v),
                Err(e) if e.is_retryable() && Instant::now() < deadline => std::thread::sleep(Duration::from_millis(100)),
                Err(e) => return Err(format!("rust-analyzer: {e}")),
            }
        }
    }

    /// Workspace roots with a server (running or not), for tests and the log.
    pub fn roots(&self) -> Vec<PathBuf> {
        let mut r: Vec<PathBuf> = lock(&self.servers).keys().cloned().collect();
        r.sort();
        r
    }
}

impl LanguageServer for RustService {
    fn open(&self, path: &Path, text: &str) {
        let Ok(server) = self.server_for(path) else { return };
        lock(&self.files).insert(path.to_path_buf(), server.root.clone());
        let fresh = !server.client.is_running();
        if fresh {
            server.reset_status();
        }
        server.client.open(path, text, self.timeout);
        (self.repaint)();
    }

    fn change(&self, path: &Path, text: &str) {
        let root = lock(&self.files).get(path).cloned();
        let server = root.and_then(|r| lock(&self.servers).get(&r).cloned());
        match server {
            Some(s) => s.client.change(path, text, self.timeout),
            None => self.open(path, text),
        }
    }

    fn close(&self, path: &Path) {
        let Some(root) = lock(&self.files).remove(path) else { return };
        let server = lock(&self.servers).get(&root).cloned();
        if let Some(s) = server {
            s.client.close(path);
        }
    }

    fn locations(&self, kind: NavKind, path: &Path, line: usize, column: usize) -> Result<Vec<Location>, String> {
        let method = match kind {
            NavKind::TypeDefinition => "textDocument/typeDefinition",
            // Go to Source Definition is a TypeScript idea (`.js` behind `.d.ts`); Rust sources
            // are the definition already.
            NavKind::Declaration | NavKind::SourceDefinition | NavKind::Usages => "textDocument/definition",
        };
        self.retry(path, Vec::is_empty, |c, t| c.locations(method, path, line, column, t))
    }

    fn references(&self, path: &Path, line: usize, column: usize) -> Result<Vec<Reference>, String> {
        self.retry(path, Vec::is_empty, |c, t| c.references(path, line, column, t))
    }

    fn hover(&self, path: &Path, line: usize, column: usize) -> Result<Option<HoverInfo>, String> {
        let hover = self.retry(path, Option::is_none, |c, t| c.hover(path, line, column, t))?;
        Ok(hover.map(|h| {
            let (display, documentation) = ide_lsp::split_hover_markdown(&h.markdown);
            HoverInfo { display, documentation, tags: Vec::new() }
        }))
    }

    fn status(&self, path: &Path) -> Option<String> {
        let root = lock(&self.files).get(path).cloned();
        match root.and_then(|r| lock(&self.servers).get(&r).cloned()) {
            Some(s) => Some(lock(&s.status.0).label()),
            None if matches!(&*lock(&self.exe), Some(Err(_))) => Some("no rust-analyzer".into()),
            None => None,
        }
    }

    fn stop_idle(&self, idle: Duration) -> Vec<String> {
        let servers: Vec<Arc<RaServer>> = lock(&self.servers).values().cloned().collect();
        let mut stopped = Vec::new();
        for s in servers {
            let idle_long = s.client.idle_for().is_some_and(|d| d >= idle);
            if idle_long && s.client.editor_files() == 0 {
                s.client.shutdown();
                s.reset_status();
                stopped.push(format!("rust-analyzer for {}", s.root.display()));
            }
        }
        stopped
    }

    fn running(&self) -> usize {
        let servers: Vec<Arc<RaServer>> = lock(&self.servers).values().cloned().collect();
        servers.iter().filter(|s| s.client.is_running()).count()
    }

    fn take_notice(&self) -> Option<(String, String)> {
        lock(&self.notice).take()
    }

    fn configure(&self, config: &IdeConfig) {
        let servers: Vec<Arc<RaServer>> = lock(&self.servers).values().cloned().collect();
        if !config.enabled(LangId::Rust) {
            for s in &servers {
                s.client.shutdown();
            }
            lock(&self.servers).clear();
            lock(&self.files).clear();
            return;
        }
        let new = config.rust.clone();
        let old = std::mem::replace(&mut *lock(&self.config), new.clone());
        if old.server != new.server {
            *lock(&self.exe) = None;
            self.warned_missing.store(false, Ordering::SeqCst);
        }
        *lock(&self.settings) = init_options(&new);
        lock(&self.roots).clear();
        if old != new {
            // Running servers pull the new settings through `workspace/configuration`.
            for s in servers.iter().filter(|s| s.client.is_running()) {
                let _ = s.client.notify("workspace/didChangeConfiguration", json!({"settings": null}), self.timeout);
            }
        }
    }

    fn shutdown(&self) {
        let servers: Vec<Arc<RaServer>> = lock(&self.servers).drain().map(|(_, s)| s).collect();
        for s in servers {
            s.client.shutdown();
        }
        lock(&self.files).clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    #[test]
    fn root_is_the_topmost_workspace_else_the_nearest_manifest() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(&root.join("ws/Cargo.toml"), "[workspace]\nmembers = [\"crates/*\"]\n");
        write(&root.join("ws/crates/a/Cargo.toml"), "[package]\nname = \"a\"\n");
        write(&root.join("ws/crates/a/src/lib.rs"), "");
        write(&root.join("solo/Cargo.toml"), "[package]\nname = \"solo\"\n");
        write(&root.join("solo/src/main.rs"), "");
        write(&root.join("loose/x.rs"), "");
        assert_eq!(workspace_root(&root.join("ws/crates/a/src/lib.rs")).as_deref(), Some(root.join("ws").as_path()));
        assert_eq!(workspace_root(&root.join("solo/src/main.rs")).as_deref(), Some(root.join("solo").as_path()));
        assert_eq!(workspace_root(&root.join("loose/x.rs")), None);
        // `[workspace.package]` alone also makes a workspace manifest.
        write(&root.join("solo/Cargo.toml"), "[workspace.package]\nversion = \"1.0.0\"\n");
        assert_eq!(workspace_root(&root.join("solo/src/main.rs")).as_deref(), Some(root.join("solo").as_path()));
    }

    #[test]
    fn init_options_are_light_and_mergeable() {
        let v = init_options(&RustConfig::default());
        assert_eq!(v["checkOnSave"], false);
        assert_eq!(v["cargo"]["targetDir"], true);
        assert_eq!(v["cargo"]["buildScripts"]["enable"], true);
        let custom = RustConfig { check_on_save: true, init: Some(json!({"cargo": {"features": "all"}, "checkOnSave": false})), ..RustConfig::default() };
        let v = init_options(&custom);
        assert_eq!(v["cargo"]["features"], "all");
        assert_eq!(v["cargo"]["targetDir"], true, "merging keeps sibling keys");
        assert_eq!(v["checkOnSave"], false, "[rust.init] wins");
    }

    #[test]
    fn missing_server_explains_how_to_install() {
        let e = find_rust_analyzer(Some(Path::new("/nonexistent/rust-analyzer"))).unwrap_err();
        assert!(e.contains("rustup component add rust-analyzer"), "{e}");
        assert!(e.contains("/nonexistent/rust-analyzer"), "{e}");
        // A file that is not rust-analyzer fails the `--version` check.
        let e = find_rust_analyzer(Some(Path::new("/bin/echo"))).unwrap_err();
        assert!(e.contains("unexpected --version output"), "{e}");
    }

    #[test]
    fn status_labels() {
        let mut s = RaStatus { started: Some(Instant::now()), ..Default::default() };
        assert_eq!(s.label(), "rust-analyzer: indexing…", "just started");
        s.got_status = true;
        s.quiescent = true;
        s.health = "ok".into();
        assert_eq!(s.label(), "rust-analyzer");
        s.progress.insert("rustAnalyzer/Indexing".into());
        assert_eq!(s.label(), "rust-analyzer: indexing…");
        s.progress.clear();
        s.quiescent = false;
        assert!(s.loading());
    }
}
