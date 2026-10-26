//! Find Usages across packages on a real monorepo, by hand (task 121). A no-op unless
//! `HARWEX_MONO_USAGES` names a position, so `cargo xtask clean-check` (which runs ignored
//! tests) never touches another repository. Only reads: `git ls-files` and the servers.
//!
//! ```sh
//! HARWEX_MONO_ROOT=<repo> HARWEX_MONO_USAGES=<file>:<line>:<column> [HARWEX_MONO_BACKEND=tsserver] \
//!   [HARWEX_MONO_EXPECT=<file with expected paths, one per line>] [HARWEX_MONO_MODE=before] \
//!   [HARWEX_MONO_THREADS=<n>] cargo test -p ide-ts --test ts mono_usages:: -- --ignored --nocapture
//! ```
//!
//! Lines and columns are 1-based, as an editor prints them. It prints the pre-filter numbers,
//! the time to the first usage and the total, cold and warm, and the usage counts; with
//! `HARWEX_MONO_EXPECT` also the expected files that were missed. The steps run one after the
//! other the way the app runs them (task 123): the usages of the loaded projects, the package
//! graph and the scoped pre-filter, then the projects one by one with streamed usages.
//! `HARWEX_MONO_MODE=before` runs the task 121 flow instead: no package graph, every usage at
//! the end. The scan threads default to the app's `find::search_threads()` (half the cores, at
//! most 8). `HARWEX_MONO_SCAN_ONLY=1` times only the pre-filter, both ways in turns.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use ide_ts::{BackendPreference, Loading, PackageGraph, Reference, ScanOptions, Stream, TsService};

