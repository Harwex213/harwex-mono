use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;
use std::sync::{mpsc, OnceLock};
use std::time::{Duration, Instant, SystemTime};

use crate::{Error, Repo, Result};

/// Result of one git CLI invocation, so the app can show an IDEA-style notification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandOutcome {
    pub success: bool,
    /// None when the process was killed by a signal.
    pub code: Option<i32>,
    /// The command line, for the notification title and logs.
    pub command: String,
    pub stdout: String,
    pub stderr: String,
}

impl CommandOutcome {
    /// Converts a failed outcome into an error, for API calls that return `Result<()>`.
    pub fn into_result(self) -> Result<CommandOutcome> {
        if self.success {
            Ok(self)
        } else {
            Err(Error::Command(self))
        }
    }
}

/// One git CLI run, for the Console tab. Each command sends two events with the same `id`:
/// one when it starts (`finished == None`) and one when it ends.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandEvent {
    /// Unique per sink; shared by the start and finish events of one command.
    pub id: u64,
    /// Arguments after `git`.
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub started: SystemTime,
    pub finished: Option<SystemTime>,
    /// None while running, or when the process could not start or was killed by a signal.
    pub exit_code: Option<i32>,
    pub stdout: String,
    /// On a spawn failure, the OS error.
    pub stderr: String,
    /// The command only reads (blame, diff for a patch). The Console may hide these.
    pub read_only: bool,
}

impl CommandEvent {
    pub fn is_finished(&self) -> bool {
        self.finished.is_some()
    }

    pub fn success(&self) -> bool {
        self.exit_code == Some(0)
    }

    /// `git <args>` as typed in a shell (arguments with spaces are quoted).
    pub fn command_line(&self) -> String {
        let mut out = String::from("git");
        for a in &self.args {
            out.push(' ');
            if a.is_empty() || a.contains(char::is_whitespace) {
                out.push('"');
                out.push_str(a);
                out.push('"');
            } else {
                out.push_str(a);
            }
        }
        out
    }
}

/// Git subcommands that never write. They are still logged, with `read_only` set.
const READ_ONLY: &[&str] = &["status", "blame", "diff", "diff-tree", "show", "log", "rev-parse", "ls-files", "cat-file"];

/// Read-only commands: blame of a 76k-line file takes about 11 s on a healthy machine.
const READ_TIMEOUT: Duration = Duration::from_secs(30);
/// Local writes (`add` through `git-lfs filter-process` on thousands of files).
const WRITE_TIMEOUT: Duration = Duration::from_secs(600);
/// Time git gets after SIGTERM to remove `index.lock` and exit.
const KILL_GRACE: Duration = Duration::from_secs(2);

/// Arguments of one CLI run, so new options do not multiply the helper functions.
#[derive(Default)]
pub(crate) struct Run<'a> {
    pub stdin: Option<&'a [u8]>,
    pub env: &'a [(&'a str, &'a Path)],
    /// Replaces the limit `timeout_for` picks from the subcommand.
    pub timeout: Option<Duration>,
}

/// A GUI app on macOS starts with a minimal PATH, so `git` may not be found by name.
/// Prefer a user-installed git (newer, has the user's config defaults) over the Xcode shim.
fn git_binary() -> &'static Path {
    static GIT: OnceLock<PathBuf> = OnceLock::new();
    GIT.get_or_init(|| {
        if let Ok(path) = std::env::var("HARWEX_GIT") {
            return PathBuf::from(path);
        }
        if let Some(paths) = std::env::var_os("PATH") {
            for dir in std::env::split_paths(&paths) {
                let candidate = dir.join("git");
                if candidate.is_file() {
                    return candidate;
                }
            }
        }
        for candidate in ["/opt/homebrew/bin/git", "/usr/local/bin/git", "/usr/bin/git"] {
            if Path::new(candidate).is_file() {
                return PathBuf::from(candidate);
            }
        }
        PathBuf::from("git")
    })
}

