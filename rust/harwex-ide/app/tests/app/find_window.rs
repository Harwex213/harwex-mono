//! The bottom Find window (task 043): Find Usages and Find in Files tabs, the grouped result
//! tree with counts, the toolbar, Delete, Enter / double click, and the editable preview. The
//! usages here come from `find_window::start_usages` + `finish_usages` with fixed references,
//! so no language server is needed; `navigation` covers the tsserver path.

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use crate::common::*;
use egui::Key;
use harwex_ide::find_window::{self, NodeKey, SearchScope, UsageOrigin};
use harwex_ide::lang::{Location, Reference};
use harwex_ide::layout::ToolWindow;

const SUITE: &str = "find_window";

/// `basic_repo` plus a package two folders deep that calls `add`.
fn repo(fx: &Fixture) -> Repo {
    let r = basic_repo(fx.path("repo"));
    r.write(
        "packages/calc/src/sum.ts",
        "import { add } from \"../../../src/util\";\n\nexport const sum = add(add(1, 2), 3);\n",
    );
    r.commit_all("calc");
    r
}

fn reference(
    root: &Path,
    rel: &str,
    line: usize,
    column: usize,
    len: usize,
    text: &str,
    def: bool,
) -> Reference {
    Reference {
        location: Location {
            path: root.join(rel),
            line,
            column,
        },
        end_line: line,
        end_column: column + len,
        line_text: text.to_string(),
        is_definition: def,
        is_write: false,
    }
}

/// The usages of `add` in `repo`, as a language server reports them.
fn add_refs(root: &Path) -> Vec<Reference> {
    vec![
        reference(
            root,
            "src/util.ts",
            0,
            16,
            3,
            "export function add(a: number, b: number): number {",
            true,
        ),
        reference(
            root,
            "src/app.ts",
            0,
            9,
            3,
            "import { add } from \"./util\";",
            false,
        ),
        reference(
            root,
            "src/app.ts",
            3,
            12,
            3,
            "  const x = add(1, 2);",
            false,
        ),
        reference(
            root,
            "packages/calc/src/sum.ts",
            0,
            9,
            3,
            "import { add } from \"../../../src/util\";",
            false,
        ),
        reference(
            root,
            "packages/calc/src/sum.ts",
            2,
            19,
            3,
            "export const sum = add(add(1, 2), 3);",
            false,
        ),
        reference(
            root,
            "packages/calc/src/sum.ts",
            2,
            23,
            3,
            "export const sum = add(add(1, 2), 3);",
            false,
        ),
    ]
}

/// Opens a usages tab with `refs` the way `nav::usages` does, and waits for the preview.
fn show_usages(ide: &mut Ide, word: &str, refs: Vec<Reference>) -> u64 {
    let root = ide.root();
    let origin = UsageOrigin::Symbol {
        path: root.join("src/util.ts"),
        pos: ide_editor::Position::new(0, 16),
        word: word.to_string(),
    };
    let (tab, generation) = find_window::start_usages(ide.state_mut(), origin, None);
    find_window::finish_usages(ide.state_mut(), tab, generation, Ok(refs));
    ide.settle();
    tall(ide);
    tab
}

/// Drags the Find window's top edge up, so the whole result tree fits (rows off screen have
/// no accessibility node).
fn tall(ide: &mut Ide) {
    let top = ide.rect("Hide Find").min.y - harwex_ide::theme::T.space.gap / 2.0 - 3.0;
    if top < 300.0 {
        return;
    }
    ide.drag(egui::pos2(640.0, top), egui::pos2(640.0, 180.0));
    ide.settle();
}

fn open_repo(name: &str) -> (Fixture, Repo, Ide) {
    let fx = Fixture::new(SUITE, name);
    let repo = repo(&fx);
    let ide = Ide::open(SUITE, &repo.dir);
    (fx, repo, ide)
}

fn active(ide: &Ide) -> &find_window::FindTab {
    ide.state().ws.find_window.active_tab().expect("a Find tab")
}

fn item_count(ide: &Ide) -> usize {
    active(ide).items.len()
}

