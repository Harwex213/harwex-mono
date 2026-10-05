//! Workspace tasks. Run through the cargo aliases in `.cargo/config.toml`:
//!
//! - `cargo install-ide`: build `harwex-ide` in release and install it for the current user.
//! - `cargo uninstall-ide`: remove everything `install-ide` created.
//! - `cargo xtask test-tools`: download the pinned test tools into `target/tools/`.
//! - `cargo xtask test [args]` (`cargo test-all`): the full suite, one full run at a time.
//! - `cargo xtask nextest [args]`: run the tests with the pinned cargo-nextest.
//! - `cargo xtask clean-check`: run the tests the way a fresh machine would.
//!
//! Only std is used, so the task builds fast. Only `test-tools` uses the network, through the
//! system `curl`.

use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

mod clean_check;
mod full_test;
mod test_tools;
mod tools;

const BIN_NAME: &str = "harwex-ide";
const APP_NAME: &str = "Harwex IDE.app";
const BUNDLE_ID: &str = "dev.harwex.ide";
const BLOCK_START: &str = "# >>> harwex-ide >>>";
const BLOCK_END: &str = "# <<< harwex-ide <<<";

const USAGE: &str = "\
usage: cargo xtask <install|uninstall> [options]
       cargo xtask test-tools               download the pinned test tools into target/tools/
       cargo xtask test [--no-wait] [args]  the full suite (pinned nextest + doc tests) under the full-run lock;
                                            -p/--test/filters run suite-only without the lock
       cargo xtask nextest [--no-wait] [args]  cargo nextest run [args] with the pinned nextest (time limits)
       cargo xtask clean-check [--no-wait] [--dir <d>]  run test-tools + the workspace tests on a clean copy

options:
  --prefix <dir>  install root (default: ~/opt/harwex-ide); the binary goes to <dir>/bin
  --no-path       do not touch shell rc files
  --no-app        do not create or remove ~/Applications/Harwex IDE.app (macOS)
  --dry-run       print the actions, change nothing
  --yes, -y       install: install missing rustup components without asking
  --no-tools      install: skip the language tool checks
";

struct Options {
    prefix: PathBuf,
    path: bool,
    app: bool,
    dry_run: bool,
    yes: bool,
    tools: bool,
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("error: {err}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let command = args.next().ok_or_else(|| USAGE.to_string())?;
    match command.as_str() {
        "test-tools" => return test_tools::run(&target_dir(&workspace_root()).join("tools")),
        "test" => {
            let root = workspace_root();
            return full_test::run(&root, &target_dir(&root), args.collect());
        }
        "nextest" => return nextest(args.collect()),
        "clean-check" => {
            let (wait, args) = full_test::split_flags(args.collect());
            let dir = match args.as_slice() {
                [] => None,
                [flag, dir] if flag == "--dir" => Some(absolute(PathBuf::from(dir))?),
                _ => return Err(USAGE.to_string()),
            };
            let root = workspace_root();
            // Its own target dir, but the same CPU and syspolicyd: a full run like the others.
            let mut out = |line: &str| println!("{line}");
            let lock = target_dir(&root).join(full_test::LOCK_FILE);
            let _lock = full_test::acquire(&lock, &full_test::Owner::current(), &full_test::Wait::new(wait), &mut out)?;
            return clean_check::run(&root, dir);
        }
        _ => {}
    }
    let home = home_dir()?;
    let mut options = Options {
        prefix: home.join("opt").join(BIN_NAME),
        path: true,
        app: true,
        dry_run: false,
        yes: false,
        tools: true,
    };
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--prefix" => {
                let value = args.next().ok_or("--prefix needs a directory")?;
                options.prefix = absolute(expand_tilde(&value, &home))?;
            }
            "--no-path" => options.path = false,
            "--no-app" => options.app = false,
            "--dry-run" => options.dry_run = true,
            "--yes" | "-y" => options.yes = true,
            "--no-tools" => options.tools = false,
            "-h" | "--help" => {
                print!("{USAGE}");
                return Ok(());
            }
            other => return Err(format!("unknown option `{other}`\n\n{USAGE}")),
        }
    }
    match command.as_str() {
        "install" => install(&options, &home),
        "uninstall" => uninstall(&options, &home),
        "-h" | "--help" => {
            print!("{USAGE}");
            Ok(())
        }
        other => Err(format!("unknown command `{other}`\n\n{USAGE}")),
    }
}

