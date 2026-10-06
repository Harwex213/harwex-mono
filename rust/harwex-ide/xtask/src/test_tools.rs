//! `cargo xtask test-tools`: downloads the pinned language tools the test suites run against
//! into `<target>/tools/`. Nothing goes into `~/.rustup`, `~/.cargo` or another repository.
//!
//! Layout (the test helpers in `app/tests/common` and `crates/ide-ts/tests/common` read it):
//!
//! - `ts5/node_modules/typescript`: TypeScript 5 with `lib/tsserver.js`.
//! - `ts7/node_modules/typescript` and `ts7/node_modules/@typescript/typescript-<os>-<arch>`:
//!   TypeScript 7 and its native platform package, side by side as npm installs them.
//! - `oxlint/node_modules/oxlint`, `@oxlint/binding-<os>-<arch>`, `oxlint-tsgolint` and
//!   `@oxlint-tsgolint/<os>-<arch>`: oxlint with its native binding and the type-aware
//!   backend (tsgolint), side by side as npm installs them.
//! - `oxfmt/node_modules/oxfmt`, `@oxfmt/binding-<os>-<arch>` and `tinypool`: the oxc
//!   formatter with its native binding and its one dependency, side by side as npm installs them.
//! - `eslint/node_modules/...`: ESLint, `@eslint/js`, typescript-eslint and TypeScript 5 with
//!   every dependency, laid out as in `eslint.lock` (an npm install tree). The lock names each
//!   tarball and its integrity, so the whole tree is pinned, not only the top packages.
//! - `rust-analyzer/rust-analyzer`: the binary from the `rust-analyzer-preview` component.
//! - `rust-src/lib/rustlib/src/rust/library`: the standard library sources.
//! - `nextest/cargo-nextest`: the cargo-nextest release binary, the test runner with per-test
//!   time limits (`.config/nextest.toml`). `cargo xtask nextest` runs it.
//!
//! The downloads use the system `curl`, `shasum` and `tar` (all present on macOS), so xtask
//! stays std-only. npm tarballs are checked against the registry's `dist.integrity` (sha512).
//! Rust tarballs are checked against the sha256 in the channel manifest, and the manifest is
//! checked against the sha256 pinned below. Each tool directory holds a stamp with its pinned
//! versions, so a second run needs no network.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// The pinned versions. Bump them here and rerun `cargo xtask test-tools`.
pub const TYPESCRIPT_5: &str = "5.9.3";
pub const TYPESCRIPT_7: &str = "7.0.2";
/// oxlint and its type-aware backend. The binding and the platform binary share the version
/// of their main package.
pub const OXLINT: &str = "1.77.0";
pub const OXLINT_TSGOLINT: &str = "7.0.2002";
/// oxfmt, the oxc formatter. The binding shares its version; `tinypool` is its only dependency.
pub const OXFMT: &str = "0.72.0";
pub const OXFMT_TINYPOOL: &str = "2.2.0";
/// ESLint and typescript-eslint. `eslint.lock` pins them with every dependency; a test checks
/// that the lock holds these versions. Regenerate the lock from an `npm install` when bumping.
pub const ESLINT: &str = "10.12.0";
pub const ESLINT_JS: &str = "10.0.1";
pub const TYPESCRIPT_ESLINT: &str = "8.71.0";
const ESLINT_LOCK: &str = include_str!("eslint.lock");
/// The Rust release that rust-analyzer and rust-src come from. Keep it at the toolchain's
/// version, so the std sources match the compiler.
pub const RUST: &str = "1.97.1";
/// sha256 of `https://static.rust-lang.org/dist/channel-rust-<RUST>.toml`.
pub const RUST_MANIFEST_SHA256: &str = "03569b1886ceb5c05276b50c8431ab111de944cd6140fe1fa7d821dd8e0f29cf";

