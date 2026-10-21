//! Git status refresh, IDEA's model (`docs/tasks/066-rca-slow-git-status-mono.md`).
//!
//! - A full status (`ide_git::Repo::status`) runs at startup, on Refresh and after Unstash. On
//!   a 480k-file monorepo it takes 12-15 s, almost all of it the untracked walk.
//! - Operations that move HEAD or the index (checkout, pull, merge, rebase, stash, reset,
//!   fetch) and HEAD or index changes outside the IDE run the incremental status (`changed`):
//!   `status_of` over the paths that differ between the old and the new HEAD, the staged and
//!   conflicted paths, and the rows shown now (about 0.5 s there). Plain file edits are the
//!   watcher's part. Above `MAX_CHANGED` paths it walks the whole tree instead.
//! - Our own writes (stage, unstage, commit, rollback, delete) and watcher batches refresh only
//!   their paths (`status_of`, about 0.1 s there) and merge the rows into the current status.
//! - A `.git` change that the watcher reports is compared with the `GitStamp` taken after our
//!   last write or at the start of the last full status. An equal stamp (our own write, or a
//!   shell prompt's stat-only index rewrite) runs no status at all.
//! - A newer full status cancels the running one (the CLI run is killed), so nobody waits for
//!   a stale result and no second full status queues behind the first.
//! - Every pass over the rows on the UI thread is linear: a path is matched against a set of
//!   paths by walking its ancestors (`under`), never by comparing with each path of the set. The
//!   rename partners and the coarsening run on the worker (task 122: an O(rows x paths) loop
//!   froze the UI for minutes).

use std::borrow::Borrow;
use std::collections::HashSet;
use std::hash::Hash;
use std::path::{Path, PathBuf};
use std::time::Instant;

use ide_git::{ChangeKind, FileChange, GitStamp, Repo};

use crate::jobs::Cancel;
use crate::state::AppState;

/// Above this many dirty paths, paths are cut back to their parent directories.
const MAX_PATHS: usize = 500;

/// Above this many paths the incremental status walks the whole tree instead. `git status`
/// with file pathspecs costs about 4 ms per path on a 500k-entry index (each index entry is
/// matched against every pathspec), so 400 paths stay near 1.5 s against 12 s for a walk.
const MAX_CHANGED: usize = 400;

/// Above this many waiting paths the whole tree is dirty (`Dirty`). The paths would be cut back
/// to `MAX_PATHS` folders anyway, and such a burst touches most of the tree.
pub const MAX_PENDING: usize = 10_000;

/// Paths that wait for a status. It holds at most `MAX_PENDING` paths; one more turns it into
/// "the whole tree", so a huge watcher burst never becomes a huge set.
#[derive(Default, Debug)]
pub struct Dirty {
    paths: HashSet<PathBuf>,
    all: bool,
}

impl Dirty {
    pub fn add(&mut self, paths: impl IntoIterator<Item = PathBuf>) {
        if self.all {
            return;
        }
        for p in paths {
            self.paths.insert(p);
            if self.paths.len() > MAX_PENDING {
                self.set_all();
                return;
            }
        }
    }

    fn set_all(&mut self) {
        self.paths = HashSet::new();
        self.all = true;
    }

    fn absorb(&mut self, other: Dirty) {
        if other.all {
            self.set_all();
        } else {
            self.add(other.paths);
        }
    }

    pub fn is_empty(&self) -> bool {
        !self.all && self.paths.is_empty()
    }

    /// The whole tree is dirty.
    pub fn is_all(&self) -> bool {
        self.all
    }

    /// The paths held (0 when the whole tree is dirty).
    pub fn len(&self) -> usize {
        self.paths.len()
    }

    fn take(&mut self) -> Dirty {
        std::mem::take(self)
    }
}

