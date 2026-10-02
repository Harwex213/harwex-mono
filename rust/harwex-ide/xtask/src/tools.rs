//! Checks the language tools the IDE uses and offers to install the missing rustup components.
//!
//! Everything that touches the machine goes through [`Host`], so the decision logic runs in
//! tests against a fake without spawning `rustup` or writing to `~/.rustup`.

use std::ffi::OsString;
use std::io::{self, BufRead, IsTerminal, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// The machine as the checks see it.
pub trait Host {
    /// Runs a short read-only command and returns its stdout. `Err` holds the first stderr line.
    fn output(&self, program: &Path, args: &[&str]) -> Result<String, String>;
    /// Runs a command with the terminal attached, so rustup shows its progress and its errors.
    fn run(&mut self, program: &Path, args: &[&str]) -> Result<(), String>;
    fn is_file(&self, path: &Path) -> bool;
    fn is_dir(&self, path: &Path) -> bool;
    fn var(&self, name: &str) -> Option<OsString>;
    /// True when both stdin and stdout are terminals.
    fn interactive(&self) -> bool;
    /// Asks a yes/no question and returns the parsed answer (see [`parse_answer`]).
    fn ask(&mut self, question: &str) -> Answer;
    fn say(&mut self, line: &str);
}

pub struct ToolsOptions {
    pub yes: bool,
    pub dry_run: bool,
}

/// A parsed reply to a `[y/N]` question.
#[derive(Debug, Clone, PartialEq)]
pub enum Answer {
    Yes,
    /// `n`, `no`, an empty line or end of input.
    No,
    /// Anything else. Holds the raw line, so the message can show what was read.
    Unclear(String),
}

/// Parses one line read from the terminal.
///
/// Escape sequences and control bytes are dropped before the match. A terminal sends them
/// without a key press: focus reports (`ESC [ I`, `ESC [ O`) when a program left focus
/// reporting on, or a reply to a query. Such bytes sit in the input queue and end up in
/// front of the user's `y`.
pub fn parse_answer(raw: &[u8]) -> Answer {
    let text = String::from_utf8_lossy(raw);
    let cleaned = strip_escapes(&text);
    match cleaned.trim().to_lowercase().as_str() {
        "y" | "yes" => Answer::Yes,
        "" | "n" | "no" => Answer::No,
        _ => Answer::Unclear(text.trim_end_matches(['\r', '\n']).to_string()),
    }
}

/// Removes CSI (`ESC [ … final`), OSC and the other string escapes (end: BEL or `ESC \`),
/// SS3 (`ESC O x`), the other two-byte escapes, and every other control character.
fn strip_escapes(text: &str) -> String {
    let mut out = String::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            match chars.next() {
                // CSI: parameter and intermediate bytes, then one final byte in @..~.
                Some('[') => {
                    for c in chars.by_ref() {
                        if ('@'..='~').contains(&c) {
                            break;
                        }
                    }
                }
                // OSC, DCS, SOS, PM, APC: a string that ends with BEL or ST (`ESC \\`).
                Some(']' | 'P' | 'X' | '^' | '_') => {
                    while let Some(c) = chars.next() {
                        if c == '\u{7}' {
                            break;
                        }
                        if c == '\u{1b}' && chars.peek() == Some(&'\\') {
                            chars.next();
                            break;
                        }
                    }
                }
                // SS3 (`ESC O x`, sent by F1-F4 and some arrow keys) takes one more byte.
                Some('O') => {
                    chars.next();
                }
                // Any other escape is two bytes long.
                _ => {}
            }
        } else if !c.is_control() {
            out.push(c);
        }
    }
    out
}

/// Shows a raw answer with its control bytes visible, e.g. `"\u{1b}[Iy"`.
fn quote_raw(raw: &str) -> String {
    format!("\"{}\"", raw.escape_debug())
}

#[derive(Debug, PartialEq)]
enum Status {
    Found { path: PathBuf, version: String },
    Missing { why: String },
}

/// The rustup components the IDE needs. `rustup component add <name>` installs each.
const COMPONENTS: [&str; 2] = ["rust-analyzer", "rust-src"];