/// cargo-nextest, as a prebuilt release binary. The sha256 values are the `.sha256` files of
/// the GitHub release, per release target.
pub const NEXTEST: &str = "0.9.146";
const NEXTEST_SHA256: &[(&str, &str)] = &[
    ("universal-apple-darwin", "39785160b3c2f6ed9a765049cf4fa79f3b39aa02eb7598a5a0e2a1a0b9ffb9a8"),
    ("x86_64-unknown-linux-gnu", "682c21b777c333e96fd532e114d3a5a894e0729ab88d94c0a9f20f8419695428"),
    ("aarch64-unknown-linux-gnu", "b2e33d7c72de7ade0ff7b3a948ac37516b24f8a836b7a8870c1f634a94be9de9"),
];

const STAMP: &str = ".harwex-tools";
const REGISTRY: &str = "https://registry.npmjs.org";

pub fn run(tools: &Path) -> Result<(), String> {
    fs::create_dir_all(tools).map_err(|e| format!("create {}: {e}", tools.display()))?;
    let platform = npm_platform_package()?;
    provision(tools, "ts5", &[("typescript", TYPESCRIPT_5)], |stage| npm_group(stage, &[("typescript", TYPESCRIPT_5)]))?;
    let ts7 = [("typescript", TYPESCRIPT_7), (platform.as_str(), TYPESCRIPT_7)];
    provision(tools, "ts7", &ts7, |stage| npm_group(stage, &ts7))?;
    let (binding, tsgolint) = oxlint_platform_packages();
    let oxlint = [
        ("oxlint", OXLINT),
        (binding.as_str(), OXLINT),
        ("oxlint-tsgolint", OXLINT_TSGOLINT),
        (tsgolint.as_str(), OXLINT_TSGOLINT),
    ];
    provision(tools, "oxlint", &oxlint, |stage| npm_group(stage, &oxlint))?;
    let oxfmt_binding = oxfmt_platform_package();
    let oxfmt = [("oxfmt", OXFMT), (oxfmt_binding.as_str(), OXFMT), ("tinypool", OXFMT_TINYPOOL)];
    provision(tools, "oxfmt", &oxfmt, |stage| npm_group(stage, &oxfmt))?;
    let lock_hash = format!("{:016x}", fnv1a(ESLINT_LOCK.as_bytes()));
    let eslint = [
        ("eslint", ESLINT),
        ("@eslint/js", ESLINT_JS),
        ("typescript-eslint", TYPESCRIPT_ESLINT),
        ("typescript", TYPESCRIPT_5),
        ("eslint.lock", lock_hash.as_str()),
    ];
    provision(tools, "eslint", &eslint, |stage| npm_lock(stage, ESLINT_LOCK))?;

    let triple = host_triple()?;
    provision(tools, "rust-analyzer", &[("rust-analyzer", RUST), ("target", triple.as_str())], |stage| {
        let manifest = rust_manifest(tools)?;
        // The rustup build of rust-analyzer links `@rpath/librustc_driver-<hash>.dylib` with
        // the rpath `@executable_path/../lib`. That library ships in the `rustc` component, so
        // the layout is `bin/rust-analyzer` plus `lib/librustc_driver-*`.
        let (url, hash) = manifest_entry(&manifest, "rust-analyzer-preview", &triple)?;
        let file = fetch(stage, &url, Hash::Sha256(&hash))?;
        let top = format!("rust-analyzer-{RUST}-{triple}");
        unpack(&file, stage, &[format!("{top}/rust-analyzer-preview/bin/rust-analyzer")])?;
        move_into(&stage.join(&top).join("rust-analyzer-preview/bin"), &stage.join("bin"))?;
        remove(&stage.join(&top))?;

        let (url, hash) = manifest_entry(&manifest, "rustc", &triple)?;
        let file = fetch(stage, &url, Hash::Sha256(&hash))?;
        let top = format!("rustc-{RUST}-{triple}");
        let driver: Vec<String> = tar_list(&file)?
            .into_iter()
            .filter(|m| m.strip_prefix(&format!("{top}/rustc/lib/")).is_some_and(|f| f.starts_with("librustc_driver-")))
            .collect();
        if driver.is_empty() {
            return Err(format!("{url} holds no rustc/lib/librustc_driver-*"));
        }
        unpack(&file, stage, &driver)?;
        move_into(&stage.join(&top).join("rustc/lib"), &stage.join("lib"))?;
        remove(&stage.join(&top))
    })?;
    provision(tools, "rust-src", &[("rust-src", RUST)], |stage| {
        let (url, hash) = manifest_entry(&rust_manifest(tools)?, "rust-src", "\"*\"")?;
        let file = fetch(stage, &url, Hash::Sha256(&hash))?;
        // The tarball holds `rust-src-<v>/rust-src/lib/rustlib/src/rust/library`.
        let top = format!("rust-src-{RUST}");
        unpack(&file, stage, &[format!("{top}/rust-src/lib")])?;
        move_into(&stage.join(&top).join("rust-src/lib"), &stage.join("lib"))?;
        remove(&stage.join(&top))
    })?;
    match nextest_target(&triple) {
        Some((target, sha256)) => provision(tools, "nextest", &[("cargo-nextest", NEXTEST), ("target", target)], |stage| {
            let url = format!("https://github.com/nextest-rs/nextest/releases/download/cargo-nextest-{NEXTEST}/cargo-nextest-{NEXTEST}-{target}.tar.gz");
            let file = fetch(stage, &url, Hash::Sha256(sha256))?;
            unpack(&file, stage, &["cargo-nextest".to_string()])
        })?,
        None => println!("skip    nextest (no pinned build for {triple}; cargo test still works)"),
    }

    println!();
    println!("test tools in {}:", tools.display());
    println!("  typescript {TYPESCRIPT_5:<8} ts5/node_modules/typescript       (override: HARWEX_TEST_TS5)");
    println!("  typescript {TYPESCRIPT_7:<8} ts7/node_modules/typescript       (override: HARWEX_TEST_TS7)");
    println!("  oxlint {OXLINT:<12} oxlint/node_modules/oxlint         (override: HARWEX_TEST_OXLINT)");
    println!("  oxfmt {OXFMT:<13} oxfmt/node_modules/oxfmt           (override: HARWEX_TEST_OXFMT)");
    println!("  eslint {ESLINT:<12} eslint/node_modules/eslint         (override: HARWEX_TEST_ESLINT, typescript-eslint {TYPESCRIPT_ESLINT})");
    println!("  rust-analyzer {RUST:<5} rust-analyzer/bin/rust-analyzer   (override: HARWEX_RUST_ANALYZER)");
    println!("  rust-src {RUST:<10} rust-src/lib/rustlib/src/rust/library (override: RUST_SRC_PATH)");
    println!("  cargo-nextest {NEXTEST} nextest/cargo-nextest             (run: cargo xtask nextest)");
    Ok(())
}

