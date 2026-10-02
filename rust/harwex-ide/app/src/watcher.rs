//! File watching. `notify` events are collected on a thread and delivered to the UI as one batch
//! after 200 ms of quiet (or at most 1 s after the first event, so a long build cannot starve
//! the refresh).

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::time::{Duration, Instant};

use notify::{EventKind, RecursiveMode, Watcher as _};

use crate::jobs::Jobs;
use crate::state::AppState;

const QUIET: Duration = Duration::from_millis(200);
const MAX_DELAY: Duration = Duration::from_secs(1);

/// One debounced batch of changes.
#[derive(Default, Debug)]
pub struct FsBatch {
    /// Changed paths outside `.git`, minus dependency and build output directories.
    pub paths: HashSet<PathBuf>,
    /// Something was created, removed or renamed; the file index must be rebuilt.
    pub structure_changed: bool,
    /// HEAD, the index or a ref changed: branch and status must be refreshed.
    pub git_changed: bool,
}

/// Keeps the OS watcher alive; dropping it stops watching.
pub struct Watcher {
    _inner: notify::RecommendedWatcher,
}

/// Starts watching `root` recursively. Blocking (FSEvents setup), so call it on a worker.
pub fn start(root: &Path, jobs: Jobs, generation: u64) -> notify::Result<Watcher> {
    let (tx, rx) = channel::<notify::Event>();
    let mut inner = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            let _ = tx.send(ev);
        }
    })?;
    inner.watch(root, RecursiveMode::Recursive)?;
    let root = root.to_path_buf();
    std::thread::Builder::new()
        .name("fs-watch debounce".into())
        .spawn(move || loop {
            // Block until the first event; the loop ends when the watcher (sender) drops.
            let Ok(first) = rx.recv() else { return };
            let mut batch = FsBatch::default();
            add(&root, &mut batch, first);
            let started = Instant::now();
            loop {
                let left = MAX_DELAY.saturating_sub(started.elapsed());
                if left.is_zero() {
                    break;
                }
                match rx.recv_timeout(QUIET.min(left)) {
                    Ok(ev) => add(&root, &mut batch, ev),
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
            if batch.paths.is_empty() && !batch.git_changed {
                continue;
            }
            jobs.post(move |state: &mut AppState| {
                if state.project_generation() == generation {
                    state.on_fs_batch(batch);
                }
            });
        })
        .map_err(|e| notify::Error::generic(&e.to_string()))?;
    Ok(Watcher { _inner: inner })
}

fn add(root: &Path, batch: &mut FsBatch, ev: notify::Event) {
    if matches!(ev.kind, EventKind::Access(_)) {
        return;
    }
    let structural = matches!(ev.kind, EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(notify::event::ModifyKind::Name(_)) | EventKind::Any | EventKind::Other);
    for path in ev.paths {
        let Ok(rel) = path.strip_prefix(root) else { continue };
        let mut comps = rel.components().map(|c| c.as_os_str().to_string_lossy());
        let first = comps.next();
        if first.as_deref() == Some(".git") {
            // Only the files that change what the UI shows. Object writes are noise.
            let second = comps.next();
            if matches!(second.as_deref(), Some("HEAD" | "index" | "refs" | "MERGE_HEAD" | "REBASE_HEAD" | "packed-refs")) {
                batch.git_changed = true;
            }
            continue;
        }
        // Dependency and build trees change in bulk and are gitignored anyway. Any component
        // named like this is skipped, which is cheaper than asking the gitignore matcher.
        let noisy = rel.components().any(|c| {
            let s = c.as_os_str();
            s == "node_modules" || s == "target" || s == ".git" || s == ".yarn" || s == "dist"
        });
        if noisy {
            continue;
        }
        if structural {
            batch.structure_changed = true;
        }
        batch.paths.insert(path);
    }
}
