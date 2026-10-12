//! `show-code-source [path]` opens the monorepo at `path` (default: the current directory).
//! `--stats` only discovers and lays out, prints counts and timings, and exits (no window).

use std::path::PathBuf;
use std::time::Instant;

use show_code_source::{App, AppOptions};

fn main() -> eframe::Result {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "-h" || a == "--help") {
        println!("usage: show-code-source [path]   (a yarn + TypeScript monorepo; default: .)");
        return Ok(());
    }
    let project = args.iter().find(|a| !a.starts_with("--")).map_or_else(|| PathBuf::from("."), PathBuf::from);
    if args.iter().any(|a| a == "--stats") {
        stats(&project);
        return Ok(());
    }
    let native = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default().with_inner_size([1400.0, 900.0]).with_title(format!("show-code-source — {}", project.display())),
        ..Default::default()
    };
    let options = AppOptions { project, ..AppOptions::default() };
    eframe::run_native("show-code-source", native, Box::new(move |cc| Ok(Box::new(App::create(&cc.egui_ctx, options)))))
}

fn stats(project: &std::path::Path) {
    let start = Instant::now();
    let root = scs_workspace::find_root(project);
    println!("root: {}", root.display());
    let ws = match scs_workspace::discover(&root, &scs_workspace::Options::default()) {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };
    let discover_ms = start.elapsed().as_secs_f64() * 1000.0;
    let (packages, files, deps) = (ws.packages.len(), ws.file_count(), ws.deps.len());
    let scene = show_code_source::scene::build(ws, discover_ms);
    println!(
        "{packages} packages, {files} files, {deps} dependency edges; discover {discover_ms:.0} ms, layout {:.0} ms; canvas {:.0} x {:.0}",
        scene.timings.layout_ms,
        scene.bounds.width(),
        scene.bounds.height()
    );
}
