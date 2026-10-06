//! C and C++ through clangd, one process per compile-database root (rule 6).
//!
//! - Locating: `[cpp] clangd` in `.harwex/ide.toml`, else `HARWEX_CLANGD` (the tests point it at
//!   the pinned clangd; neither falls back when set), else `clangd` on `PATH`, `xcrun --find clangd` (Xcode or the Command Line Tools), then Homebrew LLVM. Each
//!   candidate must answer `--version`. The IDE never downloads clangd.
//! - Root: the nearest folder above the file with `compile_commands.json`,
//!   `compile_flags.txt`, `build/compile_commands.json`, `cmake-build-*/compile_commands.json`
//!   (CLion's layout) or `.clangd`. A database in a build folder goes to clangd as
//!   `--compile-commands-dir`. Without any of them clangd still starts with its fallback flags
//!   (root: the topmost `CMakeLists.txt` folder, else the git root, else the file's folder),
//!   and a hint says once how to get a database.
//! - System headers and the STL (an SDK, `/usr/include`, clang's resource headers) open
//!   read-only (`is_system_header`) and go to the server used last, so a jump into `<vector>`
//!   never starts a server for the SDK.
//! - Index: clangd's background index lives in `<database folder>/.cache/clangd` inside the
//!   project. A hint tells once when git does not ignore it. `background_index = false` turns
//!   it off. The status bar shows `clangd <version>: indexing…` while `$/progress` runs.
//! - Unreal Engine (`unreal.rs`): a `*.uproject` folder is a root even without a database,
//!   and the walk up stops there, so each project of a folder gets its own clangd;
//!   its database is `.harwex/unreal/compile_commands.json`, and its clangd gets the scale
//!   flags (`unreal::scale_args`). The hints name UnrealBuildTool and missing UHT headers.
//! - Diagnostics: clangd only pushes them (no `textDocument/diagnostic`). A request waits for
//!   the push of the text version it asks about (`publishDiagnostics.versionSupport`).

use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use ide_lsp::{default_capabilities, ClientConfig, LspClient};
use serde_json::{json, Value};

use super::config::{CppConfig, IdeConfig};
use super::unreal;
use super::{is_library_path, lock, FileEdit, HoverInfo, LangId, LanguageServer, Location, Reference};
use crate::nav::NavKind;

/// How long a request may take in total, waiting for the index included.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
/// How long a references or rename request waits for a running background index before it
/// answers with what clangd knows so far.
const INDEX_WAIT: Duration = Duration::from_secs(15);
/// After the first file opens, clangd loads the database and starts its index within this
/// time; until then cross-file answers may still be missing.
const INDEX_START_GRACE: Duration = Duration::from_secs(3);

/// The install hint for a missing clangd, per platform.
pub fn install_hint() -> &'static str {
    if cfg!(target_os = "macos") {
        "Install the Xcode Command Line Tools (`xcode-select --install`) or LLVM (`brew install llvm`), or set `clangd` under [cpp] in .harwex/ide.toml."
    } else {
        "Install clangd with your package manager (`apt install clangd`), or set `clangd` under [cpp] in .harwex/ide.toml."
    }
}

/// A located clangd and its version ("22.1.6").
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Clangd {
    pub exe: PathBuf,
    pub version: String,
}

