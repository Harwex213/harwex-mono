//! Editor tab titles in the file's git status color (task 124), like the Project tree: clean,
//! modified, staged addition, untracked, conflicted and ignored files; diff and image tabs follow
//! their file; status changes recolor open tabs; each project colors its own tabs.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::common::*;
use egui::Color32;
use harwex_ide::theme::T;
use harwex_ide::watcher::FsBatch;

const SUITE: &str = "tab_status";

/// `conflict_repo` stopped in a merge conflict on `conflict.txt`, plus a modified `src/app.ts`,
/// a staged new `src/added.ts`, an untracked `scratch.txt` and an ignored `ignored/secret.txt`.
fn status_repo(fx: &Fixture) -> Repo {
    let repo = conflict_repo(fx.path("repo"));
    let merge = repo.git_status(&["merge", "-q", "conflict-b"]);
    assert!(!merge.status.success(), "the merge stops with a conflict");
    repo.write("src/app.ts", &APP_TS.replace("add(1, 2)", "add(40, 2)"));
    repo.write("src/added.ts", "export const added = true;\n");
    repo.git(&["add", "src/added.ts"]);
    repo.write("scratch.txt", "untracked\n");
    repo.write("ignored/secret.txt", "secret\n");
    repo
}

/// The title color the strip draws for the tab titled `title`; `None` is the normal color.
fn color_of(ide: &Ide, title: &str) -> Option<Color32> {
    let s = ide.state();
    let tab = s.ws.tabs.list.iter().find(|t| t.title() == title).unwrap_or_else(|| panic!("no tab {title}"));
    harwex_ide::tab_status::color(s, tab)
}

/// Re-reads git status and waits until it landed.
fn refresh_git(ide: &mut Ide) {
    ide.state_mut().ws.git.status_ms = None;
    ide.state_mut().refresh_git();
    ide.wait_for("git status", |s| s.ws.git.status_ms.is_some() && !s.ws.git.refresh.busy() && s.is_idle());
    ide.settle();
}

fn fs_batch(ide: &mut Ide, paths: &[PathBuf]) {
    let paths: HashSet<PathBuf> = paths.iter().cloned().collect();
    ide.state_mut().on_fs_batch(FsBatch { paths, structure_changed: false, git_changed: false });
    ide.wait_for("refresh", |s| s.is_idle() && !s.ws.git.refresh.busy());
    ide.settle();
}

/// A small PNG, so the image tab opens.
fn png() -> Vec<u8> {
    let img = image::RgbaImage::from_fn(16, 16, |x, y| image::Rgba([(x * 16) as u8, (y * 16) as u8, 120, 255]));
    let mut out = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png).expect("encode png");
    out
}

fn open_files(ide: &mut Ide, rels: &[&str]) {
    for rel in rels {
        ide.open_file(rel);
    }
}

#[test]
fn tabs_take_the_file_status_color() {
    let fx = Fixture::new(SUITE, "colors");
    let repo = status_repo(&fx);
    std::fs::create_dir_all(repo.dir.join("img")).expect("mkdir");
    std::fs::write(repo.dir.join("img/new.png"), png()).expect("png");
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_files(&mut ide, &["README.md", "src/app.ts", "src/added.ts", "scratch.txt", "conflict.txt", "ignored/secret.txt"]);
    // The ignored check runs on a worker once per tab path.
    ide.wait_for("ignored checked", |s| s.is_idle() && s.ws.tab_ignored.is_ignored(&s.ws.project.as_ref().expect("project").root.join("ignored/secret.txt")).is_some());
    ide.settle();

    assert_eq!(color_of(&ide, "README.md"), None, "a clean file keeps the normal color");
    assert_eq!(color_of(&ide, "app.ts"), Some(T.git_modified));
    assert_eq!(color_of(&ide, "added.ts"), Some(T.git_added));
    assert_eq!(color_of(&ide, "scratch.txt"), Some(T.git_untracked));
    assert_eq!(color_of(&ide, "conflict.txt"), Some(T.git_conflict));
    assert_eq!(color_of(&ide, "secret.txt"), Some(T.tree_ignored));
    // The same mapping as the Project tree.
    let root = ide.root();
    for rel in ["README.md", "src/app.ts", "src/added.ts", "scratch.txt", "conflict.txt"] {
        let tree = harwex_ide::tree::name_color(&ide.state().ws.git, &root.join(rel), false);
        let title = Path::new(rel).file_name().expect("name").to_string_lossy().into_owned();
        assert_eq!(color_of(&ide, &title).unwrap_or(T.text), tree, "{rel} matches the tree");
    }
    // The active tab (the last opened) keeps the status color.
    assert_eq!(ide.active_title().as_deref(), Some("secret.txt"));
    // The merge opens its Conflicts dialog over the editor; close it for the shot.
    ide.click_at(egui::pos2(949.0, 258.0));
    ide.settle();
    assert!(!ide.state().ws.git_ui.conflicts.dialog_open(), "the dialog's close button closed it");
    ide.snapshot("tab_colors");

    // A diff tab and an image tab follow their file.
    harwex_ide::git::diff::open_worktree_diff(ide.state_mut(), &root.join("src/app.ts"));
    ide.wait_until("diff tab", |ide| ide.state().is_idle() && ide.state().ws.tabs.custom_by_key("diff:wt:src/app.ts").is_some());
    let diff = ide.state().ws.tabs.custom_by_key("diff:wt:src/app.ts").expect("diff tab");
    let s = ide.state();
    assert_eq!(harwex_ide::tab_status::color(s, s.ws.tabs.get(diff).expect("tab")), Some(T.git_modified));
    let png_path = dunce::canonicalize(root.join("img/new.png")).expect("png");
    ide.state_mut().open_location(&png_path, None, true);
    let key = format!("image:{}", png_path.display());
    ide.wait_until("image tab", |ide| ide.state().is_idle() && ide.state().ws.tabs.custom_by_key(&key).is_some());
    ide.settle();
    let image = ide.state().ws.tabs.custom_by_key(&key).expect("image tab");
    let s = ide.state();
    assert_eq!(harwex_ide::tab_status::color(s, s.ws.tabs.get(image).expect("tab")), Some(T.git_untracked));
}