#[test]
#[ignore = "manual: needs HARWEX_MONO_ROOT and HARWEX_MONO_USAGES"]
fn mono_usages() {
    let (Some(root), Some(at)) = (std::env::var_os("HARWEX_MONO_ROOT"), std::env::var("HARWEX_MONO_USAGES").ok()) else {
        eprintln!("HARWEX_MONO_ROOT or HARWEX_MONO_USAGES is not set; nothing to do");
        return;
    };
    let root = dunce::canonicalize(PathBuf::from(root)).unwrap();
    let mut parts = at.rsplitn(3, ':');
    let column: usize = parts.next().unwrap().parse().unwrap();
    let line: usize = parts.next().unwrap().parse().unwrap();
    let file = dunce::canonicalize(root.join(parts.next().unwrap())).unwrap();
    let (line, column) = (line - 1, column - 1);
    let cores = std::thread::available_parallelism().map_or(2, |n| n.get());
    let threads = std::env::var("HARWEX_MONO_THREADS").ok().and_then(|t| t.parse().ok()).unwrap_or((cores / 2).clamp(1, 8));
    let before = std::env::var("HARWEX_MONO_MODE").is_ok_and(|m| m == "before");
    eprintln!("mode: {}, {threads} scan threads", if before { "before (task 121)" } else { "scoped + streaming (task 123)" });

    let listed = std::process::Command::new("git").arg("-C").arg(&root).args(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).output().unwrap();
    let files: Vec<PathBuf> = listed.stdout.split(|b| *b == 0).filter(|s| !s.is_empty()).map(|s| root.join(String::from_utf8_lossy(s).as_ref())).collect();

    let ts = TsService::new();
    ts.set_timeout(Duration::from_secs(120));
    if std::env::var("HARWEX_MONO_BACKEND").is_ok_and(|b| b == "tsserver") {
        ts.set_backend_preference(BackendPreference::TsServer);
    }
    eprintln!("backend: {}", ts.backend(&file).unwrap().label());
    let text = std::fs::read_to_string(&file).unwrap();
    ts.open(&file, &text);

    if std::env::var("HARWEX_MONO_SCAN_ONLY").is_ok() {
        // The pre-filter alone, the whole index and the scoped one in turns, so a busy machine
        // slows both alike.
        let scope = ts.symbol_scope(&file, line, column).unwrap().expect("a declaration");
        let options = ScanOptions { threads, prepare_thread: &|| {}, cancelled: &|| false };
        for round in 0..3 {
            let t = Instant::now();
            let all = ide_ts::symbol_candidates(&files, &scope, &PackageGraph::default(), &options);
            let all_time = t.elapsed();
            let t = Instant::now();
            let graph = PackageGraph::from_files(&files);
            let scoped = ide_ts::symbol_candidates(&files, &scope, &graph, &options);
            let scoped_time = t.elapsed();
            eprintln!("scan {round}: whole index {all_time:?} ({} files, {} candidates); scoped with graph {scoped_time:?} ({} files in {:?} packages, {} candidates)", all.scanned, all.files.len(), scoped.scanned, scoped.packages, scoped.files.len());
        }
        ts.shutdown();
        return;
    }
    for run in ["cold", "warm"] {
        let started = Instant::now();
        let scope = ts.symbol_scope(&file, line, column).unwrap().expect("a declaration");
        let scope_time = started.elapsed();
        let first: Mutex<Option<Duration>> = Mutex::default();
        let count = Mutex::new(0usize);
        let mark = |n: usize| {
            *count.lock().unwrap() += n;
            let mut f = first.lock().unwrap();
            if f.is_none() && n > 0 {
                *f = Some(started.elapsed());
            }
        };
        if !before {
            // The app asks the loaded projects while the pre-filter runs.
            let loaded = ts.references(&file, line, column).unwrap();
            mark(loaded.len());
        }
        let first_ask = started.elapsed();
        let t = Instant::now();
        let graph = if before { PackageGraph::default() } else { PackageGraph::from_files(&files) };
        let graph_time = t.elapsed();
        let t = Instant::now();
        let options = ScanOptions { threads, prepare_thread: &|| {}, cancelled: &|| false };
        let candidates = ide_ts::symbol_candidates(&files, &scope, &graph, &options);
        let scan_time = t.elapsed();
        let t = Instant::now();
        let last = Mutex::new((0, 0));
        let report = |done: usize, total: usize| {
            *last.lock().unwrap() = (done, total);
            if total > 0 && (done.is_multiple_of(10) || done == total) {
                eprintln!("  {done}/{total} projects checked, {:?}, {} usages", t.elapsed(), count.lock().unwrap());
            }
        };
        let loading = Loading { cancelled: &|| false, progress: &report };
        let refs: Vec<Reference> = if before {
            let refs = ts.references_across(&file, line, column, &candidates.files, &loading).unwrap();
            mark(refs.len());
            refs
        } else {
            let all: Mutex<Vec<Reference>> = Mutex::default();
            let found = |batch: Vec<Reference>| {
                mark(batch.len());
                all.lock().unwrap().extend(batch);
            };
            ts.references_streaming(&file, line, column, &candidates.files, &loading, &Stream { found: &found, loaded_asked: true }).unwrap();
            let mut all = all.into_inner().unwrap();
            let loaded = ts.references(&file, line, column).unwrap();
            all.extend(loaded);
            all.sort_by(|a, b| (&a.location.path, a.location.line, a.location.column).cmp(&(&b.location.path, b.location.line, b.location.column)));
            all.dedup_by(|a, b| a.location == b.location);
            all
        };
        let ask_time = t.elapsed();
        let total = started.elapsed();
        let mut ref_files: Vec<PathBuf> = refs.iter().map(|r| r.location.path.clone()).collect();
        ref_files.dedup();
        eprintln!(
            "{run}: `{}` exported={} declared in {:?}; scope {scope_time:?}; first ask done at {first_ask:?}; graph of {} packages {graph_time:?}; scan of {} files in {} packages {scan_time:?} -> {} candidates; {} projects checked; references {ask_time:?}; first usage at {:?}; total {total:?}; {} usages in {} files",
            scope.name,
            scope.exported,
            scope.declarations.iter().map(|d| d.strip_prefix(&root).unwrap_or(d).display().to_string()).collect::<Vec<_>>(),
            graph.len(),
            candidates.scanned,
            candidates.packages.map_or("all".to_string(), |p| p.to_string()),
            candidates.files.len(),
            last.lock().unwrap().1,
            first.lock().unwrap(),
            refs.len(),
            ref_files.len(),
        );
        let candidates = candidates.files;
        if let Some(expect) = std::env::var_os("HARWEX_MONO_EXPECT").filter(|_| run == "cold") {
            let expected: Vec<PathBuf> = std::fs::read_to_string(expect).unwrap().lines().filter(|l| !l.trim().is_empty()).map(|l| root.join(l.trim())).collect();
            let missed: Vec<&PathBuf> = expected.iter().filter(|e| !ref_files.contains(e)).collect();
            let extra: Vec<&PathBuf> = ref_files.iter().filter(|f| !expected.contains(f)).collect();
            eprintln!("expected {} files: {} found, {} missed, {} found beyond the list", expected.len(), expected.len() - missed.len(), missed.len(), extra.len());
            for m in missed.iter().take(40) {
                let in_candidates = candidates.contains(m);
                eprintln!("  missed {} (candidate: {in_candidates})", m.strip_prefix(&root).unwrap_or(m).display());
            }
            for x in extra.iter().take(40) {
                eprintln!("  beyond {}", x.strip_prefix(&root).unwrap_or(x).display());
            }
        }
    }
    ts.shutdown();
}
