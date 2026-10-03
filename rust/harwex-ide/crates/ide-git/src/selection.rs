//! Operations on a selection of commits in the log (IDEA's multi-select), on a branch
//! compare and on a revision against the working tree.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

use git2::Sort;

use crate::cli::{literal_pathspec, Run};
use crate::diff::{build, tree_blob, FileDiff};
use crate::log::{changed_files, commit_info, entry_id, ref_map, rename_source, ChangedFile};
use crate::{ChangeKind, CommandOutcome, CommitInfo, Error, Oid, Repo, Result};

/// Upper bound for each side of `compare_with_branch`, so comparing with an unrelated
/// history does not list all of it.
pub const COMPARE_LIMIT: usize = 1000;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BranchCompare {
    /// Commits on HEAD that `other` lacks, newest first.
    pub only_current: Vec<CommitInfo>,
    /// Commits on `other` that HEAD lacks, newest first.
    pub only_other: Vec<CommitInfo>,
}

/// Selected commits, oldest first.
struct Selection<'r> {
    commits: Vec<git2::Commit<'r>>,
    /// Each commit's first parent is the previous one, so the net change is one tree diff.
    contiguous: bool,
}

impl Selection<'_> {
    fn newest(&self) -> &git2::Commit<'_> {
        self.commits.last().expect("selection is not empty")
    }
}

/// The empty tree's id, the base of a root commit. git knows this object without storing it.
fn empty_tree_id() -> Result<Oid> {
    Ok(Oid::hash_object(git2::ObjectType::Tree, &[])?)
}

fn first_parent_id(c: &git2::Commit) -> Option<Oid> {
    c.parent_ids().next()
}

fn parent_tree<'r>(c: &git2::Commit<'r>) -> Result<Option<git2::Tree<'r>>> {
    match c.parent(0) {
        Ok(p) => Ok(Some(p.tree()?)),
        Err(_) => Ok(None),
    }
}

fn select<'r>(repo: &'r git2::Repository, oids: &[Oid]) -> Result<Selection<'r>> {
    let mut seen = HashSet::new();
    let mut commits = Vec::new();
    for oid in oids {
        if seen.insert(*oid) {
            commits.push(repo.find_commit(*oid)?);
        }
    }
    if commits.is_empty() {
        return Err(Error::Other("no commits selected".into()));
    }
    // A chain by first parents: exactly one commit is nobody's first parent, and walking
    // first parents from it visits the whole selection.
    let firsts: HashSet<Oid> = commits.iter().filter_map(first_parent_id).collect();
    let tips: Vec<usize> = (0..commits.len()).filter(|&i| !firsts.contains(&commits[i].id())).collect();
    if let [tip] = tips[..] {
        let mut chain = vec![commits[tip].id()];
        while chain.len() < commits.len() {
            match repo.find_commit(*chain.last().expect("chain is not empty"))?.parent_ids().next() {
                Some(p) if seen.contains(&p) => chain.push(p),
                _ => break,
            }
        }
        if chain.len() == commits.len() {
            let mut ordered = Vec::with_capacity(chain.len());
            for oid in chain.iter().rev() {
                ordered.push(repo.find_commit(*oid)?);
            }
            return Ok(Selection { commits: ordered, contiguous: true });
        }
    }
    // Committer time orders rebased and cherry-picked commits too. Only commits made in
    // the same second need the (slower) ancestry check.
    commits.sort_by_key(|c| c.committer().when().seconds());
    for i in 1..commits.len() {
        let mut j = i;
        while j > 0
            && commits[j - 1].committer().when().seconds() == commits[j].committer().when().seconds()
            && repo.graph_descendant_of(commits[j - 1].id(), commits[j].id())?
        {
            commits.swap(j - 1, j);
            j -= 1;
        }
    }
    Ok(Selection { commits, contiguous: false })
}

