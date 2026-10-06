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
//! - `clangd/bin/clangd` and `clangd/lib/clang/<major>/include`: the clangd release build from
//!   github.com/clangd/clangd (macOS universal, Linux x64), checked against a pinned sha256.
//! - `nextest/cargo-nextest`: the cargo-nextest release binary, the test runner with per-test
//!   time limits (`.config/nextest.toml`). `cargo xtask nextest` runs it.
//! - `dotnet/`: the .NET SDK archive as published (`dotnet`, `sdk/`, `shared/`, `packs/`), and
//!   `roslyn/`: the `tools/net10.0/<rid>` dir of the `roslyn-language-server.<rid>` NuGet
//!   package (`Microsoft.CodeAnalysis.LanguageServer.dll`, run as `dotnet <dll>`). Both are
//!   checked against pinned sha512 values. The C# suite keeps the SDK's own writes (first-run
//!   files, NuGet caches) in `dotnet-home/`, which this task never touches.
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

/// clangd, the C/C++ language server, as the release zip of github.com/clangd/clangd. The
/// sha256 values are the GitHub release asset digests, per zip name.
pub const CLANGD: &str = "22.1.6";
const CLANGD_SHA256: &[(&str, &str)] = &[
    ("mac", "631aef462556cbd74e0ebaae1778a38d1997d0ba3371652ca54f82652a179e7d"),
    ("linux", "a9c77443af2e447ed467e84771848d3a6ac1c56f84bcfcde717e66318de77cfa"),
];

/// The .NET SDK and the Roslyn language server for the C# suite (`csharp_nav`). The SDK is
/// the official archive (sha512 from the release metadata at
/// `builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json`); Roslyn LS is
/// the `roslyn-language-server.<rid>` dotnet tool package from nuget.org (MIT; sha512 from the
/// package's catalog entry). The server is framework-dependent and needs the SDK's runtime and
/// MSBuild. Both are big: about 230 MB + 70 MB to download, 700 MB + 180 MB unpacked.
pub const DOTNET_SDK: &str = "10.0.401";
const DOTNET_SDK_SHA512: &[(&str, &str)] = &[
    ("osx-arm64", "69f64eb00dc045398755c440b152225d544301a345a146a16e86a56a0c52b7c94b2c331520e976dbb821f18d31930aafbd25bb85961e3517e0665414ce0cbcff"),
    ("linux-x64", "51c8b999af9e8dd9998c9edc5944e19a90788862068acd38694e098889054ce8c23d4f0c5cccfa16bf187d044562359e5ee69a9f8ad0bbe913ba90311fbce25b"),
];
pub const ROSLYN: &str = "5.12.0-1.26475.2";
const ROSLYN_SHA512: &[(&str, &str)] = &[
    ("osx-arm64", "347f756e08a5818ab698c7da80a0a7eae06c4d656448eeec2c3f8fa26226d05a7eb3b1ea012299662638b84f72685279027244260b9977b89981285540c0d9a9"),
    ("linux-x64", "2a25c7a8e388b730f9583f0028b51ea32d8d0f4a395f94ad98d98c078dbc21e1483c0ea02143646d1156716e37d95064925aa07e6084a2702229f27ea52f9bbe"),
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
    match clangd_asset(&triple) {
        Some((os, sha256)) => provision(tools, "clangd", &[("clangd", CLANGD), ("os", os)], |stage| {
            let url = format!("https://github.com/clangd/clangd/releases/download/{CLANGD}/clangd-{os}-{CLANGD}.zip");
            let file = fetch(stage, &url, Hash::Sha256(sha256))?;
            unzip(&file, stage)?;
            // The zip holds `clangd_<version>/{bin,lib}`.
            let top = stage.join(format!("clangd_{CLANGD}"));
            move_into(&top.join("bin"), &stage.join("bin"))?;
            move_into(&top.join("lib"), &stage.join("lib"))?;
            remove(&top)
        })?,
        None => println!("skip    clangd (no pinned build for {triple})"),
    }
    match nextest_target(&triple) {
        Some((target, sha256)) => provision(tools, "nextest", &[("cargo-nextest", NEXTEST), ("target", target)], |stage| {
            let url = format!("https://github.com/nextest-rs/nextest/releases/download/cargo-nextest-{NEXTEST}/cargo-nextest-{NEXTEST}-{target}.tar.gz");
            let file = fetch(stage, &url, Hash::Sha256(sha256))?;
            unpack(&file, stage, &["cargo-nextest".to_string()])
        })?,
        None => println!("skip    nextest (no pinned build for {triple}; cargo test still works)"),
    }
    provision_dotnet(tools, &triple)?;

    println!();
    println!("test tools in {}:", tools.display());
    println!("  typescript {TYPESCRIPT_5:<8} ts5/node_modules/typescript       (override: HARWEX_TEST_TS5)");
    println!("  typescript {TYPESCRIPT_7:<8} ts7/node_modules/typescript       (override: HARWEX_TEST_TS7)");
    println!("  oxlint {OXLINT:<12} oxlint/node_modules/oxlint         (override: HARWEX_TEST_OXLINT)");
    println!("  oxfmt {OXFMT:<13} oxfmt/node_modules/oxfmt           (override: HARWEX_TEST_OXFMT)");
    println!("  eslint {ESLINT:<12} eslint/node_modules/eslint         (override: HARWEX_TEST_ESLINT, typescript-eslint {TYPESCRIPT_ESLINT})");
    println!("  rust-analyzer {RUST:<5} rust-analyzer/bin/rust-analyzer   (override: HARWEX_RUST_ANALYZER)");
    println!("  rust-src {RUST:<10} rust-src/lib/rustlib/src/rust/library (override: RUST_SRC_PATH)");
    println!("  clangd {CLANGD:<12} clangd/bin/clangd                  (override: HARWEX_TEST_CLANGD)");
    println!("  cargo-nextest {NEXTEST} nextest/cargo-nextest             (run: cargo xtask nextest)");
    println!("  dotnet sdk {DOTNET_SDK:<8} dotnet/dotnet                     (override: HARWEX_TEST_DOTNET)");
    println!("  roslyn {ROSLYN} roslyn/roslyn-language-server (override: HARWEX_TEST_ROSLYN)");
    Ok(())
}

