//! Runs the real `xtask install` in a pseudo-terminal and answers its `[y/N]` questions.
//!
//! The machine is fake: HOME and CARGO_HOME point at a temp dir, `~/.cargo/bin` holds shell
//! scripts for `rustup`, `rustc` and the `rust-analyzer` proxy, and `$CARGO` is a script that
//! fails, so the install stops right after the tool check. The fake `rustup` logs every
//! `component add` to a file and changes nothing.

#![cfg(unix)]

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::raw::{c_char, c_int};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::os::unix::io::FromRawFd;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

extern "C" {
    fn posix_openpt(flags: c_int) -> c_int;
    fn grantpt(fd: c_int) -> c_int;
    fn unlockpt(fd: c_int) -> c_int;
    fn ptsname(fd: c_int) -> *mut c_char;
    fn setsid() -> c_int;
}

const O_RDWR: c_int = 2;
#[cfg(any(target_os = "linux", target_os = "android"))]
const O_NOCTTY: c_int = 0o400;
#[cfg(not(any(target_os = "linux", target_os = "android")))]
const O_NOCTTY: c_int = 0x20000;

const PROMPT: &str = "[y/N] ";
const PROXY_ERROR: &str =
    "error: Unknown binary 'rust-analyzer' in official toolchain 'stable-aarch64-apple-darwin'.";

/// Opens a pty pair: (master, slave).
fn open_pty() -> (File, File) {
    // SAFETY: plain libc calls on a fd this function owns; ptsname's buffer is copied at once.
    unsafe {
        let master = posix_openpt(O_RDWR | O_NOCTTY);
        assert!(master >= 0, "posix_openpt failed");
        assert_eq!(grantpt(master), 0, "grantpt failed");
        assert_eq!(unlockpt(master), 0, "unlockpt failed");
        let name = ptsname(master);
        assert!(!name.is_null(), "ptsname failed");
        let name = std::ffi::CStr::from_ptr(name).to_str().unwrap().to_string();
        let slave = OpenOptions::new()
            .read(true)
            .write(true)
            .custom_flags(O_NOCTTY)
            .open(&name)
            .unwrap();
        (File::from_raw_fd(master), slave)
    }
}

fn script(path: &Path, body: &str) {
    fs::write(path, format!("#!/bin/sh\n{body}\n")).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
}

/// A temp machine with rustup but without rust-analyzer and rust-src.
struct Machine {
    root: PathBuf,
    log: PathBuf,
}

impl Machine {
    fn new(name: &str) -> Machine {
        let root = std::env::temp_dir().join(format!("xtask-pty-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let bin = root.join("cargo/bin");
        let sysroot = root.join("sysroot");
        fs::create_dir_all(&bin).unwrap();
        fs::create_dir_all(root.join("home")).unwrap();
        fs::create_dir_all(&sysroot).unwrap();
        let log = root.join("rustup.log");
        script(
            &bin.join("rustup"),
            &format!(
                "if [ \"$1\" = which ]; then echo \"{PROXY_ERROR}\" >&2; exit 1; fi\n\
                 echo \"$*\" >> '{}'",
                log.display()
            ),
        );
        script(
            &bin.join("rust-analyzer"),
            &format!("echo \"{PROXY_ERROR}\" >&2; exit 1"),
        );
        script(&bin.join("rustc"), &format!("echo '{}'", sysroot.display()));
        script(&root.join("cargo-fails"), "exit 1");
        Machine { root, log }
    }

    fn log(&self) -> String {
        fs::read_to_string(&self.log).unwrap_or_default()
    }

    /// Writes `stale` into the terminal before the task starts, then sends one answer per
    /// question. Returns everything the terminal showed.
    fn install(&self, stale: &[u8], answers: &[&[u8]]) -> String {
        let (mut master, slave) = open_pty();
        // Bytes typed (or sent by the terminal) before the question sit in the input queue.
        master.write_all(stale).unwrap();

        let mut command = Command::new(env!("CARGO_BIN_EXE_xtask"));
        command
            .args(["install", "--no-app", "--no-path"])
            .env_clear()
            .env("HOME", self.root.join("home"))
            .env("CARGO_HOME", self.root.join("cargo"))
            .env("CARGO", self.root.join("cargo-fails"))
            .env(
                "PATH",
                format!("{}:/usr/bin:/bin", self.root.join("cargo/bin").display()),
            )
            .env("TERM", "xterm-256color")
            .stdin(Stdio::from(slave.try_clone().unwrap()))
            .stdout(Stdio::from(slave.try_clone().unwrap()))
            .stderr(Stdio::from(slave));
        // SAFETY: setsid is async-signal-safe. It detaches the child from the test's terminal.
        unsafe {
            command.pre_exec(|| {
                setsid();
                Ok(())
            });
        }
        let mut child = command.spawn().unwrap();
        drop(command);

        let shown = Arc::new(Mutex::new(Vec::new()));
        let reader = {
            let shown = Arc::clone(&shown);
            let mut master = master.try_clone().unwrap();
            std::thread::spawn(move || {
                let mut buf = [0u8; 4096];
                while let Ok(n) = master.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    shown.lock().unwrap().extend_from_slice(&buf[..n]);
                }
            })
        };
        let text = || String::from_utf8_lossy(&shown.lock().unwrap()).into_owned();

        let deadline = Instant::now() + Duration::from_secs(30);
        for (i, answer) in answers.iter().enumerate() {
            while text().matches(PROMPT).count() <= i {
                assert!(
                    Instant::now() < deadline,
                    "question {} never came:\n{}",
                    i + 1,
                    text()
                );
                if child.try_wait().unwrap().is_some() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            master.write_all(answer).unwrap();
        }
        loop {
            if child.try_wait().unwrap().is_some() {
                break;
            }
            assert!(Instant::now() < deadline, "xtask hangs:\n{}", text());
            std::thread::sleep(Duration::from_millis(20));
        }
        drop(master);
        // The reader ends when the last slave fd closes (EOF or EIO on the master).
        let _ = reader.join();
        text()
    }
}

impl Drop for Machine {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn y_twice_installs_both_components_despite_stale_input() {
    let machine = Machine::new("stale");
    // Focus reports and keys typed during the build, all before the first question.
    let shown = machine.install(b"\x1b[O\x1b[Iabc", &[b"y\r", b"y\r"]);
    assert_eq!(
        machine.log(),
        "component add rust-analyzer\ncomponent add rust-src\n",
        "terminal:\n{shown}"
    );
    assert!(shown.contains("installed rust-analyzer"), "{shown}");
    assert!(shown.contains("installed rust-src"), "{shown}");
}

#[test]
fn focus_report_inside_the_answer_still_means_yes() {
    let machine = Machine::new("focus");
    let shown = machine.install(b"", &[b"\x1b[Iy\r", b"\x1b[O\x1b[Iy\r"]);
    assert_eq!(
        machine.log(),
        "component add rust-analyzer\ncomponent add rust-src\n",
        "terminal:\n{shown}"
    );
}

#[test]
fn unclear_answer_is_asked_again_and_shown() {
    let machine = Machine::new("unclear");
    let shown = machine.install(b"", &[b"yy\r", b"y\r", b"n\r"]);
    assert!(
        shown.contains(r#"answer "yy" not understood: type y or n"#),
        "{shown}"
    );
    assert_eq!(
        machine.log(),
        "component add rust-analyzer\n",
        "terminal:\n{shown}"
    );
    assert!(
        shown.contains("skip rust-src: run `rustup component add rust-src` later"),
        "{shown}"
    );
}
