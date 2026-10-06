//! C# and Unity through the Roslyn language server (`Microsoft.CodeAnalysis.LanguageServer`,
//! the server behind VS Code's C# extension and C# Dev Kit; MIT, built from dotnet/roslyn),
//! one process per solution (rule 6).
//!
//! - Locating (never downloaded): `[csharp] server` in `.harwex/ide.toml` (the server dll, its
//!   folder or an apphost next to it; no fallback when set), else `HARWEX_ROSLYN`, else the
//!   server bundled with the C# extension of VS Code and its forks
//!   (`~/.vscode*/extensions/ms-dotnettools.csharp-*/.roslyn`), else the `roslyn-language-server`
//!   dotnet tool (`~/.dotnet/tools/.store`). `dotnet`: `[csharp] dotnet`, `HARWEX_DOTNET`, `DOTNET_ROOT`, PATH,
//!   `/usr/local/share/dotnet`, `~/.dotnet`. The server is framework-dependent and loads
//!   projects with the SDK's MSBuild, so the `dotnet` needs an SDK.
//! - Start: `dotnet <dll> --stdio`, with `DOTNET_ROOT`/`DOTNET_HOST_PATH` pointing at that
//!   `dotnet` and its own `TMPDIR` (`<temp>/harwex-ide-roslyn/<hash of the root>`): decompiled
//!   sources and logs land there, never in the project. The dir goes when the server stops.
//! - Root: the nearest folder upward with a `.sln`/`.slnx` (several: the one named like the
//!   folder, else the first by name), else the nearest folder with `.csproj` files. The server
//!   opens it from `solution/open` / `project/open`, sent right after `initialized`; it
//!   restores NuGet packages itself, reports `$/progress` ("Loading X.sln...", "Restore") and
//!   sends `workspace/projectInitializationComplete` when the projects are loaded. Requests
//!   that get nothing before that wait for it.
//! - Unity: a project root has `Assets/` and `ProjectSettings/`. Unity generates the `.sln`
//!   and `.csproj` files (External Tools, "Regenerate project files"); without them a notice
//!   says how. Analyzers the projects reference (`Microsoft.Unity.Analyzers`) run in the server.
//! - Library sources: Go to Declaration into a referenced assembly answers a file under the
//!   server's temp dir (`MetadataAsSource/<guid>/DecompilationMetadataAsSourceFileProvider/
//!   <guid>/List.cs`). It opens read-only as `[decompiled] List.cs` (`metadata_kind`), and
//!   requests from inside go to the server used last. Source generator output arrives as
//!   `roslyn-source-generated://` URIs and becomes an `ide_lsp` virtual document.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use ide_lsp::{default_capabilities, path_to_uri, ClientConfig, LspClient, VirtualRequest};
use serde_json::{json, Value};

use super::config::{CSharpConfig, IdeConfig};
use super::{is_library_path, lock, FileEdit, HoverInfo, LangId, LanguageServer, Location, Reference};
use crate::nav::NavKind;

/// How long a request may take in total, waits for the solution load included. A cold
/// solution load runs MSBuild and a NuGet restore first.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(40);
const SERVER_DLL: &str = "Microsoft.CodeAnalysis.LanguageServer.dll";
const INSTALL_HINT: &str = "Install the .NET SDK (https://dot.net) and the server: `dotnet tool install --global roslyn-language-server --prerelease` (or the C# extension of VS Code). Or set `server` under [csharp] in .harwex/ide.toml.";
const UNITY_HINT: &str = "In Unity open Edit › Preferences › External Tools, pick Visual Studio or Visual Studio Code as the External Script Editor and press \"Regenerate project files\".";
/// The folder under the temp dir that holds each server's own `TMPDIR`.
const TEMP_DIR_NAME: &str = "harwex-ide-roslyn";

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// The server dll behind a candidate path: the dll itself, its folder, or an apphost
/// (`roslyn-language-server`, `Microsoft.CodeAnalysis.LanguageServer`) next to it.
fn server_dll(candidate: &Path) -> Option<PathBuf> {
    let dll = if candidate.is_dir() {
        candidate.join(SERVER_DLL)
    } else if candidate.extension().is_some_and(|e| e == "dll") {
        candidate.to_path_buf()
    } else {
        candidate.with_file_name(SERVER_DLL)
    };
    dll.is_file().then_some(dll)
}

