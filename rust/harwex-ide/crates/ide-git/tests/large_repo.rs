//! Timing against a real, large repository. Read-only: status, log and branches never write
//! the index or refs. Run with `cargo test -p ide-git --release --test large_repo -- --ignored --nocapture`.

use std::path::PathBuf;
use std::time::Instant;

use ide_git::{LogFilter, Repo};

#[test]
#[ignore = "needs a large local repository; set HARWEX_LARGE_REPO"]
fn timings_on_large_repo() {
    let path = std::env::var("HARWEX_LARGE_REPO")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/Users/aleh_kaportsau/Projects/harwex-mono"));
    if !path.exists() {
        eprintln!("skipping: {} does not exist", path.display());
        return;
    }
    let t = Instant::now();
    let repo = Repo::discover(&path).unwrap();
    eprintln!("discover: {:?}", t.elapsed());
    for run in 0..3 {
        let t = Instant::now();
        let st = repo.status().unwrap();
        eprintln!("status run {run}: {} entries in {:?}", st.len(), t.elapsed());
    }
    let t = Instant::now();
    let log = repo.log(&LogFilter::default(), 0, 200).unwrap();
    eprintln!("log first 200: {:?}", t.elapsed());
    let t = Instant::now();
    let rows = repo.graph(&log);
    eprintln!("graph of {}: {:?} (max width {})", rows.len(), t.elapsed(), rows.iter().map(|r| r.width).max().unwrap_or(0));
    let t = Instant::now();
    let page = repo.log(&LogFilter::default(), 1000, 200).unwrap();
    eprintln!("log page at skip 1000: {} in {:?}", page.len(), t.elapsed());
    let t = Instant::now();
    let br = repo.branches().unwrap();
    eprintln!("branches: {} local, {} remote in {:?}", br.local.len(), br.remote.len(), t.elapsed());
    let t = Instant::now();
    let filtered = repo
        .log(&LogFilter { path: Some(PathBuf::from("javascript/package.json")), ..Default::default() }, 0, 50)
        .unwrap();
    eprintln!("log by path: {} in {:?}", filtered.len(), t.elapsed());
}