/// The nextest release target for a rustc host triple, with its pinned sha256.
fn nextest_target(triple: &str) -> Option<(&'static str, &'static str)> {
    let target = if triple.ends_with("-apple-darwin") { "universal-apple-darwin" } else { triple };
    NEXTEST_SHA256.iter().find(|(t, _)| *t == target).copied()
}

/// `tools/nextest/cargo-nextest`.
pub fn nextest_bin(tools: &Path) -> PathBuf {
    tools.join("nextest").join(format!("cargo-nextest{}", env::consts::EXE_SUFFIX))
}

/// Builds `tools/<name>` with `fill` in a staging dir and swaps it in. A directory whose stamp
/// already names the same pins is left alone without touching the network.
fn provision(
    tools: &Path,
    name: &str,
    pins: &[(&str, &str)],
    fill: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    let dir = tools.join(name);
    let stamp: String = pins.iter().map(|(k, v)| format!("{k} {v}\n")).collect();
    if fs::read_to_string(dir.join(STAMP)).ok().as_deref() == Some(stamp.as_str()) {
        println!("ok      {name} ({})", stamp.trim().replace('\n', ", "));
        return Ok(());
    }
    println!("fetch   {name} ({})", stamp.trim().replace('\n', ", "));
    let stage = tools.join(format!(".{name}.partial"));
    remove(&stage)?;
    fs::create_dir_all(&stage).map_err(|e| format!("create {}: {e}", stage.display()))?;
    fill(&stage)?;
    fs::write(stage.join(STAMP), &stamp).map_err(|e| e.to_string())?;
    remove(&dir)?;
    fs::rename(&stage, &dir).map_err(|e| format!("move {} to {}: {e}", stage.display(), dir.display()))
}

