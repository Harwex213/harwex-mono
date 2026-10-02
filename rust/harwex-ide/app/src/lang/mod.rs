//! The language registry: which server answers navigation for a file, when it starts and
//! when it stops.
//!
//! - A server starts on the first open file of its language (rule 5). Opening a JS project
//!   never starts rust-analyzer.
//! - One server per toolchain or workspace (rule 6): TypeScript per installation (`ide-ts`
//!   decides), rust-analyzer per Cargo workspace root.
//! - A server stops when it has been idle for the language's idle timeout (default 10 min)
//!   and no file it serves is open.
//! - `.harwex/ide.toml` can turn languages off and tune servers (rule 10).
//!
//! Every server call runs on the language's queue thread or on a thread it spawns, never on
//! the UI thread (rule 1).

pub mod config;
pub mod rust;
pub mod ts;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

pub use config::IdeConfig;
pub use ide_lsp::{Location, Reference};

use crate::jobs::Jobs;
use crate::nav::NavKind;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum LangId {
    TypeScript,
    Rust,
}

impl LangId {
    pub const ALL: [LangId; 2] = [LangId::TypeScript, LangId::Rust];

    /// The name used in `.harwex/ide.toml`.
    pub fn key(self) -> &'static str {
        match self {
            LangId::TypeScript => "ts",
            LangId::Rust => "rust",
        }
    }

    pub fn parse(s: &str) -> Option<LangId> {
        match s.to_ascii_lowercase().as_str() {
            "ts" | "typescript" | "js" | "javascript" => Some(LangId::TypeScript),
            "rust" | "rs" => Some(LangId::Rust),
            _ => None,
        }
    }

    pub fn spec(self) -> &'static LanguageSpec {
        match self {
            LangId::TypeScript => &TS_SPEC,
            LangId::Rust => &RUST_SPEC,
        }
    }

    /// The language of a file by its extension.
    pub fn for_path(path: &Path) -> Option<LangId> {
        let ext = path.extension()?.to_str()?.to_ascii_lowercase();
        LangId::ALL.into_iter().find(|l| l.spec().extensions.contains(&ext.as_str()))
    }
}

/// Static facts about a language and its server.
pub struct LanguageSpec {
    pub id: LangId,
    /// Shown in messages: "TypeScript and JavaScript", "Rust".
    pub name: &'static str,
    pub extensions: &'static [&'static str],
    /// Files that mark a project root for the server. The server's adapter does the walk.
    pub root_markers: &'static [&'static str],
    /// How the server is found and started, for docs and messages.
    pub server: &'static str,
    /// Concurrent requests: a slow request (rust-analyzer still indexing) must not hold up
    /// the next one. tsserver keeps strict request order instead.
    pub concurrent_requests: bool,
}

pub static TS_SPEC: LanguageSpec = LanguageSpec {
    id: LangId::TypeScript,
    name: "TypeScript and JavaScript",
    extensions: &["ts", "mts", "cts", "tsx", "js", "mjs", "cjs", "jsx"],
    root_markers: &["node_modules/typescript", "tsconfig.json", "package.json"],
    server: "the project's TypeScript: native `tsc --lsp` (TypeScript 7) or tsserver.js with node",
    concurrent_requests: false,
};

pub static RUST_SPEC: LanguageSpec = LanguageSpec {
    id: LangId::Rust,
    name: "Rust",
    extensions: &["rs"],
    root_markers: &["Cargo.toml"],
    server: "rust-analyzer from PATH, ~/.cargo/bin or `rustup which rust-analyzer`",
    concurrent_requests: true,
};

/// Hover text, whichever server produced it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct HoverInfo {
    /// The signature, shown in monospace.
    pub display: String,
    pub documentation: String,
    /// JSDoc-style tags (TypeScript only).
    pub tags: Vec<(String, String)>,
}

