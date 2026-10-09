//! `.harwex/ide.toml`: optional per-project overrides (architecture rule 10).
//!
//! ```toml
//! languages = ["ts", "rust"]   # servers this project may start; leave out for all
//! idle_timeout_secs = 600      # stop an idle server after this long (default 10 min)
//!
//! [rust]
//! server = "/path/to/rust-analyzer"   # default: PATH, ~/.cargo/bin, rustup
//! idle_timeout_secs = 300
//! check_on_save = false               # `cargo check` after each save (default off)
//! build_scripts = true                # run build scripts for `OUT_DIR` and cfgs
//! proc_macros = true
//!
//! [rust.init]                         # merged into rust-analyzer's initializationOptions
//! cargo.features = "all"
//!
//! [csharp]
//! server = "/path/to/Microsoft.CodeAnalysis.LanguageServer.dll"  # or its folder; default: the
//!                                     # VS Code C# extension, the roslyn-language-server tool
//! dotnet = "/usr/local/share/dotnet/dotnet"  # default: DOTNET_ROOT, PATH, ~/.dotnet
//! idle_timeout_secs = 600
//!
//! [ts]
//! idle_timeout_secs = 600
//!
//! [cpp]
//! clangd = "/path/to/clangd"          # default: PATH, `xcrun --find clangd`, Homebrew LLVM
//! background_index = true             # clangd's index in <compile db dir>/.cache/clangd
//! args = ["--clang-tidy"]             # extra clangd arguments
//! idle_timeout_secs = 600
//!
//! [unreal]                            # projects with a *.uproject (tasks 085, 086)
//! engine = "/path/to/UE_5.4"          # default: EngineAssociation via the Epic launcher
//! target = "MyGameEditor"             # default: <Name>Editor from Source/*.Target.cs
//! index_engine = false                # clangd's database keeps only the project's files
//! uproject = "Game.uproject"          # a folder with several: default the one named like
//!                                     # the folder, else the first by name
//!
//! [unreal.projects."Sub/Game2"]       # one project (its folder, relative to this one);
//! engine = "/path/to/UE_5.8"          # any key above; the rest come from [unreal]
//!
//! [diagnostics]
//! ts = true                           # TypeScript errors from the TS server (default on)
//!
//! [diagnostics.oxlint]                # default: on where a package has an oxlint config
//! enabled = true
//! type_aware = true                   # default: on when oxlint-tsgolint is installed
//! type_check = false                  # TS errors from oxlint; default: on when supported
//!
//! [diagnostics.eslint]                # default: on where a package has an ESLint config
//! enabled = true
//!
//! [format.oxfmt]                    # Settings > Editor > oxfmt
//! on_save = false                     # format with the project's oxfmt on Cmd+S / Save All
//! extensions = ["ts", "tsx", "js"]    # file types it formats (default: JS/TS, JSON, CSS, md)
//! timeout_secs = 10                   # past it the file is saved unformatted
//!
//! [memory]
//! interval_secs = 15                  # how often the status bar's memory indicator samples
//!
//! [project]
//! excluded = ["dist", "build/out"]    # hidden from Search Everywhere and Find in Files
//! ```
//!
//! A missing file means defaults. A broken file also means defaults, plus a warning.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::Value;

use super::LangId;

pub const CONFIG_PATH: &str = ".harwex/ide.toml";
pub const DEFAULT_IDLE_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Clone, Debug, PartialEq)]
pub struct RustConfig {
    pub server: Option<PathBuf>,
    pub check_on_save: bool,
    pub build_scripts: bool,
    pub proc_macros: bool,
    /// Extra `initializationOptions`, merged over ours.
    pub init: Option<Value>,
}

impl Default for RustConfig {
    fn default() -> Self {
        RustConfig { server: None, check_on_save: false, build_scripts: true, proc_macros: true, init: None }
    }
}

/// `[cpp]`: clangd.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CppConfig {
    pub clangd: Option<PathBuf>,
    pub background_index: bool,
    /// Extra clangd command line arguments, after ours.
    pub args: Vec<String>,
}

impl Default for CppConfig {
    fn default() -> Self {
        CppConfig { clangd: None, background_index: true, args: Vec::new() }
    }
}

