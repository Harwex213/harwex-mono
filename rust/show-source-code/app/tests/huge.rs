//! A synthetic monorepo far bigger than any real one (700 packages x 300 files, ~10k deps)
//! must render at every zoom without the frame's vertex or index buffer approaching wgpu's
//! 256 MB buffer limit.

mod common;

use std::path::PathBuf;
use std::time::Instant;

use common::{demo_fixture, Driver};
use scs_workspace::{Dep, DepKind, Package, SourceFile, Workspace};
use show_code_source::{Camera, ViewRequest};

/// A frame this size is a few MB; wgpu fails at 256 MB.
const MAX_VERTICES: usize = 1_500_000;
const MAX_INDICES: usize = 4_000_000;

fn synthetic(packages: usize, files: usize) -> Workspace {
    let mut seed = 11u32;
    let mut rnd = |m: u32| {
        seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
        (seed >> 16) % m.max(1)
    };
    let root = PathBuf::from("/nonexistent-synthetic-root");
    let pkgs = (0..packages)
        .map(|i| {
            let dir = root.join(format!("packages/p{i}"));
            let n = 1 + rnd(files as u32 * 2) as usize;
            let files = (0..n)
                .map(|f| SourceFile { rel_path: format!("src/file{f}.ts"), path: dir.join(format!("src/file{f}.ts")), size: 800, lines: 5 + rnd(80) as usize })
                .collect();
            Package { name: format!("@big/p{i}"), rel_dir: format!("packages/p{i}"), dir, files }
        })
        .collect();
    let mut deps = Vec::new();
    for from in 0..packages {
        for _ in 0..rnd(30) {
            let to = rnd(packages as u32) as usize;
            if to != from && !deps.iter().any(|d: &Dep| d.from == from && d.to == to) {
                deps.push(Dep { from, to, kind: if rnd(3) == 0 { DepKind::Dev } else { DepKind::Prod } });
            }
        }
    }
    Workspace { root, packages: pkgs, deps, node_linker: None }
}

fn buffers(d: &Driver) -> (usize, usize) {
    let out = d.harness.output();
    let prims = d.harness.ctx.tessellate(out.shapes.clone(), out.pixels_per_point);
    prims.iter().fold((0, 0), |(v, i), p| match &p.primitive {
        egui::epaint::Primitive::Mesh(m) => (v + m.vertices.len(), i + m.indices.len()),
        egui::epaint::Primitive::Callback(_) => (v, i),
    })
}

#[test]
fn huge_repo_stays_within_the_frame_budget() {
    let ws = synthetic(700, 300);
    let (files, deps) = (ws.file_count(), ws.deps.len());
    let start = Instant::now();
    let scene = show_code_source::scene::build(ws, 0.0);
    eprintln!("{files} files, {deps} deps: scene built in {:?}", start.elapsed());
    let mut d = Driver::open("huge", &demo_fixture("huge"));
    d.state_mut().set_scene(scene);
    d.settle();
    let fit = d.state().camera;
    let center = d.state().scene.as_ref().unwrap().bounds.center();
    let views = [
        ("fit", fit),
        ("mid", Camera { center, zoom: 0.03 }),
        ("bars", Camera { center, zoom: 0.2 }),
        ("text", Camera { center, zoom: 1.0 }),
        ("far-in", Camera { center, zoom: 0.012 }),
    ];
    for (name, cam) in views {
        d.state_mut().request_view(ViewRequest::At(cam));
        d.settle();
        d.harness.step();
        let (v, i) = buffers(&d);
        eprintln!("{name}: zoom {:.4}, {v} vertices, {i} indices", d.state().camera.zoom);
        assert!(v < MAX_VERTICES && i < MAX_INDICES, "{name}: {v} vertices, {i} indices");
    }
    d.state_mut().request_view(ViewRequest::Fit);
    d.settle();
    d.harness.render().expect("wgpu renders the fit view");
}
