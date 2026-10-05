//! Multi-selection in the Project tree and the move preview: Cmd+click, Shift+click,
//! Shift+arrows and Cmd+A; drag and drop, Cut + Paste and Delete of several items; the menu
//! for several items; the import preview before a move (Cancel writes nothing, Move updates
//! the imports, one combined preview for several items).
//!
//! The app gets a recording platform in deterministic mode, so nothing here touches the real
//! Trash or clipboard.

use crate::common::*;
use egui::{Event, Key, Modifiers, PointerButton, Pos2};

const SUITE: &str = "tree_multi";

fn reveal(ide: &mut Ide, rel: &str) {
    let root = ide.root();
    let path = root.join(rel);
    ide.state_mut().ws.tree.reveal(&root, &path);
    ide.settle();
}

/// The selected rows, relative to the project root, in selection order.
fn selection(ide: &Ide) -> Vec<String> {
    let root = ide.root();
    ide.state().ws.tree.selection().iter().map(|p| p.strip_prefix(&root).expect("under root").display().to_string()).collect()
}

fn click_with(ide: &mut Ide, label: &str, mods: Modifiers) {
    let c = ide.rect(label).center();
    ide.click_button_at(c, PointerButton::Primary, mods);
    ide.settle();
}

/// Sends a clipboard event the way macOS delivers ⌘X / ⌘C / ⌘V: only the event.
fn clipboard_event(ide: &mut Ide, ev: Event) {
    ide.harness.input_mut().modifiers = CMD;
    ide.harness.input_mut().events.push(ev);
    ide.step();
    ide.harness.input_mut().modifiers = Modifiers::NONE;
    ide.settle();
}

/// Presses on `from` and moves to `to` in small steps. The button stays down.
fn drag_to(ide: &mut Ide, from: Pos2, to: Pos2) {
    ide.idle(1.5);
    ide.move_to(from);
    ide.harness.input_mut().events.push(Event::PointerButton { pos: from, button: PointerButton::Primary, pressed: true, modifiers: Modifiers::NONE });
    ide.step();
    for i in 1..=8 {
        ide.move_to(from + (to - from) * (i as f32 / 8.0));
    }
}

fn release(ide: &mut Ide) {
    let pos = ide.ctx().input(|i| i.pointer.latest_pos()).expect("pointer");
    ide.harness.input_mut().events.push(Event::PointerButton { pos, button: PointerButton::Primary, pressed: false, modifiers: Modifiers::NONE });
    ide.step();
    ide.step();
}

fn docs_repo(fx: &Fixture) -> Repo {
    let repo = basic_repo(fx.path("repo"));
    for name in ["a", "b", "c"] {
        repo.write(&format!("docs/{name}.md"), &format!("# {name}\n"));
    }
    repo.write("archive/keep.txt", "keep\n");
    repo.commit_all("docs");
    repo
}

#[test]
fn selection_gestures() {
    let fx = Fixture::new(SUITE, "gestures");
    let repo = docs_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    reveal(&mut ide, "src/util.ts");
    reveal(&mut ide, "docs/a.md");

    // Shift+click selects the range from the clicked row.
    ide.click("docs/a.md");
    click_with(&mut ide, "docs/c.md", SHIFT);
    assert_eq!(selection(&ide), ["docs/a.md", "docs/b.md", "docs/c.md"]);
    // Cmd+click takes a row out and puts another in.
    click_with(&mut ide, "docs/b.md", CMD);
    assert_eq!(selection(&ide), ["docs/a.md", "docs/c.md"]);
    click_with(&mut ide, "src/app.ts", CMD);
    assert_eq!(selection(&ide), ["docs/a.md", "docs/c.md", "src/app.ts"]);
    for (label, selected) in [("docs/a.md", true), ("docs/b.md", false), ("docs/c.md", true), ("src/app.ts", true), ("src/util.ts", false)] {
        assert_eq!(ide.is_selected(label), selected, "{label}");
    }
    assert!(harwex_ide::tree::has_focus(&ide.ctx()));
    ide.snapshot("multi_selection");

    // The menu of a selected row acts on all of them: one-item commands are disabled.
    ide.right_click("docs/c.md");
    ide.settle();
    assert_eq!(selection(&ide).len(), 3, "a right-click inside the selection keeps it");
    for label in ["New File...", "New Directory...", "Rename...", "Paste", "Find Usages", "Open In Terminal"] {
        assert!(!ide.is_enabled(label), "{label} needs one item");
    }
    for label in ["Cut", "Copy", "Copy Absolute Path", "Delete..."] {
        assert!(ide.is_enabled(label), "{label} works on several");
    }
    ide.snapshot("multi_menu");
    ide.click("Copy Project Path");
    ide.settle();
    assert_eq!(ide.state().platform.calls().last().map(String::as_str), Some("copy docs/a.md\ndocs/c.md\nsrc/app.ts"));

    // A plain press on a selected row keeps the selection until the release (so a drag would
    // take all of them); the release without a drag selects that row alone.
    let c = ide.rect("docs/c.md").center();
    ide.idle(1.5);
    ide.move_to(c);
    ide.pointer_frame(0.05, &[(c, true)]);
    assert_eq!(selection(&ide).len(), 3, "still the whole selection while the button is down");
    ide.pointer_frame(0.05, &[(c, false)]);
    ide.settle();
    assert_eq!(selection(&ide), ["docs/c.md"]);

    // Shift+arrows extend from the anchor; Up past it shrinks and then grows the other way.
    ide.key_mods(SHIFT, Key::ArrowDown);
    ide.key_mods(SHIFT, Key::ArrowDown);
    assert_eq!(selection(&ide), ["docs/c.md", "docs/notes.md", "src"]);
    for _ in 0..4 {
        ide.key_mods(SHIFT, Key::ArrowUp);
    }
    assert_eq!(selection(&ide), ["docs/a.md", "docs/b.md", "docs/c.md"]);
    // A plain arrow goes back to one row.
    ide.key(Key::ArrowDown);
    assert_eq!(selection(&ide), ["docs/b.md"]);

    // Cmd+A selects every visible row.
    ide.key_mods(CMD, Key::A);
    let all = selection(&ide);
    for row in ["archive", "docs", "docs/a.md", "docs/notes.md", "src", "src/core", "src/util.ts", "README.md", ".gitignore"] {
        assert!(all.iter().any(|r| r == row), "{row} in {all:?}");
    }
    assert!(!all.iter().any(|r| r == "archive/keep.txt"), "rows of collapsed folders are not visible");
    assert_eq!(ide.state().ws.tree.selected.as_deref(), Some(ide.root().join("docs/b.md").as_path()), "the lead stays");
}

