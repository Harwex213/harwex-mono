//! Compare MR Diff, like the Changes view of a GitLab merge request: the current branch (HEAD)
//! is the source, a picked branch the target. The old side is the tree of
//! `merge-base(HEAD, target)`, the new side HEAD's tree (three-dot), so the commits that landed
//! on the target after the fork do not show.

use std::path::Path;

use crate::diff::{build, tree_blob, FileDiff};
use crate::log::{changed_files, ChangedFile};
use crate::{Error, Oid, Repo, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MrChanges {
    /// The merge-base of HEAD and the target (the old side).
    pub base: Oid,
    /// HEAD's commit (the new side).
    pub tip: Oid,
    /// Files that differ between `base` and `tip`, renames detected, sorted by path.
    pub files: Vec<ChangedFile>,
}

/// One file of an MR diff.
#[derive(Debug, Clone)]
pub enum MrFileDiff {
    Diff(FileDiff),
    /// A side is larger than the caller's limit; nothing was read into memory past the size.
    TooLarge { old_size: usize, new_size: usize },
}

impl Repo {
    /// The files that HEAD changed since it forked from `target` (any revision): the tree of
    /// their merge-base against HEAD's tree. Unrelated histories are an error.
    pub fn mr_changes(&self, target: &str) -> Result<MrChanges> {
        let repo = self.open()?;
        let tip = repo.head()?.peel_to_commit()?.id();
        let onto = repo.revparse_single(target)?.peel_to_commit()?.id();
        let base = if onto == tip { tip } else { self.merge_base(&tip, &onto, target)? };
        let old = repo.find_commit(base)?.tree()?;
        let new = repo.find_commit(tip)?.tree()?;
        let mut diff = repo.diff_tree_to_tree(Some(&old), Some(&new), None)?;
        let mut files = changed_files(&mut diff)?;
        files.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(MrChanges { base, tip, files })
    }

    /// `git merge-base`: the CLI reads the commit-graph file, libgit2 parses every commit it
    /// walks. Exit code 1 without output means the histories are unrelated.
    fn merge_base(&self, a: &Oid, b: &Oid, target: &str) -> Result<Oid> {
        let out = self.git(&["merge-base", &a.to_string(), &b.to_string()])?;
        if !out.success && out.code == Some(1) && out.stdout.trim().is_empty() {
            return Err(Error::Other(format!("The current branch and {target} have no common commit (unrelated histories).")));
        }
        let out = out.into_result()?;
        Ok(Oid::from_str(out.stdout.trim())?)
    }

    /// One file of `mr_changes`: `base` (at `old_path` for a rename) against `tip`. A side
    /// bigger than `max_bytes` gives `TooLarge` without a line diff.
    pub fn mr_file_diff(&self, base: &Oid, tip: &Oid, file: &ChangedFile, max_bytes: usize) -> Result<MrFileDiff> {
        let repo = self.open()?;
        let old_tree = repo.find_commit(*base)?.tree()?;
        let new_tree = repo.find_commit(*tip)?.tree()?;
        let old_rel: &Path = file.old_path.as_deref().unwrap_or(&file.path);
        let size = |tree: &git2::Tree, rel: &Path| -> usize {
            tree.get_path(rel).ok().and_then(|e| e.to_object(&repo).ok()).and_then(|o| o.into_blob().ok()).map_or(0, |b| b.size())
        };
        let (old_size, new_size) = (size(&old_tree, old_rel), size(&new_tree, &file.path));
        if old_size > max_bytes || new_size > max_bytes {
            return Ok(MrFileDiff::TooLarge { old_size, new_size });
        }
        let old = tree_blob(&repo, &old_tree, old_rel)?;
        let new = tree_blob(&repo, &new_tree, &file.path)?;
        Ok(MrFileDiff::Diff(build(file.path.clone(), file.old_path.clone(), old, new)))
    }
}
