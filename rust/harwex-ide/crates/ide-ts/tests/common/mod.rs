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

/// Applies edits of one file to its text (0-based lines, char columns), last edit first.
pub fn apply_edits(text: &str, edits: &[ide_ts::TextEdit]) -> String {
    let lines: Vec<&str> = text.split('\n').collect();
    let offset = |line: usize, col: usize| -> usize {
        let start: usize = lines[..line].iter().map(|l| l.chars().count() + 1).sum();
        start + col
    };
    let mut chars: Vec<char> = text.chars().collect();
    let mut sorted: Vec<&ide_ts::TextEdit> = edits.iter().collect();
    sorted.sort_by_key(|e| std::cmp::Reverse((e.start_line, e.start_column)));
    for e in sorted {
        let (s, t) = (offset(e.start_line, e.start_column), offset(e.end_line, e.end_column));
        chars.splice(s..t, e.new_text.chars());
    }
    chars.into_iter().collect()
}

/// File and folder renames update imports, and file references find the importers. Shared by
/// the tsserver and the native suites.
pub fn check_file_rename(link: TsLink) {
    let Some(p) = project(link) else { return };
    let ts = service();
    ts.open(&p.main, &p.main_text);
    let util = p.root.join("src/util.ts");
    let found = ts.edits_for_file_rename(&util, &p.root.join("src/lib/helpers.ts"), &[]).unwrap();
    assert_eq!(found.projects_loaded, 1);
    let edits = found.edits;
    assert_eq!(edits.len(), 1, "{edits:?}");
    assert_eq!(edits[0].path, p.main);
    let updated = apply_edits(&p.main_text, &edits[0].edits);
    assert!(updated.contains("import { answer } from \"./lib/helpers\";"), "{updated}");

    let refs = ts.file_references(&util, &[]).unwrap();
    assert_eq!(refs.len(), 1, "{refs:?}");
    assert_eq!(refs[0].location.path, p.main);
    assert_eq!(refs[0].location.line, 1);
    assert!(refs[0].line_text.contains("./util"), "{:?}", refs[0].line_text);

    // A folder: its importers, and a rename that rewrites the specifier.
    let write = |rel: &str, text: &str| {
        let f = p.root.join(rel);
        std::fs::create_dir_all(f.parent().unwrap()).unwrap();
        std::fs::write(f, text).unwrap();
    };
    write("src/feature/thing.ts", "export const thing = 1;\n");
    let use_text = "import { thing } from \"./feature/thing\";\nconsole.log(thing);\n";
    write("src/use.ts", use_text);
    let use_ts = p.root.join("src/use.ts");
    ts.open(&use_ts, use_text);
    let feature = p.root.join("src/feature");
    let edits = ts.edits_for_file_rename(&feature, &p.root.join("src/feat2"), &[]).unwrap().edits;
    let edit = edits.iter().find(|e| e.path == use_ts).unwrap_or_else(|| panic!("no edit in use.ts: {edits:?}"));
    assert!(apply_edits(use_text, &edit.edits).starts_with("import { thing } from \"./feat2/thing\";"));
    let refs = ts.file_references(&feature, &[]).unwrap();
    assert!(refs.iter().any(|r| r.location.path == use_ts), "{refs:?}");

    // A package with its own tsconfig is a project the server has not loaded. The candidate
    // list makes it load, so its import is found and updated too.
    write("other/tsconfig.json", r#"{"compilerOptions":{"strict":true,"module":"commonjs","target":"es2020"},"include":["src"]}"#);
    let other_text = "import { answer } from \"../../src/util\";\nexport const twice = answer * 2;\n";
    write("other/src/twice.ts", other_text);
    let other = p.root.join("other/src/twice.ts");
    let files = vec![p.main.clone(), use_ts.clone(), other.clone(), p.root.join("src/feature/thing.ts")];
    let candidates = ide_ts::import_candidates(&files, &util, &std::sync::atomic::AtomicBool::new(false));
    assert_eq!(candidates, [other.clone(), p.main.clone()]);
    let found = ts.edits_for_file_rename(&util, &p.root.join("src/lib/helpers.ts"), &candidates).unwrap();
    assert_eq!(found.projects_loaded, 2, "the root project and other/");
    let edit = found.edits.iter().find(|e| e.path == other).unwrap_or_else(|| panic!("no edit in other/: {:?}", found.edits));
    assert!(apply_edits(other_text, &edit.edits).starts_with("import { answer } from \"../../src/lib/helpers\";"));
    assert_eq!(found.edits.len(), 2, "main.ts and other/src/twice.ts");
    let refs = ts.file_references(&util, &candidates).unwrap();
    assert!(refs.iter().any(|r| r.location.path == other), "{refs:?}");

    // After the move the server forgets the old names.
    std::fs::rename(&util, p.root.join("src/util2.ts")).unwrap();
    ts.files_renamed(&util, &p.root.join("src/util2.ts"));
    ts.shutdown();
}
