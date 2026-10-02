//! Finding `node`, `tsserver.js` and the native TypeScript 7 executable.
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

use serde_json::Value;

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
    let path = npm_global_root()?.join("typescript/lib/tsserver.js");
    path.is_file().then_some(path)
}

/// PATH with `dir` in front, so scripts with a `#!/usr/bin/env node` shebang find our node.
pub(crate) fn prepend_path(dir: &Path) -> std::ffi::OsString {
    let mut parts = vec![dir.to_path_buf()];
    if let Some(path) = env::var_os("PATH") {
        parts.extend(env::split_paths(&path));
    }
    env::join_paths(parts).unwrap_or_default()
}

/// A native TypeScript server: TypeScript 7 `tsc` or the `tsgo` preview. It speaks LSP.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct NativeServer {
    pub exe: PathBuf,
    pub version: String,
    /// The npm package that owns the executable: `typescript` or `@typescript/native-preview`.
    pub package: String,
}

/// A `tsserver.js` that runs with node: TypeScript 6 and older, also `@typescript/old`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct TsServerJs {
    pub path: PathBuf,
    pub version: String,
}

/// The TypeScript servers available for one file. At least one of the two is set.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Installation {
    pub native: Option<NativeServer>,
    pub tsserver: Option<TsServerJs>,
    /// The directory that owns the `node_modules`. `None` for a global install.
    pub project_root: Option<PathBuf>,
}

/// Walks up from `dir` and returns the TypeScript servers of the nearest `node_modules` that
/// has a usable one. In each `node_modules` it looks at `typescript` (TypeScript 7 and newer is
/// native, older ones have `lib/tsserver.js`), `@typescript/native-preview` and
/// `@typescript/old`. On failure the error lists what was found and what is missing.
pub fn find_typescript(dir: &Path) -> Result<Installation, Vec<String>> {
    let mut notes = Vec::new();
    for level in dir.ancestors() {
        if level.file_name().is_some_and(|n| n == "node_modules") {
            continue;
        }
        let modules = level.join("node_modules");
        if !modules.is_dir() {
            continue;
        }
        let (native, tsserver) = scan_node_modules(&modules, &mut notes);
        if native.is_some() || tsserver.is_some() {
            return Ok(Installation {
                native,
                tsserver,
                project_root: Some(level.to_path_buf()),
            });
        }
    }
    if notes.is_empty() {
        notes.push(format!("no node_modules/typescript above {}", dir.display()));
    }
    Err(notes)
}

/// A global install found through `npm root -g`, once per process.
pub fn find_global_typescript() -> Result<Installation, Vec<String>> {
    static GLOBAL: OnceLock<Result<Installation, Vec<String>>> = OnceLock::new();
    GLOBAL
        .get_or_init(|| {
            let Some(root) = npm_global_root() else {
                return Err(vec!["no global install (`npm root -g` failed)".to_string()]);
            };
            let mut notes = Vec::new();
            let (native, tsserver) = scan_node_modules(&root, &mut notes);
            if native.is_none() && tsserver.is_none() {
                if notes.is_empty() {
                    notes.push(format!("no global typescript in {}", root.display()));
                } else {
                    notes = notes.into_iter().map(|n| format!("global: {n}")).collect();
                }
                return Err(notes);
            }
            Ok(Installation {
                native,
                tsserver,
                project_root: None,
            })
        })
        .clone()
}