pub fn check_and_install(host: &mut dyn Host, home: &Path, options: &ToolsOptions) {
    let cargo_bin = cargo_home(host, home).join("bin");
    let rustup = find_rustup(host, &cargo_bin);
    let statuses = [
        (
            "rust-analyzer",
            find_rust_analyzer(host, &cargo_bin, rustup.as_deref()),
        ),
        ("rust-src", find_rust_src(host, &cargo_bin)),
        ("node", find_plain(host, "node", "HARWEX_NODE")),
        ("git", find_plain(host, "git", "HARWEX_GIT")),
    ];

    host.say("language tools:");
    for (name, status) in &statuses {
        let line = match status {
            Status::Found { path, version } => {
                format!("  {name:<14} found    {version} ({})", path.display())
            }
            Status::Missing { why } => format!("  {name:<14} missing  {why}"),
        };
        host.say(&line);
    }

    for (name, status) in &statuses {
        if !matches!(status, Status::Missing { .. }) {
            continue;
        }
        match *name {
            "node" => host.say(
                "node: install it with nvm (https://github.com/nvm-sh/nvm) or `brew install node`, \
                 or set HARWEX_NODE=/path/to/node",
            ),
            "git" => host.say(
                "git: install it with `xcode-select --install` or `brew install git`, \
                 or set HARWEX_GIT=/path/to/git",
            ),
            _ => {}
        }
    }

    let missing: Vec<&str> = COMPONENTS
        .into_iter()
        .filter(|c| {
            statuses
                .iter()
                .any(|(n, s)| n == c && matches!(s, Status::Missing { .. }))
        })
        .collect();
    if missing.is_empty() {
        return;
    }
    let Some(rustup) = rustup else {
        host.say("rustup not found: get it from https://rustup.rs, then run:");
        for component in &missing {
            host.say(&format!("  rustup component add {component}"));
        }
        return;
    };
    let interactive = host.interactive();
    for component in missing {
        let command = format!("rustup component add {component}");
        if options.dry_run {
            let how = if options.yes {
                "--yes given"
            } else if interactive {
                "after asking"
            } else {
                "skipped: not a terminal"
            };
            host.say(&format!("would run `{command}` ({how})"));
            continue;
        }
        let approved = if options.yes {
            true
        } else if interactive {
            match ask_twice(host, &format!("Install {component} via rustup? [y/N] ")) {
                Answer::Yes => true,
                Answer::No => false,
                Answer::Unclear(raw) => {
                    host.say(&format!(
                        "skip {component}: answer {} not understood. Run `{command}` later",
                        quote_raw(&raw)
                    ));
                    continue;
                }
            }
        } else {
            host.say(&format!(
                "skip {component} (not a terminal): run `{command}`"
            ));
            continue;
        };
        if !approved {
            host.say(&format!("skip {component}: run `{command}` later"));
            continue;
        }
        host.say(&format!("run {command}"));
        match host.run(&rustup, &["component", "add", component]) {
            Ok(()) => host.say(&format!("installed {component}")),
            Err(e) => host.say(&format!(
                "{command} failed: {e}. The IDE install continues without {component}."
            )),
        }
    }
}

/// Asks once more when the first answer is neither yes nor no.
fn ask_twice(host: &mut dyn Host, question: &str) -> Answer {
    match host.ask(question) {
        Answer::Unclear(raw) => {
            host.say(&format!(
                "answer {} not understood: type y or n",
                quote_raw(&raw)
            ));
            host.ask(question)
        }
        answer => answer,
    }
}

fn cargo_home(host: &dyn Host, home: &Path) -> PathBuf {
    match host.var("CARGO_HOME") {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir),
        _ => home.join(".cargo"),
    }
}

fn path_dirs(host: &dyn Host) -> Vec<PathBuf> {
    std::env::split_paths(&host.var("PATH").unwrap_or_default()).collect()
}

/// `~/.cargo/bin/rustup` first, as the app does, then PATH (Homebrew ships rustup there).
fn find_rustup(host: &dyn Host, cargo_bin: &Path) -> Option<PathBuf> {
    std::iter::once(cargo_bin.to_path_buf())
        .chain(path_dirs(host))
        .map(|dir| dir.join("rustup"))
        .find(|p| host.is_file(p))
}

