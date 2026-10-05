use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use std::time::Duration;

use git2::RepositoryState;

use crate::cli::Run;
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

/// `git status --porcelain=v2 -z` without pathspecs or with them. Untracked files are listed
/// one by one (IDEA lists every unversioned file), ignored files and submodules are left out,
/// and staged renames are detected even when the user's config turns them off.
const STATUS_ARGS: &[&str] = &[
    "status",
    "--porcelain=v2",
    "-z",
    "--untracked-files=all",
    "--ignored=no",
    "--ignore-submodules=all",
    "--find-renames",
];

/// A full status may walk a whole monorepo (15 s and more on 480k files), far longer than the
/// 30 s read limit allows on a slow disk. Cancel still stops it at once.
const FULL_STATUS_TIMEOUT: Duration = Duration::from_secs(600);

/// The index and HEAD as status sees them, to tell whether a `.git` change can have changed
/// the status. Two stamps are equal when HEAD, the operation state and the index entries are
/// equal. The stat data of the index is not compared: `git status` in a shell prompt rewrites
/// the index with fresh stat data and changes nothing else.
#[derive(Debug, Clone)]
pub struct GitStamp {
    head: Option<String>,
    head_oid: Option<Oid>,
    state: RepositoryState,
    /// Size, mtime and inode of the index file. When they match the previous stamp, the
    /// entry hash is reused without reading the index again.
    index_file: Option<(u64, std::time::SystemTime, u64)>,
    index_hash: u64,
}

impl PartialEq for GitStamp {
    fn eq(&self, other: &Self) -> bool {
        self.head == other.head && self.head_oid == other.head_oid && self.state == other.state && self.index_hash == other.index_hash
    }
}

impl Eq for GitStamp {}

fn staged_code(c: u8) -> Option<ChangeKind> {
    match c {
        b'A' | b'C' => Some(ChangeKind::Added),
        b'M' => Some(ChangeKind::Modified),
        b'D' => Some(ChangeKind::Deleted),
        b'R' => Some(ChangeKind::Renamed),
        b'T' => Some(ChangeKind::TypeChange),
        _ => None,
    }
}

fn unstaged_code(c: u8) -> Option<ChangeKind> {
    match c {
        b'M' => Some(ChangeKind::Modified),
        b'D' => Some(ChangeKind::Deleted),
        b'T' => Some(ChangeKind::TypeChange),
        // An intent-to-add entry (`git add -N`): nothing is staged yet.
        b'A' => Some(ChangeKind::Untracked),
        _ => None,
    }
}

fn bytes_path(b: &[u8]) -> PathBuf {
    PathBuf::from(String::from_utf8_lossy(b).into_owned())
}

/// Parses `git status --porcelain=v2 -z`. Records end with NUL; a rename record is followed by
/// one more NUL-terminated field, its HEAD path.
pub(crate) fn parse_porcelain_v2(out: &[u8]) -> Result<Vec<FileChange>> {
    let mut fields = out.split(|&b| b == 0).filter(|r| !r.is_empty());
    let mut list = Vec::new();
    let bad = |r: &[u8]| Error::Other(format!("unexpected `git status` line: {}", String::from_utf8_lossy(r)));
    while let Some(rec) = fields.next() {
        // The path is the last space-separated field, and it may contain spaces itself.
        let after = |n: usize| -> Result<&[u8]> { rec.splitn(n + 1, |&b| b == b' ').nth(n).ok_or_else(|| bad(rec)) };
        let xy = rec.get(2..4).ok_or_else(|| bad(rec));
        match rec[0] {
            b'1' => {
                let xy = xy?;
                list.push(FileChange { path: bytes_path(after(8)?), old_path: None, staged: staged_code(xy[0]), unstaged: unstaged_code(xy[1]) });
            }
            b'2' => {
                let xy = xy?;
                let old = fields.next().ok_or_else(|| bad(rec))?;
                list.push(FileChange {
                    path: bytes_path(after(9)?),
                    old_path: (xy[0] == b'R').then(|| bytes_path(old)),
                    staged: staged_code(xy[0]),
                    unstaged: unstaged_code(xy[1]),
                });
            }
            b'u' => list.push(FileChange { path: bytes_path(after(10)?), old_path: None, staged: Some(ChangeKind::Conflicted), unstaged: Some(ChangeKind::Conflicted) }),
            b'?' => list.push(FileChange { path: bytes_path(after(1)?), old_path: None, staged: None, unstaged: Some(ChangeKind::Untracked) }),
            // Ignored entries and headers are not asked for.
            b'!' | b'#' => {}
            _ => return Err(bad(rec)),
        }
    }
    Ok(list)
}