/// `p` is one of `set` or lies under one of them. Walks the ancestors of `p`, so the cost does
/// not grow with the set. A relative path's last ancestor is the empty path, which is the
/// whole tree, like `Path::starts_with("")`.
pub fn under<S: Borrow<Path> + Hash + Eq>(p: &Path, set: &HashSet<S>) -> bool {
    p.ancestors().any(|a| set.contains(a))
}

/// What a git write refreshes when it is done.
#[derive(Debug, Clone)]
pub enum Refresh {
    /// The whole status: the write may have changed any path, also outside HEAD and the
    /// index (Unstash writes stashed edits into the worktree).
    Full,
    /// The paths that differ between the old and the new HEAD, the staged and conflicted
    /// paths, and the rows shown now (`changed`). For writes that change the worktree only
    /// through HEAD and the index: checkout, merge, rebase, pull, reset, stash, fetch.
    Changed,
    /// Only these paths (absolute or workdir-relative) plus HEAD and the branch.
    Paths(Vec<PathBuf>),
}

/// Refresh bookkeeping of one workspace (`GitInfo::refresh`).
#[derive(Default)]
pub struct RefreshState {
    /// Bumped by every full status start. A result with an older number is dropped.
    full_seq: u64,
    /// The running full or incremental status, to cancel when a newer one starts.
    full: Option<Cancel>,
    /// The running one walks the whole tree. Its stamp is recorded before the walk ends, so
    /// an incremental status must not start from that stamp.
    walking: bool,
    /// The running full status has not reported its stamp yet.
    full_stamp_pending: bool,
    /// Paths refreshed or changed while a full status ran. The full status may have read them
    /// before the change, so they are refreshed again after it lands.
    dirty_since_full: Dirty,
    /// Only one path refresh runs at a time; paths that arrive meanwhile wait in `pending`.
    paths_running: bool,
    /// The running path refresh follows our own write: it records the stamp.
    paths_running_own: bool,
    pending: Dirty,
    pending_own: bool,
    /// Our git writes that have not finished yet. A `.git` change seen meanwhile is ours.
    own_writes: u32,
    /// The watcher saw a `.git` change that is not compared with the stamp yet.
    check_pending: bool,
    checking: bool,
    /// The index and HEAD that the current status reflects.
    stamp: Option<GitStamp>,
    /// Started runs, for tests and the timings log. `full_runs` counts whole-tree walks, also
    /// an incremental status that had too many paths (counted when it ends).
    pub full_runs: u64,
    pub changed_runs: u64,
    pub path_runs: u64,
    pub light_runs: u64,
}

impl RefreshState {
    /// The paths that wait for the next path refresh.
    pub fn pending(&self) -> &Dirty {
        &self.pending
    }

    /// Some refresh is running or waiting to run.
    pub fn busy(&self) -> bool {
        self.full.is_some() || self.paths_running || self.checking || !self.pending.is_empty() || self.pending_own || self.check_pending
    }
}

fn repo_of(state: &AppState) -> Option<Repo> {
    state.ws.git.repo.clone()
}

