//! `cargo xtask test-tools`: downloads the pinned language tools the test suites run against
//! into `<target>/tools/`. Nothing goes into `~/.rustup`, `~/.cargo` or another repository.
//!
//! Layout (the test helpers in `app/tests/common` and `crates/ide-ts/tests/common` read it):
//!
//! - `ts5/node_modules/typescript`: TypeScript 5 with `lib/tsserver.js`.
//! - `ts7/node_modules/typescript` and `ts7/node_modules/@typescript/typescript-<os>-<arch>`:
//!   TypeScript 7 and its native platform package, side by side as npm installs them.
//! - `rust-analyzer/rust-analyzer`: the binary from the `rust-analyzer-preview` component.
//! - `rust-src/lib/rustlib/src/rust/library`: the standard library sources.
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
/// The Rust release that rust-analyzer and rust-src come from. Keep it at the toolchain's
/// version, so the std sources match the compiler.
pub const RUST: &str = "1.97.1";
/// sha256 of `https://static.rust-lang.org/dist/channel-rust-<RUST>.toml`.
pub const RUST_MANIFEST_SHA256: &str = "03569b1886ceb5c05276b50c8431ab111de944cd6140fe1fa7d821dd8e0f29cf";

const STAMP: &str = ".harwex-tools";
const REGISTRY: &str = "https://registry.npmjs.org";

pub fn run(tools: &Path) -> Result<(), String> {
    fs::create_dir_all(tools).map_err(|e| format!("create {}: {e}", tools.display()))?;
    let platform = npm_platform_package()?;
    provision(tools, "ts5", &[("typescript", TYPESCRIPT_5)], |stage| npm_group(stage, &[("typescript", TYPESCRIPT_5)]))?;
    let ts7 = [("typescript", TYPESCRIPT_7), (platform.as_str(), TYPESCRIPT_7)];
    provision(tools, "ts7", &ts7, |stage| npm_group(stage, &ts7))?;

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

    println!();
    println!("test tools in {}:", tools.display());
    println!("  typescript {TYPESCRIPT_5:<8} ts5/node_modules/typescript       (override: HARWEX_TEST_TS5)");
    println!("  typescript {TYPESCRIPT_7:<8} ts7/node_modules/typescript       (override: HARWEX_TEST_TS7)");
    println!("  rust-analyzer {RUST:<5} rust-analyzer/bin/rust-analyzer   (override: HARWEX_RUST_ANALYZER)");
    println!("  rust-src {RUST:<10} rust-src/lib/rustlib/src/rust/library (override: RUST_SRC_PATH)");
    Ok(())
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

/// `@typescript/typescript-<os>-<arch>`, named the way npm names `process.platform`/`arch`.
fn npm_platform_package() -> Result<String, String> {
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
