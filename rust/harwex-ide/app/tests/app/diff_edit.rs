//! Editing the working-tree side of a diff (task 071): the right side edits the file's editor
//! document (one buffer, one undo history), Cmd+S saves, the hunks follow the text, external
//! changes show up, and the left side and commit diffs refuse input.

use crate::common::*;
use egui::{Event, Key, Pos2};
use harwex_ide::git::diff::{DiffTab, Side};

const SUITE: &str = "diff_edit";

const OLD: &str = "const alpha = 1;\nconst beta = 2;\nfunction sum(a, b) {\n  return a + b;\n}\n";
const NEW: &str = "const alpha = 1;\nconst beta = 20;\nfunction sum(a, b) {\n  return a + b;\n}\n";

fn tab<'a>(ide: &'a mut Ide, key: &str) -> &'a mut DiffTab {
    ide.state_mut().ws.tabs.custom_mut::<DiffTab>(key).unwrap_or_else(|| panic!("diff tab {key}"))
}

fn repo_with_change(fx: &Fixture) -> Repo {
    let repo = Repo::init(fx.path("repo"));
    repo.write("sel.ts", OLD);
    repo.commit_all("Initial");
    repo.write("sel.ts", NEW);
    repo
}

/// Opens the worktree diff of `rel` and waits for its model (and the hidden document).
fn open_diff(ide: &mut Ide, rel: &str) -> String {
    let path = ide.root().join(rel);
    harwex_ide::git::diff::open_worktree_diff(ide.state_mut(), &path);
    let key = format!("diff:wt:{rel}");
    ide.wait_until("diff model", |ide| ide.state().is_idle() && ide.state().ws.tabs.custom_by_key(&key).is_some());
    ide.settle();
    assert!(tab(ide, &key).hunk_count().is_some(), "diff loaded");
    key
}

/// A point just right of the left edge of char `col`, so a press puts the caret before it.
fn at(ide: &mut Ide, key: &str, side: Side, line: usize, col: usize) -> Pos2 {
    let t = tab(ide, key);
    let a = t.char_center(side, line, col).expect("diff drawn");
    let b = t.char_center(side, line, col + 1).expect("diff drawn");
    Pos2::new(a.x - (b.x - a.x) / 2.0 + 1.0, a.y)
}

fn editor_text(ide: &Ide, rel: &str) -> (String, bool) {
    let path = std::fs::canonicalize(ide.root().join(rel)).expect("file");
    let e = ide.state().ws.tabs.editors().find(|e| e.path == path).expect("editor tab");
    (e.doc.text(), e.doc.is_dirty())
}

/// Activates a tab as a press on it does: an editor tab also takes the keyboard focus.
fn activate(ide: &mut Ide, title: &str) {
    let id = ide.state().ws.tabs.list.iter().find(|t| t.title() == title).map(|t| t.id).expect("tab");
    ide.state_mut().ws.tabs.activate(id);
    if let Some(e) = ide.state_mut().ws.tabs.editor_mut(id) {
        e.view.request_focus();
    }
    ide.settle();
}

