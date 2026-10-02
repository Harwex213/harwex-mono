//! Git changes: the Commit tool window (tree, checkboxes, commit of exactly the ticked files,
//! Amend, Cmd+K / Cmd+Enter, rollback with confirm), the diff tab with F7 / Shift+F7, the
//! gutter popup with rollback and undo, and the blame column with its commit popup.

mod common;

use std::path::PathBuf;

use common::*;
use egui::accesskit::Role;
use egui::Key;
use harwex_ide::git::diff::DiffTab;
use harwex_ide::layout::ToolWindow;

const SUITE: &str = "git_changes";

fn open_commit_window(ide: &mut Ide) {
    ide.click("Commit tool window");
    ide.settle();
    assert_eq!(ide.state().layout.left, Some(ToolWindow::Commit));
}

fn checked(ide: &Ide) -> Vec<String> {
    ide.state().git_ui.changes.checked_paths().iter().map(|p| p.display().to_string()).collect()
}

/// The Commit button of the tool window (the top bar has one too, drawn first).
fn click_commit_button(ide: &mut Ide) {
    let n = ide.rects("Commit").len();
    ide.click_nth("Commit", n - 1);
}

fn click_message_box(ide: &mut Ide) {
    let r = *ide.role_rects(Role::MultilineTextInput).first().expect("commit message box");
    ide.click_at(r.center());
}

fn diff_tab<'a>(ide: &'a mut Ide, key: &str) -> &'a mut DiffTab {
    ide.state_mut().tabs.custom_mut::<DiffTab>(key).unwrap_or_else(|| panic!("diff tab {key}"))
}

#[test]
fn commit_window_tree_and_checkboxes() {
    let fx = Fixture::new(SUITE, "tree");
    let repo = changed_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_commit_window(&mut ide);
    for row in ["Changes group", "Unversioned Files group", "Directory src", "Directory docs", "src/app.ts", "src/added.ts", "docs/notes.md", "scratch.txt"] {
        assert!(ide.has(row), "row {row:?} missing; {:?}", ide.labels());
    }
    // Tracked changes start ticked, unversioned files unticked, like IDEA.
    assert_eq!(checked(&ide), ["docs/notes.md", "src/added.ts", "src/app.ts"]);
    assert!(!ide.is_selected("Include scratch.txt"));
    ide.assert_text("3 of 4 selected");
    ide.snapshot("tree");

    // A file box toggles one file; a directory box toggles everything under it.
    ide.click("Include src/app.ts");
    assert_eq!(checked(&ide), ["docs/notes.md", "src/added.ts"]);
    ide.click("Include Directory src");
    assert_eq!(checked(&ide), ["docs/notes.md", "src/added.ts", "src/app.ts"]);
    ide.click("Include Directory src");
    assert_eq!(checked(&ide), ["docs/notes.md"]);
    ide.click("Include Unversioned Files group");
    assert_eq!(checked(&ide), ["docs/notes.md", "scratch.txt"]);
    ide.assert_text("2 of 4 selected");
    ide.snapshot("tree_mixed");

    // Click, Cmd+click and Shift+click select rows.
    ide.click("src/added.ts");
    assert_eq!(ide.state().git_ui.changes.selected_paths(), [PathBuf::from("src/added.ts")]);
    let r = ide.rect("docs/notes.md").center();
    ide.click_button_at(r, egui::PointerButton::Primary, CMD);
    assert_eq!(ide.state().git_ui.changes.selected_paths(), [PathBuf::from("docs/notes.md"), PathBuf::from("src/added.ts")]);
    // A click on the group arrow collapses it.
    let g = ide.rect("Changes group");
    ide.click_at(egui::pos2(g.left() + 8.0, g.center().y));
    ide.settle();
    assert!(!ide.has("src/app.ts"));
}

#[test]
fn commit_of_exactly_the_checked_files() {
    let fx = Fixture::new(SUITE, "commit");
    let repo = changed_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_commit_window(&mut ide);
    // Leave out the deletion, add the untracked file.
    ide.click("Include docs/notes.md");
    ide.click("Include scratch.txt");
    assert_eq!(checked(&ide), ["scratch.txt", "src/added.ts", "src/app.ts"]);
    assert!(!ide.is_enabled_nth("Commit", ide.rects("Commit").len() - 1), "no message, no commit");
    click_message_box(&mut ide);
    ide.type_text("Partial commit");
    assert_eq!(ide.state().git_ui.changes.message, "Partial commit");
    ide.snapshot("before_commit");
    click_commit_button(&mut ide);
    ide.wait_for("commit done", |s| !s.git_ui.changes.is_committing() && s.git_ui.changes.message.is_empty());
    ide.settle();
    assert_eq!(repo.subjects("HEAD")[0], "Partial commit");
    assert_eq!(repo.files_in("HEAD"), ["scratch.txt", "src/added.ts", "src/app.ts"]);
    assert_eq!(repo.status_short().trim(), "D docs/notes.md", "the unticked deletion stays uncommitted");
    assert!(ide.state().notifications.toast_titles().contains(&"3 files committed".to_string()));
    ide.snapshot("after_commit");
}

