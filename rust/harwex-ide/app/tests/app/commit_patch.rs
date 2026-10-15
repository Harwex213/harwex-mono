//! Commit window patches (task 114): Copy as Patch to Clipboard and Create Patch... from the
//! changes tree menu (a file, a folder, a group) and from the toolbar (the selection, or all
//! changes). Every patch must apply with `git apply` onto a clean checkout of HEAD.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::common::*;
use harwex_ide::layout::ToolWindow;

const SUITE: &str = "commit_patch";

/// `basic_repo` plus a change of every kind: staged, unstaged, partly staged, a staged
/// rename, untracked text and binary files.
fn patch_repo(fx: &Fixture) -> Repo {
    let r = basic_repo(fx.path("repo"));
    r.write("src/util.ts", "export function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport const ZERO = 0;\nexport const ONE = 1;\n");
    r.git(&["add", "src/util.ts"]);
    r.write("src/app.ts", &APP_TS.replace("add(1, 2)", "add(40, 2)"));
    r.write("README.md", "# demo\n\nA small project, staged.\n");
    r.git(&["add", "README.md"]);
    r.write("README.md", "# demo\n\nA small project, staged.\n\nAnd unstaged.\n");
    r.git(&["mv", "docs/notes.md", "docs/renamed.md"]);
    r.write("scratch/new.txt", "untracked\n");
    std::fs::write(r.dir.join("scratch/blob.bin"), [0u8, 159, 146, 150, 0, 1, 2, 255]).expect("binary file");
    r
}

fn open_commit_window(ide: &mut Ide) {
    ide.click("Commit tool window");
    ide.settle();
    assert_eq!(ide.state().ws.layout.left, Some(ToolWindow::Commit));
    ide.click("Expand All");
    ide.settle();
}

/// The text of the last Copy as Patch.
fn copied_patch(ide: &Ide) -> String {
    let calls = ide.state().platform.calls();
    let last = calls.iter().rev().find(|c| c.starts_with("copy diff --git")).expect("a copied patch");
    last.strip_prefix("copy ").expect("copy prefix").to_string()
}

fn wait_copy(ide: &mut Ide, before: usize) -> String {
    ide.wait_until("patch copied", |ide| ide.state().platform.calls().iter().filter(|c| c.starts_with("copy diff --git")).count() > before);
    copied_patch(ide)
}

/// The `diff --git` lines of a patch.
fn heads(patch: &str) -> Vec<&str> {
    patch.lines().filter(|l| l.starts_with("diff --git ")).collect()
}

fn run(dir: &Path, args: &[&str]) {
    let out = Command::new("git").args(args).current_dir(dir).output().expect("run git");
    assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
}

/// Clones HEAD of `repo` into `name`, checks the patch with `git apply --check` and applies it.
fn apply_on_head(fx: &Fixture, repo: &Repo, name: &str, patch: &[u8]) -> PathBuf {
    let clone = fx.path(name);
    run(&fx.dir, &["clone", "-q", repo.dir.to_str().expect("utf-8 path"), name]);
    let file = fx.path(&format!("{name}.patch"));
    std::fs::write(&file, patch).expect("write the patch");
    let file = file.to_str().expect("utf-8 path");
    run(&clone, &["apply", "--check", file]);
    run(&clone, &["apply", file]);
    clone
}

fn same_file(a: &Path, b: &Path, rel: &str) {
    let (x, y) = (std::fs::read(a.join(rel)), std::fs::read(b.join(rel)));
    assert_eq!(x.ok(), y.ok(), "{rel} differs");
}

#[test]
fn file_menu_copies_a_patch_and_toasts() {
    let fx = Fixture::new(SUITE, "file_menu");
    let repo = patch_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_commit_window(&mut ide);

    ide.right_click("src/app.ts");
    ide.settle();
    for item in ["Copy as Patch to Clipboard", "Create Patch..."] {
        assert!(ide.has(item), "menu item {item:?}");
    }
    ide.snapshot_here("file_menu");

    ide.click("Copy as Patch to Clipboard");
    let patch = wait_copy(&mut ide, 0);
    assert_eq!(heads(&patch), ["diff --git a/src/app.ts b/src/app.ts"]);
    ide.settle();
    ide.assert_text("Patch copied (1 file)");
    ide.snapshot("copied_toast");
    let clone = apply_on_head(&fx, &repo, "clone", patch.as_bytes());
    same_file(&clone, &repo.dir, "src/app.ts");
}