/// The full status. Cancels a running full status: its result could be older than the index.
pub fn full(state: &mut AppState) {
    for (_, e) in state.ws.tabs.editors_mut() {
        e.invalidate_marks();
    }
    let Some(repo) = repo_of(state) else { return };
    let r = &mut state.ws.git.refresh;
    if let Some(old) = r.full.take() {
        old.cancel_quietly();
    }
    // A pending path refresh is covered by this one, except for changes during it. A whole
    // dirty tree is covered: this walk starts after those changes.
    let pending = r.pending.take();
    if !pending.all {
        r.dirty_since_full.add(pending.paths);
    }
    r.full_seq += 1;
    r.full_runs += 1;
    r.full_stamp_pending = true;
    r.walking = true;
    let seq = r.full_seq;
    let prev = r.stamp.clone();
    let generation = state.project_generation();
    let started = Instant::now();
    let jobs = state.jobs.clone();
    let cancel = state.jobs.spawn_cancellable(
        "Refreshing git status",
        move || {
            // Taken before the walk: a later index change then differs from it.
            let stamp = repo.stamp(prev.as_ref()).ok();
            jobs.post(move |state| {
                if state.project_generation() != generation || state.ws.git.refresh.full_seq != seq {
                    return;
                }
                let r = &mut state.ws.git.refresh;
                r.full_stamp_pending = false;
                if stamp.is_some() {
                    r.stamp = stamp;
                }
                maybe_check(state);
            });
            let status = repo.status();
            let branches = repo.branches();
            (status, branches, started.elapsed())
        },
        move |state, (status, branches, took)| {
            if state.project_generation() != generation || state.ws.git.refresh.full_seq != seq {
                return;
            }
            let r = &mut state.ws.git.refresh;
            r.full = None;
            r.walking = false;
            r.full_stamp_pending = false;
            let ms = took.as_secs_f64() * 1000.0;
            state.timings.log(format!("git status + branch in {ms:.1} ms"));
            state.ws.git.status_ms = Some(ms);
            match status {
                Ok(changes) => state.apply_status(changes),
                // The stamp was recorded before the walk, but the rows are older: an
                // incremental status must not start from it.
                Err(e) if e.is_cancelled() => state.ws.git.refresh.stamp = None,
                Err(e) => state.notifications.log_only(crate::notifications::Level::Warning, "git status failed", e.to_string()),
            }
            if let Ok(b) = branches {
                apply_branches(state, &b);
            }
            crate::git::on_git_refreshed(state);
            refresh_again(state);
            maybe_check(state);
        },
    );
    state.ws.git.refresh.full = Some(cancel);
}

/// What an incremental status read.
enum Walk {
    /// `status_of` over these paths.
    Paths(Vec<PathBuf>, ide_git::Result<Vec<FileChange>>),
    /// Too many paths: the whole status.
    Full(ide_git::Result<Vec<FileChange>>),
}

/// The incremental status after a HEAD or index change. Cancels a running one. While a full
/// status walks, or before any status landed, it runs a full status instead.
pub fn changed(state: &mut AppState) {
    changed_with(state, None);
}

/// `changed` with the stamp the caller just took, so a big index is not read twice.
fn changed_with(state: &mut AppState, fresh: Option<GitStamp>) {
    let r = &state.ws.git.refresh;
    let Some(prev) = r.stamp.clone().filter(|_| !r.walking) else {
        full(state);
        return;
    };
    for (_, e) in state.ws.tabs.editors_mut() {
        e.invalidate_marks();
    }
    let Some(repo) = repo_of(state) else { return };
    let mut known: Vec<PathBuf> = Vec::new();
    for c in &state.ws.git.changes {
        known.push(c.path.clone());
        known.extend(c.old_path.clone());
    }
    let r = &mut state.ws.git.refresh;
    if let Some(old) = r.full.take() {
        old.cancel_quietly();
    }
    let pending = r.pending.take();
    r.dirty_since_full.absorb(pending);
    r.full_seq += 1;
    r.changed_runs += 1;
    // The stamp is recorded only with the rows: a newer run that cancels this one must start
    // from the HEAD that the shown rows reflect.
    r.full_stamp_pending = true;
    let seq = r.full_seq;
    let generation = state.project_generation();
    let started = Instant::now();
    let cancel = state.jobs.spawn_cancellable(
        "Refreshing git status",
        move || {
            // Reading a big index for the stamp (0.7 s on a 112 MB index) runs beside the git
            // calls. Only this thread sees the job's cancel flag, and the stamp needs none.
            let since = prev.head_oid();
            std::thread::scope(|scope| {
                let stamp = scope.spawn(|| fresh.or_else(|| repo.stamp(Some(&prev)).ok()));
                let walk = changed_walk(&repo, since, known);
                let branches = repo.branches();
                (stamp.join().ok().flatten(), walk, branches, started.elapsed())
            })
        },
        move |state, (stamp, walk, branches, took)| {
            if state.project_generation() != generation || state.ws.git.refresh.full_seq != seq {
                return;
            }
            let r = &mut state.ws.git.refresh;
            r.full = None;
            r.full_stamp_pending = false;
            if stamp.is_some() {
                r.stamp = stamp;
            }
            let ms = took.as_secs_f64() * 1000.0;
            state.ws.git.status_ms = Some(ms);
            let status = match walk {
                Walk::Paths(set, rows) => {
                    state.timings.log(format!("git status of {} changed paths + branch in {ms:.1} ms", set.len()));
                    rows.map(|rows| {
                        let specs: HashSet<PathBuf> = set.into_iter().collect();
                        merge(&state.ws.git.changes, &specs, rows)
                    })
                }
                Walk::Full(rows) => {
                    state.ws.git.refresh.full_runs += 1;
                    state.timings.log(format!("git status + branch in {ms:.1} ms (too many changed paths)"));
                    rows
                }
            };
            match status {
                Ok(changes) => state.apply_status(changes),
                Err(e) if e.is_cancelled() => {}
                Err(e) => state.notifications.log_only(crate::notifications::Level::Warning, "git status failed", e.to_string()),
            }
            if let Ok(b) = branches {
                apply_branches(state, &b);
            }
            crate::git::on_git_refreshed(state);
            refresh_again(state);
            maybe_check(state);
        },
    );
    state.ws.git.refresh.full = Some(cancel);
}

