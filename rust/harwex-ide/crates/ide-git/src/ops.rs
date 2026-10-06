use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use git2::RepositoryState;

use crate::log::commit_info;
use crate::{bytes_to_text, is_binary, CommandOutcome, CommitInfo, Error, Oid, Repo, Result};

/// Upper bound for `outgoing` when nothing on any remote limits the walk (a repository
/// without remotes would otherwise list its entire history).
const OUTGOING_LIMIT: usize = 1000;

/// The remote branch a local branch pushes to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PushTarget {
    pub remote: String,
    /// Branch name on the remote.
    pub branch: String,
    /// The branch has a configured upstream. Otherwise the push goes to the default remote
    /// under the same name and creates the branch there.
    pub tracked: bool,
}

/// What `update_branch` did to a local branch that is not checked out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BranchUpdate {
    /// The upstream has nothing the branch lacks (equal, or the branch is only ahead).
    UpToDate,
    /// The branch ref moved forward to the upstream tip.
    FastForwarded { from: Oid, to: Oid, commits: usize },
    /// The branch and its upstream diverged. Nothing changed; a merge or rebase needs a checkout.
    NotFastForward { upstream: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StashEntry {
    /// Position in `stash@{n}`.
    pub index: usize,
    pub message: String,
    pub oid: Oid,
    pub time: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConflictSides {
    pub path: PathBuf,
    /// None when the file does not exist on that side (added on one side, deleted on the other).
    pub base: Option<String>,
    pub ours: Option<String>,
    pub theirs: Option<String>,
    /// Binary conflicts can only be resolved with Accept Yours / Accept Theirs.
    pub binary: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictChoice {
    /// "Accept Yours".
    Ours,
    /// "Accept Theirs".
    Theirs,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResetMode {
    Soft,
    Mixed,
    Hard,
}

/// An operation that is waiting for the user, e.g. a merge stopped on conflicts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RepoState {
    Clean,
    Merge,
    Rebase,
    CherryPick,
    Revert,
    Bisect,
    Other,
}

impl Repo {
    // ---- Remote -------------------------------------------------------------------------

    pub fn fetch(&self) -> Result<CommandOutcome> {
        self.git(&["fetch", "--all", "--prune"])
    }

    /// Fetches one remote (the branch tree's menu on a remote).
    pub fn fetch_remote(&self, remote: &str) -> Result<CommandOutcome> {
        self.git(&["fetch", "--prune", remote])
    }

    /// IDEA's "Update" on a branch that is not checked out: fetches the branch's upstream and
    /// fast-forwards the local ref, without a checkout. `git fetch <remote> <src>:<dst>` does
    /// both in one command: it refuses a non-fast-forward and a branch checked out in any
    /// worktree, and it also moves the remote-tracking ref. A refused fast-forward is told
    /// apart from other failures by the commit graph, never by git's (translated) message.
    pub fn update_branch(&self, name: &str) -> Result<BranchUpdate> {
        let repo = self.open()?;
        if self.current_branch(&repo).ok().as_deref() == Some(name) {
            return Err(Error::Other(format!("{name} is checked out; use Update Project")));
        }
        let from = self.local_tip(&repo, name)?;
        let config = repo.config()?;
        let (Ok(remote), Ok(merge)) = (config.get_string(&format!("branch.{name}.remote")), config.get_string(&format!("branch.{name}.merge"))) else {
            return Err(Error::Other(format!("{name} has no upstream branch")));
        };
        let short = merge.trim_start_matches("refs/heads/").to_string();
        let upstream = if remote == "." { short } else { format!("{remote}/{short}") };
        let refspec = format!("{merge}:refs/heads/{name}");
        let out = self.git(&["fetch", "--no-write-fetch-head", &remote, &refspec])?;
        let repo = self.open()?;
        let to = self.local_tip(&repo, name)?;
        if out.success {
            if to == from {
                return Ok(BranchUpdate::UpToDate);
            }
            let (commits, _) = repo.graph_ahead_behind(to, from)?;
            return Ok(BranchUpdate::FastForwarded { from, to, commits });
        }
        // git refuses every update that is not a fast-forward, also a rewind of a branch that
        // is only ahead. The fetch still moved the remote-tracking ref, so the graph tells why.
        let tracking = if remote == "." { merge.clone() } else { format!("refs/remotes/{upstream}") };
        if let Ok(theirs) = repo.refname_to_id(&tracking) {
            if theirs == from || repo.graph_descendant_of(from, theirs)? {
                return Ok(BranchUpdate::UpToDate);
            }
            if !repo.graph_descendant_of(theirs, from)? {
                return Ok(BranchUpdate::NotFastForward { upstream });
            }
        }
        Err(Error::Command(out))
    }

    /// IDEA "Update Project". `--autostash` keeps local changes out of the way like IDEA's
    /// "stash/unstash" update option; without it a rebase refuses to start on a dirty tree.
    pub fn pull(&self, rebase: bool) -> Result<CommandOutcome> {
        self.git(&["pull", "--autostash", if rebase { "--rebase" } else { "--no-rebase" }])
    }

    /// (remote, branch on the remote) the local branch `branch` pushes to, if configured.
    fn upstream_of(&self, repo: &git2::Repository, branch: &str) -> Option<(String, String)> {
        let config = repo.config().ok()?;
        let remote = config.get_string(&format!("branch.{branch}.remote")).ok()?;
        let merge = config.get_string(&format!("branch.{branch}.merge")).ok()?;
        // A branch that tracks another local branch (`remote = .`) has no remote upstream;
        // pushing to "." would move that local branch instead.
        if remote == "." {
            return None;
        }
        Some((remote, merge.trim_start_matches("refs/heads/").to_string()))
    }

    fn default_remote(&self, repo: &git2::Repository) -> Result<String> {
        let remotes = repo.remotes()?;
        let names: Vec<&str> = remotes.iter().flatten().collect();
        if names.contains(&"origin") {
            return Ok("origin".into());
        }
        names
            .first()
            .map(|s| s.to_string())
            .ok_or_else(|| Error::Other("no remote configured".into()))
    }

    fn current_branch(&self, repo: &git2::Repository) -> Result<String> {
        if repo.head_detached()? {
            return Err(Error::Other("HEAD is detached; check out a branch first".into()));
        }
        let head = repo.head()?;
        head.shorthand()
            .map(str::to_string)
            .ok_or_else(|| Error::Other("current branch name is not valid UTF-8".into()))
    }

    /// Commits the push dialog shows for the current branch (HEAD while detached).
    pub fn outgoing(&self) -> Result<Vec<CommitInfo>> {
        let repo = self.open()?;
        let Some(tip) = repo.head().ok().and_then(|h| h.target()) else {
            return Ok(Vec::new());
        };
        let branch = self.current_branch(&repo).ok();
        self.outgoing_from(&repo, tip, branch.as_deref())
    }

    /// Commits the push dialog shows for the local branch `name`: on the branch but not on
    /// its upstream. A branch without an upstream lists what no remote branch contains yet.
    pub fn outgoing_of(&self, name: &str) -> Result<Vec<CommitInfo>> {
        let repo = self.open()?;
        let tip = self.local_tip(&repo, name)?;
        self.outgoing_from(&repo, tip, Some(name))
    }

    fn local_tip(&self, repo: &git2::Repository, name: &str) -> Result<git2::Oid> {
        let branch = repo.find_branch(name, git2::BranchType::Local)?;
        branch.get().target().ok_or_else(|| Error::Other(format!("branch {name} has no commit")))
    }

    fn outgoing_from(&self, repo: &git2::Repository, tip: git2::Oid, branch: Option<&str>) -> Result<Vec<CommitInfo>> {
        let mut walk = repo.revwalk()?;
        walk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)?;
        walk.push(tip)?;
        let upstream = branch.and_then(|b| {
            let (remote, name) = self.upstream_of(repo, b)?;
            repo.refname_to_id(&format!("refs/remotes/{remote}/{name}")).ok()
        });
        match upstream {
            Some(oid) => walk.hide(oid)?,
            None => walk.hide_glob("refs/remotes")?,
        }
        let mut out = Vec::new();
        for oid in walk.take(OUTGOING_LIMIT) {
            out.push(commit_info(&repo.find_commit(oid?)?, None));
        }
        Ok(out)
    }

    /// Where `push_branch(name)` sends the local branch `name`.
    pub fn push_target(&self, name: &str) -> Result<PushTarget> {
        let repo = self.open()?;
        self.local_tip(&repo, name)?;
        Ok(match self.upstream_of(&repo, name) {
            Some((remote, branch)) => PushTarget { remote, branch, tracked: true },
            None => PushTarget { remote: self.default_remote(&repo)?, branch: name.to_string(), tracked: false },
        })
    }

    /// Pushes the current branch. See `push_branch`.
    pub fn push(&self, force_with_lease: bool, set_upstream: bool) -> Result<CommandOutcome> {
        let repo = self.open()?;
        let branch = self.current_branch(&repo)?;
        self.push_branch(&branch, force_with_lease, set_upstream)
    }

    /// Pushes the local branch `name` to its upstream, or to the default remote under the
    /// same name when it has none. Never checks out. An explicit refspec avoids
    /// `push.default` surprises when the upstream has a different name or the branch is not
    /// the current one.
    pub fn push_branch(&self, name: &str, force_with_lease: bool, set_upstream: bool) -> Result<CommandOutcome> {
        let PushTarget { remote, branch: target, .. } = self.push_target(name)?;
        let refspec = format!("refs/heads/{name}:refs/heads/{target}");
        let mut args = vec!["push"];
        if force_with_lease {
            args.push("--force-with-lease");
        }
        if set_upstream {
            args.push("--set-upstream");
        }
        args.push(&remote);
        args.push(&refspec);
        self.git(&args)
    }

    // ---- Stash --------------------------------------------------------------------------

    pub fn stash_list(&self) -> Result<Vec<StashEntry>> {
        let mut repo = self.open()?;
        let mut raw = Vec::new();
        repo.stash_foreach(|index, message, oid| {
            raw.push((index, message.to_string(), *oid));
            true
        })?;
        let mut out = Vec::with_capacity(raw.len());
        for (index, message, oid) in raw {
            let time = repo.find_commit(oid).map(|c| c.committer().when().seconds()).unwrap_or(0);
            out.push(StashEntry { index, message, oid, time });
        }
        Ok(out)
    }

    pub fn stash_save(&self, message: &str, include_untracked: bool) -> Result<()> {
        let mut args = vec!["stash", "push"];
        if include_untracked {
            args.push("--include-untracked");
        }
        if !message.trim().is_empty() {
            args.push("-m");
            args.push(message);
        }
        self.git_ok(&args)?;
        Ok(())
    }

    /// Conflicts while applying are a failed outcome; a conflicted `pop` keeps the stash.
    pub fn stash_apply(&self, index: usize, pop: bool) -> Result<CommandOutcome> {
        self.stash_apply_with(index, pop, false)
    }

    /// IDEA's "Reinstate index" option restores what was staged as staged.
    pub fn stash_apply_with(&self, index: usize, pop: bool, reinstate_index: bool) -> Result<CommandOutcome> {
        let name = format!("stash@{{{index}}}");
        let mut args = vec!["stash", if pop { "pop" } else { "apply" }];
        if reinstate_index {
            args.push("--index");
        }
        args.push(&name);
        self.git(&args)
    }

    pub fn stash_drop(&self, index: usize) -> Result<()> {
        let name = format!("stash@{{{index}}}");
        self.git_ok(&["stash", "drop", &name])?;
        Ok(())
    }

    // ---- Conflicts ----------------------------------------------------------------------

    pub fn conflicts(&self) -> Result<Vec<PathBuf>> {
        let repo = self.open()?;
        let index = repo.index()?;
        let mut paths = BTreeSet::new();
        for c in index.conflicts()? {
            let c = c?;
            let entry = c.our.or(c.their).or(c.ancestor);
            if let Some(e) = entry {
                paths.insert(PathBuf::from(String::from_utf8_lossy(&e.path).into_owned()));
            }
        }
        Ok(paths.into_iter().collect())
    }

    /// Base, ours and theirs texts from the index stages 1, 2 and 3.
    pub fn conflict_sides(&self, path: &Path) -> Result<ConflictSides> {
        let repo = self.open()?;
        let rel = self.rel(path);
        let index = repo.index()?;
        let mut sides: [Option<Vec<u8>>; 3] = [None, None, None];
        let mut found = false;
        for (slot, stage) in [1, 2, 3].into_iter().enumerate() {
            if let Some(e) = index.get_path(&rel, stage) {
                found = true;
                sides[slot] = Some(repo.find_blob(e.id)?.content().to_vec());
            }
        }
        if !found {
            return Err(Error::Other(format!("{} is not in conflict", rel.display())));
        }
        let binary = sides.iter().flatten().any(|b| is_binary(b));
        let [base, ours, theirs] = sides.map(|s| if binary { None } else { s.map(|b| bytes_to_text(&b)) });
        Ok(ConflictSides { path: rel, base, ours, theirs, binary })
    }

    /// Writes the merged text and stages it, which marks the conflict resolved.
    pub fn resolve(&self, path: &Path, text: &str) -> Result<()> {
        let rel = self.rel(path);
        std::fs::write(self.abs(&rel), text)?;
        self.git_paths(&["add"], &[rel])
    }

    /// Accept Yours / Accept Theirs. If the chosen side deleted the file, the resolution is
    /// the deletion.
    pub fn resolve_with(&self, path: &Path, choice: ConflictChoice) -> Result<()> {
        let repo = self.open()?;
        let rel = self.rel(path);
        let stage = match choice {
            ConflictChoice::Ours => 2,
            ConflictChoice::Theirs => 3,
        };
        let exists = repo.index()?.get_path(&rel, stage).is_some();
        drop(repo);
        if exists {
            let flag = match choice {
                ConflictChoice::Ours => "--ours",
                ConflictChoice::Theirs => "--theirs",
            };
            self.git_paths(&["checkout", flag], std::slice::from_ref(&rel))?;
            self.git_paths(&["add"], &[rel])
        } else {
            self.git_paths(&["rm", "-q", "--ignore-unmatch"], &[rel])
        }
    }

    // ---- Log context menu ---------------------------------------------------------------

    /// "Reset Current Branch to Here…".
    pub fn reset(&self, oid: &Oid, mode: ResetMode) -> Result<CommandOutcome> {
        let flag = match mode {
            ResetMode::Soft => "--soft",
            ResetMode::Mixed => "--mixed",
            ResetMode::Hard => "--hard",
        };
        let rev = oid.to_string();
        self.git(&["reset", "-q", flag, &rev])
    }

    /// Reverting a merge undoes what it brought in relative to its first parent.
    pub fn revert(&self, oid: &Oid) -> Result<CommandOutcome> {
        let rev = oid.to_string();
        let mut args = vec!["revert", "--no-edit"];
        if self.is_merge(oid)? {
            args.extend(["-m", "1"]);
        }
        args.push(&rev);
        self.git(&args)
    }

    pub fn cherry_pick(&self, oid: &Oid) -> Result<CommandOutcome> {
        let rev = oid.to_string();
        let mut args = vec!["cherry-pick"];
        if self.is_merge(oid)? {
            args.extend(["-m", "1"]);
        }
        args.push(&rev);
        self.git(&args)
    }

    fn is_merge(&self, oid: &Oid) -> Result<bool> {
        Ok(self.open()?.find_commit(*oid)?.parent_count() > 1)
    }

    // ---- Operation in progress ----------------------------------------------------------

    pub fn state(&self) -> Result<RepoState> {
        let repo = self.open()?;
        Ok(match repo.state() {
            RepositoryState::Clean => RepoState::Clean,
            RepositoryState::Merge => RepoState::Merge,
            RepositoryState::Rebase | RepositoryState::RebaseInteractive | RepositoryState::RebaseMerge => {
                RepoState::Rebase
            }
            RepositoryState::CherryPick | RepositoryState::CherryPickSequence => RepoState::CherryPick,
            RepositoryState::Revert | RepositoryState::RevertSequence => RepoState::Revert,
            RepositoryState::Bisect => RepoState::Bisect,
            _ => RepoState::Other,
        })
    }

    /// Aborts whatever merge, rebase, cherry-pick or revert is in progress.
    pub fn abort_operation(&self) -> Result<CommandOutcome> {
        let args: &[&str] = match self.state()? {
            RepoState::Merge => &["merge", "--abort"],
            RepoState::Rebase => &["rebase", "--abort"],
            RepoState::CherryPick => &["cherry-pick", "--abort"],
            RepoState::Revert => &["revert", "--abort"],
            other => return Err(Error::Other(format!("nothing to abort ({other:?})"))),
        };
        self.git(args)
    }

    /// Continues after all conflicts are resolved and staged.
    pub fn continue_operation(&self) -> Result<CommandOutcome> {
        let args: &[&str] = match self.state()? {
            RepoState::Merge => &["commit", "--no-edit"],
            RepoState::Rebase => &["rebase", "--continue"],
            RepoState::CherryPick => &["cherry-pick", "--continue"],
            RepoState::Revert => &["revert", "--continue"],
            other => return Err(Error::Other(format!("nothing to continue ({other:?})"))),
        };
        self.git(args)
    }
}
