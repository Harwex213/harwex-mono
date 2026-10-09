//! A timing run of the search on a real repository, read-only. It is ignored by default:
//!
//! ```sh
//! HARWEX_FIND_BENCH_ROOT=<repo> nice -n 19 cargo test -p harwex-ide --release --lib find::bench -- --ignored --nocapture
//! ```
//!
//! The first pass over the tree is the coldest one this process can get (the OS page cache may
//! still hold files from earlier runs); the later passes are warm.

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use std::time::Instant;

use super::*;

/// (name, query, hit limit). Each "no hits" row reads the whole tree, so the list stays short.
fn cases() -> Vec<(&'static str, Query, usize)> {
    let q = |text: &str| Query { text: text.into(), ..Default::default() };
    vec![
        ("rare literal, no hits (popup)", q("zqxHarwexBenchNeverThere"), POPUP_CAP + 1),
        ("common literal (popup)", q("import"), POPUP_CAP + 1),
        ("mid literal (Find window cap)", q("useCallback"), FIND_WINDOW_CAP + 1),
        ("regex, no hits (popup)", Query { regex: true, case_sensitive: true, ..q(r"zqx\w+Bench\d{3}") }, POPUP_CAP + 1),
    ]
}

#[test]
#[ignore]
fn bench_mono() {
    let Some(root) = std::env::var_os("HARWEX_FIND_BENCH_ROOT").map(PathBuf::from) else {
        eprintln!("skipping: HARWEX_FIND_BENCH_ROOT is not set");
        return;
    };
    let root = root.canonicalize().unwrap();
    // Leave the user's machine usable: the run takes at most 4 threads.
    THREADS_OVERRIDE.store(4, std::sync::atomic::Ordering::Relaxed);
    let no = AtomicBool::new(false);
    let passes: usize = std::env::var("HARWEX_FIND_BENCH_PASSES").ok().and_then(|v| v.parse().ok()).unwrap_or(1);
    // The same list `search::build_file_list` makes, built here with the capped pool.
    let started = Instant::now();
    let list: Mutex<Vec<String>> = Mutex::default();
    walk(&Targets::Walk { root: root.clone(), max_depth: None }, &[], &|| false, &|p| {
        crate::lang::lock(&list).push(p.strip_prefix(&root).unwrap().to_string_lossy().into_owned());
    });
    let mut list = list.into_inner().unwrap();
    list.sort_unstable();
    println!("file list: {} files in {:.0} ms", list.len(), started.elapsed().as_secs_f64() * 1000.0);
    let walked = Targets::Walk { root: root.clone(), max_depth: None };
    let targets = Targets::Index { root: root.clone(), files: std::sync::Arc::new(list), dir: root.clone() };
    println!("| query | targets | pass | first hit ms | total ms | hits | files |");
    println!("|---|---|---|---|---|---|---|");
    let mut runs: Vec<(&str, &Targets, &str, Query, usize)> = Vec::new();
    let (name, q, cap) = cases().remove(0);
    runs.push((name, &walked, "walk", q, cap));
    // `HARWEX_FIND_BENCH_QUICK=1`: only the full read, walk against index.
    let quick = std::env::var_os("HARWEX_FIND_BENCH_QUICK").is_some();
    for (name, q, cap) in cases().into_iter().take(if quick { 1 } else { usize::MAX }) {
        runs.push((name, &targets, "index", q, cap));
    }
    for (name, t, how, q, cap) in runs {
        for pass in 0..passes {
            let started = Instant::now();
            let first: Mutex<Option<f64>> = Mutex::default();
            let on_file = |_: &std::path::Path, _: &[FindHit]| {
                let mut f = crate::lang::lock(&first);
                if f.is_none() {
                    *f = Some(started.elapsed().as_secs_f64() * 1000.0);
                }
            };
            let (r, _) = search_with(t, &Disk, &q, None, &[], &no, cap, &on_file).unwrap();
            let total = started.elapsed().as_secs_f64() * 1000.0;
            let hits: usize = r.iter().map(|(_, h)| h.len()).sum();
            let first = first.into_inner().unwrap().map_or("-".to_string(), |f| format!("{f:.0}"));
            println!("| {name} | {how} | {pass} | {first} | {total:.0} | {hits} | {} |", r.len());
        }
    }
    for pass in 0..if quick { 0 } else { passes } {
        let started = Instant::now();
        let r = count_with(&targets, &Disk, &Query { text: "import".into(), ..Default::default() }, None, &[], &no).unwrap();
        let n: usize = r.iter().map(|(_, n)| n).sum();
        println!("| count \"import\" (Replace All) | index | {pass} | - | {:.0} | {n} | {} |", started.elapsed().as_secs_f64() * 1000.0, r.len());
    }
}
