//! Cmd+3 opens a terminal tab in the folder of the current item, like "Open In Terminal": the
//! active file's folder from the editor, the selected folder (or the selected file's folder)
//! from the Project tree, the selected crumb's folder from a focused breadcrumb bar. The
//! Terminal window opens and the new shell gets the keyboard; the editor never sees the key.

use std::path::Path;

use crate::common::*;
use egui::Key;
use harwex_ide::layout::ToolWindow;

const SUITE: &str = "terminal_here";

fn open(name: &str) -> (Fixture, Ide) {
    let fx = Fixture::new(SUITE, name);
    let repo = basic_repo(fx.path("repo"));
    let ide = Ide::open(SUITE, &repo.dir);
    (fx, ide)
}

fn editor_focused(ide: &Ide) -> bool {
    let ctx = ide.ctx();
    ide.state().ws.tabs.active_editor().is_some_and(|e| e.view.owns_focus(&ctx))
}

/// Presses Cmd+3 and checks that one new tab opened in `dir`, in a shown Terminal window, and
/// that its shell has the keyboard.
fn cmd3_opens_in(ide: &mut Ide, dir: &Path) {
    let before = ide.state().ws.terminals.len();
    ide.key_mods(CMD, Key::Num3);
    ide.settle();
    let terms = &ide.state().ws.terminals;
    assert_eq!(terms.len(), before + 1, "one new tab");
    let term = terms.terminal(terms.active_index()).expect("the new tab is active");
    assert_eq!(term.cwd(), dir);
    assert_eq!(ide.state().ws.layout.bottom, Some(ToolWindow::Terminal));
    ide.wait_until("the new shell has the keyboard", |ide| ide.state().ws.terminals.has_focus(&ide.ctx()));
}

#[test]
fn cmd3_from_the_editor_opens_the_file_folder() {
    let (_fx, mut ide) = open("editor");
    ide.open_file("src/core/deep/nested.ts");
    ide.settle();
    assert!(editor_focused(&ide), "the editor has the keys");
    let text = ide.active_text();
    let root = ide.root();
    cmd3_opens_in(&mut ide, &root.join("src/core/deep"));
    assert_eq!(ide.active_text(), text, "the editor typed nothing");
    assert!(!ide.state().ws.tabs.active_tab().expect("tab").is_dirty());

    // A focused terminal keeps Cmd+3: no second tab opens.
    let count = ide.state().ws.terminals.len();
    ide.key_mods(CMD, Key::Num3);
    ide.settle();
    assert_eq!(ide.state().ws.terminals.len(), count);
}

#[test]
fn cmd3_from_the_project_tree_opens_the_selected_folder() {
    let (_fx, mut ide) = open("tree");
    let root = ide.root();
    // A folder row: the folder itself.
    ide.click("src");
    ide.settle();
    assert!(harwex_ide::tree::has_focus(&ide.ctx()));
    cmd3_opens_in(&mut ide, &root.join("src"));

    // A file row: the file's folder. No editor tab is open, so only the tree can answer.
    ide.state_mut().ws.tree.reveal(&root, &root.join("docs/notes.md"));
    ide.settle();
    ide.click("docs/notes.md");
    ide.settle();
    assert!(harwex_ide::tree::has_focus(&ide.ctx()));
    assert!(ide.state().ws.tabs.active_tab().is_none());
    cmd3_opens_in(&mut ide, &root.join("docs"));
}

#[test]
fn cmd3_from_a_breadcrumb_opens_the_crumb_folder() {
    let (_fx, mut ide) = open("crumb");
    ide.open_file("src/core/deep/nested.ts");
    let root = ide.root();
    let text = ide.active_text();
    // Alt+Home selects the file crumb; two Lefts select the `core` folder crumb.
    ide.key_mods(ALT, Key::Home);
    ide.key(Key::ArrowLeft);
    ide.key(Key::ArrowLeft);
    assert!(ide.is_selected("Breadcrumb core"));
    cmd3_opens_in(&mut ide, &root.join("src/core"));
    assert_eq!(ide.active_text(), text, "the editor typed nothing");
}