#[test]
fn drag_moves_three_items() {
    let fx = Fixture::new(SUITE, "drag_three");
    let repo = docs_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    let root = ide.root();
    reveal(&mut ide, "docs/a.md");
    ide.click("docs/a.md");
    click_with(&mut ide, "docs/c.md", SHIFT);
    assert_eq!(selection(&ide).len(), 3);

    let from = ide.rect("docs/b.md").center();
    let to = ide.rect("archive").center();
    drag_to(&mut ide, from, to);
    assert!(ide.has("Drop target archive"));
    assert_eq!(selection(&ide).len(), 3, "the drag keeps the selection");
    ide.snapshot_here("drag_three_items");
    release(&mut ide);
    ide.wait_for("moved", |_| ["a", "b", "c"].iter().all(|n| root.join(format!("archive/{n}.md")).is_file() && !root.join(format!("docs/{n}.md")).exists()));
    ide.settle();
    assert!(ide.state().ws.tree_ops.dialog.is_none(), "no imports, so no preview");
    assert_eq!(selection(&ide), ["archive/a.md", "archive/b.md", "archive/c.md"], "the moved items stay selected");
    assert!(ide.has("archive/b.md"));
}

#[test]
fn cut_and_paste_two_items() {
    let fx = Fixture::new(SUITE, "cut_two");
    let repo = docs_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    let root = ide.root();
    reveal(&mut ide, "docs/a.md");
    ide.click("docs/a.md");
    click_with(&mut ide, "docs/notes.md", CMD);
    clipboard_event(&mut ide, Event::Cut);
    assert!(ide.state().ws.tree_ops.is_cut(&root.join("docs/a.md")) && ide.state().ws.tree_ops.is_cut(&root.join("docs/notes.md")));
    assert!(!ide.state().ws.tree_ops.is_cut(&root.join("docs/b.md")));
    assert_eq!(ide.state().platform.calls().last().map(String::as_str), Some("copy a.md\nnotes.md"));

    ide.click("archive");
    clipboard_event(&mut ide, Event::Paste("a.md".into()));
    ide.wait_for("moved", |_| root.join("archive/a.md").is_file() && root.join("archive/notes.md").is_file());
    ide.settle();
    assert!(!root.join("docs/a.md").exists() && !root.join("docs/notes.md").exists());
    assert!(root.join("docs/b.md").is_file());
    assert!(ide.state().ws.tree_ops.clip.is_none(), "the cut is used up");
}