/// Finds a working clangd. `Err` lists what was tried. Blocking (runs `--version`).
pub fn find_clangd(configured: Option<&Path>) -> Result<Clangd, String> {
    let mut notes = Vec::new();
    let mut tried: Vec<PathBuf> = Vec::new();
    let mut check = |p: PathBuf, notes: &mut Vec<String>| -> Option<Clangd> {
        if tried.contains(&p) {
            return None;
        }
        tried.push(p.clone());
        if !p.is_file() {
            return None;
        }
        match clangd_version(&p) {
            Ok(version) => Some(Clangd { exe: p, version }),
            Err(e) => {
                notes.push(format!("{}: {e}", p.display()));
                None
            }
        }
    };
    if let Some(p) = configured {
        // An explicit path wins and has no fallback, like `rust.server`.
        if let Some(found) = check(p.to_path_buf(), &mut notes) {
            return Ok(found);
        }
        let why = notes.pop().unwrap_or_else(|| "no such file".into());
        return Err(format!("clangd was not found: cpp.clangd in .harwex/ide.toml is {} ({why}). {}", p.display(), install_hint()));
    }
    if let Some(p) = std::env::var_os("HARWEX_CLANGD") {
        let p = PathBuf::from(p);
        if let Some(found) = check(p.clone(), &mut notes) {
            return Ok(found);
        }
        let why = notes.pop().unwrap_or_else(|| "no such file".into());
        return Err(format!("clangd was not found: HARWEX_CLANGD is {} ({why}). {}", p.display(), install_hint()));
    }
    for dir in std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()) {
        let candidate = dir.join("clangd");
        // On macOS `/usr/bin/clangd` is the Xcode shim; without developer tools it asks the
        // user to install them in a system dialog. The `xcrun` step below covers it quietly.
        if cfg!(target_os = "macos") && candidate.starts_with("/usr/bin") {
            continue;
        }
        if let Some(found) = check(candidate, &mut notes) {
            return Ok(found);
        }
    }
    if cfg!(target_os = "macos") {
        // `xcode-select -p` fails quietly without developer tools; xcrun would not.
        if output(Command::new("xcode-select").arg("-p")).is_ok() {
            match output(Command::new("xcrun").args(["--find", "clangd"])) {
                Ok(out) => {
                    if let Some(found) = check(PathBuf::from(out.trim()), &mut notes) {
                        return Ok(found);
                    }
                }
                Err(e) => notes.push(format!("xcrun --find clangd: {e}")),
            }
        }
        for brew in ["/opt/homebrew/opt/llvm/bin/clangd", "/usr/local/opt/llvm/bin/clangd"] {
            if let Some(found) = check(PathBuf::from(brew), &mut notes) {
                return Ok(found);
            }
        }
    }
    if notes.is_empty() {
        notes.push("not on PATH, in Xcode or in Homebrew LLVM".into());
    }
    Err(format!("clangd was not found. {}\n\nSearched: {}", install_hint(), notes.join("; ")))
}

/// The version of a clangd binary: "22.1.6" from "clangd version 22.1.6 (...)" or
/// "Apple clangd version 17.0.0 (clang-1700.0.13.5)".
fn clangd_version(exe: &Path) -> Result<String, String> {
    let out = output(Command::new(exe).arg("--version"))?;
    parse_version(&out).ok_or_else(|| format!("unexpected --version output {:?}", out.lines().next().unwrap_or_default()))
}

pub fn parse_version(out: &str) -> Option<String> {
    let line = out.lines().find(|l| l.contains("clangd version"))?;
    let rest = &line[line.find("clangd version")? + "clangd version".len()..];
    rest.split_whitespace().next().map(str::to_string)
}

/// Runs a short command with a 10 s limit and returns its stdout. A failure returns the
/// first stderr line.
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

/// Where one clangd runs and which compile database it reads.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct CppRoot {
    pub dir: PathBuf,
    /// The folder of `compile_commands.json`. clangd keeps its background index in
    /// `<db_dir>/.cache/clangd`.
    pub db_dir: Option<PathBuf>,
    /// A compile database or `compile_flags.txt` exists; without one clangd guesses flags.
    pub has_db: bool,
    /// An Unreal project or engine tree: clangd gets the scale flags.
    pub unreal: bool,
}

/// The clangd root of a file (see the module docs). Reads directories: call it on a worker.
pub fn find_root(file: &Path) -> CppRoot {
    let mut root = find_root_dir(file);
    root.unreal = unreal::is_unreal_dir(&root.dir);
    root
}

fn find_root_dir(file: &Path) -> CppRoot {
    let at = |dir: &Path, db_dir: Option<PathBuf>, has_db: bool| CppRoot { dir: dir.to_path_buf(), db_dir, has_db, unreal: false };
    for dir in file.ancestors().skip(1) {
        if dir.join("compile_commands.json").is_file() {
            return at(dir, Some(dir.to_path_buf()), true);
        }
        if dir.join("compile_flags.txt").is_file() {
            return at(dir, None, true);
        }
        if let Some(db) = build_db_dir(dir) {
            return at(dir, Some(db), true);
        }
        if dir.join(".clangd").is_file() {
            return at(dir, None, false);
        }
        // An Unreal project before UnrealBuildTool wrote its database. The walk stops here, so
        // a database above (a folder with several projects) never takes this project's files.
        if unreal::find_uproject(dir).is_some() {
            return at(dir, None, false);
        }
    }
    let parent = file.parent().unwrap_or(file).to_path_buf();
    let cmake = file.ancestors().skip(1).filter(|d| d.join("CMakeLists.txt").is_file()).last();
    let git = file.ancestors().skip(1).find(|d| d.join(".git").exists());
    let dir = cmake.or(git).map(Path::to_path_buf).unwrap_or(parent);
    CppRoot { dir, db_dir: None, has_db: false, unreal: false }
}

