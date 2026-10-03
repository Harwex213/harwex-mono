//! Throwaway projects for the UI tests: git repositories with history, branches, a merge, a
//! bare remote, conflicts and many changes, a TypeScript project with a dependency, and a
//! Cargo workspace for rust-analyzer.
//!
//! Each fixture lives at a fixed path, `/private/tmp/harwex-ide-kittest/<suite>/<name>`, so
//! paths drawn in the UI (the project tree header, notifications) are the same on every run
//! and snapshots stay stable. The directory is wiped when the fixture is created and removed
//! when it drops (set `KEEP_FIXTURES=1` to keep it for inspection). Because the path is fixed,
//! two processes that run the same test at once (two sessions, or clean-check next to a dev
//! run) would wipe each other's fixture. A lock file next to the directory makes them take
//! turns.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};

pub const FIXTURE_ROOT: &str = "/private/tmp/harwex-ide-kittest";

pub struct Fixture {
    /// The fixture's own directory (canonical). Repositories and projects live inside it.
    pub dir: PathBuf,
    /// Held until the fixture drops; another process that wants the same directory waits.
    _lock: std::fs::File,
}

impl Fixture {
    pub fn new(suite: &str, name: &str) -> Fixture {
        super::init();
        let parent = Path::new(FIXTURE_ROOT).join(suite);
        std::fs::create_dir_all(&parent).expect("create fixture root");
        let lock = std::fs::File::create(parent.join(format!("{name}.lock"))).expect("create fixture lock");
        lock.lock().expect("lock fixture");
        let dir = parent.join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create fixture dir");
        Fixture { dir, _lock: lock }
    }

    pub fn path(&self, rel: &str) -> PathBuf {
        self.dir.join(rel)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if std::env::var_os("KEEP_FIXTURES").is_none() {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }
}

pub fn write(root: &Path, rel: &str, text: &str) {
    let p = root.join(rel);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).expect("create dirs");
    }
    std::fs::write(&p, text).expect("write file");
}

pub fn read(root: &Path, rel: &str) -> String {
    std::fs::read_to_string(root.join(rel)).unwrap_or_else(|e| panic!("read {rel}: {e}"))
}

/// A git repository built by the fixtures. Every commit gets its own fixed date, one hour after
/// the previous one, so hashes and the log are the same on every run.
pub struct Repo {
    pub dir: PathBuf,
    clock: AtomicU32,
}

impl Repo {
    pub fn init(dir: PathBuf) -> Repo {
        std::fs::create_dir_all(&dir).expect("repo dir");
        let repo = Repo { dir, clock: AtomicU32::new(0) };
        repo.git(&["init", "-q", "-b", "main"]);
        repo.git(&["config", "user.name", "Test User"]);
        repo.git(&["config", "user.email", "test@example.com"]);
        repo.git(&["config", "commit.gpgsign", "false"]);
        repo.git(&["config", "core.autocrlf", "false"]);
        repo
    }