/// Refreshes what changed while a full or incremental status ran.
fn refresh_again(state: &mut AppState) {
    let again = state.ws.git.refresh.dirty_since_full.take();
    if again.all {
        full(state);
    } else if !again.paths.is_empty() {
        paths(state, again.paths.into_iter().collect(), false);
    }
}

/// `status_of` over the paths that HEAD and the index changed since `since` plus `known`, or
/// the whole status when there are too many.
fn changed_walk(repo: &Repo, since: Option<ide_git::Oid>, known: Vec<PathBuf>) -> Walk {
    match repo.changed_paths(since, MAX_CHANGED) {
        Ok(Some(mut set)) => {
            set.extend(known);
            set.sort();
            set.dedup();
            if set.len() > MAX_CHANGED {
                Walk::Full(repo.status())
            } else if set.is_empty() {
                Walk::Paths(set, Ok(Vec::new()))
            } else {
                let rows = repo.status_of(&set);
                Walk::Paths(set, rows)
            }
        }
        Err(e) if e.is_cancelled() => Walk::Full(Err(e)),
        Ok(None) | Err(_) => Walk::Full(repo.status()),
    }
}

/// Refreshes `changed` (absolute or workdir-relative paths) and merges the rows into the
/// status. `own` marks the refresh after our own write: it also reads HEAD and the branch and
/// records the stamp, so the watcher's `.git` event for that write runs nothing.
pub fn paths(state: &mut AppState, changed: Vec<PathBuf>, own: bool) {
    let Some(repo) = repo_of(state) else { return };
    let workdir = repo.workdir().to_path_buf();
    // Borrowed: a burst above the cap copies only the paths that `Dirty` keeps.
    let rel: Vec<&Path> = changed.iter().filter_map(|p| to_rel(&workdir, p)).collect();
    if rel.is_empty() && !own {
        return;
    }
    // A burst above `MAX_PENDING` makes the whole tree dirty: every editor is invalidated
    // without building a set of the paths.
    let every = rel.len() > MAX_PENDING;
    let set: HashSet<&Path> = if every { HashSet::new() } else { rel.iter().copied().collect() };
    for (_, e) in state.ws.tabs.editors_mut() {
        if e.path.strip_prefix(&workdir).is_ok_and(|p| every || under(p, &set)) {
            e.invalidate_marks();
        }
    }
    let r = &mut state.ws.git.refresh;
    if r.full.is_some() {
        r.dirty_since_full.add(rel.iter().map(|p| p.to_path_buf()));
    }
    r.pending.add(rel.iter().map(|p| p.to_path_buf()));
    r.pending_own |= own;
    if !r.paths_running {
        start_paths(state);
    }
}