#[test]
fn status_changes_recolor_open_tabs() {
    let fx = Fixture::new(SUITE, "changes");
    let repo = basic_repo(fx.path("repo"));
    repo.write("src/app.ts", &APP_TS.replace("add(1, 2)", "add(40, 2)"));
    repo.write("src/added.ts", "export const added = true;\n");
    repo.write("scratch.txt", "untracked\n");
    let mut ide = Ide::open(SUITE, &repo.dir);
    let root = ide.root();
    open_files(&mut ide, &["README.md", "src/app.ts", "src/added.ts", "scratch.txt"]);
    assert_eq!(color_of(&ide, "app.ts"), Some(T.git_modified));
    assert_eq!(color_of(&ide, "added.ts"), Some(T.git_untracked));

    // Stage: the new file turns into a staged addition, the staged edit stays modified.
    repo.git(&["add", "src/app.ts", "src/added.ts"]);
    refresh_git(&mut ide);
    assert_eq!(color_of(&ide, "added.ts"), Some(T.git_added));
    assert_eq!(color_of(&ide, "app.ts"), Some(T.git_modified));

    // Commit: both turn clean.
    repo.git(&["commit", "-q", "-m", "commit both"]);
    refresh_git(&mut ide);
    assert_eq!(color_of(&ide, "added.ts"), None);
    assert_eq!(color_of(&ide, "app.ts"), None);

    // Edit on disk: the watcher batch recolors the tab.
    repo.write("README.md", "# changed\n");
    fs_batch(&mut ide, &[root.join("README.md")]);
    assert_eq!(color_of(&ide, "README.md"), Some(T.git_modified));

    // A `.gitignore` change checks the tabs again: the untracked file becomes ignored.
    let checks = ide.state().ws.tab_ignored.checks;
    repo.write(".gitignore", "ignored/\nscratch.txt\n");
    fs_batch(&mut ide, &[root.join(".gitignore")]);
    assert!(ide.state().ws.tab_ignored.checks > checks, "a new check ran");
    assert_eq!(ide.state().ws.tab_ignored.is_ignored(&root.join("scratch.txt")), Some(true));
    assert_eq!(color_of(&ide, "scratch.txt"), Some(T.tree_ignored));
}

#[test]
fn each_project_colors_its_own_tabs() {
    let fx = Fixture::new(SUITE, "projects");
    let a = basic_repo(fx.path("a"));
    a.write("src/app.ts", &APP_TS.replace("add(1, 2)", "add(40, 2)"));
    let b = basic_repo(fx.path("b"));
    let mut ide = Ide::open(SUITE, &a.dir);
    let first = ide.state().ws.id;
    ide.open_file("src/app.ts");
    assert_eq!(color_of(&ide, "app.ts"), Some(T.git_modified));

    let second = ide.state_mut().open_workspace(b.dir.clone());
    let root_b = dunce::canonicalize(&b.dir).expect("canonical");
    ide.wait_for("second project loaded", move |s| {
        s.ws.id == second && s.ws.project.as_ref().is_some_and(|p| p.root == root_b && s.ws.tree.is_loaded(&p.root)) && s.ws.index.build_ms.is_some() && s.ws.git.status_ms.is_some()
    });
    ide.settle();
    ide.open_file("src/app.ts");
    assert_eq!(color_of(&ide, "app.ts"), None, "the same file name is clean in the second project");

    assert!(ide.state_mut().activate(first));
    ide.settle();
    assert_eq!(color_of(&ide, "app.ts"), Some(T.git_modified));
}
