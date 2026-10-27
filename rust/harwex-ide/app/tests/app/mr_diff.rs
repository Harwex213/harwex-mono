//! Compare MR Diff (Beta): the branch tree's menu opens a Git window tab with the files that
//! differ between the current branch and the picked one on the left and the selected file's diff
//! on the right.

use crate::common::*;
use egui::{Key, Pos2};
use harwex_ide::layout::ToolWindow;
use std::path::Path;

const SUITE: &str = "mr_diff";

/// `history_repo` plus a branch `mr` with edits, a new file, a deletion, a binary file and a
/// run of small files; `main` moves on after the fork.
fn mr_repo(fx: &Fixture) -> Repo {
    let r = history_repo(fx.path("repo"));
    r.git(&["checkout", "-q", "-b", "mr"]);
    r.write("src/util.ts", "export function add(a: number, b: number): number {\n  // Sum of two numbers.\n  return a + b;\n}\n\nexport const ZERO = 0;\nexport const ONE = 1;\nexport const TWO = 2;\n");
    let long: String = (0..40).map(|i| format!("export const value{i} = {i};\n")).collect();
    r.write("src/values.ts", &long);
    for i in 0..6 {
        r.write(&format!("pkg/part{i}.ts"), &format!("export const part{i} = {i};\nexport const name{i} = 'part {i}';\n"));
    }
    std::fs::create_dir_all(r.dir.join("assets")).unwrap();
    std::fs::write(r.dir.join("assets/logo.bin"), [0u8, 1, 2, 3, 0, 9]).unwrap();
    std::fs::remove_file(r.dir.join("src/side.ts")).unwrap();
    r.commit_all("MR work");
    r.git(&["checkout", "-q", "main"]);
    // After the fork: the two-dot compare shows it as main's side of the file.
    r.write("src/after.ts", "export const after = 2;\n");
    r.commit_all("Main moves on");
    r
}

fn open_mr(ide: &mut Ide) {
    open_mr_of(ide, "mr");
}

fn open_mr_of(ide: &mut Ide, branch: &str) {
    if ide.state().ws.layout.bottom != Some(ToolWindow::Git) {
        ide.click("Git tool window");
    }
    ide.wait_for("branches loaded", |s| s.ws.git_ui.window.refs.is_some());
    ide.settle();
    let top = ide.rect("Hide Git").min.y - 8.0;
    ide.drag(Pos2::new(700.0, top), Pos2::new(700.0, 160.0));
    ide.settle();
    ide.right_click(&format!("Tree branch {branch}"));
    ide.wait_until("context menu", |ide| ide.has("Compare MR Diff (Beta)"));
    ide.click("Compare MR Diff (Beta)");
    ide.wait_for("mr diff loaded", |s| s.ws.git_ui.window.mr_tab().is_some_and(|t| t.files().is_some()));
    ide.settle();
}

fn tab(ide: &Ide) -> &harwex_ide::git::mr_diff::MrTab {
    ide.state().ws.git_ui.window.mr_tab().expect("mr tab")
}

#[test]
fn mr_diff_lists_the_changes_against_the_current_branch() {
    let fx = Fixture::new(SUITE, "tab");
    let repo = mr_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_mr(&mut ide);
    assert_eq!(ide.state().ws.git_ui.window.active_title(), "MR: mr → main");
    let files: Vec<String> = tab(&ide).files().unwrap().iter().map(|f| f.change.path.display().to_string()).collect();
    assert_eq!(files, ["assets/logo.bin", "pkg/part0.ts", "pkg/part1.ts", "pkg/part2.ts", "pkg/part3.ts", "pkg/part4.ts", "pkg/part5.ts", "src/after.ts", "src/side.ts", "src/util.ts", "src/values.ts"]);
    let counts = |ide: &Ide, rel: &str| tab(ide).files().unwrap().iter().find(|f| f.change.path == Path::new(rel)).map(|f| (f.adds, f.dels)).unwrap();
    assert_eq!(counts(&ide, "src/util.ts"), (2, 0));
    // Two-dot: main's own change after the fork shows from main's side (left) to the branch's.
    assert_eq!(counts(&ide, "src/after.ts"), (1, 1));
    // The first file shows at once; a binary file shows a note.
    assert_eq!(tab(&ide).shown_file(), Some(Path::new("assets/logo.bin")));
    assert!(ide.has("MR file assets/logo.bin"));
    ide.assert_text("Binary file not shown.");

    ide.click("Changed file pkg/part0.ts");
    ide.wait_for("colors", |s| s.ws.git_ui.window.mr_tab().is_some_and(|t| t.highlighted(Path::new("pkg/part0.ts"))));
    ide.settle();
    assert_eq!(tab(&ide).shown_file(), Some(Path::new("pkg/part0.ts")));
    ide.snapshot("mr_diff");
}