// ---------------------------------------------------------------------------------------------
// install

fn install(options: &Options, home: &Path) -> Result<(), String> {
    if options.dry_run {
        println!("dry run: nothing will be changed");
    }
    // Before the build: the questions come while the user still watches the terminal.
    if options.tools {
        let tool_options = tools::ToolsOptions {
            yes: options.yes,
            dry_run: options.dry_run,
        };
        tools::check_and_install(&mut tools::RealHost, home, &tool_options);
    }
    let built = build(options.dry_run)?;

    let bin_dir = options.prefix.join("bin");
    let target = bin_dir.join(BIN_NAME);
    println!("install {} -> {}", built.display(), target.display());
    if !options.dry_run {
        copy_atomic(&built, &target).map_err(|e| format!("install {}: {e}", target.display()))?;
    }

    if options.app && cfg!(target_os = "macos") {
        let app = home.join("Applications").join(APP_NAME);
        println!("create {}", app.display());
        if !options.dry_run {
            write_app_bundle(&app, &target)
                .map_err(|e| format!("create {}: {e}", app.display()))?;
        }
    }

    if options.path {
        register_path(options, home, &bin_dir)?;
    }

    println!("done: run `{BIN_NAME}` from a new shell");
    Ok(())
}

/// Builds the IDE in release with the same cargo that runs this task and returns the binary path.
fn build(dry_run: bool) -> Result<PathBuf, String> {
    let cargo = env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let root = workspace_root();
    let binary = target_dir(&root).join("release").join(exe_name());
    println!("run cargo build --release -p {BIN_NAME}");
    if dry_run {
        return Ok(binary);
    }
    let status = Command::new(cargo)
        .args(["build", "--release", "-p", BIN_NAME])
        .current_dir(&root)
        .status()
        .map_err(|e| format!("cannot start cargo: {e}"))?;
    if !status.success() {
        return Err(format!("cargo build failed ({status})"));
    }
    if !binary.is_file() {
        return Err(format!("built binary not found at {}", binary.display()));
    }
    Ok(binary)
}

/// Copies to a temp file in the destination dir, then renames it over the target.
/// The rename swaps the directory entry, so a running IDE keeps its old inode intact.
fn copy_atomic(src: &Path, dst: &Path) -> io::Result<()> {
    let dir = dst.parent().expect("target has a parent dir");
    fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(".{BIN_NAME}.tmp-{}", std::process::id()));
    let result = fs::copy(src, &tmp)
        .and_then(|_| set_executable(&tmp))
        .and_then(|_| fs::rename(&tmp, dst));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

fn write_app_bundle(app: &Path, binary: &Path) -> io::Result<()> {
    let contents = app.join("Contents");
    let macos = contents.join("MacOS");
    fs::create_dir_all(&macos)?;
    let version = env!("CARGO_PKG_VERSION");
    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>Harwex IDE</string>
    <key>CFBundleDisplayName</key>
    <string>Harwex IDE</string>
    <key>CFBundleIdentifier</key>
    <string>{BUNDLE_ID}</string>
    <key>CFBundleExecutable</key>
    <string>{BIN_NAME}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleVersion</key>
    <string>{version}</string>
    <key>CFBundleShortVersionString</key>
    <string>{version}</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
"#
    );
    fs::write(contents.join("Info.plist"), plist)?;
    // Finder and the Dock start apps with a bare PATH. The IDE needs git and node, so the
    // launcher adds the usual Homebrew locations before it hands over to the real binary.
    let launcher = format!(
        "#!/bin/sh\n\
         export PATH=\"/opt/homebrew/bin:/usr/local/bin:$PATH\"\n\
         exec {} \"$@\"\n",
        sh_quote(&binary.to_string_lossy())
    );
    let launcher_path = macos.join(BIN_NAME);
    fs::write(&launcher_path, launcher)?;
    set_executable(&launcher_path)
}

// ---------------------------------------------------------------------------------------------
// PATH registration

#[derive(Clone, Copy, PartialEq)]
enum Shell {
    Zsh,
    Bash,
    Fish,
}

fn detect_shell() -> Option<Shell> {
    let shell = env::var("SHELL").ok()?;
    match Path::new(&shell).file_name()?.to_str()? {
        "zsh" => Some(Shell::Zsh),
        "bash" => Some(Shell::Bash),
        "fish" => Some(Shell::Fish),
        _ => None,
    }
}