/// Numeric parts of a version-like name (`ms-dotnettools.csharp-2.93.22-darwin-arm64` ->
/// [2, 93, 22]), for picking the newest install.
fn version_key(name: &str) -> Vec<u64> {
    name.split(|c: char| !c.is_ascii_digit()).filter(|p| !p.is_empty()).filter_map(|p| p.parse().ok()).collect()
}

fn subdirs(dir: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = std::fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    out.sort();
    out
}

/// Servers on this machine, newest first within each place: the C# extension of VS Code and
/// its forks, then the `roslyn-language-server` dotnet tool.
fn known_installs(home: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    for editor in [".vscode", ".vscode-insiders", ".cursor", ".windsurf", ".vscode-oss"] {
        let mut exts: Vec<PathBuf> = subdirs(&home.join(editor).join("extensions"))
            .into_iter()
            .filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("ms-dotnettools.csharp-")))
            .collect();
        exts.sort_by_key(|p| std::cmp::Reverse(version_key(&p.file_name().unwrap_or_default().to_string_lossy())));
        found.extend(exts.into_iter().map(|e| e.join(".roslyn")));
    }
    // `.store/roslyn-language-server/<v>/roslyn-language-server.<rid>/<v>/tools/<tfm>/<rid>/`
    let store = home.join(".dotnet/tools/.store/roslyn-language-server");
    let mut versions = subdirs(&store);
    versions.sort_by_key(|p| std::cmp::Reverse(version_key(&p.file_name().unwrap_or_default().to_string_lossy())));
    for v in versions {
        for package in subdirs(&v) {
            for inner in subdirs(&package) {
                for tfm in subdirs(&inner.join("tools")) {
                    found.extend(subdirs(&tfm));
                }
            }
        }
    }
    found
}

/// Finds the server dll. `Err` says how to install it.
pub fn find_server(configured: Option<&Path>) -> Result<PathBuf, String> {
    if let Some(p) = configured {
        // An explicit path wins and has no fallback: silently running another server would
        // hide the typo.
        return server_dll(p).ok_or_else(|| format!("The C# language server was not found: csharp.server in .harwex/ide.toml is {} (no {SERVER_DLL} there). {INSTALL_HINT}", p.display()));
    }
    if let Some(p) = std::env::var_os("HARWEX_ROSLYN") {
        if let Some(dll) = server_dll(Path::new(&p)) {
            return Ok(dll);
        }
    }
    if let Some(dll) = home().and_then(|h| known_installs(&h).iter().find_map(|c| server_dll(c))) {
        return Ok(dll);
    }
    Err(format!("The C# language server (Roslyn) was not found. {INSTALL_HINT}"))
}

/// A `dotnet` with an SDK.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Dotnet {
    /// The executable, canonical.
    pub exe: PathBuf,
    /// Its folder (`DOTNET_ROOT`): `sdk/`, `shared/`, `packs/`.
    pub root: PathBuf,
}

/// The server dll and the `dotnet` that runs it.
#[derive(Clone, Debug)]
struct Tools {
    dll: PathBuf,
    dotnet: Dotnet,
}

/// A `dotnet` that has an SDK. Blocking (canonicalizes).
pub fn find_dotnet(configured: Option<&Path>) -> Result<Dotnet, String> {
    let exe = if cfg!(windows) { "dotnet.exe" } else { "dotnet" };
    let check = |p: &Path| -> Result<Dotnet, String> {
        let real = std::fs::canonicalize(p).map_err(|_| format!("{} does not exist", p.display()))?;
        let root = real.parent().map(Path::to_path_buf).unwrap_or_default();
        if subdirs(&root.join("sdk")).is_empty() {
            return Err(format!("{} has no .NET SDK (no {}/sdk)", p.display(), root.display()));
        }
        Ok(Dotnet { exe: real, root })
    };
    if let Some(p) = configured {
        return check(p).map_err(|why| format!("dotnet was not found: csharp.dotnet in .harwex/ide.toml: {why}. {INSTALL_HINT}"));
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(p) = std::env::var_os("HARWEX_DOTNET") {
        candidates.push(PathBuf::from(p));
    }
    if let Some(root) = std::env::var_os("DOTNET_ROOT") {
        candidates.push(PathBuf::from(root).join(exe));
    }
    candidates.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).map(|d| d.join(exe)));
    candidates.push(PathBuf::from("/usr/local/share/dotnet").join(exe));
    if let Some(h) = home() {
        candidates.push(h.join(".dotnet").join(exe));
    }
    let mut notes = Vec::new();
    for c in candidates.iter().filter(|c| c.is_file()) {
        match check(c) {
            Ok(found) => return Ok(found),
            Err(why) => notes.push(why),
        }
    }
    let searched = if notes.is_empty() { "not in DOTNET_ROOT, PATH, /usr/local/share/dotnet or ~/.dotnet".to_string() } else { notes.join("; ") };
    Err(format!("dotnet (the .NET SDK) was not found. {INSTALL_HINT}\n\nSearched: {searched}"))
}