/// The Unreal database (`.harwex/unreal`), `build/compile_commands.json`, else a
/// `cmake-build-*` folder with one (CLion), the debug build first.
fn build_db_dir(dir: &Path) -> Option<PathBuf> {
    let ue = dir.join(unreal::DB_DIR);
    if ue.join("compile_commands.json").is_file() {
        return Some(ue);
    }
    let build = dir.join("build");
    if build.join("compile_commands.json").is_file() {
        return Some(build);
    }
    let mut cmake: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("cmake-build-")) && p.join("compile_commands.json").is_file())
        .collect();
    cmake.sort_by_key(|p| (!p.ends_with("cmake-build-debug"), p.clone()));
    cmake.into_iter().next()
}

/// A header of a system SDK, the C++ standard library or clang's resource headers: the
/// server's dependency sources, opened read-only.
pub fn is_system_header(path: &Path) -> bool {
    let parts: Vec<&str> = path.components().filter_map(|c| c.as_os_str().to_str()).collect();
    parts.windows(2).any(|w| w[0] == "usr" && w[1] == "include")
        || parts.iter().any(|p| p.ends_with(".sdk") || p.ends_with(".xctoolchain"))
        || parts.windows(4).any(|w| w[0] == "lib" && w[1] == "clang" && w[3] == "include")
}

/// `<sdk>/usr/include/c++/v1/vector`: a standard library header without an extension.
pub fn is_extensionless_std_header(path: &Path) -> bool {
    path.extension().is_none() && path.components().any(|c| c.as_os_str() == "c++")
}

fn language_id(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("c") => "c",
        _ => "cpp",
    }
}

/// clangd's command line for a root.
pub fn clangd_args(root: &CppRoot, cfg: &CppConfig) -> Vec<String> {
    let mut args = vec![format!("--background-index={}", cfg.background_index), "--log=error".to_string()];
    if let Some(db) = &root.db_dir {
        if db != &root.dir {
            args.push(format!("--compile-commands-dir={}", db.display()));
        }
    }
    if root.unreal {
        args.extend(unreal::scale_args(&cfg.args));
    }
    args.extend(cfg.args.iter().cloned());
    args
}

#[derive(Default)]
struct ClangdStatus {
    /// Running `$/progress` tokens (the background index).
    progress: BTreeSet<String>,
    /// Any progress was seen since the start.
    seen_progress: bool,
    started: Option<Instant>,
    /// The text version of each file's last `publishDiagnostics`.
    pushed: HashMap<PathBuf, i64>,
}

type Status = Arc<(Mutex<ClangdStatus>, Condvar)>;

struct ClangdServer {
    root: CppRoot,
    version: String,
    background_index: bool,
    client: LspClient,
    status: Status,
}

impl ClangdServer {
    fn new(clangd: &Clangd, root: &CppRoot, cfg: &CppConfig, repaint: Arc<dyn Fn() + Send + Sync>) -> ClangdServer {
        let status: Status = Arc::default();
        let mut config = ClientConfig::new("clangd", &clangd.exe);
        config.args = clangd_args(root, cfg);
        config.root = Some(root.dir.clone());
        config.cwd = Some(root.dir.clone());
        config.language_id = language_id;
        let mut caps = default_capabilities();
        caps["textDocument"]["publishDiagnostics"]["versionSupport"] = json!(true);
        config.capabilities = caps;
        let st = status.clone();
        config.on_notification = Some(Arc::new(move |method: &str, params: &Value| {
            let (m, cv) = &*st;
            let mut s = lock(m);
            match method {
                "$/progress" => {
                    let token = match &params["token"] {
                        Value::String(t) => t.clone(),
                        other => other.to_string(),
                    };
                    match params["value"]["kind"].as_str() {
                        Some("begin") => {
                            s.seen_progress = true;
                            s.progress.insert(token);
                        }
                        Some("end") => {
                            s.progress.remove(&token);
                        }
                        _ => return,
                    }
                }
                "textDocument/publishDiagnostics" => {
                    let Some(path) = params["uri"].as_str().and_then(ide_lsp::uri_to_path) else { return };
                    s.pushed.insert(path, params["version"].as_i64().unwrap_or(i64::MAX));
                }
                _ => return,
            }
            drop(s);
            cv.notify_all();
            repaint();
        }));
        let server = ClangdServer { root: root.clone(), version: clangd.version.clone(), background_index: cfg.background_index, client: LspClient::new(config), status };
        server.reset_status();
        server
    }

    /// The background index runs, or may still start (the database loads with the first file).
    fn indexing(&self) -> bool {
        let s = lock(&self.status.0);
        !s.progress.is_empty() || self.background_index && self.root.db_dir.is_some() && !s.seen_progress && s.started.is_some_and(|t| t.elapsed() < INDEX_START_GRACE)
    }

    fn label(&self) -> String {
        if lock(&self.status.0).progress.is_empty() {
            format!("clangd {}", self.version)
        } else {
            format!("clangd {}: indexing…", self.version)
        }
    }