#[test]
fn usages_tab_groups_folders_and_counts() {
    let (_fx, _repo, mut ide) = open_repo("usages");
    let root = ide.root();
    show_usages(&mut ide, "add", add_refs(&root));
    assert_eq!(ide.state().ws.layout.bottom, Some(ToolWindow::Find));
    assert_eq!(active(&ide).title, "add in Project Files");
    for label in [
        "Find tab add in Project Files",
        "Declarations group",
        "Imports group",
        "Reads group",
        "Find folder packages/calc/src in Imports",
        "Find file src/app.ts in Reads",
        "src/app.ts:4:13",
    ] {
        assert!(
            ide.has(label),
            "{label} is shown; labels: {:?}",
            ide.labels()
        );
    }
    // A chain of single-child folders is one row; folders and files show their counts.
    assert!(!ide.has("Find folder packages in Imports"));
    ide.assert_text("Imports group");
    // The first result is selected and shown in the preview.
    assert_eq!(
        active(&ide).selected,
        Some(NodeKey::Item(active(&ide).items[0].id))
    );
    ide.wait_for("preview loaded", |s| {
        s.ws.find_window
            .active_tab()
            .is_some_and(|t| t.preview.hidden_doc().is_some())
    });
    ide.snapshot("usages");

    // A second search opens a second tab; the first one stays.
    show_usages(
        &mut ide,
        "ZERO",
        vec![reference(
            &root,
            "src/util.ts",
            4,
            13,
            4,
            "export const ZERO = 0;",
            true,
        )],
    );
    let fw = &ide.state().ws.find_window;
    assert_eq!(
        fw.tabs.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(),
        ["add in Project Files", "ZERO in Project Files"]
    );
    assert_eq!(fw.active, 1);
    ide.snapshot("two_tabs");

    // A press on the first tab activates it.
    ide.click("Find tab add in Project Files");
    assert_eq!(ide.state().ws.find_window.active, 0);
}

#[test]
fn tabs_reorder_and_close() {
    let (_fx, _repo, mut ide) = open_repo("tabs");
    let root = ide.root();
    show_usages(&mut ide, "add", add_refs(&root));
    show_usages(
        &mut ide,
        "ZERO",
        vec![reference(
            &root,
            "src/util.ts",
            4,
            13,
            4,
            "export const ZERO = 0;",
            true,
        )],
    );
    let titles = |ide: &Ide| {
        ide.state()
            .ws
            .find_window
            .tabs
            .iter()
            .map(|t| t.title.clone())
            .collect::<Vec<_>>()
    };
    // Drag the second tab in front of the first.
    let from = ide.rect("Find tab ZERO in Project Files").center();
    let to = ide.rect("Find tab add in Project Files").left_center() + egui::vec2(4.0, 0.0);
    ide.drag(from, to);
    ide.settle();
    assert_eq!(
        titles(&ide),
        ["ZERO in Project Files", "add in Project Files"]
    );
    assert_eq!(
        ide.state().ws.find_window.active,
        0,
        "the dropped tab is active"
    );
    // The cross closes a tab; closing the last one hides the window.
    ide.click("Close ZERO in Project Files");
    ide.settle();
    assert_eq!(titles(&ide), ["add in Project Files"]);
    ide.click("Close add in Project Files");
    ide.settle();
    assert!(ide.state().ws.find_window.tabs.is_empty());
    assert_eq!(ide.state().ws.layout.bottom, None);
}

#[test]
fn delete_excludes_and_enter_opens() {
    let (_fx, _repo, mut ide) = open_repo("delete");
    let root = ide.root();
    show_usages(&mut ide, "add", add_refs(&root));
    assert_eq!(item_count(&ide), 6);
    // Delete on a result row drops that result.
    ide.click("src/app.ts:4:13");
    assert!(ide.is_focused("Find results"));
    ide.key(Key::Delete);
    ide.settle();
    assert_eq!(item_count(&ide), 5);
    assert!(!ide.has("src/app.ts:4:13"));
    // Delete on a folder drops everything under it.
    ide.click("Find folder packages/calc/src in Reads");
    ide.key(Key::Delete);
    ide.settle();
    assert_eq!(item_count(&ide), 3);
    assert!(!ide.has("Find folder packages/calc/src in Reads"));
    assert!(ide.has("Find folder packages/calc/src in Imports"));

    // Enter opens the selected result in the editor at its position.
    ide.click("src/app.ts:1:10");
    ide.key(Key::Enter);
    ide.wait_for("app.ts opened", |s| {
        s.ws.tabs
            .active_editor()
            .is_some_and(|e| e.path.ends_with("src/app.ts"))
    });
    ide.settle();
    assert_eq!(ide.cursor(), (0, 9));
    // A double click opens too.
    ide.double_click("src/util.ts:1:17");
    ide.wait_for("util.ts opened", |s| {
        s.ws.tabs
            .active_editor()
            .is_some_and(|e| e.path.ends_with("src/util.ts"))
    });
    ide.settle();
    assert_eq!(ide.cursor(), (0, 16));
}