    /// Runs git in the repository and returns stdout. Panics with stderr on failure.
    pub fn git(&self, args: &[&str]) -> String {
        let out = self.git_status(args);
        assert!(out.status.success(), "git {args:?} failed: {}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).into_owned()
    }

    /// Runs git and returns the raw output, for commands that are expected to fail (a merge
    /// with conflicts).
    pub fn git_status(&self, args: &[&str]) -> std::process::Output {
        let t = self.clock.fetch_add(1, Ordering::SeqCst);
        // 2024-01-01 10:00 UTC plus one hour per git call.
        let date = format!("{} +0000", 1_704_103_200 + u64::from(t) * 3600);
        Command::new("git")
            .args(args)
            .current_dir(&self.dir)
            .env("GIT_AUTHOR_DATE", &date)
            .env("GIT_COMMITTER_DATE", &date)
            .env("GIT_EDITOR", "true")
            .output()
            .expect("run git")
    }

    pub fn write(&self, rel: &str, text: &str) {
        write(&self.dir, rel, text);
    }

    pub fn read(&self, rel: &str) -> String {
        read(&self.dir, rel)
    }

    pub fn commit_all(&self, message: &str) {
        self.git(&["add", "-A"]);
        self.git(&["commit", "-q", "-m", message]);
    }

    pub fn head(&self) -> String {
        self.git(&["rev-parse", "HEAD"]).trim().to_string()
    }

    pub fn subjects(&self, rev: &str) -> Vec<String> {
        self.git(&["log", "--format=%s", rev]).lines().map(str::to_string).collect()
    }

    /// Files in a commit, relative paths.
    pub fn files_in(&self, rev: &str) -> Vec<String> {
        let mut v: Vec<String> = self.git(&["show", "--name-only", "--format=", rev]).lines().filter(|l| !l.is_empty()).map(str::to_string).collect();
        v.sort();
        v
    }

    pub fn status_short(&self) -> String {
        self.git(&["status", "--short"])
    }

    pub fn branch(&self) -> String {
        self.git(&["rev-parse", "--abbrev-ref", "HEAD"]).trim().to_string()
    }
}

/// A small TypeScript-ish repository with nested directories and one commit.
pub fn basic_repo(dir: PathBuf) -> Repo {
    let r = Repo::init(dir);
    r.write("README.md", "# demo\n\nA small project.\n");
    r.write("src/app.ts", APP_TS);
    r.write("src/util.ts", "export function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport const ZERO = 0;\n");
    r.write("src/core/deep/nested.ts", "export const nested = 1;\n");
    r.write("docs/notes.md", "notes\n");
    r.write(".gitignore", "ignored/\n");
    r.commit_all("Initial commit");
    r
}

pub const APP_TS: &str = "import { add } from \"./util\";\n\nexport function main(): number {\n  const x = add(1, 2);\n  return x;\n}\n\nconsole.log(main());\n";

/// `basic_repo` plus uncommitted changes of every kind: modified, added (staged), deleted,
/// untracked.
pub fn changed_repo(dir: PathBuf) -> Repo {
    let r = basic_repo(dir);
    r.write("src/app.ts", &APP_TS.replace("add(1, 2)", "add(40, 2)"));
    r.write("src/added.ts", "export const added = true;\n");
    r.git(&["add", "src/added.ts"]);
    std::fs::remove_file(r.dir.join("docs/notes.md")).expect("delete");
    r.write("scratch.txt", "untracked\n");
    r
}

/// History with a side branch merged back, a tag, and a feature branch.
pub fn history_repo(dir: PathBuf) -> Repo {
    let r = basic_repo(dir);
    r.write("src/util.ts", "export function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport const ZERO = 0;\nexport const ONE = 1;\n");
    r.commit_all("Add ONE");
    r.git(&["checkout", "-q", "-b", "side"]);
    r.write("src/side.ts", "export const side = 'side';\n");
    r.commit_all("Side work");
    r.write("src/side.ts", "export const side = 'side 2';\n");
    r.commit_all("More side work");
    r.git(&["checkout", "-q", "main"]);
    r.write("README.md", "# demo\n\nA small project.\n\nMain line.\n");
    r.commit_all("Main line change");
    r.git(&["merge", "-q", "--no-ff", "side", "-m", "Merge branch 'side'"]);
    r.git(&["tag", "v1.0"]);
    r.write("src/after.ts", "export const after = 1;\n");
    r.commit_all("After merge");
    r.git(&["branch", "feature"]);
    r
}

/// A repository with `count` commits on main, for paging.
pub fn long_history_repo(dir: PathBuf, count: usize) -> Repo {
    let r = Repo::init(dir);
    r.write("counter.txt", "0\n");
    r.commit_all("Commit 0");
    // fast-import keeps a long history cheap to build.
    let mut script = String::new();
    for i in 1..count {
        let data = format!("{i}\n");
        let msg = format!("Commit {i}");
        script.push_str(&format!(
            "commit refs/heads/main\ncommitter Test User <test@example.com> {} +0000\ndata {}\n{msg}\n{}M 100644 inline counter.txt\ndata {}\n{data}\n",
            1_704_103_200 + i as u64 * 60,
            msg.len(),
            if i == 1 { "from refs/heads/main^0\n" } else { "" },
            data.len()
        ));
    }
    let mut child = Command::new("git").args(["fast-import", "--quiet"]).current_dir(&r.dir).stdin(std::process::Stdio::piped()).spawn().expect("fast-import");
    use std::io::Write as _;
    child.stdin.take().expect("stdin").write_all(script.as_bytes()).expect("write script");
    assert!(child.wait().expect("wait").success());
    r.git(&["reset", "-q", "--hard", "main"]);
    r
}

/// A bare remote at `<fixture>/remote.git` with `main` pushed and tracked, plus one local
/// commit that is not pushed yet.
pub fn repo_with_remote(fixture: &Fixture) -> (Repo, PathBuf) {
    let bare = fixture.path("remote.git");
    std::fs::create_dir_all(&bare).expect("bare dir");
    let out = Command::new("git").args(["init", "-q", "--bare", "-b", "main"]).current_dir(&bare).output().expect("git init --bare");
    assert!(out.status.success());
    let r = basic_repo(fixture.path("repo"));
    r.git(&["remote", "add", "origin", bare.to_str().expect("utf8")]);
    r.git(&["push", "-q", "-u", "origin", "main"]);
    r.write("src/util.ts", "export function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport const ZERO = 0;\nexport const TWO = 2;\n");
    r.commit_all("Local work to push");
    (r, bare)
}

/// Pushes a commit to `bare` from a second clone, so the first repository is behind.
pub fn push_from_other_clone(fixture: &Fixture, bare: &Path, rel: &str, text: &str, message: &str) {
    let other = fixture.path("other");
    if !other.exists() {
        let out = Command::new("git").args(["clone", "-q", bare.to_str().expect("utf8"), other.to_str().expect("utf8")]).output().expect("clone");
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    }
    let o = Repo { dir: other, clock: AtomicU32::new(50) };
    o.git(&["config", "user.name", "Other User"]);
    o.git(&["config", "user.email", "other@example.com"]);
    o.git(&["pull", "-q", "--no-rebase"]);
    o.write(rel, text);
    o.commit_all(message);
    o.git(&["push", "-q"]);
}

/// Two branches that change the same line of `README.md`: merging `conflict-b` into
/// `conflict-a` stops with a conflict.
pub fn conflict_repo(dir: PathBuf) -> Repo {
    let r = basic_repo(dir);
    r.write("conflict.txt", "line one\nshared line\nline three\n");
    r.commit_all("Add conflict.txt");
    r.git(&["checkout", "-q", "-b", "conflict-a"]);
    r.write("conflict.txt", "line one\nours version\nline three\n");
    r.commit_all("Ours change");
    r.git(&["checkout", "-q", "-b", "conflict-b", "main"]);
    r.write("conflict.txt", "line one\ntheirs version\nline three\n");
    r.commit_all("Theirs change");
    r.git(&["checkout", "-q", "conflict-a"]);
    r
}

/// `count` modified tracked files spread over directories.
pub fn many_changes_repo(dir: PathBuf, count: usize) -> Repo {
    let r = Repo::init(dir);
    for i in 0..count {
        r.write(&format!("pkg{}/mod{}/file{i}.txt", i % 7, i % 3), "original\n");
    }
    r.commit_all("Many files");
    for i in 0..count {
        r.write(&format!("pkg{}/mod{}/file{i}.txt", i % 7, i % 3), "changed\n");
    }
    r
}

/// A 10 000-line TypeScript file, committed, then changed in a few places.
pub fn big_file_repo(dir: PathBuf) -> Repo {
    let r = Repo::init(dir);
    let lines: Vec<String> = (0..10_000).map(|i| format!("export const value{i} = {i};")).collect();
    r.write("big.ts", &(lines.join("\n") + "\n"));
    r.commit_all("Big file");
    let mut changed = lines.clone();
    changed[10] = "export const value10 = 1000; // changed".into();
    changed.insert(300, "export const inserted = true;".into());
    changed.remove(5000);
    changed[9000] = "export const value9000 = -1;".into();
    r.write("big.ts", &(changed.join("\n") + "\n"));
    r
}

// -----------------------------------------------------------------------------------------
// TypeScript project

// -----------------------------------------------------------------------------------------
// Test tools: env override, then `<target>/tools/` from `cargo xtask test-tools`, else skip.

const HINT: &str = "run `cargo xtask test-tools`";

/// `<target>/tools/`. `<target>/tmp` exists for every integration test, also with a custom
/// `CARGO_TARGET_DIR`.
pub fn tools_dir() -> PathBuf {
    Path::new(env!("CARGO_TARGET_TMPDIR")).parent().expect("target dir").join("tools")
}

/// TypeScript 5 (a `typescript` package dir with `lib/tsserver.js`): `HARWEX_TEST_TS5`, else
/// `<target>/tools/ts5/node_modules/typescript`.
pub fn typescript() -> Result<PathBuf, String> {
    let (dir, source) = match std::env::var_os("HARWEX_TEST_TS5") {
        Some(dir) => (PathBuf::from(dir), "HARWEX_TEST_TS5"),
        None => (tools_dir().join("ts5/node_modules/typescript"), HINT),
    };
    let js = dir.join("lib/tsserver.js");
    if js.is_file() {
        Ok(dir)
    } else {
        Err(format!("{} is missing ({source})", js.display()))
    }
}

/// Why tsserver tests cannot run here, if they cannot.
pub fn tsserver_missing() -> Option<String> {
    if ide_ts::find_node().is_none() {
        return Some("node was not found".into());
    }
    typescript().err()
}

/// Returns `true` (and prints why) when the tsserver tests must be skipped.
pub fn skip_without_tsserver(test: &str) -> bool {
    match tsserver_missing() {
        Some(why) => {
            eprintln!("skipping {test}: {why}");
            true
        }
        None => false,
    }
}

/// A TS project with a dependency in `node_modules/fake-lib` (types in `.d.ts`, code in `.js`)
/// and a workspace package `@ws/util` linked into `node_modules` like yarn workspaces do.
/// TypeScript itself is a symlink to the TypeScript 5 test install. The project is also a git repo.
pub fn ts_project(dir: PathBuf) -> Repo {
    let r = Repo::init(dir);
    r.write(".gitignore", "node_modules/\n");
    r.write("package.json", "{ \"name\": \"demo\", \"private\": true, \"workspaces\": [\"packages/*\"] }\n");
    r.write("tsconfig.json", "{\n  \"compilerOptions\": { \"strict\": true, \"module\": \"commonjs\", \"target\": \"es2020\", \"moduleResolution\": \"node\" },\n  \"include\": [\"src\"]\n}\n");
    r.write("src/main.ts", MAIN_TS);
    r.write("src/local.ts", "export function localHelper(n: number): number {\n  return n * 2;\n}\n");
    r.write("packages/util/package.json", "{ \"name\": \"@ws/util\", \"version\": \"1.0.0\", \"main\": \"src/index.ts\", \"types\": \"src/index.ts\" }\n");
    r.write("packages/util/src/index.ts", "export function wsUtil(): string {\n  return \"ws\";\n}\n");
    r.write("node_modules/fake-lib/package.json", "{ \"name\": \"fake-lib\", \"version\": \"1.0.0\", \"main\": \"index.js\", \"types\": \"index.d.ts\" }\n");
    r.write("node_modules/fake-lib/index.d.ts", FAKE_DTS);
    r.write("node_modules/fake-lib/index.js", FAKE_JS);
    std::fs::create_dir_all(r.dir.join("node_modules/@ws")).expect("scope dir");
    std::os::unix::fs::symlink("../../packages/util", r.dir.join("node_modules/@ws/util")).expect("workspace link");
    std::os::unix::fs::symlink(typescript().expect("TypeScript 5"), r.dir.join("node_modules/typescript")).expect("typescript link");
    r.commit_all("TS project");
    r
}

/// Line/column of the identifiers the navigation tests aim at (0-based).
pub const MAIN_TS: &str = "import { greet, Options } from \"fake-lib\";\nimport { localHelper } from \"./local\";\nimport { wsUtil } from \"@ws/util\";\n\nconst opts: Options = { a: 1, b: \"x\" };\nconst message = greet(\"world\");\nconst doubled = localHelper(21);\nconst fromWs = wsUtil();\nconsole.log(message, doubled, fromWs, opts, greet(\"again\"));\n";

pub const FAKE_DTS: &str = "/** Says hello. */\nexport declare function greet(name: string): string;\n\nexport interface Options {\n  a: number;\n}\n\nexport interface Options {\n  b: string;\n}\n";

pub const FAKE_JS: &str = "\"use strict\";\nObject.defineProperty(exports, \"__esModule\", { value: true });\nexports.greet = void 0;\nfunction greet(name) {\n  return \"hello \" + name;\n}\nexports.greet = greet;\n";

// -----------------------------------------------------------------------------------------
// Cargo workspace (rust-analyzer)

/// Points `HARWEX_RUST_ANALYZER` and `RUST_SRC_PATH` at `<target>/tools/` when the
/// environment names nothing else. A rust-analyzer or rust-src elsewhere on the machine (PATH,
/// rustup) is never used, so a run does not pass by luck. Called once from `init()`, before
/// any thread starts.
pub fn use_test_rust_tools() {
    let tools = tools_dir();
    if std::env::var_os("HARWEX_RUST_ANALYZER").is_none() {
        std::env::set_var("HARWEX_RUST_ANALYZER", tools.join("rust-analyzer/bin/rust-analyzer"));
    }
    if std::env::var_os("RUST_SRC_PATH").is_none() {
        std::env::set_var("RUST_SRC_PATH", tools.join("rust-src/lib/rustlib/src/rust/library"));
    }
}

/// Returns `true` (and prints why) when rust-analyzer cannot be found.
pub fn skip_without_rust_analyzer(test: &str) -> bool {
    super::init();
    let configured = PathBuf::from(std::env::var_os("HARWEX_RUST_ANALYZER").unwrap_or_default());
    if !configured.is_file() {
        eprintln!("skipping {test}: {} is missing ({HINT})", configured.display());
        return true;
    }
    match harwex_ide::lang::rust::find_rust_analyzer(None) {
        Ok(found) if found == configured => false,
        Ok(found) => {
            eprintln!("skipping {test}: {} does not run, found {} instead", configured.display(), found.display());
            true
        }
        Err(why) => {
            eprintln!("skipping {test}: {}", why.lines().next().unwrap_or_default());
            true
        }
    }
}

/// Returns `true` (and prints why) when the standard library sources are missing.
pub fn skip_without_rust_src(test: &str) -> bool {
    super::init();
    match harwex_ide::lang::rust::rust_src_missing() {
        Some(why) => {
            eprintln!("skipping {test}: {why} ({HINT})");
            true
        }
        None => false,
    }
}

/// A Cargo workspace with two crates: `app` calls `util` (a path dependency) and uses `Vec`
/// from std. No registry dependencies, so `cargo metadata` needs no network.
pub fn cargo_project(dir: PathBuf) -> Repo {
    let r = Repo::init(dir);
    r.write(".gitignore", "target/\nCargo.lock\n");
    r.write("Cargo.toml", "[workspace]\nmembers = [\"app\", \"util\"]\nresolver = \"2\"\n");
    r.write("util/Cargo.toml", "[package]\nname = \"util\"\nversion = \"0.1.0\"\nedition = \"2021\"\n");
    r.write("util/src/lib.rs", UTIL_RS);
    r.write("app/Cargo.toml", "[package]\nname = \"app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\nutil = { path = \"../util\" }\n");
    r.write("app/src/main.rs", APP_RS);
    r.commit_all("Cargo workspace");
    r
}

/// Line/column of the identifiers the Rust tests aim at (0-based).
pub const APP_RS: &str = "use util::add;\n\nfn main() {\n    let total = add(1, 2);\n    let words: Vec<String> = Vec::new();\n    let p = util::Point { x: total };\n    println!(\"{} {} {}\", total, words.len(), p.x);\n    let again = add(3, 4);\n    println!(\"{again}\");\n}\n";

pub const UTIL_RS: &str = "/// Adds two numbers.\npub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n\n/// A point on a line.\npub struct Point {\n    pub x: i32,\n}\n";