/// Folds one commit's changes into the running net change of a selection (oldest first).
fn fold(net: &mut BTreeMap<PathBuf, ChangedFile>, change: ChangedFile) {
    use ChangeKind::*;
    let path = change.path.clone();
    match change.kind {
        Renamed => {
            let src = change.old_path.clone().expect("a rename has an old path");
            let file = match net.remove(&src) {
                Some(prev) if prev.kind == Added => ChangedFile { path: path.clone(), old_path: None, kind: Added },
                Some(ChangedFile { kind: Renamed, old_path: Some(orig), .. }) if orig == path => {
                    // Renamed back: only the content may differ.
                    ChangedFile { path: path.clone(), old_path: None, kind: Modified }
                }
                Some(ChangedFile { kind: Renamed, old_path: Some(orig), .. }) => {
                    ChangedFile { path: path.clone(), old_path: Some(orig), kind: Renamed }
                }
                _ => change,
            };
            net.insert(path, file);
        }
        Added => {
            let kind = match net.get(&path) {
                Some(prev) if prev.kind == Deleted => Modified,
                _ => Added,
            };
            net.insert(path.clone(), ChangedFile { path, old_path: None, kind });
        }
        Deleted => match net.remove(&path) {
            Some(prev) if prev.kind == Added => {}
            Some(ChangedFile { kind: Renamed, old_path: Some(orig), .. }) => {
                net.insert(orig.clone(), ChangedFile { path: orig, old_path: None, kind: Deleted });
            }
            _ => {
                net.insert(path, change);
            }
        },
        _ => match net.get(&path) {
            // A later edit keeps "added" and "renamed".
            Some(prev) if matches!(prev.kind, Added | Renamed) => {}
            _ => {
                net.insert(path, change);
            }
        },
    }
}

/// Whether `commit` changes any of `paths` against its first parent.
fn touches_any(commit: &git2::Commit, paths: &[&Path]) -> Result<bool> {
    let tree = commit.tree()?;
    let parent = parent_tree(commit)?;
    for p in paths {
        let before = parent.as_ref().and_then(|t| entry_id(t, p));
        if entry_id(&tree, p) != before {
            return Ok(true);
        }
    }
    Ok(false)
}

impl Repo {
    /// Combined changes of several selected commits (IDEA's multi-select in the log). A
    /// contiguous first-parent range is the net diff from the oldest commit's first parent to
    /// the newest. Otherwise the commits' own changes are merged per path in history order:
    /// added then modified stays added, added then deleted disappears, and so on. Renames
    /// keep `old_path`. Sorted by path.
    pub fn changes_of(&self, oids: &[Oid]) -> Result<Vec<ChangedFile>> {
        let repo = self.open()?;
        let sel = select(&repo, oids)?;
        if sel.contiguous {
            let base = parent_tree(&sel.commits[0])?;
            let mut diff = repo.diff_tree_to_tree(base.as_ref(), Some(&sel.newest().tree()?), None)?;
            let mut files = changed_files(&mut diff)?;
            files.sort_by(|a, b| a.path.cmp(&b.path));
            return Ok(files);
        }
        let mut net = BTreeMap::new();
        for c in &sel.commits {
            let mut diff = repo.diff_tree_to_tree(parent_tree(c)?.as_ref(), Some(&c.tree()?), None)?;
            for f in changed_files(&mut diff)? {
                fold(&mut net, f);
            }
        }
        Ok(net.into_values().collect())
    }

