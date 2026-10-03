use std::collections::HashSet;

use git2::BranchType;

use crate::{CommandOutcome, Oid, Repo, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BranchInfo {
    /// Short name: `main` for a local branch, `origin/main` for a remote one.
    pub name: String,
    pub oid: Oid,
    /// Short name of the upstream, for local branches that track one.
    pub upstream: Option<String>,
    /// Commits on this branch that the upstream lacks (the push arrow).
    pub ahead: usize,
    /// Commits on the upstream that this branch lacks (the pull arrow).
    pub behind: usize,
    pub is_current: bool,
    /// Committer time of the tip, seconds since the epoch.
    pub tip_time: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Branches {
    /// None while HEAD is detached.
    pub current: Option<String>,
    /// None on an unborn branch.
    pub head: Option<Oid>,
    pub detached: bool,
    pub local: Vec<BranchInfo>,
    pub remote: Vec<BranchInfo>,
    /// Local branches checked out recently, newest first, without the current one.
    pub recent: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagInfo {
    /// Short name: `v1.0`.
    pub name: String,
    /// The commit the tag points to (peeled through an annotated tag object).
    pub oid: Oid,
    /// An annotated tag has its own object with a message; a lightweight tag is a bare ref.
    pub annotated: bool,
}

const RECENT_LIMIT: usize = 10;

impl Repo {
    pub fn branches(&self) -> Result<Branches> {
        let repo = self.open()?;
        let detached = repo.head_detached().unwrap_or(false);
        let head_ref = repo.head().ok();
        let head = head_ref.as_ref().and_then(|h| h.target());
        // An unborn branch has no ref yet, but HEAD still names it.
        let current = if detached {
            None
        } else {
            match &head_ref {
                Some(h) => h.shorthand().map(str::to_string),
                None => repo
                    .find_reference("HEAD")
                    .ok()
                    .and_then(|r| r.symbolic_target().map(str::to_string))
                    .map(|t| t.trim_start_matches("refs/heads/").to_string()),
            }
        };

        let mut local = Vec::new();
        let mut remote = Vec::new();
        for b in repo.branches(None)? {
            let (branch, kind) = b?;
            let Some(name) = branch.name()?.map(str::to_string) else { continue };
            // origin/HEAD is an alias of the default branch, not a branch of its own.
            if kind == BranchType::Remote && name.ends_with("/HEAD") {
                continue;
            }
            let Ok(tip) = branch.get().peel_to_commit() else { continue };
            let mut info = BranchInfo {
                name: name.clone(),
                oid: tip.id(),
                upstream: None,
                ahead: 0,
                behind: 0,
                is_current: kind == BranchType::Local && current.as_deref() == Some(name.as_str()),
                tip_time: tip.committer().when().seconds(),
            };
            if kind == BranchType::Local {
                if let Ok(up) = branch.upstream() {
                    if let Ok(up_tip) = up.get().peel_to_commit() {
                        let (ahead, behind) = repo.graph_ahead_behind(tip.id(), up_tip.id())?;
                        info.ahead = ahead;
                        info.behind = behind;
                    }
                    info.upstream = up.name()?.map(str::to_string);
                }
                local.push(info);
            } else {
                remote.push(info);
            }
        }
        local.sort_by(|a, b| a.name.cmp(&b.name));
        remote.sort_by(|a, b| a.name.cmp(&b.name));

        let local_names: HashSet<&str> = local.iter().map(|b| b.name.as_str()).collect();
        let mut recent = Vec::new();
        let mut seen = HashSet::new();
        if let Ok(reflog) = repo.reflog("HEAD") {
            for entry in reflog.iter() {
                let Some(msg) = entry.message() else { continue };
                let Some(rest) = msg.strip_prefix("checkout: moving from ") else { continue };
                let Some((_, to)) = rest.split_once(" to ") else { continue };
                if Some(to) == current.as_deref() || !local_names.contains(to) || !seen.insert(to.to_string()) {
                    continue;
                }
                recent.push(to.to_string());
                if recent.len() >= RECENT_LIMIT {
                    break;
                }
            }
        }

        Ok(Branches { current, head, detached, local, remote, recent })
    }

    /// Tags that point at commits, sorted by name. Checkout of a tag goes through
    /// `checkout_revision(&tag.oid)` or `checkout(name)`; both leave a detached HEAD.
    pub fn tags(&self) -> Result<Vec<TagInfo>> {
        let repo = self.open()?;
        let mut out = Vec::new();
        for r in repo.references_glob("refs/tags/*")? {
            let r = r?;
            let Some(name) = r.name().and_then(|n| n.strip_prefix("refs/tags/")) else { continue };
            // A tag of a tree or blob has no place in the log.
            let Ok(commit) = r.peel_to_commit() else { continue };
            let annotated = r.target().and_then(|t| repo.find_tag(t).ok()).is_some();
            out.push(TagInfo { name: name.to_string(), oid: commit.id(), annotated });
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    /// "New Tag…" in the log. A non-empty `message` makes an annotated tag.
    pub fn create_tag(&self, name: &str, oid: &Oid, message: Option<&str>) -> Result<()> {
        let rev = oid.to_string();
        match message.filter(|m| !m.trim().is_empty()) {
            Some(m) => self.git_ok(&["tag", "-a", "-m", m, name, &rev])?,
            None => self.git_ok(&["tag", name, &rev])?,
        };
        Ok(())
    }

    /// Deletes the local tag only; the remote keeps its copy.
    pub fn delete_tag(&self, name: &str) -> Result<()> {
        self.git_ok(&["tag", "-d", name])?;
        Ok(())
    }

    /// `user.name` and `user.email` from the effective git config (repository, global,
    /// system), so the log can mark the user's own commits. None when neither is set; a
    /// missing half is an empty string.
    pub fn user(&self) -> Result<Option<(String, String)>> {
        let repo = self.open()?;
        let config = repo.config()?;
        let name = config.get_string("user.name").ok();
        let email = config.get_string("user.email").ok();
        if name.is_none() && email.is_none() {
            return Ok(None);
        }
        Ok(Some((name.unwrap_or_default(), email.unwrap_or_default())))
    }

    /// Checks out a local branch. For a remote branch such as `origin/feature` without a
    /// local `feature`, creates the tracking branch first, like IDEA. Anything else (tag,
    /// hash) ends in a detached HEAD.
    pub fn checkout(&self, name: &str) -> Result<()> {
        let repo = self.open()?;
        if repo.find_branch(name, BranchType::Local).is_ok() {
            self.git_ok(&["checkout", name, "--"])?;
            return Ok(());
        }
        if repo.find_branch(name, BranchType::Remote).is_ok() {
            let local = name.split_once('/').map_or(name, |(_, rest)| rest);
            if repo.find_branch(local, BranchType::Local).is_ok() {
                self.git_ok(&["checkout", local, "--"])?;
            } else {
                self.git_ok(&["checkout", "-b", local, "--track", name])?;
            }
            return Ok(());
        }
        self.git_ok(&["checkout", "--detach", name, "--"])?;
        Ok(())
    }

    /// "Checkout Revision" in the log: a detached HEAD at `oid`.
    pub fn checkout_revision(&self, oid: &Oid) -> Result<()> {
        let rev = oid.to_string();
        self.git_ok(&["checkout", "--detach", &rev, "--"])?;
        Ok(())
    }

    /// `from` is any revision; None starts at HEAD. A remote start point sets up tracking.
    pub fn create_branch(&self, name: &str, from: Option<&str>, checkout: bool) -> Result<()> {
        let mut args = if checkout { vec!["checkout", "-b", name] } else { vec!["branch", name] };
        if let Some(from) = from {
            args.push(from);
        }
        self.git_ok(&args)?;
        Ok(())
    }

    /// Without `force`, git refuses to delete a branch that is not merged.
    pub fn delete_branch(&self, name: &str, force: bool) -> Result<()> {
        self.git_ok(&["branch", if force { "-D" } else { "-d" }, name])?;
        Ok(())
    }

    /// Deletes `origin/feature` on the remote itself.
    pub fn delete_remote_branch(&self, name: &str) -> Result<CommandOutcome> {
        let (remote, branch) = name
            .split_once('/')
            .ok_or_else(|| crate::Error::Other(format!("not a remote branch: {name}")))?;
        self.git(&["push", remote, "--delete", branch])
    }

    pub fn rename_branch(&self, old: &str, new: &str) -> Result<()> {
        self.git_ok(&["branch", "-m", old, new])?;
        Ok(())
    }

    /// Merges `name` into the current branch. Conflicts are a failed outcome; the app then
    /// opens the conflicts dialog from `conflicts()`.
    pub fn merge(&self, name: &str) -> Result<CommandOutcome> {
        self.git(&["merge", "--no-edit", name])
    }

    pub fn rebase(&self, onto: &str) -> Result<CommandOutcome> {
        self.git(&["rebase", onto])
    }
}
