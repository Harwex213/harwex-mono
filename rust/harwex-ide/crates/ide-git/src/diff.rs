use std::ops::Range;
use std::path::{Path, PathBuf};

use crate::text_diff::{diff_texts, line_changes_between, rollback_lines_between};
use crate::{bytes_to_text, is_binary, Error, Oid, Repo, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiffSide {
    /// What IDEA shows by default in the Changes view: committed vs on disk.
    HeadVsWorktree,
    /// Staged changes.
    HeadVsIndex,
    /// Unstaged changes.
    IndexVsWorktree,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineKind {
    /// Old and new line shown next to each other; `*_inline` hold the changed words.
    Changed,
    /// Only on the old side.
    Deleted,
    /// Only on the new side.
    Inserted,
}

/// One row of a side-by-side hunk. Line numbers are 0-based in the full texts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinePair {
    pub kind: LineKind,
    pub old: Option<usize>,
    pub new: Option<usize>,
    /// Changed char-column ranges in the old line.
    pub old_inline: Vec<Range<usize>>,
    /// Changed char-column ranges in the new line.
    pub new_inline: Vec<Range<usize>>,
}

/// One changed block. An empty range means a pure insertion or deletion; the ribbon then
/// points at the gap before `start` on that side.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffHunk {
    pub old_lines: Range<usize>,
    pub new_lines: Range<usize>,
    pub pairs: Vec<LinePair>,
}

#[derive(Debug, Clone)]
pub struct FileDiff {
    /// Path on the new side, relative to the workdir.
    pub path: PathBuf,
    /// Path on the old side when the file was renamed.
    pub old_path: Option<PathBuf>,
    /// Empty when the file does not exist on that side (`old_exists` tells which).
    pub old_text: String,
    pub new_text: String,
    pub old_exists: bool,
    pub new_exists: bool,
    /// Binary content has no texts and no hunks.
    pub binary: bool,
    pub hunks: Vec<DiffHunk>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineChangeKind {
    Added,
    Modified,
    Deleted,
}

/// One gutter bar: a change between HEAD and the editor buffer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LineChange {
    pub kind: LineChangeKind,
    /// Lines in the buffer. Empty for `Deleted`: the old lines were removed just before
    /// `lines.start`, so the marker goes between lines `start - 1` and `start`.
    pub lines: Range<usize>,
    /// Lines in the HEAD version.
    pub old_lines: Range<usize>,
    /// HEAD text of the block for the "show old text" popup, with a trailing newline.
    pub old_text: String,
}

pub(crate) fn build(path: PathBuf, old_path: Option<PathBuf>, old: Option<Vec<u8>>, new: Option<Vec<u8>>) -> FileDiff {
    let binary = old.as_deref().is_some_and(is_binary) || new.as_deref().is_some_and(is_binary);
    let old_exists = old.is_some();
    let new_exists = new.is_some();
    if binary {
        return FileDiff {
            path,
            old_path,
            old_text: String::new(),
            new_text: String::new(),
            old_exists,
            new_exists,
            binary,
            hunks: Vec::new(),
        };
    }
    let old_text = old.map(|b| bytes_to_text(&b)).unwrap_or_default();
    let new_text = new.map(|b| bytes_to_text(&b)).unwrap_or_default();
    let hunks = diff_texts(&old_text, &new_text);
    FileDiff { path, old_path, old_text, new_text, old_exists, new_exists, binary, hunks }
}

