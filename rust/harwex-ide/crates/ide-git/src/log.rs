use std::collections::HashMap;
use std::path::{Path, PathBuf};

use git2::{Delta, DiffFindOptions, Sort};

use crate::{ChangeKind, Error, Oid, Repo, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RefKind {
    /// Detached HEAD; an attached HEAD marks its branch with `is_current` instead.
    Head,
    LocalBranch,
    RemoteBranch,
    Tag,
}

/// A label drawn next to the subject in the log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefLabel {
    /// Short name: `main`, `origin/main`, `v1.0`.
    pub name: String,
    pub kind: RefKind,
    pub is_current: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitInfo {
    pub oid: Oid,
    pub parents: Vec<Oid>,
    pub summary: String,
    pub author_name: String,
    pub author_email: String,
    /// Seconds since the Unix epoch.
    pub author_time: i64,
    /// Offset of the author's time zone from UTC, in minutes.
    pub author_offset_minutes: i32,
    pub committer_time: i64,
    pub refs: Vec<RefLabel>,
}

/// All fields are optional; the default shows every branch, like IDEA's "Branch: All".
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LogFilter {
    /// A branch, tag or any revision. None walks HEAD plus all local and remote branches.
    pub branch: Option<String>,
    /// Case-insensitive substring of the message, or a hash prefix.
    pub text: Option<String>,
    /// Case-insensitive substring of the author name or email.
    pub author: Option<String>,
    /// Only commits that change this file or directory.
    pub path: Option<PathBuf>,
    /// Author time bounds, seconds since the epoch, inclusive.
    pub since: Option<i64>,
    pub until: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangedFile {
    pub path: PathBuf,
    pub old_path: Option<PathBuf>,
    pub kind: ChangeKind,
}

#[derive(Debug, Clone)]
pub struct CommitDetails {
    pub info: CommitInfo,
    /// Full message, including the summary line.
    pub message: String,
    pub committer_name: String,
    pub committer_email: String,
    /// Changes against the first parent; a root commit lists every file as added.
    pub files: Vec<ChangedFile>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlameLine {
    /// 0-based line in the blamed text.
    pub line: usize,
    /// Zero for lines that are not committed yet.
    pub oid: Oid,
    pub author: String,
    pub author_email: String,
    pub author_time: i64,
    pub summary: String,
    /// 0-based line in the commit that introduced it.
    pub original_line: usize,
}

type RefMap = HashMap<Oid, Vec<RefLabel>>;

fn ref_map(repo: &git2::Repository) -> Result<RefMap> {
    let mut map: RefMap = HashMap::new();
    let head = repo.head().ok();
    let head_name = head.as_ref().and_then(|h| h.name().map(str::to_string));
    if repo.head_detached().unwrap_or(false) {
        if let Some(oid) = head.as_ref().and_then(|h| h.target()) {
            map.entry(oid).or_default().push(RefLabel { name: "HEAD".into(), kind: RefKind::Head, is_current: true });
        }
    }
    for r in repo.references()? {
        let r = r?;
        let Some(full) = r.name() else { continue };
        let kind = if full.starts_with("refs/heads/") {
            RefKind::LocalBranch
        } else if full.starts_with("refs/remotes/") {
            // origin/HEAD duplicates the default branch label.
            if full.ends_with("/HEAD") {
                continue;
            }
            RefKind::RemoteBranch
        } else if full.starts_with("refs/tags/") {
            RefKind::Tag
        } else {
            continue;
        };
        let Ok(commit) = r.peel_to_commit() else { continue };
        map.entry(commit.id()).or_default().push(RefLabel {
            name: r.shorthand().unwrap_or(full).to_string(),
            kind,
            is_current: head_name.as_deref() == Some(full),
        });
    }
    for labels in map.values_mut() {
        labels.sort_by_key(|l| (!l.is_current, l.kind as u8, l.name.clone()));
    }
    Ok(map)
}

pub(crate) fn commit_info(commit: &git2::Commit, refs: Option<&RefMap>) -> CommitInfo {
    let author = commit.author();
    CommitInfo {
        oid: commit.id(),
        parents: commit.parent_ids().collect(),
        summary: String::from_utf8_lossy(commit.summary_bytes().unwrap_or_default()).into_owned(),
        author_name: String::from_utf8_lossy(author.name_bytes()).into_owned(),
        author_email: String::from_utf8_lossy(author.email_bytes()).into_owned(),
        author_time: author.when().seconds(),
        author_offset_minutes: author.when().offset_minutes(),
        committer_time: commit.committer().when().seconds(),
        refs: refs.and_then(|m| m.get(&commit.id())).cloned().unwrap_or_default(),
    }
}

/// Whether `commit` changes `rel`. Compares tree entry ids, so it reads no blobs. A merge
/// counts only when it differs from every parent, which matches git's default history
/// simplification and hides merges that just carried the change along.
fn touches(commit: &git2::Commit, rel: &Path) -> Result<bool> {
    let id = entry_id(&commit.tree()?, rel);
    if commit.parent_count() == 0 {
        return Ok(id.is_some());
    }
    for parent in commit.parents() {
        if entry_id(&parent.tree()?, rel) == id {
            return Ok(false);
        }
    }
    Ok(true)
}

fn entry_id(tree: &git2::Tree, rel: &Path) -> Option<Oid> {
    if rel.as_os_str().is_empty() {
        return Some(tree.id());
    }
    tree.get_path(rel).ok().map(|e| e.id())
}

/// Old path of `rel` if it was renamed between the two trees.
pub(crate) fn rename_source(
    repo: &git2::Repository,
    old: &git2::Tree,
    new: &git2::Tree,
    rel: &Path,
) -> Result<Option<PathBuf>> {
    let mut diff = repo.diff_tree_to_tree(Some(old), Some(new), None)?;
    let mut find = DiffFindOptions::new();
    find.renames(true);
    diff.find_similar(Some(&mut find))?;
    for delta in diff.deltas() {
        if delta.status() == Delta::Renamed && delta.new_file().path() == Some(rel) {
            return Ok(delta.old_file().path().map(Path::to_path_buf));
        }
    }
    Ok(None)
}

fn delta_kind(d: Delta) -> ChangeKind {
    match d {
        Delta::Added | Delta::Copied | Delta::Untracked => ChangeKind::Added,
        Delta::Deleted => ChangeKind::Deleted,
        Delta::Renamed => ChangeKind::Renamed,
        Delta::Typechange => ChangeKind::TypeChange,
        Delta::Conflicted => ChangeKind::Conflicted,
        _ => ChangeKind::Modified,
    }
}

fn contains_ci(haystack: &str, needle_lower: &str) -> bool {
    haystack.to_lowercase().contains(needle_lower)
}

impl Repo {
    /// One page of the log, newest first in topological order. `skip` counts matching
    /// commits, so the app can page with `skip = rows_loaded`.
    pub fn log(&self, filter: &LogFilter, skip: usize, limit: usize) -> Result<Vec<CommitInfo>> {
        let repo = self.open()?;
        let refs = ref_map(&repo)?;
        let mut walk = repo.revwalk()?;
        walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
        match &filter.branch {
            Some(rev) => {
                let commit = repo.revparse_single(rev)?.peel_to_commit()?;
                walk.push(commit.id())?;
            }
            None => {
                // An unborn branch has nothing to walk; that is an empty log, not an error.
                if repo.head().ok().and_then(|h| h.target()).is_some() {
                    walk.push_head()?;
                }
                walk.push_glob("refs/heads")?;
                walk.push_glob("refs/remotes")?;
            }
        }
        let text = filter.text.as_deref().map(str::to_lowercase).filter(|s| !s.is_empty());
        let author = filter.author.as_deref().map(str::to_lowercase).filter(|s| !s.is_empty());
        let path = filter.path.as_deref().map(|p| self.rel(p));
        let mut out = Vec::with_capacity(limit.min(1024));
        let mut skipped = 0;
        for oid in walk {
            if out.len() >= limit {
                break;
            }
            let oid = oid?;
            let commit = repo.find_commit(oid)?;
            if let Some(t) = &text {
                let msg = String::from_utf8_lossy(commit.message_bytes());
                if !contains_ci(&msg, t) && !oid.to_string().starts_with(t.as_str()) {
                    continue;
                }
            }
            if let Some(a) = &author {
                let sig = commit.author();
                let name = String::from_utf8_lossy(sig.name_bytes());
                let email = String::from_utf8_lossy(sig.email_bytes());
                if !contains_ci(&name, a) && !contains_ci(&email, a) {
                    continue;
                }
            }
            let t = commit.author().when().seconds();
            if filter.since.is_some_and(|s| t < s) || filter.until.is_some_and(|u| t > u) {
                continue;
            }
            if let Some(p) = &path {
                if !touches(&commit, p)? {
                    continue;
                }
            }
            if skipped < skip {
                skipped += 1;
                continue;
            }
            out.push(commit_info(&commit, Some(&refs)));
        }
        Ok(out)
    }

    pub fn commit_details(&self, oid: &Oid) -> Result<CommitDetails> {
        let repo = self.open()?;
        let refs = ref_map(&repo)?;
        let commit = repo.find_commit(*oid)?;
        let tree = commit.tree()?;
        let parent_tree = match commit.parent(0) {
            Ok(p) => Some(p.tree()?),
            Err(_) => None,
        };
        let mut diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)?;
        let mut find = DiffFindOptions::new();
        find.renames(true);
        diff.find_similar(Some(&mut find))?;
        let files = diff
            .deltas()
            .filter_map(|d| {
                let kind = delta_kind(d.status());
                let path = d.new_file().path().or_else(|| d.old_file().path())?.to_path_buf();
                let old_path = (kind == ChangeKind::Renamed)
                    .then(|| d.old_file().path().map(Path::to_path_buf))
                    .flatten();
                Some(ChangedFile { path, old_path, kind })
            })
            .collect();
        let committer = commit.committer();
        Ok(CommitDetails {
            info: commit_info(&commit, Some(&refs)),
            message: String::from_utf8_lossy(commit.message_bytes()).into_owned(),
            committer_name: String::from_utf8_lossy(committer.name_bytes()).into_owned(),
            committer_email: String::from_utf8_lossy(committer.email_bytes()).into_owned(),
            files,
        })
    }

    /// Commits from HEAD that changed `path`, newest first. Follows renames.
    pub fn file_history(&self, path: &Path, limit: usize) -> Result<Vec<CommitInfo>> {
        Ok(self.file_history_with_paths(path, limit)?.into_iter().map(|(c, _)| c).collect())
    }

    /// Like `file_history`, plus the file's path in each commit, which differs before a
    /// rename. Pass that path to `diff_commit_file`.
    pub fn file_history_with_paths(&self, path: &Path, limit: usize) -> Result<Vec<(CommitInfo, PathBuf)>> {
        let repo = self.open()?;
        let refs = ref_map(&repo)?;
        let mut walk = repo.revwalk()?;
        walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
        if repo.head().ok().and_then(|h| h.target()).is_none() {
            return Ok(Vec::new());
        }
        walk.push_head()?;
        let mut current = self.rel(path);
        let mut out = Vec::new();
        for oid in walk {
            if out.len() >= limit {
                break;
            }
            let commit = repo.find_commit(oid?)?;
            if !touches(&commit, &current)? {
                continue;
            }
            out.push((commit_info(&commit, Some(&refs)), current.clone()));
            // The file appeared here; if it was renamed, keep following the old name.
            if commit.parent_count() == 1 {
                let tree = commit.tree()?;
                let parent_tree = commit.parent(0)?.tree()?;
                if entry_id(&parent_tree, &current).is_none() && entry_id(&tree, &current).is_some() {
                    if let Some(src) = rename_source(&repo, &parent_tree, &tree, &current)? {
                        current = src;
                    }
                }
            }
        }
        Ok(out)
    }

    /// Blame of the file on disk. Uses `git blame` because it is much faster than libgit2's
    /// blame on long histories and honours `blame.ignoreRevsFile`.
    pub fn blame(&self, path: &Path) -> Result<Vec<BlameLine>> {
        let rel = crate::git_path(&self.rel(path));
        let out = self.git_ok(&["blame", "--porcelain", "--", &rel])?;
        parse_blame(&out.stdout)
    }

    /// Blame of an unsaved editor buffer, so the annotations line up with what is shown.
    pub fn blame_text(&self, path: &Path, text: &str) -> Result<Vec<BlameLine>> {
        let rel = crate::git_path(&self.rel(path));
        let out = self
            .git_with_stdin(&["blame", "--porcelain", "--contents", "-", "--", &rel], Some(text))?
            .into_result()?;
        parse_blame(&out.stdout)
    }
}

#[derive(Default, Clone)]
struct BlameCommit {
    author: String,
    email: String,
    time: i64,
    summary: String,
}

fn parse_blame(porcelain: &str) -> Result<Vec<BlameLine>> {
    let mut commits: HashMap<String, BlameCommit> = HashMap::new();
    let mut lines = Vec::new();
    let mut current: Option<(String, usize, usize)> = None;
    for line in porcelain.lines() {
        if line.starts_with('\t') {
            let Some((hash, orig, fin)) = current.take() else { continue };
            let info = commits.get(&hash).cloned().unwrap_or_default();
            let oid = Oid::from_str(&hash).map_err(Error::from)?;
            lines.push(BlameLine {
                line: fin.saturating_sub(1),
                oid,
                author: info.author,
                author_email: info.email,
                author_time: info.time,
                summary: info.summary,
                original_line: orig.saturating_sub(1),
            });
            continue;
        }
        let mut parts = line.splitn(2, ' ');
        let key = parts.next().unwrap_or_default();
        let value = parts.next().unwrap_or_default();
        if key.len() == 40 && key.bytes().all(|b| b.is_ascii_hexdigit()) {
            let mut nums = value.split(' ').filter_map(|n| n.parse::<usize>().ok());
            let orig = nums.next().unwrap_or(0);
            let fin = nums.next().unwrap_or(0);
            commits.entry(key.to_string()).or_default();
            current = Some((key.to_string(), orig, fin));
            continue;
        }
        let Some((hash, _, _)) = &current else { continue };
        let entry = commits.entry(hash.clone()).or_default();
        match key {
            "author" => entry.author = value.to_string(),
            "author-mail" => entry.email = value.trim_matches(|c| c == '<' || c == '>').to_string(),
            "author-time" => entry.time = value.parse().unwrap_or(0),
            "summary" => entry.summary = value.to_string(),
            _ => {}
        }
    }
    Ok(lines)
}
