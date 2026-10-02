use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use git2::{RepositoryState, Status, StatusOptions};

use crate::{git_path, CommandOutcome, Error, Oid, Repo, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    /// File became a symlink or the other way round.
    TypeChange,
    Untracked,
    Conflicted,
}

/// One changed file. Paths are relative to the workdir.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileChange {
    pub path: PathBuf,
    /// The HEAD path of a staged rename.
    pub old_path: Option<PathBuf>,
    /// HEAD vs index.
    pub staged: Option<ChangeKind>,
    /// Index vs worktree.
    pub unstaged: Option<ChangeKind>,
}

impl FileChange {
    /// The combined HEAD vs worktree change, which is what IDEA's Changes view shows.
    pub fn kind(&self) -> ChangeKind {
        use ChangeKind::*;
        match (self.staged, self.unstaged) {
            (Some(Conflicted), _) | (_, Some(Conflicted)) => Conflicted,
            (None, Some(Untracked)) => Untracked,
            // Added in the index and removed again from disk: nothing left to commit but the
            // file still shows, so call it deleted.
            (_, Some(Deleted)) => Deleted,
            (Some(Added), _) => Added,
            (Some(Renamed), _) => Renamed,
            (Some(Deleted), _) => Deleted,
            (Some(TypeChange), _) | (_, Some(TypeChange)) => TypeChange,
            _ => Modified,
        }
    }

    pub fn is_untracked(&self) -> bool {
        self.kind() == ChangeKind::Untracked
    }
}

/// Result of `Repo::commit`. A rejected commit (hook failure, nothing to commit) is not an
/// `Err`: the app shows `output.stderr` in a notification.
#[derive(Debug, Clone)]
pub struct CommitOutcome {
    /// The new HEAD when the commit succeeded.
    pub oid: Option<Oid>,
    pub output: CommandOutcome,
}

impl CommitOutcome {
    pub fn success(&self) -> bool {
        self.output.success
    }
}

fn staged_kind(s: Status) -> Option<ChangeKind> {
    if s.is_index_new() {
        Some(ChangeKind::Added)
    } else if s.is_index_renamed() {
        Some(ChangeKind::Renamed)
    } else if s.is_index_deleted() {
        Some(ChangeKind::Deleted)
    } else if s.is_index_typechange() {
        Some(ChangeKind::TypeChange)
    } else if s.is_index_modified() {
        Some(ChangeKind::Modified)
    } else {
        None
    }
}

fn unstaged_kind(s: Status) -> Option<ChangeKind> {
    if s.is_wt_new() {
        Some(ChangeKind::Untracked)
    } else if s.is_wt_deleted() {
        Some(ChangeKind::Deleted)
    } else if s.is_wt_typechange() {
        Some(ChangeKind::TypeChange)
    } else if s.is_wt_modified() || s.is_wt_renamed() {
        Some(ChangeKind::Modified)
    } else {
        None
    }
}

impl Repo {
    /// Staged, unstaged and untracked files in one list. Staged renames are detected.
    pub fn status(&self) -> Result<Vec<FileChange>> {
        let repo = self.open()?;
        self.status_in(&repo, None)
    }

    /// Status of the given paths only, which skips walking the rest of the tree.
    pub fn status_of(&self, paths: &[PathBuf]) -> Result<Vec<FileChange>> {
        let repo = self.open()?;
        self.status_in(&repo, Some(paths))
    }