    /// Sleeps until the status changes or `until`.
    fn wait_for_status(&self, until: Instant) {
        let (m, cv) = &*self.status;
        let s = lock(m);
        let left = until.saturating_duration_since(Instant::now());
        let _ = cv.wait_timeout(s, left);
    }

    /// Waits while the index runs, at most `limit`.
    fn wait_for_index(&self, limit: Duration) {
        let until = Instant::now() + limit;
        while self.indexing() && Instant::now() < until {
            self.wait_for_status((Instant::now() + Duration::from_millis(250)).min(until));
        }
    }

    fn reset_status(&self) {
        *lock(&self.status.0) = ClangdStatus { started: Some(Instant::now()), ..Default::default() };
    }
}

pub struct CppService {
    repaint: Arc<dyn Fn() + Send + Sync>,
    config: Mutex<CppConfig>,
    /// Located once per configuration: `--version` probes cost a few milliseconds each.
    exe: Mutex<Option<Result<Clangd, String>>>,
    servers: Mutex<HashMap<PathBuf, Arc<ClangdServer>>>,
    /// Open editor file -> the root of its server.
    files: Mutex<HashMap<PathBuf, PathBuf>>,
    /// Directory -> root, so the walk up runs once per directory.
    roots: Mutex<HashMap<PathBuf, CppRoot>>,
    /// The server used last; system headers opened from a jump go to it.
    last_root: Mutex<Option<PathBuf>>,
    notices: Mutex<VecDeque<(String, String)>>,
    /// Roots whose database and index hints were shown.
    hinted: Mutex<HashSet<PathBuf>>,
    /// Unreal roots whose missing-UHT-headers hint was shown.
    uht_hinted: Mutex<HashSet<PathBuf>>,
    warned_missing: AtomicBool,
    timeout: Duration,
}

impl CppService {
    pub fn new(repaint: Arc<dyn Fn() + Send + Sync>) -> CppService {
        CppService {
            repaint,
            config: Mutex::new(CppConfig::default()),
            exe: Mutex::default(),
            servers: Mutex::default(),
            files: Mutex::default(),
            roots: Mutex::default(),
            last_root: Mutex::default(),
            notices: Mutex::default(),
            hinted: Mutex::default(),
            uht_hinted: Mutex::default(),
            warned_missing: AtomicBool::new(false),
            timeout: REQUEST_TIMEOUT,
        }
    }

    fn clangd(&self) -> Result<Clangd, String> {
        if let Some(found) = lock(&self.exe).clone() {
            return found;
        }
        // The probe runs without the lock: `status` reads it on the UI thread.
        let configured = lock(&self.config).clangd.clone();
        let found = find_clangd(configured.as_deref());
        *lock(&self.exe) = Some(found.clone());
        found
    }

    fn root_of(&self, path: &Path) -> CppRoot {
        let dir = path.parent().unwrap_or(path).to_path_buf();
        if let Some(r) = lock(&self.roots).get(&dir) {
            return r.clone();
        }
        let mut root = find_root(path);
        root.dir = ide_lsp::canonical(&root.dir);
        root.db_dir = root.db_dir.map(|d| ide_lsp::canonical(&d));
        lock(&self.roots).insert(dir, root.clone());
        root
    }

    /// The server for a file, created (not started) if needed.
    fn server_for(&self, path: &Path) -> Result<Arc<ClangdServer>, String> {
        let known = lock(&self.files).get(path).cloned();
        let root_dir = match known {
            Some(root) => Some(root),
            None if is_library_path(path) => lock(&self.last_root).clone().filter(|r| lock(&self.servers).contains_key(r)),
            None => None,
        };
        if let Some(dir) = &root_dir {
            if let Some(s) = lock(&self.servers).get(dir).cloned() {
                *lock(&self.last_root) = Some(dir.clone());
                return Ok(s);
            }
        }
        let root = self.root_of(path);
        let clangd = match self.clangd() {
            Ok(c) => c,
            Err(e) => {
                if !self.warned_missing.swap(true, Ordering::SeqCst) {
                    lock(&self.notices).push_back(("clangd not found".into(), e.clone()));
                }
                return Err(e);
            }
        };
        *lock(&self.last_root) = Some(root.dir.clone());
        let existing = lock(&self.servers).get(&root.dir).cloned();
        if let Some(s) = existing {
            return Ok(s);
        }
        let cfg = lock(&self.config).clone();
        self.hints(&root, &cfg);
        let server = Arc::new(ClangdServer::new(&clangd, &root, &cfg, self.repaint.clone()));
        let server = lock(&self.servers).entry(root.dir.clone()).or_insert(server).clone();
        Ok(server)
    }

