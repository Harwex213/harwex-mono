//! Unreal Engine projects for clangd (task 085). Everything here reads the disk or runs a
//! process: call it on a worker.
//!
//! - Detection is per file, like clangd's root: the project of a file is the nearest folder
//!   above it with a `*.uproject`, inside the opened folder (`project_dir`). An opened folder may
//!   hold several projects, each with its own engine, target and database. A folder with
//!   several `.uproject` files uses `[unreal] uproject`, else the one named like the folder,
//!   else the first by name (`pick_uproject`).
//! - The engine comes from `[unreal] engine` (or `[unreal.projects."<folder>"] engine`)
//!   in `.harwex/ide.toml`, else from the `.uproject`'s `EngineAssociation`: the Epic
//!   launcher's install list (`LauncherInstalled.dat`, macOS), the source-build list
//!   (`Install.ini`), or an engine tree around the project. These files are only read.
//! - The compile database: Unreal has none until UnrealBuildTool writes one. The user starts
//!   `Build.sh -mode=GenerateClangDatabase` from the editor banner (never automatically). UBT
//!   writes the full database into `<project>/.harwex/unreal/ubt` (`-OutputDir`), so nothing
//!   lands in the engine install. The app then keeps only the project's own files in
//!   `<project>/.harwex/unreal/compile_commands.json`, the folder clangd reads
//!   (`--compile-commands-dir`). clangd's background index therefore covers the project
//!   only; engine files get indexed when they are opened. `[unreal] index_engine = true`
//!   keeps the engine entries too.
//! - Scale: clangd for an Unreal root gets fewer workers, no header insertion, fewer results
//!   per answer, a low-priority index and preambles on disk (`scale_args`).
//! - UHT: `UCLASS()` and `GENERATED_BODY()` resolve only after Unreal Header Tool has written
//!   `*.generated.h` under `Intermediate/`. `missing_generated_header` finds a file whose
//!   generated header is missing, and the clangd adapter shows one hint per project.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::channel;
use std::time::{Duration, Instant};

use serde_json::Value;

use super::config::UnrealConfig;

/// The folder (under the project) that holds clangd's database and UBT's output.
pub const DB_DIR: &str = ".harwex/unreal";
/// Where UBT writes its full database (`-OutputDir`).
pub const UBT_DIR: &str = ".harwex/unreal/ubt";

/// The hint for a project whose `*.generated.h` files do not exist yet.
pub const UHT_HINT: &str = "Build the project once so Unreal Header Tool generates the headers";

/// An Unreal project as the app sees it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UnrealProject {
    /// The folder of the `.uproject`.
    pub root: PathBuf,
    pub uproject: PathBuf,
    /// The `.uproject` file name without the extension.
    pub name: String,
    /// `EngineAssociation` ("5.4", a GUID of a source build, or "" for an engine around it).
    pub association: String,
    pub engine: Result<Engine, String>,
    /// The UBT target (`<Name>Editor`), or why none was found.
    pub target: Result<String, String>,
    /// `<project>/.harwex/unreal/compile_commands.json` exists.
    pub has_db: bool,
    /// Every `.uproject` file name in the folder, sorted; more than one asks for a hint.
    pub uprojects: Vec<String>,
    /// Why `uproject` was picked among several.
    pub choice: Choice,
}

/// How the `.uproject` of a folder was chosen.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Choice {
    /// The folder has one.
    Only,
    /// `uproject` in `.harwex/ide.toml`.
    Configured,
    /// Named like the folder.
    FolderName,
    /// The first by name.
    First,
    /// The configured file name is not in the folder; the rules above picked another.
    Missing(String),
}

/// An engine install: the folder that holds `Engine/`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Engine {
    pub root: PathBuf,
    /// "5.4.4" from `Engine/Build/Build.version`.
    pub version: Option<String>,
}

impl UnrealProject {
    /// "UE 5.8" for the status bar, or `None` while the engine is unknown.
    pub fn engine_label(&self) -> Option<String> {
        let v = self.engine.as_ref().ok()?.version.as_deref()?;
        Some(format!("UE {}", v.split('.').take(2).collect::<Vec<_>>().join(".")))
    }

    /// The one-time hint for a folder with several `.uproject` files.
    pub fn choice_hint(&self) -> Option<String> {
        if self.uprojects.len() < 2 {
            return None;
        }
        let chosen = self.uproject.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let why = match &self.choice {
            Choice::Only => return None,
            Choice::Configured => "set by `uproject` under [unreal]".to_string(),
            Choice::FolderName => "it is named like the folder".to_string(),
            Choice::First => "it is the first by name".to_string(),
            Choice::Missing(name) => format!("{name} from `uproject` under [unreal] is not in the folder"),
        };
        Some(format!(
            "{} has {} .uproject files ({}). The IDE uses {chosen}: {why}. Set `uproject = \"<Name>.uproject\"` under [unreal] in .harwex/ide.toml to pick another.",
            self.root.display(),
            self.uprojects.len(),
            self.uprojects.join(", ")
        ))
    }