/// What the server loads for a root.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RootTarget {
    Solution(PathBuf),
    Projects(Vec<PathBuf>),
}

/// The folder one server serves and what it opens there.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectRoot {
    pub dir: PathBuf,
    pub target: RootTarget,
    /// The folder is (inside) a Unity project.
    pub unity: bool,
}

impl ProjectRoot {
    /// The notification that makes the server load the target.
    fn open_notification(&self) -> (String, Value) {
        match &self.target {
            RootTarget::Solution(sln) => ("solution/open".into(), json!({"solution": path_to_uri(sln)})),
            RootTarget::Projects(projects) => ("project/open".into(), json!({"projects": projects.iter().map(|p| path_to_uri(p)).collect::<Vec<_>>()})),
        }
    }

    /// The solution or project file name, for logs.
    pub fn target_name(&self) -> String {
        let name = |p: &Path| p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        match &self.target {
            RootTarget::Solution(sln) => name(sln),
            RootTarget::Projects(p) if p.len() == 1 => name(&p[0]),
            RootTarget::Projects(p) => format!("{} projects", p.len()),
        }
    }
}

fn files_with(dir: &Path, exts: &[&str]) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().and_then(|e| e.to_str()).is_some_and(|e| exts.iter().any(|x| e.eq_ignore_ascii_case(x))))
        .collect();
    out.sort();
    out
}

/// The solution of a folder with several: the one named like the folder, else the first.
fn pick_solution(dir: &Path, solutions: &[PathBuf]) -> PathBuf {
    let folder = dir.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    solutions
        .iter()
        .find(|s| s.file_stem().is_some_and(|n| n.to_string_lossy().to_lowercase() == folder))
        .unwrap_or(&solutions[0])
        .clone()
}

/// The nearest folder above `file` that is a Unity project (`Assets/` and `ProjectSettings/`).
pub fn unity_root(file: &Path) -> Option<PathBuf> {
    file.ancestors().skip(1).find(|d| d.join("Assets").is_dir() && d.join("ProjectSettings").is_dir()).map(Path::to_path_buf)
}

/// The root of a C# file. `Err` explains what is missing (with the Unity hint inside a Unity
/// project).
pub fn find_root(file: &Path) -> Result<ProjectRoot, String> {
    let unity = unity_root(file);
    let ancestors = || file.ancestors().skip(1);
    let found = ancestors()
        .find_map(|dir| {
            let solutions = files_with(dir, &["sln", "slnx"]);
            (!solutions.is_empty()).then(|| (dir.to_path_buf(), RootTarget::Solution(pick_solution(dir, &solutions))))
        })
        .or_else(|| {
            ancestors().find_map(|dir| {
                let projects = files_with(dir, &["csproj"]);
                (!projects.is_empty()).then(|| (dir.to_path_buf(), RootTarget::Projects(projects)))
            })
        });
    match (found, unity) {
        (Some((dir, target)), unity) => {
            let unity = unity.is_some_and(|u| dir.starts_with(&u) || u.starts_with(&dir));
            Ok(ProjectRoot { dir, target, unity })
        }
        (None, Some(u)) => Err(format!("The Unity project {} has no .sln or .csproj files yet. {UNITY_HINT}", u.display())),
        (None, None) => Err(format!("No .sln, .slnx or .csproj above {}.", file.display())),
    }
}

/// The kind of a source file the server generated for a library symbol, by its place under a
/// server's temp dir: `decompiled` (ILSpy), `source` (Source Link or embedded sources) or
/// `metadata` (signatures only). `None` for every other path.
pub fn metadata_kind(path: &Path) -> Option<&'static str> {
    // Called for every tab and external path; most paths fail this cheap test.
    if !path.as_os_str().to_string_lossy().contains(TEMP_DIR_NAME) {
        return None;
    }
    let parts: Vec<String> = path.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    let temp = parts.iter().position(|p| p == TEMP_DIR_NAME)?;
    let meta = parts.iter().skip(temp).position(|p| p == "MetadataAsSource")? + temp;
    let provider = parts.get(meta + 2)?;
    Some(if provider.contains("Decompil") {
        "decompiled"
    } else if provider.contains("Pdb") || provider.contains("SourceLink") {
        "source"
    } else {
        "metadata"
    })
}

