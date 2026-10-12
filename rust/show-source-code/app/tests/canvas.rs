//! Snapshots of the demo monorepo: fit-to-screen, one package close up, the far-zoom level of
//! detail, and the tsserver overlay (with injected results, so no node is needed).

mod common;

use common::{demo_fixture, Driver};
use egui::pos2;
use show_code_source::{Camera, ViewRequest};

#[test]
fn overview_fits_the_whole_repo() {
    let root = demo_fixture("overview");
    let mut d = Driver::open("canvas", &root);
    let scene = d.state().scene.as_ref().expect("scene loaded");
    assert_eq!(scene.packages.len(), 7);
    assert_eq!(scene.edges.len(), 6);
    let visible = d.state().camera.visible(d.state().view);
    assert!(visible.contains_rect(scene.bounds), "fit shows everything");
    d.snapshot("overview");
}

#[test]
fn zoomed_in_package_shows_code() {
    let root = demo_fixture("package");
    let mut d = Driver::open("canvas", &root);
    d.state_mut().request_view(ViewRequest::Package("@fx/core".into()));
    d.snapshot("package_core");
    assert!(d.state().camera.zoom > 0.6, "close enough for text: {}", d.state().camera.zoom);
}

#[test]
fn far_zoom_draws_line_bars() {
    let root = demo_fixture("far");
    let mut d = Driver::open("canvas", &root);
    let center = d.state().scene.as_ref().unwrap().bounds.center();
    d.state_mut().request_view(ViewRequest::At(Camera { center, zoom: 0.18 }));
    d.snapshot("far_zoom");
}

#[test]
fn tsserver_results_add_file_arrows_and_badges() {
    let root = demo_fixture("imports");
    let mut d = Driver::open("canvas", &root);
    let root = root.canonicalize().unwrap();
    let f = |rel: &str| root.join(rel);
    let scene = d.state_mut().scene.as_mut().unwrap();
    scene.add_imports(&f("packages/web/src/main.tsx"), &[f("packages/ui/src/index.ts"), f("packages/core/src/index.ts")]);
    scene.add_imports(&f("packages/web/src/App.tsx"), &[f("packages/core/src/index.ts"), f("packages/utils/src/index.ts")]);
    scene.add_imports(&f("packages/ui/src/Panel.tsx"), &[f("packages/core/src/index.ts")]);
    // Not declared in web's package.json: drawn as an extra, dashed arrow.
    assert_eq!(scene.imports.undeclared.len(), 1);
    assert_eq!(scene.imports.file_edges.len(), 5);
    // Close enough for card titles, where the import badges sit.
    let web = scene.packages.iter().find(|p| p.name == "@fx/web").unwrap().rect;
    let ui = scene.packages.iter().find(|p| p.name == "@fx/ui").unwrap().rect;
    let r = web.union(ui);
    d.state_mut().request_view(ViewRequest::At(Camera { center: pos2(r.center().x + 120.0, r.center().y), zoom: 0.75 }));
    d.snapshot("imports");
}

#[test]
fn ctrl_scroll_zooms_around_the_pointer() {
    let root = demo_fixture("zoom_input");
    let mut d = Driver::open("canvas", &root);
    let before = d.state().camera;
    let view = d.state().view;
    let anchor = pos2(900.0, 500.0);
    let world = before.to_world(view, anchor);
    d.harness.input_mut().events.push(egui::Event::PointerMoved(anchor));
    d.harness.step();
    d.harness.input_mut().events.push(egui::Event::Zoom(1.5));
    d.harness.step();
    let after = d.state().camera;
    assert!((after.zoom / before.zoom - 1.5).abs() < 0.01, "{before:?} -> {after:?}");
    let again = after.to_world(view, anchor);
    assert!((again - world).length() < 0.5, "the point under the pointer stays: {world:?} -> {again:?}");
}

#[test]
fn missing_folder_shows_an_error() {
    let mut d = Driver::open("canvas", std::path::Path::new("does-not-exist-show-code-source"));
    assert!(matches!(d.state().phase, show_code_source::Phase::Failed(_)));
    d.harness.step();
}