/// The .NET runtime identifier of a rustc host triple, for the platforms with pinned hashes.
fn dotnet_rid(triple: &str) -> Option<&'static str> {
    match triple {
        "aarch64-apple-darwin" => Some("osx-arm64"),
        "x86_64-unknown-linux-gnu" => Some("linux-x64"),
        _ => None,
    }
}

/// `tools/dotnet` (the SDK archive as is: `dotnet`, `sdk/`, `shared/`, `packs/`) and
/// `tools/roslyn` (the server's `tools/net10.0/<rid>/` dir of the NuGet package).
fn provision_dotnet(tools: &Path, triple: &str) -> Result<(), String> {
    let Some(rid) = dotnet_rid(triple) else {
        println!("skip    dotnet and roslyn (no pinned build for {triple}; the C# suite skips)");
        return Ok(());
    };
    let pick = |table: &[(&str, &'static str)]| table.iter().find(|(r, _)| *r == rid).map(|(_, h)| *h).ok_or_else(|| format!("no pinned hash for {rid}"));
    let sdk_hash = pick(DOTNET_SDK_SHA512)?;
    provision(tools, "dotnet", &[("dotnet-sdk", DOTNET_SDK), ("rid", rid)], |stage| {
        let url = format!("https://builds.dotnet.microsoft.com/dotnet/Sdk/{DOTNET_SDK}/dotnet-sdk-{DOTNET_SDK}-{rid}.tar.gz");
        let file = fetch(stage, &url, Hash::Sha512(sdk_hash))?;
        unpack(&file, stage, &[])
    })?;
    let roslyn_hash = pick(ROSLYN_SHA512)?;
    provision(tools, "roslyn", &[("roslyn-language-server", ROSLYN), ("rid", rid)], |stage| {
        let id = format!("roslyn-language-server.{rid}");
        let url = format!("https://api.nuget.org/v3-flatcontainer/{id}/{ROSLYN}/{id}.{ROSLYN}.nupkg");
        let file = fetch(stage, &url, Hash::Sha512(roslyn_hash))?;
        let inner = format!("tools/net10.0/{rid}");
        let unpacked = stage.join(".unpacked");
        fs::create_dir_all(&unpacked).map_err(|e| e.to_string())?;
        let status = Command::new("unzip")
            .arg("-q")
            .arg(&file)
            .arg(format!("{inner}/*"))
            .arg("-d")
            .arg(&unpacked)
            .stdin(Stdio::null())
            .status()
            .map_err(|e| format!("cannot start unzip: {e}"))?;
        let _ = fs::remove_file(&file);
        if !status.success() {
            return Err(format!("unzip failed on {id}.{ROSLYN}.nupkg ({status})"));
        }
        for entry in fs::read_dir(unpacked.join(&inner)).map_err(|e| e.to_string())?.flatten() {
            move_into(&entry.path(), &stage.join(entry.file_name()))?;
        }
        remove(&unpacked)?;
        // A zip keeps no exec bit; the tool's entry point is a native apphost.
        let exe = stage.join("roslyn-language-server");
        let status = Command::new("chmod").arg("+x").arg(&exe).status().map_err(|e| format!("cannot start chmod: {e}"))?;
        if !status.success() {
            return Err(format!("chmod +x {} failed", exe.display()));
        }
        Ok(())
    })
}

/// The nextest release target for a rustc host triple, with its pinned sha256.
fn nextest_target(triple: &str) -> Option<(&'static str, &'static str)> {
    let target = if triple.ends_with("-apple-darwin") { "universal-apple-darwin" } else { triple };
    NEXTEST_SHA256.iter().find(|(t, _)| *t == target).copied()
}

/// The clangd release zip for a rustc host triple (`mac` is universal), with its pinned sha256.
fn clangd_asset(triple: &str) -> Option<(&'static str, &'static str)> {
    let os = if triple.ends_with("-apple-darwin") {
        "mac"
    } else if triple == "x86_64-unknown-linux-gnu" {
        "linux"
    } else {
        return None;
    };
    CLANGD_SHA256.iter().find(|(o, _)| *o == os).copied()
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
    Sha512(&'a str),
}

/// Downloads `url` into `stage/.download` and checks its digest.
fn fetch(stage: &Path, url: &str, expected: Hash) -> Result<PathBuf, String> {
    let file = stage.join(".download");
    curl_file(url, &file)?;
    let (got, want) = match expected {
        Hash::Sha256(hex) => (sha_hex(&file, 256)?, hex.to_string()),
        Hash::Sha512Base64(b64) => (base64(&from_hex(&sha_hex(&file, 512)?)?), b64.to_string()),
        Hash::Sha512(hex) => (sha_hex(&file, 512)?, hex.to_string()),
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

/// Unpacks a zip into `out` and deletes it: bsdtar reads zips on macOS, `unzip` elsewhere.
fn unzip(file: &Path, out: &Path) -> Result<(), String> {
    let mut cmd = if cfg!(target_os = "macos") {
        let mut c = Command::new("tar");
        c.arg("-xf").arg(file).arg("-C").arg(out);
        c
    } else {
        let mut c = Command::new("unzip");
        c.arg("-q").arg(file).arg("-d").arg(out);
        c
    };
    let status = cmd.stdin(Stdio::null()).status().map_err(|e| format!("cannot unpack {}: {e}", file.display()))?;
    let _ = fs::remove_file(file);
    if !status.success() {
        return Err(format!("unpacking {} failed ({status})", file.display()));
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
    fn clangd_assets_cover_macos_and_linux() {
        assert_eq!(clangd_asset("aarch64-apple-darwin").map(|t| t.0), Some("mac"));
        assert_eq!(clangd_asset("x86_64-unknown-linux-gnu").map(|t| t.0), Some("linux"));
        assert_eq!(clangd_asset("aarch64-unknown-linux-gnu"), None);
        assert!(CLANGD_SHA256.iter().all(|(_, h)| h.len() == 64 && from_hex(h).is_ok()));
    }

    #[test]
    fn dotnet_pins_cover_every_rid() {
        for triple in ["aarch64-apple-darwin", "x86_64-unknown-linux-gnu"] {
            let rid = dotnet_rid(triple).unwrap();
            for table in [DOTNET_SDK_SHA512, ROSLYN_SHA512] {
                let (_, h) = table.iter().find(|(r, _)| *r == rid).unwrap_or_else(|| panic!("no hash for {rid}"));
                assert!(h.len() == 128 && from_hex(h).is_ok(), "{rid}: {h}");
            }
        }
        assert_eq!(dotnet_rid("x86_64-pc-windows-msvc"), None);
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