    pub fn database(&self) -> PathBuf {
        self.root.join(DB_DIR).join("compile_commands.json")
    }

    /// The command that writes the database, when the engine and the target are known.
    pub fn command(&self) -> Result<GenerateCommand, String> {
        let engine = self.engine.as_ref().map_err(Clone::clone)?;
        let target = self.target.as_ref().map_err(Clone::clone)?;
        Ok(generate_command(self, engine, target))
    }
}

/// The `*.uproject` files in `dir`, sorted by name.
pub fn uprojects(dir: &Path) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("uproject")) && p.is_file())
        .collect();
    found.sort();
    found
}

/// A `*.uproject` in `dir`, the first by name when there are several.
pub fn find_uproject(dir: &Path) -> Option<PathBuf> {
    uprojects(dir).into_iter().next()
}

/// The `.uproject` of a folder: `wanted` (a file name), else the one named like the folder,
/// else the first by name.
pub fn pick_uproject(dir: &Path, wanted: Option<&str>) -> Option<(PathBuf, Choice)> {
    let all = uprojects(dir);
    let name = |p: &PathBuf| p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if all.len() == 1 {
        return all.into_iter().next().map(|p| (p, Choice::Only));
    }
    if let Some(w) = wanted {
        if let Some(p) = all.iter().find(|p| name(p) == w || p.file_stem().is_some_and(|s| s == w)) {
            return Some((p.clone(), Choice::Configured));
        }
    }
    let folder = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let (p, choice) = match all.iter().find(|p| p.file_stem().is_some_and(|s| s.to_string_lossy() == folder)) {
        Some(p) => (p.clone(), Choice::FolderName),
        None => (all.first()?.clone(), Choice::First),
    };
    let choice = match wanted {
        Some(w) => Choice::Missing(w.to_string()),
        None => choice,
    };
    Some((p, choice))
}

/// The project folder of a file: the nearest folder above it with a `*.uproject`, not above
/// `top` (the opened folder). `None` for a file outside `top` or outside any project.
pub fn project_dir(file: &Path, top: &Path) -> Option<PathBuf> {
    file.ancestors().skip(1).take_while(|d| d.starts_with(top)).find(|d| find_uproject(d).is_some()).map(Path::to_path_buf)
}

/// `dir` relative to the opened folder, `/`-separated: the key of `[unreal.projects]`.
pub fn rel_key(dir: &Path, top: &Path) -> String {
    let rel = dir.strip_prefix(top).unwrap_or(dir);
    rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/")
}

/// A file whose change can change what `detect` finds: a `.uproject`, an engine's
/// `Build.version`, the source-build list or the Epic launcher's install list.
pub fn is_detection_input(path: &Path) -> bool {
    path.extension().is_some_and(|e| e.eq_ignore_ascii_case("uproject"))
        || path.file_name().is_some_and(|n| n == "Build.version" || n == "Install.ini" || n == "LauncherInstalled.dat")
}

/// The folders outside the opened one whose files `is_detection_input` names: the lists of
/// installed engines and each engine's `Engine/Build`. Only those that exist.
pub fn external_watch_dirs<'a>(engines: impl Iterator<Item = &'a Engine>) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = [launcher_dat_path(), install_ini_path()].into_iter().flatten().filter_map(|p| p.parent().map(Path::to_path_buf)).collect();
    dirs.extend(engines.map(|e| e.root.join("Engine/Build")));
    dirs.retain(|d| d.is_dir());
    dirs.sort();
    dirs.dedup();
    dirs
}

/// A folder clangd treats as an Unreal root: a project, or an engine tree (a source build
/// with its own database at the top).
pub fn is_unreal_dir(dir: &Path) -> bool {
    find_uproject(dir).is_some() || dir.join("Engine/Build/BatchFiles").is_dir()
}

/// The Unreal project at `root`, or `None` when the folder has no `.uproject`. `cfg` is the
/// project's own settings (`UnrealConfig::for_project`).
pub fn detect(root: &Path, cfg: &UnrealConfig) -> Option<UnrealProject> {
    let (uproject, choice) = pick_uproject(root, cfg.uproject.as_deref())?;
    let uprojects = uprojects(root).iter().filter_map(|p| p.file_name()).map(|n| n.to_string_lossy().into_owned()).collect();
    let name = uproject.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let association = std::fs::read_to_string(&uproject).ok().map(|t| engine_association(&t)).unwrap_or_default();
    let engine = find_engine(root, &association, cfg);
    let target = match &cfg.target {
        Some(t) => Ok(t.clone()),
        None => pick_target(&targets(root), &name).ok_or_else(|| format!("No Source/*.Target.cs in {}. Set `target` under [unreal] in .harwex/ide.toml.", root.display())),
    };
    let has_db = root.join(DB_DIR).join("compile_commands.json").is_file();
    Some(UnrealProject { root: root.to_path_buf(), uproject, name, association, engine, target, has_db, uprojects, choice })
}