    /// Once per root: how to get a compile database, and a background index git does not ignore.
    fn hints(&self, root: &CppRoot, cfg: &CppConfig) {
        if !lock(&self.hinted).insert(root.dir.clone()) {
            return;
        }
        if !root.has_db && root.unreal {
            let name = unreal::find_uproject(&root.dir).and_then(|p| p.file_stem().map(|s| s.to_string_lossy().into_owned())).unwrap_or_default();
            lock(&self.notices).push_back((
                "No compile_commands.json".into(),
                format!(
                    "clangd guesses the compiler flags for the Unreal project {name} ({}), so engine includes are not found. Use \"Generate compile_commands.json (UnrealBuildTool)\" above the editor.",
                    root.dir.display()
                ),
            ));
        } else if !root.has_db {
            lock(&self.notices).push_back((
                "No compile_commands.json".into(),
                format!(
                    "clangd guesses the compiler flags for {}, so includes and macros may be wrong. Generate a database: `cmake -B build -DCMAKE_EXPORT_COMPILE_COMMANDS=ON` for CMake, `bear -- make` for make.",
                    root.dir.display()
                ),
            ));
        }
        if let (true, Some(db)) = (cfg.background_index, &root.db_dir) {
            if index_not_ignored(&root.dir, db) {
                lock(&self.notices).push_back((
                    "clangd index is not ignored by git".into(),
                    format!("clangd keeps its index in {}. Add `.cache/` to .gitignore, or set `background_index = false` under [cpp] in .harwex/ide.toml.", db.join(".cache/clangd").display()),
                ));
            }
        }
    }

    /// Once per Unreal root: a file includes a `*.generated.h` that UHT has not written yet.
    fn uht_hint(&self, path: &Path, text: &str) {
        if is_library_path(path) || !text.contains(".generated.h") {
            return;
        }
        let root = self.root_of(path);
        if !root.unreal || lock(&self.uht_hinted).contains(&root.dir) {
            return;
        }
        if let Some(header) = unreal::missing_generated_header(path, text, &root.dir) {
            lock(&self.uht_hinted).insert(root.dir.clone());
            lock(&self.notices).push_back((unreal::UHT_HINT.into(), format!("{header} does not exist yet, so UCLASS(), GENERATED_BODY() and UPROPERTY() do not resolve. Unreal Header Tool writes it under Intermediate/ during a build.")));
        }
    }

    /// A request that waits for nothing but the request timeout.
    fn request<T>(&self, path: &Path, f: impl Fn(&LspClient, Duration) -> ide_lsp::Result<T>) -> Result<T, String> {
        let server = self.server_for(path)?;
        let deadline = Instant::now() + self.timeout;
        loop {
            let left = deadline.saturating_duration_since(Instant::now()).max(Duration::from_secs(1));
            match f(&server.client, left) {
                Ok(v) => return Ok(v),
                Err(e) if e.is_retryable() && Instant::now() < deadline => std::thread::sleep(Duration::from_millis(100)),
                Err(e) => return Err(format!("clangd: {e}")),
            }
        }
    }

    /// Roots with a server (running or not), for tests and the log.
    pub fn roots(&self) -> Vec<CppRoot> {
        let mut r: Vec<CppRoot> = lock(&self.servers).values().map(|s| s.root.clone()).collect();
        r.sort_by(|a, b| a.dir.cmp(&b.dir));
        r
    }
}

/// Whether git tracks `<db>/.cache/clangd` as untracked noise: inside a work tree and not
/// ignored. Outside a repository nothing is reported.
fn index_not_ignored(root: &Path, db: &Path) -> bool {
    let index = db.join(".cache/clangd/index");
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(root).args(["check-ignore", "-q"]).arg(&index);
    let Ok(mut child) = cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn() else { return false };
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            // 0: ignored, 1: not ignored, 128: not a repository.
            Ok(Some(s)) => return s.code() == Some(1),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
}

/// clangd's hover markdown as signature and docs. clangd sends a heading (`### function
/// `add``), "provided by", the return type (`→ `int``), a parameter list, the comment, a rule
/// and the declaration in a `cpp` code block. The block becomes the signature; the heading,
/// the return type and the parameters (the signature shows them) are dropped, and the rest
/// loses its markdown.
pub fn clangd_hover(markdown: &str) -> HoverInfo {
    let mut code: Vec<&str> = Vec::new();
    let mut doc: Vec<String> = Vec::new();
    let (mut in_code, mut in_params) = (false, false);
    for line in markdown.lines() {
        let t = line.trim();
        if t.starts_with("```") {
            in_code = !in_code;
            continue;
        }
        if in_code {
            code.push(line);
            continue;
        }
        if in_params {
            if t.is_empty() || t.starts_with("- ") {
                continue;
            }
            in_params = false;
        }
        if t == "Parameters:" {
            in_params = true;
            continue;
        }
        if t.starts_with("###") || t == "---" || t.starts_with('→') {
            continue;
        }
        let plain = unescape_markdown(&t.replace('`', ""));
        if plain.is_empty() && doc.last().is_none_or(String::is_empty) {
            continue;
        }
        doc.push(plain);
    }
    while doc.last().is_some_and(String::is_empty) {
        doc.pop();
    }
    HoverInfo { display: code.join("\n").trim().to_string(), documentation: doc.join("\n"), tags: Vec::new() }
}

