#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicI64, Ordering};

use ide_git::Repo;
use tempfile::TempDir;

/// Commits made through `TestRepo::commit_all` get strictly increasing dates, so log order
/// does not depend on how fast the test runs.
static CLOCK: AtomicI64 = AtomicI64::new(1_700_000_000);

pub struct TestRepo {
    pub dir: TempDir,
    pub repo: Repo,
}

pub fn git_in(dir: &Path, args: &[&str]) -> String {
    let t = CLOCK.fetch_add(60, Ordering::SeqCst);
    let date = format!("{t} +0000");
    let out = Command::new("git")
        .current_dir(dir)
        .args(args)
        .env("GIT_AUTHOR_DATE", &date)
        .env("GIT_COMMITTER_DATE", &date)
        .env("GIT_EDITOR", "true")
        .output()
        .expect("git runs");
    assert!(
        out.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).into_owned()
}

pub fn configure(dir: &Path) {
    git_in(dir, &["config", "user.name", "Test User"]);
    git_in(dir, &["config", "user.email", "test@example.com"]);
    git_in(dir, &["config", "commit.gpgsign", "false"]);
    // A global hooksPath would run the developer's hooks inside test repos.
    git_in(dir, &["config", "core.hooksPath", ".git/hooks"]);
}

impl TestRepo {
    pub fn new() -> TestRepo {
        let dir = tempfile::tempdir().unwrap();
        git_in(dir.path(), &["init", "-q", "-b", "main"]);
        configure(dir.path());
        let repo = Repo::discover(dir.path()).unwrap();
        TestRepo { dir, repo }
    }

    pub fn path(&self) -> &Path {
        self.dir.path()
    }

    pub fn write(&self, rel: &str, text: &str) {
        let p = self.path().join(rel);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(p, text).unwrap();
    }

    pub fn read(&self, rel: &str) -> String {
        std::fs::read_to_string(self.path().join(rel)).unwrap()
    }

    pub fn exists(&self, rel: &str) -> bool {
        self.path().join(rel).exists()
    }

    pub fn git(&self, args: &[&str]) -> String {
        git_in(self.path(), args)
    }

    pub fn commit_all(&self, msg: &str) -> String {
        self.git(&["add", "-A"]);
        self.git(&["commit", "-q", "-m", msg]);
        self.git(&["rev-parse", "HEAD"]).trim().to_string()
    }

    /// Content of `rel` in HEAD.
    pub fn head_text(&self, rel: &str) -> String {
        self.git(&["show", &format!("HEAD:{rel}")])
    }
}

pub fn p(s: &str) -> PathBuf {
    PathBuf::from(s)
}
