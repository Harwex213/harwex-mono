//! Jump to Source from the diff (task 079): F4, the toolbar button and the context menu open
//! the file at the line the diff points at. A working-tree line opens as it is; a revision's
//! line is mapped through the diff and then to the file as it is now. A file that no longer
//! exists disables the action.

use crate::common::*;
use egui::{Key, Pos2};
use harwex_ide::git::diff::{DiffTab, Side};

const SUITE: &str = "diff_jump";

/// The parent of the commit under test.
const V1: &str = "line0 one\nline1 two\nline2 three\nline3 four\nline4 five\nline5 six\n";
/// The commit: line2 deleted, line4 changed.
const V2: &str = "line0 one\nline1 two\nline3 four\nline4 FIVE\nline5 six\n";
/// The working tree after the commit: two lines inserted on top.
const V3: &str = "top a\ntop b\nline0 one\nline1 two\nline3 four\nline4 FIVE\nline5 six\n";

fn tab<'a>(ide: &'a mut Ide, key: &str) -> &'a mut DiffTab {
    ide.state_mut().ws.tabs.custom_mut::<DiffTab>(key).unwrap_or_else(|| panic!("diff tab {key}"))
}

fn wait_loaded(ide: &mut Ide, key: &str) {
    let k = key.to_string();
    ide.wait_until("diff model", move |ide| ide.state().is_idle() && ide.state().ws.tabs.custom_by_key(&k).is_some());
    ide.settle();
    assert!(tab(ide, key).hunk_count().is_some(), "diff loaded");
}

/// A point just right of the left edge of char `col`, so a press puts the caret before it.
fn at(ide: &mut Ide, key: &str, side: Side, line: usize, col: usize) -> Pos2 {
    let t = tab(ide, key);
    let a = t.char_center(side, line, col).expect("diff drawn");
    let b = t.char_center(side, line, col + 1).expect("diff drawn");
    Pos2::new(a.x - (b.x - a.x) / 2.0 + 1.0, a.y)
}

fn activate(ide: &mut Ide, title: &str) {
    let id = ide.state().ws.tabs.list.iter().find(|t| t.title() == title).map(|t| t.id).expect("tab");
    ide.state_mut().ws.tabs.activate(id);
    ide.settle();
}

/// Waits until the active tab is the editor of `rel` and returns its caret.
fn landed(ide: &mut Ide, rel: &str) -> (usize, usize) {
    let rel = rel.to_string();
    ide.wait_for("the editor tab", move |s| s.ws.tabs.active_editor().is_some_and(|e| e.path.ends_with(&rel)));
    ide.settle();
    ide.cursor()
}

/// Opens the context menu at `p` and chooses its Jump to Source (the toolbar has one too).
fn menu_jump(ide: &mut Ide, p: Pos2) {
    ide.right_click_at(p);
    ide.settle();
    let item = ide.rects("Jump to Source").into_iter().max_by(|a, b| a.width().total_cmp(&b.width())).expect("menu item");
    ide.click_at(item.center());
}

#[test]
fn f4_on_the_working_tree_side_opens_that_line() {
    let fx = Fixture::new(SUITE, "worktree");
    let repo = Repo::init(fx.path("repo"));
    repo.write("f.ts", V2);
    repo.commit_all("Initial");
    repo.write("f.ts", V3);
    let mut ide = Ide::open(SUITE, &repo.dir);
    let path = ide.root().join("f.ts");
    harwex_ide::git::diff::open_worktree_diff(ide.state_mut(), &path);
    let key = "diff:wt:f.ts";
    wait_loaded(&mut ide, key);
    assert!(ide.is_enabled("Jump to Source"));
    ide.snapshot("diff_toolbar");

    // The right side is the file itself: the same line and column.
    let p = at(&mut ide, key, Side::New, 4, 3);
    ide.click_at(p);
    ide.key(Key::F4);
    assert_eq!(landed(&mut ide, "f.ts"), (4, 3));

    // The left side (HEAD) maps through the inserted lines.
    activate(&mut ide, "f.ts (Diff)");
    let p = at(&mut ide, key, Side::Old, 3, 2);
    ide.click_at(p);
    ide.key(Key::F4);
    assert_eq!(landed(&mut ide, "f.ts"), (5, 2));
}