/// `EngineAssociation` of a `.uproject` (JSON). Missing or broken: "".
pub fn engine_association(uproject: &str) -> String {
    serde_json::from_str::<Value>(uproject).ok().and_then(|v| v["EngineAssociation"].as_str().map(str::to_string)).unwrap_or_default()
}

/// The engine of a project; `Err` says what was tried.
pub fn find_engine(project: &Path, association: &str, cfg: &UnrealConfig) -> Result<Engine, String> {
    if let Some(p) = &cfg.engine {
        // An explicit path wins and has no fallback, like `cpp.clangd`.
        return engine_root(p).map(engine_at).ok_or_else(|| format!("unreal.engine in .harwex/ide.toml is {}, which has no Engine/Build/BatchFiles.", p.display()));
    }
    let mut tried = Vec::new();
    if !association.is_empty() {
        if let Some(dat) = launcher_dat_path() {
            if let Some(dir) = std::fs::read_to_string(&dat).ok().and_then(|t| launcher_location(&t, association)) {
                if let Some(root) = engine_root(&dir) {
                    return Ok(engine_at(root));
                }
                tried.push(format!("{} (from the Epic launcher)", dir.display()));
            }
        }
        if let Some(ini) = install_ini_path() {
            if let Some(dir) = std::fs::read_to_string(&ini).ok().and_then(|t| install_ini_location(&t, association)) {
                if let Some(root) = engine_root(&dir) {
                    return Ok(engine_at(root));
                }
                tried.push(format!("{} (from Install.ini)", dir.display()));
            }
        }
    }
    // A project inside an engine source tree (an empty association, or a sample).
    if let Some(root) = project.ancestors().skip(1).find_map(engine_root) {
        return Ok(engine_at(root));
    }
    let what = if association.is_empty() { "The engine of this project".to_string() } else { format!("Unreal Engine {association}") };
    let tried = if tried.is_empty() { String::new() } else { format!(" Tried: {}.", tried.join(", ")) };
    Err(format!("{what} was not found in the Epic launcher's install list.{tried} Set `engine` under [unreal] in .harwex/ide.toml."))
}

fn engine_at(root: PathBuf) -> Engine {
    let version = std::fs::read_to_string(root.join("Engine/Build/Build.version")).ok().and_then(|t| build_version(&t));
    Engine { root, version }
}

/// "5.4.4" from `Build.version`.
pub fn build_version(text: &str) -> Option<String> {
    let v: Value = serde_json::from_str(text).ok()?;
    Some(format!("{}.{}.{}", v["MajorVersion"].as_u64()?, v["MinorVersion"].as_u64()?, v["PatchVersion"].as_u64().unwrap_or(0)))
}

/// The engine root for a path to the root itself or to its `Engine` folder.
pub fn engine_root(path: &Path) -> Option<PathBuf> {
    if path.join("Engine/Build/BatchFiles").is_dir() {
        return Some(path.to_path_buf());
    }
    if path.file_name().is_some_and(|n| n == "Engine") && path.join("Build/BatchFiles").is_dir() {
        return path.parent().map(Path::to_path_buf);
    }
    None
}

/// The Epic launcher's install list (macOS only; there is no launcher on Linux).
fn launcher_dat_path() -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support/Epic/UnrealEngineLauncher/LauncherInstalled.dat"))
}

/// The list of registered source builds.
fn install_ini_path() -> Option<PathBuf> {
    let home = PathBuf::from(std::env::var_os("HOME")?);
    if cfg!(target_os = "macos") {
        Some(home.join("Library/Application Support/Epic/UnrealEngine/Install.ini"))
    } else {
        let config = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".config"));
        Some(config.join("Epic/UnrealEngine/Install.ini"))
    }
}

/// The install folder of `UE_<association>` in `LauncherInstalled.dat` (JSON).
pub fn launcher_location(dat: &str, association: &str) -> Option<PathBuf> {
    let v: Value = serde_json::from_str(dat).ok()?;
    let want = format!("UE_{association}");
    v["InstallationList"].as_array()?.iter().find(|i| i["AppName"].as_str() == Some(want.as_str())).and_then(|i| i["InstallLocation"].as_str()).map(PathBuf::from)
}

