//! Which sources check a file. `detect` reads the package markers from disk (a worker
//! call); `plan` is the pure decision from those markers and `.harwex/ide.toml`.
//!
//! - TypeScript errors come from the TS server that already runs for navigation.
//! - A package with an oxlint config (or oxlint in its dependencies) also gets oxlint lint
//!   errors, from one `oxlint --lsp` per workspace root.
//! - A package with an ESLint config gets ESLint lint errors, from one ESLint server per
//!   workspace root (`eslint.rs`). Type errors still come from the TS server.
//! - oxlint type-check would replace the TS server's errors, but the oxlint language server
//!   (1.77 and older) has no type-check setting. `plan` falls back to the TS server then.

use std::path::{Path, PathBuf};

use crate::lang::config::DiagnosticsConfig;

/// Config files oxlint reads, nearest first wins.
pub const OXLINT_CONFIGS: [&str; 8] = [
    ".oxlintrc.json",
    ".oxlintrc.jsonc",
    "oxlint.config.ts",
    "oxlint.config.mts",
    "oxlint.config.cts",
    "oxlint.config.js",
    "oxlint.config.mjs",
    "oxlint.config.cjs",
];

/// Flat config files ESLint reads, nearest first wins.
pub const ESLINT_FLAT_CONFIGS: [&str; 6] = ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts", "eslint.config.mts", "eslint.config.cts"];

/// Legacy (eslintrc) config files. ESLint 10 no longer reads them.
pub const ESLINT_LEGACY_CONFIGS: [&str; 6] = [".eslintrc.js", ".eslintrc.cjs", ".eslintrc.yaml", ".eslintrc.yml", ".eslintrc.json", ".eslintrc"];