    /// Show Diff for one file of a selection. The old side is the file before the oldest
    /// selected commit that changes it, the new side is the file after the newest one. For a
    /// single commit this equals `diff_commit_file`.
    pub fn diff_commits_file(&self, oids: &[Oid], path: &Path) -> Result<FileDiff> {
        if let [one] = oids {
            return self.diff_commit_file(one, path);
        }
        let repo = self.open()?;
        let sel = select(&repo, oids)?;
        let rel = self.rel(path);
        let old_path = if sel.contiguous {
            None
        } else {
            self.changes_of(oids)?.into_iter().find(|f| f.path == rel).and_then(|f| f.old_path)
        };
        let names: Vec<&Path> = std::iter::once(rel.as_path()).chain(old_path.as_deref()).collect();
        let (oldest, newest) = if sel.contiguous {
            (&sel.commits[0], sel.newest())
        } else {
            let mut touching = Vec::new();
            for c in &sel.commits {
                if touches_any(c, &names)? {
                    touching.push(c);
                }
            }
            match (touching.first(), touching.last()) {
                (Some(a), Some(b)) => (*a, *b),
                _ => (sel.newest(), sel.newest()),
            }
        };
        let base = parent_tree(oldest)?;
        let tip = newest.tree()?;
        let new = tree_blob(&repo, &tip, &rel)?;
        let mut src = old_path;
        let mut old = match (&base, &src) {
            (Some(t), Some(s)) => tree_blob(&repo, t, s)?,
            (Some(t), None) => tree_blob(&repo, t, &rel)?,
            (None, _) => None,
        };
        if old.is_none() && new.is_some() && src.is_none() {
            if let Some(t) = &base {
                if let Some(s) = rename_source(&repo, t, &tip, &rel)? {
                    old = tree_blob(&repo, t, &s)?;
                    src = Some(s);
                }
            }
        }
        Ok(build(rel, src, old, new))
    }

    /// Unified patch of a selection for Create Patch / Copy Patch, in `git diff --binary`
    /// format so `git apply` takes it. Empty `paths` means every changed file. A path that
    /// is a rename target brings its source along, so the patch moves the file.
    pub fn patch(&self, oids: &[Oid], paths: &[PathBuf]) -> Result<String> {
        Ok(String::from_utf8_lossy(&self.patch_bytes(oids, paths)?).into_owned())
    }

    fn patch_bytes(&self, oids: &[Oid], paths: &[PathBuf]) -> Result<Vec<u8>> {
        let repo = self.open()?;
        let sel = select(&repo, oids)?;
        let wanted: HashSet<PathBuf> = paths.iter().map(|p| self.rel(p)).collect();
        let files: Vec<ChangedFile> = self
            .changes_of(oids)?
            .into_iter()
            .filter(|f| wanted.is_empty() || wanted.contains(&f.path) || f.old_path.as_ref().is_some_and(|o| wanted.contains(o)))
            .collect();
        let base_of = |c: &git2::Commit| -> Result<Oid> {
            match first_parent_id(c) {
                Some(p) => Ok(p),
                None => empty_tree_id(),
            }
        };
        // (base, tip) -> paths. A contiguous range is one group; otherwise each file spans
        // the selected commits that change it.
        let mut groups: Vec<((Oid, Oid), Vec<PathBuf>)> = Vec::new();
        for f in files {
            let names: Vec<PathBuf> = std::iter::once(f.path.clone()).chain(f.old_path.clone()).collect();
            let key = if sel.contiguous {
                (base_of(&sel.commits[0])?, sel.newest().id())
            } else {
                let refs: Vec<&Path> = names.iter().map(PathBuf::as_path).collect();
                let mut touching = Vec::new();
                for c in &sel.commits {
                    if touches_any(c, &refs)? {
                        touching.push(c);
                    }
                }
                let (Some(a), Some(b)) = (touching.first(), touching.last()) else { continue };
                (base_of(a)?, b.id())
            };
            match groups.iter_mut().find(|(k, _)| *k == key) {
                Some((_, list)) => list.extend(names),
                None => groups.push((key, names)),
            }
        }
        let mut out = Vec::new();
        for ((base, tip), names) in groups {
            let (base, tip) = (base.to_string(), tip.to_string());
            let specs: Vec<String> = names.iter().map(|p| literal_pathspec(p)).collect();
            // Renames are detected only inside one run, so the pathspec is not chunked here:
            // a selection rarely has thousands of files, and a long command line still works
            // up to the OS limit of about 1 MB on macOS.
            let mut args = vec![
                "diff",
                "--binary",
                "--full-index",
                "-M",
                "--no-color",
                "--no-ext-diff",
                "--no-textconv",
                "--no-relative",
                "--src-prefix=a/",
                "--dst-prefix=b/",
                &base,
                &tip,
                "--",
            ];
            args.extend(specs.iter().map(String::as_str));
            let (outcome, bytes) = self.git_run(&args, Run::default())?;
            outcome.into_result()?;
            out.extend_from_slice(&bytes);
        }
        Ok(out)
    }