/// Same order as the app: HARWEX_RUST_ANALYZER, PATH, `~/.cargo/bin`, `rustup which`.
/// A candidate counts only if `--version` answers like rust-analyzer. The rustup proxy
/// without the component exists as a file but fails `--version`, so it counts as missing.
fn find_rust_analyzer(host: &dyn Host, cargo_bin: &Path, rustup: Option<&Path>) -> Status {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(p) = host.var("HARWEX_RUST_ANALYZER") {
        candidates.push(PathBuf::from(p));
    }
    candidates.extend(path_dirs(host).into_iter().map(|d| d.join("rust-analyzer")));
    candidates.push(cargo_bin.join("rust-analyzer"));
    let mut last_error = None;
    let mut tried: Vec<PathBuf> = Vec::new();
    let mut probe = |p: PathBuf, last_error: &mut Option<String>| -> Option<Status> {
        if tried.contains(&p) || !host.is_file(&p) {
            return None;
        }
        tried.push(p.clone());
        match host.output(&p, &["--version"]) {
            Ok(out) if out.starts_with("rust-analyzer") => Some(Status::Found {
                path: p,
                version: out.trim().to_string(),
            }),
            Ok(out) => {
                *last_error = Some(format!(
                    "{}: unexpected --version {:?}",
                    p.display(),
                    out.trim()
                ));
                None
            }
            Err(e) => {
                *last_error = Some(format!("{}: {e}", p.display()));
                None
            }
        }
    };
    for p in candidates {
        if let Some(found) = probe(p, &mut last_error) {
            return found;
        }
    }
    if let Some(rustup) = rustup {
        if let Ok(out) = host.output(rustup, &["which", "rust-analyzer"]) {
            if let Some(found) = probe(PathBuf::from(out.trim()), &mut last_error) {
                return found;
            }
        }
    }
    Status::Missing {
        why: last_error.unwrap_or_else(|| "not on PATH or in ~/.cargo/bin".to_string()),
    }
}

/// Present when `$(rustc --print sysroot)/lib/rustlib/src/rust/library` exists.
fn find_rust_src(host: &dyn Host, cargo_bin: &Path) -> Status {
    let rustc = Some(cargo_bin.join("rustc"))
        .filter(|p| host.is_file(p))
        .unwrap_or_else(|| PathBuf::from("rustc"));
    let sysroot = match host.output(&rustc, &["--print", "sysroot"]) {
        Ok(out) => PathBuf::from(out.trim()),
        Err(e) => {
            return Status::Missing {
                why: format!("rustc --print sysroot: {e}"),
            }
        }
    };
    let library = sysroot.join("lib/rustlib/src/rust/library");
    if host.is_dir(&library) {
        Status::Found {
            path: library,
            version: "present".to_string(),
        }
    } else {
        Status::Missing {
            why: format!("{} does not exist", library.display()),
        }
    }
}

/// An override variable, then PATH, then the Homebrew dirs the `.app` launcher adds.
fn find_plain(host: &dyn Host, name: &str, override_var: &str) -> Status {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(p) = host.var(override_var) {
        candidates.push(PathBuf::from(p));
    }
    candidates.extend(path_dirs(host).into_iter().map(|d| d.join(name)));
    for dir in ["/opt/homebrew/bin", "/usr/local/bin"] {
        candidates.push(Path::new(dir).join(name));
    }
    for p in candidates {
        if !host.is_file(&p) {
            continue;
        }
        if let Ok(out) = host.output(&p, &["--version"]) {
            return Status::Found {
                path: p,
                version: out.trim().to_string(),
            };
        }
    }
    Status::Missing {
        why: format!("{name} not on PATH"),
    }
}

// ---------------------------------------------------------------------------------------------
// the real machine

pub struct RealHost;