/// Roslyn's markdown escapes punctuation (`someone\.`) and ends lines with two spaces.
fn plain_markdown(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' && chars.peek().is_some_and(|n| n.is_ascii_punctuation()) {
            continue;
        }
        out.push(c);
    }
    out.lines().map(str::trim_end).collect::<Vec<_>>().join("\n").trim().to_string()
}

#[derive(Default)]
struct CsStatus {
    /// `workspace/projectInitializationComplete` arrived since the start.
    initialized: bool,
    /// Running `$/progress` tokens and their titles.
    progress: BTreeMap<String, String>,
    started: Option<Instant>,
}

impl CsStatus {
    fn loading(&self) -> bool {
        self.started.is_some() && !self.initialized
    }

    fn label(&self, unity: bool) -> String {
        if self.progress.values().any(|t| t.starts_with("Restore")) {
            "Roslyn: restoring packages…".into()
        } else if self.loading() || !self.progress.is_empty() {
            "Roslyn: loading solution…".into()
        } else if unity {
            "Roslyn (Unity)".into()
        } else {
            "Roslyn".into()
        }
    }
}

type Status = Arc<(Mutex<CsStatus>, Condvar)>;

struct CsServer {
    root: ProjectRoot,
    client: LspClient,
    status: Status,
    /// The server's `TMPDIR`: decompiled sources and logs.
    temp: PathBuf,
}

/// Where a root's server keeps its temp files. Stable per root, so a restarted server finds
/// the decompiled files that tabs still show.
fn temp_dir_for(root: &Path) -> PathBuf {
    let hash = root.to_string_lossy().bytes().fold(0xcbf2_9ce4_8422_2325u64, |h, b| (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3));
    std::env::temp_dir().join(TEMP_DIR_NAME).join(format!("{hash:016x}"))
}