/// `[unreal]`: Unreal Engine projects (`lang/unreal.rs`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct UnrealConfig {
    /// The engine root (the folder with `Engine/`) or its `Engine` folder.
    pub engine: Option<PathBuf>,
    /// The UBT target for the compile database.
    pub target: Option<String>,
    /// Keep the engine's files in clangd's database, so the background index covers them.
    pub index_engine: bool,
    /// The `.uproject` file name to use in a folder that has several.
    pub uproject: Option<String>,
    /// `[unreal.projects."<folder>"]`: overrides per project folder, relative to the opened
    /// folder with `/` ("" is the opened folder itself).
    pub projects: std::collections::BTreeMap<String, UnrealOverride>,
}

/// One `[unreal.projects."<folder>"]` table. A key left out comes from `[unreal]`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct UnrealOverride {
    pub engine: Option<PathBuf>,
    pub target: Option<String>,
    pub index_engine: Option<bool>,
    pub uproject: Option<String>,
}

impl UnrealConfig {
    /// The settings of the project in `rel` (relative to the opened folder, `/`-separated).
    pub fn for_project(&self, rel: &str) -> UnrealConfig {
        let mut c = UnrealConfig { projects: Default::default(), ..self.clone() };
        if let Some(o) = self.projects.get(&project_key(rel)) {
            c.engine = o.engine.clone().or(c.engine);
            c.target = o.target.clone().or(c.target);
            c.index_engine = o.index_engine.unwrap_or(c.index_engine);
            c.uproject = o.uproject.clone().or(c.uproject);
        }
        c
    }
}

/// `./Sub/Game2/` and `Sub/Game2` are the same key; `.` and "" are the opened folder.
pub fn project_key(rel: &str) -> String {
    let k = rel.replace('\\', "/");
    let k = k.trim_start_matches("./").trim_matches('/');
    if k == "." {
        String::new()
    } else {
        k.to_string()
    }
}

/// `[csharp]`: the Roslyn language server and the `dotnet` that runs it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CSharpConfig {
    pub server: Option<PathBuf>,
    pub dotnet: Option<PathBuf>,
}