/// The folder of a source build in `Install.ini` (`[Installations]`, `<id>=<path>`). The id
/// is a GUID in braces or a name.
pub fn install_ini_location(ini: &str, association: &str) -> Option<PathBuf> {
    let want = association.trim_matches(|c| c == '{' || c == '}');
    let mut in_section = false;
    for line in ini.lines().map(str::trim) {
        if line.starts_with('[') {
            in_section = line.eq_ignore_ascii_case("[Installations]");
            continue;
        }
        let Some((key, value)) = line.split_once('=') else { continue };
        if in_section && key.trim().trim_matches(|c| c == '{' || c == '}').eq_ignore_ascii_case(want) {
            return Some(PathBuf::from(value.trim()));
        }
    }
    None
}

/// Target names from `Source/*.Target.cs`.
pub fn targets(project: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(project.join("Source"))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| e.file_name().to_str().and_then(|n| n.strip_suffix(".Target.cs")).map(str::to_string))
        .collect();
    names.sort();
    names
}

/// The editor target first: it compiles the editor-only code too, so clangd sees every file.
pub fn pick_target(names: &[String], project: &str) -> Option<String> {
    let editor = format!("{project}Editor");
    names
        .iter()
        .find(|n| **n == editor)
        .or_else(|| names.iter().find(|n| n.ends_with("Editor")))
        .or_else(|| names.iter().find(|n| *n == project))
        .or_else(|| names.first())
        .cloned()
}

/// The UBT platform name of this machine.
pub fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "Mac"
    } else {
        "Linux"
    }
}

/// One UBT run.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GenerateCommand {
    pub program: PathBuf,
    pub args: Vec<String>,
    /// UBT's output folder.
    pub output_dir: PathBuf,
    /// The database clangd reads.
    pub database: PathBuf,
    pub project: PathBuf,
    pub engine: PathBuf,
}

impl GenerateCommand {
    /// The command as a shell line, for the confirmation and the log.
    pub fn display(&self) -> String {
        std::iter::once(self.program.display().to_string()).chain(self.args.iter().cloned()).map(|a| shell_quote(&a)).collect::<Vec<_>>().join(" ")
    }
}

fn shell_quote(s: &str) -> String {
    if !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_=./:+,@".contains(c)) {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}

/// `<Engine>/Build/BatchFiles/<Mac|Linux>/Build.sh -mode=GenerateClangDatabase
/// -project=<.uproject> -game -engine -OutputDir=<project>/.harwex/unreal/ubt <Target> <Platform>
/// Development`. UE 5's `GenerateClangDatabase` has `-OutputDir`; without it UBT writes into the
/// engine folder.
pub fn generate_command(p: &UnrealProject, engine: &Engine, target: &str) -> GenerateCommand {
    let program = engine.root.join("Engine/Build/BatchFiles").join(platform()).join("Build.sh");
    let output_dir = p.root.join(UBT_DIR);
    let args = vec![
        "-mode=GenerateClangDatabase".to_string(),
        format!("-project={}", p.uproject.display()),
        "-game".to_string(),
        "-engine".to_string(),
        format!("-OutputDir={}", output_dir.display()),
        target.to_string(),
        platform().to_string(),
        "Development".to_string(),
    ];
    GenerateCommand { program, args, output_dir, database: p.database(), project: p.root.clone(), engine: engine.root.clone() }
}

/// What a finished run produced.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Generated {
    pub database: PathBuf,
    /// Entries kept for clangd.
    pub kept: usize,
    /// Entries UBT wrote.
    pub total: usize,
    pub took: Duration,
}

/// The error text of a cancelled run (`progress::is_cancel_text` knows it).
pub fn cancelled_text() -> String {
    format!("UnrealBuildTool was stopped ({})", ide_lsp::CANCELLED)
}

/// Runs UBT and writes clangd's database. `cancel` kills UBT's whole process group;
/// `progress` gets each output line. Blocking: run it on a worker.
pub fn run_generate(cmd: &GenerateCommand, keep_engine: bool, cancel: &AtomicBool, mut progress: impl FnMut(&str)) -> Result<Generated, String> {
    let started = Instant::now();
    let db_dir = cmd.database.parent().unwrap_or(&cmd.project).to_path_buf();
    std::fs::create_dir_all(&cmd.output_dir).map_err(|e| format!("{}: {e}", cmd.output_dir.display()))?;
    // Nothing the app writes here belongs in the project's git.
    let _ = std::fs::write(db_dir.join(".gitignore"), "*\n");
    let ubt_db = cmd.output_dir.join("compile_commands.json");
    let _ = std::fs::remove_file(&ubt_db);
    let mut command = Command::new(&cmd.program);
    command.args(&cmd.args).current_dir(&cmd.engine).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut command, 0);
    let mut child = command.spawn().map_err(|e| format!("Cannot start {}: {e}", cmd.program.display()))?;
    let (tx, rx) = channel::<String>();
    let mut readers = Vec::new();
    for out in [child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>), child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>)].into_iter().flatten() {
        let tx = tx.clone();
        readers.push(std::thread::spawn(move || {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        }));
    }
    drop(tx);
    let mut tail: Vec<String> = Vec::new();
    let mut take_lines = |tail: &mut Vec<String>| {
        while let Ok(line) = rx.try_recv() {
            progress(&line);
            tail.push(line);
            if tail.len() > 20 {
                tail.remove(0);
            }
        }
    };
    let status = loop {
        take_lines(&mut tail);
        if cancel.load(Ordering::SeqCst) {
            kill_group(&mut child);
            for r in readers {
                let _ = r.join();
            }
            return Err(cancelled_text());
        }
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(e) => return Err(e.to_string()),
        }
    };
    for r in readers {
        let _ = r.join();
    }
    take_lines(&mut tail);
    if !status.success() {
        return Err(format!("UnrealBuildTool failed ({status}).\n{}", tail.join("\n")));
    }
    let full = std::fs::read_to_string(&ubt_db).map_err(|e| format!("UnrealBuildTool wrote no {}: {e}\n{}", ubt_db.display(), tail.join("\n")))?;
    let (text, kept, total) = filter_database(&full, &cmd.project, keep_engine)?;
    let tmp = db_dir.join("compile_commands.json.tmp");
    std::fs::write(&tmp, text).and_then(|_| std::fs::rename(&tmp, &cmd.database)).map_err(|e| format!("{}: {e}", cmd.database.display()))?;
    Ok(Generated { database: cmd.database.clone(), kept, total, took: started.elapsed() })
}