#[test]
fn amend_with_cmd_enter() {
    let fx = Fixture::new(SUITE, "amend");
    let repo = changed_repo(fx.path("repo"));
    let before = repo.subjects("HEAD").len();
    let mut ide = Ide::open(SUITE, &repo.dir);
    // Cmd+K opens the Commit window and focuses the message box.
    ide.cmd(Key::K);
    ide.settle();
    assert_eq!(ide.state().layout.left, Some(ToolWindow::Commit));
    ide.type_text("draft");
    assert_eq!(ide.state().git_ui.changes.message, "draft");

    // Amend fills in the last commit's message; unticking restores the draft.
    ide.click("Amend");
    ide.wait_for("last message", |s| s.git_ui.changes.message == "Initial commit");
    assert!(ide.has("Amend Commit"));
    ide.snapshot("amend");
    ide.click("Amend");
    ide.settle();
    assert_eq!(ide.state().git_ui.changes.message, "draft");
    ide.click("Amend");
    ide.wait_for("last message again", |s| s.git_ui.changes.message == "Initial commit");

    // Commit only the modified file into the amended commit, with Cmd+Enter in the box.
    ide.click("Include docs/notes.md");
    ide.click("Include src/added.ts");
    click_message_box(&mut ide);
    ide.cmd(Key::End);
    ide.type_text(" (amended)");
    ide.key_mods(CMD, Key::Enter);
    ide.wait_for("amend done", |s| !s.git_ui.changes.is_committing() && !s.git_ui.changes.is_amend());
    ide.settle();
    assert_eq!(repo.subjects("HEAD"), ["Initial commit (amended)"]);
    assert_eq!(repo.subjects("HEAD").len(), before, "amend replaced the commit");
    assert!(repo.files_in("HEAD").contains(&"src/app.ts".to_string()));
    assert!(repo.status_short().contains("D  docs/notes.md") || repo.status_short().contains(" D docs/notes.md"));
}

#[test]
fn rollback_asks_first() {
    let fx = Fixture::new(SUITE, "rollback");
    let repo = changed_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_commit_window(&mut ide);
    // Toolbar Rollback acts on the selection.
    ide.click("src/app.ts");
    ide.click("Rollback");
    ide.settle();
    assert!(ide.state().git_ui.changes.has_confirm_dialog());
    ide.assert_text("Roll back 1 file to HEAD? Local changes are lost.");
    ide.snapshot("rollback_confirm");
    ide.click("Cancel");
    ide.settle();
    assert_ne!(repo.read("src/app.ts"), APP_TS, "Cancel keeps the change");
    ide.click("Rollback");
    ide.settle();
    let n = ide.rects("Rollback").len();
    ide.click_nth("Rollback", n - 1);
    ide.wait_for("rolled back", |s| !s.git.status.keys().any(|p| p.ends_with("src/app.ts")));
    assert_eq!(repo.read("src/app.ts"), APP_TS);

    // The context menu's Rollback... on an added file deletes it, and says so first.
    ide.right_click("src/added.ts");
    ide.settle();
    for item in ["Show Diff", "Jump to Source", "Rollback...", "Stage (git add)", "Unstage", "Delete..."] {
        assert!(ide.has(item), "context menu item {item:?}");
    }
    ide.click("Rollback...");
    ide.settle();
    ide.assert_text("src/added.ts  (will be deleted)");
    ide.snapshot("rollback_added_confirm");
    let n = ide.rects("Rollback").len();
    ide.click_nth("Rollback", n - 1);
    ide.wait_for("added file gone", |s| !s.git.status.keys().any(|p| p.ends_with("src/added.ts")));
    assert!(!repo.dir.join("src/added.ts").exists());
}