#[test]
fn delete_two_items_asks_once() {
    let fx = Fixture::new(SUITE, "delete_two");
    let repo = docs_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    let root = ide.root();
    reveal(&mut ide, "docs/a.md");
    ide.click("docs/a.md");
    click_with(&mut ide, "docs/c.md", CMD);
    ide.key(Key::Backspace);
    ide.wait_for("usages", |s| matches!(&s.ws.tree_ops.dialog, Some(harwex_ide::tree_menu::Dialog::Delete(d)) if matches!(&d.usages, harwex_ide::tree_menu::Usages::Found(_))));
    ide.settle();
    ide.assert_text("Move 2 items to the Trash: a.md, c.md?");
    ide.click("Delete");
    ide.wait_for("trashed", |_| !root.join("docs/a.md").exists() && !root.join("docs/c.md").exists());
    ide.settle();
    assert_eq!(ide.state().platform.calls(), [format!("trash {}", root.join("docs/a.md").display()), format!("trash {}", root.join("docs/c.md").display())]);
    assert!(root.join("docs/b.md").is_file());
    assert!(ide.state().ws.tree_ops.dialog.is_none());
}

fn move_preview_shown(s: &harwex_ide::state::AppState) -> bool {
    matches!(&s.ws.tree_ops.dialog, Some(harwex_ide::tree_menu::Dialog::Move(d)) if matches!(d.phase, harwex_ide::tree_menu::MovePhase::Preview(_)))
}

#[test]
fn move_preview_of_two_items() {
    if skip_without_tsserver("move_preview_of_two_items") {
        return;
    }
    let fx = Fixture::new(SUITE, "move_preview");
    let repo = ts_project(fx.path("repo"));
    // extra.ts imports local.ts; both move, so that import must stay "./local".
    repo.write("src/extra.ts", "import { localHelper } from \"./local\";\n\nexport const extra = localHelper(1);\n");
    repo.write("src/use_extra.ts", "import { extra } from \"./extra\";\n\nconsole.log(extra);\n");
    repo.write("src/lib/keep.ts", "export const keep = 1;\n");
    repo.commit_all("more");
    let mut ide = Ide::open(SUITE, &repo.dir);
    let root = ide.root();
    reveal(&mut ide, "src/lib/keep.ts");
    ide.click("src/local.ts");
    click_with(&mut ide, "src/extra.ts", CMD);
    clipboard_event(&mut ide, Event::Cut);
    ide.click("src/lib");
    clipboard_event(&mut ide, Event::Paste("local.ts".into()));
    ide.wait_for("move preview", move_preview_shown);
    ide.settle();
    ide.assert_text("Move 2 items to src/lib and update 3 imports in 3 files");
    ide.snapshot("move_preview");

    // Cancel writes nothing.
    ide.click("Cancel");
    ide.settle();
    assert!(ide.state().ws.tree_ops.dialog.is_none());
    assert!(root.join("src/local.ts").is_file() && root.join("src/extra.ts").is_file() && !root.join("src/lib/local.ts").exists());
    assert_eq!(repo.read("src/main.ts"), MAIN_TS);
    assert!(repo.read("src/use_extra.ts").contains("from \"./extra\""));

    // The cut is still there: paste again and Move.
    ide.click("src/lib");
    clipboard_event(&mut ide, Event::Paste("local.ts".into()));
    ide.wait_for("move preview", move_preview_shown);
    ide.settle();
    ide.click("Move");
    ide.wait_for("moved", |_| root.join("src/lib/local.ts").is_file() && root.join("src/lib/extra.ts").is_file() && !root.join("src/local.ts").exists());
    ide.wait_for("idle", |s| s.is_idle());
    assert!(repo.read("src/main.ts").contains("from \"./lib/local\""), "{}", repo.read("src/main.ts"));
    assert!(repo.read("src/use_extra.ts").contains("from \"./lib/extra\""), "{}", repo.read("src/use_extra.ts"));
    assert!(repo.read("src/lib/extra.ts").contains("from \"./local\""), "{}", repo.read("src/lib/extra.ts"));
}

fn collision_at(ide: &mut Ide, name: &str) {
    ide.wait_for("already exists dialog", |s| matches!(&s.ws.tree_ops.dialog, Some(harwex_ide::tree_menu::Dialog::Collision { .. })));
    ide.settle();
    ide.assert_text(&format!("\"{name}\" already exists in archive."));
}

fn twins_repo(fx: &Fixture) -> Repo {
    let repo = docs_repo(fx);
    for (dir, text) in [("x", "from x\n"), ("y", "from y\n")] {
        repo.write(&format!("{dir}/same.md"), text);
    }
    repo.commit_all("twins");
    repo
}

/// Selects x/same.md and y/same.md.
fn select_twins(ide: &mut Ide) {
    reveal(ide, "x/same.md");
    reveal(ide, "y/same.md");
    ide.click("x/same.md");
    click_with(ide, "y/same.md", CMD);
    assert_eq!(selection(ide), ["x/same.md", "y/same.md"]);
}

