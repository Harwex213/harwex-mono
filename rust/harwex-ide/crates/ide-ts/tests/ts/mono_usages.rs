//! Find Usages across packages on a real monorepo, by hand (task 121). A no-op unless
//! `HARWEX_MONO_USAGES` names a position, so `cargo xtask clean-check` (which runs ignored
//! tests) never touches another repository. Only reads: `git ls-files` and the servers.
//!
//! ```sh
//! HARWEX_MONO_ROOT=<repo> HARWEX_MONO_USAGES=<file>:<line>:<column> [HARWEX_MONO_BACKEND=tsserver] \
//!   [HARWEX_MONO_EXPECT=<file with expected paths, one per line>] \
//!   cargo test -p ide-ts --test ts mono_usages:: -- --ignored --nocapture
//! ```
//!
//! Lines and columns are 1-based, as an editor prints them. It prints the pre-filter numbers,
//! the cold and warm times and the usage counts; with `HARWEX_MONO_EXPECT` also the expected
//! files that were missed.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use ide_ts::{BackendPreference, Loading, ScanOptions, TsService};

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
    let threads = 4;

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

    for run in ["cold", "warm"] {
        let started = Instant::now();
        let scope = ts.symbol_scope(&file, line, column).unwrap().expect("a declaration");
        let scope_time = started.elapsed();
        let t = Instant::now();
        let options = ScanOptions { threads, prepare_thread: &|| {}, cancelled: &|| false };
        let candidates = ide_ts::symbol_candidates(&files, &scope, &options);
        let scan_time = t.elapsed();
        let t = Instant::now();
        let last = std::sync::Mutex::new((0, 0));
        let report = |done: usize, total: usize| {
            *last.lock().unwrap() = (done, total);
            if total > 0 && (done.is_multiple_of(10) || done == total) {
                eprintln!("  loading {done}/{total} projects, {:?}", t.elapsed());
            }
        };
        let loading = Loading { cancelled: &|| false, progress: &report };
        let refs = ts.references_across(&file, line, column, &candidates, &loading).unwrap();
        let ask_time = t.elapsed();
        let mut ref_files: Vec<PathBuf> = refs.iter().map(|r| r.location.path.clone()).collect();
        ref_files.dedup();
        eprintln!(
            "{run}: `{}` exported={} declared in {:?}; scope {scope_time:?}; scan of {} files {scan_time:?} -> {} candidates; {} projects loaded; references {ask_time:?}; total {:?}; {} usages in {} files",
            scope.name,
            scope.exported,
            scope.declarations.iter().map(|d| d.strip_prefix(&root).unwrap_or(d).display().to_string()).collect::<Vec<_>>(),
            files.len(),
            candidates.len(),
            last.lock().unwrap().1,
            started.elapsed(),
            refs.len(),
            ref_files.len(),
        );
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