/// Unpacks npm packages into `stage/node_modules/<name>`.
fn npm_group(stage: &Path, packages: &[(&str, &str)]) -> Result<(), String> {
    for (name, version) in packages {
        let meta = curl_text(&format!("{REGISTRY}/{}/{version}", name.replace('/', "%2f")))?;
        let dist = meta.find("\"dist\"").map(|i| &meta[i..]).ok_or_else(|| format!("{name}@{version}: no dist in the registry answer"))?;
        let integrity = json_string(dist, "integrity").ok_or_else(|| format!("{name}@{version}: no dist.integrity"))?;
        let tarball = json_string(dist, "tarball").ok_or_else(|| format!("{name}@{version}: no dist.tarball"))?;
        let sha512 = integrity
            .strip_prefix("sha512-")
            .ok_or_else(|| format!("{name}@{version}: integrity is not sha512: {integrity}"))?;
        let file = fetch(stage, &tarball, Hash::Sha512Base64(sha512))?;
        let unpacked = stage.join(".unpacked");
        remove(&unpacked)?;
        fs::create_dir_all(&unpacked).map_err(|e| e.to_string())?;
        unpack(&file, &unpacked, &[])?;
        // npm tarballs hold one top-level directory, usually `package/`.
        let top = single_child(&unpacked)?;
        let target = stage.join("node_modules").join(name);
        fs::create_dir_all(target.parent().unwrap()).map_err(|e| e.to_string())?;
        fs::rename(&top, &target).map_err(|e| format!("move {}: {e}", top.display()))?;
        remove(&unpacked)?;
    }
    Ok(())
}

/// One package of a lock: where it goes, its tarball and the base64 sha512 of the tarball.
#[derive(Debug, PartialEq, Eq)]
pub struct LockEntry<'a> {
    pub dir: &'a str,
    pub url: &'a str,
    pub sha512: &'a str,
}

/// The lines of a lock file (`<dir> <url> sha512-<base64>`; `#` starts a comment).
pub fn parse_lock(lock: &str) -> Result<Vec<LockEntry<'_>>, String> {
    let mut out = Vec::new();
    for line in lock.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        let [dir, url, integrity] = parts[..] else { return Err(format!("bad lock line: {line}")) };
        let sha512 = integrity.strip_prefix("sha512-").ok_or_else(|| format!("{dir}: integrity is not sha512: {integrity}"))?;
        if !dir.starts_with("node_modules/") || dir.split('/').any(|p| p == ".." || p.is_empty()) {
            return Err(format!("bad install dir in the lock: {dir}"));
        }
        if !url.starts_with(REGISTRY) {
            return Err(format!("{dir}: tarball is not from {REGISTRY}: {url}"));
        }
        out.push(LockEntry { dir, url, sha512 });
    }
    Ok(out)
}

/// Unpacks every package of a lock into `stage/<dir>`, eight downloads at a time.
fn npm_lock(stage: &Path, lock: &str) -> Result<(), String> {
    let entries = parse_lock(lock)?;
    // Parents first, so a nested `node_modules` lands inside an unpacked package.
    let mut entries: Vec<&LockEntry> = entries.iter().collect();
    entries.sort_by_key(|e| e.dir.matches("/node_modules/").count());
    for depth in 0..=entries.last().map_or(0, |e| e.dir.matches("/node_modules/").count()) {
        let level: Vec<&&LockEntry> = entries.iter().filter(|e| e.dir.matches("/node_modules/").count() == depth).collect();
        for chunk in level.chunks(8) {
            let results: Vec<Result<(), String>> = std::thread::scope(|scope| {
                let handles: Vec<_> = chunk
                    .iter()
                    .enumerate()
                    .map(|(i, e)| scope.spawn(move || npm_package(&stage.join(format!(".dl{i}")), e.url, e.sha512, &stage.join(e.dir))))
                    .collect();
                handles.into_iter().map(|h| h.join().unwrap_or_else(|_| Err("download thread panicked".into()))).collect()
            });
            results.into_iter().collect::<Result<Vec<()>, String>>()?;
        }
    }
    Ok(())
}