/// Two selected items with one name clash with each other, not only with files in the target.
#[test]
fn same_name_items_clash_with_each_other() {
    let fx = Fixture::new(SUITE, "twins");
    let repo = twins_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    let root = ide.root();

    // A drop: the second same.md asks; Keep Both gives it a free name.
    select_twins(&mut ide);
    let from = ide.rect("x/same.md").center();
    let to = ide.rect("archive").center();
    drag_to(&mut ide, from, to);
    release(&mut ide);
    collision_at(&mut ide, "same.md");
    assert!(root.join("x/same.md").is_file() && root.join("y/same.md").is_file(), "nothing moves before the answer");
    ide.click("Keep Both");
    ide.wait_for("moved", |_| root.join("archive/same.md").is_file() && root.join("archive/same copy.md").is_file());
    ide.settle();
    assert_eq!(repo.read("archive/same.md"), "from x\n");
    assert_eq!(repo.read("archive/same copy.md"), "from y\n");
    assert!(!root.join("x/same.md").exists() && !root.join("y/same.md").exists());

    // Cut + Paste: Skip leaves the second one in place.
    repo.write("x/same.md", "x again\n");
    repo.write("y/same.md", "y again\n");
    std::fs::remove_file(root.join("archive/same.md")).expect("remove");
    std::fs::remove_file(root.join("archive/same copy.md")).expect("remove");
    ide.state_mut().on_fs_batch(harwex_ide::watcher::FsBatch { paths: [root.join("x"), root.join("y"), root.join("archive")].into_iter().collect(), structure_changed: true, git_changed: true });
    ide.settle();
    select_twins(&mut ide);
    clipboard_event(&mut ide, Event::Cut);
    ide.click("archive");
    clipboard_event(&mut ide, Event::Paste("same.md".into()));
    collision_at(&mut ide, "same.md");
    ide.click("Skip");
    ide.wait_for("moved", |_| root.join("archive/same.md").is_file() && !root.join("x/same.md").exists());
    ide.settle();
    assert_eq!(repo.read("archive/same.md"), "x again\n");
    assert_eq!(repo.read("y/same.md"), "y again\n", "skipped");
    assert!(!root.join("archive/same copy.md").exists());

    // Copy + Paste: Overwrite puts the second over the first; the first goes to the Trash.
    std::fs::remove_file(root.join("archive/same.md")).expect("remove");
    repo.write("x/same.md", "x third\n");
    ide.state_mut().on_fs_batch(harwex_ide::watcher::FsBatch { paths: [root.join("x"), root.join("archive")].into_iter().collect(), structure_changed: true, git_changed: true });
    ide.settle();
    select_twins(&mut ide);
    clipboard_event(&mut ide, Event::Copy);
    ide.click("archive");
    clipboard_event(&mut ide, Event::Paste("same.md".into()));
    collision_at(&mut ide, "same.md");
    ide.click("Overwrite");
    ide.wait_for("copied", |_| std::fs::read_to_string(root.join("archive/same.md")).is_ok_and(|t| t == "y again\n"));
    ide.settle();
    assert!(ide.state().platform.calls().contains(&format!("trash {}", root.join("archive/same.md").display())), "the first copy went to the Trash, not lost");
    assert_eq!(repo.read("x/same.md"), "x third\n");
    assert_eq!(repo.read("y/same.md"), "y again\n");
}

/// Several items that exist in the target: one dialog per clash, in order.
#[test]
fn already_exists_dialog_for_several_items() {
    let fx = Fixture::new(SUITE, "exists_many");
    let repo = docs_repo(&fx);
    repo.write("archive/a.md", "old a\n");
    repo.write("archive/b.md", "old b\n");
    repo.commit_all("old");
    let mut ide = Ide::open(SUITE, &repo.dir);
    let root = ide.root();
    reveal(&mut ide, "docs/a.md");
    ide.click("docs/a.md");
    click_with(&mut ide, "docs/c.md", SHIFT);
    clipboard_event(&mut ide, Event::Copy);
    ide.click("archive");
    clipboard_event(&mut ide, Event::Paste("a.md".into()));
    collision_at(&mut ide, "a.md");
    ide.assert_text("Item 1 of 3: docs/a.md");
    assert!(ide.has("Skip"), "several items can skip one");
    ide.snapshot("collision_several");
    ide.click("Skip");
    collision_at(&mut ide, "b.md");
    ide.assert_text("Item 2 of 3: docs/b.md");
    ide.click("Overwrite");
    ide.wait_for("copied", |_| root.join("archive/c.md").is_file() && std::fs::read_to_string(root.join("archive/b.md")).is_ok_and(|t| t == "# b\n"));
    ide.settle();
    assert_eq!(repo.read("archive/a.md"), "old a\n", "skipped");
    assert_eq!(ide.state().platform.calls().iter().filter(|c| c.starts_with("trash ")).count(), 1, "only b.md was overwritten");
    assert!(ide.state().ws.tree_ops.dialog.is_none());
}
