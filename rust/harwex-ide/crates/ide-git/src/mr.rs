//! Compare MR Diff: the current branch (HEAD) against a picked branch, two-dot: HEAD's tree is
//! the old side, the picked branch's tree the new side. Commits that landed on HEAD after the fork
//! show as changes too (the user's choice over a merge-base compare).

use std::path::Path;

use crate::diff::{build, tree_blob, FileDiff};
use crate::log::{changed_files, ChangedFile};
use crate::{Oid, Repo, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MrChanges {
    /// HEAD's commit (the old side).
    pub base: Oid,
    /// The source's commit.
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
    /// The files that differ between HEAD's tree and `source`'s (any revision).
    pub fn mr_changes(&self, source: &str) -> Result<MrChanges> {
        let repo = self.open()?;
        let tip = repo.revparse_single(source)?.peel_to_commit()?.id();
        let base = repo.head()?.peel_to_commit()?.id();
        let old = repo.find_commit(base)?.tree()?;
        let new = repo.find_commit(tip)?.tree()?;
        let mut diff = repo.diff_tree_to_tree(Some(&old), Some(&new), None)?;
        let mut files = changed_files(&mut diff)?;
        files.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(MrChanges { base, tip, files })
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