fn to_rel<'a>(workdir: &Path, p: &'a Path) -> Option<&'a Path> {
    if p.is_relative() {
        return Some(p);
    }
    let rel = p.strip_prefix(workdir).ok()?;
    // `.git` itself is never a status path; the watcher reports it through `git_changed`.
    if rel.as_os_str().is_empty() || rel.starts_with(".git") {
        return None;
    }
    Some(rel)
}

fn start_paths(state: &mut AppState) {
    let Some(repo) = repo_of(state) else { return };
    let r = &mut state.ws.git.refresh;
    if r.pending.all {
        r.pending = Dirty::default();
        r.pending_own = false;
        if r.full.is_some() {
            // The running status walks the whole tree again when it lands; restarting it now
            // would let a stream of bursts cancel every walk.
            r.dirty_since_full.set_all();
        } else {
            state.timings.log(format!("git status: more than {MAX_PENDING} changed paths, walking the whole tree"));
            full(state);
        }
        return;
    }
    let own = std::mem::take(&mut r.pending_own);
    let set: HashSet<PathBuf> = std::mem::take(&mut r.pending.paths);
    if set.is_empty() && !own {
        return;
    }
    // A staged rename shows only when both of its sides are in the pathspec. A path of a known
    // rename brings its partner; our own writes (which may create a rename) bring every staged
    // addition and deletion. Only those rows go to the worker, which matches them.
    let partners: Vec<FileChange> = state.ws.git.changes.iter().filter(|c| c.old_path.is_some() || (own && staged_add_or_delete(c))).cloned().collect();
    let r = &mut state.ws.git.refresh;
    r.paths_running = true;
    r.paths_running_own = own;
    r.path_runs += 1;
    let prev = r.stamp.clone();
    let generation = state.project_generation();
    let started = Instant::now();
    let jobs = state.jobs.clone();
    state.jobs.spawn_quiet(
        move || {
            // `None`: too many paths, only the whole tree will do.
            let spec_list: Vec<PathBuf> = coarsen(with_partners(set, &partners, own), MAX_PATHS)?.into_iter().collect();
            let status = if spec_list.is_empty() { Ok(Vec::new()) } else { repo.status_of(&spec_list) };
            let took = started.elapsed();
            // The rows go to the UI first: the stamp below may read a big index (0.5 s).
            jobs.post(move |state| {
                if state.project_generation() != generation {
                    return;
                }
                let n = spec_list.len();
                state.timings.log(format!("git status of {n} paths{} in {:.1} ms", if own { " after a write" } else { "" }, took.as_secs_f64() * 1000.0));
                match status {
                    Ok(rows) => {
                        let specs: HashSet<PathBuf> = spec_list.into_iter().collect();
                        let merged = merge(&state.ws.git.changes, &specs, rows);
                        state.apply_status(merged);
                    }
                    Err(e) if e.is_cancelled() => {}
                    Err(e) => state.notifications.log_only(crate::notifications::Level::Warning, "git status failed", e.to_string()),
                }
                crate::git::on_git_refreshed(state);
            });
            let branches = if own { repo.branches().ok() } else { None };
            let stamp = if own { repo.stamp(prev.as_ref()).ok() } else { None };
            Some((stamp, branches))
        },
        move |state, done| {
            if state.project_generation() != generation {
                return;
            }
            let r = &mut state.ws.git.refresh;
            r.paths_running = false;
            r.paths_running_own = false;
            match done {
                // Too many paths everywhere: the whole tree is dirty.
                None => full(state),
                Some((stamp, branches)) => {
                    if stamp.is_some() {
                        r.stamp = stamp;
                    }
                    if let Some(b) = branches {
                        apply_branches(state, &b);
                        crate::git::on_git_refreshed(state);
                    }
                }
            }
            let r = &state.ws.git.refresh;
            if !r.pending.is_empty() || r.pending_own {
                start_paths(state);
            }
            maybe_check(state);
        },
    );
}