impl Repo {
    /// Runs `git <args>` in the workdir and captures its output. A non-zero exit is not an
    /// error here; callers decide whether to surface it as `CommandOutcome` or `Error`.
    pub(crate) fn git(&self, args: &[&str]) -> Result<CommandOutcome> {
        self.git_with_stdin(args, None)
    }

    pub(crate) fn git_with_stdin(&self, args: &[&str], stdin: Option<&str>) -> Result<CommandOutcome> {
        self.git_env(args, stdin, &[])
    }

    /// Like `git_with_stdin`, with extra environment variables (`GIT_INDEX_FILE` for a commit
    /// built in a temporary index).
    pub(crate) fn git_env(&self, args: &[&str], stdin: Option<&str>, env: &[(&str, &Path)]) -> Result<CommandOutcome> {
        Ok(self.git_run(args, Run { stdin: stdin.map(str::as_bytes), env, timeout: None })?.0)
    }

    /// The one place that spawns git. Returns the outcome plus the raw stdout bytes, which a
    /// patch needs unchanged (file contents need not be UTF-8).
    pub(crate) fn git_run(&self, args: &[&str], run: Run<'_>) -> Result<(CommandOutcome, Vec<u8>)> {
        let event = self.sink.as_ref().map(|sink| {
            let ev = CommandEvent {
                id: sink.next_id.fetch_add(1, Ordering::Relaxed),
                args: args.iter().map(|a| a.to_string()).collect(),
                cwd: self.workdir.clone(),
                started: SystemTime::now(),
                finished: None,
                exit_code: None,
                stdout: String::new(),
                stderr: String::new(),
                read_only: args.first().is_some_and(|a| READ_ONLY.contains(a)),
            };
            // A closed receiver only means nobody shows the console.
            let _ = sink.tx.send(ev.clone());
            ev
        });
        let result = self.spawn_git(args, &run);
        if let (Some(sink), Some(mut ev)) = (self.sink.as_ref(), event) {
            ev.finished = Some(SystemTime::now());
            match &result {
                Ok((o, _)) => {
                    ev.exit_code = o.code;
                    ev.stdout = o.stdout.clone();
                    ev.stderr = o.stderr.clone();
                }
                Err(e) => ev.stderr = e.to_string(),
            }
            let _ = sink.tx.send(ev);
        }
        result
    }