impl Host for RealHost {
    fn output(&self, program: &Path, args: &[&str]) -> Result<String, String> {
        let mut child = Command::new(program)
            .args(args)
            // A rust-toolchain.toml that names a missing toolchain must not start a download.
            .env("RUSTUP_AUTO_INSTALL", "0")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        let deadline = Instant::now() + Duration::from_secs(10);
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(10));
                }
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("timed out".to_string());
                }
            }
        };
        let mut stdout = String::new();
        let mut stderr = String::new();
        if let Some(mut s) = child.stdout.take() {
            let _ = s.read_to_string(&mut stdout);
        }
        if let Some(mut s) = child.stderr.take() {
            let _ = s.read_to_string(&mut stderr);
        }
        if status.success() {
            Ok(stdout)
        } else {
            Err(stderr.lines().next().unwrap_or("failed").trim().to_string())
        }
    }

    fn run(&mut self, program: &Path, args: &[&str]) -> Result<(), String> {
        // stdout and stderr stay on the terminal, so the user sees rustup's progress and its
        // errors. stdin is closed: no child may read the keys meant for the next question.
        let status = Command::new(program)
            .args(args)
            .stdin(Stdio::null())
            .status()
            .map_err(|e| format!("cannot start {}: {e}", program.display()))?;
        if status.success() {
            Ok(())
        } else {
            Err(status.to_string())
        }
    }

    fn is_file(&self, path: &Path) -> bool {
        path.is_file()
    }

    fn is_dir(&self, path: &Path) -> bool {
        path.is_dir()
    }

    fn var(&self, name: &str) -> Option<OsString> {
        std::env::var_os(name)
    }

    fn interactive(&self) -> bool {
        io::stdin().is_terminal() && io::stdout().is_terminal()
    }

    fn ask(&mut self, question: &str) -> Answer {
        // Bytes that reached the terminal before the question are not an answer to it:
        // keys typed during the cargo build, or focus reports. Drop them.
        discard_pending_input();
        print!("{question}");
        let _ = io::stdout().flush();
        let mut line = Vec::new();
        match io::stdin().lock().read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => Answer::No,
            Ok(_) => parse_answer(&line),
        }
    }

    fn say(&mut self, line: &str) {
        println!("{line}");
    }
}