/// A language's servers as the app sees them. All calls may block (they talk to processes);
/// the registry calls them on worker threads only. `status` is the exception: it is called
/// on the UI thread and must only read cached state.
pub trait LanguageServer: Send + Sync + 'static {
    fn open(&self, path: &Path, text: &str);
    fn change(&self, path: &Path, text: &str);
    fn close(&self, path: &Path);
    /// Go to Declaration, Source Definition or Type Definition (`kind` is never `Usages`).
    fn locations(&self, kind: NavKind, path: &Path, line: usize, column: usize) -> Result<Vec<Location>, String>;
    fn references(&self, path: &Path, line: usize, column: usize) -> Result<Vec<Reference>, String>;
    fn hover(&self, path: &Path, line: usize, column: usize) -> Result<Option<HoverInfo>, String>;
    /// Status bar text for an open file ("TS 7.0.2 native", "rust-analyzer: indexing…").
    fn status(&self, path: &Path) -> Option<String>;
    /// Stops every server that has been idle for `idle` and has no editor file open.
    /// Returns a name per stopped server, for the log.
    fn stop_idle(&self, idle: Duration) -> Vec<String>;
    /// Server processes running now (tests check lazy start and idle stop with it).
    fn running(&self) -> usize;
    /// A warning to show once, e.g. "rust-analyzer not found".
    fn take_notice(&self) -> Option<(String, String)>;
    /// New project settings. Servers started with older settings stop.
    fn configure(&self, _config: &IdeConfig) {}
    fn shutdown(&self);
}

type Run = Box<dyn FnOnce(&dyn LanguageServer) + Send>;

enum Cmd {
    Open(PathBuf, String),
    Change(PathBuf, String),
    Close(PathBuf),
    Run(Run),
    Configure(Box<IdeConfig>),
}

/// One queue thread per language. Sync commands and requests leave in UI order, so a request
/// always sees the edits made before it.
pub struct Bridge {
    pub lang: LangId,
    tx: Sender<Cmd>,
    server: Arc<dyn LanguageServer>,
    /// Commands sent and not finished yet (requests on their own threads included), so
    /// tests can wait for server work.
    queued: Arc<AtomicUsize>,
    idle_ms: Arc<std::sync::atomic::AtomicU64>,
}

