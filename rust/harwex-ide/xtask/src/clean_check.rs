//! `cargo xtask clean-check`: runs `cargo xtask test-tools` and the workspace tests the way a
//! fresh machine would, on this machine.
//!
//! The tests run under the pinned cargo-nextest that `test-tools` puts into
//! `$CARGO_TARGET_DIR/tools/nextest/`, so each test has the wall-clock limit of
//! `.config/nextest.toml` and a hung test is killed and named. nextest runs no doc tests, so
//! `cargo test --doc` follows. On a platform without a pinned nextest, plain `cargo test`
//! runs; the helper budgets in the test code still apply.
//!
//! - The workspace (without `target/`) is copied to `<temp>/harwex-clean/src/harwex-ide`, so a
//!   path baked relative to the real checkout breaks.
//! - The environment is cleared. `HOME` and `TMPDIR` are empty temp dirs, `CARGO_TARGET_DIR` is
//!   empty (no `target/tools/`), `CARGO_HOME` and `RUSTUP_HOME` stay real for the compiler and
//!   the crates.io cache. `PATH` holds wrappers for `cargo`, `rustc`, `rustdoc`, `git` and `node`, plus the
//!   OS base dirs (`/usr/bin:/bin:/usr/sbin:/sbin`) for the C compiler, `curl`, `tar`, `shasum`.
//! - On macOS the run goes through `sandbox-exec` with a profile that denies every read and
//!   write under `~/Projects`, `~/Library/Application Support/harwex-ide` and the toolchains'
//!   `lib/rustlib/src`. A test that still leans on another repository fails with EPERM.
//!
//! Pass: exit status 0, no failed test and no line containing `skipping`. The full log stays
//! next to the copy.

use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// `--success-output immediate` prints the output of passing tests too: the `skipping ...`
/// lines of a missing tool come from passing tests.
const TEST_COMMAND: &str = "exec 2>&1; cargo xtask test-tools || exit 1; \
nextest=\"$CARGO_TARGET_DIR/tools/nextest/cargo-nextest\"; \
if [ -x \"$nextest\" ]; then \
  \"$nextest\" nextest run --workspace --no-fail-fast --success-output immediate --failure-output immediate-final; s=$?; \
  cargo test --workspace --doc --no-fail-fast || s=1; exit $s; \
else \
  cargo test --workspace --no-fail-fast -- --nocapture; \
fi";