    pub(crate) fn status_in(&self, repo: &git2::Repository, paths: Option<&[PathBuf]>) -> Result<Vec<FileChange>> {
        let mut opts = StatusOptions::new();
        opts.include_untracked(true)
            // IDEA lists every unversioned file, not just the top directory.
            .recurse_untracked_dirs(true)
            .include_ignored(false)
            .exclude_submodules(true)
            // Staged renames are cheap (index vs tree, no file reads). Worktree renames would
            // hash every untracked file, so they stay as deleted + unversioned like in IDEA.
            .renames_head_to_index(true)
            .renames_index_to_workdir(false);
        if let Some(paths) = paths {
            opts.disable_pathspec_match(true);
            for p in paths {
                opts.pathspec(git_path(&self.rel(p)));
            }
        }
        let statuses = repo.statuses(Some(&mut opts))?;
        let mut out = Vec::with_capacity(statuses.len());
        for entry in statuses.iter() {
            let s = entry.status();
            if s.is_ignored() || s == Status::CURRENT {
                continue;
            }
            let (staged, unstaged) = if s.is_conflicted() {
                (Some(ChangeKind::Conflicted), Some(ChangeKind::Conflicted))
            } else {
                (staged_kind(s), unstaged_kind(s))
            };
            let mut old_path = None;
            let mut path = entry.path_bytes().to_vec();
            if let Some(delta) = entry.head_to_index() {
                if s.is_index_renamed() {
                    if let (Some(o), Some(n)) = (delta.old_file().path(), delta.new_file().path()) {
                        old_path = Some(o.to_path_buf());
                        path = n.as_os_str().as_encoded_bytes().to_vec();
                    }
                }
            }
            out.push(FileChange {
                path: PathBuf::from(String::from_utf8_lossy(&path).into_owned()),
                old_path,
                staged,
                unstaged,
            });
        }
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    }

    /// `git add` so clean filters (git-lfs) and `.gitattributes` apply. Deleted paths are
    /// staged as removals.
    pub fn stage(&self, paths: &[PathBuf]) -> Result<()> {
        if paths.is_empty() {
            return Ok(());
        }
        self.git_paths(&["add", "-A"], paths)
    }

    /// Resets the index entries of `paths` to HEAD. Only the index changes, so libgit2 is
    /// safe here and avoids a process spawn.
    pub fn unstage(&self, paths: &[PathBuf]) -> Result<()> {
        if paths.is_empty() {
            return Ok(());
        }
        let repo = self.open()?;
        let mut specs: Vec<String> = paths.iter().map(|p| git_path(&self.rel(p))).collect();
        // Unstaging the new side of a rename must also bring back the old path.
        let renames = self.rename_sources(&repo)?;
        for p in specs.clone() {
            if let Some(old) = renames.get(Path::new(&p)) {
                specs.push(git_path(old));
            }
        }
        let head = match repo.head() {
            Ok(h) => Some(h.peel(git2::ObjectType::Commit)?),
            Err(e) if e.code() == git2::ErrorCode::UnbornBranch || e.code() == git2::ErrorCode::NotFound => None,
            Err(e) => return Err(e.into()),
        };
        repo.reset_default(head.as_ref(), specs.iter())?;
        Ok(())
    }

    /// Staged renames as new path -> old path. Compares HEAD with the index only, so it never
    /// touches the worktree and stays cheap on a big repository.
    pub(crate) fn rename_sources(&self, repo: &git2::Repository) -> Result<HashMap<PathBuf, PathBuf>> {
        let mut map = HashMap::new();
        let Ok(head_tree) = repo.head().and_then(|h| h.peel_to_tree()) else {
            return Ok(map);
        };
        let mut diff = repo.diff_tree_to_index(Some(&head_tree), None, None)?;
        let mut find = git2::DiffFindOptions::new();
        find.renames(true);
        diff.find_similar(Some(&mut find))?;
        for delta in diff.deltas() {
            if delta.status() == git2::Delta::Renamed {
                if let (Some(o), Some(n)) = (delta.old_file().path(), delta.new_file().path()) {
                    map.insert(n.to_path_buf(), o.to_path_buf());
                }
            }
        }
        Ok(map)
    }

