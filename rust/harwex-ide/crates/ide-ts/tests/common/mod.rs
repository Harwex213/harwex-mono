//! The throwaway TypeScript project shared by the tsserver and native LSP suites.

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::time::Duration;

use ide_ts::{find_node, Location, TsService};

/// The TypeScript installs come from `cargo xtask test-tools` (`<target>/tools/`), or from
/// `HARWEX_TEST_TS5` / `HARWEX_TEST_TS7` (each the path of a `typescript` package dir). Both
/// are only read, never written.
pub fn tools_dir() -> PathBuf {
    // `<target>/tmp` exists for every integration test, also with a custom CARGO_TARGET_DIR.
    Path::new(env!("CARGO_TARGET_TMPDIR")).parent().expect("target dir").join("tools")
}

const HINT: &str = "run `cargo xtask test-tools`";

/// `@typescript/typescript-<os>-<arch>`, the package with the native `tsc`.
pub fn ts7_platform() -> String {
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
    format!("@typescript/typescript-{os}-{arch}")
}

/// Env override, then `<target>/tools/<sub>`. `check` says what a usable install lacks.
fn install(var: &str, sub: &str, check: impl Fn(&Path) -> Option<String>) -> Result<PathBuf, String> {
    let (dir, source) = match std::env::var_os(var) {
        Some(dir) => (PathBuf::from(dir), var.to_string()),
        None => (tools_dir().join(sub), HINT.to_string()),
    };
    match check(&dir) {
        None => Ok(dir),
        Some(why) => Err(format!("{why} ({source})")),
    }
}

/// TypeScript 5 with `lib/tsserver.js`.
pub fn ts5() -> Result<PathBuf, String> {
    install("HARWEX_TEST_TS5", "ts5/node_modules/typescript", |dir| {
        let js = dir.join("lib/tsserver.js");
        (!js.is_file()).then(|| format!("{} is missing", js.display()))
    })
}

/// TypeScript 7 (its real path). Its platform package sits next to it in the same
/// `node_modules`, as npm puts it.
pub fn ts7() -> Result<PathBuf, String> {
    let dir = install("HARWEX_TEST_TS7", "ts7/node_modules/typescript", |dir| {
        (!dir.join("package.json").is_file()).then(|| format!("{} is missing", dir.join("package.json").display()))
    })?;
    let real = dir.canonicalize().map_err(|e| format!("{}: {e}", dir.display()))?;
    let tsc = real.parent().expect("node_modules").join(ts7_platform()).join("lib/tsc");
    if !tsc.is_file() {
        return Err(format!("{} is missing ({HINT})", tsc.display()));
    }
    Ok(real)
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum TsLink {
    /// `node_modules/typescript` is a symlink to TypeScript 5.
    TsServer,
    /// `node_modules/typescript` is a symlink to TypeScript 7, whose platform package with the
    /// native `tsc` sits next to its real directory.
    Native,
    /// `Native` plus `node_modules/@typescript/old`, a symlink to TypeScript 5 (`tsserver.js`).
    NativeWithOld,
}

pub struct Project {
    pub _tmp: tempfile::TempDir,
    pub root: PathBuf,
    pub main: PathBuf,
    pub main_text: String,
}

/// Why a suite cannot run with `link`, if it cannot.
pub fn missing(link: TsLink) -> Option<String> {
    let need_node = link != TsLink::Native;
    if need_node && find_node().is_none() {
        return Some("node not found".into());
    }
    let need_ts5 = link != TsLink::Native;
    let need_ts7 = link != TsLink::TsServer;
    if need_ts5 {
        if let Err(why) = ts5() {
            return Some(why);
        }
    }
    if need_ts7 {
        if let Err(why) = ts7() {
            return Some(why);
        }
    }
    None
}

/// Returns `None` (and the test passes with a "skipping" message) when node or a TypeScript
/// install is missing. `cargo xtask clean-check` fails on such a message.
pub fn project(link: TsLink) -> Option<Project> {
    if let Some(why) = missing(link) {
        eprintln!("skipping: {why}");
        return None;
    }
    let tmp = tempfile::tempdir().unwrap();
    // Servers answer with real paths; /var is a symlink to /private/var on macOS.
    let root = tmp.path().canonicalize().unwrap();
    let write = |rel: &str, text: &str| {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    };
    std::fs::create_dir_all(root.join("node_modules/@typescript")).unwrap();
    let link_to = |target: PathBuf, rel: &str| std::os::unix::fs::symlink(target, root.join(rel)).unwrap();
    match link {
        TsLink::TsServer => link_to(ts5().unwrap(), "node_modules/typescript"),
        TsLink::Native => link_to(ts7().unwrap(), "node_modules/typescript"),
        TsLink::NativeWithOld => {
            link_to(ts7().unwrap(), "node_modules/typescript");
            link_to(ts5().unwrap(), "node_modules/@typescript/old");
        }
    }
    write(
        "node_modules/fake-lib/package.json",
        r#"{"name":"fake-lib","version":"1.0.0","main":"index.js","types":"index.d.ts"}"#,
    );
    write(
        "node_modules/fake-lib/index.d.ts",
        "/** Says hello. */\nexport declare function greet(name: string): string;\nexport interface Options { loud: boolean }\n",
    );
    write(
        "node_modules/fake-lib/index.js",
        "\"use strict\";\nexports.greet = greet;\nfunction greet(name) {\n  return \"hi \" + name;\n}\n",
    );
    write(
        "tsconfig.json",
        r#"{"compilerOptions":{"strict":true,"module":"commonjs","target":"es2020"},"include":["src"]}"#,
    );
    write("src/util.ts", "export const answer = 42;\n");
    // Line 3 has astral chars before `greet`, so a wrong UTF-16 conversion shows up.
    let main_text = "import { greet, Options } from \"fake-lib\";\nimport { answer } from \"./util\";\nconst s = \"😀😀\"; greet(s);\nconst o: Options = { loud: true };\nconsole.log(answer, o);\n".to_string();
    write("src/main.ts", &main_text);
    let main = root.join("src/main.ts");
    Some(Project {
        _tmp: tmp,
        root,
        main,
        main_text,
    })
}

/// 0-based (line, char column) of the `nth` occurrence of `needle` in `text`.
pub fn pos(text: &str, needle: &str, nth: usize) -> (usize, usize) {
    let byte = text.match_indices(needle).nth(nth).expect("needle not found").0;
    let before = &text[..byte];
    let line = before.matches('\n').count();
    let line_start = before.rfind('\n').map_or(0, |i| i + 1);
    (line, text[line_start..byte].chars().count())
}

pub fn service() -> TsService {
    let ts = TsService::new();
    // The first request loads the project and the lib files; a cold disk can be slow.
    ts.set_timeout(Duration::from_secs(30));
    ts
}

pub fn single(locs: Vec<Location>) -> Location {
    assert_eq!(locs.len(), 1, "expected one location, got {locs:?}");
    locs.into_iter().next().unwrap()
}