impl Bridge {
    pub fn new(lang: LangId, server: Arc<dyn LanguageServer>, jobs: Option<Jobs>) -> Bridge {
        let (tx, rx) = channel::<Cmd>();
        let queued = Arc::new(AtomicUsize::new(0));
        let idle_ms = Arc::new(std::sync::atomic::AtomicU64::new(config::DEFAULT_IDLE_TIMEOUT.as_millis() as u64));
        let (srv, done, idle) = (server.clone(), queued.clone(), idle_ms.clone());
        let concurrent = lang.spec().concurrent_requests;
        let _ = std::thread::Builder::new().name(format!("{} queue", lang.key())).spawn(move || {
            let mut last_check = Instant::now();
            loop {
                let idle_timeout = Duration::from_millis(idle.load(Ordering::Relaxed));
                // Check a few times per timeout, so a server stops close to its deadline.
                let tick = (idle_timeout / 4).clamp(Duration::from_millis(50), Duration::from_secs(30));
                match rx.recv_timeout(tick.saturating_sub(last_check.elapsed())) {
                    Ok(cmd) => {
                        let mut finished_here = true;
                        match cmd {
                            Cmd::Open(p, t) => srv.open(&p, &t),
                            Cmd::Change(p, t) => srv.change(&p, &t),
                            Cmd::Close(p) => srv.close(&p),
                            Cmd::Configure(c) => {
                                idle.store(c.idle_timeout(lang).as_millis() as u64, Ordering::Relaxed);
                                srv.configure(&c);
                            }
                            Cmd::Run(f) if concurrent => {
                                // Sync messages before this one are written already, so the
                                // request sees them even though it runs on its own thread.
                                let (srv, done) = (srv.clone(), done.clone());
                                finished_here = false;
                                let spawned = std::thread::Builder::new().name(format!("{} request", lang.key())).spawn(move || {
                                    f(srv.as_ref());
                                    done.fetch_sub(1, Ordering::SeqCst);
                                });
                                if spawned.is_err() {
                                    finished_here = true;
                                }
                            }
                            Cmd::Run(f) => f(srv.as_ref()),
                        }
                        if finished_here {
                            done.fetch_sub(1, Ordering::SeqCst);
                        }
                        if let (Some(jobs), Some((title, body))) = (jobs.as_ref(), srv.take_notice()) {
                            jobs.post(move |state| state.notifications.warn(title, body));
                        }
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
                if last_check.elapsed() >= tick {
                    last_check = Instant::now();
                    let stopped = srv.stop_idle(idle_timeout);
                    if let (Some(jobs), false) = (jobs.as_ref(), stopped.is_empty()) {
                        let secs = idle_timeout.as_secs_f64();
                        jobs.post(move |state| {
                            for name in stopped {
                                state.timings.log(format!("stopped {name}: idle for {secs:.1} s with no open file"));
                            }
                        });
                    }
                }
            }
            srv.shutdown();
        });
        Bridge { lang, tx, server, queued, idle_ms }
    }

    fn send(&self, cmd: Cmd) {
        self.queued.fetch_add(1, Ordering::SeqCst);
        if self.tx.send(cmd).is_err() {
            self.queued.fetch_sub(1, Ordering::SeqCst);
        }
    }

    pub fn queued(&self) -> usize {
        self.queued.load(Ordering::SeqCst)
    }

    pub fn open(&self, path: &Path, text: String) {
        self.send(Cmd::Open(path.to_path_buf(), text));
    }

    pub fn change(&self, path: &Path, text: String) {
        self.send(Cmd::Change(path.to_path_buf(), text));
    }

    pub fn close(&self, path: &Path) {
        self.send(Cmd::Close(path.to_path_buf()));
    }

    pub fn run(&self, f: impl FnOnce(&dyn LanguageServer) + Send + 'static) {
        self.send(Cmd::Run(Box::new(f)));
    }

    pub fn configure(&self, config: &IdeConfig) {
        self.idle_ms.store(config.idle_timeout(self.lang).as_millis() as u64, Ordering::Relaxed);
        self.send(Cmd::Configure(Box::new(config.clone())));
    }

    pub fn server(&self) -> &Arc<dyn LanguageServer> {
        &self.server
    }
}

/// Every language the app knows, with its bridge and the project's settings.
pub struct Languages {
    bridges: HashMap<LangId, Bridge>,
    pub config: IdeConfig,
}

impl Languages {
    pub fn new(jobs: Jobs, repaint: Arc<dyn Fn() + Send + Sync>) -> Languages {
        let mut bridges = HashMap::new();
        bridges.insert(LangId::TypeScript, Bridge::new(LangId::TypeScript, Arc::new(ts::TsServer::new()), Some(jobs.clone())));
        bridges.insert(LangId::Rust, Bridge::new(LangId::Rust, Arc::new(rust::RustService::new(repaint)), Some(jobs)));
        Languages { bridges, config: IdeConfig::default() }
    }

    /// Applies a project's `.harwex/ide.toml` (or the defaults when it has none).
    pub fn configure(&mut self, config: IdeConfig) {
        for b in self.bridges.values() {
            b.configure(&config);
        }
        self.config = config;
    }

    /// The enabled language that serves `path`, or why navigation does not work there.
    pub fn lang_for(&self, path: &Path) -> Result<LangId, String> {
        match LangId::for_path(path) {
            Some(lang) if self.config.enabled(lang) => Ok(lang),
            Some(lang) => Err(format!("{} support is turned off in {} (languages = [...]).", lang.spec().name, config::CONFIG_PATH)),
            None => Err("Navigation works in TypeScript, JavaScript and Rust files.".to_string()),
        }
    }

    pub fn bridge(&self, lang: LangId) -> &Bridge {
        &self.bridges[&lang]
    }

    /// Commands waiting for or running on any language queue.
    pub fn queued(&self) -> usize {
        self.bridges.values().map(Bridge::queued).sum()
    }

    /// Server processes running now, per language.
    pub fn running(&self, lang: LangId) -> usize {
        self.bridges[&lang].server.running()
    }

    pub fn status(&self, lang: LangId, path: &Path) -> Option<String> {
        self.bridges[&lang].server.status(path)
    }

    /// Stops every server now. Called on exit, on the UI thread, because nothing waits then.
    pub fn shutdown(&self) {
        for b in self.bridges.values() {
            b.server.shutdown();
        }
    }
}

/// Dependency sources that open read-only, like IDEA's library files: `node_modules`, the
/// Cargo registry and git checkouts, and the standard library sources (`rust-src`).
pub fn is_library_path(path: &Path) -> bool {
    if path.components().any(|c| c.as_os_str() == "node_modules") {
        return true;
    }
    // `<sysroot>/lib/rustlib/src/rust/library/...`, wherever the sysroot is.
    let parts: Vec<&std::ffi::OsStr> = path.components().map(|c| c.as_os_str()).collect();
    if parts.windows(4).any(|w| w[0] == "lib" && w[1] == "rustlib" && w[2] == "src" && w[3] == "rust") {
        return true;
    }
    library_roots().iter().any(|root| path.starts_with(root))
}

/// `$CARGO_HOME/registry`, `$CARGO_HOME/git` and `$RUST_SRC_PATH`, canonical, computed once.
fn library_roots() -> &'static [PathBuf] {
    static ROOTS: OnceLock<Vec<PathBuf>> = OnceLock::new();
    ROOTS.get_or_init(|| {
        let mut roots = Vec::new();
        if let Some(cargo) = rust::cargo_home() {
            for sub in ["registry", "git"] {
                let p = cargo.join(sub);
                roots.push(std::fs::canonicalize(&p).unwrap_or(p));
            }
        }
        if let Some(src) = std::env::var_os("RUST_SRC_PATH") {
            let p = PathBuf::from(src);
            roots.push(std::fs::canonicalize(&p).unwrap_or(p));
        }
        roots
    })
}

/// A short lock: maps behind it are only read or written, never held across a call.
pub(crate) fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn languages_by_extension() {
        assert_eq!(LangId::for_path(Path::new("/p/a.tsx")), Some(LangId::TypeScript));
        assert_eq!(LangId::for_path(Path::new("/p/a.MJS")), Some(LangId::TypeScript));
        assert_eq!(LangId::for_path(Path::new("/p/src/lib.rs")), Some(LangId::Rust));
        assert_eq!(LangId::for_path(Path::new("/p/Cargo.toml")), None);
        assert_eq!(LangId::for_path(Path::new("/p/README")), None);
    }