/// What the disk says about the linters for one file.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Markers {
    /// The nearest oxlint config, or the nearest `package.json` that lists oxlint.
    pub oxlint_marker: Option<PathBuf>,
    pub oxlint: Option<OxlintInstall>,
    /// The nearest ESLint config.
    pub eslint_config: Option<EslintConfigFile>,
    pub eslint: Option<EslintInstall>,
    /// The nearest directory with a `tsconfig.json` between the file and its ESLint config:
    /// the TS project that type-aware rules load. The config dir when there is none.
    pub eslint_project: Option<PathBuf>,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct EslintConfigFile {
    pub path: PathBuf,
    /// `.eslintrc*` or `eslintConfig` in `package.json`.
    pub legacy: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct EslintInstall {
    /// The topmost directory above the config with `node_modules/eslint`. One ESLint server
    /// runs per root.
    pub root: PathBuf,
    /// `node_modules/eslint` nearest to the config, the one the server loads for it.
    pub package: PathBuf,
    pub version: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct EslintPlan {
    pub install: EslintInstall,
    /// The config's directory: the `cwd` of its ESLint instance.
    pub config_dir: PathBuf,
    pub legacy: bool,
    /// For the cold-start label: the TS project (or config dir) a first lint loads.
    pub project: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct OxlintInstall {
    /// The topmost directory with an oxlint config and an oxlint install. One server runs
    /// per workspace root.
    pub root: PathBuf,
    /// `node_modules/oxlint`: the package's own install, else the workspace root's.
    pub package: PathBuf,
    pub version: String,
    /// The `tsgolint` binary for type-aware rules, when `oxlint-tsgolint` is installed.
    pub tsgolint: Option<PathBuf>,
}

/// The sources for one file.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Plan {
    /// Ask the TS server for diagnostics.
    pub ts: bool,
    pub oxlint: Option<OxlintPlan>,
    pub eslint: Option<EslintPlan>,
    /// Why a configured source is not used; shown once in the log.
    pub notes: Vec<String>,
}

impl Plan {
    pub fn is_empty(&self) -> bool {
        !self.ts && self.oxlint.is_none() && self.eslint.is_none()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct OxlintPlan {
    pub install: OxlintInstall,
    pub type_aware: bool,
    /// TS errors come from oxlint, and the TS server is not asked.
    pub type_check: bool,
}

/// Whether the installed oxlint's language server can report TypeScript compiler errors.
/// The CLI has `--type-check`, but the language server settings of oxlint 1.77 (`run`,
/// `configPath`, `tsConfigPath`, `typeAware`, `fixKind`, ...) have nothing for it, and
/// `options.typeCheck` in the config is ignored by the server.
pub fn oxlint_lsp_has_type_check(_version: &str) -> bool {
    false
}

/// The decision. `ts_server` says whether the TS server serves this file (a TS/JS file with
/// the language turned on).
pub fn plan(ts_server: bool, markers: &Markers, config: &DiagnosticsConfig) -> Plan {
    let mut notes = Vec::new();
    let ox = &config.oxlint;
    let oxlint = match (&markers.oxlint_marker, &markers.oxlint, ox.enabled) {
        (_, _, Some(false)) => None,
        (None, _, None) => None,
        (_, Some(install), _) => {
            let type_aware = match (ox.type_aware, &install.tsgolint) {
                (Some(true), None) => {
                    notes.push(format!("oxlint type_aware is on, but oxlint-tsgolint is not installed next to {}", install.package.display()));
                    false
                }
                (Some(b), _) => b,
                (None, t) => t.is_some(),
            };
            let supported = oxlint_lsp_has_type_check(&install.version);
            let type_check = match ox.type_check {
                Some(true) if !supported => {
                    notes.push(format!("oxlint {} has no type check in its language server; TypeScript errors come from the TS server", install.version));
                    false
                }
                Some(b) => b && type_aware,
                None => supported && type_aware,
            };
            Some(OxlintPlan { install: install.clone(), type_aware, type_check })
        }
        (marker, None, _) => {
            let what = marker.as_ref().map_or_else(|| "diagnostics.oxlint.enabled".to_string(), |m| m.display().to_string());
            notes.push(format!("{what} asks for oxlint, but node_modules/oxlint is not installed"));
            None
        }
    };
    let ts = ts_server && config.ts != Some(false) && !oxlint.as_ref().is_some_and(|o| o.type_check);
    let eslint = eslint_plan(markers, config, &mut notes);
    Plan { ts, oxlint, eslint, notes }
}

fn eslint_plan(markers: &Markers, config: &DiagnosticsConfig, notes: &mut Vec<String>) -> Option<EslintPlan> {
    if config.eslint.enabled == Some(false) {
        return None;
    }
    let file = markers.eslint_config.as_ref()?;
    let Some(install) = &markers.eslint else {
        notes.push(format!("{} asks for ESLint, but node_modules/eslint is not installed", file.path.display()));
        return None;
    };
    if file.legacy && major(&install.version) >= Some(10) {
        notes.push(format!("{} is an eslintrc config; ESLint {} reads only eslint.config.*", file.path.display(), install.version));
        return None;
    }
    let config_dir = file.path.parent().map(Path::to_path_buf)?;
    let project = markers.eslint_project.clone().unwrap_or_else(|| config_dir.clone());
    Some(EslintPlan { install: install.clone(), config_dir, legacy: file.legacy, project })
}

fn major(version: &str) -> Option<u32> {
    version.split('.').next()?.parse().ok()
}

/// Reads the markers for `file`. Blocking: a few `stat` calls per directory level.
pub fn detect(file: &Path) -> Markers {
    let dir = file.parent().unwrap_or(file);
    let mut marker = None;
    for d in dir.ancestors() {
        if let Some(config) = OXLINT_CONFIGS.iter().map(|n| d.join(n)).find(|p| p.is_file()) {
            marker = Some(config);
            break;
        }
        let pkg = d.join("package.json");
        if pkg.is_file() && lists_oxlint(&pkg) {
            marker = Some(pkg);
            break;
        }
    }
    let (eslint_config, eslint, eslint_project) = detect_eslint(dir);
    let Some(marker) = marker else { return Markers { eslint_config, eslint, eslint_project, ..Markers::default() } };
    let package_dir = marker.parent().unwrap_or(dir).to_path_buf();
    // The topmost directory with a config and an install is the workspace root.
    let root = package_dir
        .ancestors()
        .filter(|d| oxlint_package(d).is_some() && (has_config(d) || d.join("package.json").is_file() && lists_oxlint(&d.join("package.json"))))
        .last()
        .map(Path::to_path_buf);
    let own = package_dir.ancestors().find_map(oxlint_package);
    let install = match (root, own) {
        (Some(root), own) => own.or_else(|| oxlint_package(&root)).map(|package| (root, package)),
        (None, Some(package)) => Some((package_dir.clone(), package)),
        (None, None) => None,
    };
    let oxlint = install.map(|(root, package)| OxlintInstall {
        version: package_version(&package).unwrap_or_default(),
        tsgolint: find_tsgolint(&package),
        root,
        package,
    });
    Markers { oxlint_marker: Some(marker), oxlint, eslint_config, eslint, eslint_project }
}

/// The nearest ESLint config above `dir` (a flat config wins over a legacy one in the same
/// directory), the install that serves it and the TS project between them.
fn detect_eslint(dir: &Path) -> (Option<EslintConfigFile>, Option<EslintInstall>, Option<PathBuf>) {
    let mut found = None;
    for d in dir.ancestors() {
        if let Some(path) = ESLINT_FLAT_CONFIGS.iter().map(|n| d.join(n)).find(|p| p.is_file()) {
            found = Some(EslintConfigFile { path, legacy: false });
            break;
        }
        if let Some(path) = ESLINT_LEGACY_CONFIGS.iter().map(|n| d.join(n)).find(|p| p.is_file()) {
            found = Some(EslintConfigFile { path, legacy: true });
            break;
        }
        let pkg = d.join("package.json");
        if pkg.is_file() && has_eslint_config_key(&pkg) {
            found = Some(EslintConfigFile { path: pkg, legacy: true });
            break;
        }
    }
    let Some(config) = found else { return (None, None, None) };
    let config_dir = config.path.parent().unwrap_or(dir).to_path_buf();
    let project = dir.ancestors().take_while(|d| d.starts_with(&config_dir)).find(|d| d.join("tsconfig.json").is_file()).map(Path::to_path_buf);
    let installs: Vec<PathBuf> = config_dir.ancestors().map(|d| d.join("node_modules/eslint")).filter(|p| p.join("package.json").is_file()).collect();
    let install = match (installs.first(), installs.last()) {
        (Some(package), Some(top)) => Some(EslintInstall {
            root: top.parent().and_then(Path::parent).unwrap_or(&config_dir).to_path_buf(),
            version: package_version(package).unwrap_or_default(),
            package: package.clone(),
        }),
        _ => None,
    };
    (Some(config), install, project)
}

fn has_eslint_config_key(package_json: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(package_json) else { return false };
    serde_json::from_str::<serde_json::Value>(&text).is_ok_and(|json| json.get("eslintConfig").is_some())
}

fn has_config(dir: &Path) -> bool {
    OXLINT_CONFIGS.iter().any(|n| dir.join(n).is_file())
}

fn oxlint_package(dir: &Path) -> Option<PathBuf> {
    let p = dir.join("node_modules/oxlint");
    p.join("package.json").is_file().then_some(p)
}

fn lists_oxlint(package_json: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(package_json) else { return false };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else { return false };
    ["dependencies", "devDependencies"].iter().any(|k| json[k].get("oxlint").is_some())
}

fn package_version(package: &Path) -> Option<String> {
    let text = std::fs::read_to_string(package.join("package.json")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    json["version"].as_str().map(str::to_string)
}

/// The native `tsgolint` binary beside the oxlint package (npm layout, also behind a
/// symlinked `node_modules/oxlint`), else `node_modules/.bin/tsgolint`.
fn find_tsgolint(package: &Path) -> Option<PathBuf> {
    let (os, arch) = node_os_arch();
    let platform = format!("@oxlint-tsgolint/{os}-{arch}/tsgolint");
    let mut dirs: Vec<PathBuf> = package.parent().map(Path::to_path_buf).into_iter().collect();
    if let Some(real) = std::fs::canonicalize(package).ok().and_then(|p| p.parent().map(Path::to_path_buf)) {
        dirs.push(real);
    }
    dirs.iter()
        .map(|nm| nm.join(&platform))
        .chain(dirs.iter().map(|nm| nm.join(".bin/tsgolint")))
        .find(|p| p.is_file())
}

/// `process.platform` and `process.arch` of node.
pub fn node_os_arch() -> (&'static str, &'static str) {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        other => other,
    };
    (os, arch)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lang::config::OxlintConfig;

    fn install(tsgolint: bool) -> OxlintInstall {
        OxlintInstall {
            root: PathBuf::from("/w"),
            package: PathBuf::from("/w/node_modules/oxlint"),
            version: "1.77.0".into(),
            tsgolint: tsgolint.then(|| PathBuf::from("/w/node_modules/.bin/tsgolint")),
        }
    }

    fn markers(installed: bool, tsgolint: bool) -> Markers {
        Markers { oxlint_marker: Some(PathBuf::from("/w/p/oxlint.config.ts")), oxlint: installed.then(|| install(tsgolint)), ..Markers::default() }
    }

    fn config(ts: Option<bool>, enabled: Option<bool>, type_aware: Option<bool>, type_check: Option<bool>) -> DiagnosticsConfig {
        DiagnosticsConfig { ts, oxlint: OxlintConfig { enabled, type_aware, type_check }, ..DiagnosticsConfig::default() }
    }

    #[test]
    fn no_linter_means_ts_server_only() {
        let p = plan(true, &Markers::default(), &DiagnosticsConfig::default());
        assert_eq!(p, Plan { ts: true, oxlint: None, eslint: None, notes: vec![] });
        assert!(plan(false, &Markers::default(), &DiagnosticsConfig::default()).is_empty());
    }

    #[test]
    fn oxlint_package_gets_lint_and_keeps_ts_errors() {
        let p = plan(true, &markers(true, true), &DiagnosticsConfig::default());
        assert!(p.ts, "type check is not in the oxlint language server, so the TS server stays");
        let ox = p.oxlint.unwrap();
        assert!(ox.type_aware && !ox.type_check);
        assert!(p.notes.is_empty());
        // Without tsgolint the default is lint without types.
        let p = plan(true, &markers(true, false), &DiagnosticsConfig::default());
        assert!(!p.oxlint.unwrap().type_aware);
    }

    #[test]
    fn asking_for_type_check_falls_back_to_the_ts_server() {
        let p = plan(true, &markers(true, true), &config(None, None, None, Some(true)));
        assert!(p.ts);
        assert!(!p.oxlint.as_ref().unwrap().type_check);
        assert!(p.notes[0].contains("no type check"), "{:?}", p.notes);
    }

    #[test]
    fn ide_toml_switches_sources_off() {
        let p = plan(true, &markers(true, true), &config(Some(false), None, None, None));
        assert!(!p.ts && p.oxlint.is_some());
        let p = plan(true, &markers(true, true), &config(None, Some(false), None, None));
        assert!(p.ts && p.oxlint.is_none());
        let p = plan(true, &markers(true, true), &config(None, None, Some(false), None));
        assert!(!p.oxlint.unwrap().type_aware);
        let p = plan(true, &markers(true, false), &config(None, None, Some(true), None));
        assert!(!p.oxlint.unwrap().type_aware);
        assert!(p.notes[0].contains("oxlint-tsgolint"), "{:?}", p.notes);
    }

    #[test]
    fn configured_but_not_installed_says_why() {
        let p = plan(true, &markers(false, false), &DiagnosticsConfig::default());
        assert!(p.ts && p.oxlint.is_none());
        assert!(p.notes[0].contains("not installed"), "{:?}", p.notes);
        // Turned on without a config but installed: used.
        let m = Markers { oxlint_marker: None, oxlint: Some(install(false)), ..Markers::default() };
        assert!(plan(true, &m, &config(None, Some(true), None, None)).oxlint.is_some());
        assert!(plan(true, &m, &DiagnosticsConfig::default()).oxlint.is_none());
    }

    #[test]
    fn detect_finds_the_nearest_config_and_the_topmost_root() {
        let tmp = tempfile_dir();
        let w = tmp.as_path();
        let write = |p: &str, t: &str| {
            let p = w.join(p);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, t).unwrap();
        };
        write("oxlint.config.ts", "export default {}");
        write("node_modules/oxlint/package.json", r#"{"name":"oxlint","version":"1.77.0"}"#);
        write("node_modules/.bin/tsgolint", "");
        write("packages/a/oxlint.config.ts", "export default {}");
        write("packages/a/src/x.ts", "");
        write("packages/b/package.json", r#"{"devDependencies":{"oxlint":"1"}}"#);
        write("packages/b/node_modules/oxlint/package.json", r#"{"version":"1.70.0"}"#);
        write("packages/b/src/y.ts", "");
        write("other/z.ts", "");

        let a = detect(&w.join("packages/a/src/x.ts"));
        assert_eq!(a.oxlint_marker, Some(w.join("packages/a/oxlint.config.ts")));
        let ox = a.oxlint.unwrap();
        assert_eq!((ox.root.as_path(), ox.package.as_path(), ox.version.as_str()), (w, w.join("node_modules/oxlint").as_path(), "1.77.0"));
        assert_eq!(ox.tsgolint, Some(w.join("node_modules/.bin/tsgolint")));

        let b = detect(&w.join("packages/b/src/y.ts"));
        assert_eq!(b.oxlint_marker, Some(w.join("packages/b/package.json")));
        let ox = b.oxlint.unwrap();
        assert_eq!(ox.root, w, "one server per workspace root");
        assert_eq!(ox.package, w.join("packages/b/node_modules/oxlint"), "the package's own install wins");

        let z = detect(&w.join("other/z.ts"));
        assert_eq!(z.oxlint_marker, Some(w.join("oxlint.config.ts")), "the root config is the fallback");
        let _ = std::fs::remove_dir_all(w);
    }

    fn eslint_markers(version: &str, legacy: bool, installed: bool) -> Markers {
        Markers {
            eslint_config: Some(EslintConfigFile { path: PathBuf::from(if legacy { "/w/p/.eslintrc.json" } else { "/w/p/eslint.config.mjs" }), legacy }),
            eslint: installed.then(|| EslintInstall { root: "/w".into(), package: "/w/node_modules/eslint".into(), version: version.into() }),
            eslint_project: Some("/w/p/sub".into()),
            ..Markers::default()
        }
    }

    #[test]
    fn eslint_package_gets_eslint_and_keeps_ts_errors() {
        let p = plan(true, &eslint_markers("10.12.0", false, true), &DiagnosticsConfig::default());
        assert!(p.ts, "type errors stay with the TS server");
        let es = p.eslint.expect("eslint planned");
        assert_eq!((es.config_dir.as_path(), es.project.as_path(), es.legacy), (Path::new("/w/p"), Path::new("/w/p/sub"), false));
        assert!(p.notes.is_empty());
        // Off in ide.toml.
        let off = DiagnosticsConfig { eslint: crate::lang::config::EslintConfig { enabled: Some(false) }, ..DiagnosticsConfig::default() };
        assert!(plan(true, &eslint_markers("10.12.0", false, true), &off).eslint.is_none());
        // Not installed: a note.
        let p = plan(true, &eslint_markers("10.12.0", false, false), &DiagnosticsConfig::default());
        assert!(p.eslint.is_none() && p.notes[0].contains("not installed"), "{:?}", p.notes);
        // eslintrc works up to ESLint 9 only.
        assert!(plan(true, &eslint_markers("9.39.0", true, true), &DiagnosticsConfig::default()).eslint.is_some_and(|e| e.legacy));
        let p = plan(true, &eslint_markers("10.0.0", true, true), &DiagnosticsConfig::default());
        assert!(p.eslint.is_none() && p.notes[0].contains("eslintrc"), "{:?}", p.notes);
    }

    #[test]
    fn detect_finds_the_eslint_config_install_and_project() {
        let tmp = tempfile_dir();
        let w = tmp.as_path();
        let write = |p: &str, t: &str| {
            let p = w.join(p);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, t).unwrap();
        };
        write("eslint.config.mjs", "export default []");
        write("node_modules/eslint/package.json", r#"{"version":"10.12.0"}"#);
        write("packages/a/eslint.config.js", "export default []");
        write("packages/a/.eslintrc.json", "{}");
        write("packages/a/node_modules/eslint/package.json", r#"{"version":"9.0.0"}"#);
        write("packages/a/lib/tsconfig.json", "{}");
        write("packages/a/lib/src/x.ts", "");
        write("packages/b/package.json", r#"{"eslintConfig":{}}"#);
        write("packages/b/src/y.ts", "");
        write("other/z.ts", "");

        let a = detect(&w.join("packages/a/lib/src/x.ts"));
        assert_eq!(a.eslint_config, Some(EslintConfigFile { path: w.join("packages/a/eslint.config.js"), legacy: false }), "flat wins in one dir");
        let i = a.eslint.unwrap();
        assert_eq!((i.root.as_path(), i.package.clone(), i.version.as_str()), (w, w.join("packages/a/node_modules/eslint"), "9.0.0"));
        assert_eq!(a.eslint_project, Some(w.join("packages/a/lib")));
        assert_eq!(a.oxlint_marker, None);

        let b = detect(&w.join("packages/b/src/y.ts"));
        assert_eq!(b.eslint_config, Some(EslintConfigFile { path: w.join("packages/b/package.json"), legacy: true }));
        assert_eq!(b.eslint.unwrap().package, w.join("node_modules/eslint"));
        assert_eq!(b.eslint_project, None);

        let z = detect(&w.join("other/z.ts"));
        assert_eq!(z.eslint_config.unwrap().path, w.join("eslint.config.mjs"));
        let _ = std::fs::remove_dir_all(w);
    }

    fn tempfile_dir() -> PathBuf {
        use std::sync::atomic::{AtomicU32, Ordering};
        static N: AtomicU32 = AtomicU32::new(0);
        let d = std::env::temp_dir().join(format!("harwex-strategy-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::canonicalize(&d).unwrap()
    }
}