/// Looks at the TypeScript packages of one `node_modules` directory.
fn scan_node_modules(modules: &Path, notes: &mut Vec<String>) -> (Option<NativeServer>, Option<TsServerJs>) {
    let mut native = None;
    let mut tsserver = None;
    let typescript = modules.join("typescript");
    if typescript.is_dir() {
        let tsserver_js = typescript.join("lib/tsserver.js");
        match read_package(&typescript) {
            Some(pkg) => {
                let version = pkg["version"].as_str().unwrap_or("unknown").to_string();
                if major_version(&version) >= Some(7) {
                    match native_exe(&typescript, &pkg) {
                        Ok(exe) => {
                            native = Some(NativeServer {
                                exe,
                                version: version.clone(),
                                package: "typescript".into(),
                            })
                        }
                        Err(why) => notes.push(format!("{} is TypeScript {version} (native), but {why}", typescript.display())),
                    }
                }
                if tsserver_js.is_file() {
                    tsserver = Some(TsServerJs {
                        path: tsserver_js,
                        version,
                    });
                } else if major_version(&version) < Some(7) {
                    notes.push(format!("{} is TypeScript {version}, but {} is missing", typescript.display(), tsserver_js.display()));
                }
            }
            // A bare tsserver.js without package.json still works, as it always did.
            None if tsserver_js.is_file() => {
                tsserver = Some(TsServerJs {
                    path: tsserver_js,
                    version: "unknown".into(),
                })
            }
            None => notes.push(format!("{} has no package.json and no lib/tsserver.js", typescript.display())),
        }
    }
    let preview = modules.join("@typescript/native-preview");
    if native.is_none() && preview.is_dir() {
        if let Some(pkg) = read_package(&preview) {
            let version = pkg["version"].as_str().unwrap_or("unknown").to_string();
            match native_exe(&preview, &pkg) {
                Ok(exe) => {
                    native = Some(NativeServer {
                        exe,
                        version,
                        package: "@typescript/native-preview".into(),
                    })
                }
                Err(why) => notes.push(format!("{} is tsgo {version}, but {why}", preview.display())),
            }
        }
    }
    let old = modules.join("@typescript/old");
    let old_js = old.join("lib/tsserver.js");
    if tsserver.is_none() && old_js.is_file() {
        let version = read_package(&old)
            .and_then(|p| p["version"].as_str().map(String::from))
            .unwrap_or_else(|| "unknown".into());
        tsserver = Some(TsServerJs { path: old_js, version });
    }
    (native, tsserver)
}

fn read_package(dir: &Path) -> Option<Value> {
    let text = std::fs::read(dir.join("package.json")).ok()?;
    serde_json::from_slice(&text).ok()
}

fn major_version(version: &str) -> Option<u64> {
    version.trim_start_matches('v').split(['.', '-']).next()?.parse().ok()
}

/// The native executable of a TypeScript 7 or tsgo package. Mirrors `lib/getExePath.js` of the
/// `typescript` package: the binary lives in the platform package
/// `@typescript/<name>-<platform>-<arch>/lib/<bin>`, resolved like node resolves
/// `import.meta.resolve` from the package's real directory.
fn native_exe(package_dir: &Path, pkg: &Value) -> Result<PathBuf, String> {
    let name = pkg["name"].as_str().unwrap_or_default();
    let base = name.rsplit('/').next().unwrap_or(name);
    let expected_bin = if base == "typescript" { "tsc" } else { "tsgo" };
    let bins: Vec<&String> = pkg["bin"].as_object().map(|b| b.keys().collect()).unwrap_or_default();
    if bins.len() != 1 || bins[0] != expected_bin {
        return Err(format!("its package.json does not declare exactly one bin entry named {expected_bin}"));
    }
    let platform_package = format!("{base}-{}-{}", node_platform(), node_arch());
    // Node resolves from the real path of the module, so a symlinked package (yarn, pnpm)
    // finds its platform package next to its real location.
    let real = std::fs::canonicalize(package_dir).unwrap_or_else(|_| package_dir.to_path_buf());
    let normalized = real.to_string_lossy().replace('\\', "/");
    let (exe_dir, bin) = if normalized.ends_with(&format!("/_packages/{base}")) {
        // Running from a typescript-go checkout: `hereby build` always produces `tsgo`.
        (real.join("../../built/local"), "tsgo")
    } else if normalized.ends_with(&format!("/built/npm/{base}")) {
        (real.join("..").join(&platform_package).join("lib"), expected_bin)
    } else {
        let scoped = format!("@typescript/{platform_package}");
        let found = real
            .join("lib")
            .ancestors()
            .filter(|d| d.file_name().is_none_or(|n| n != "node_modules"))
            .map(|d| d.join("node_modules").join(&scoped))
            .find(|p| p.join("package.json").is_file());
        match found {
            Some(dir) => (dir.join("lib"), expected_bin),
            None => {
                let sibling = real.parent().unwrap_or(&real).join(&scoped).join("lib").join(expected_bin);
                return Err(format!(
                    "the platform package {scoped} is not installed (the native executable would be {})",
                    sibling.display()
                ));
            }
        }
    };
    let mut exe = exe_dir.join(bin);
    if cfg!(windows) {
        exe.set_extension("exe");
    }
    if !exe.is_file() {
        return Err(format!("the native executable {} is missing", exe.display()));
    }
    Ok(exe)
}