/// Drops the bytes waiting in the terminal's input queue (`tcflush(0, TCIFLUSH)`).
#[cfg(unix)]
fn discard_pending_input() {
    use std::os::raw::c_int;
    extern "C" {
        fn tcflush(fd: c_int, queue_selector: c_int) -> c_int;
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    const TCIFLUSH: c_int = 0;
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    const TCIFLUSH: c_int = 1;
    // SAFETY: tcflush only takes two integers. On a non-terminal fd it fails with ENOTTY.
    unsafe {
        tcflush(0, TCIFLUSH);
    }
}

#[cfg(not(unix))]
fn discard_pending_input() {}

// ---------------------------------------------------------------------------------------------
// tests

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};

    const HOME: &str = "/fake-home/u";
    const CARGO_BIN: &str = "/fake-home/u/.cargo/bin";
    const SYSROOT: &str = "/fake-home/u/.rustup/toolchains/stable";
    const LIBRARY: &str = "/fake-home/u/.rustup/toolchains/stable/lib/rustlib/src/rust/library";
    const PROXY_ERROR: &str =
        "error: Unknown binary 'rust-analyzer' in official toolchain 'stable'.";

    /// A machine described by tables. Commands not listed fail.
    struct Fake {
        files: HashSet<PathBuf>,
        dirs: HashSet<PathBuf>,
        vars: HashMap<String, OsString>,
        outputs: HashMap<String, Result<String, String>>,
        install_fails: bool,
        interactive: bool,
        /// Answers given in order. When they run out, every question gets `Yes`.
        answers: Vec<Answer>,
        asked: Vec<String>,
        ran: Vec<String>,
        said: Vec<String>,
    }

    fn key(program: &Path, args: &[&str]) -> String {
        format!("{} {}", program.display(), args.join(" "))
    }

    impl Host for Fake {
        fn output(&self, program: &Path, args: &[&str]) -> Result<String, String> {
            self.outputs
                .get(&key(program, args))
                .cloned()
                .unwrap_or_else(|| Err(format!("no such command {}", program.display())))
        }
        fn run(&mut self, program: &Path, args: &[&str]) -> Result<(), String> {
            self.ran.push(key(program, args));
            if self.install_fails {
                Err("exit status: 1".to_string())
            } else {
                Ok(())
            }
        }
        fn is_file(&self, path: &Path) -> bool {
            self.files.contains(path)
        }
        fn is_dir(&self, path: &Path) -> bool {
            self.dirs.contains(path)
        }
        fn var(&self, name: &str) -> Option<OsString> {
            self.vars.get(name).cloned()
        }
        fn interactive(&self) -> bool {
            self.interactive
        }
        fn ask(&mut self, question: &str) -> Answer {
            self.asked.push(question.to_string());
            if self.answers.is_empty() {
                Answer::Yes
            } else {
                self.answers.remove(0)
            }
        }
        fn say(&mut self, line: &str) {
            self.said.push(line.to_string());
        }
    }

    impl Fake {
        /// rustup in ~/.cargo/bin with both proxies, but neither component installed.
        fn bare_rustup() -> Fake {
            let mut fake = Fake {
                files: HashSet::new(),
                dirs: HashSet::new(),
                vars: HashMap::from([("PATH".to_string(), OsString::from(CARGO_BIN))]),
                outputs: HashMap::new(),
                install_fails: false,
                interactive: true,
                answers: Vec::new(),
                asked: Vec::new(),
                ran: Vec::new(),
                said: Vec::new(),
            };
            for tool in ["rustup", "rustc", "rust-analyzer"] {
                fake.files.insert(Path::new(CARGO_BIN).join(tool));
            }
            fake.cmd(
                &format!("{CARGO_BIN}/rust-analyzer --version"),
                Err(PROXY_ERROR),
            );
            fake.cmd(
                &format!("{CARGO_BIN}/rustup which rust-analyzer"),
                Err(PROXY_ERROR),
            );
            fake.cmd(&format!("{CARGO_BIN}/rustc --print sysroot"), Ok(SYSROOT));
            fake
        }

        fn cmd(&mut self, command: &str, result: Result<&str, &str>) {
            self.outputs.insert(
                command.to_string(),
                result.map(str::to_string).map_err(str::to_string),
            );
        }

        fn with_components(mut self) -> Fake {
            self.cmd(
                &format!("{CARGO_BIN}/rust-analyzer --version"),
                Ok("rust-analyzer 1.90.0 (1159e78c 2025-09-14)\n"),
            );
            self.dirs.insert(PathBuf::from(LIBRARY));
            self
        }

        fn without_rustup(mut self) -> Fake {
            self.files.remove(&Path::new(CARGO_BIN).join("rustup"));
            self
        }

        fn check(&mut self, yes: bool, dry_run: bool) {
            check_and_install(self, Path::new(HOME), &ToolsOptions { yes, dry_run });
        }

        fn said(&self, needle: &str) -> bool {
            self.said.iter().any(|l| l.contains(needle))
        }
    }

    fn add(component: &str) -> String {
        format!("{CARGO_BIN}/rustup component add {component}")
    }

    #[test]
    fn proxy_without_component_is_missing() {
        let mut fake = Fake::bare_rustup();
        let cargo_bin = Path::new(CARGO_BIN);
        let rustup = cargo_bin.join("rustup");
        let status = find_rust_analyzer(&fake, cargo_bin, Some(&rustup));
        let Status::Missing { why } = status else {
            panic!("the proxy must not count as found: {status:?}");
        };
        assert!(why.contains("Unknown binary"), "{why}");
        fake.check(false, false);
        assert!(fake.said("rust-analyzer  missing"), "{:?}", fake.said);
    }

    #[test]
    fn rustup_which_finds_a_toolchain_binary() {
        let mut fake = Fake::bare_rustup();
        let real = "/fake-home/u/.rustup/toolchains/stable/bin/rust-analyzer";
        fake.files.insert(PathBuf::from(real));
        fake.cmd(&format!("{CARGO_BIN}/rustup which rust-analyzer"), Ok(real));
        fake.cmd(&format!("{real} --version"), Ok("rust-analyzer 1.90.0"));
        let rustup = Path::new(CARGO_BIN).join("rustup");
        let status = find_rust_analyzer(&fake, Path::new(CARGO_BIN), Some(&rustup));
        assert!(
            matches!(status, Status::Found { ref path, .. } if path == Path::new(real)),
            "{status:?}"
        );
    }

    #[test]
    fn everything_present_installs_nothing() {
        let mut fake = Fake::bare_rustup().with_components();
        fake.check(false, false);
        assert!(
            fake.said("rust-analyzer  found    rust-analyzer 1.90.0"),
            "{:?}",
            fake.said
        );
        assert!(fake.said("rust-src       found"), "{:?}", fake.said);
        assert!(fake.asked.is_empty() && fake.ran.is_empty());
    }

    #[test]
    fn tty_asks_for_each_component() {
        let mut fake = Fake::bare_rustup();
        fake.check(false, false);
        assert_eq!(
            fake.asked,
            [
                "Install rust-analyzer via rustup? [y/N] ",
                "Install rust-src via rustup? [y/N] "
            ]
        );
        assert_eq!(fake.ran, [add("rust-analyzer"), add("rust-src")]);
    }

    #[test]
    fn tty_answer_no_skips_with_the_command() {
        let mut fake = Fake::bare_rustup();
        fake.answers = vec![Answer::No, Answer::No];
        fake.check(false, false);
        assert_eq!(fake.asked.len(), 2);
        assert!(fake.ran.is_empty());
        assert!(
            fake.said("run `rustup component add rust-src` later"),
            "{:?}",
            fake.said
        );
    }

    #[test]
    fn non_tty_without_yes_prints_the_command() {
        let mut fake = Fake::bare_rustup();
        fake.interactive = false;
        fake.check(false, false);
        assert!(fake.asked.is_empty() && fake.ran.is_empty());
        assert!(
            fake.said(
                "skip rust-analyzer (not a terminal): run `rustup component add rust-analyzer`"
            ),
            "{:?}",
            fake.said
        );
    }

    #[test]
    fn yes_installs_without_asking() {
        let mut fake = Fake::bare_rustup();
        fake.interactive = false;
        fake.check(true, false);
        assert!(fake.asked.is_empty());
        assert_eq!(fake.ran, [add("rust-analyzer"), add("rust-src")]);
    }

    #[test]
    fn dry_run_runs_and_asks_nothing() {
        for (yes, interactive) in [(false, true), (true, true), (false, false)] {
            let mut fake = Fake::bare_rustup();
            fake.interactive = interactive;
            fake.check(yes, true);
            assert!(
                fake.asked.is_empty() && fake.ran.is_empty(),
                "yes={yes} tty={interactive}"
            );
            assert!(
                fake.said("would run `rustup component add rust-analyzer`"),
                "{:?}",
                fake.said
            );
        }
    }

    #[test]
    fn missing_rustup_prints_how_to_get_it() {
        let mut fake = Fake::bare_rustup().without_rustup();
        fake.check(true, false);
        assert!(fake.ran.is_empty());
        assert!(
            fake.said("rustup not found: get it from https://rustup.rs"),
            "{:?}",
            fake.said
        );
        assert!(
            fake.said("  rustup component add rust-src"),
            "{:?}",
            fake.said
        );
    }

    #[test]
    fn failed_install_continues_with_the_next_component() {
        let mut fake = Fake::bare_rustup();
        fake.install_fails = true;
        fake.check(true, false);
        assert_eq!(fake.ran.len(), 2, "the second component is still tried");
        assert!(
            fake.said("rustup component add rust-analyzer failed: exit status: 1"),
            "{:?}",
            fake.said
        );
    }

    #[test]
    fn node_and_git_are_reported_but_never_installed() {
        let mut fake = Fake::bare_rustup().with_components();
        fake.check(true, false);
        assert!(fake.said("node           missing"), "{:?}", fake.said);
        assert!(fake.said("nvm"), "{:?}", fake.said);
        assert!(fake.said("git            missing"), "{:?}", fake.said);
        assert!(fake.ran.is_empty());

        let mut fake = Fake::bare_rustup().with_components();
        fake.files.insert(PathBuf::from("/opt/homebrew/bin/git"));
        fake.cmd(
            "/opt/homebrew/bin/git --version",
            Ok("git version 2.50.0\n"),
        );
        fake.check(false, false);
        assert!(
            fake.said("git            found    git version 2.50.0 (/opt/homebrew/bin/git)"),
            "{:?}",
            fake.said
        );
    }

    #[test]
    fn rustup_on_path_is_used_when_cargo_bin_has_none() {
        let mut fake = Fake::bare_rustup().without_rustup();
        fake.vars.insert(
            "PATH".to_string(),
            OsString::from(format!("/opt/homebrew/bin:{CARGO_BIN}")),
        );
        fake.files.insert(PathBuf::from("/opt/homebrew/bin/rustup"));
        fake.check(true, false);
        assert_eq!(
            fake.ran[0],
            "/opt/homebrew/bin/rustup component add rust-analyzer"
        );
    }

    #[test]
    fn unclear_answer_is_asked_again() {
        let mut fake = Fake::bare_rustup();
        fake.answers = vec![Answer::Unclear("\u{1b}[Oyy".to_string()), Answer::Yes];
        fake.check(false, false);
        assert_eq!(fake.asked.len(), 3, "{:?}", fake.asked);
        assert!(
            fake.said(r#"answer "\u{1b}[Oyy" not understood: type y or n"#),
            "{:?}",
            fake.said
        );
        assert_eq!(fake.ran, [add("rust-analyzer"), add("rust-src")]);
    }

    #[test]
    fn two_unclear_answers_skip_and_show_the_answer() {
        let mut fake = Fake::bare_rustup();
        fake.answers = vec![
            Answer::Unclear("ok".to_string()),
            Answer::Unclear("sure".to_string()),
        ];
        fake.check(false, false);
        assert_eq!(fake.ran, [add("rust-src")]);
        assert!(
            fake.said(r#"skip rust-analyzer: answer "sure" not understood"#),
            "{:?}",
            fake.said
        );
    }

    #[test]
    fn parse_answer_accepts_yes_and_no() {
        for raw in ["y\n", "Y\n", "yes\n", " YES \r\n", "y"] {
            assert_eq!(parse_answer(raw.as_bytes()), Answer::Yes, "{raw:?}");
        }
        for raw in ["n\n", "No\n", "\n", "", "  \n"] {
            assert_eq!(parse_answer(raw.as_bytes()), Answer::No, "{raw:?}");
        }
    }

    #[test]
    fn parse_answer_drops_terminal_noise() {
        let cases = [
            "\u{1b}[O\u{1b}[Iy\n",                // focus out, focus in
            "\u{1b}]11;rgb:1e1e/1e1e/1e1e\u{7}y\n", // OSC reply ending with BEL
            "\u{1b}]11;rgb:0/0/0\u{1b}\\y\n",       // OSC reply ending with ST
            "\u{1b}[?62;22c\u{1b}[12;40Ryes\n",     // DA and cursor position replies
            "\u{1b}OPy\n",                          // SS3 key (F1)
            "\u{1b}[200~y\u{1b}[201~\n",            // bracketed paste
            "\u{7}\u{0}y\n",                        // stray control bytes
        ];
        for raw in cases {
            assert_eq!(parse_answer(raw.as_bytes()), Answer::Yes, "{raw:?}");
        }
        assert_eq!(parse_answer(b"\x1b[A\n"), Answer::No, "an arrow key alone");
    }

    #[test]
    fn parse_answer_keeps_the_raw_line_when_unclear() {
        assert_eq!(
            parse_answer(b"\x1b[Iyy\r\n"),
            Answer::Unclear("\u{1b}[Iyy".to_string())
        );
        assert_eq!(parse_answer(b"abcy\n"), Answer::Unclear("abcy".to_string()));
        assert_eq!(
            parse_answer(b"\xffy\n"),
            Answer::Unclear("\u{fffd}y".to_string()),
            "invalid UTF-8 is not an error"
        );
        assert_eq!(
            quote_raw("\u{1b}[Iyy"),
            r#""\u{1b}[Iyy""#,
            "the message shows the escape byte"
        );
    }
}
