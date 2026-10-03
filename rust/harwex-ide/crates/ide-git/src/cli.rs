use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

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
        let mut cmd = Command::new(git_binary());
        cmd.envs(env.iter().map(|(k, v)| (*k, *v)));
        cmd.current_dir(&self.workdir)
            .args(args)
            // No terminal to prompt on: a missing credential must fail instead of hanging.
            .env("GIT_TERMINAL_PROMPT", "0")
            // Merge/rebase/revert would otherwise open an editor for the message and block.
            .env("GIT_EDITOR", "true")
            .env("GIT_SEQUENCE_EDITOR", "true")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() });
        let mut child = cmd.spawn()?;
        if let Some(input) = stdin {
            // Dropping the handle closes the pipe so git sees EOF.
            let mut pipe = child.stdin.take().expect("stdin is piped");
            pipe.write_all(input.as_bytes())?;
        }
        let out = child.wait_with_output()?;
        Ok(CommandOutcome {
            success: out.status.success(),
            code: out.status.code(),
            command: format!("git {}", args.join(" ")),
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        })
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

pub(crate) fn literal_pathspec(rel: &Path) -> String {
    format!(":(literal){}", crate::git_path(rel))
}
