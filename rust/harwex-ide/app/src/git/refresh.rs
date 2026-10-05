//! Git status refresh, IDEA's model (`docs/tasks/066-rca-slow-git-status-mono.md`).
//!
//! - A full status (`ide_git::Repo::status`) runs at startup, on Refresh, after operations that
//!   may change many paths (checkout, pull, merge, rebase, stash, reset), and when the index or
//!   HEAD changed outside the IDE. On a 480k-file monorepo it takes 15 s.
//! - Our own writes (stage, unstage, commit, rollback, delete) and watcher batches refresh only
//!   their paths (`status_of`, about 0.1 s there) and merge the rows into the current status.
//! - A `.git` change that the watcher reports is compared with the `GitStamp` taken after our
//!   last write or at the start of the last full status. An equal stamp (our own write, or a
//!   shell prompt's stat-only index rewrite) runs no status at all.
//! - A newer full status cancels the running one (the CLI run is killed), so nobody waits for
//!   a stale result and no second full status queues behind the first.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Instant;

use ide_git::{ChangeKind, FileChange, GitStamp, Repo};

use crate::jobs::Cancel;
use crate::state::AppState;

/// Above this many dirty paths, paths are cut back to their parent directories.
const MAX_PATHS: usize = 500;

/// What a git write refreshes when it is done.
#[derive(Debug, Clone)]
pub enum Refresh {
    /// The whole status: the write may have changed any path.
    Full,
    /// Only these paths (absolute or workdir-relative) plus HEAD and the branch.
    Paths(Vec<PathBuf>),
}

/// Refresh bookkeeping of one workspace (`GitInfo::refresh`).
#[derive(Default)]
pub struct RefreshState {
    /// Bumped by every full status start. A result with an older number is dropped.
    full_seq: u64,
    /// The running full status, to cancel when a newer one starts.
    full: Option<Cancel>,
    /// The running full status has not reported its stamp yet.
    full_stamp_pending: bool,
    /// Paths refreshed or changed while a full status ran. The full status may have read them
    /// before the change, so they are refreshed again after it lands.
    dirty_since_full: HashSet<PathBuf>,
    /// Only one path refresh runs at a time; paths that arrive meanwhile wait in `pending`.
    paths_running: bool,
    /// The running path refresh follows our own write: it records the stamp.
    paths_running_own: bool,
    pending: HashSet<PathBuf>,
    pending_own: bool,
    /// Our git writes that have not finished yet. A `.git` change seen meanwhile is ours.
    own_writes: u32,
    /// The watcher saw a `.git` change that is not compared with the stamp yet.
    check_pending: bool,
    checking: bool,
    /// The index and HEAD that the current status reflects.
    stamp: Option<GitStamp>,
    /// Started runs, for tests and the timings log.
    pub full_runs: u64,
    pub path_runs: u64,
    pub light_runs: u64,
}

impl RefreshState {
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
    // A pending path refresh is covered by this one, except for changes during it.
    r.dirty_since_full.extend(r.pending.drain());
    r.full_seq += 1;
    r.full_runs += 1;
    r.full_stamp_pending = true;
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
            r.full_stamp_pending = false;
            let ms = took.as_secs_f64() * 1000.0;
            state.timings.log(format!("git status + branch in {ms:.1} ms"));
            state.ws.git.status_ms = Some(ms);
            match status {
                Ok(changes) => state.apply_status(changes),
                Err(e) if e.is_cancelled() => {}
                Err(e) => state.notifications.log_only(crate::notifications::Level::Warning, "git status failed", e.to_string()),
            }
            if let Ok(b) = branches {
                apply_branches(state, &b);
            }
            crate::git::on_git_refreshed(state);
            let again: Vec<PathBuf> = state.ws.git.refresh.dirty_since_full.drain().collect();
            if !again.is_empty() {
                paths(state, again, false);
            }
            maybe_check(state);
        },
    );
    state.ws.git.refresh.full = Some(cancel);
}

/// Refreshes `changed` (absolute or workdir-relative paths) and merges the rows into the
/// status. `own` marks the refresh after our own write: it also reads HEAD and the branch and
/// records the stamp, so the watcher's `.git` event for that write runs nothing.
pub fn paths(state: &mut AppState, changed: Vec<PathBuf>, own: bool) {
    let Some(repo) = repo_of(state) else { return };
    let workdir = repo.workdir().to_path_buf();
    let rel: Vec<PathBuf> = changed.iter().filter_map(|p| to_rel(&workdir, p)).collect();
    if rel.is_empty() && !own {
        return;
    }
    for (_, e) in state.ws.tabs.editors_mut() {
        if rel.iter().any(|r| e.path.starts_with(workdir.join(r))) {
            e.invalidate_marks();
        }
    }
    let r = &mut state.ws.git.refresh;
    if r.full.is_some() {
        r.dirty_since_full.extend(rel.iter().cloned());
    }
    r.pending.extend(rel);
    r.pending_own |= own;
    if !r.paths_running {
        start_paths(state);
    }
}