pub(crate) fn tree_blob(repo: &git2::Repository, tree: &git2::Tree, path: &Path) -> Result<Option<Vec<u8>>> {
    match tree.get_path(path) {
        Ok(entry) => match entry.to_object(repo)?.into_blob() {
            Ok(blob) => Ok(Some(blob.content().to_vec())),
            // A directory or submodule at that path has no text.
            Err(_) => Ok(None),
        },
        Err(e) if e.code() == git2::ErrorCode::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

fn head_tree(repo: &git2::Repository) -> Result<Option<git2::Tree<'_>>> {
    match repo.head() {
        Ok(h) => Ok(Some(h.peel_to_tree()?)),
        Err(e) if e.code() == git2::ErrorCode::UnbornBranch || e.code() == git2::ErrorCode::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

impl Repo {
    fn head_blob(&self, repo: &git2::Repository, rel: &Path) -> Result<Option<Vec<u8>>> {
        match head_tree(repo)? {
            Some(tree) => tree_blob(repo, &tree, rel),
            None => Ok(None),
        }
    }

    fn index_blob(&self, repo: &git2::Repository, rel: &Path) -> Result<Option<Vec<u8>>> {
        let index = repo.index()?;
        // During a conflict there is no stage 0; "ours" is what the user is merging into.
        let entry = index.get_path(rel, 0).or_else(|| index.get_path(rel, 2));
        match entry {
            Some(e) => Ok(Some(repo.find_blob(e.id)?.content().to_vec())),
            None => Ok(None),
        }
    }

    pub(crate) fn worktree_bytes(&self, rel: &Path) -> Result<Option<Vec<u8>>> {
        match std::fs::read(self.abs(rel)) {
            Ok(b) => Ok(Some(b)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) if e.kind() == std::io::ErrorKind::IsADirectory => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Diff of one file in the working copy. A staged rename shows the old file on the left.
    pub fn diff_file(&self, path: &Path, side: DiffSide) -> Result<FileDiff> {
        let repo = self.open()?;
        let rel = self.rel(path);
        let mut old_path = None;
        let old = match side {
            DiffSide::HeadVsWorktree | DiffSide::HeadVsIndex => {
                let mut blob = self.head_blob(&repo, &rel)?;
                if blob.is_none() {
                    if let Some(src) = self.rename_sources(&repo)?.remove(&rel) {
                        blob = self.head_blob(&repo, &src)?;
                        old_path = Some(src);
                    }
                }
                blob
            }
            DiffSide::IndexVsWorktree => self.index_blob(&repo, &rel)?,
        };
        let new = match side {
            DiffSide::HeadVsIndex => self.index_blob(&repo, &rel)?,
            DiffSide::HeadVsWorktree | DiffSide::IndexVsWorktree => self.worktree_bytes(&rel)?,
        };
        Ok(build(rel, old_path, old, new))
    }

    /// Diff of one file in a commit against its first parent (empty for a root commit).
    pub fn diff_commit_file(&self, commit: &Oid, path: &Path) -> Result<FileDiff> {
        let repo = self.open()?;
        let rel = self.rel(path);
        let commit = repo.find_commit(*commit)?;
        let tree = commit.tree()?;
        let parent_tree = match commit.parent(0) {
            Ok(p) => Some(p.tree()?),
            Err(_) => None,
        };
        let new = tree_blob(&repo, &tree, &rel)?;
        let mut old_path = None;
        let mut old = match &parent_tree {
            Some(t) => tree_blob(&repo, t, &rel)?,
            None => None,
        };
        if old.is_none() && new.is_some() {
            if let Some(t) = &parent_tree {
                if let Some(src) = crate::log::rename_source(&repo, t, &tree, &rel)? {
                    old = tree_blob(&repo, t, &src)?;
                    old_path = Some(src);
                }
            }
        }
        Ok(build(rel, old_path, old, new))
    }

    /// Gutter bars for an open editor buffer, HEAD vs `worktree_text`. A file that is new in
    /// the index is one big "added" block; an unversioned file has no bars, like in IDEA.
    pub fn line_changes(&self, path: &Path, worktree_text: &str) -> Result<Vec<LineChange>> {
        let repo = self.open()?;
        let rel = self.rel(path);
        match self.head_blob(&repo, &rel)? {
            Some(base) if is_binary(&base) => Ok(Vec::new()),
            Some(base) => Ok(line_changes_between(&bytes_to_text(&base), worktree_text)),
            None => {
                if repo.index()?.get_path(&rel, 0).is_some() {
                    Ok(line_changes_between("", worktree_text))
                } else {
                    Ok(Vec::new())
                }
            }
        }
    }

    /// Returns `worktree_text` with every change touching `lines` reverted to HEAD.
    /// The caller puts the result into the buffer, so the edit stays undoable.
    pub fn rollback_lines(&self, path: &Path, worktree_text: &str, lines: Range<usize>) -> Result<String> {
        let repo = self.open()?;
        let rel = self.rel(path);
        let base = self.head_blob(&repo, &rel)?.unwrap_or_default();
        if is_binary(&base) {
            return Err(Error::Other("cannot roll back lines of a binary file".into()));
        }
        Ok(rollback_lines_between(&bytes_to_text(&base), worktree_text, lines))
    }
}