fn staged_add_or_delete(c: &FileChange) -> bool {
    matches!(c.staged, Some(ChangeKind::Added | ChangeKind::Deleted | ChangeKind::Renamed))
}

/// `set` plus the partners of the renames in `rows` that have a side under a path of `set`;
/// with `own` also every staged addition, deletion and rename. Linear in `set` and `rows`.
pub fn with_partners(mut set: HashSet<PathBuf>, rows: &[FileChange], own: bool) -> HashSet<PathBuf> {
    let mut add: Vec<PathBuf> = Vec::new();
    for c in rows {
        let touched = || under(&c.path, &set) || c.old_path.as_deref().is_some_and(|o| under(o, &set));
        if (own && staged_add_or_delete(c)) || (c.old_path.is_some() && touched()) {
            add.push(c.path.clone());
            add.extend(c.old_path.clone());
        }
    }
    set.extend(add);
    set
}

/// Replaces the rows under `specs` with `rows`. A rename row goes when either side is under a
/// spec: `rows` holds the rename again if both sides are still renamed.
pub fn merge(current: &[FileChange], specs: &HashSet<PathBuf>, rows: Vec<FileChange>) -> Vec<FileChange> {
    let gone = |p: &Path| under(p, specs);
    let mut out: Vec<FileChange> = current.iter().filter(|c| !gone(&c.path) && !c.old_path.as_deref().is_some_and(gone)).cloned().collect();
    out.extend(rows);
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out.dedup_by(|a, b| a.path == b.path);
    out
}

/// Cuts the deepest paths back to their parents until at most `limit` remain, and drops
/// paths under another path of the set. `None` when only the whole tree would do.
///
/// Sorts once: cutting every path to the same depth keeps the order, so each depth costs one
/// linear pass.
pub fn coarsen(set: HashSet<PathBuf>, limit: usize) -> Option<HashSet<PathBuf>> {
    let mut sorted: Vec<PathBuf> = set.into_iter().collect();
    sorted.sort_unstable();
    let mut kept = outermost(sorted);
    let deepest = kept.iter().map(|p| p.components().count()).max().unwrap_or(0);
    let mut depth = deepest;
    loop {
        if kept.len() <= limit {
            return Some(kept.into_iter().collect());
        }
        if depth <= 1 {
            return None;
        }
        depth -= 1;
        kept = outermost(kept.into_iter().map(|p| if p.components().count() > depth { p.components().take(depth).collect() } else { p }));
    }
}

/// Sorted paths without the ones under another of them (they follow their ancestor).
fn outermost(sorted: impl IntoIterator<Item = PathBuf>) -> Vec<PathBuf> {
    let mut kept: Vec<PathBuf> = Vec::new();
    for p in sorted {
        if kept.last().is_some_and(|k| p.starts_with(k)) {
            continue;
        }
        kept.push(p);
    }
    kept
}

/// A git write of ours starts. Call `write_done` when it ends, also on failure.
pub fn write_started(state: &mut AppState) {
    state.ws.git.refresh.own_writes += 1;
}

pub fn write_done(state: &mut AppState, refresh: Refresh) {
    let r = &mut state.ws.git.refresh;
    r.own_writes = r.own_writes.saturating_sub(1);
    match refresh {
        Refresh::Full => full(state),
        Refresh::Changed => changed(state),
        Refresh::Paths(p) => paths(state, p, true),
    }
    maybe_check(state);
}

/// The watcher saw HEAD, the index or a ref change.
pub fn git_dir_changed(state: &mut AppState) {
    if state.ws.git.repo.is_none() {
        return;
    }
    state.ws.git.refresh.check_pending = true;
    maybe_check(state);
}

