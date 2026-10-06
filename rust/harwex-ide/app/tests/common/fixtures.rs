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

/// How long a fixture waits for another run that holds its lock. One test holds a fixture
/// for under a minute (the slowest, `shell::tree_row_hit_zones`, about 30 s); a longer wait
/// means the other run hangs. It stays below nextest's 180 s, so the message wins there.
/// `HARWEX_TEST_LOCK_SECS` changes it for a run.
pub const LOCK_BUDGET: std::time::Duration = std::time::Duration::from_secs(150);

impl Fixture {
    pub fn new(suite: &str, name: &str) -> Fixture {
        let budget = super::watchdog::secs_from_env("HARWEX_TEST_LOCK_SECS").unwrap_or(LOCK_BUDGET);
        Fixture::new_within(suite, name, budget)
    }

    /// Like `new`, and panics when another run holds the fixture's lock longer than `budget`.
    pub fn new_within(suite: &str, name: &str, budget: std::time::Duration) -> Fixture {
        super::init();
        let parent = Path::new(FIXTURE_ROOT).join(suite);
        std::fs::create_dir_all(&parent).expect("create fixture root");
        let lock = lock_fixture(&parent.join(format!("{name}.lock")), &format!("{suite}/{name}"), budget);
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

/// Takes the lock file's `flock` within `budget`, then writes this process id into it, so a
/// waiting run can name the holder.
fn lock_fixture(path: &Path, fixture: &str, budget: std::time::Duration) -> std::fs::File {
    use std::io::{Read, Seek, Write};
    // No truncate on open: the file holds the current holder's pid.
    let mut lock = std::fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).open(path).expect("open fixture lock");
    let start = std::time::Instant::now();
    loop {
        match lock.try_lock() {
            Ok(()) => break,
            Err(std::fs::TryLockError::WouldBlock) => {}
            Err(std::fs::TryLockError::Error(e)) => panic!("lock fixture {fixture}: {e}"),
        }
        if start.elapsed() >= budget {
            let mut holder = String::new();
            let _ = lock.read_to_string(&mut holder);
            let holder = holder.trim();
            let holder = if holder.is_empty() { "an unknown process".to_string() } else { format!("pid {holder}") };
            panic!(
                "test `{}`: fixture {fixture} locked by another run for {} s (held by {holder}; lock file {})",
                super::watchdog::test_name(),
                start.elapsed().as_secs(),
                path.display()
            );
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    let _ = lock.set_len(0);
    let _ = lock.rewind();
    let _ = write!(lock, "{}", std::process::id());
    lock
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

/// TypeScript 7 (a `typescript` package dir with its native platform package beside its real
/// dir): `HARWEX_TEST_TS7`, else `<target>/tools/ts7/node_modules/typescript`.
pub fn typescript7() -> Result<PathBuf, String> {
    let (dir, source) = match std::env::var_os("HARWEX_TEST_TS7") {
        Some(dir) => (PathBuf::from(dir), "HARWEX_TEST_TS7"),
        None => (tools_dir().join("ts7/node_modules/typescript"), HINT),
    };
    if dir.join("package.json").is_file() {
        Ok(dir)
    } else {
        Err(format!("{} is missing ({source})", dir.display()))
    }
}

/// Returns `true` (and prints why) when the TypeScript 7 tests must be skipped.
pub fn skip_without_ts7(test: &str) -> bool {
    match typescript7() {
        Ok(_) => false,
        Err(why) => {
            eprintln!("skipping {test}: {why}");
            true
        }
    }
}

/// oxlint (an `oxlint` package dir; its native binding and `oxlint-tsgolint` sit beside its
/// real dir, as npm installs them): `HARWEX_TEST_OXLINT`, else
/// `<target>/tools/oxlint/node_modules/oxlint`.
pub fn oxlint() -> Result<PathBuf, String> {
    let (dir, source) = match std::env::var_os("HARWEX_TEST_OXLINT") {
        Some(dir) => (PathBuf::from(dir), "HARWEX_TEST_OXLINT"),
        None => (tools_dir().join("oxlint/node_modules/oxlint"), HINT),
    };
    if ide_ts::find_node().is_none() {
        return Err("node was not found".into());
    }
    if dir.join("bin/oxlint").is_file() {
        Ok(dir)
    } else {
        Err(format!("{} is missing ({source})", dir.join("bin/oxlint").display()))
    }
}

/// oxfmt (an `oxfmt` package dir; its native binding and `tinypool` sit beside its real dir,
/// as npm installs them): `HARWEX_TEST_OXFMT`, else `<target>/tools/oxfmt/node_modules/oxfmt`.
pub fn oxfmt() -> Result<PathBuf, String> {
    let (dir, source) = match std::env::var_os("HARWEX_TEST_OXFMT") {
        Some(dir) => (PathBuf::from(dir), "HARWEX_TEST_OXFMT"),
        None => (tools_dir().join("oxfmt/node_modules/oxfmt"), HINT),
    };
    if ide_ts::find_node().is_none() {
        return Err("node was not found".into());
    }
    if dir.join("bin/oxfmt").is_file() {
        Ok(dir)
    } else {
        Err(format!("{} is missing ({source})", dir.join("bin/oxfmt").display()))
    }
}

/// Returns `true` (and prints why) when the oxfmt tests must be skipped.
pub fn skip_without_oxfmt(test: &str) -> bool {
    match oxfmt() {
        Ok(_) => false,
        Err(why) => {
            eprintln!("skipping {test}: {why}");
            true
        }
    }
}

/// A project for the formatter tests: oxfmt linked into `node_modules`, an `.oxfmtrc.json`
/// with single quotes, `src/app.ts` (`UNFORMATTED_TS`) and, with `on_save`,
/// `[format.oxfmt] on_save = true` in `.harwex/ide.toml`.
pub fn oxfmt_project(dir: PathBuf, on_save: bool) -> Repo {
    let r = Repo::init(dir);
    r.write(".gitignore", "node_modules/\n");
    r.write("package.json", "{ \"name\": \"fmt\", \"private\": true }\n");
    r.write(".oxfmtrc.json", "{ \"singleQuote\": true }\n");
    r.write("src/app.ts", UNFORMATTED_TS);
    if on_save {
        r.write(".harwex/ide.toml", "[format.oxfmt]\non_save = true\n");
    }
    std::fs::create_dir_all(r.dir.join("node_modules")).expect("node_modules");
    std::os::unix::fs::symlink(oxfmt().expect("oxfmt"), r.dir.join("node_modules/oxfmt")).expect("oxfmt link");
    r.commit_all("Formatter project");
    r
}

/// Three lines; oxfmt (with single quotes) rewrites the first two and keeps the third.
pub const UNFORMATTED_TS: &str = "const a = {b:1, c:\"x\"}\nfunction f( x ){return x}\nexport const keep = 1;\n";

/// Returns `true` (and prints why) when the oxlint tests must be skipped. They also need
/// tsserver for the TypeScript errors.
pub fn skip_without_oxlint(test: &str) -> bool {
    if skip_without_tsserver(test) {
        return true;
    }
    match oxlint() {
        Ok(_) => false,
        Err(why) => {
            eprintln!("skipping {test}: {why}");
            true
        }
    }
}

/// ESLint's npm tree (a `node_modules` dir with `eslint`, `@eslint/js`, `typescript-eslint`
/// and `typescript`): `HARWEX_TEST_ESLINT`, else `<target>/tools/eslint/node_modules`.
pub fn eslint_modules() -> Result<PathBuf, String> {
    let (dir, source) = match std::env::var_os("HARWEX_TEST_ESLINT") {
        Some(dir) => (PathBuf::from(dir), "HARWEX_TEST_ESLINT"),
        None => (tools_dir().join("eslint/node_modules"), HINT),
    };
    if ide_ts::find_node().is_none() {
        return Err("node was not found".into());
    }
    for pkg in ["eslint", "@eslint/js", "typescript-eslint", "typescript"] {
        if !dir.join(pkg).join("package.json").is_file() {
            return Err(format!("{} is missing ({source})", dir.join(pkg).display()));
        }
    }
    Ok(dir)
}

/// Returns `true` (and prints why) when the ESLint tests must be skipped.
pub fn skip_without_eslint(test: &str) -> bool {
    match eslint_modules() {
        Ok(_) => false,
        Err(why) => {
            eprintln!("skipping {test}: {why}");
            true
        }
    }
}

/// Links ESLint's npm tree into `<root>/node_modules`, as a workspace root install.
pub fn link_eslint(root: &Path) {
    let modules = eslint_modules().expect("ESLint");
    std::fs::create_dir_all(root.join("node_modules/@eslint")).expect("node_modules");
    for pkg in ["eslint", "@eslint/js", "typescript-eslint", "typescript"] {
        std::os::unix::fs::symlink(modules.join(pkg), root.join("node_modules").join(pkg)).expect("eslint link");
    }
}

/// A flat ESLint config. `typed` adds typescript-eslint's `projectService` and a type-aware
/// rule; `rules` is the JS object text of extra rules.
pub fn eslint_config(typed: bool, rules: &str) -> String {
    let typed_part = if typed {
        "  {\n    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },\n    rules: { \"@typescript-eslint/no-floating-promises\": \"error\" },\n  },\n"
    } else {
        ""
    };
    format!("import tseslint from \"typescript-eslint\";\n\nexport default [\n  {{ ignores: [\"eslint.config.mjs\"] }},\n  tseslint.configs.base,\n{typed_part}  {{ files: [\"**/*.ts\"], rules: {rules} }},\n];\n")
}

/// A workspace with two packages and one ESLint install at the root: `packages/strict` has
/// a type-aware config (`no-debugger` error, `eqeqeq` warning, `no-floating-promises`) and
/// `packages/loose` a plain one (`no-console` warning only). Both hold `PROBLEMS_TS`.
pub fn eslint_project(dir: PathBuf) -> Repo {
    let r = Repo::init(dir);
    r.write(".gitignore", "node_modules/\n");
    r.write("package.json", "{ \"name\": \"lint-ws\", \"private\": true, \"workspaces\": [\"packages/*\"] }\n");
    let tsconfig = "{\n  \"compilerOptions\": { \"strict\": true, \"module\": \"commonjs\", \"target\": \"es2020\", \"lib\": [\"es2020\", \"dom\"] },\n  \"include\": [\"src\"]\n}\n";
    for (pkg, typed, rules) in [("strict", true, "{ \"no-debugger\": \"error\", eqeqeq: \"warn\" }"), ("loose", false, "{ \"no-console\": \"warn\" }")] {
        r.write(&format!("packages/{pkg}/package.json"), &format!("{{ \"name\": \"{pkg}\", \"private\": true }}\n"));
        r.write(&format!("packages/{pkg}/tsconfig.json"), tsconfig);
        r.write(&format!("packages/{pkg}/eslint.config.mjs"), &eslint_config(typed, rules));
        r.write(&format!("packages/{pkg}/src/app.ts"), PROBLEMS_TS);
    }
    link_eslint(&r.dir);
    r.commit_all("ESLint workspace");
    r
}

/// A TS file with a type error (line 3), oxlint errors (`debugger` on line 4, a floating
/// promise on line 5, type-aware) and an oxlint warning (`==` on line 6).
pub const PROBLEMS_TS: &str = "export async function load(): Promise<number> {\n  return 1;\n}\nconst count: number = \"three\";\ndebugger;\nload();\nif (count == 2) {\n  console.log(count);\n}\n";

/// A project for the diagnostics tests: `src/app.ts` (`PROBLEMS_TS`), a strict tsconfig and
/// TypeScript linked in (`native` picks TypeScript 7, else TypeScript 5). With `oxlint`, an
/// `.oxlintrc.json` and oxlint linked into `node_modules`.
pub fn problems_project(dir: PathBuf, native: bool, with_oxlint: bool) -> Repo {
    let r = Repo::init(dir);
    r.write(".gitignore", "node_modules/\n");
    r.write("package.json", "{ \"name\": \"problems\", \"private\": true }\n");
    r.write("tsconfig.json", "{\n  \"compilerOptions\": { \"strict\": true, \"module\": \"commonjs\", \"target\": \"es2020\", \"lib\": [\"es2020\", \"dom\"] },\n  \"include\": [\"src\"]\n}\n");
    r.write("src/app.ts", PROBLEMS_TS);
    std::fs::create_dir_all(r.dir.join("node_modules")).expect("node_modules");
    let ts = if native { typescript7().expect("TypeScript 7") } else { typescript().expect("TypeScript 5") };
    std::os::unix::fs::symlink(ts, r.dir.join("node_modules/typescript")).expect("typescript link");
    if with_oxlint {
        r.write(".oxlintrc.json", "{\n  \"rules\": { \"no-debugger\": \"error\", \"eqeqeq\": \"warn\", \"typescript/no-floating-promises\": \"error\" }\n}\n");
        std::os::unix::fs::symlink(oxlint().expect("oxlint"), r.dir.join("node_modules/oxlint")).expect("oxlint link");
    }
    r.commit_all("Problems project");
    r
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

/// Points the app's `HARWEX_CLANGD` at the pinned clangd, so a test that opens a C or C++ file
/// never starts a clangd from PATH or Xcode. When it is missing, the app reports clangd as not
/// found. Called once from `init()`, before any thread starts.
pub fn use_test_clangd() {
    if std::env::var_os("HARWEX_CLANGD").is_none() {
        let exe = clangd().unwrap_or_else(|_| tools_dir().join("clangd/bin/clangd"));
        std::env::set_var("HARWEX_CLANGD", exe);
    }
}

/// clangd: `HARWEX_TEST_CLANGD`, else `<target>/tools/clangd/bin/clangd`. Never PATH or Xcode:
/// the C/C++ tests pass it to the app as `[cpp] clangd` in `.harwex/ide.toml`.
pub fn clangd() -> Result<PathBuf, String> {
    let (exe, source) = match std::env::var_os("HARWEX_TEST_CLANGD") {
        Some(p) => (PathBuf::from(p), "HARWEX_TEST_CLANGD"),
        None => (tools_dir().join("clangd/bin/clangd"), HINT),
    };
    if exe.is_file() {
        Ok(exe)
    } else {
        Err(format!("{} is missing ({source})", exe.display()))
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

// -----------------------------------------------------------------------------------------
// C# and Unity (Roslyn language server)

/// The pinned .NET SDK's `dotnet`: `HARWEX_TEST_DOTNET`, else `<target>/tools/dotnet/dotnet`.
/// Never PATH or `~/.dotnet`: the C# tests pass it to the app as `[csharp] dotnet`.
pub fn dotnet() -> Result<PathBuf, String> {
    let (exe, source) = match std::env::var_os("HARWEX_TEST_DOTNET") {
        Some(p) => (PathBuf::from(p), "HARWEX_TEST_DOTNET"),
        None => (tools_dir().join("dotnet/dotnet"), HINT),
    };
    if exe.is_file() {
        Ok(exe)
    } else {
        Err(format!("{} is missing ({source})", exe.display()))
    }
}

/// The pinned Roslyn language server (its folder, or the dll): `HARWEX_TEST_ROSLYN`, else
/// `<target>/tools/roslyn`.
pub fn roslyn() -> Result<PathBuf, String> {
    let (dir, source) = match std::env::var_os("HARWEX_TEST_ROSLYN") {
        Some(p) => (PathBuf::from(p), "HARWEX_TEST_ROSLYN"),
        None => (tools_dir().join("roslyn"), HINT),
    };
    let dll = if dir.is_dir() { dir.join("Microsoft.CodeAnalysis.LanguageServer.dll") } else { dir.clone() };
    if dll.is_file() {
        Ok(dir)
    } else {
        Err(format!("{} is missing ({source})", dll.display()))
    }
}

/// Returns `true` (and prints why) when the C# tests must be skipped.
pub fn skip_without_roslyn(test: &str) -> bool {
    super::init();
    match dotnet().and_then(|_| roslyn()) {
        Ok(_) => false,
        Err(why) => {
            eprintln!("skipping {test}: {why}");
            true
        }
    }
}

/// Keeps every write of the pinned `dotnet` (first-run files, NuGet caches) inside
/// `<target>/tools/dotnet-home`, never in `~/.dotnet` or `~/.nuget`. The Roslyn server and the
/// restores it runs inherit it. Called once from `init()`, before any thread starts.
pub fn use_test_dotnet_env() {
    // Any test that opens a `.cs` file gets the pinned tools, never a server or SDK of this
    // machine; `csharp_nav` also names them in `[csharp]`.
    if let Ok(dotnet) = dotnet() {
        std::env::set_var("HARWEX_DOTNET", dotnet);
    }
    if let Ok(roslyn) = roslyn() {
        std::env::set_var("HARWEX_ROSLYN", roslyn);
    }
    let home = tools_dir().join("dotnet-home");
    for (k, v) in [
        ("DOTNET_CLI_HOME", home.clone()),
        ("NUGET_PACKAGES", home.join("nuget/packages")),
        ("NUGET_HTTP_CACHE_PATH", home.join("nuget/http-cache")),
        ("NUGET_PLUGINS_CACHE_PATH", home.join("nuget/plugins-cache")),
    ] {
        std::env::set_var(k, v);
    }
    std::env::set_var("DOTNET_CLI_TELEMETRY_OPTOUT", "1");
    std::env::set_var("DOTNET_NOLOGO", "1");
    std::env::set_var("DOTNET_GENERATE_ASPNET_CERTIFICATE", "false");
}

/// `.harwex/ide.toml` that points the C# adapter at the pinned tools.
pub fn csharp_ide_toml() -> String {
    let dotnet = dotnet().expect("pinned dotnet");
    let roslyn = roslyn().expect("pinned Roslyn");
    format!("[csharp]\nserver = \"{}\"\ndotnet = \"{}\"\n", roslyn.display(), dotnet.display())
}

/// No package source at all, so a restore never asks a feed (and never needs the network).
pub const NUGET_CONFIG: &str = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<configuration>\n  <packageSources>\n    <clear />\n  </packageSources>\n</configuration>\n";

fn sln(projects: &[(&str, &str, &str)]) -> String {
    let mut s = String::from("\nMicrosoft Visual Studio Solution File, Format Version 12.00\n# Visual Studio Version 17\n");
    for (name, path, guid) in projects {
        s.push_str(&format!("Project(\"{{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}}\") = \"{name}\", \"{path}\", \"{{{guid}}}\"\nEndProject\n"));
    }
    s.push_str("Global\n\tGlobalSection(SolutionConfigurationPlatforms) = preSolution\n\t\tDebug|Any CPU = Debug|Any CPU\n\tEndGlobalSection\n\tGlobalSection(ProjectConfigurationPlatforms) = postSolution\n");
    for (_, _, guid) in projects {
        s.push_str(&format!("\t\t{{{guid}}}.Debug|Any CPU.ActiveCfg = Debug|Any CPU\n\t\t{{{guid}}}.Debug|Any CPU.Build.0 = Debug|Any CPU\n"));
    }
    s.push_str("\tEndGlobalSection\nEndGlobal\n");
    s
}

/// A solution with two projects: `App` (an exe) references `Lib`. Pointed at the pinned tools.
pub fn csharp_solution(dir: PathBuf) -> Repo {
    let r = Repo::init(dir);
    r.write(".gitignore", "bin/\nobj/\n");
    r.write("NuGet.Config", NUGET_CONFIG);
    r.write(".harwex/ide.toml", &csharp_ide_toml());
    r.write("Shop.sln", &sln(&[("Lib", "Lib\\Lib.csproj", "11111111-1111-1111-1111-111111111111"), ("App", "App\\App.csproj", "22222222-2222-2222-2222-222222222222")]));
    r.write("Lib/Lib.csproj", "<Project Sdk=\"Microsoft.NET.Sdk\">\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n    <Nullable>enable</Nullable>\n  </PropertyGroup>\n</Project>\n");
    r.write("Lib/Greeter.cs", GREETER_CS);
    r.write("Lib/Shapes.cs", SHAPES_CS);
    r.write(
        "App/App.csproj",
        "<Project Sdk=\"Microsoft.NET.Sdk\">\n  <PropertyGroup>\n    <OutputType>Exe</OutputType>\n    <TargetFramework>net10.0</TargetFramework>\n    <Nullable>enable</Nullable>\n  </PropertyGroup>\n  <ItemGroup>\n    <ProjectReference Include=\"..\\Lib\\Lib.csproj\" />\n  </ItemGroup>\n</Project>\n",
    );
    r.write("App/Program.cs", PROGRAM_CS);
    r.commit_all("C# solution");
    r
}

pub const GREETER_CS: &str = "namespace Lib;\n\n/// <summary>Builds greetings.</summary>\npublic class Greeter\n{\n    /// <summary>Says hello to someone.</summary>\n    public string Hello(string name) => \"Hello, \" + name;\n}\n";

pub const SHAPES_CS: &str = "namespace Lib;\n\npublic interface IShape\n{\n    double Area();\n}\n\npublic class Circle : IShape\n{\n    public double Area() => 3.14;\n}\n\npublic class Square : IShape\n{\n    public double Area() => 4.0;\n}\n";

/// Lines (0-based) the C# tests aim at: 9 `Greeter`, 10 `List`, 11 `Hello`, 12 `IShape`,
/// 13 `Area` and the second `Hello`.
pub const PROGRAM_CS: &str = "using System.Collections.Generic;\nusing Lib;\n\nnamespace App;\n\npublic static class Program\n{\n    public static void Main()\n    {\n        var greeter = new Greeter();\n        var words = new List<string>();\n        words.Add(greeter.Hello(\"world\"));\n        IShape shape = new Circle();\n        System.Console.WriteLine(shape.Area() + greeter.Hello(\"again\").Length);\n    }\n}\n";

/// The stand-in for Unity's `UnityEngine.dll`: the few types the fixture scripts use.
pub const UNITY_ENGINE_CS: &str = "namespace UnityEngine\n{\n    public class Object { }\n\n    public class Component : Object\n    {\n        public Transform transform => null;\n    }\n\n    public class Behaviour : Component { }\n\n    /// <summary>The base class every Unity script derives from.</summary>\n    public class MonoBehaviour : Behaviour { }\n\n    public class Transform : Component\n    {\n        public void Translate(Vector3 translation) { }\n    }\n\n    public struct Vector3\n    {\n        public float x, y, z;\n        public static Vector3 forward => default;\n        public static Vector3 operator *(Vector3 a, float d) => a;\n    }\n}\n";

/// Lines (0-based): 2 `MonoBehaviour`, 8 `Translate`/`Vector3`, 9 `Spawner`.
pub const PLAYER_CS: &str = "using UnityEngine;\n\npublic class Player : MonoBehaviour\n{\n    public float speed = 2f;\n\n    void Update()\n    {\n        transform.Translate(Vector3.forward * speed);\n        Spawner.Count++;\n    }\n}\n";

pub const SPAWNER_CS: &str = "using UnityEngine;\n\npublic class Spawner : MonoBehaviour\n{\n    public static int Count;\n}\n";

/// The reference assemblies of the pinned SDK (`packs/Microsoft.NETCore.App.Ref/<v>/ref/<tfm>`),
/// standing in for the .NET Standard references a Unity install ships.
fn dotnet_ref_dir(dotnet: &Path) -> PathBuf {
    let packs = dotnet.parent().expect("dotnet dir").join("packs/Microsoft.NETCore.App.Ref");
    let version = std::fs::read_dir(&packs).expect("Microsoft.NETCore.App.Ref").flatten().map(|e| e.path()).max().expect("a ref pack version");
    std::fs::read_dir(version.join("ref")).expect("ref").flatten().map(|e| e.path()).max().expect("a ref tfm")
}

/// Compiles `source` into `out` with the pinned SDK's `csc`, against the SDK's references.
fn csc(dotnet: &Path, source: &Path, out: &Path) {
    let sdk = std::fs::read_dir(dotnet.parent().expect("dotnet dir").join("sdk")).expect("sdk dir").flatten().map(|e| e.path()).max().expect("an SDK");
    let refs = dotnet_ref_dir(dotnet);
    let status = Command::new(dotnet)
        .arg(sdk.join("Roslyn/bincore/csc.dll"))
        .args(["-nologo", "-noconfig", "-nostdlib", "-target:library"])
        .arg(format!("-out:{}", out.display()))
        .arg(format!("-r:{}", refs.join("System.Runtime.dll").display()))
        .arg(source)
        .stdin(std::process::Stdio::null())
        .status()
        .expect("run csc");
    assert!(status.success(), "csc failed on {}", source.display());
}

/// A Unity-shaped project in `<dir>/repo`: `Assets/`, `ProjectSettings/`, and the `.sln` and
/// SDK-style `Assembly-CSharp.csproj` that Unity's Visual Studio Editor package generates. The
/// project references a stub `UnityEngine.dll`, compiled into `<dir>/Unity/Editor/Data/Managed`
/// (outside the project, like a Unity install). `with_solution: false` leaves the generated
/// files out.
pub fn unity_project(dir: &Path, with_solution: bool) -> Repo {
    let dotnet = dotnet().expect("pinned dotnet");
    let managed = dir.join("Unity/Editor/Data/Managed");
    std::fs::create_dir_all(&managed).expect("managed dir");
    std::fs::write(managed.join("UnityEngine.cs"), UNITY_ENGINE_CS).expect("stub source");
    let engine = managed.join("UnityEngine.dll");
    csc(&dotnet, &managed.join("UnityEngine.cs"), &engine);
    std::fs::remove_file(managed.join("UnityEngine.cs")).expect("remove stub source");

    let r = Repo::init(dir.join("repo"));
    r.write(".gitignore", "Library/\nTemp/\nobj/\n*.csproj\n*.sln\n");
    r.write("NuGet.Config", NUGET_CONFIG);
    r.write(".harwex/ide.toml", &csharp_ide_toml());
    r.write("ProjectSettings/ProjectVersion.txt", "m_EditorVersion: 6000.0.30f1\n");
    r.write("Assets/Scripts/Player.cs", PLAYER_CS);
    r.write("Assets/Scripts/Spawner.cs", SPAWNER_CS);
    if with_solution {
        let refs = dotnet_ref_dir(&dotnet);
        r.write("repo.sln", &sln(&[("Assembly-CSharp", "Assembly-CSharp.csproj", "33333333-3333-3333-3333-333333333333")]));
        r.write(
            "Assembly-CSharp.csproj",
            &format!(
                "<Project ToolsVersion=\"Current\">\n  <!-- Generated file, do not modify, your changes will be overwritten (use AssetPostprocessor.OnGeneratedCSProject) -->\n  <PropertyGroup>\n    <BaseIntermediateOutputPath>Temp\\obj\\$(Configuration)\\$(MSBuildProjectName)</BaseIntermediateOutputPath>\n    <IntermediateOutputPath>$(BaseIntermediateOutputPath)</IntermediateOutputPath>\n  </PropertyGroup>\n  <Import Project=\"Sdk.props\" Sdk=\"Microsoft.NET.Sdk\" />\n  <PropertyGroup>\n    <GenerateAssemblyInfo>false</GenerateAssemblyInfo>\n    <EnableDefaultItems>false</EnableDefaultItems>\n    <AppendTargetFrameworkToOutputPath>false</AppendTargetFrameworkToOutputPath>\n    <LangVersion>9.0</LangVersion>\n    <Configuration Condition=\" '$(Configuration)' == '' \">Debug</Configuration>\n    <Platform Condition=\" '$(Platform)' == '' \">AnyCPU</Platform>\n    <OutputType>Library</OutputType>\n    <AssemblyName>Assembly-CSharp</AssemblyName>\n    <TargetFramework>netstandard2.1</TargetFramework>\n    <BaseDirectory>.</BaseDirectory>\n  </PropertyGroup>\n  <PropertyGroup>\n    <NoStandardLibraries>true</NoStandardLibraries>\n    <NoStdLib>true</NoStdLib>\n    <NoConfig>true</NoConfig>\n    <DisableImplicitFrameworkReferences>true</DisableImplicitFrameworkReferences>\n    <MSBuildWarningsAsMessages>MSB3277</MSBuildWarningsAsMessages>\n  </PropertyGroup>\n  <ItemGroup>\n    <Compile Include=\"Assets\\Scripts\\Player.cs\" />\n    <Compile Include=\"Assets\\Scripts\\Spawner.cs\" />\n  </ItemGroup>\n  <ItemGroup>\n    <Reference Include=\"UnityEngine\">\n      <HintPath>{}</HintPath>\n      <Private>False</Private>\n    </Reference>\n    <Reference Include=\"{}/*.dll\" />\n  </ItemGroup>\n  <Import Project=\"Sdk.targets\" Sdk=\"Microsoft.NET.Sdk\" />\n</Project>\n",
                engine.display(),
                refs.display()
            ),
        );
    }
    r.commit_all("Unity project");
    r
}