fn rc_file(shell: Shell, home: &Path) -> PathBuf {
    match shell {
        Shell::Zsh => home.join(".zshrc"),
        Shell::Bash if cfg!(target_os = "macos") => home.join(".bash_profile"),
        Shell::Bash => home.join(".bashrc"),
        Shell::Fish => home
            .join(".config/fish/conf.d")
            .join(format!("{BIN_NAME}.fish")),
    }
}

/// The marked block that puts `bin_dir` on PATH. A dir under $HOME is written through $HOME.
fn path_block(shell: Shell, home: &Path, bin_dir: &Path) -> String {
    let dir = match bin_dir.strip_prefix(home) {
        Ok(rest) => format!("$HOME/{}", rest.display()),
        Err(_) => bin_dir.display().to_string(),
    };
    let line = match shell {
        Shell::Fish => format!("set -gx PATH \"{dir}\" $PATH"),
        Shell::Zsh | Shell::Bash => format!("export PATH=\"{dir}:$PATH\""),
    };
    format!("{BLOCK_START}\n{line}\n{BLOCK_END}\n")
}

fn register_path(options: &Options, home: &Path, bin_dir: &Path) -> Result<(), String> {
    let Some(shell) = detect_shell() else {
        println!(
            "unknown shell in $SHELL: add {} to PATH by hand",
            bin_dir.display()
        );
        return Ok(());
    };
    let rc = rc_file(shell, home);
    let block = path_block(shell, home, bin_dir);
    let text = read_or_empty(&rc)?;

    let updated = match find_block(&text) {
        Some((start, end)) if text[start..end] == block => {
            println!("PATH already set in {}", rc.display());
            return Ok(());
        }
        // The block exists with another prefix: swap only the block itself.
        Some((start, end)) => {
            println!("update PATH block in {}", rc.display());
            format!("{}{}{}", &text[..start], block, &text[end..])
        }
        None => {
            println!("add PATH block to {}", rc.display());
            let mut out = text.clone();
            if !out.is_empty() && !out.ends_with('\n') {
                out.push('\n');
            }
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(&block);
            out
        }
    };
    if !options.dry_run {
        if let Some(dir) = rc.parent() {
            fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        }
        fs::write(&rc, updated).map_err(|e| format!("write {}: {e}", rc.display()))?;
    }
    let reload = match shell {
        Shell::Fish => "exec fish".to_string(),
        _ => format!("source {}", tilde(&rc, home)),
    };
    println!("open a new shell or run `{reload}` to pick up PATH");
    Ok(())
}

/// Byte range of the marked block, including the end marker's newline.
fn find_block(text: &str) -> Option<(usize, usize)> {
    let start = line_start(text, BLOCK_START)?;
    let end_marker = start + text[start..].find(BLOCK_END)?;
    let mut end = end_marker + BLOCK_END.len();
    if text[end..].starts_with('\n') {
        end += 1;
    }
    Some((start, end))
}

/// Offset of `needle` when it starts a line.
fn line_start(text: &str, needle: &str) -> Option<usize> {
    let mut from = 0;
    while let Some(pos) = text[from..].find(needle) {
        let at = from + pos;
        if at == 0 || text.as_bytes()[at - 1] == b'\n' {
            return Some(at);
        }
        from = at + needle.len();
    }
    None
}

// ---------------------------------------------------------------------------------------------
// uninstall

fn uninstall(options: &Options, home: &Path) -> Result<(), String> {
    if options.dry_run {
        println!("dry run: nothing will be changed");
    }
    let bin_dir = options.prefix.join("bin");
    remove_path(&bin_dir, options.dry_run)?;
    // Drop the prefix itself when nothing else lives there.
    if !options.dry_run && is_empty_dir(&options.prefix) {
        let _ = fs::remove_dir(&options.prefix);
    }

    if options.app && cfg!(target_os = "macos") {
        remove_path(&home.join("Applications").join(APP_NAME), options.dry_run)?;
    }

    if options.path {
        // Check every shell, not only $SHELL: the user may have switched shells since install.
        for shell in [Shell::Zsh, Shell::Bash, Shell::Fish] {
            unregister_path(shell, home, options.dry_run)?;
        }
    }
    // Toolchain components belong to rustup and other projects use them too.
    println!("rustup components are kept: remove them with `rustup component remove rust-analyzer rust-src`");
    println!("done");
    Ok(())
}