impl Repo {
    /// Staged, unstaged and untracked files of the whole worktree. Staged renames are
    /// detected. The git CLI runs it, not libgit2: it is multi-threaded, it uses the
    /// repository's untracked cache and fsmonitor when they are on, and Cancel can kill it.
    /// `GIT_OPTIONAL_LOCKS=0` keeps it from rewriting the index.
    pub fn status(&self) -> Result<Vec<FileChange>> {
        let mut out = self.status_run(STATUS_ARGS, Some(FULL_STATUS_TIMEOUT))?;
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    }

    /// Status of the given paths only (files or directories, absolute or relative). git walks
    /// only these paths, so the cost does not grow with the repository (about 0.1 s on a
    /// 480k-file monorepo, where a full status takes 15 s). A staged rename shows only when
    /// both of its sides are in `paths`.
    pub fn status_of(&self, paths: &[PathBuf]) -> Result<Vec<FileChange>> {
        let mut specs: Vec<String> = paths.iter().map(|p| crate::cli::literal_pathspec(&self.rel(p))).collect();
        specs.sort();
        specs.dedup();
        let mut out = Vec::new();
        for chunk in specs.chunks(500) {
            let mut args: Vec<&str> = STATUS_ARGS.to_vec();
            args.push("--");
            args.extend(chunk.iter().map(String::as_str));
            out.extend(self.status_run(&args, None)?);
        }
        out.sort_by(|a, b| a.path.cmp(&b.path));
        // A path that sits in two chunks (a file and its directory) is reported twice.
        out.dedup_by(|a, b| a.path == b.path);
        Ok(out)
    }

    fn status_run(&self, args: &[&str], timeout: Option<Duration>) -> Result<Vec<FileChange>> {
        let env = [("GIT_OPTIONAL_LOCKS", Path::new("0"))];
        let (outcome, stdout) = self.git_run(args, Run { env: &env, timeout, ..Run::default() })?;
        outcome.into_result()?;
        parse_porcelain_v2(&stdout)
    }

    /// The current `GitStamp`. With `prev` from an unchanged index file the index is not read
    /// again (reading it costs about 0.5 s on a 108 MB index).
    pub fn stamp(&self, prev: Option<&GitStamp>) -> Result<GitStamp> {
        let repo = self.open()?;
        let head_ref = repo.find_reference("HEAD").ok();
        let head = head_ref.as_ref().and_then(|r| r.symbolic_target().map(str::to_string).or_else(|| r.target().map(|o| o.to_string())));
        let head_oid = repo.refname_to_id("HEAD").ok();
        let index_path = repo.path().join("index");
        let index_file = std::fs::metadata(&index_path).ok().map(|m| {
            use std::os::unix::fs::MetadataExt;
            (m.len(), m.modified().unwrap_or(std::time::UNIX_EPOCH), m.ino())
        });
        let index_hash = match prev {
            Some(p) if index_file.is_some() && p.index_file == index_file => p.index_hash,
            _ if index_file.is_none() => 0,
            _ => {
                use std::hash::{Hash, Hasher};
                let index = git2::Index::open(&index_path)?;
                let mut h = std::collections::hash_map::DefaultHasher::new();
                for e in index.iter() {
                    e.path.hash(&mut h);
                    e.id.as_bytes().hash(&mut h);
                    e.mode.hash(&mut h);
                    e.flags.hash(&mut h);
                    e.flags_extended.hash(&mut h);
                }
                h.finish()
            }
        };
        Ok(GitStamp { head, head_oid, state: repo.state(), index_file, index_hash })
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
        self.commit_selection(message, paths, &[], amend)
    }

