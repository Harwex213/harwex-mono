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
//! [ts]
//! idle_timeout_secs = 600
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

#[derive(Clone, Debug, PartialEq)]
pub struct IdeConfig {
    /// Languages whose servers may start. `None` means all.
    pub languages: Option<Vec<LangId>>,
    pub idle_timeout: Duration,
    pub ts_idle_timeout: Option<Duration>,
    pub rust_idle_timeout: Option<Duration>,
    pub rust: RustConfig,
    pub diagnostics: DiagnosticsConfig,
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
            diagnostics: DiagnosticsConfig::default(),
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
                                None => config.warnings.push(format!("{CONFIG_PATH}: unknown language {item} (known: ts, rust)")),
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
                "ts" => {
                    for (k, v) in value.as_table().into_iter().flatten() {
                        match k.as_str() {
                            "idle_timeout_secs" => config.ts_idle_timeout = secs(v, "ts.idle_timeout_secs", &mut config.warnings),
                            other => config.warnings.push(format!("{CONFIG_PATH}: unknown key ts.{other}")),
                        }
                    }
                }
                "diagnostics" => parse_diagnostics(value, &mut config),
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
    fn language_aliases() {
        let c = IdeConfig::parse("languages = [\"typescript\", \"rs\"]");
        assert_eq!(c.languages, Some(vec![LangId::TypeScript, LangId::Rust]));
        assert_eq!(IdeConfig::parse("languages = []").languages, Some(vec![]));
    }
}