fn unregister_path(shell: Shell, home: &Path, dry_run: bool) -> Result<(), String> {
    let rc = rc_file(shell, home);
    let text = read_or_empty(&rc)?;
    let Some((start, end)) = find_block(&text) else {
        return Ok(());
    };
    // The fish file belongs to us entirely, so it goes away as a whole.
    if shell == Shell::Fish && text[..start].trim().is_empty() && text[end..].trim().is_empty() {
        return remove_path(&rc, dry_run);
    }
    println!("remove PATH block from {}", rc.display());
    if dry_run {
        return Ok(());
    }
    // Also drop the blank separator line that install put before the block.
    let head = text[..start]
        .strip_suffix("\n\n")
        .map(|h| format!("{h}\n"))
        .unwrap_or_else(|| text[..start].to_string());
    let updated = format!("{head}{}", &text[end..]);
    fs::write(&rc, updated).map_err(|e| format!("write {}: {e}", rc.display()))
}

fn remove_path(path: &Path, dry_run: bool) -> Result<(), String> {
    let Ok(meta) = fs::symlink_metadata(path) else {
        println!("skip {} (not found)", path.display());
        return Ok(());
    };
    println!("remove {}", path.display());
    if dry_run {
        return Ok(());
    }
    let result = if meta.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    result.map_err(|e| format!("remove {}: {e}", path.display()))
}

// ---------------------------------------------------------------------------------------------
// helpers

fn home_dir() -> Result<PathBuf, String> {
    match env::var_os("HOME") {
        Some(home) if !home.is_empty() => Ok(PathBuf::from(home)),
        _ => Err("$HOME is not set".to_string()),
    }
}

/// `cargo nextest run <args>` through the pinned binary in `target/tools/nextest/`. Nothing is
/// installed into `~/.cargo`. A full run takes the full-run lock, like `cargo xtask test`.
fn nextest(args: Vec<String>) -> Result<(), String> {
    let root = workspace_root();
    let bin = test_tools::nextest_bin(&target_dir(&root).join("tools"));
    if !bin.is_file() {
        return Err(format!("{} is missing; run `cargo xtask test-tools` first", bin.display()));
    }
    let (wait, args) = full_test::split_flags(args);
    let _lock = full_test::lock_for(&args, &target_dir(&root).join(full_test::LOCK_FILE), wait)?;
    let status = Command::new(&bin)
        .args(["nextest", "run"])
        .args(&args)
        .current_dir(&root)
        .status()
        .map_err(|e| format!("cannot start {}: {e}", bin.display()))?;
    if status.success() { Ok(()) } else { Err(format!("cargo nextest run: {status}")) }
}

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("xtask lives inside the workspace")
        .to_path_buf()
}

fn target_dir(root: &Path) -> PathBuf {
    match env::var_os("CARGO_TARGET_DIR") {
        Some(dir) => root.join(dir),
        None => root.join("target"),
    }
}

fn exe_name() -> String {
    format!("{BIN_NAME}{}", env::consts::EXE_SUFFIX)
}

fn expand_tilde(value: &str, home: &Path) -> PathBuf {
    match value.strip_prefix("~/") {
        Some(rest) => home.join(rest),
        None if value == "~" => home.to_path_buf(),
        None => PathBuf::from(value),
    }
}

fn absolute(path: PathBuf) -> Result<PathBuf, String> {
    if path.is_absolute() {
        return Ok(path);
    }
    env::current_dir()
        .map(|cwd| cwd.join(path))
        .map_err(|e| format!("current dir: {e}"))
}

fn tilde(path: &Path, home: &Path) -> String {
    match path.strip_prefix(home) {
        Ok(rest) => format!("~/{}", rest.display()),
        Err(_) => path.display().to_string(),
    }
}

fn read_or_empty(path: &Path) -> Result<String, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("read {}: {e}", path.display())),
    }
}

fn is_empty_dir(path: &Path) -> bool {
    fs::read_dir(path)
        .map(|mut entries| entries.next().is_none())
        .unwrap_or(false)
}

fn sh_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

#[cfg(unix)]
fn set_executable(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o755))
}

#[cfg(not(unix))]
fn set_executable(_path: &Path) -> io::Result<()> {
    Ok(())
}