#[test]
fn diff_tab_with_f7_navigation() {
    let fx = Fixture::new(SUITE, "diff");
    let repo = big_file_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_commit_window(&mut ide);
    // Double-click on a changed file opens its diff in a tab.
    ide.double_click("big.ts");
    ide.wait_until("diff loaded", |ide| ide.state().tabs.custom_by_key("diff:wt:big.ts").is_some());
    ide.wait_for("diff model", |s| s.tabs.active_tab().is_some_and(|t| t.title() == "big.ts (Diff)") && s.is_idle());
    let hunks = diff_tab(&mut ide, "diff:wt:big.ts").hunk_count();
    assert_eq!(hunks, Some(4));
    ide.assert_text("4 differences");
    ide.snapshot("diff_first_change");

    // F7 moves to the next change, Shift+F7 back. The keys need the diff body (or nothing)
    // focused, so click into the body first.
    let body = ide.rect("Tab big.ts (Diff)");
    ide.click_at(egui::pos2(body.left() + 300.0, body.bottom() + 300.0));
    ide.key(Key::F7);
    ide.key(Key::F7);
    assert_eq!(diff_tab(&mut ide, "diff:wt:big.ts").current_hunk(), Some(2));
    ide.snapshot("diff_third_change");
    ide.key_mods(SHIFT, Key::F7);
    assert_eq!(diff_tab(&mut ide, "diff:wt:big.ts").current_hunk(), Some(1));
    // The Next button does the same as F7.
    ide.click("Next");
    assert_eq!(diff_tab(&mut ide, "diff:wt:big.ts").current_hunk(), Some(2));

    // Jump to Source opens the file at the current change.
    ide.click("Jump to Source");
    ide.wait_for("big.ts editor", |s| s.tabs.active_editor().is_some_and(|e| e.path.ends_with("big.ts")));
    ide.settle();
    let start = diff_tab(&mut ide, "diff:wt:big.ts").hunk_new_start(2).expect("hunk");
    assert_eq!(ide.cursor().0, start);
}

#[test]
fn gutter_popup_rollback_is_undoable() {
    let fx = Fixture::new(SUITE, "gutter_popup");
    let repo = changed_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/app.ts");
    let changed = ide.active_text();
    let g = ide.editor_geometry();
    ide.click_at(g.mark_center(3));
    ide.wait_until("gutter popup", |ide| ide.has("Show Diff") && ide.has("Copy"));
    ide.assert_text("Modified lines");
    ide.assert_text("const x = add(1, 2);");
    ide.snapshot_here("gutter_popup");

    ide.click("Rollback");
    ide.wait_until("rolled back in the buffer", |ide| ide.active_line(3) == "  const x = add(1, 2);");
    assert_eq!(ide.active_text(), APP_TS);
    assert!(!ide.has("Show Diff"), "the popup closed");
    // The rollback is an edit of the buffer, so Cmd+Z brings the change back.
    ide.cmd(Key::Z);
    ide.settle();
    assert_eq!(ide.active_text(), changed);
    // The disk file was never touched.
    assert_eq!(repo.read("src/app.ts"), changed);
}

#[test]
fn annotate_column_and_commit_popup() {
    let fx = Fixture::new(SUITE, "annotate");
    let repo = history_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/util.ts");
    let p = ide.caret_pos(0, 0);
    ide.right_click_at(p);
    ide.settle();
    ide.hover("Git");
    ide.wait_until("git submenu", |ide| ide.has("Annotate with Git Blame"));
    ide.click("Annotate with Git Blame");
    ide.wait_for("blame", |s| s.tabs.active_editor().is_some_and(|e| !e.annotations.is_empty()));
    ide.settle();
    let ann = ide.state().tabs.active_editor().expect("editor").annotations.clone();
    assert_eq!(ann.len(), 6);
    assert!(ann[0].starts_with("2024-01-01 Test User"), "{ann:?}");
    ide.snapshot("annotations");

    // A click on line 6's annotation ("export const ONE") shows its commit.
    let g = ide.editor_geometry();
    assert!(g.annotation_w > 0.0);
    ide.click_at(g.annotation_center(5));
    ide.wait_until("commit popup", |ide| ide.has("Copy Hash"));
    ide.assert_text("Add ONE");
    ide.assert_text("Test User <test@example.com>");
    ide.snapshot_here("commit_popup");
    ide.click("Show Diff");
    ide.wait_until("commit diff tab", |ide| ide.state().tabs.active_tab().is_some_and(|t| t.title().starts_with("util.ts @ ")));
    ide.settle();
    let key = ide.state().tabs.list.iter().find_map(|t| t.title().starts_with("util.ts @ ").then_some(t.id)).expect("tab");
    assert!(ide.state().tabs.get(key).is_some());
    ide.assert_text("1 difference");
}

/// 1200 changed files: the tree stays virtualized and the counters are right.
#[test]
fn many_changes_render() {
    let fx = Fixture::new(SUITE, "many");
    let repo = many_changes_repo(fx.path("repo"), 1200);
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_commit_window(&mut ide);
    assert_eq!(ide.state().git.changes.len(), 1200);
    ide.assert_text("1200 of 1200 selected");
    // Collapse All keeps the directories; only drawn rows have widgets.
    ide.click("\u{2212}");
    ide.settle();
    ide.assert_text("Directory pkg0");
    assert!(!ide.has("pkg0/mod0/file0.txt"));
    ide.snapshot("many_collapsed");
}