pub fn run(root: &Path, base: Option<PathBuf>) -> Result<(), String> {
    let real_home = canonical(Path::new(&env::var_os("HOME").ok_or("$HOME is not set")?))?;
    let cargo_home = env::var_os("CARGO_HOME").map_or_else(|| real_home.join(".cargo"), PathBuf::from);
    let rustup_home = env::var_os("RUSTUP_HOME").map_or_else(|| real_home.join(".rustup"), PathBuf::from);
    let base = match base {
        Some(dir) => dir,
        None => canonical(&env::temp_dir())?.join("harwex-clean"),
    };
    let projects = real_home.join("Projects");
    if base.starts_with(&projects) || base.starts_with(root) {
        return Err(format!("{} must lie outside {} and the workspace", base.display(), projects.display()));
    }

    let _ = fs::remove_dir_all(&base);
    let src = base.join("src/harwex-ide");
    let home = base.join("home");
    let target = base.join("target");
    let tmp = base.join("tmp");
    let bin = base.join("bin");
    for dir in [&src, &home, &target, &tmp, &bin] {
        fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    }
    println!("copy {} -> {}", root.display(), src.display());
    copy_tree(root, &src, true)?;

    // The real toolchain binaries, not the rustup proxies: the run then needs no rustup and
    // no `~/.cargo/bin` on PATH. cargo, rustc and rustdoc (doc tests) get `exec` wrappers, so the process runs from
    // its real path and rustc finds its sysroot. git and node get symlinks: a wrapper is named
    // `sh` until it execs, and the memory sampler identifies git children by name.
    let cargo = env::var_os("CARGO").map(PathBuf::from).ok_or("$CARGO is not set; run through `cargo xtask`")?;
    let rustc = cargo.with_file_name(format!("rustc{}", env::consts::EXE_SUFFIX));
    let rustdoc = cargo.with_file_name(format!("rustdoc{}", env::consts::EXE_SUFFIX));
    let git = find_in_path("git").ok_or("git is not on PATH")?;
    let node = env::var_os("HARWEX_NODE").map(PathBuf::from).or_else(|| find_in_path("node")).ok_or("node is not on PATH")?;
    for (name, real) in [("cargo", &cargo), ("rustc", &rustc), ("rustdoc", &rustdoc), ("git", &git), ("node", &node)] {
        let real = canonical(real)?;
        if name == "git" || name == "node" {
            symlink(&real, &bin.join(name))?;
        } else {
            write_wrapper(&bin.join(name), &real)?;
        }
        println!("tool {name:<6} {}", real.display());
    }
    let path = format!("{}:/usr/bin:/bin:/usr/sbin:/sbin", bin.display());

    let sysroot_src = canonical(&rustup_home)
        .map(|r| format!("^{}/toolchains/[^/]+/lib/rustlib/src(/|$)", regex_escape(&r.display().to_string())))?;
    let denied = [projects.clone(), real_home.join("Library/Application Support/harwex-ide")];
    let profile = sandbox_profile(&denied, &sysroot_src);
    fs::write(base.join("sandbox.sb"), &profile).map_err(|e| e.to_string())?;

    let mut command = if cfg!(target_os = "macos") {
        let mut c = Command::new("/usr/bin/sandbox-exec");
        c.arg("-p").arg(&profile).arg("/bin/sh");
        c
    } else {
        println!("note: sandbox-exec exists only on macOS; running without the sandbox");
        Command::new("/bin/sh")
    };
    command
        .args(["-c", TEST_COMMAND])
        .current_dir(&src)
        .env_clear()
        .env("HOME", &home)
        .env("TMPDIR", &tmp)
        .env("PATH", &path)
        .env("CARGO_HOME", &cargo_home)
        .env("RUSTUP_HOME", &rustup_home)
        .env("CARGO_TARGET_DIR", &target)
        .env("USER", env::var_os("USER").unwrap_or_default())
        .env("LANG", "en_US.UTF-8")
        .env("TERM", "dumb")
        .stdin(Stdio::null())
        .stdout(Stdio::piped());
    println!("run  {TEST_COMMAND}  (in {}, sandboxed)", src.display());
    let mut child = command.spawn().map_err(|e| format!("cannot start the sandboxed run: {e}"))?;

    let log_path = base.join("clean-check.log");
    let mut log = fs::File::create(&log_path).map_err(|e| e.to_string())?;
    let mut skips = Vec::new();
    let mut failures = Vec::new();
    let (mut passed, mut failed, mut ignored) = (0u64, 0u64, 0u64);
    for line in BufReader::new(child.stdout.take().unwrap()).lines() {
        let line = line.unwrap_or_else(|e| format!("<unreadable line: {e}>"));
        println!("{line}");
        let _ = writeln!(log, "{line}");
        if line.contains("skipping") {
            skips.push(line.clone());
        }
        if (line.starts_with("test ") && line.ends_with("... FAILED")) || is_nextest_failure(&line) {
            failures.push(line.clone());
        }
        if let Some(rest) = nextest_summary(&line) {
            passed += count_nextest(rest, "passed");
            failed += count_nextest(rest, "failed") + count_nextest(rest, "timed out");
            ignored += count_nextest(rest, "skipped");
        }
        if let Some(rest) = line.strip_prefix("test result: ") {
            passed += count(rest, "passed");
            failed += count(rest, "failed");
            ignored += count(rest, "ignored");
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;

    println!();
    println!("clean-check: {status}; {passed} passed, {failed} failed, {ignored} ignored, {} skip lines", skips.len());
    for line in failures.iter().chain(&skips) {
        println!("  {line}");
    }
    println!("log: {}", log_path.display());
    if status.success() && skips.is_empty() && failed == 0 {
        println!("clean-check passed");
        Ok(())
    } else {
        Err("clean-check failed".into())
    }
}

/// Denies reads and writes under each dir, and under paths that match `regex`.
pub fn sandbox_profile(denied: &[PathBuf], regex: &str) -> String {
    let mut profile = String::from("(version 1)\n(allow default)\n");
    for dir in denied {
        profile.push_str(&format!("(deny file-read* file-write* (subpath \"{}\"))\n", sb_quote(&dir.display().to_string())));
    }
    // `#"..."` is a raw regex literal: backslashes stay as they are.
    profile.push_str(&format!("(deny file-read* file-write* (regex #\"{}\"))\n", regex.replace('"', "\\\"")));
    profile
}

fn sb_quote(text: &str) -> String {
    text.replace('\\', "\\\\").replace('"', "\\\"")
}

fn regex_escape(text: &str) -> String {
    let mut out = String::new();
    for c in text.chars() {
        if ".^$|?*+()[]{}\\".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// The number in front of `word` in `"ok. 3 passed; 0 failed; 1 ignored; ..."`.
fn count(summary: &str, word: &str) -> u64 {
    summary
        .split(';')
        .find_map(|part| part.trim().trim_start_matches("ok. ").trim_start_matches("FAILED. ").strip_suffix(word))
        .and_then(|n| n.trim().parse().ok())
        .unwrap_or(0)
}

/// The part after `tests run:` of nextest's summary line
/// (`Summary [ 12.3s] 40 tests run: 38 passed (1 slow), 1 failed, 1 timed out, 2 skipped`).
fn nextest_summary(line: &str) -> Option<&str> {
    let rest = line.trim_start().strip_prefix("Summary [")?;
    Some(rest.split_once("tests run:")?.1)
}

/// The number in front of `word` in a nextest summary (`38 passed (1 slow), 1 failed`).
fn count_nextest(summary: &str, word: &str) -> u64 {
    summary
        .split(',')
        .find_map(|part| {
            let part = part.trim();
            let (n, rest) = part.split_once(' ')?;
            rest.starts_with(word).then(|| n.parse().ok()).flatten()
        })
        .unwrap_or(0)
}

/// A nextest status line of a failed test: `FAIL [ 1.2s] crate::bin test`, `TIMEOUT`, `SIGSEGV`...
fn is_nextest_failure(line: &str) -> bool {
    let line = line.trim_start();
    ["FAIL [", "TIMEOUT [", "SIGSEGV [", "SIGABRT [", "SIGKILL [", "ABORT ["].iter().any(|p| line.starts_with(p))
}

fn write_wrapper(path: &Path, real: &Path) -> Result<(), String> {
    let quoted = format!("'{}'", real.display().to_string().replace('\'', r"'\''"));
    fs::write(path, format!("#!/bin/sh\nexec {quoted} \"$@\"\n")).map_err(|e| format!("write {}: {e}", path.display()))?;
    crate::set_executable(path).map_err(|e| e.to_string())
}

fn find_in_path(name: &str) -> Option<PathBuf> {
    env::split_paths(&env::var_os("PATH")?).map(|d| d.join(name)).find(|p| p.is_file())
}

fn canonical(path: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(path).map_err(|e| format!("canonicalize {}: {e}", path.display()))
}

/// Copies files, dirs and symlinks (as links). Skips `target/` at the top level.
fn copy_tree(from: &Path, to: &Path, top: bool) -> Result<(), String> {
    for entry in fs::read_dir(from).map_err(|e| format!("read {}: {e}", from.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        if top && name == "target" {
            continue;
        }
        let (src, dst) = (entry.path(), to.join(&name));
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() {
            let link = fs::read_link(&src).map_err(|e| e.to_string())?;
            symlink(&link, &dst)?;
        } else if kind.is_dir() {
            fs::create_dir_all(&dst).map_err(|e| e.to_string())?;
            copy_tree(&src, &dst, false)?;
        } else {
            fs::copy(&src, &dst).map_err(|e| format!("copy {}: {e}", src.display()))?;
        }
    }
    Ok(())
}

#[cfg(unix)]
fn symlink(link: &Path, dst: &Path) -> Result<(), String> {
    std::os::unix::fs::symlink(link, dst).map_err(|e| format!("link {}: {e}", dst.display()))
}

#[cfg(not(unix))]
fn symlink(_link: &Path, dst: &Path) -> Result<(), String> {
    Err(format!("{}: symlinks are not supported here", dst.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_come_from_the_libtest_summary() {
        let line = "ok. 12 passed; 0 failed; 3 ignored; 0 measured; 0 filtered out; finished in 0.20s";
        assert_eq!(count(line, "passed"), 12);
        assert_eq!(count(line, "failed"), 0);
        assert_eq!(count(line, "ignored"), 3);
        assert_eq!(count("FAILED. 1 passed; 2 failed; 0 ignored", "failed"), 2);
    }

    #[test]
    fn counts_come_from_the_nextest_summary() {
        let line = "     Summary [  98.120s] 670 tests run: 665 passed (3 slow, 1 leaky), 2 failed, 3 timed out, 4 skipped";
        let rest = nextest_summary(line).unwrap();
        assert_eq!(count_nextest(rest, "passed"), 665);
        assert_eq!(count_nextest(rest, "failed"), 2);
        assert_eq!(count_nextest(rest, "timed out"), 3);
        assert_eq!(count_nextest(rest, "skipped"), 4);
        assert_eq!(nextest_summary("test result: ok. 1 passed"), None);
        assert!(is_nextest_failure("        FAIL [   1.234s] harwex-ide::shell tabs"));
        assert!(is_nextest_failure("     TIMEOUT [ 180.002s] harwex-ide::rust_nav jumps"));
        assert!(!is_nextest_failure("        PASS [   1.234s] harwex-ide::shell tabs"));
    }

    #[test]
    fn profile_denies_each_dir_and_the_regex() {
        let profile = sandbox_profile(&[PathBuf::from("/h/u/Projects")], "^/h/u/\\.rustup/x");
        assert!(profile.contains("(deny file-read* file-write* (subpath \"/h/u/Projects\"))"), "{profile}");
        assert!(profile.contains("(regex #\"^/h/u/\\.rustup/x\")"), "{profile}");
        assert_eq!(regex_escape("/a.b/c"), "/a\\.b/c");
    }
}