/// `[diagnostics]`. `None` means "decide from what the package has installed".
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DiagnosticsConfig {
    pub ts: Option<bool>,
    pub oxlint: OxlintConfig,
    pub eslint: EslintConfig,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EslintConfig {
    pub enabled: Option<bool>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct OxlintConfig {
    pub enabled: Option<bool>,
    pub type_aware: Option<bool>,
    pub type_check: Option<bool>,
}

/// `[format.oxfmt]`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OxfmtConfig {
    pub on_save: bool,
    /// Lowercase extensions without the dot.
    pub extensions: Vec<String>,
    pub timeout: Duration,
}

/// The file types oxfmt formats on save unless the project says otherwise. oxfmt 0.72 also
/// formats SCSS, Less, HTML, Vue, YAML, TOML and GraphQL; a project adds them by hand.
pub const OXFMT_DEFAULT_EXTENSIONS: [&str; 12] = ["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts", "json", "jsonc", "css", "md"];
pub const OXFMT_DEFAULT_TIMEOUT: Duration = Duration::from_secs(10);

impl Default for OxfmtConfig {
    fn default() -> Self {
        OxfmtConfig { on_save: false, extensions: OXFMT_DEFAULT_EXTENSIONS.iter().map(|e| e.to_string()).collect(), timeout: OXFMT_DEFAULT_TIMEOUT }
    }
}

impl OxfmtConfig {
    /// Whether on-save formatting covers `path` (by its extension, any case).
    pub fn covers(&self, path: &Path) -> bool {
        let Some(ext) = path.extension().and_then(|e| e.to_str()) else { return false };
        self.extensions.iter().any(|e| e.eq_ignore_ascii_case(ext))
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct IdeConfig {
    /// Languages whose servers may start. `None` means all.
    pub languages: Option<Vec<LangId>>,
    pub idle_timeout: Duration,
    pub ts_idle_timeout: Option<Duration>,
    pub rust_idle_timeout: Option<Duration>,
    pub rust: RustConfig,
    pub cpp: CppConfig,
    pub cpp_idle_timeout: Option<Duration>,
    pub unreal: UnrealConfig,
    pub csharp: CSharpConfig,
    pub csharp_idle_timeout: Option<Duration>,
    pub diagnostics: DiagnosticsConfig,
    /// `[format.oxfmt]`.
    pub oxfmt: OxfmtConfig,
    /// How often the memory indicator samples. At least one second.
    pub memory_interval: Duration,
    /// `[project] excluded`: folders relative to the root, `/`-separated, no trailing slash.
    pub excluded: Vec<String>,
    /// Problems to show once (parse errors, unknown keys or language names).
    pub warnings: Vec<String>,
    /// Where the file was read from; `None` when there is none.
    pub source: Option<PathBuf>,
}

impl Default for IdeConfig {
    fn default() -> Self {
        IdeConfig {
            languages: None,
            idle_timeout: DEFAULT_IDLE_TIMEOUT,
            ts_idle_timeout: None,
            rust_idle_timeout: None,
            rust: RustConfig::default(),
            cpp: CppConfig::default(),
            cpp_idle_timeout: None,
            unreal: UnrealConfig::default(),
            csharp: CSharpConfig::default(),
            csharp_idle_timeout: None,
            diagnostics: DiagnosticsConfig::default(),
            oxfmt: OxfmtConfig::default(),
            memory_interval: crate::memory::DEFAULT_INTERVAL,
            excluded: Vec::new(),
            warnings: Vec::new(),
            source: None,
        }
    }
}

impl IdeConfig {
    /// Reads `<root>/.harwex/ide.toml`. Blocking: call it on a worker.
    pub fn load(root: &Path) -> IdeConfig {
        let path = root.join(CONFIG_PATH);
        match std::fs::read_to_string(&path) {
            Ok(text) => {
                let mut config = IdeConfig::parse(&text);
                config.source = Some(path);
                config
            }
            Err(_) => IdeConfig::default(),
        }
    }

    pub fn parse(text: &str) -> IdeConfig {
        let mut config = IdeConfig::default();
        let table: toml::Table = match text.parse() {
            Ok(t) => t,
            Err(e) => {
                config.warnings.push(format!("{CONFIG_PATH} is not valid TOML, using defaults: {}", e.message()));
                return config;
            }
        };
        for (key, value) in &table {
            match key.as_str() {
                "languages" => match value.as_array() {
                    Some(items) => {
                        let mut langs = Vec::new();
                        for item in items {
                            match item.as_str().and_then(LangId::parse) {
                                Some(l) => langs.push(l),
                                None => {
                                    let known: Vec<&str> = LangId::ALL.iter().map(|l| l.key()).collect();
                                    config.warnings.push(format!("{CONFIG_PATH}: unknown language {item} (known: {})", known.join(", ")))
                                }
                            }
                        }
                        config.languages = Some(langs);
                    }
                    None => config.warnings.push(format!("{CONFIG_PATH}: `languages` must be a list like [\"ts\", \"rust\"]")),
                },
                "idle_timeout_secs" => {
                    if let Some(d) = secs(value, key, &mut config.warnings) {
                        config.idle_timeout = d;
                    }
                }
                "rust" => parse_rust(value, &mut config),
                "cpp" => parse_cpp(value, &mut config),
                "unreal" => parse_unreal(value, &mut config),
                "csharp" => parse_csharp(value, &mut config),
                "ts" => {
                    for (k, v) in value.as_table().into_iter().flatten() {
                        match k.as_str() {
                            "idle_timeout_secs" => config.ts_idle_timeout = secs(v, "ts.idle_timeout_secs", &mut config.warnings),
                            other => config.warnings.push(format!("{CONFIG_PATH}: unknown key ts.{other}")),
                        }
                    }
                }
                "diagnostics" => parse_diagnostics(value, &mut config),
                "format" => parse_format(value, &mut config),
                "memory" => {
                    for (k, v) in value.as_table().into_iter().flatten() {
                        match k.as_str() {
                            "interval_secs" => match secs(v, "memory.interval_secs", &mut config.warnings) {
                                Some(d) if d < Duration::from_secs(1) => config.warnings.push(format!("{CONFIG_PATH}: memory.interval_secs must be at least 1")),
                                Some(d) => config.memory_interval = d,
                                None => {}
                            },
                            other => config.warnings.push(format!("{CONFIG_PATH}: unknown key memory.{other}")),
                        }
                    }
                }
                "project" => {
                    for (k, v) in value.as_table().into_iter().flatten() {
                        match (k.as_str(), v.as_array()) {
                            ("excluded", Some(items)) => {
                                for item in items {
                                    match item.as_str() {
                                        Some(s) if !s.trim_matches('/').is_empty() => config.excluded.push(s.trim_matches('/').to_string()),
                                        _ => config.warnings.push(format!("{CONFIG_PATH}: project.excluded must list folder paths, not {item}")),
                                    }
                                }
                            }
                            ("excluded", None) => config.warnings.push(format!("{CONFIG_PATH}: project.excluded must be a list like [\"dist\"]")),
                            (other, _) => config.warnings.push(format!("{CONFIG_PATH}: unknown key project.{other}")),
                        }
                    }
                }
                other => config.warnings.push(format!("{CONFIG_PATH}: unknown key {other}")),
            }
        }
        config
    }

    /// The excluded folders as absolute paths under `root`.
    pub fn excluded_paths(&self, root: &Path) -> Vec<PathBuf> {
        self.excluded.iter().map(|rel| root.join(rel)).collect()
    }

    pub fn enabled(&self, lang: LangId) -> bool {
        self.languages.as_ref().is_none_or(|l| l.contains(&lang))
    }

    pub fn idle_timeout(&self, lang: LangId) -> Duration {
        let own = match lang {
            LangId::TypeScript => self.ts_idle_timeout,
            LangId::Rust => self.rust_idle_timeout,
            LangId::Cpp => self.cpp_idle_timeout,
            LangId::CSharp => self.csharp_idle_timeout,
        };
        own.unwrap_or(self.idle_timeout)
    }
}

fn parse_rust(value: &toml::Value, config: &mut IdeConfig) {
    let Some(table) = value.as_table() else {
        config.warnings.push(format!("{CONFIG_PATH}: [rust] must be a table"));
        return;
    };
    for (k, v) in table {
        let flag = |warnings: &mut Vec<String>| match v.as_bool() {
            Some(b) => Some(b),
            None => {
                warnings.push(format!("{CONFIG_PATH}: rust.{k} must be true or false"));
                None
            }
        };
        match k.as_str() {
            "server" => match v.as_str() {
                Some(s) => config.rust.server = Some(expand_home(s)),
                None => config.warnings.push(format!("{CONFIG_PATH}: rust.server must be a path")),
            },
            "idle_timeout_secs" => config.rust_idle_timeout = secs(v, "rust.idle_timeout_secs", &mut config.warnings),
            "check_on_save" => config.rust.check_on_save = flag(&mut config.warnings).unwrap_or(config.rust.check_on_save),
            "build_scripts" => config.rust.build_scripts = flag(&mut config.warnings).unwrap_or(config.rust.build_scripts),
            "proc_macros" => config.rust.proc_macros = flag(&mut config.warnings).unwrap_or(config.rust.proc_macros),
            "init" => match serde_json::to_value(v) {
                Ok(json @ Value::Object(_)) => config.rust.init = Some(json),
                _ => config.warnings.push(format!("{CONFIG_PATH}: [rust.init] must be a table")),
            },
            other => config.warnings.push(format!("{CONFIG_PATH}: unknown key rust.{other}")),
        }
    }
}

fn parse_csharp(value: &toml::Value, config: &mut IdeConfig) {
    let Some(table) = value.as_table() else {
        config.warnings.push(format!("{CONFIG_PATH}: [csharp] must be a table"));
        return;
    };
    for (k, v) in table {
        let path = |warnings: &mut Vec<String>| match v.as_str() {
            Some(s) => Some(expand_home(s)),
            None => {
                warnings.push(format!("{CONFIG_PATH}: csharp.{k} must be a path"));
                None
            }
        };
        match k.as_str() {
            "server" => config.csharp.server = path(&mut config.warnings),
            "dotnet" => config.csharp.dotnet = path(&mut config.warnings),
            "idle_timeout_secs" => config.csharp_idle_timeout = secs(v, "csharp.idle_timeout_secs", &mut config.warnings),
            other => config.warnings.push(format!("{CONFIG_PATH}: unknown key csharp.{other}")),
        }
    }
}

fn parse_cpp(value: &toml::Value, config: &mut IdeConfig) {
    let Some(table) = value.as_table() else {
        config.warnings.push(format!("{CONFIG_PATH}: [cpp] must be a table"));
        return;
    };
    for (k, v) in table {
        match k.as_str() {
            "clangd" => match v.as_str() {
                Some(s) => config.cpp.clangd = Some(expand_home(s)),
                None => config.warnings.push(format!("{CONFIG_PATH}: cpp.clangd must be a path")),
            },
            "background_index" => match v.as_bool() {
                Some(b) => config.cpp.background_index = b,
                None => config.warnings.push(format!("{CONFIG_PATH}: cpp.background_index must be true or false")),
            },
            "args" => match v.as_array().map(|a| a.iter().map(|x| x.as_str().map(str::to_string)).collect::<Option<Vec<String>>>()) {
                Some(Some(args)) => config.cpp.args = args,
                _ => config.warnings.push(format!("{CONFIG_PATH}: cpp.args must be a list of strings")),
            },
            "idle_timeout_secs" => config.cpp_idle_timeout = secs(v, "cpp.idle_timeout_secs", &mut config.warnings),
            other => config.warnings.push(format!("{CONFIG_PATH}: unknown key cpp.{other}")),
        }
    }
}

fn parse_unreal(value: &toml::Value, config: &mut IdeConfig) {
    let Some(table) = value.as_table() else {
        config.warnings.push(format!("{CONFIG_PATH}: [unreal] must be a table"));
        return;
    };
    for (k, v) in table {
        match (k.as_str(), v) {
            ("engine", toml::Value::String(s)) => config.unreal.engine = Some(expand_home(s)),
            ("target", toml::Value::String(s)) => config.unreal.target = Some(s.clone()),
            ("index_engine", toml::Value::Boolean(b)) => config.unreal.index_engine = *b,
            ("uproject", toml::Value::String(s)) => config.unreal.uproject = Some(s.clone()),
            ("projects", toml::Value::Table(projects)) => {
                for (folder, t) in projects {
                    let Some(t) = t.as_table() else {
                        config.warnings.push(format!("{CONFIG_PATH}: unreal.projects.\"{folder}\" must be a table"));
                        continue;
                    };
                    let mut o = UnrealOverride::default();
                    for (k, v) in t {
                        let at = format!("unreal.projects.\"{folder}\".{k}");
                        match (k.as_str(), v) {
                            ("engine", toml::Value::String(s)) => o.engine = Some(expand_home(s)),
                            ("target", toml::Value::String(s)) => o.target = Some(s.clone()),
                            ("index_engine", toml::Value::Boolean(b)) => o.index_engine = Some(*b),
                            ("uproject", toml::Value::String(s)) => o.uproject = Some(s.clone()),
                            ("engine" | "target" | "index_engine" | "uproject", _) => config.warnings.push(format!("{CONFIG_PATH}: {at} has the wrong type")),
                            _ => config.warnings.push(format!("{CONFIG_PATH}: unknown key {at}")),
                        }
                    }
                    config.unreal.projects.insert(project_key(folder), o);
                }
            }
            ("engine", _) => config.warnings.push(format!("{CONFIG_PATH}: unreal.engine must be a path")),
            ("target", _) => config.warnings.push(format!("{CONFIG_PATH}: unreal.target must be a target name")),
            ("index_engine", _) => config.warnings.push(format!("{CONFIG_PATH}: unreal.index_engine must be true or false")),
            ("uproject", _) => config.warnings.push(format!("{CONFIG_PATH}: unreal.uproject must be a file name")),
            ("projects", _) => config.warnings.push(format!("{CONFIG_PATH}: unreal.projects must be a table of project folders")),
            (other, _) => config.warnings.push(format!("{CONFIG_PATH}: unknown key unreal.{other}")),
        }
    }
}

fn parse_diagnostics(value: &toml::Value, config: &mut IdeConfig) {
    let Some(table) = value.as_table() else {
        config.warnings.push(format!("{CONFIG_PATH}: [diagnostics] must be a table"));
        return;
    };
    let flag = |v: &toml::Value, key: &str, warnings: &mut Vec<String>| match v.as_bool() {
        Some(b) => Some(b),
        None => {
            warnings.push(format!("{CONFIG_PATH}: {key} must be true or false"));
            None
        }
    };
    for (k, v) in table {
        match k.as_str() {
            "ts" => config.diagnostics.ts = flag(v, "diagnostics.ts", &mut config.warnings),
            "oxlint" => {
                let Some(ox) = v.as_table() else {
                    config.warnings.push(format!("{CONFIG_PATH}: [diagnostics.oxlint] must be a table"));
                    continue;
                };
                for (k, v) in ox {
                    let key = format!("diagnostics.oxlint.{k}");
                    let slot = match k.as_str() {
                        "enabled" => &mut config.diagnostics.oxlint.enabled,
                        "type_aware" => &mut config.diagnostics.oxlint.type_aware,
                        "type_check" => &mut config.diagnostics.oxlint.type_check,
                        _ => {
                            config.warnings.push(format!("{CONFIG_PATH}: unknown key {key}"));
                            continue;
                        }
                    };
                    *slot = flag(v, &key, &mut config.warnings);
                }
            }
            "eslint" => {
                let Some(es) = v.as_table() else {
                    config.warnings.push(format!("{CONFIG_PATH}: [diagnostics.eslint] must be a table"));
                    continue;
                };
                for (k, v) in es {
                    match k.as_str() {
                        "enabled" => config.diagnostics.eslint.enabled = flag(v, "diagnostics.eslint.enabled", &mut config.warnings),
                        _ => config.warnings.push(format!("{CONFIG_PATH}: unknown key diagnostics.eslint.{k}")),
                    }
                }
            }
            other => config.warnings.push(format!("{CONFIG_PATH}: unknown key diagnostics.{other}")),
        }
    }
}

fn parse_format(value: &toml::Value, config: &mut IdeConfig) {
    let Some(table) = value.as_table() else {
        config.warnings.push(format!("{CONFIG_PATH}: [format] must be a table"));
        return;
    };
    for (k, v) in table {
        if k != "oxfmt" {
            config.warnings.push(format!("{CONFIG_PATH}: unknown key format.{k}"));
            continue;
        }
        let Some(ox) = v.as_table() else {
            config.warnings.push(format!("{CONFIG_PATH}: [format.oxfmt] must be a table"));
            continue;
        };
        for (k, v) in ox {
            match (k.as_str(), v) {
                ("on_save", toml::Value::Boolean(b)) => config.oxfmt.on_save = *b,
                ("on_save", _) => config.warnings.push(format!("{CONFIG_PATH}: format.oxfmt.on_save must be true or false")),
                ("extensions", toml::Value::Array(items)) if items.iter().all(|i| i.is_str()) => {
                    config.oxfmt.extensions = items.iter().filter_map(|i| i.as_str()).map(normalize_extension).filter(|e| !e.is_empty()).collect();
                }
                ("extensions", _) => config.warnings.push(format!("{CONFIG_PATH}: format.oxfmt.extensions must be a list like [\"ts\", \"js\"]")),
                ("timeout_secs", v) => {
                    if let Some(d) = secs(v, "format.oxfmt.timeout_secs", &mut config.warnings) {
                        config.oxfmt.timeout = d;
                    }
                }
                (other, _) => config.warnings.push(format!("{CONFIG_PATH}: unknown key format.oxfmt.{other}")),
            }
        }
    }
}

/// `".TS"` and `"ts"` name the same file type.
pub fn normalize_extension(e: &str) -> String {
    e.trim().trim_start_matches('.').to_ascii_lowercase()
}

/// Seconds as a `Duration`. Fractions are allowed, so tests can use a short timeout.
fn secs(value: &toml::Value, key: &str, warnings: &mut Vec<String>) -> Option<Duration> {
    let n = value.as_float().or_else(|| value.as_integer().map(|i| i as f64));
    match n {
        Some(n) if n >= 0.0 && n.is_finite() => Some(Duration::from_secs_f64(n)),
        _ => {
            warnings.push(format!("{CONFIG_PATH}: {key} must be a number of seconds"));
            None
        }
    }
}

fn expand_home(s: &str) -> PathBuf {
    match (s.strip_prefix("~/"), std::env::var_os("HOME")) {
        (Some(rest), Some(home)) => PathBuf::from(home).join(rest),
        _ => PathBuf::from(s),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_means_defaults() {
        let dir = std::env::temp_dir().join("harwex-ide-no-such-project");
        let c = IdeConfig::load(&dir);
        assert_eq!(c, IdeConfig::default());
        assert!(c.enabled(LangId::Rust) && c.enabled(LangId::TypeScript));
        assert_eq!(c.idle_timeout(LangId::Rust), Duration::from_secs(600));
        assert!(!c.rust.check_on_save, "cargo check on save is off by default");
    }

    #[test]
    fn full_file() {
        let c = IdeConfig::parse(
            "languages = [\"ts\"]\nidle_timeout_secs = 60\n\n[rust]\nserver = \"/opt/ra\"\nidle_timeout_secs = 0.5\ncheck_on_save = true\nbuild_scripts = false\n\n[rust.init]\ncargo.features = \"all\"\n\n[ts]\nidle_timeout_secs = 30\n",
        );
        assert!(c.warnings.is_empty(), "{:?}", c.warnings);
        assert_eq!(c.languages, Some(vec![LangId::TypeScript]));
        assert!(!c.enabled(LangId::Rust));
        assert_eq!(c.idle_timeout(LangId::Rust), Duration::from_millis(500));
        assert_eq!(c.idle_timeout(LangId::TypeScript), Duration::from_secs(30));
        assert_eq!(c.rust.server.as_deref(), Some(Path::new("/opt/ra")));
        assert!(c.rust.check_on_save && !c.rust.build_scripts && c.rust.proc_macros);
        assert_eq!(c.rust.init, Some(serde_json::json!({"cargo": {"features": "all"}})));
    }

    #[test]
    fn cpp_section() {
        let c = IdeConfig::default();
        assert!(c.cpp.background_index && c.cpp.clangd.is_none());
        let c = IdeConfig::parse("languages = [\"cpp\"]\n[cpp]\nclangd = \"/opt/llvm/bin/clangd\"\nbackground_index = false\nargs = [\"--clang-tidy\"]\nidle_timeout_secs = 5\n");
        assert!(c.warnings.is_empty(), "{:?}", c.warnings);
        assert!(c.enabled(LangId::Cpp) && !c.enabled(LangId::Rust));
        assert_eq!(c.cpp.clangd.as_deref(), Some(Path::new("/opt/llvm/bin/clangd")));
        assert!(!c.cpp.background_index);
        assert_eq!(c.cpp.args, ["--clang-tidy"]);
        assert_eq!(c.idle_timeout(LangId::Cpp), Duration::from_secs(5));
        let bad = IdeConfig::parse("[cpp]\nargs = \"-x\"\nbackground_index = 1\nflags = 2\n");
        assert_eq!(bad.warnings.len(), 3, "{:?}", bad.warnings);
    }

    #[test]
    fn unreal_section() {
        assert_eq!(IdeConfig::default().unreal, UnrealConfig::default());
        let c = IdeConfig::parse("[unreal]\nengine = \"/E/UE_5.4\"\ntarget = \"GameEditor\"\nindex_engine = true\n");
        assert!(c.warnings.is_empty(), "{:?}", c.warnings);
        assert_eq!(c.unreal, UnrealConfig { engine: Some(PathBuf::from("/E/UE_5.4")), target: Some("GameEditor".into()), index_engine: true, ..Default::default() });
        let bad = IdeConfig::parse("[unreal]\nengine = 1\nindex_engine = \"yes\"\nversion = 5\n");
        assert_eq!(bad.warnings.len(), 3, "{:?}", bad.warnings);
        // Per-project tables override the top-level keys; the rest stay defaults.
        let c = IdeConfig::parse(
            "[unreal]\nengine = \"/E/UE_5.4\"\nuproject = \"A.uproject\"\n[unreal.projects.\"./Sub/Game2/\"]\nengine = \"/E/UE_5.8\"\ntarget = \"G2\"\n[unreal.projects.\".\"]\nindex_engine = true\n",
        );
        assert!(c.warnings.is_empty(), "{:?}", c.warnings);
        let g2 = c.unreal.for_project("Sub/Game2");
        assert_eq!((g2.engine.as_deref(), g2.target.as_deref(), g2.uproject.as_deref()), (Some(Path::new("/E/UE_5.8")), Some("G2"), Some("A.uproject")));
        let g1 = c.unreal.for_project("Sub/Game1");
        assert_eq!((g1.engine.as_deref(), g1.target.as_deref(), g1.index_engine), (Some(Path::new("/E/UE_5.4")), None, false));
        assert!(c.unreal.for_project("").index_engine && g1.projects.is_empty());
        let bad = IdeConfig::parse("[unreal]\nprojects = 1\n[unreal.x]\n");
        assert_eq!(bad.warnings.len(), 2, "{:?}", bad.warnings);
        let bad = IdeConfig::parse("[unreal.projects]\nA = 1\n[unreal.projects.B]\nengine = 2\nversion = 5\n");
        assert_eq!(bad.warnings.len(), 3, "{:?}", bad.warnings);
    }

    #[test]
    fn problems_become_warnings_not_errors() {
        let c = IdeConfig::parse("languages = [\"ts\", \"cobol\"]\ncolour = 1\n[rust]\ncheck_on_save = \"yes\"\n");
        assert_eq!(c.languages, Some(vec![LangId::TypeScript]));
        assert_eq!(c.warnings.len(), 3, "{:?}", c.warnings);
        let broken = IdeConfig::parse("languages = [");
        assert_eq!(broken.languages, None);
        assert!(broken.warnings[0].contains("not valid TOML"));
    }

    #[test]
    fn memory_interval() {
        assert_eq!(IdeConfig::default().memory_interval, Duration::from_secs(15));
        let c = IdeConfig::parse("[memory]\ninterval_secs = 5\n");
        assert!(c.warnings.is_empty(), "{:?}", c.warnings);
        assert_eq!(c.memory_interval, Duration::from_secs(5));
        let low = IdeConfig::parse("[memory]\ninterval_secs = 0.1\n");
        assert_eq!(low.memory_interval, Duration::from_secs(15));
        assert!(low.warnings[0].contains("at least 1"), "{:?}", low.warnings);
    }

    #[test]
    fn diagnostics_section() {
        assert_eq!(IdeConfig::default().diagnostics, DiagnosticsConfig::default());
        let c = IdeConfig::parse("[diagnostics]\nts = false\n\n[diagnostics.oxlint]\nenabled = true\ntype_aware = false\ntype_check = true\n");
        assert!(c.warnings.is_empty(), "{:?}", c.warnings);
        assert_eq!(c.diagnostics.ts, Some(false));
        assert_eq!(c.diagnostics.oxlint, OxlintConfig { enabled: Some(true), type_aware: Some(false), type_check: Some(true) });
        let c = IdeConfig::parse("[diagnostics.eslint]\nenabled = false\n");
        assert!(c.warnings.is_empty(), "{:?}", c.warnings);
        assert_eq!(c.diagnostics.eslint, EslintConfig { enabled: Some(false) });
        let bad = IdeConfig::parse("[diagnostics]\nts = 1\ncolour = true\n[diagnostics.oxlint]\nfast = true\n[diagnostics.eslint]\nfix = true\n");
        assert_eq!(bad.warnings.len(), 4, "{:?}", bad.warnings);
        assert_eq!(bad.diagnostics, DiagnosticsConfig::default());
    }

    #[test]
    fn format_section() {
        let c = IdeConfig::default();
        assert!(!c.oxfmt.on_save, "oxfmt on save is off by default");
        assert!(c.oxfmt.covers(Path::new("/p/a.tsx")) && c.oxfmt.covers(Path::new("/p/README.MD")) && !c.oxfmt.covers(Path::new("/p/a.rs")));
        let c = IdeConfig::parse("[format.oxfmt]\non_save = true\nextensions = [\".TS\", \"vue\"]\ntimeout_secs = 0.5\n");
        assert!(c.warnings.is_empty(), "{:?}", c.warnings);
        assert_eq!(c.oxfmt, OxfmtConfig { on_save: true, extensions: vec!["ts".into(), "vue".into()], timeout: Duration::from_millis(500) });
        let bad = IdeConfig::parse("[format.oxfmt]\non_save = 1\nextensions = \"ts\"\nwidth = 2\n[format.prettier]\n");
        assert_eq!(bad.warnings.len(), 4, "{:?}", bad.warnings);
        assert_eq!(bad.oxfmt, OxfmtConfig::default());
    }

    #[test]
    fn csharp_section() {
        let c = IdeConfig::parse("languages = [\"csharp\", \"c#\"]\n[csharp]\nserver = \"/r/roslyn\"\ndotnet = \"/d/dotnet\"\nidle_timeout_secs = 5\n");
        assert!(c.warnings.is_empty(), "{:?}", c.warnings);
        assert_eq!(c.languages, Some(vec![LangId::CSharp, LangId::CSharp]));
        assert_eq!(c.csharp, CSharpConfig { server: Some(PathBuf::from("/r/roslyn")), dotnet: Some(PathBuf::from("/d/dotnet")) });
        assert_eq!(c.idle_timeout(LangId::CSharp), Duration::from_secs(5));
        let bad = IdeConfig::parse("[csharp]\nserver = 1\nmono = \"x\"\n");
        assert_eq!(bad.warnings.len(), 2, "{:?}", bad.warnings);
        assert_eq!(bad.csharp, CSharpConfig::default());
    }

    #[test]
    fn language_aliases() {
        let c = IdeConfig::parse("languages = [\"typescript\", \"rs\"]");
        assert_eq!(c.languages, Some(vec![LangId::TypeScript, LangId::Rust]));
        assert_eq!(IdeConfig::parse("languages = []").languages, Some(vec![]));
    }
}