/// Stops UBT and its children (dotnet, compilers): SIGTERM, then SIGKILL after 2 s.
fn kill_group(child: &mut std::process::Child) {
    #[cfg(unix)]
    {
        let pgid = child.id() as libc::pid_t;
        // SAFETY: plain syscalls on a process group this process created.
        unsafe { libc::killpg(pgid, libc::SIGTERM) };
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_))) {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        // SAFETY: as above; the group may be gone already, which is fine.
        unsafe { libc::killpg(pgid, libc::SIGKILL) };
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// The entries clangd gets: those of files inside the project (plugins included), or all
/// when `keep_engine`. Returns the JSON, the kept and the total count.
pub fn filter_database(full: &str, project: &Path, keep_engine: bool) -> Result<(String, usize, usize), String> {
    let entries: Vec<Value> = serde_json::from_str(full).map_err(|e| format!("UnrealBuildTool's compile_commands.json is not valid JSON: {e}"))?;
    let total = entries.len();
    let kept: Vec<Value> = entries
        .into_iter()
        .filter(|e| {
            keep_engine || {
                let file = Path::new(e["file"].as_str().unwrap_or_default());
                let file = if file.is_absolute() { file.to_path_buf() } else { Path::new(e["directory"].as_str().unwrap_or_default()).join(file) };
                file.starts_with(project)
            }
        })
        .collect();
    let n = kept.len();
    serde_json::to_string_pretty(&kept).map(|t| (t, n, total)).map_err(|e| e.to_string())
}

/// Engine sources and headers (`<root>/Engine/Source/...`, `Engine/Plugins`, ...): library
/// files, opened read-only.
pub fn is_engine_path(path: &Path) -> bool {
    let parts: Vec<&std::ffi::OsStr> = path.components().map(|c| c.as_os_str()).collect();
    parts.windows(2).any(|w| w[0] == "Engine" && ["Source", "Plugins", "Shaders", "Intermediate", "Platforms"].iter().any(|d| w[1] == *d))
}

/// clangd flags for an Unreal root. A flag the user set in `[cpp] args` wins.
pub fn scale_args(user: &[String]) -> Vec<String> {
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    let defaults = [
        format!("-j={}", (cores / 2).clamp(1, 4)),
        "--header-insertion=never".to_string(),
        "--limit-results=50".to_string(),
        "--background-index-priority=low".to_string(),
        "--pch-storage=disk".to_string(),
    ];
    defaults
        .into_iter()
        .filter(|d| {
            let name = d.split('=').next().unwrap_or(d);
            !user.iter().any(|u| u == name || u.starts_with(&format!("{name}=")) || (name == "-j" && u.starts_with("-j")))
        })
        .collect()
}

/// The first `#include "X.generated.h"` of `text` whose header UHT has not written yet, or
/// `None`. The header is looked for in `Intermediate/Build` of the module's owner (the
/// project or its plugin), at most a few levels deep.
pub fn missing_generated_header(file: &Path, text: &str, project: &Path) -> Option<String> {
    let names: Vec<&str> = text
        .lines()
        .filter_map(|l| {
            let l = l.trim_start();
            let rest = l.strip_prefix('#')?.trim_start().strip_prefix("include")?.trim();
            let name = rest.strip_prefix('"')?.split('"').next()?;
            name.ends_with(".generated.h").then_some(name)
        })
        .collect();
    if names.is_empty() {
        return None;
    }
    // The project or plugin folder that owns the file's `Intermediate`.
    let owner = file
        .ancestors()
        .skip(1)
        .take_while(|d| d.starts_with(project))
        .find(|d| *d == project || std::fs::read_dir(d).into_iter().flatten().flatten().any(|e| e.path().extension().is_some_and(|x| x == "uplugin")))
        .unwrap_or(project);
    let build = owner.join("Intermediate/Build");
    names.into_iter().find(|n| !find_file(&build, Path::new(n).file_name().unwrap_or_default(), 6)).map(str::to_string)
}

/// Whether a file named `name` lies under `dir`, at most `depth` folders down.
fn find_file(dir: &Path, name: &std::ffi::OsStr, depth: usize) -> bool {
    if dir.join(name).is_file() {
        return true;
    }
    if depth == 0 {
        return false;
    }
    std::fs::read_dir(dir).into_iter().flatten().flatten().any(|e| e.file_type().is_ok_and(|t| t.is_dir()) && find_file(&e.path(), name, depth - 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    #[test]
    fn launcher_and_install_lists() {
        let dat = r#"{"InstallationList": [
            {"InstallLocation": "/E/UE_5.4", "AppName": "QuixelBridge_5.4"},
            {"InstallLocation": "/E/UE_5.4", "AppName": "UE_5.4", "AppVersion": "5.4.4-1+++UE5+Release-5.4-Mac"},
            {"InstallLocation": "/E/UE_5.3", "AppName": "UE_5.3"}]}"#;
        assert_eq!(launcher_location(dat, "5.4"), Some(PathBuf::from("/E/UE_5.4")));
        assert_eq!(launcher_location(dat, "5.3"), Some(PathBuf::from("/E/UE_5.3")));
        assert_eq!(launcher_location(dat, "5.5"), None);
        assert_eq!(launcher_location("not json", "5.4"), None);
        let ini = "[Installations]\n{5D3E1A4B-0000-0000-0000-000000000001}=/src/UnrealEngine\nMyBuild=/src/Other\n[Other]\nX=/y\n";
        assert_eq!(install_ini_location(ini, "{5D3E1A4B-0000-0000-0000-000000000001}"), Some(PathBuf::from("/src/UnrealEngine")));
        assert_eq!(install_ini_location(ini, "mybuild"), Some(PathBuf::from("/src/Other")));
        assert_eq!(install_ini_location(ini, "X"), None);
        assert_eq!(engine_association(r#"{"FileVersion": 3, "EngineAssociation": "5.4"}"#), "5.4");
        assert_eq!(engine_association("{}"), "");
        assert_eq!(build_version(r#"{"MajorVersion": 5, "MinorVersion": 8, "PatchVersion": 3}"#).as_deref(), Some("5.8.3"));
    }

    #[test]
    fn detects_project_engine_and_target() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = tmp.path().join("UE_5.4");
        std::fs::create_dir_all(engine.join("Engine/Build/BatchFiles/Mac")).unwrap();
        write(&engine.join("Engine/Build/Build.version"), r#"{"MajorVersion": 5, "MinorVersion": 4, "PatchVersion": 4}"#);
        let game = tmp.path().join("Game");
        write(&game.join("Game.uproject"), r#"{"EngineAssociation": "5.4"}"#);
        write(&game.join("Source/Game.Target.cs"), "");
        write(&game.join("Source/GameEditor.Target.cs"), "");
        assert!(detect(&tmp.path().join("nothing"), &UnrealConfig::default()).is_none());
        // The configured engine; its `Engine` folder works too.
        for configured in [engine.clone(), engine.join("Engine")] {
            let cfg = UnrealConfig { engine: Some(configured), ..Default::default() };
            let p = detect(&game, &cfg).unwrap();
            assert_eq!((p.name.as_str(), p.association.as_str(), p.has_db), ("Game", "5.4", false));
            assert_eq!(p.engine, Ok(Engine { root: engine.clone(), version: Some("5.4.4".into()) }));
            assert_eq!(p.target.as_deref(), Ok("GameEditor"));
        }
        let bad = UnrealConfig { engine: Some(tmp.path().join("missing")), ..Default::default() };
        assert!(detect(&game, &bad).unwrap().engine.unwrap_err().contains("unreal.engine"));
        // A project inside an engine tree needs no association.
        let inner = engine.join("Samples/Lyra");
        write(&inner.join("Lyra.uproject"), "{}");
        assert_eq!(detect(&inner, &UnrealConfig::default()).unwrap().engine.map(|e| e.root), Ok(engine.clone()));
        assert!(is_unreal_dir(&game) && is_unreal_dir(&engine) && !is_unreal_dir(tmp.path()));

        let cfg = UnrealConfig { engine: Some(engine.clone()), ..Default::default() };
        let cmd = detect(&game, &cfg).unwrap().command().unwrap();
        assert_eq!(cmd.program, engine.join("Engine/Build/BatchFiles").join(platform()).join("Build.sh"));
        assert_eq!(cmd.args[0], "-mode=GenerateClangDatabase");
        assert_eq!(cmd.args[1], format!("-project={}", game.join("Game.uproject").display()));
        assert_eq!(cmd.args[4], format!("-OutputDir={}", game.join(".harwex/unreal/ubt").display()));
        assert_eq!(&cmd.args[5..], ["GameEditor", platform(), "Development"]);
        assert_eq!(cmd.database, game.join(".harwex/unreal/compile_commands.json"));
        assert!(cmd.display().contains(" -game -engine "), "{}", cmd.display());
    }

    #[test]
    fn targets_prefer_the_editor() {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(pick_target(&s(&["Game", "GameEditor", "GameServer"]), "Game").as_deref(), Some("GameEditor"));
        assert_eq!(pick_target(&s(&["Lyra", "LyraEditor"]), "Game").as_deref(), Some("LyraEditor"));
        assert_eq!(pick_target(&s(&["Client", "Game"]), "Game").as_deref(), Some("Game"));
        assert_eq!(pick_target(&[], "Game"), None);
    }

    #[test]
    fn database_keeps_the_project_files() {
        let full = r#"[
            {"file": "/p/Game/Source/Game/A.cpp", "command": "clang++ -c A.cpp", "directory": "/E/Engine/Source"},
            {"file": "/p/Game/Plugins/P/Source/P/B.cpp", "command": "clang++", "directory": "/E/Engine/Source"},
            {"file": "/E/Engine/Source/Runtime/Core/Private/C.cpp", "command": "clang++", "directory": "/E/Engine/Source"},
            {"file": "/p/GameOther/D.cpp", "command": "clang++", "directory": "/E/Engine/Source"}]"#;
        let (text, kept, total) = filter_database(full, Path::new("/p/Game"), false).unwrap();
        assert_eq!((kept, total), (2, 4));
        assert!(text.contains("A.cpp") && text.contains("B.cpp") && !text.contains("C.cpp"));
        assert_eq!(filter_database(full, Path::new("/p/Game"), true).unwrap().1, 4);
        assert!(filter_database("{", Path::new("/p"), false).is_err());
    }

    #[test]
    fn engine_files_are_read_only_and_scale_flags_yield_to_the_user() {
        assert!(is_engine_path(Path::new("/E/UE_5.4/Engine/Source/Runtime/Engine/Classes/GameFramework/Actor.h")));
        assert!(is_engine_path(Path::new("/E/UE_5.4/Engine/Plugins/Fab/Source/Fab.h")));
        assert!(crate::lang::is_library_path(Path::new("/E/UE_5.4/Engine/Source/Runtime/Core/Public/CoreMinimal.h")));
        assert!(!is_engine_path(Path::new("/p/Game/Source/Game/MyActor.h")));
        assert!(!is_engine_path(Path::new("/p/Engine/notes.txt")));
        let args = scale_args(&[]);
        assert!(args.iter().any(|a| a.starts_with("-j=")), "{args:?}");
        assert!(args.contains(&"--header-insertion=never".to_string()) && args.contains(&"--limit-results=50".to_string()));
        let args = scale_args(&["-j=12".into(), "--limit-results=0".into()]);
        assert!(!args.iter().any(|a| a.starts_with("-j") || a.starts_with("--limit-results")), "{args:?}");
    }

    #[test]
    fn clangd_root_and_flags_of_an_unreal_project() {
        use crate::lang::config::CppConfig;
        use crate::lang::cpp::{clangd_args, find_root};
        let tmp = tempfile::tempdir().unwrap();
        let game = tmp.path().join("Game");
        write(&game.join("Game.uproject"), "{}");
        write(&game.join("Source/Game/A.cpp"), "");
        write(&game.join("CMakeLists.txt"), "");
        // Before UBT ran: the project folder is the root, not a CMake or git folder.
        let r = find_root(&game.join("Source/Game/A.cpp"));
        assert_eq!((r.dir.as_path(), r.has_db, r.unreal), (game.as_path(), false, true));
        write(&game.join(".harwex/unreal/compile_commands.json"), "[]");
        let r = find_root(&game.join("Source/Game/A.cpp"));
        assert_eq!((r.dir.as_path(), r.db_dir.as_deref(), r.unreal), (game.as_path(), Some(game.join(".harwex/unreal").as_path()), true));
        let args = clangd_args(&r, &CppConfig::default());
        assert!(args.contains(&format!("--compile-commands-dir={}", game.join(".harwex/unreal").display())), "{args:?}");
        assert!(args.contains(&"--header-insertion=never".to_string()) && args.contains(&"--pch-storage=disk".to_string()), "{args:?}");
        let user = CppConfig { args: vec!["--header-insertion=iwyu".into()], ..CppConfig::default() };
        assert_eq!(clangd_args(&r, &user).iter().filter(|a| a.starts_with("--header-insertion")).count(), 1);
        // A database above a project never takes the project's files.
        write(&tmp.path().join("compile_commands.json"), "[]");
        write(&tmp.path().join("Game2/Game2.uproject"), "{}");
        let r = find_root(&tmp.path().join("Game2/Source/Game2/A.cpp"));
        assert_eq!((r.dir.as_path(), r.has_db, r.unreal), (tmp.path().join("Game2").as_path(), false, true));
        assert_eq!(find_root(&tmp.path().join("Other/B.cpp")).dir, tmp.path());
    }

    #[test]
    fn generated_headers_are_looked_up_in_intermediate() {
        let tmp = tempfile::tempdir().unwrap();
        let game = tmp.path().join("Game");
        let file = game.join("Source/Game/MyActor.h");
        let text = "#pragma once\n#include \"CoreMinimal.h\"\n# include \"MyActor.generated.h\"\n";
        assert_eq!(missing_generated_header(&file, text, &game).as_deref(), Some("MyActor.generated.h"));
        assert_eq!(missing_generated_header(&file, "#include \"CoreMinimal.h\"\n", &game), None);
        write(&game.join("Intermediate/Build/Mac/UnrealEditor/Inc/Game/UHT/MyActor.generated.h"), "");
        assert_eq!(missing_generated_header(&file, text, &game), None);
        // A plugin's headers live in its own Intermediate.
        write(&game.join("Plugins/Tools/Tools.uplugin"), "{}");
        let plugin_file = game.join("Plugins/Tools/Source/Tools/Public/Tool.h");
        let text = "#include \"Tool.generated.h\"\n";
        assert_eq!(missing_generated_header(&plugin_file, text, &game).as_deref(), Some("Tool.generated.h"));
        write(&game.join("Plugins/Tools/Intermediate/Build/Linux/UnrealEditor/Inc/Tools/UHT/Tool.generated.h"), "");
        assert_eq!(missing_generated_header(&plugin_file, text, &game), None);
    }

    #[test]
    fn several_projects_and_several_uprojects() {
        let tmp = tempfile::tempdir().unwrap();
        let top = tmp.path().join("Top");
        write(&top.join("Sub/Game1/Game1.uproject"), "{}");
        write(&top.join("Sub/Game2/Game2.uproject"), "{}");
        let file = top.join("Sub/Game2/Source/Game2/A.cpp");
        assert_eq!(project_dir(&file, &top), Some(top.join("Sub/Game2")));
        assert_eq!(project_dir(&top.join("Sub/notes.cpp"), &top), None);
        // Never above the opened folder.
        write(&tmp.path().join("Outer.uproject"), "{}");
        assert_eq!(project_dir(&top.join("Sub/notes.cpp"), &top), None);
        assert_eq!(project_dir(&top.join("Sub/notes.cpp"), tmp.path()).as_deref(), Some(tmp.path()));
        assert_eq!(rel_key(&top.join("Sub/Game2"), &top), "Sub/Game2");
        assert_eq!(rel_key(&top, &top), "");

        // Two `.uproject` files: the configured one, else the one named like the folder,
        // else the first by name.
        let pair = top.join("Pair");
        write(&pair.join("Zed.uproject"), "{}");
        write(&pair.join("Alpha.uproject"), "{}");
        let pick = |w: Option<&str>| pick_uproject(&pair, w).map(|(p, c)| (p.file_name().unwrap().to_string_lossy().into_owned(), c));
        assert_eq!(pick(None), Some(("Alpha.uproject".into(), Choice::First)));
        write(&pair.join("Pair.uproject"), "{}");
        assert_eq!(pick(None), Some(("Pair.uproject".into(), Choice::FolderName)));
        assert_eq!(pick(Some("Zed.uproject")), Some(("Zed.uproject".into(), Choice::Configured)));
        assert_eq!(pick(Some("Zed")), Some(("Zed.uproject".into(), Choice::Configured)));
        assert_eq!(pick(Some("Nope.uproject")), Some(("Pair.uproject".into(), Choice::Missing("Nope.uproject".into()))));
        let p = detect(&pair, &UnrealConfig::default()).unwrap();
        assert_eq!((p.name.as_str(), p.uprojects.len()), ("Pair", 3));
        let hint = p.choice_hint().unwrap();
        assert!(hint.contains("uses Pair.uproject: it is named like the folder") && hint.contains("`uproject = "), "{hint}");
        assert_eq!(detect(&top.join("Sub/Game1"), &UnrealConfig::default()).unwrap().choice_hint(), None);
        assert!(is_detection_input(Path::new("/x/A.uproject")) && is_detection_input(Path::new("/E/Engine/Build/Build.version")) && !is_detection_input(Path::new("/x/A.cpp")));
    }
}