#[test]
fn toolbar_steps_expands_and_collapses() {
    let (_fx, _repo, mut ide) = open_repo("toolbar");
    let root = ide.root();
    show_usages(&mut ide, "add", add_refs(&root));
    let selected_line = |ide: &Ide| {
        active(ide).selected_item().map(|i| {
            (
                i.path
                    .strip_prefix(ide.root())
                    .unwrap()
                    .display()
                    .to_string(),
                i.line,
            )
        })
    };
    assert_eq!(selected_line(&ide), Some(("src/util.ts".into(), 0)));
    ide.click("Next Occurrence");
    assert_eq!(
        selected_line(&ide),
        Some(("packages/calc/src/sum.ts".into(), 0))
    );
    ide.click("Previous Occurrence");
    ide.click("Previous Occurrence");
    // Wraps around to the last result.
    assert_eq!(selected_line(&ide), Some(("src/app.ts".into(), 3)));
    ide.click("Collapse All");
    ide.settle();
    assert!(!ide.has("Find file src/app.ts in Reads"));
    assert!(ide.has("Reads group"));
    // Next Occurrence expands the folders of the result it selects.
    ide.click("Next Occurrence");
    ide.settle();
    assert!(ide.has("src/util.ts:1:17"));
    ide.click("Expand All");
    ide.settle();
    assert!(ide.has("Find file src/app.ts in Reads"));
}

#[test]
fn text_tab_reruns() {
    let (_fx, repo, mut ide) = open_repo("rerun");
    let root = ide.root();
    let query = harwex_ide::find::Query {
        text: "add".into(),
        ..Default::default()
    };
    let (hits, _) =
        harwex_ide::find::search(&root.join("src"), &query, &[], &AtomicBool::new(false))
            .expect("search");
    find_window::open_text_results(
        ide.state_mut(),
        query.clone(),
        SearchScope::Directory {
            path: root.join("src"),
            recursive: true,
        },
        None,
        hits,
        true,
    );
    ide.settle();
    assert_eq!(active(&ide).title, "\"add\" in Directory src");
    assert_eq!(item_count(&ide), 3);
    assert!(ide.has("Find file src/app.ts"));
    ide.snapshot("text_results");

    // ⟳ searches again with the same query and scope.
    // The tests run no watcher: tell the app about the new file as the watcher would, so the
    // file index (which the project search reads) picks it up.
    repo.write("src/more.ts", "export const b = add(1, 1);\n");
    let batch = harwex_ide::watcher::FsBatch { paths: std::iter::once(root.join("src/more.ts")).collect(), structure_changed: true, git_changed: false };
    ide.state_mut().on_fs_batch(batch);
    ide.settle();
    ide.click("Rerun");
    ide.wait_for("rerun", |s| {
        s.ws.find_window
            .active_tab()
            .is_some_and(|t| !t.searching && t.items.len() == 4)
    });
    // Open in Find Window without a new tab reuses the active text tab.
    let (hits, _) =
        harwex_ide::find::search(&root, &query, &[], &AtomicBool::new(false)).expect("search");
    find_window::open_text_results(
        ide.state_mut(),
        query,
        SearchScope::Project,
        None,
        hits,
        false,
    );
    ide.settle();
    assert_eq!(ide.state().ws.find_window.tabs.len(), 1);
    assert_eq!(active(&ide).title, "\"add\" in Project Files");
    assert_eq!(item_count(&ide), 7);
}

/// Point of a char in the preview's editor (0-based).
fn preview_pos(ide: &Ide, line: usize, column: usize) -> egui::Pos2 {
    let s = ide.state();
    let tab = s.ws.find_window.active_tab().expect("tab");
    let g = tab.preview.view().geometry().expect("preview drawn");
    let path = tab.preview.path.clone().expect("preview path");
    let doc = match s.ws.tabs.editor_by_path(&path) {
        Some(_) => {
            &s.ws
                .tabs
                .editors()
                .find(|e| e.path == path)
                .expect("tab")
                .doc
        }
        None => tab.preview.hidden_doc().expect("hidden doc"),
    };
    // Left of the char's middle, so a click puts the caret before it.
    g.char_center(doc, ide_editor::Position::new(line, column)) - egui::vec2(g.char_w * 0.3, 0.0)
}

fn read(path: &PathBuf) -> String {
    std::fs::read_to_string(path).expect("read")
}