/// Drops markdown's backslash escapes (`\_`, `\*`).
fn unescape_markdown(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' && chars.peek().is_some_and(char::is_ascii_punctuation) {
            continue;
        }
        out.push(c);
    }
    out
}

/// Whether a navigation answer says nothing new: empty, or only the place it was asked at
/// (clangd answers the declaration itself while the definition is not indexed yet).
fn no_target(locs: &[Location], path: &Path, line: usize) -> bool {
    locs.iter().all(|l| l.path == path && l.line == line)
}

impl LanguageServer for CppService {
    fn open(&self, path: &Path, text: &str) {
        self.uht_hint(path, text);
        let Ok(server) = self.server_for(path) else { return };
        lock(&self.files).insert(path.to_path_buf(), server.root.dir.clone());
        if !server.client.is_running() {
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
        // `textDocument/declaration` is IDEA's Go to Declaration: on a use it lands on the
        // declaration, on a declaration clangd toggles to the definition (and back).
        let method = match kind {
            NavKind::Declaration | NavKind::Usages => "textDocument/declaration",
            NavKind::SourceDefinition => "textDocument/definition",
            NavKind::TypeDefinition => "textDocument/typeDefinition",
            NavKind::Implementation => "textDocument/implementation",
        };
        let server = self.server_for(path)?;
        let deadline = Instant::now() + self.timeout;
        loop {
            let locs = self.request(path, |c, t| c.locations(method, path, line, column, t))?;
            // The other file may not be indexed yet: wait for the index and ask again.
            if !no_target(&locs, path, line) || !server.indexing() || Instant::now() >= deadline {
                return Ok(locs);
            }
            server.wait_for_status((Instant::now() + Duration::from_millis(500)).min(deadline));
        }
    }

    fn references(&self, path: &Path, line: usize, column: usize) -> Result<Vec<Reference>, String> {
        // Usages in files that were never opened come from the background index.
        self.server_for(path)?.wait_for_index(INDEX_WAIT);
        self.request(path, |c, t| c.references(path, line, column, t))
    }

    fn hover(&self, path: &Path, line: usize, column: usize) -> Result<Option<HoverInfo>, String> {
        let hover = self.request(path, |c, t| c.hover(path, line, column, t))?;
        Ok(hover.map(|h| clangd_hover(&h.markdown)))
    }

    fn rename_symbol(&self, path: &Path, line: usize, column: usize, new_name: &str) -> Result<Vec<FileEdit>, String> {
        self.server_for(path)?.wait_for_index(INDEX_WAIT);
        self.request(path, |c, t| c.rename(path, line, column, new_name, t))
    }

    fn diagnostics(&self, path: &Path) -> Result<Option<Vec<ide_lsp::Diagnostic>>, String> {
        let server = self.server_for(path)?;
        let client = &server.client;
        if client.open_version(path).is_none() {
            return Ok(None);
        }
        // Wait for the push that belongs to the text clangd has now; an older push would put
        // the problems on the wrong lines.
        let deadline = Instant::now() + self.timeout;
        loop {
            let want = client.open_version(path).unwrap_or(0);
            let got = lock(&server.status.0).pushed.get(path).copied();
            if got.is_some_and(|v| v >= want) || Instant::now() >= deadline || !client.is_running() {
                break;
            }
            server.wait_for_status((Instant::now() + Duration::from_millis(250)).min(deadline));
        }
        client.diagnostics(path, self.timeout).map(Some).map_err(|e| format!("clangd: {e}"))
    }

    fn files_renamed(&self, old: &Path, _new: &Path) {
        let servers: Vec<Arc<ClangdServer>> = lock(&self.servers).values().cloned().collect();
        for s in servers {
            s.client.close_under(old);
        }
        lock(&self.files).retain(|p, _| !p.starts_with(old));
    }

    fn files_deleted(&self, path: &Path) {
        let servers: Vec<Arc<ClangdServer>> = lock(&self.servers).values().cloned().collect();
        for s in servers {
            s.client.close_under(path);
        }
        lock(&self.files).retain(|p, _| !p.starts_with(path));
    }

    fn status(&self, path: &Path) -> Option<String> {
        let root = lock(&self.files).get(path).cloned();
        match root.and_then(|r| lock(&self.servers).get(&r).cloned()) {
            Some(s) => Some(s.label()),
            None if matches!(&*lock(&self.exe), Some(Err(_))) => Some("no clangd".into()),
            None => None,
        }
    }

    fn stop_idle(&self, idle: Duration) -> Vec<String> {
        let servers: Vec<Arc<ClangdServer>> = lock(&self.servers).values().cloned().collect();
        let mut stopped = Vec::new();
        for s in servers {
            let idle_long = s.client.idle_for().is_some_and(|d| d >= idle);
            if idle_long && s.client.editor_files() == 0 {
                s.client.shutdown();
                s.reset_status();
                stopped.push(format!("clangd for {}", s.root.dir.display()));
            }
        }
        stopped
    }

    fn running(&self) -> usize {
        let servers: Vec<Arc<ClangdServer>> = lock(&self.servers).values().cloned().collect();
        servers.iter().filter(|s| s.client.is_running()).count()
    }

    fn take_notice(&self) -> Option<(String, String)> {
        lock(&self.notices).pop_front()
    }

    fn pids(&self) -> Vec<u32> {
        // Never waits: the map is locked only briefly, and a busy moment is skipped.
        let Ok(servers) = self.servers.try_lock() else { return Vec::new() };
        servers.values().filter_map(|s| s.client.pid()).collect()
    }

    fn configure(&self, config: &IdeConfig) {
        let new = config.cpp.clone();
        let old = std::mem::replace(&mut *lock(&self.config), new.clone());
        if !config.enabled(LangId::Cpp) || old != new {
            // The command line holds the settings, so running servers stop; the next request
            // starts them with the new ones and the open files.
            let servers: Vec<Arc<ClangdServer>> = lock(&self.servers).drain().map(|(_, s)| s).collect();
            for s in &servers {
                s.client.shutdown();
            }
            lock(&self.files).clear();
        }
        if old.clangd != new.clangd {
            *lock(&self.exe) = None;
            self.warned_missing.store(false, Ordering::SeqCst);
        }
        lock(&self.roots).clear();
    }

    fn shutdown(&self) {
        let servers: Vec<Arc<ClangdServer>> = lock(&self.servers).drain().map(|(_, s)| s).collect();
        for s in servers {
            s.client.shutdown();
        }
        lock(&self.files).clear();
    }

    fn restart_root(&self, dir: &Path, docs: &[(PathBuf, String)]) {
        let server = lock(&self.servers).remove(dir);
        if let Some(s) = server {
            s.client.shutdown();
        }
        let mut dropped: HashSet<PathBuf> = HashSet::new();
        lock(&self.files).retain(|path, root| {
            let keep = root != dir;
            if !keep {
                dropped.insert(path.clone());
            }
            keep
        });
        // Folders inside get their root again: the database there is new.
        lock(&self.roots).retain(|d, _| !d.starts_with(dir));
        lock(&self.hinted).remove(dir);
        for (path, text) in docs {
            if dropped.contains(path) || path.starts_with(dir) {
                self.open(path, text);
            }
        }
    }

    fn restart(&self) {
        self.shutdown();
        // A clangd installed since the last lookup is found, and a missing one is reported again.
        *lock(&self.exe) = None;
        self.warned_missing.store(false, Ordering::SeqCst);
        lock(&self.roots).clear();
        lock(&self.hinted).clear();
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
    fn root_follows_the_compile_database() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        // A database at the top.
        write(&root.join("a/compile_commands.json"), "[]");
        write(&root.join("a/src/x.cpp"), "");
        let r = find_root(&root.join("a/src/x.cpp"));
        assert_eq!((r.dir.as_path(), r.db_dir.as_deref(), r.has_db), (root.join("a").as_path(), Some(root.join("a").as_path()), true));
        assert_eq!(clangd_args(&r, &CppConfig::default()), ["--background-index=true", "--log=error"]);
        // CMake's build folder and CLion's cmake-build-* folders; debug wins.
        write(&root.join("b/build/compile_commands.json"), "[]");
        write(&root.join("b/src/x.cpp"), "");
        assert_eq!(find_root(&root.join("b/src/x.cpp")).db_dir.as_deref(), Some(root.join("b/build").as_path()));
        write(&root.join("c/cmake-build-release/compile_commands.json"), "[]");
        write(&root.join("c/cmake-build-debug/compile_commands.json"), "[]");
        write(&root.join("c/x.h"), "");
        let r = find_root(&root.join("c/x.h"));
        assert_eq!(r.db_dir.as_deref(), Some(root.join("c/cmake-build-debug").as_path()));
        let cfg = CppConfig { background_index: false, args: vec!["--clang-tidy".into()], ..CppConfig::default() };
        let args = clangd_args(&r, &cfg);
        assert_eq!(args[0], "--background-index=false");
        assert!(args.contains(&format!("--compile-commands-dir={}", root.join("c/cmake-build-debug").display())), "{args:?}");
        assert_eq!(args.last().map(String::as_str), Some("--clang-tidy"));
        // compile_flags.txt counts as a database; .clangd only marks the root.
        write(&root.join("d/compile_flags.txt"), "-std=c++20\n");
        write(&root.join("d/x.c"), "");
        assert!(find_root(&root.join("d/x.c")).has_db);
        write(&root.join("e/.clangd"), "CompileFlags:\n");
        write(&root.join("e/sub/x.c"), "");
        let r = find_root(&root.join("e/sub/x.c"));
        assert_eq!((r.dir.as_path(), r.has_db), (root.join("e").as_path(), false));
        // Nothing: the topmost CMakeLists.txt.
        write(&root.join("f/CMakeLists.txt"), "");
        write(&root.join("f/lib/CMakeLists.txt"), "");
        write(&root.join("f/lib/x.cpp"), "");
        let r = find_root(&root.join("f/lib/x.cpp"));
        assert_eq!((r.dir.as_path(), r.db_dir, r.has_db), (root.join("f").as_path(), None, false));
    }

    #[test]
    fn system_headers_are_library_files() {
        assert!(is_system_header(Path::new("/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/c++/v1/vector")));
        assert!(is_system_header(Path::new("/usr/include/stdio.h")));
        assert!(is_system_header(Path::new("/x/lib/clang/22/include/stddef.h")));
        assert!(is_library_path(Path::new("/usr/include/c++/13/bits/stl_vector.h")));
        assert!(!is_system_header(Path::new("/p/include/util.h")));
        assert!(!is_system_header(Path::new("/p/usr/src/main.cpp")));
        assert!(is_extensionless_std_header(Path::new("/sdk/usr/include/c++/v1/vector")));
        assert!(!is_extensionless_std_header(Path::new("/p/Makefile")));
        assert_eq!(LangId::for_path(Path::new("/sdk/usr/include/c++/v1/vector")), Some(LangId::Cpp));
        assert_eq!(LangId::for_path(Path::new("/p/a.h")), Some(LangId::Cpp));
        assert_eq!(LangId::for_path(Path::new("/p/a.c")), Some(LangId::Cpp));
    }

    #[test]
    fn versions_and_missing_server() {
        assert_eq!(parse_version("clangd version 22.1.6 (https://github.com/llvm/llvm-project fc4a)\nFeatures: mac\n").as_deref(), Some("22.1.6"));
        assert_eq!(parse_version("Apple clangd version 17.0.0 (clang-1700.0.13.5)\n").as_deref(), Some("17.0.0"));
        assert_eq!(parse_version("rust-analyzer 1.0\n"), None);
        let e = find_clangd(Some(Path::new("/nonexistent/clangd"))).unwrap_err();
        assert!(e.contains("/nonexistent/clangd") && e.contains("[cpp]"), "{e}");
        let e = find_clangd(Some(Path::new("/bin/echo"))).unwrap_err();
        assert!(e.contains("unexpected --version output"), "{e}");
    }

    #[test]
    fn hover_markdown_becomes_signature_and_docs() {
        let md = "### function `add`  \n\n---\nprovided by `\"geometry.h\"`  \n\n→ `int`  \nParameters:  \n\n- `int a`\n- `int b`\n\nAdds two numbers\\_fast.  \n\n---\n```cpp\nint add(int a, int b)\n```";
        let h = clangd_hover(md);
        assert_eq!(h.display, "int add(int a, int b)");
        assert_eq!(h.documentation, "provided by \"geometry.h\"\n\nAdds two numbers_fast.");
        let v = clangd_hover("### variable `total`  \n\nType: `int`  \n\n---\n```cpp\n// In main\nint total = add(1, 2)\n```");
        assert_eq!(v.display, "// In main\nint total = add(1, 2)");
        assert_eq!(v.documentation, "Type: int");
    }

    #[test]
    fn same_place_answers_count_as_no_target() {
        let at = |path: &str, line: usize| Location { path: PathBuf::from(path), line, column: 4 };
        assert!(no_target(&[], Path::new("/p/a.h"), 3));
        assert!(no_target(&[at("/p/a.h", 3)], Path::new("/p/a.h"), 3));
        assert!(!no_target(&[at("/p/a.cpp", 3)], Path::new("/p/a.h"), 3));
    }
}