/// `process.platform` of node.
fn node_platform() -> &'static str {
    match env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    }
}

/// `process.arch` of node.
fn node_arch() -> &'static str {
    match env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        "x86" => "ia32",
        other => other,
    }
}

fn npm_global_root() -> Option<PathBuf> {
    static ROOT: OnceLock<Option<PathBuf>> = OnceLock::new();
    ROOT.get_or_init(|| {
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
        let root = PathBuf::from(root.trim());
        root.is_dir().then_some(root)
    })
    .clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn write_exe(path: &Path) {
        write(path, "#!/bin/sh\n");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    fn platform_package() -> String {
        format!("typescript-{}-{}", node_platform(), node_arch())
    }

    const TS7_PACKAGE: &str = r#"{"name":"typescript","version":"7.0.2","bin":{"tsc":"./bin/tsc"}}"#;

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
        let install = find_typescript(&deep).unwrap();
        assert_eq!(install.tsserver.unwrap().path, lib.join("tsserver.js"));
        assert_eq!(install.project_root.unwrap(), tmp.path());
        assert_eq!(install.native, None);
    }

    #[test]
    fn typescript_5_uses_tsserver() {
        let tmp = tempfile::tempdir().unwrap();
        let ts = tmp.path().join("node_modules/typescript");
        write(&ts.join("package.json"), r#"{"name":"typescript","version":"5.9.3","bin":{"tsc":"./bin/tsc","tsserver":"./bin/tsserver"}}"#);
        write(&ts.join("lib/tsserver.js"), "");
        let install = find_typescript(&tmp.path().join("src")).unwrap();
        assert_eq!(install.native, None);
        let tsserver = install.tsserver.unwrap();
        assert_eq!(tsserver.path, ts.join("lib/tsserver.js"));
        assert_eq!(tsserver.version, "5.9.3");
    }

    #[test]
    fn typescript_7_resolves_sibling_platform_package() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        let modules = root.join("node_modules");
        write(&modules.join("typescript/package.json"), TS7_PACKAGE);
        write(&modules.join("typescript/lib/getExePath.js"), "");
        let exe = modules.join("@typescript").join(platform_package()).join("lib/tsc");
        write(&modules.join("@typescript").join(platform_package()).join("package.json"), "{}");
        write_exe(&exe);
        let install = find_typescript(&root.join("packages/a/src")).unwrap();
        let native = install.native.unwrap();
        assert_eq!(native.exe, exe);
        assert_eq!(native.version, "7.0.2");
        assert_eq!(native.package, "typescript");
        assert_eq!(install.tsserver, None);
        assert_eq!(install.project_root.unwrap(), root);
    }

    #[test]
    fn typescript_7_resolves_nested_platform_package() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        let ts = root.join("node_modules/typescript");
        write(&ts.join("package.json"), TS7_PACKAGE);
        let platform = ts.join("node_modules/@typescript").join(platform_package());
        write(&platform.join("package.json"), "{}");
        write_exe(&platform.join("lib/tsc"));
        let native = find_typescript(&root).unwrap().native.unwrap();
        assert_eq!(native.exe, platform.join("lib/tsc"));
    }

    #[test]
    fn typescript_7_with_old_tsserver_offers_both() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        let modules = root.join("node_modules");
        write(&modules.join("typescript/package.json"), TS7_PACKAGE);
        let platform = modules.join("@typescript").join(platform_package());
        write(&platform.join("package.json"), "{}");
        write_exe(&platform.join("lib/tsc"));
        write(&modules.join("@typescript/old/package.json"), r#"{"name":"typescript","version":"6.0.3"}"#);
        write(&modules.join("@typescript/old/lib/tsserver.js"), "");
        let install = find_typescript(&root).unwrap();
        assert_eq!(install.native.unwrap().exe, platform.join("lib/tsc"));
        let old = install.tsserver.unwrap();
        assert_eq!(old.path, modules.join("@typescript/old/lib/tsserver.js"));
        assert_eq!(old.version, "6.0.3");
    }

    #[test]
    fn typescript_7_without_platform_package_falls_back_to_old() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        let modules = root.join("node_modules");
        write(&modules.join("typescript/package.json"), TS7_PACKAGE);
        write(&modules.join("@typescript/old/lib/tsserver.js"), "");
        let install = find_typescript(&root).unwrap();
        assert_eq!(install.native, None);
        assert_eq!(install.tsserver.unwrap().path, modules.join("@typescript/old/lib/tsserver.js"));
    }

    #[test]
    fn missing_native_exe_explains_what_was_searched() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        let modules = root.join("node_modules");
        write(&modules.join("typescript/package.json"), TS7_PACKAGE);
        // The platform package exists, but its binary does not.
        write(&modules.join("@typescript").join(platform_package()).join("package.json"), "{}");
        let notes = find_typescript(&root.join("src")).unwrap_err();
        let text = notes.join("; ");
        assert!(text.contains("TypeScript 7.0.2 (native)"), "{text}");
        let exe = modules.join("@typescript").join(platform_package()).join("lib/tsc");
        assert!(text.contains(&format!("{} is missing", exe.display())), "{text}");

        std::fs::remove_dir_all(modules.join("@typescript")).unwrap();
        let text = find_typescript(&root).unwrap_err().join("; ");
        assert!(text.contains(&format!("@typescript/{} is not installed", platform_package())), "{text}");
    }

    #[test]
    fn missing_tsserver_js_is_reported() {
        let tmp = tempfile::tempdir().unwrap();
        let ts = tmp.path().join("node_modules/typescript");
        write(&ts.join("package.json"), r#"{"name":"typescript","version":"5.4.0"}"#);
        let text = find_typescript(tmp.path()).unwrap_err().join("; ");
        assert!(text.contains("TypeScript 5.4.0"), "{text}");
        assert!(text.contains("lib/tsserver.js is missing"), "{text}");

        let empty = tempfile::tempdir().unwrap();
        let text = find_typescript(empty.path()).unwrap_err().join("; ");
        assert!(text.contains("no node_modules/typescript above"), "{text}");
    }

    #[test]
    fn native_preview_is_found() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        let modules = root.join("node_modules/@typescript");
        write(
            &modules.join("native-preview/package.json"),
            r#"{"name":"@typescript/native-preview","version":"7.0.0-dev.20250101.1","bin":{"tsgo":"./bin/tsgo.js"}}"#,
        );
        let platform = modules.join(format!("native-preview-{}-{}", node_platform(), node_arch()));
        write(&platform.join("package.json"), "{}");
        write_exe(&platform.join("lib/tsgo"));
        let native = find_typescript(&root).unwrap().native.unwrap();
        assert_eq!(native.exe, platform.join("lib/tsgo"));
        assert_eq!(native.package, "@typescript/native-preview");
    }

    #[test]
    fn nearest_level_wins_and_broken_levels_are_skipped() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        write(&root.join("node_modules/typescript/lib/tsserver.js"), "");
        // A nested package with a broken TypeScript 7 install: the walk goes on to the root.
        write(&root.join("packages/a/node_modules/typescript/package.json"), TS7_PACKAGE);
        let install = find_typescript(&root.join("packages/a/src")).unwrap();
        assert_eq!(install.project_root.unwrap(), root);
    }

    #[test]
    fn versions_parse() {
        assert_eq!(major_version("7.0.2"), Some(7));
        assert_eq!(major_version("7.0.0-dev.2025"), Some(7));
        assert_eq!(major_version("5.9.3"), Some(5));
        assert_eq!(major_version("unknown"), None);
    }
}