/// Compares the stamp with the one the status reflects, once our writes and their refreshes
/// are done (their stamp is the reference). A different stamp runs one incremental status
/// (`changed`); an equal one only re-reads the branches (a fetch or a new branch in the
/// terminal).
fn maybe_check(state: &mut AppState) {
    let r = &state.ws.git.refresh;
    if !r.check_pending || r.checking || r.own_writes > 0 || r.paths_running_own || r.pending_own || r.full_stamp_pending {
        return;
    }
    let Some(repo) = repo_of(state) else { return };
    let r = &mut state.ws.git.refresh;
    r.check_pending = false;
    r.checking = true;
    let prev = r.stamp.clone();
    let generation = state.project_generation();
    state.jobs.spawn_quiet(
        move || repo.stamp(prev.as_ref()).ok(),
        move |state, stamp| {
            if state.project_generation() != generation {
                return;
            }
            let r = &mut state.ws.git.refresh;
            r.checking = false;
            let same = stamp.is_some() && stamp == r.stamp;
            if same {
                // Same content; keep the newer file stat so the next check skips the read.
                r.stamp = stamp;
                light(state);
            } else {
                changed_with(state, stamp);
            }
            maybe_check(state);
        },
    );
}

/// Branches only, for ref changes that leave the status alone.
fn light(state: &mut AppState) {
    let Some(repo) = repo_of(state) else { return };
    state.ws.git.refresh.light_runs += 1;
    let generation = state.project_generation();
    state.jobs.spawn_quiet(
        move || repo.branches().ok(),
        move |state, b| {
            if state.project_generation() != generation {
                return;
            }
            if let Some(b) = b {
                apply_branches(state, &b);
            }
            crate::git::on_git_refreshed(state);
        },
    );
}

