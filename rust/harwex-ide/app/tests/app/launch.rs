//! Startup folder: a terminal start opens the cwd, a Spotlight/Dock start (cwd `/`) reopens
//! the last folder, an explicit path wins. `main.rs` feeds `launch::startup_folder` the real
//! arguments, cwd and TTY state; these tests feed it the same facts and run the real app.

use std::path::Path;

use crate::common::*;
use harwex_ide::launch::startup_folder;
use harwex_ide::AppOptions;

const SUITE: &str = "launch";

fn options(project: Option<std::path::PathBuf>) -> AppOptions {
    AppOptions { project, restore_last_folder: true, ..test_options(None) }
}

fn storage_with_last(folder: &Path) -> MemoryStorage {
    let mut storage = MemoryStorage::default();
    storage.map.insert("last_folder".into(), folder.display().to_string());
    storage
}

#[test]
fn terminal_start_opens_the_cwd() {
    let fx = Fixture::new(SUITE, "terminal");
    let here = basic_repo(fx.path("here"));
    let last = basic_repo(fx.path("last"));
    let storage = storage_with_last(&last.dir);

    // Started from a terminal in `here`, without arguments; stdin is not a TTY (a script).
    let folder = startup_folder(&[], Some(&here.dir), false);
    assert_eq!(folder.as_deref(), Some(here.dir.as_path()));
    let mut ide = Ide::with_options(SUITE, options(folder), Some(&storage));
    let root = std::fs::canonicalize(&here.dir).expect("canonical");
    ide.wait_for("cwd opened", |s| s.ws.project.as_ref().is_some_and(|p| p.root == root) && s.ws.git.status_ms.is_some());
    ide.settle();
    ide.snapshot("terminal_cwd");
}

#[test]
fn spotlight_start_reopens_the_last_folder() {
    let fx = Fixture::new(SUITE, "spotlight");
    let last = basic_repo(fx.path("last"));
    let storage = storage_with_last(&last.dir);

    // Spotlight and the Dock start apps with cwd `/` and no TTY.
    let folder = startup_folder(&[], Some(Path::new("/")), false);
    assert_eq!(folder, None);
    let mut ide = Ide::with_options(SUITE, options(folder), Some(&storage));
    let root = std::fs::canonicalize(&last.dir).expect("canonical");
    ide.wait_for("last folder reopened", |s| s.ws.project.as_ref().is_some_and(|p| p.root == root) && s.ws.git.status_ms.is_some());
    ide.settle();
    ide.snapshot("spotlight_last_folder");
}

#[test]
fn explicit_path_wins_over_cwd_and_last_folder() {
    let fx = Fixture::new(SUITE, "explicit");
    let here = basic_repo(fx.path("here"));
    let other = basic_repo(fx.path("other"));
    let last = basic_repo(fx.path("last"));
    let storage = storage_with_last(&last.dir);

    let args = vec![other.dir.display().to_string()];
    let folder = startup_folder(&args, Some(&here.dir), true);
    let mut ide = Ide::with_options(SUITE, options(folder), Some(&storage));
    let root = std::fs::canonicalize(&other.dir).expect("canonical");
    ide.wait_for("argument opened", |s| s.ws.project.as_ref().is_some_and(|p| p.root == root) && s.ws.git.status_ms.is_some());
    ide.settle();
    assert_eq!(ide.state().ws.project.as_ref().map(|p| p.name.as_str()), Some("other"));
}
