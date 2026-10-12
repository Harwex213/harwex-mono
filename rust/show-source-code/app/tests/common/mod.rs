//! Shared support for the headless UI tests: a driver around the real `App` in an
//! `egui_kittest` harness (no window), the demo fixture, and snapshot comparison.

#![allow(dead_code)] // Each test binary uses a different subset.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use egui::Vec2;
use egui_kittest::{Harness, SnapshotError, SnapshotOptions};
use show_code_source::{App, AppOptions, State};

/// Window size of every test. Snapshots depend on it.
pub const SIZE: Vec2 = Vec2::new(1280.0, 800.0);
/// Pixels that may differ before a snapshot fails (anti-aliasing noise between GPU runs).
pub const MAX_DIFF_PIXELS: i32 = 64;
/// Wall-clock budget of one `settle`; `SCS_TEST_WAIT_SECS` changes it (a cold tsserver pass
/// over a real repo takes longer).
pub fn wait_budget() -> Duration {
    Duration::from_secs(std::env::var("SCS_TEST_WAIT_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(40))
}

/// A fresh copy of the demo monorepo at a stable path, so every run renders the same picture.
pub fn demo_fixture(test: &str) -> PathBuf {
    let dir = std::env::temp_dir().join("show-code-source-kittest").join(test);
    scs_workspace::fixture::write_demo(&dir).expect("write fixture");
    dir
}

pub fn test_options(project: &Path) -> AppOptions {
    AppOptions { project: project.to_path_buf(), deterministic: true, tsserver: false, import_cache: false }
}

pub struct Driver {
    pub harness: Harness<'static, App>,
    suite: &'static str,
}

impl Driver {
    pub fn open(suite: &'static str, project: &Path) -> Driver {
        Driver::with_options(suite, test_options(project), SIZE)
    }

    pub fn with_options(suite: &'static str, options: AppOptions, size: Vec2) -> Driver {
        let harness = Harness::builder()
            .with_size(size)
            .with_pixels_per_point(1.0)
            .with_step_dt(0.05)
            .with_max_steps(100)
            .wgpu()
            .build_eframe(move |cc| App::create(&cc.egui_ctx, options));
        let mut d = Driver { harness, suite };
        d.settle();
        d
    }

    pub fn state(&self) -> &State {
        self.harness.state().state()
    }

    pub fn state_mut(&mut self) -> &mut State {
        self.harness.state_mut().state_mut()
    }

    /// Runs frames until no job runs and a few frames passed without work.
    pub fn settle(&mut self) {
        let start = Instant::now();
        let mut quiet = 0;
        loop {
            self.harness.step();
            if self.state().is_idle() {
                quiet += 1;
                if quiet >= 3 {
                    return;
                }
            } else {
                quiet = 0;
                std::thread::sleep(Duration::from_millis(2));
            }
            let budget = wait_budget();
            assert!(start.elapsed() < budget, "settle: jobs still running after {budget:?}");
        }
    }

    /// Settles, renders and compares with `tests/snapshots/<suite>/<name>.png`
    /// (`UPDATE_SNAPSHOTS=1` writes it instead).
    pub fn snapshot(&mut self, name: &str) {
        self.settle();
        self.harness.step();
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/snapshots").join(self.suite);
        let options = SnapshotOptions::new().output_path(&dir);
        match self.harness.try_snapshot_options(name, &options) {
            Ok(()) => {}
            Err(SnapshotError::Diff { diff, .. }) if diff <= MAX_DIFF_PIXELS => {
                let _ = std::fs::remove_file(dir.join(format!("{name}.diff.png")));
            }
            Err(e) => panic!("{e}"),
        }
        let _ = std::fs::remove_file(dir.join(format!("{name}.new.png")));
    }

    /// Renders the current frame to `path` (not a golden).
    pub fn render_to(&mut self, path: &Path) {
        self.settle();
        self.harness.step();
        let image = self.harness.render().expect("render");
        image.save(path).expect("save png");
    }
}