    /// IDEA "Rollback": tracked files go back to their HEAD content in both index and
    /// worktree; files that do not exist in HEAD are removed from the index and deleted.
    pub fn rollback(&self, paths: &[PathBuf]) -> Result<()> {
        if paths.is_empty() {
            return Ok(());
        }
        let repo = self.open()?;
        let head_tree = match repo.head() {
            Ok(h) => Some(h.peel_to_tree()?),
            Err(_) => None,
        };
        let renames = self.rename_sources(&repo)?;
        let index = repo.index()?;
        let mut restore: Vec<PathBuf> = Vec::new();
        let mut drop: Vec<PathBuf> = Vec::new();
        let mut seen = HashSet::new();
        let mut queue: Vec<PathBuf> = paths.iter().map(|p| self.rel(p)).collect();
        // The old side of a rename is restored together with the new side.
        while let Some(rel) = queue.pop() {
            if !seen.insert(rel.clone()) {
                continue;
            }
            if let Some(old) = renames.get(&rel) {
                queue.push(old.clone());
            }
            let in_head = head_tree.as_ref().is_some_and(|t| t.get_path(&rel).is_ok());
            if in_head {
                restore.push(rel);
            } else {
                drop.push(rel);
            }
        }
        if !restore.is_empty() {
            self.git_paths(&["checkout", "HEAD"], &restore)?;
        }
        let in_index: Vec<PathBuf> = drop
            .iter()
            .filter(|p| index.get_path(p, 0).is_some())
            .cloned()
            .collect();
        if !in_index.is_empty() {
            self.git_paths(&["rm", "--cached", "-q", "-r", "--ignore-unmatch"], &in_index)?;
        }
        for rel in drop {
            let abs = self.abs(&rel);
            match std::fs::symlink_metadata(&abs) {
                Ok(m) if m.is_dir() => std::fs::remove_dir_all(&abs)?,
                Ok(_) => std::fs::remove_file(&abs)?,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.into()),
            }
        }
        Ok(())
    }

    /// Commits exactly `paths` (their worktree content), leaving any other staged change
    /// staged, like IDEA. Runs through the CLI so pre-commit and commit-msg hooks run.
    /// With `amend` and no paths, only the message of HEAD changes.
    pub fn commit(&self, message: &str, paths: &[PathBuf], amend: bool) -> Result<CommitOutcome> {
        if paths.is_empty() && !amend {
            return Err(Error::Other("nothing selected to commit".into()));
        }
        let repo = self.open()?;
        let mut rel: Vec<PathBuf> = paths.iter().map(|p| self.rel(p)).collect();
        // Committing the new side of a staged rename without the old side would leave the
        // deletion staged and turn the rename into a copy.
        let renames = self.rename_sources(&repo)?;
        for i in 0..rel.len() {
            if let Some(old) = renames.get(&rel[i]) {
                if !rel.contains(old) {
                    rel.push(old.clone());
                }
            }
        }

        // `--only` refuses paths git does not know yet, so new files get added first.
        {
            let index = repo.index()?;
            let unknown: Vec<PathBuf> = rel
                .iter()
                .filter(|p| index.get_path(p, 0).is_none() && std::fs::symlink_metadata(self.abs(p)).is_ok())
                .cloned()
                .collect();
            if !unknown.is_empty() {
                self.git_paths(&["add", "-A"], &unknown)?;
            }
        }

        // Git forbids a partial commit while a merge is being concluded, so stage the
        // selection and commit the whole index instead.
        let concluding = matches!(
            repo.state(),
            RepositoryState::Merge | RepositoryState::CherryPick | RepositoryState::Revert
        );
        if concluding && !rel.is_empty() {
            self.git_paths(&["add", "-A"], &rel)?;
        }

        // The message goes through a file and the paths through stdin, so neither is limited
        // by the argument length and the message needs no escaping.
        let msg_file = repo.path().join("HARWEX_COMMIT_EDITMSG");
        std::fs::write(&msg_file, message)?;
        let msg_arg = format!("--file={}", msg_file.display());
        let mut args = vec!["commit", msg_arg.as_str(), "--cleanup=strip"];
        if amend {
            args.push("--amend");
        }
        let mut stdin = None;
        let spec_input: String;
        if !concluding {
            args.push("--only");
            if !rel.is_empty() {
                spec_input = rel.iter().map(|p| crate::cli::literal_pathspec(p) + "\0").collect();
                args.push("--pathspec-from-file=-");
                args.push("--pathspec-file-nul");
                stdin = Some(spec_input.as_str());
            }
        }
        let result = self.git_with_stdin(&args, stdin);
        let _ = std::fs::remove_file(&msg_file);
        let output = result?;
        let oid = if output.success {
            repo.head().ok().and_then(|h| h.target())
        } else {
            None
        };
        Ok(CommitOutcome { oid, output })
    }

    /// For the "Amend" checkbox, which fills the message box with the HEAD message.
    pub fn last_commit_message(&self) -> Result<String> {
        let repo = self.open()?;
        let commit = repo.head()?.peel_to_commit()?;
        Ok(String::from_utf8_lossy(commit.message_bytes()).trim_end().to_string())
    }
}