    #[test]
    fn ts_extensions_match_the_editor_languages() {
        use ide_editor::Language;
        for ext in TS_SPEC.extensions {
            let lang = Language::from_path(Path::new(&format!("/a/b.{ext}")));
            assert!(matches!(lang, Language::TypeScript | Language::Tsx | Language::JavaScript | Language::Jsx), "{ext}");
        }
    }

    #[test]
    fn library_paths_are_read_only() {
        assert!(is_library_path(Path::new("/p/node_modules/x/index.d.ts")));
        assert!(is_library_path(Path::new("/r/toolchains/stable/lib/rustlib/src/rust/library/core/src/option.rs")));
        if let Some(cargo) = rust::cargo_home() {
            let cargo = std::fs::canonicalize(&cargo).unwrap_or(cargo);
            assert!(is_library_path(&cargo.join("registry/src/index.crates.io-1/egui-0.31.1/src/ui.rs")));
        }
        assert!(!is_library_path(Path::new("/p/src/main.rs")));
        assert!(!is_library_path(Path::new("/p/lib/rustlib.rs")));
    }

    #[test]
    fn disabled_language_says_why() {
        let mut langs = Languages { bridges: HashMap::new(), config: IdeConfig::parse("languages = [\"ts\"]") };
        assert_eq!(langs.lang_for(Path::new("/p/a.ts")), Ok(LangId::TypeScript));
        let why = langs.lang_for(Path::new("/p/a.rs")).unwrap_err();
        assert!(why.contains("Rust support is turned off"), "{why}");
        langs.config = IdeConfig::default();
        assert_eq!(langs.lang_for(Path::new("/p/a.rs")), Ok(LangId::Rust));
        assert!(langs.lang_for(Path::new("/p/a.md")).is_err());
    }
}