    fn spawn_git(&self, args: &[&str], run: &Run<'_>) -> Result<(CommandOutcome, Vec<u8>)> {
        let command = format!("git {}", args.join(" "));
        let cancel = crate::cancel::current();
        if crate::cancel::is_set(&cancel) {
            return Err(Error::Cancelled { command });
        }
        let mut cmd = Command::new(self.git.as_deref().unwrap_or_else(|| git_binary()));
        cmd.envs(run.env.iter().map(|(k, v)| (*k, *v)));
        cmd.current_dir(&self.workdir)
            .args(args)
            // No terminal to prompt on: a missing credential must fail instead of hanging.
            .env("GIT_TERMINAL_PROMPT", "0")
            // Merge/rebase/revert would otherwise open an editor for the message and block.
            .env("GIT_EDITOR", "true")
            .env("GIT_SEQUENCE_EDITOR", "true")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(if run.stdin.is_some() { Stdio::piped() } else { Stdio::null() });
        // Its own process group: a cancel then reaches git's children (hooks, sh, git-lfs).
        #[cfg(unix)]
        std::os::unix::process::CommandExt::process_group(&mut cmd, 0);
        let mut child = cmd.spawn()?;
        let pid = child.id();
        if let Some(input) = run.stdin {
            // Written from a thread: a large input could otherwise deadlock against a full
            // stdout pipe. Dropping the handle closes the pipe so git sees EOF.
            let mut pipe = child.stdin.take().expect("stdin is piped");
            let input = input.to_vec();
            std::thread::spawn(move || {
                let _ = pipe.write_all(&input);
            });
        }
        // The waiter owns the child and reads both pipes; this thread watches the clock and
        // the cancel flag, so a hung git never blocks the caller for good.
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new().name("git-wait".into()).spawn(move || {
            let _ = tx.send(child.wait_with_output());
        })?;
        let limit = self.timeout.or(run.timeout).or_else(|| timeout_for(args));
        let started = Instant::now();
        let stop = loop {
            let tick = Duration::from_millis(20);
            match rx.recv_timeout(tick) {
                Ok(out) => {
                    let out = out?;
                    let outcome = CommandOutcome {
                        success: out.status.success(),
                        code: out.status.code(),
                        command,
                        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
                        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
                    };
                    return Ok((outcome, out.stdout));
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => return Err(Error::Other(format!("`{command}`: the waiter thread died"))),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            if crate::cancel::is_set(&cancel) {
                break Error::Cancelled { command };
            }
            if let Some(after) = limit.filter(|l| started.elapsed() >= *l) {
                break Error::Timeout { command, after };
            }
        };
        // git removes its own `index.lock` on SIGTERM. A lock left after the SIGKILL is not
        // removed here: the git that needed the SIGKILL was usually stuck before it took the
        // lock, and the lock may then belong to another git process.
        terminate(pid, &rx);
        Err(stop)
    }

    /// Runs a command whose failure is an error for the caller (`Result<()>` APIs).
    pub(crate) fn git_ok(&self, args: &[&str]) -> Result<CommandOutcome> {
        self.git(args)?.into_result()
    }

    /// Runs `git <args> -- <paths>` in chunks, so a commit of thousands of files does not hit
    /// the OS argument length limit.
    pub(crate) fn git_paths(&self, args: &[&str], paths: &[PathBuf]) -> Result<()> {
        self.git_paths_env(args, paths, &[])
    }

    pub(crate) fn git_paths_env(&self, args: &[&str], paths: &[PathBuf], env: &[(&str, &Path)]) -> Result<()> {
        // File names with glob characters must match literally. Per-path magic instead of
        // GIT_LITERAL_PATHSPECS, because that variable breaks `git stash -u`'s cleanup.
        let rel: Vec<String> = paths.iter().map(|p| literal_pathspec(&self.rel(p))).collect();
        for chunk in rel.chunks(500) {
            let mut all: Vec<&str> = args.to_vec();
            all.push("--");
            all.extend(chunk.iter().map(String::as_str));
            self.git_env(&all, None, env)?.into_result()?;
        }
        Ok(())
    }
}

/// How long a command may run before it is killed. Reads are fast (blame of a 76k-line file
/// takes about 11 s). Network commands and commands that run hooks or LFS downloads have no
/// limit: only the user knows whether a slow push is stuck, and Cancel is always there.
fn timeout_for(args: &[&str]) -> Option<Duration> {
    let sub = args.first().copied().unwrap_or_default();
    if READ_ONLY.contains(&sub) || matches!(sub, "for-each-ref" | "merge-base" | "rev-list" | "ls-tree") {
        return Some(READ_TIMEOUT);
    }
    match sub {
        "push" | "pull" | "fetch" | "clone" | "ls-remote" | "commit" | "merge" | "rebase" | "cherry-pick" | "revert" | "am" | "checkout" | "switch" => None,
        _ => Some(WRITE_TIMEOUT),
    }
}

/// Stops a git run: SIGTERM to its group, a grace period, then SIGKILL to whatever is left.
fn terminate(pid: u32, rx: &mpsc::Receiver<std::io::Result<std::process::Output>>) {
    #[cfg(unix)]
    {
        crate::cancel::signal_group(pid, crate::cancel::SIGTERM);
        let graceful = rx.recv_timeout(KILL_GRACE).is_ok();
        // The group may still hold children after git itself exited (a sleeping hook).
        crate::cancel::signal_group(pid, crate::cancel::SIGKILL);
        if !graceful {
            // The pipes close once the group is dead; a detached grandchild could still hold
            // them, so the wait is bounded.
            let _ = rx.recv_timeout(KILL_GRACE);
        }
    }
    #[cfg(not(unix))]
    let _ = (pid, rx);
}

pub(crate) fn literal_pathspec(rel: &Path) -> String {
    format!(":(literal){}", crate::git_path(rel))
}