/// With the file open in an editor tab, the right side edits that tab's document: the tab shows
/// the text and the dirty mark, Cmd+S writes the file, the hunks follow, and undo works from
/// either place.
#[test]
fn right_side_edits_the_editor_tab_document() {
    let fx = Fixture::new(SUITE, "with_tab");
    let repo = repo_with_change(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("sel.ts");
    let key = open_diff(&mut ide, "sel.ts");
    assert_eq!(tab(&mut ide, &key).hunk_count(), Some(1));
    assert!(tab(&mut ide, &key).hidden_doc().is_none(), "the editor tab holds the document");

    // Type at the end of `  return a + b;`: a second change appears.
    let p = at(&mut ide, &key, Side::New, 3, 15);
    ide.click_at(p);
    // One word: the editor's undo takes typed text back word by word.
    ide.type_text("total");
    ide.settle();
    let want = "const alpha = 1;\nconst beta = 20;\nfunction sum(a, b) {\n  return a + b;total\n}\n";
    assert_eq!(editor_text(&ide, "sel.ts"), (want.to_string(), true), "the tab shows the text and is dirty");
    assert!(ide.state().ws.tabs.list.iter().any(|t| t.title() == "sel.ts" && t.is_dirty()), "the dirty mark");
    assert_eq!(tab(&mut ide, &key).hunk_count(), Some(2), "the blocks follow the edit");
    assert_eq!(tab(&mut ide, &key).hunk_new_start(1), Some(3));
    assert_eq!(repo.read("sel.ts"), NEW, "nothing is written before Cmd+S");
    ide.assert_text("2 differences");
    ide.snapshot("edited_with_tab");

    // Cmd+S in the diff saves the tab.
    ide.cmd(Key::S);
    ide.wait_for("saved", |s| s.ws.tabs.editors().all(|e| !e.doc.is_dirty()));
    assert_eq!(repo.read("sel.ts"), want);

    // Undo in the diff undoes the typing in the tab's document.
    ide.cmd(Key::Z);
    ide.settle();
    assert_eq!(editor_text(&ide, "sel.ts"), (NEW.to_string(), true));
    assert_eq!(tab(&mut ide, &key).hunk_count(), Some(1));
    // Redo, then undo the same edit from the editor tab: one history.
    ide.cmd_shift(Key::Z);
    ide.settle();
    assert_eq!(editor_text(&ide, "sel.ts").0, want);
    activate(&mut ide, "sel.ts");
    ide.cmd(Key::Z);
    ide.settle();
    assert_eq!(editor_text(&ide, "sel.ts").0, NEW, "the tab's undo takes back the diff's edit");

    // An edit in the tab shows on the right side and in the blocks when the diff draws again.
    ide.cmd(Key::ArrowDown);
    ide.type_text("x");
    ide.settle();
    let typed = editor_text(&ide, "sel.ts").0;
    assert_ne!(typed, NEW);
    activate(&mut ide, "sel.ts (Diff)");
    assert!(tab(&mut ide, &key).hunks_current());
    assert_eq!(tab(&mut ide, &key).hunk_count(), Some(2), "the typed x is a second change: {typed:?}");
}

/// Without an editor tab the diff edits a hidden document and saves it on its own after a
/// short pause; the left side refuses input, and a change on disk shows on the right side.
#[test]
fn right_side_without_a_tab_saves_on_its_own() {
    let fx = Fixture::new(SUITE, "no_tab");
    let repo = repo_with_change(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    let key = open_diff(&mut ide, "sel.ts");
    assert_eq!(tab(&mut ide, &key).hidden_doc().map(|d| d.text()).as_deref(), Some(NEW));

    // The left side refuses input.
    let p = at(&mut ide, &key, Side::Old, 0, 0);
    ide.click_at(p);
    ide.type_text("zz");
    ide.key(egui::Key::Backspace);
    ide.settle();
    assert_eq!(tab(&mut ide, &key).side_text(Side::Old).as_deref(), Some(OLD));
    assert_eq!(tab(&mut ide, &key).side_text(Side::New).as_deref(), Some(NEW));

    // Backspace on the right side takes the change back, and the file is written after the
    // debounce (settle waits for it).
    let p = at(&mut ide, &key, Side::New, 1, 15);
    ide.click_at(p);
    ide.key(Key::Backspace);
    ide.settle();
    assert_eq!(tab(&mut ide, &key).hunk_count(), Some(0), "back to HEAD: no differences");
    ide.assert_text("Contents are identical");
    assert_eq!(repo.read("sel.ts"), OLD, "saved without Cmd+S");
    assert!(!tab(&mut ide, &key).hidden_doc().expect("hidden").is_dirty());

    // Paste and Cmd+S.
    let p = at(&mut ide, &key, Side::New, 0, 0);
    ide.click_at(p);
    ide.harness.input_mut().events.push(Event::Paste("// top\n".into()));
    ide.step();
    ide.cmd(Key::S);
    ide.settle();
    assert_eq!(repo.read("sel.ts"), format!("// top\n{OLD}"));
    assert_eq!(tab(&mut ide, &key).hunk_count(), Some(1));

    // A change on disk reaches the clean hidden document, like an editor tab.
    repo.write("sel.ts", NEW);
    let path = ide.root().join("sel.ts");
    ide.state_mut().on_fs_batch(harwex_ide::watcher::FsBatch { paths: std::iter::once(path).collect(), structure_changed: false, git_changed: false });
    ide.settle();
    assert_eq!(tab(&mut ide, &key).side_text(Side::New).as_deref(), Some(NEW));
    assert_eq!(tab(&mut ide, &key).hunk_count(), Some(1));

    // An editor tab that opens takes the unsaved document over: one buffer.
    let p = at(&mut ide, &key, Side::New, 0, 0);
    ide.click_at(p);
    ide.type_text("y");
    let file = std::fs::canonicalize(ide.root().join("sel.ts")).expect("file");
    ide.state_mut().open_location(&file, None, true);
    ide.wait_for("editor tab", |s| s.ws.tabs.editor_by_path(&file).is_some());
    ide.settle();
    assert!(editor_text(&ide, "sel.ts").0.starts_with("yconst alpha"));
    assert!(tab(&mut ide, &key).hidden_doc().is_none());
}

/// A diff between two commits refuses input on both sides.
#[test]
fn commit_diff_is_read_only() {
    let fx = Fixture::new(SUITE, "commit");
    let repo = repo_with_change(&fx);
    repo.commit_all("Change beta");
    let mut ide = Ide::open(SUITE, &repo.dir);
    let oid = ide_git::Oid::from_str(repo.head().trim()).expect("oid");
    let path = ide.root().join("sel.ts");
    harwex_ide::git::diff::open_commit_diff(ide.state_mut(), oid, &path);
    ide.wait_until("commit diff", |ide| ide.active_title().is_some_and(|t| t.starts_with("sel.ts @ ")) && ide.state().is_idle());
    ide.settle();
    let key = ide.state().ws.tabs.active_tab().map(|t| match &t.content {
        harwex_ide::tabs::TabContent::Custom(c) => c.key(),
        _ => String::new(),
    });
    let key = key.expect("key");
    for side in [Side::Old, Side::New] {
        let p = at(&mut ide, &key, side, 1, 6);
        ide.click_at(p);
        ide.type_text("zz\n");
        ide.key(Key::Backspace);
        ide.harness.input_mut().events.push(Event::Paste("pasted".into()));
        ide.step();
        ide.settle();
    }
    assert_eq!(tab(&mut ide, &key).side_text(Side::Old).as_deref(), Some(OLD));
    assert_eq!(tab(&mut ide, &key).side_text(Side::New).as_deref(), Some(NEW));
    assert_eq!(repo.read("sel.ts"), NEW);
    ide.snapshot("commit_diff_read_only");
}

/// A CRLF file compares as the file holds it: an edit adds one block, not a change on every line.
#[test]
fn crlf_file_keeps_its_blocks() {
    let fx = Fixture::new(SUITE, "crlf");
    let repo = Repo::init(fx.path("repo"));
    repo.write("win.ts", &OLD.replace('\n', "\r\n"));
    repo.commit_all("Initial");
    repo.write("win.ts", &NEW.replace('\n', "\r\n"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    let key = open_diff(&mut ide, "win.ts");
    assert_eq!(tab(&mut ide, &key).hunk_count(), Some(1));
    let p = at(&mut ide, &key, Side::New, 3, 15);
    ide.click_at(p);
    ide.type_text("x");
    ide.settle();
    assert_eq!(tab(&mut ide, &key).hunk_count(), Some(2));
    assert_eq!(repo.read("win.ts"), NEW.replace('\n', "\r\n").replace("a + b;", "a + b;x"), "saved with CRLF");
}
