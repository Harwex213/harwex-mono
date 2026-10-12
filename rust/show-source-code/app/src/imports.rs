//! The tsserver pass: after the package graph is on screen, a worker resolves every
//! cross-package import to the file it lands in and streams the results into the scene.
//! Only imports whose specifier names a workspace package are resolved, which keeps the work
//! to a few hundred requests on a large repo. Results are cached by file size and mtime.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use scs_ts::cache::{self, ImportCache};

use crate::State;

#[derive(Debug, Clone, PartialEq)]
pub enum TsStatus {
    /// The scene is not loaded yet.
    Waiting,
    Off(String),
    Running { done: usize, total: usize },
    Done { imports: usize, files: usize },
    Failed(String),
}

/// Posting more often only costs UI frames; less often makes the arrows appear in lumps.
const BATCH_EVERY: Duration = Duration::from_millis(250);
/// Consecutive failed files before the pass gives up (a broken TypeScript install).
const MAX_FAILURES: usize = 3;

type Batch = Vec<(PathBuf, Vec<PathBuf>)>;

pub(crate) fn start(state: &mut State) {
    let Some(scene) = &state.scene else { return };
    let root = scene.root.clone();
    let names: HashSet<String> = scene.package_names.clone();
    let files: Vec<PathBuf> = {
        let mut f: Vec<(usize, usize, PathBuf)> = scene.file_index.iter().map(|(p, &(a, b))| (a, b, p.clone())).collect();
        // Package by package, so tsserver loads each project once.
        f.sort();
        f.into_iter().map(|(_, _, p)| p).collect()
    };
    let total = files.len();
    let use_cache = state.options.import_cache;
    let cancel = state.cancel.clone();
    state.ts = TsStatus::Running { done: 0, total };
    state.jobs.spawn(
        "tsserver imports",
        move |jobs| {
            let cache_path = cache::default_path(&root);
            let mut cache = if use_cache { ImportCache::load(&cache_path) } else { ImportCache::default() };
            let keep = |s: &str| scs_ts::package_of(s).is_some_and(|p| names.contains(p));
            let mut resolver: Option<scs_ts::Resolver> = None;
            let mut batch: Batch = Vec::new();
            let mut last_post = Instant::now();
            let mut found = 0;
            let mut failures = 0;
            let mut error = None;
            for (k, file) in files.iter().enumerate() {
                if cancel.load(Ordering::SeqCst) {
                    break;
                }
                let imports = match cache.get(file) {
                    Some(i) => i,
                    None => {
                        // Files without a workspace import never start tsserver.
                        let text = std::fs::read_to_string(file).unwrap_or_default();
                        if !scs_ts::scan_imports(&text).iter().any(|s| keep(&s.text)) {
                            cache.put(file, &[]);
                            Vec::new()
                        } else {
                            if resolver.is_none() {
                                match scs_ts::Resolver::start(&root) {
                                    Ok(r) => resolver = Some(r),
                                    Err(e) => {
                                        error = Some(e.to_string());
                                        break;
                                    }
                                }
                            }
                            match resolver.as_mut().map(|r| r.resolve_file(file, &keep)) {
                                Some(Ok(i)) => {
                                    failures = 0;
                                    cache.put(file, &i);
                                    i
                                }
                                Some(Err(e)) => {
                                    // A dead or stuck server is replaced for the next file.
                                    resolver = None;
                                    failures += 1;
                                    if failures >= MAX_FAILURES {
                                        error = Some(e.to_string());
                                        break;
                                    }
                                    Vec::new()
                                }
                                None => Vec::new(),
                            }
                        }
                    }
                };
                let targets: Vec<PathBuf> = imports.into_iter().filter_map(|i| i.target).collect();
                found += targets.len();
                if !targets.is_empty() {
                    batch.push((file.clone(), targets));
                }
                if last_post.elapsed() >= BATCH_EVERY {
                    last_post = Instant::now();
                    post(jobs, std::mem::take(&mut batch), TsStatus::Running { done: k + 1, total });
                }
            }
            if use_cache {
                cache.save(&cache_path);
            }
            (batch, error, found)
        },
        move |s, (batch, error, found)| {
            apply(s, batch);
            s.ts = match error {
                Some(e) => TsStatus::Failed(e),
                None => TsStatus::Done { imports: found, files: total },
            };
        },
    );
}

fn post(jobs: &crate::jobs::Jobs, batch: Batch, status: TsStatus) {
    jobs.post(move |s| {
        apply(s, batch);
        if matches!(s.ts, TsStatus::Running { .. }) {
            s.ts = status;
        }
    });
}

fn apply(s: &mut State, batch: Batch) {
    if let Some(scene) = &mut s.scene {
        for (file, targets) in batch {
            scene.add_imports(&file, &targets);
        }
    }
}