    /// "Cherry-Pick Selected Changes": applies only `paths` of `oid` to the index and the
    /// working tree, with a three-way merge. Conflicts are a failed outcome and leave the
    /// files in conflict, like a cherry-pick. Nothing is committed.
    pub fn cherry_pick_paths(&self, oid: &Oid, paths: &[PathBuf]) -> Result<CommandOutcome> {
        if paths.is_empty() {
            return Err(Error::Other("no files selected".into()));
        }
        let patch = self.patch_bytes(std::slice::from_ref(oid), paths)?;
        if patch.is_empty() {
            return Err(Error::Other("the selected files have no changes in this commit".into()));
        }
        Ok(self.git_run(&["apply", "--3way", "--index", "--whitespace=nowarn", "-"], Run { stdin: Some(&patch), ..Run::default() })?.0)
    }

    /// Compare with Current: commits only on HEAD and only on `other` (any revision).
    pub fn compare_with_branch(&self, other: &str) -> Result<BranchCompare> {
        let repo = self.open()?;
        let refs = ref_map(&repo)?;
        let other = repo.revparse_single(other)?.peel_to_commit()?.id();
        let head = repo.head()?.peel_to_commit()?.id();
        let side = |show: Oid, hide: Oid| -> Result<Vec<CommitInfo>> {
            let mut walk = repo.revwalk()?;
            walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
            walk.push(show)?;
            walk.hide(hide)?;
            let mut out = Vec::new();
            for oid in walk.take(COMPARE_LIMIT) {
                out.push(commit_info(&repo.find_commit(oid?)?, Some(&refs)));
            }
            Ok(out)
        };
        Ok(BranchCompare { only_current: side(head, other)?, only_other: side(other, head)? })
    }

    /// Show Diff with Working Tree: files that differ between `rev` and the working tree
    /// (tracked files, including staged ones). Untracked files are not listed.
    pub fn diff_with_working_tree(&self, rev: &str) -> Result<Vec<ChangedFile>> {
        let repo = self.open()?;
        let tree = repo.revparse_single(rev)?.peel_to_tree()?;
        let mut diff = repo.diff_tree_to_workdir_with_index(Some(&tree), None)?;
        let mut files = changed_files(&mut diff)?;
        files.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(files)
    }

    /// One file of `rev` (old side) against the working tree (new side). Also serves Compare
    /// with Local for a file of a commit (`rev` = the commit's hash).
    pub fn diff_with_working_tree_file(&self, rev: &str, path: &Path) -> Result<FileDiff> {
        let repo = self.open()?;
        let rel = self.rel(path);
        let tree = repo.revparse_single(rev)?.peel_to_tree()?;
        let mut old_path = None;
        let mut old = tree_blob(&repo, &tree, &rel)?;
        if old.is_none() {
            old_path = self
                .diff_with_working_tree(rev)?
                .into_iter()
                .find(|f| f.path == rel)
                .and_then(|f| f.old_path);
            if let Some(src) = &old_path {
                old = tree_blob(&repo, &tree, src)?;
            }
        }
        let new = self.worktree_bytes(&rel)?;
        Ok(build(rel, old_path, old, new))
    }
}