#[test]
fn commit_diff_maps_to_the_file_as_it_is_now() {
    let fx = Fixture::new(SUITE, "commit");
    let repo = Repo::init(fx.path("repo"));
    repo.write("f.ts", V1);
    repo.commit_all("Initial");
    repo.write("f.ts", V2);
    repo.commit_all("Change");
    repo.write("f.ts", V3);
    let mut ide = Ide::open(SUITE, &repo.dir);
    let oid = ide_git::Oid::from_str(repo.head().trim()).expect("oid");
    let path = ide.root().join("f.ts");
    harwex_ide::git::diff::open_commit_diff(ide.state_mut(), oid, &path);
    let key = format!("diff:{oid}:f.ts");
    wait_loaded(&mut ide, &key);
    let title = ide.active_title().expect("diff tab");

    // F4 from the left side: line3 is line 2 in the commit and line 4 in the working tree.
    let p = at(&mut ide, &key, Side::Old, 3, 2);
    ide.click_at(p);
    ide.key(Key::F4);
    assert_eq!(landed(&mut ide, "f.ts"), (4, 2));

    // A deleted line lands on the nearest following line.
    activate(&mut ide, &title);
    let p = at(&mut ide, &key, Side::Old, 2, 4);
    ide.click_at(p);
    ide.click("Jump to Source");
    assert_eq!(landed(&mut ide, "f.ts"), (4, 0));

    // The context menu does the same: a changed line goes to its partner.
    activate(&mut ide, &title);
    let p = at(&mut ide, &key, Side::Old, 4, 6);
    menu_jump(&mut ide, p);
    assert_eq!(landed(&mut ide, "f.ts"), (5, 6));

    // From the right side the commit's line maps to the working tree too.
    activate(&mut ide, &title);
    let p = at(&mut ide, &key, Side::New, 0, 1);
    ide.click_at(p);
    ide.key(Key::F4);
    assert_eq!(landed(&mut ide, "f.ts"), (2, 1));

    // A double click on a read-only side selects a word and does not jump.
    activate(&mut ide, &title);
    let p = at(&mut ide, &key, Side::Old, 1, 7);
    ide.double_click_at(p);
    assert_eq!(tab(&mut ide, &key).selection(), Some((Side::Old, "two".into())));
    assert_eq!(ide.active_title().as_deref(), Some(title.as_str()));
}

#[test]
fn deleted_file_disables_the_jump() {
    let fx = Fixture::new(SUITE, "deleted");
    let repo = Repo::init(fx.path("repo"));
    repo.write("gone.ts", V1);
    repo.commit_all("Initial");
    std::fs::remove_file(repo.dir.join("gone.ts")).expect("delete");
    let mut ide = Ide::open(SUITE, &repo.dir);
    let path = ide.root().join("gone.ts");
    harwex_ide::git::diff::open_worktree_diff(ide.state_mut(), &path);
    let key = "diff:wt:gone.ts";
    wait_loaded(&mut ide, key);
    assert!(!tab(&mut ide, key).can_jump());
    assert!(!ide.is_enabled("Jump to Source"));
    ide.hover("Jump to Source");
    ide.wait_until("tooltip", |ide| ide.shows_text("File no longer exists"));

    let p = at(&mut ide, key, Side::Old, 1, 2);
    ide.click_at(p);
    ide.key(Key::F4);
    ide.settle();
    assert_eq!(ide.active_title().as_deref(), Some("gone.ts (Diff)"));
    assert!(ide.state().ws.tabs.editors().next().is_none(), "no editor tab opened");

    // The menu item is there and disabled.
    ide.right_click_at(p);
    ide.settle();
    let n = ide.rects("Jump to Source").len();
    assert_eq!(n, 2, "toolbar button and menu item");
    assert!((0..n).all(|i| !ide.is_enabled_nth("Jump to Source", i)));
}