impl CsServer {
    fn new(tools: &Tools, root: ProjectRoot, repaint: Arc<dyn Fn() + Send + Sync>) -> CsServer {
        let status: Status = Arc::default();
        let temp = ide_lsp::canonical(&{
            let t = temp_dir_for(&root.dir);
            let _ = std::fs::create_dir_all(&t);
            t
        });
        let (exe, dotnet_root) = (&tools.dotnet.exe, &tools.dotnet.root);
        let mut config = ClientConfig::new("roslyn", exe);
        config.args = vec![
            tools.dll.display().to_string(),
            "--stdio".into(),
            "--logLevel".into(),
            "Warning".into(),
            "--extensionLogDirectory".into(),
            temp.join("logs").display().to_string(),
        ];
        let path = std::env::var_os("PATH").unwrap_or_default();
        let path = std::env::join_paths(std::iter::once(dotnet_root.clone()).chain(std::env::split_paths(&path))).unwrap_or(path);
        config.env = vec![
            ("DOTNET_ROOT".into(), dotnet_root.display().to_string()),
            ("DOTNET_HOST_PATH".into(), exe.display().to_string()),
            ("PATH".into(), path.to_string_lossy().into_owned()),
            // .NET reads the temp dir from TMPDIR; a trailing `/` keeps it a directory.
            ("TMPDIR".into(), format!("{}/", temp.display())),
            ("DOTNET_CLI_TELEMETRY_OPTOUT".into(), "1".into()),
            ("DOTNET_NOLOGO".into(), "1".into()),
            ("DOTNET_SKIP_FIRST_TIME_EXPERIENCE".into(), "1".into()),
            // The restores the server runs must not leave MSBuild nodes behind its process group.
            ("MSBUILDDISABLENODEREUSE".into(), "1".into()),
            ("DOTNET_CLI_USE_MSBUILD_SERVER".into(), "0".into()),
        ];
        config.root = Some(root.dir.clone());
        config.cwd = Some(root.dir.clone());
        config.language_id = |_| "csharp";
        config.capabilities = default_capabilities();
        config.startup_notifications = vec![root.open_notification()];
        // A cold start of the .NET runtime plus MEF composition takes a few seconds.
        config.min_initialize_timeout = Duration::from_secs(60);
        config.configuration = Some(Arc::new(|item: &Value| {
            let section = item["section"].as_str().unwrap_or_default();
            match section.rsplit('|').next().unwrap_or_default() {
                // Go to Declaration into a library shows decompiled code, not signatures only.
                "navigation.dotnet_navigate_to_decompiled_sources" => json!(true),
                _ => Value::Null,
            }
        }));
        config.virtual_text = Some(Arc::new(|uri: &str| {
            uri.starts_with("roslyn-source-generated:").then(|| VirtualRequest {
                kind: "generated",
                method: "sourceGeneratedDocument/_roslyn_getText".into(),
                params: json!({"textDocument": {"uri": uri}}),
                name: None,
            })
        }));
        let st = status.clone();
        config.on_notification = Some(Arc::new(move |method: &str, params: &Value| {
            let (m, cv) = &*st;
            let mut s = lock(m);
            match method {
                "workspace/projectInitializationComplete" => s.initialized = true,
                "$/progress" => {
                    let token = match &params["token"] {
                        Value::String(t) => t.clone(),
                        other => other.to_string(),
                    };
                    match params["value"]["kind"].as_str() {
                        Some("begin") => {
                            s.progress.insert(token, params["value"]["title"].as_str().unwrap_or_default().to_string());
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
        CsServer { root, client: LspClient::new(config), status, temp }
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

    /// Blocks while the solution loads, at most until `until`.
    fn wait_loaded(&self, until: Instant) {
        while self.loading() && Instant::now() < until {
            self.wait_for_status((Instant::now() + Duration::from_millis(500)).min(until));
        }
    }

    fn reset_status(&self) {
        *lock(&self.status.0) = CsStatus { started: Some(Instant::now()), ..Default::default() };
    }

    fn stop(&self) {
        self.client.shutdown();
        *lock(&self.status.0) = CsStatus::default();
        let _ = std::fs::remove_dir_all(&self.temp);
    }
}

pub struct CSharpService {
    repaint: Arc<dyn Fn() + Send + Sync>,
    config: Mutex<CSharpConfig>,
    /// The server dll and dotnet, located once per configuration.
    tools: Mutex<Option<Result<Tools, String>>>,
    servers: Mutex<HashMap<PathBuf, Arc<CsServer>>>,
    /// Open editor file -> the root of its server.
    files: Mutex<HashMap<PathBuf, PathBuf>>,
    /// Directory -> its root (or why it has none), so the walk up runs once per directory.
    roots: Mutex<HashMap<PathBuf, Result<ProjectRoot, String>>>,
    /// The server used last; decompiled and generated documents go to it.
    last_root: Mutex<Option<PathBuf>>,
    notice: Mutex<Option<(String, String)>>,
    warned_missing: AtomicBool,
    /// Roots whose "no solution" notice was shown.
    warned_roots: Mutex<Vec<String>>,
    timeout: Duration,
}

impl CSharpService {
    pub fn new(repaint: Arc<dyn Fn() + Send + Sync>) -> CSharpService {
        CSharpService {
            repaint,
            config: Mutex::default(),
            tools: Mutex::default(),
            servers: Mutex::default(),
            files: Mutex::default(),
            roots: Mutex::default(),
            last_root: Mutex::default(),
            notice: Mutex::default(),
            warned_missing: AtomicBool::new(false),
            warned_roots: Mutex::default(),
            timeout: REQUEST_TIMEOUT,
        }
    }

    fn tools(&self) -> Result<Tools, String> {
        if let Some(found) = lock(&self.tools).clone() {
            return found;
        }
        // The probes run without the lock: `status` reads it on the UI thread.
        let config = lock(&self.config).clone();
        let found = find_server(config.server.as_deref()).and_then(|dll| Ok(Tools { dll, dotnet: find_dotnet(config.dotnet.as_deref())? }));
        *lock(&self.tools) = Some(found.clone());
        found
    }

    fn root_of(&self, path: &Path) -> Result<ProjectRoot, String> {
        let dir = path.parent().unwrap_or(path).to_path_buf();
        if let Some(r) = lock(&self.roots).get(&dir) {
            return r.clone();
        }
        let root = find_root(path).map(|mut r| {
            r.dir = ide_lsp::canonical(&r.dir);
            r
        });
        lock(&self.roots).insert(dir, root.clone());
        root
    }

    /// The server for a file, created (not started) if needed.
    fn server_for(&self, path: &Path) -> Result<Arc<CsServer>, String> {
        let known = lock(&self.files).get(path).cloned();
        let root = match known.and_then(|r| lock(&self.servers).get(&r).map(|s| s.root.clone())) {
            Some(root) => root,
            None => {
                let last = lock(&self.last_root).clone().and_then(|r| lock(&self.servers).get(&r).map(|s| s.root.clone()));
                match (is_library_path(path), last) {
                    (true, Some(last)) => last,
                    _ => match self.root_of(path) {
                        Ok(root) => root,
                        Err(why) => {
                            if why.contains("Unity") && !lock(&self.warned_roots).contains(&why) {
                                lock(&self.warned_roots).push(why.clone());
                                *lock(&self.notice) = Some(("Unity project files are missing".into(), why.clone()));
                            }
                            return Err(why);
                        }
                    },
                }
            }
        };
        let tools = match self.tools() {
            Ok(t) => t,
            Err(e) => {
                if !self.warned_missing.swap(true, Ordering::SeqCst) {
                    *lock(&self.notice) = Some(("C# language server not found".into(), e.clone()));
                }
                return Err(e);
            }
        };
        *lock(&self.last_root) = Some(root.dir.clone());
        let server = lock(&self.servers)
            .entry(root.dir.clone())
            .or_insert_with(|| Arc::new(CsServer::new(&tools, root.clone(), self.repaint.clone())))
            .clone();
        Ok(server)
    }

    /// Runs a request; an empty answer while the solution loads waits for the load, "content
    /// modified" retries after 100 ms. Gives up at the request timeout.
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
                Err(e) => return Err(format!("C# language server: {e}")),
            }
        }
    }

    /// Roots with a server (running or not), for tests and the log.
    pub fn roots(&self) -> Vec<ProjectRoot> {
        let mut r: Vec<ProjectRoot> = lock(&self.servers).values().map(|s| s.root.clone()).collect();
        r.sort_by(|a, b| a.dir.cmp(&b.dir));
        r
    }
}

impl LanguageServer for CSharpService {
    fn open(&self, path: &Path, text: &str) {
        let Ok(server) = self.server_for(path) else { return };
        lock(&self.files).insert(path.to_path_buf(), server.root.dir.clone());
        if !server.client.is_running() {
            server.reset_status();
            // An idle stop removed it.
            let _ = std::fs::create_dir_all(&server.temp);
        }
        server.client.open(path, text, self.timeout);
        (self.repaint)();
    }

    fn change(&self, path: &Path, text: &str) {
        let root = lock(&self.files).get(path).cloned();
        match root.and_then(|r| lock(&self.servers).get(&r).cloned()) {
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
            NavKind::Implementation => "textDocument/implementation",
            NavKind::Declaration | NavKind::SourceDefinition | NavKind::Usages => "textDocument/definition",
        };
        let mut found = self.retry(path, Vec::is_empty, |c, t| c.locations(method, path, line, column, t))?;
        // Roslyn lists implementations in no fixed order; the chooser should not shuffle.
        found.sort_by(|a, b| (&a.path, a.line, a.column).cmp(&(&b.path, b.line, b.column)));
        Ok(found)
    }

    fn references(&self, path: &Path, line: usize, column: usize) -> Result<Vec<Reference>, String> {
        self.retry(path, Vec::is_empty, |c, t| c.references(path, line, column, t))
    }

    fn hover(&self, path: &Path, line: usize, column: usize) -> Result<Option<HoverInfo>, String> {
        let hover = self.retry(path, Option::is_none, |c, t| c.hover(path, line, column, t))?;
        Ok(hover.map(|h| {
            let (display, documentation) = ide_lsp::split_hover_markdown(&h.markdown);
            HoverInfo { display, documentation: plain_markdown(&documentation), tags: Vec::new() }
        }))
    }

    fn rename_symbol(&self, path: &Path, line: usize, column: usize, new_name: &str) -> Result<Vec<FileEdit>, String> {
        let server = self.server_for(path)?;
        // A rename before the load would miss the other projects.
        server.wait_loaded(Instant::now() + self.timeout);
        self.retry(path, Vec::is_empty, |c, t| c.rename(path, line, column, new_name, t))
    }

    fn diagnostics(&self, path: &Path) -> Result<Option<Vec<ide_lsp::Diagnostic>>, String> {
        if is_library_path(path) {
            return Ok(None);
        }
        let server = self.server_for(path)?;
        // Before the load the file is a loose file: every type from another project would be
        // an error.
        server.wait_loaded(Instant::now() + self.timeout);
        let diags = self.retry(path, |_| false, |c, t| c.diagnostics(path, t))?;
        // Hidden-severity suggestions (`IDE0028` and the like) arrive as hints; only unused
        // code among them is worth drawing.
        Ok(Some(diags.into_iter().filter(|d| d.severity != ide_lsp::Severity::Hint || d.unnecessary).collect()))
    }

    fn status(&self, path: &Path) -> Option<String> {
        let root = lock(&self.files).get(path).cloned();
        match root.and_then(|r| lock(&self.servers).get(&r).cloned()) {
            Some(s) => Some(lock(&s.status.0).label(s.root.unity)),
            None if matches!(&*lock(&self.tools), Some(Err(_))) => Some("no Roslyn".into()),
            None => None,
        }
    }

    fn stop_idle(&self, idle: Duration) -> Vec<String> {
        let servers: Vec<Arc<CsServer>> = lock(&self.servers).values().cloned().collect();
        let mut stopped = Vec::new();
        for s in servers {
            let idle_long = s.client.idle_for().is_some_and(|d| d >= idle);
            if idle_long && s.client.editor_files() == 0 {
                s.stop();
                stopped.push(format!("Roslyn for {}", s.root.target_name()));
            }
        }
        stopped
    }

    fn running(&self) -> usize {
        let servers: Vec<Arc<CsServer>> = lock(&self.servers).values().cloned().collect();
        servers.iter().filter(|s| s.client.is_running()).count()
    }

    fn take_notice(&self) -> Option<(String, String)> {
        lock(&self.notice).take()
    }

    fn pids(&self) -> Vec<u32> {
        // Never waits: the map is locked only briefly, and a busy moment is skipped.
        let Ok(servers) = self.servers.try_lock() else { return Vec::new() };
        servers.values().filter_map(|s| s.client.pid()).collect()
    }

    fn configure(&self, config: &IdeConfig) {
        if !config.enabled(LangId::CSharp) {
            self.shutdown();
            return;
        }
        let new = config.csharp.clone();
        let old = std::mem::replace(&mut *lock(&self.config), new.clone());
        if old != new {
            // Running servers keep their process; the next start uses the new tools.
            *lock(&self.tools) = None;
            self.warned_missing.store(false, Ordering::SeqCst);
        }
        lock(&self.roots).clear();
    }

    fn shutdown(&self) {
        let servers: Vec<Arc<CsServer>> = lock(&self.servers).drain().map(|(_, s)| s).collect();
        for s in servers {
            s.stop();
        }
        lock(&self.files).clear();
    }

    fn restart(&self) {
        // Stop the processes but keep their temp dirs: open tabs still show decompiled files.
        let servers: Vec<Arc<CsServer>> = lock(&self.servers).drain().map(|(_, s)| s).collect();
        for s in servers {
            s.client.shutdown();
        }
        lock(&self.files).clear();
        *lock(&self.tools) = None;
        self.warned_missing.store(false, Ordering::SeqCst);
        lock(&self.warned_roots).clear();
        lock(&self.roots).clear();
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
    fn root_prefers_a_solution_named_like_its_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("Game");
        write(&root.join("Other.sln"), "");
        write(&root.join("Game.sln"), "");
        write(&root.join("src/App/App.csproj"), "");
        write(&root.join("src/App/Program.cs"), "");
        let r = find_root(&root.join("src/App/Program.cs")).unwrap();
        assert_eq!(r.dir, root);
        assert_eq!(r.target, RootTarget::Solution(root.join("Game.sln")));
        assert!(!r.unity);
        assert_eq!(r.target_name(), "Game.sln");

        std::fs::remove_file(root.join("Game.sln")).unwrap();
        write(&root.join("Zed.slnx"), "");
        let r = find_root(&root.join("src/App/Program.cs")).unwrap();
        assert_eq!(r.target, RootTarget::Solution(root.join("Other.sln")), "the first by name");
    }

    #[test]
    fn root_falls_back_to_the_nearest_project_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("lib");
        write(&dir.join("A.csproj"), "");
        write(&dir.join("B.csproj"), "");
        write(&dir.join("Sub/X.cs"), "");
        let r = find_root(&dir.join("Sub/X.cs")).unwrap();
        assert_eq!(r.target, RootTarget::Projects(vec![dir.join("A.csproj"), dir.join("B.csproj")]));
        assert_eq!(r.target_name(), "2 projects");
        let loose = tmp.path().join("loose/Y.cs");
        write(&loose, "");
        assert!(find_root(&loose).unwrap_err().contains("No .sln"));
    }

    #[test]
    fn unity_projects_are_detected_and_explained() {
        let tmp = tempfile::tempdir().unwrap();
        let u = tmp.path().join("MyGame");
        write(&u.join("Assets/Scripts/Player.cs"), "");
        std::fs::create_dir_all(u.join("ProjectSettings")).unwrap();
        let why = find_root(&u.join("Assets/Scripts/Player.cs")).unwrap_err();
        assert!(why.contains("Regenerate project files"), "{why}");
        write(&u.join("MyGame.sln"), "");
        write(&u.join("Assembly-CSharp.csproj"), "");
        let r = find_root(&u.join("Assets/Scripts/Player.cs")).unwrap();
        assert!(r.unity);
        assert_eq!(r.target, RootTarget::Solution(u.join("MyGame.sln")));
    }

    #[test]
    fn decompiled_files_are_recognised_by_their_place() {
        let base = Path::new("/t").join(TEMP_DIR_NAME).join("00ff/MetadataAsSource/abc");
        assert_eq!(metadata_kind(&base.join("DecompilationMetadataAsSourceFileProvider/def/List.cs")), Some("decompiled"));
        assert_eq!(metadata_kind(&base.join("PdbSourceDocument/def/List.cs")), Some("source"));
        assert_eq!(metadata_kind(&base.join("MetadataAsSourceFileProvider/def/List.cs")), Some("metadata"));
        assert_eq!(metadata_kind(Path::new("/p/MetadataAsSource/a/B/c/List.cs")), None, "only under our server temp dirs");
        assert_eq!(metadata_kind(Path::new("/p/src/List.cs")), None);
    }

    #[test]
    fn server_lookup_accepts_dll_folder_or_apphost() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("roslyn");
        write(&dir.join(SERVER_DLL), "");
        write(&dir.join("roslyn-language-server"), "");
        assert_eq!(server_dll(&dir), Some(dir.join(SERVER_DLL)));
        assert_eq!(server_dll(&dir.join(SERVER_DLL)), Some(dir.join(SERVER_DLL)));
        assert_eq!(server_dll(&dir.join("roslyn-language-server")), Some(dir.join(SERVER_DLL)));
        let e = find_server(Some(&tmp.path().join("nope"))).unwrap_err();
        assert!(e.contains("dotnet tool install --global roslyn-language-server"), "{e}");
        let e = find_dotnet(Some(&tmp.path().join("nope/dotnet"))).unwrap_err();
        assert!(e.contains("csharp.dotnet"), "{e}");
    }

    #[test]
    fn known_installs_pick_the_newest_extension_first() {
        let tmp = tempfile::tempdir().unwrap();
        let ext = tmp.path().join(".vscode/extensions");
        for v in ["2.9.1-darwin-arm64", "2.10.3-darwin-arm64"] {
            write(&ext.join(format!("ms-dotnettools.csharp-{v}/.roslyn/{SERVER_DLL}")), "");
        }
        let tool = tmp.path().join(".dotnet/tools/.store/roslyn-language-server/5.12.0-1.1/roslyn-language-server.osx-arm64/5.12.0-1.1/tools/net10.0/osx-arm64");
        write(&tool.join(SERVER_DLL), "");
        let found = known_installs(tmp.path());
        assert_eq!(found[0], ext.join("ms-dotnettools.csharp-2.10.3-darwin-arm64/.roslyn"));
        assert_eq!(found.last().unwrap(), &tool);
    }

    #[test]
    fn hover_markdown_loses_its_escapes() {
        assert_eq!(plain_markdown("Says hello to someone\\.  \nNext\\_line  "), "Says hello to someone.\nNext_line");
        assert_eq!(plain_markdown("a \\ b"), "a \\ b");
    }

    #[test]
    fn status_labels() {
        let mut s = CsStatus { started: Some(Instant::now()), ..Default::default() };
        assert_eq!(s.label(false), "Roslyn: loading solution…");
        s.progress.insert("t".into(), "Restore".into());
        assert_eq!(s.label(false), "Roslyn: restoring packages…");
        s.progress.clear();
        s.initialized = true;
        assert_eq!(s.label(false), "Roslyn");
        assert_eq!(s.label(true), "Roslyn (Unity)");
    }
}