fn to_rel(workdir: &Path, p: &Path) -> Option<PathBuf> {
    if p.is_relative() {
        return Some(p.to_path_buf());
    }
    let rel = p.strip_prefix(workdir).ok()?;
    // `.git` itself is never a status path; the watcher reports it through `git_changed`.
    if rel.as_os_str().is_empty() || rel.starts_with(".git") {
        return None;
    }
    Some(rel.to_path_buf())
}

fn start_paths(state: &mut AppState) {
    let Some(repo) = repo_of(state) else { return };
    let r = &mut state.ws.git.refresh;
    let own = std::mem::take(&mut r.pending_own);
    let mut set: HashSet<PathBuf> = r.pending.drain().collect();
    if set.is_empty() && !own {
        return;
    }
    // A staged rename shows only when both of its sides are in the pathspec. A path of a known
    // rename brings its partner; our own writes (which may create a rename) bring every staged
    // addition and deletion.
    let changes = &state.ws.git.changes;
    for c in changes {
        let staged_ad = matches!(c.staged, Some(ChangeKind::Added | ChangeKind::Deleted | ChangeKind::Renamed));
        let touched = set.iter().any(|p| c.path.starts_with(p) || c.old_path.as_ref().is_some_and(|o| o.starts_with(p)));
        if (own && staged_ad) || (touched && c.old_path.is_some()) {
            set.insert(c.path.clone());
            if let Some(o) = &c.old_path {
                set.insert(o.clone());
            }
        }
    }
    let Some(specs) = coarsen(set, MAX_PATHS) else {
        // Too many paths everywhere: the whole tree is dirty.
        full(state);
        return;
    };
    let r = &mut state.ws.git.refresh;
    r.paths_running = true;
    r.paths_running_own = own;
    r.path_runs += 1;
    let prev = r.stamp.clone();
    let generation = state.project_generation();
    let spec_list: Vec<PathBuf> = specs.into_iter().collect();
    let started = Instant::now();
    let jobs = state.jobs.clone();
    state.jobs.spawn_quiet(
        move || {
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
            (stamp, branches)
        },
        move |state, (stamp, branches)| {
            if state.project_generation() != generation {
                return;
            }
            let r = &mut state.ws.git.refresh;
            r.paths_running = false;
            r.paths_running_own = false;
            if stamp.is_some() {
                r.stamp = stamp;
            }
            if let Some(b) = branches {
                apply_branches(state, &b);
                crate::git::on_git_refreshed(state);
            }
            let r = &state.ws.git.refresh;
            if !r.pending.is_empty() || r.pending_own {
                start_paths(state);
            }
            maybe_check(state);
        },
    );
}

/// Replaces the rows under `specs` with `rows`. A rename row goes when either side is under a
/// spec: `rows` holds the rename again if both sides are still renamed.
pub fn merge(current: &[FileChange], specs: &HashSet<PathBuf>, rows: Vec<FileChange>) -> Vec<FileChange> {
    let under = |p: &Path| specs.iter().any(|s| p.starts_with(s));
    let mut out: Vec<FileChange> = current.iter().filter(|c| !under(&c.path) && !c.old_path.as_deref().is_some_and(under)).cloned().collect();
    out.extend(rows);
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out.dedup_by(|a, b| a.path == b.path);
    out
}

/// Cuts the deepest paths back to their parents until at most `limit` remain, and drops
/// paths under another path of the set. `None` when only the whole tree would do.
pub fn coarsen(set: HashSet<PathBuf>, limit: usize) -> Option<HashSet<PathBuf>> {
    let mut set = set;
    loop {
        let mut sorted: Vec<PathBuf> = set.into_iter().collect();
        sorted.sort();
        let mut kept: Vec<PathBuf> = Vec::with_capacity(sorted.len());
        for p in sorted {
            if kept.last().is_some_and(|k| p.starts_with(k)) {
                continue;
            }
            kept.push(p);
        }
        if kept.len() <= limit {
            return Some(kept.into_iter().collect());
        }
        let deepest = kept.iter().map(|p| p.components().count()).max().unwrap_or(0);
        if deepest <= 1 {
            return None;
        }
        set = kept.into_iter().map(|p| if p.components().count() == deepest { p.parent().map(Path::to_path_buf).unwrap_or(p) } else { p }).collect();
    }
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
/// are done (their stamp is the reference). A different stamp runs one full status; an equal
/// one only re-reads the branches (a fetch or a new branch in the terminal).
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
                full(state);
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
}