/// Downloads one npm tarball into `scratch`, checks it and moves its top dir to `target`.
fn npm_package(scratch: &Path, url: &str, sha512: &str, target: &Path) -> Result<(), String> {
    remove(scratch)?;
    fs::create_dir_all(scratch).map_err(|e| e.to_string())?;
    let file = fetch(scratch, url, Hash::Sha512Base64(sha512))?;
    let unpacked = scratch.join(".unpacked");
    fs::create_dir_all(&unpacked).map_err(|e| e.to_string())?;
    unpack(&file, &unpacked, &[])?;
    let top = single_child(&unpacked)?;
    fs::create_dir_all(target.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::rename(&top, target).map_err(|e| format!("move {} to {}: {e}", top.display(), target.display()))?;
    remove(scratch)
}

/// 64-bit FNV-1a, for the stamp: a changed lock provisions again.
fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |h, &b| (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3))
}

/// The channel manifest, cached in `tools/` and checked against the pinned sha256 each time.
fn rust_manifest(tools: &Path) -> Result<String, String> {
    let path = tools.join(format!("channel-rust-{RUST}.toml"));
    if !path.is_file() || sha_hex(&path, 256)? != RUST_MANIFEST_SHA256 {
        curl_file(&format!("https://static.rust-lang.org/dist/channel-rust-{RUST}.toml"), &path)?;
        let got = sha_hex(&path, 256)?;
        if got != RUST_MANIFEST_SHA256 {
            let _ = fs::remove_file(&path);
            return Err(format!("channel-rust-{RUST}.toml: sha256 {got}, pinned {RUST_MANIFEST_SHA256}"));
        }
    }
    fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))
}

/// `url` and `hash` (sha256 hex) of `[pkg.<pkg>.target.<target>]` in a channel manifest.
pub fn manifest_entry(manifest: &str, pkg: &str, target: &str) -> Result<(String, String), String> {
    let header = format!("[pkg.{pkg}.target.{target}]");
    let start = manifest
        .lines()
        .position(|l| l.trim() == header)
        .ok_or_else(|| format!("{header} is not in channel-rust-{RUST}.toml"))?;
    let (mut url, mut hash, mut available) = (None, None, false);
    for line in manifest.lines().skip(start + 1) {
        let line = line.trim();
        if line.starts_with('[') {
            break;
        }
        let Some((key, value)) = line.split_once('=') else { continue };
        let value = value.trim().trim_matches('"').to_string();
        match key.trim() {
            "url" => url = Some(value),
            "hash" => hash = Some(value),
            "available" => available = value == "true",
            _ => {}
        }
    }
    match (available, url, hash) {
        (true, Some(url), Some(hash)) => Ok((url, hash)),
        _ => Err(format!("{header}: not available for this platform")),
    }
}