#[test]
fn folder_and_group_rows_take_their_files() {
    let fx = Fixture::new(SUITE, "folder_group");
    let repo = patch_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_commit_window(&mut ide);

    // A folder of the Unversioned group: both new files, the binary one as a binary patch.
    ide.right_click("Directory scratch in Unversioned Files");
    ide.settle();
    ide.click("Copy as Patch to Clipboard");
    let patch = wait_copy(&mut ide, 0);
    assert_eq!(heads(&patch), ["diff --git a/scratch/blob.bin b/scratch/blob.bin", "diff --git a/scratch/new.txt b/scratch/new.txt"]);
    assert!(patch.contains("GIT binary patch"), "{patch}");
    ide.assert_text("Patch copied (2 files)");
    let clone = apply_on_head(&fx, &repo, "folder", patch.as_bytes());
    same_file(&clone, &repo.dir, "scratch/blob.bin");
    same_file(&clone, &repo.dir, "scratch/new.txt");

    // The Staged group: index vs HEAD, the rename kept, README.md at its staged version.
    ide.dismiss_toasts();
    ide.right_click("Staged group");
    ide.settle();
    ide.click("Copy as Patch to Clipboard");
    let patch = wait_copy(&mut ide, 1);
    assert_eq!(heads(&patch), ["diff --git a/README.md b/README.md", "diff --git a/docs/notes.md b/docs/renamed.md", "diff --git a/src/util.ts b/src/util.ts"]);
    assert!(patch.contains("rename from docs/notes.md\nrename to docs/renamed.md"), "{patch}");
    let clone = apply_on_head(&fx, &repo, "group", patch.as_bytes());
    assert_eq!(read(&clone, "README.md"), "# demo\n\nA small project, staged.\n");
    assert!(!clone.join("docs/notes.md").exists());
    same_file(&clone, &repo.dir, "docs/renamed.md");
    same_file(&clone, &repo.dir, "src/util.ts");
}

#[test]
fn toolbar_takes_all_changes_and_creates_a_patch_file() {
    let fx = Fixture::new(SUITE, "toolbar");
    let repo = patch_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_commit_window(&mut ide);
    assert!(ide.state().ws.git_ui.changes.selected_paths().is_empty());

    ide.click("Patch actions");
    ide.settle();
    ide.snapshot_here("toolbar_menu");
    ide.click("Copy as Patch to Clipboard");
    let patch = wait_copy(&mut ide, 0);
    // The partly staged README.md is one diff against HEAD.
    assert_eq!(heads(&patch).len(), 6, "{patch}");
    assert_eq!(patch.matches("diff --git a/README.md").count(), 1);
    ide.assert_text("Patch copied (6 files)");
    let clone = apply_on_head(&fx, &repo, "all", patch.as_bytes());
    for f in ["README.md", "src/app.ts", "src/util.ts", "docs/renamed.md", "scratch/new.txt", "scratch/blob.bin"] {
        same_file(&clone, &repo.dir, f);
    }
    assert!(!clone.join("docs/notes.md").exists());

    // With a selection the toolbar takes only it; Create Patch writes the file it names.
    ide.dismiss_toasts();
    ide.click("src/app.ts");
    ide.settle();
    ide.click("Patch actions");
    ide.settle();
    ide.click("Create Patch...");
    ide.settle();
    assert!(ide.state().ws.git_ui.changes.has_patch_dialog());
    ide.assert_text("Create Patch: 1 file of local changes");
    ide.snapshot("create_dialog");
    ide.click("Save Patch");
    let file = repo.dir.join("Local_Changes.patch");
    ide.wait_until("patch saved", |ide| ide.state().is_idle() && file.exists());
    ide.settle();
    ide.assert_text("Patch created (1 file)");
    let bytes = std::fs::read(&file).expect("the patch file");
    assert_eq!(heads(&String::from_utf8_lossy(&bytes)), ["diff --git a/src/app.ts b/src/app.ts"]);
    std::fs::remove_file(&file).expect("remove the patch file");
    let clone = apply_on_head(&fx, &repo, "created", &bytes);
    same_file(&clone, &repo.dir, "src/app.ts");
}

#[test]
fn both_rows_of_a_partly_staged_file_are_one_diff() {
    let fx = Fixture::new(SUITE, "partly_staged");
    let repo = patch_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_commit_window(&mut ide);

    ide.click("README.md in Staged");
    let r = ide.rect("README.md").center();
    ide.click_button_at(r, egui::PointerButton::Primary, CMD);
    ide.settle();
    ide.right_click("README.md");
    ide.settle();
    ide.click("Copy as Patch to Clipboard");
    let patch = wait_copy(&mut ide, 0);
    assert_eq!(heads(&patch), ["diff --git a/README.md b/README.md"]);
    let clone = apply_on_head(&fx, &repo, "clone", patch.as_bytes());
    same_file(&clone, &repo.dir, "README.md");
}