#[test]
fn selecting_a_file_in_the_tree_shows_its_diff() {
    let fx = Fixture::new(SUITE, "select");
    let repo = mr_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_mr(&mut ide);

    ide.click("Changed file src/util.ts");
    ide.wait_for("colors", |s| s.ws.git_ui.window.mr_tab().is_some_and(|t| t.highlighted(Path::new("src/util.ts"))));
    ide.settle();
    assert_eq!(tab(&ide).shown_file(), Some(Path::new("src/util.ts")));
    assert!(ide.has("MR file src/util.ts"));
    assert!(!ide.has("MR file assets/logo.bin"), "the right pane shows one file");
    ide.snapshot("mr_diff_util");

    // The tree's keys switch files.
    ide.key(Key::ArrowDown);
    ide.settle();
    assert_eq!(tab(&ide).shown_file(), Some(Path::new("src/values.ts")));
    assert!(ide.has("MR file src/values.ts"));
    ide.key(Key::ArrowUp);
    ide.key(Key::ArrowUp);
    ide.settle();
    assert_eq!(tab(&ide).shown_file(), Some(Path::new("src/side.ts")));
    assert_eq!(tab(&ide).tree_selection(), [Path::new("src/side.ts")]);

    // So does the tree's speed search.
    ide.type_text("after");
    ide.settle();
    assert_eq!(tab(&ide).shown_file(), Some(Path::new("src/after.ts")));

    // A folder row shows no diff.
    ide.click("Changes folder pkg");
    ide.settle();
    assert_eq!(tab(&ide).shown_file(), None);
    ide.assert_text("Select a file to see its diff.");
}

#[test]
fn big_mr_stays_fast_and_huge_diffs_wait_behind_a_button() {
    let fx = Fixture::new(SUITE, "big");
    let r = history_repo(fx.path("repo"));
    r.git(&["checkout", "-q", "-b", "big"]);
    for i in 0..300 {
        r.write(&format!("gen/d{}/file{i}.ts", i % 10), &format!("export const v{i} = {i};\nexport const w{i} = 'w';\n"));
    }
    let huge: String = (0..6000).map(|i| format!("export const line{i} = {i};\n")).collect();
    r.write("gen/huge.ts", &huge);
    r.commit_all("Generated");
    r.git(&["checkout", "-q", "main"]);
    let mut ide = Ide::open(SUITE, &r.dir);
    open_mr_of(&mut ide, "big");
    assert_eq!(tab(&ide).files().unwrap().len(), 301);
    assert!(tab(&ide).is_collapsed(Path::new("gen/huge.ts")));
    // The folders fold away; the huge file's row comes into view.
    ide.click("Collapse All");
    ide.settle();
    ide.click("Changed file gen/huge.ts");
    ide.settle();
    ide.assert_text("Large diff (6001 lines) is hidden.");
    // Shown, the 6000 rows are laid out only where they are in view.
    ide.click("Show Large Diff");
    ide.settle();
    assert!(!tab(&ide).is_collapsed(Path::new("gen/huge.ts")));
    let started = std::time::Instant::now();
    ide.steps(10);
    let per_frame = started.elapsed() / 10;
    assert!(per_frame < std::time::Duration::from_millis(250), "{per_frame:?} per frame");
    assert!(ide.state().frame_clock.last_slow.is_none(), "{:?}", ide.state().frame_clock.last_slow);
}