enum Hash<'a> {
    Sha256(&'a str),
    /// The base64 digest from npm's `sha512-<base64>` integrity string.
    Sha512Base64(&'a str),
}

/// Downloads `url` into `stage/.download` and checks its digest.
fn fetch(stage: &Path, url: &str, expected: Hash) -> Result<PathBuf, String> {
    let file = stage.join(".download");
    curl_file(url, &file)?;
    let (got, want) = match expected {
        Hash::Sha256(hex) => (sha_hex(&file, 256)?, hex.to_string()),
        Hash::Sha512Base64(b64) => (base64(&from_hex(&sha_hex(&file, 512)?)?), b64.to_string()),
    };
    if got != want {
        let _ = fs::remove_file(&file);
        return Err(format!("{url}: checksum {got} does not match {want}"));
    }
    Ok(file)
}

/// Unpacks `members` (all when empty) of a gzip tarball into `out` and deletes the tarball.
fn unpack(file: &Path, out: &Path, members: &[String]) -> Result<(), String> {
    let status = Command::new("tar")
        .arg("-xzf")
        .arg(file)
        .arg("-C")
        .arg(out)
        .args(members)
        .stdin(Stdio::null())
        .status()
        .map_err(|e| format!("cannot start tar: {e}"))?;
    let _ = fs::remove_file(file);
    if !status.success() {
        return Err(format!("tar failed on {} ({status})", file.display()));
    }
    Ok(())
}

fn tar_list(file: &Path) -> Result<Vec<String>, String> {
    let out = Command::new("tar")
        .arg("-tzf")
        .arg(file)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("cannot start tar: {e}"))?;
    if !out.status.success() {
        return Err(format!("tar -t failed on {}", file.display()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).lines().map(str::to_string).collect())
}

fn move_into(from: &Path, to: &Path) -> Result<(), String> {
    fs::rename(from, to).map_err(|e| format!("move {} to {}: {e}", from.display(), to.display()))
}

fn single_child(dir: &Path) -> Result<PathBuf, String> {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .map_err(|e| format!("read {}: {e}", dir.display()))?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    match entries.len() {
        1 => Ok(entries.remove(0)),
        n => Err(format!("{}: expected one top-level directory, found {n}", dir.display())),
    }
}

fn curl_file(url: &str, out: &Path) -> Result<(), String> {
    let status = Command::new("curl")
        .args(["-fsSL", "--retry", "3", "-o"])
        .arg(out)
        .arg(url)
        .stdin(Stdio::null())
        .status()
        .map_err(|e| format!("cannot start curl: {e}"))?;
    if !status.success() {
        return Err(format!("download {url} failed ({status})"));
    }
    Ok(())
}

fn curl_text(url: &str) -> Result<String, String> {
    let out = Command::new("curl")
        .args(["-fsSL", "--retry", "3", url])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("cannot start curl: {e}"))?;
    if !out.status.success() {
        return Err(format!("download {url} failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    String::from_utf8(out.stdout).map_err(|_| format!("{url}: answer is not UTF-8"))
}

/// Hex digest through `shasum -a <bits>`, or `sha<bits>sum` where shasum is missing.
fn sha_hex(file: &Path, bits: u32) -> Result<String, String> {
    let attempts = [("shasum".to_string(), vec!["-a".to_string(), bits.to_string()]), (format!("sha{bits}sum"), vec![])];
    for (program, args) in attempts {
        let Ok(out) = Command::new(&program).args(&args).arg(file).stdin(Stdio::null()).output() else { continue };
        if out.status.success() {
            let text = String::from_utf8_lossy(&out.stdout);
            return text.split_whitespace().next().map(str::to_lowercase).ok_or_else(|| format!("{program}: empty output"));
        }
    }
    Err(format!("neither shasum nor sha{bits}sum could hash {}", file.display()))
}

/// The value of the first `"key":"value"` in a JSON text. Enough for npm's flat `dist` object.
pub fn json_string(text: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let rest = &text[text.find(&needle)? + needle.len()..];
    let rest = rest.trim_start().strip_prefix(':')?.trim_start().strip_prefix('"')?;
    Some(rest[..rest.find('"')?].to_string())
}

pub fn from_hex(hex: &str) -> Result<Vec<u8>, String> {
    if !hex.len().is_multiple_of(2) {
        return Err(format!("odd hex length: {hex}"));
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).map_err(|e| format!("bad hex {hex}: {e}")))
        .collect()
}

pub fn base64(bytes: &[u8]) -> String {
    const ABC: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(ABC[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// `@oxlint/binding-<os>-<arch>[-gnu]` and `@oxlint-tsgolint/<os>-<arch>`.
fn oxlint_platform_packages() -> (String, String) {
    let (os, arch) = npm_os_arch();
    let libc = if os == "linux" { "-gnu" } else { "" };
    (format!("@oxlint/binding-{os}-{arch}{libc}"), format!("@oxlint-tsgolint/{os}-{arch}"))
}

/// `@oxfmt/binding-<os>-<arch>[-gnu]`.
fn oxfmt_platform_package() -> String {
    let (os, arch) = npm_os_arch();
    let libc = if os == "linux" { "-gnu" } else { "" };
    format!("@oxfmt/binding-{os}-{arch}{libc}")
}

/// `process.platform` and `process.arch` of node for this machine.
fn npm_os_arch() -> (&'static str, &'static str) {
    let os = match env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    };
    let arch = match env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        other => other,
    };
    (os, arch)
}

/// `@typescript/typescript-<os>-<arch>`, named the way npm names `process.platform`/`arch`.
fn npm_platform_package() -> Result<String, String> {
    let (os, arch) = npm_os_arch();
    Ok(format!("@typescript/typescript-{os}-{arch}"))
}

fn host_triple() -> Result<String, String> {
    let out = Command::new(env::var_os("RUSTC").unwrap_or_else(|| "rustc".into()))
        .arg("-vV")
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("cannot start rustc: {e}"))?;
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .find_map(|l| l.strip_prefix("host: ").map(str::to_string))
        .ok_or_else(|| "rustc -vV printed no host line".to_string())
}

fn remove(path: &Path) -> Result<(), String> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("remove {}: {e}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_npm_integrity_encoding() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(&from_hex("fb00ff").unwrap()), "+wD/");
    }

    #[test]
    fn json_string_reads_the_dist_fields() {
        let meta = r#"{"name":"typescript","dist":{"shasum":"9e","tarball":"https://r/t.tgz","integrity": "sha512-AB=="}}"#;
        let dist = &meta[meta.find("\"dist\"").unwrap()..];
        assert_eq!(json_string(dist, "tarball").as_deref(), Some("https://r/t.tgz"));
        assert_eq!(json_string(dist, "integrity").as_deref(), Some("sha512-AB=="));
        assert_eq!(json_string(dist, "missing"), None);
    }

    #[test]
    fn eslint_lock_pins_the_named_versions() {
        let entries = parse_lock(ESLINT_LOCK).unwrap();
        for (name, version) in [("eslint", ESLINT), ("@eslint/js", ESLINT_JS), ("typescript-eslint", TYPESCRIPT_ESLINT), ("typescript", TYPESCRIPT_5)] {
            let dir = format!("node_modules/{name}");
            let e = entries.iter().find(|e| e.dir == dir).unwrap_or_else(|| panic!("{dir} is not in eslint.lock"));
            let base = name.rsplit('/').next().unwrap();
            assert!(e.url.ends_with(&format!("/{base}-{version}.tgz")), "{dir}: {}", e.url);
        }
        assert!(parse_lock("node_modules/../x https://registry.npmjs.org/x.tgz sha512-AA==").is_err());
        assert!(parse_lock("node_modules/x https://evil.example/x.tgz sha512-AA==").is_err());
        assert!(parse_lock("node_modules/x https://registry.npmjs.org/x.tgz sha1-AA==").is_err());
    }

    #[test]
    fn nextest_targets_cover_macos_and_linux() {
        assert_eq!(nextest_target("aarch64-apple-darwin").map(|t| t.0), Some("universal-apple-darwin"));
        assert_eq!(nextest_target("x86_64-apple-darwin").map(|t| t.0), Some("universal-apple-darwin"));
        assert_eq!(nextest_target("x86_64-unknown-linux-gnu").map(|t| t.0), Some("x86_64-unknown-linux-gnu"));
        assert_eq!(nextest_target("x86_64-pc-windows-msvc"), None);
        assert!(NEXTEST_SHA256.iter().all(|(_, h)| h.len() == 64 && from_hex(h).is_ok()));
    }

    #[test]
    fn manifest_entry_reads_url_and_hash_of_one_section() {
        let manifest = "[pkg.rust-src.target.\"*\"]\navailable = true\nurl = \"https://x/rust-src.tar.gz\"\nhash = \"ab12\"\n\n[pkg.other.target.\"*\"]\nurl = \"no\"\n\n[pkg.ra.target.t]\navailable = false\nurl = \"u\"\nhash = \"h\"\n";
        assert_eq!(
            manifest_entry(manifest, "rust-src", "\"*\"").unwrap(),
            ("https://x/rust-src.tar.gz".to_string(), "ab12".to_string())
        );
        assert!(manifest_entry(manifest, "ra", "t").is_err());
        assert!(manifest_entry(manifest, "missing", "t").is_err());
    }
}