fn apply_branches(state: &mut AppState, b: &ide_git::Branches) {
    state.ws.git.detached = b.detached;
    state.ws.git.branch = match (&b.current, b.head) {
        (Some(name), _) if !b.detached => Some(name.clone()),
        (_, Some(oid)) => Some(oid.to_string()[..8].to_string()),
        (name, None) => name.clone(),
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(paths: &[&str]) -> HashSet<PathBuf> {
        paths.iter().map(PathBuf::from).collect()
    }

    fn change(path: &str, old: Option<&str>, staged: Option<ChangeKind>, unstaged: Option<ChangeKind>) -> FileChange {
        FileChange { path: path.into(), old_path: old.map(PathBuf::from), staged, unstaged }
    }

    #[test]
    fn coarsen_cuts_the_deepest_paths_first() {
        assert_eq!(coarsen(set(&["a/b/c", "a/b", "x"]), 10), Some(set(&["a/b", "x"])));
        assert_eq!(coarsen(set(&["a/b/c", "a/b/d", "a/e", "x/y"]), 3), Some(set(&["a/b", "a/e", "x/y"])));
        assert_eq!(coarsen(set(&["a/b/c", "a/b/d", "a/e", "x/y"]), 2), Some(set(&["a", "x"])));
        assert_eq!(coarsen(set(&["a", "b", "c"]), 2), None);
    }

    #[test]
    fn merge_replaces_rows_under_the_specs() {
        use ChangeKind::*;
        let current = vec![
            change("a.txt", None, None, Some(Modified)),
            change("dir/x.txt", None, Some(Added), None),
            change("new.txt", Some("old.txt"), Some(Renamed), None),
            change("z.txt", None, None, Some(Untracked)),
        ];
        let rows = vec![change("dir/y.txt", None, None, Some(Untracked)), change("old.txt", None, Some(Deleted), None)];
        let merged = merge(&current, &set(&["dir", "old.txt"]), rows);
        let paths: Vec<&str> = merged.iter().map(|c| c.path.to_str().unwrap()).collect();
        assert_eq!(paths, ["a.txt", "dir/y.txt", "old.txt", "z.txt"]);
    }

    #[test]
    fn under_matches_the_path_and_its_folders_only() {
        let specs = set(&["src/app.ts", "docs"]);
        assert!(under(Path::new("src/app.ts"), &specs));
        assert!(under(Path::new("docs/a/b.md"), &specs));
        assert!(under(Path::new("docs"), &specs));
        assert!(!under(Path::new("src"), &specs), "a folder above a spec is not under it");
        assert!(!under(Path::new("docsx/a.md"), &specs), "a name that only starts with a spec");
        assert!(!under(Path::new("src/app.tsx"), &specs));
        assert!(under(Path::new("any/thing"), &set(&[""])), "the empty path is the whole tree");
    }

    #[test]
    fn with_partners_brings_the_other_side_of_a_touched_rename() {
        use ChangeKind::*;
        let rows = vec![
            change("lib/new.ts", Some("src/old.ts"), Some(Renamed), None),
            change("b/new.ts", Some("a/old.ts"), Some(Renamed), None),
            change("x/added.ts", None, Some(Added), None),
        ];
        // The old side's folder is pending: the new side comes along.
        let got = with_partners(set(&["src"]), &rows, false);
        assert_eq!(got, set(&["src", "src/old.ts", "lib/new.ts"]));
        // The new side itself is pending: the old side comes along.
        let got = with_partners(set(&["b/new.ts"]), &rows, false);
        assert_eq!(got, set(&["b/new.ts", "a/old.ts"]));
        // An untouched rename stays out; a plain addition never comes along without a write.
        assert_eq!(with_partners(set(&["c"]), &rows, false), set(&["c"]));
        // Our own write brings every staged addition, deletion and rename.
        let got = with_partners(set(&["c"]), &rows, true);
        assert_eq!(got, set(&["c", "lib/new.ts", "src/old.ts", "b/new.ts", "a/old.ts", "x/added.ts"]));
    }

    #[test]
    fn dirty_turns_into_the_whole_tree_above_the_cap() {
        let mut d = Dirty::default();
        d.add((0..MAX_PENDING).map(|i| PathBuf::from(format!("f{i}"))));
        assert!(!d.is_all());
        assert_eq!(d.len(), MAX_PENDING);
        d.add([PathBuf::from("one-more")]);
        assert!(d.is_all());
        assert_eq!(d.len(), 0, "the paths are dropped, not kept beside the flag");
        assert!(!d.is_empty());
        let mut into = Dirty::default();
        into.absorb(d.take());
        assert!(into.is_all());
        assert!(d.is_empty());
    }

    /// 100k pending paths against 10k rows. The old pass compared every row with every path
    /// (10^9 `starts_with` calls, minutes on the UI thread in the task 122 freeze). It runs on
    /// the worker now, and it is linear.
    #[test]
    fn partners_and_coarsen_are_linear() {
        use ChangeKind::*;
        let pending: HashSet<PathBuf> = (0..100_000).map(|i| PathBuf::from(format!("pkg{}/src/dir{}/file{i}.ts", i % 50, i % 700))).collect();
        let rows: Vec<FileChange> = (0..10_000)
            .map(|i| {
                let path = format!("pkg{}/src/dir{}/moved{i}.ts", i % 50, i % 700);
                if i % 5 == 0 {
                    change(&path, Some(&format!("pkg{}/src/dir{}/file{i}.ts", i % 50, i % 700)), Some(Renamed), None)
                } else {
                    change(&path, None, None, Some(Modified))
                }
            })
            .collect();
        let started = Instant::now();
        let with = with_partners(pending, &rows, false);
        let partners = started.elapsed();
        assert_eq!(with.len(), 100_000 + 2_000, "each touched rename brings its new side");
        let specs = coarsen(with, MAX_PATHS).expect("folders fit");
        let took = started.elapsed();
        assert!(specs.len() <= MAX_PATHS);
        eprintln!("partners of 10k rows against 100k paths: {partners:?}; with coarsen: {took:?}");
        assert!(took < std::time::Duration::from_secs(2), "partners + coarsen took {took:?}");
    }
}