#[test]
fn preview_edits_a_closed_file_and_saves() {
    let (_fx, _repo, mut ide) = open_repo("preview_closed");
    let root = ide.root();
    show_usages(&mut ide, "add", add_refs(&root));
    // util.ts is not open: the preview loads it on a worker.
    ide.wait_for("preview loaded", |s| {
        s.ws.find_window
            .active_tab()
            .is_some_and(|t| t.preview.hidden_doc().is_some())
    });
    ide.settle();
    let util = root.join("src/util.ts");
    let before = read(&util);
    // The match is selected in the preview.
    let sel = active(&ide).preview.view().selection();
    assert_eq!((sel.start(), sel.end()), (16, 19));
    let p = preview_pos(&ide, 4, 0);
    ide.click_at(p);
    ide.type_text("zz");
    ide.wait_for("saved", |s| {
        s.ws.find_window
            .active_tab()
            .is_some_and(|t| t.preview.hidden_doc().is_some_and(|d| !d.is_dirty()))
    });
    assert!(
        read(&util).contains("\nzzexport const ZERO"),
        "{}",
        read(&util)
    );
    assert!(
        ide.state().ws.tabs.editor_by_path(&util).is_none(),
        "no tab opened"
    );
    // Undo in the preview, saved again.
    ide.cmd(Key::Z);
    ide.wait_for("undo saved", |s| {
        s.ws.find_window
            .active_tab()
            .is_some_and(|t| t.preview.hidden_doc().is_some_and(|d| !d.is_dirty()))
    });
    ide.settle();
    assert_eq!(read(&util), before);
    ide.snapshot("preview_closed");
}

#[test]
fn preview_edits_an_open_file() {
    let (_fx, _repo, mut ide) = open_repo("preview_open");
    let root = ide.root();
    ide.open_file("src/app.ts");
    show_usages(&mut ide, "add", add_refs(&root));
    ide.click("src/app.ts:4:13");
    ide.settle();
    let app = root.join("src/app.ts");
    assert_eq!(active(&ide).preview.path.as_ref(), Some(&app));
    assert!(
        active(&ide).preview.hidden_doc().is_none(),
        "an open file is edited through its tab"
    );
    let p = preview_pos(&ide, 4, 2);
    ide.click_at(p);
    ide.type_text("x;");
    let tab_text = |ide: &Ide| {
        ide.state()
            .ws
            .tabs
            .editors()
            .find(|e| e.path.ends_with("src/app.ts"))
            .expect("tab")
            .doc
            .text()
    };
    assert!(
        tab_text(&ide).contains("  x;return x;"),
        "{}",
        tab_text(&ide)
    );
    ide.wait_for("saved", |s| {
        s.ws.tabs
            .editors()
            .any(|e| e.path.ends_with("src/app.ts") && !e.doc.is_dirty())
    });
    assert!(read(&app).contains("  x;return x;"));
    ide.cmd(Key::Z);
    ide.wait_for("undo saved", |s| {
        s.ws.tabs
            .editors()
            .any(|e| e.path.ends_with("src/app.ts") && !e.doc.is_dirty())
    });
    assert_eq!(read(&app), APP_TS);
    assert_eq!(tab_text(&ide), APP_TS);
}

#[test]
fn old_layout_storage_loads() {
    let fx = Fixture::new(SUITE, "old_layout");
    let repo = basic_repo(fx.path("repo"));
    let root = std::fs::canonicalize(&repo.dir).expect("canonical");
    let mut storage = MemoryStorage::default();
    // Saved by a version with the left Find window and the bottom Find Usages window.
    storage
        .map
        .insert("tool_windows".into(), "left=Find;bottom=Find Usages".into());
    storage
        .map
        .insert("open_projects".into(), root.display().to_string());
    storage
        .map
        .insert("active_project".into(), root.display().to_string());
    storage.map.insert(
        "project_state".into(),
        format!("{}\tleft=Find;bottom=Find Usages\t", root.display()),
    );
    let options = harwex_ide::AppOptions {
        restore_last_folder: true,
        ..test_options(None)
    };
    let mut ide = Ide::with_options(SUITE, options, Some(&storage));
    ide.wait_for("project reopened", |s| {
        s.ws.project.as_ref().is_some_and(|p| p.root == root) && s.ws.git.status_ms.is_some()
    });
    ide.settle();
    assert_eq!(ide.state().ws.layout.left, None);
    assert_eq!(ide.state().ws.layout.bottom, Some(ToolWindow::Find));
    ide.assert_text("Find Usages (⌥F7) and Find in Files (⇧⌘F) results show here");
}
