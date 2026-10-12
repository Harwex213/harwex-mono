//! Renders a real monorepo at fit-to-screen when `SCS_REAL_REPO=<path>` is set; otherwise does
//! nothing. The picture goes to `SCS_REAL_REPO_OUT` (default `target/real-repo.png`) and is
//! not compared with anything. `SCS_REAL_REPO_TS=1` also waits for the tsserver pass.

mod common;

use std::path::PathBuf;
use std::time::Instant;

use common::Driver;
use show_code_source::AppOptions;

#[test]
fn render_real_repo() {
    let Some(root) = std::env::var_os("SCS_REAL_REPO").map(PathBuf::from) else {
        return;
    };
    let out = std::env::var_os("SCS_REAL_REPO_OUT").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../target/real-repo.png"));
    let ts = std::env::var("SCS_REAL_REPO_TS").is_ok_and(|v| v == "1");
    let start = Instant::now();
    let options = AppOptions { project: root, deterministic: false, tsserver: ts, import_cache: true };
    let size = egui::vec2(
        std::env::var("SCS_REAL_REPO_W").ok().and_then(|v| v.parse().ok()).unwrap_or(1280.0),
        std::env::var("SCS_REAL_REPO_H").ok().and_then(|v| v.parse().ok()).unwrap_or(800.0),
    );
    let mut d = Driver::with_options("real_repo", options, size);
    eprintln!("loaded in {:?}", start.elapsed());
    if let Ok(zoom) = std::env::var("SCS_REAL_REPO_ZOOM") {
        let pkg = std::env::var("SCS_REAL_REPO_PACKAGE").ok();
        let s = d.state_mut();
        match pkg {
            Some(p) => s.request_view(show_code_source::ViewRequest::Package(p)),
            None => {
                let c = s.scene.as_ref().unwrap().bounds.center();
                s.request_view(show_code_source::ViewRequest::At(show_code_source::Camera { center: c, zoom: zoom.parse().unwrap() }));
            }
        }
    }
    let frame = Instant::now();
    d.render_to(&out);
    eprintln!("rendered {} in {:?} (status {:?})", out.display(), frame.elapsed(), d.state().ts);
}