    /// Like `commit`, plus `staged_only`: paths whose index version is committed, so the
    /// unstaged rest of a partly staged file stays uncommitted (IDEA's staging area). A path in
    /// both lists counts as `paths` (the whole worktree file). Other staged changes stay staged.
    pub fn commit_selection(&self, message: &str, paths: &[PathBuf], staged_only: &[PathBuf], amend: bool) -> Result<CommitOutcome> {
        if paths.is_empty() && staged_only.is_empty() && !amend {
            return Err(Error::Other("nothing selected to commit".into()));
        }
        let repo = self.open()?;
        let mut rel: Vec<PathBuf> = paths.iter().map(|p| self.rel(p)).collect();
        let mut index_rel: Vec<PathBuf> = staged_only.iter().map(|p| self.rel(p)).filter(|p| !rel.contains(p)).collect();
        // Committing the new side of a staged rename without the old side would leave the
        // deletion staged and turn the rename into a copy.
        let renames = self.rename_sources(&repo)?;
        for list in [&mut rel, &mut index_rel] {
            for i in 0..list.len() {
                if let Some(old) = renames.get(&list[i]) {
                    if !list.contains(old) {
                        list.push(old.clone());
                    }
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
        if !concluding && !index_rel.is_empty() {
            return self.commit_in_temp_index(&repo, message, &rel, &index_rel, amend);
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

    /// `git commit --only` takes every path from the worktree. For a staged-only part it
    /// builds the commit in a temporary index instead: HEAD, plus the real index entries of
    /// `index_rel`, plus the worktree content of `rel`. Hooks see that index through
    /// `GIT_INDEX_FILE`, like with `--only`. Afterwards the real index gets `rel` staged, which
    /// is what `--only` leaves behind too.
    fn commit_in_temp_index(&self, repo: &git2::Repository, message: &str, rel: &[PathBuf], index_rel: &[PathBuf], amend: bool) -> Result<CommitOutcome> {
        let tmp = repo.path().join("HARWEX_COMMIT_INDEX");
        let msg_file = repo.path().join("HARWEX_COMMIT_EDITMSG");
        let _ = std::fs::remove_file(&tmp);
        let env = [("GIT_INDEX_FILE", tmp.as_path())];
        let result = (|| -> Result<CommandOutcome> {
            let unborn = repo.head().is_err();
            if unborn {
                self.git_env(&["read-tree", "--empty"], None, &env)?.into_result()?;
            } else {
                self.git_env(&["read-tree", "HEAD"], None, &env)?.into_result()?;
            }
            let index = repo.index()?;
            let zero = Oid::zero();
            let mut info = String::new();
            for p in index_rel {
                match index.get_path(p, 0) {
                    Some(e) => info.push_str(&format!("{:o} {}\t{}\0", e.mode, e.id, git_path(p))),
                    // Not in the index: a staged deletion (or the old side of a rename).
                    None => info.push_str(&format!("0 {zero}\t{}\0", git_path(p))),
                }
            }
            self.git_env(&["update-index", "-z", "--index-info"], Some(&info), &env)?.into_result()?;
            if !rel.is_empty() {
                self.git_paths_env(&["add", "-A"], rel, &env)?;
            }
            std::fs::write(&msg_file, message)?;
            let msg_arg = format!("--file={}", msg_file.display());
            let mut args = vec!["commit", msg_arg.as_str(), "--cleanup=strip"];
            if amend {
                args.push("--amend");
            }
            self.git_env(&args, None, &env)
        })();
        let _ = std::fs::remove_file(&tmp);
        let _ = std::fs::remove_file(&msg_file);
        let output = result?;
        let oid = if output.success {
            if !rel.is_empty() {
                self.git_paths(&["add", "-A"], rel)?;
            }
            self.open()?.head().ok().and_then(|h| h.target())
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
