//! The Find in Files popup (Cmd+Shift+F) and Replace in Files (Cmd+Shift+R): live results,
//! the 100+ cap, the toggles, the file mask, Directory (recursive or not), Scope (Open Files,
//! Changed Files), grey excluded files, keys, Open in Find Window, Replace and Replace All,
//! and the history.

use crate::common::*;
use egui::Key;
use harwex_ide::fileops::Platform;

const SUITE: &str = "find_in_files";

/// Opens the popup and types `query`; waits until the live search finished.
fn find(ide: &mut Ide, query: &str) {
    ide.cmd_shift(Key::F);
    ide.settle();
    assert!(ide.state().ws.find.dialog_open);
    ide.type_text(query);
    settle_search(ide);
}

fn settle_search(ide: &mut Ide) {
    ide.wait_for("search finished", |s| !s.ws.find.has_pending_debounce() && !s.ws.find.searching);
    ide.settle();
}

/// `rel:line` of every hit in list order (1-based lines).
fn hit_list(ide: &Ide) -> Vec<String> {
    let root = ide.root();
    ide.state().ws.find.hits().map(|h| format!("{}:{}", h.path.strip_prefix(&root).unwrap_or(&h.path).display(), h.line + 1)).collect()
}

#[test]
fn typing_shows_results_live() {
    let fx = Fixture::new(SUITE, "live");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/util.ts");
    find(&mut ide, "add");
    // `add` appears in app.ts twice (import, call) and in util.ts once.
    assert_eq!(hit_list(&ide), ["src/app.ts:1", "src/app.ts:4", "src/util.ts:1"]);
    ide.assert_text("3 matches in 2 files");
    assert_eq!(ide.state().ws.find.selected_index(), Some(0));
    ide.snapshot("find_popup");

    // One more letter narrows the list without Enter.
    ide.type_text("(1");
    settle_search(&mut ide);
    assert_eq!(hit_list(&ide), ["src/app.ts:4"]);
    ide.assert_text("1 match in 1 file");
}

#[test]
fn arrows_and_enter_open_the_selected_hit() {
    let fx = Fixture::new(SUITE, "keys");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    find(&mut ide, "add");
    ide.key(Key::ArrowDown);
    ide.key(Key::ArrowDown);
    ide.key(Key::ArrowUp);
    assert_eq!(ide.state().ws.find.selected_index(), Some(1));
    assert!(ide.is_selected("Result src/app.ts:4"));
    assert!(ide.state().ws.find.dialog_open, "the arrows keep the popup open");
    ide.key(Key::Enter);
    ide.wait_for("app.ts opened", |s| s.ws.tabs.active_editor().is_some_and(|e| e.path.ends_with("src/app.ts")));
    ide.settle();
    assert!(!ide.state().ws.find.dialog_open);
    assert_eq!(ide.cursor(), (3, 12));
    assert_eq!(ide.active_text(), APP_TS, "Enter reached no editor");

    // A double click on a row opens it too.
    find(&mut ide, "add");
    ide.double_click("Result src/util.ts:1");
    ide.wait_for("util.ts opened", |s| s.ws.tabs.active_editor().is_some_and(|e| e.path.ends_with("src/util.ts")));
    ide.settle();
    assert!(!ide.state().ws.find.dialog_open);
    assert_eq!(ide.cursor(), (0, 16));

    // Escape closes the popup and leaves the editor alone.
    find(&mut ide, "add");
    ide.key(Key::Escape);
    assert!(!ide.state().ws.find.dialog_open);
}

#[test]
fn the_popup_stops_counting_at_100() {
    let fx = Fixture::new(SUITE, "cap");
    let repo = basic_repo(fx.path("repo"));
    for i in 0..150 {
        repo.write(&format!("many/f{i:03}.txt"), "needle\n");
    }
    let mut ide = Ide::open(SUITE, &repo.dir);
    find(&mut ide, "needle");
    assert!(ide.state().ws.find.truncated);
    assert_eq!(ide.state().ws.find.hit_count(), 100);
    ide.assert_text("100+ matches in 100+ files");
    // No snapshot: which 100 of the 150 files the parallel walk finds first differs per run.

    // Cmd+Enter: the Find window gets every hit, not only the first 100.
    ide.cmd(Key::Enter);
    ide.wait_for("find tab", |s| s.ws.find_window.active_tab().is_some_and(|t| t.items.len() == 150));
    ide.settle();
    assert!(!ide.state().ws.find.dialog_open);
    assert_eq!(ide.state().ws.layout.bottom, Some(harwex_ide::layout::ToolWindow::Find));
}

#[test]
fn toggles_change_the_search() {
    let fx = Fixture::new(SUITE, "toggles");
    let repo = basic_repo(fx.path("repo"));
    repo.write("src/t.ts", "const Add = 1;\nlet addOne = add;\n");
    let mut ide = Ide::open(SUITE, &repo.dir);
    find(&mut ide, "add");
    assert_eq!(ide.state().ws.find.hit_count(), 6, "{:?}", hit_list(&ide));
    ide.click("Match Case");
    settle_search(&mut ide);
    assert!(ide.state().ws.find.case_sensitive);
    assert_eq!(ide.state().ws.find.hit_count(), 5, "Add drops out");
    ide.click("Words");
    settle_search(&mut ide);
    assert_eq!(ide.state().ws.find.hit_count(), 4, "addOne drops out");
    ide.snapshot("toggles");
    ide.click("Words");
    ide.click("Clear search");
    ide.type_text(r"a.d\(");
    settle_search(&mut ide);
    assert_eq!(ide.state().ws.find.hit_count(), 0, "literal text");
    ide.assert_text("Nothing found");
    ide.click("Regex");
    settle_search(&mut ide);
    assert_eq!(hit_list(&ide), ["src/app.ts:4", "src/util.ts:1"]);
    ide.type_text("(");
    settle_search(&mut ide);
    assert!(ide.state().ws.find.error.is_some());
    ide.click("Regex");
    settle_search(&mut ide);

    // ⏎ on: Enter types a newline into the query and the popup stays open.
    ide.click("Clear search");
    ide.click("Multiline");
    ide.type_text("1;\nlet");
    settle_search(&mut ide);
    assert!(ide.state().ws.find.dialog_open);
    assert_eq!(ide.state().ws.find.query, "1;\nlet");
    assert_eq!(hit_list(&ide), ["src/t.ts:1"]);
}

#[test]
fn file_mask_includes_and_excludes() {
    let fx = Fixture::new(SUITE, "mask");
    let repo = basic_repo(fx.path("repo"));
    repo.write("src/app.test.ts", "add();\n");
    repo.write("docs/add.md", "add\n");
    let mut ide = Ide::open(SUITE, &repo.dir);
    find(&mut ide, "add");
    assert_eq!(hit_list(&ide), ["docs/add.md:1", "src/app.test.ts:1", "src/app.ts:1", "src/app.ts:4", "src/util.ts:1"]);
    ide.click("File mask pattern");
    ide.type_text("*.ts, !*.test.ts");
    settle_search(&mut ide);
    assert!(ide.state().ws.find.mask_on, "typing a mask turns it on");
    assert_eq!(hit_list(&ide), ["src/app.ts:1", "src/app.ts:4", "src/util.ts:1"]);
    ide.snapshot("mask");
    ide.click("File mask:");
    settle_search(&mut ide);
    assert!(!ide.state().ws.find.mask_on);
    assert_eq!(ide.state().ws.find.hit_count(), 5);
}

#[test]
fn directory_recursive_or_not() {
    let fx = Fixture::new(SUITE, "directory");
    let repo = basic_repo(fx.path("repo"));
    for rel in ["src/n.ts", "src/sub/n.ts", "other/n.ts"] {
        repo.write(rel, "needle\n");
    }
    let platform = std::sync::Arc::new(harwex_ide::fileops::RecordingPlatform::new(std::env::temp_dir().join("harwex-ide-test-trash")));
    let options = harwex_ide::AppOptions { platform: Some(platform.clone()), ..test_options(Some(&repo.dir)) };
    let mut ide = Ide::with_options(SUITE, options, None);
    find(&mut ide, "needle");
    assert_eq!(ide.state().ws.find.hit_count(), 3);
    ide.click("Directory");
    ide.click("Directory path");
    ide.type_text("src");
    settle_search(&mut ide);
    assert_eq!(hit_list(&ide), ["src/n.ts:1", "src/sub/n.ts:1"]);
    ide.click("Recursive");
    settle_search(&mut ide);
    assert!(!ide.state().ws.find.recursive);
    assert_eq!(hit_list(&ide), ["src/n.ts:1"]);
    ide.snapshot("directory");
    ide.click("Recursive");

    // `…` asks the platform's folder picker.
    let other = ide.root().join("other");
    platform.set_picked_folder(Some(other.clone()));
    ide.click("Choose Directory");
    ide.wait_for("picked", |s| s.ws.find.directory == other.display().to_string());
    settle_search(&mut ide);
    assert_eq!(hit_list(&ide), ["other/n.ts:1"]);
    assert!(platform.calls().iter().any(|c| c.starts_with("pick-folder")), "{:?}", platform.calls());

    ide.click("In Project");
    settle_search(&mut ide);
    assert_eq!(ide.state().ws.find.hit_count(), 3);
}

#[test]
fn scope_open_files_and_changed_files() {
    let fx = Fixture::new(SUITE, "scope");
    let repo = basic_repo(fx.path("repo"));
    repo.write("src/util.ts", "export function add(a: number, b: number): number {\n  return a + b; // add\n}\n");
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/app.ts");
    find(&mut ide, "add");
    assert_eq!(ide.state().ws.find.hit_count(), 4);
    ide.click("Scope");
    settle_search(&mut ide);
    assert_eq!(hit_list(&ide), ["src/app.ts:1", "src/app.ts:4"], "Open Files is the default scope");
    ide.click("Choose scope");
    ide.settle();
    ide.snapshot("scope_menu");
    ide.click("Scope Changed Files");
    settle_search(&mut ide);
    assert_eq!(ide.state().ws.find.named, harwex_ide::find::NamedScope::ChangedFiles);
    assert!(ide.state().ws.find.dialog_open, "a press in the menu keeps the popup");
    assert_eq!(hit_list(&ide), ["src/util.ts:1", "src/util.ts:2"]);
}

#[test]
fn excluded_and_library_files_draw_grey() {
    let fx = Fixture::new(SUITE, "grey");
    let repo = basic_repo(fx.path("repo"));
    repo.write(".harwex/ide.toml", "[project]\nexcluded = [\"dist\"]\n");
    repo.write("dist/bundle.js", "add();\n");
    repo.write("node_modules/lib/index.js", "export const add = 1;\n");
    let mut ide = Ide::open(SUITE, &repo.dir);
    let root = ide.root();
    ide.wait_for("excluded", |s| s.ws.tree.excluded == [root.join("dist")]);
    find(&mut ide, "add");
    assert!(hit_list(&ide).iter().all(|h| !h.starts_with("dist/")), "the project search skips excluded folders");
    // Open the excluded and the library file: the Open Files scope searches them.
    ide.key(Key::Escape);
    // One at a time: the tabs then come in a fixed order.
    for rel in ["dist/bundle.js", "node_modules/lib/index.js", "src/util.ts"] {
        ide.state_mut().open_location(&root.join(rel), None, false);
        ide.settle();
    }
    find(&mut ide, "add");
    ide.click("Scope");
    settle_search(&mut ide);
    assert_eq!(hit_list(&ide), ["dist/bundle.js:1", "node_modules/lib/index.js:1", "src/util.ts:1"]);
    let dim: Vec<bool> = ide.state().ws.find.results.iter().map(|(p, _)| harwex_ide::find::is_dim(p, &root, &ide.state().ws.tree.excluded)).collect();
    assert_eq!(dim, [true, true, false]);
    ide.snapshot("grey_files");
}

#[test]
fn replace_one_then_replace_all() {
    let fx = Fixture::new(SUITE, "replace");
    let repo = basic_repo(fx.path("repo"));
    repo.write("docs/add.md", "add here\nadd there\n");
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/util.ts");
    ide.cmd_shift(Key::R);
    ide.settle();
    assert!(ide.state().ws.find.dialog_open && ide.state().ws.find.replace_mode);
    ide.type_text("add");
    ide.click("Replace with");
    ide.type_text("plus");
    ide.click("Words");
    settle_search(&mut ide);
    assert_eq!(hit_list(&ide), ["docs/add.md:1", "docs/add.md:2", "src/app.ts:1", "src/app.ts:4", "src/util.ts:1"]);
    assert!(ide.state().ws.find.hits().all(|h| h.replacement.as_deref() == Some("plus")));
    ide.assert_text("Replace in Files");
    ide.snapshot("replace_popup");

    // Replace: the selected hit (a closed file) only; the next one is selected.
    ide.click("Replace");
    ide.wait_for("replaced", |s| !s.ws.find.replacing);
    ide.settle();
    assert_eq!(repo.read("docs/add.md"), "plus here\nadd there\n");
    assert_eq!(ide.state().ws.find.selected_hit().map(|h| h.line), Some(1));
    assert!(ide.state().ws.find.dialog_open);

    // Replace All asks first; Enter answers Replace. Everything left is written, open
    // documents through their buffer.
    ide.click("Replace All");
    wait_for_count(&mut ide);
    ide.assert_text("Replace 4 occurrences in 3 files?");
    assert!(ide.is_enabled("Confirm Replace All"));
    ide.dismiss_toasts();
    ide.snapshot("replace_confirm");
    ide.key(Key::Enter);
    ide.wait_for("replaced all", |s| !s.ws.find.replacing && s.jobs.in_flight() == 0 && s.ws.tabs.editors().all(|e| !e.doc.is_dirty()));
    ide.settle();
    assert!(!ide.state().ws.find.dialog_open);
    assert_eq!(repo.read("docs/add.md"), "plus here\nplus there\n");
    assert_eq!(repo.read("src/app.ts"), APP_TS.replace("add", "plus"));
    assert!(repo.read("src/util.ts").starts_with("export function plus("));
    let util = ide.state().ws.tabs.editors().find(|e| e.path.ends_with("src/util.ts")).expect("util tab");
    assert!(util.doc.text().starts_with("export function plus("), "the open document changed through the edit API");
    assert!(util.doc.can_undo());
    ide.cmd(Key::Z);
    ide.settle();
    assert!(ide.active_text().starts_with("export function add("), "one undo step brings it back");
}

/// Waits until the Replace All question has its count.
fn wait_for_count(ide: &mut Ide) {
    ide.wait_for("counted", |s| s.ws.find.replace_confirm.as_ref().is_some_and(|c| c.counts().is_some()));
    ide.settle();
}

#[test]
fn replace_all_asks_with_the_full_counts() {
    let fx = Fixture::new(SUITE, "replace_confirm");
    let repo = basic_repo(fx.path("repo"));
    for i in 0..150 {
        repo.write(&format!("many/f{i:03}.txt"), "needle\n");
    }
    repo.write("src/open.ts", "needle(needle);\n");
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/open.ts");
    ide.cmd_shift(Key::R);
    ide.settle();
    ide.type_text("needle");
    ide.click("Replace with");
    ide.type_text("pin");
    settle_search(&mut ide);
    assert!(ide.state().ws.find.truncated, "the popup list stops at 100");
    let unchanged = |ide: &Ide, repo: &Repo| {
        assert_eq!(repo.read("many/f000.txt"), "needle\n");
        assert_eq!(repo.read("many/f149.txt"), "needle\n");
        assert_eq!(repo.read("src/open.ts"), "needle(needle);\n");
        let open = ide.state().ws.tabs.editors().find(|e| e.path.ends_with("src/open.ts")).expect("open.ts tab");
        assert_eq!(open.doc.text(), "needle(needle);\n");
        assert!(!open.doc.can_undo(), "the open document was not edited");
    };

    // The count is the full one, above the popup's cap of 100.
    ide.click("Replace All");
    assert!(ide.state().ws.find.replace_confirm.is_some());
    wait_for_count(&mut ide);
    ide.assert_text("Replace 152 occurrences in 151 files?");

    // Escape cancels: nothing is written and the popup stays.
    ide.key(Key::Escape);
    assert!(ide.state().ws.find.replace_confirm.is_none());
    assert!(ide.state().ws.find.dialog_open);
    ide.wait_for("idle", |s| s.jobs.in_flight() == 0);
    unchanged(&ide, &repo);

    // Cancel does the same.
    ide.click("Replace All");
    wait_for_count(&mut ide);
    ide.click("Cancel Replace All");
    assert!(ide.state().ws.find.replace_confirm.is_none());
    assert!(ide.state().ws.find.dialog_open);
    ide.wait_for("idle", |s| s.jobs.in_flight() == 0);
    unchanged(&ide, &repo);

    // Replace writes every hit, closed files and the open document.
    ide.click("Replace All");
    wait_for_count(&mut ide);
    ide.click("Confirm Replace All");
    ide.wait_for("replaced all", |s| !s.ws.find.replacing && s.jobs.in_flight() == 0 && s.ws.tabs.editors().all(|e| !e.doc.is_dirty()));
    ide.settle();
    assert!(!ide.state().ws.find.dialog_open);
    for i in 0..150 {
        assert_eq!(repo.read(&format!("many/f{i:03}.txt")), "pin\n", "many/f{i:03}.txt");
    }
    assert_eq!(repo.read("src/open.ts"), "pin(pin);\n");
    let open = ide.state().ws.tabs.editors().find(|e| e.path.ends_with("src/open.ts")).expect("open.ts tab");
    assert_eq!(open.doc.text(), "pin(pin);\n");
}

/// 30 closed files with 210 `needle`s each (one with CRLF lines) and an open file with 5.
fn many_needles(fx: &Fixture) -> Repo {
    let repo = basic_repo(fx.path("repo"));
    for i in 0..30 {
        let eol = if i == 0 { "\r\n" } else { "\n" };
        repo.write(&format!("bulk/f{i:02}.txt"), &format!("needle x needle{eol}").repeat(105));
    }
    repo.write("src/open.ts", "needle needle needle\nneedle needle\n");
    repo
}

#[test]
fn replace_all_has_no_hit_cap() {
    let fx = Fixture::new(SUITE, "replace_uncapped");
    let repo = many_needles(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/open.ts");
    ide.cmd_shift(Key::R);
    ide.settle();
    ide.type_text("needle");
    ide.click("Replace with");
    ide.type_text("pin");
    settle_search(&mut ide);
    assert!(ide.state().ws.find.truncated, "the popup list stops at 100");

    // The count is exact: 30 * 210 + 5, above the old 5000 cap and the old 200 per file.
    ide.click("Replace All");
    wait_for_count(&mut ide);
    assert_eq!(ide.state().ws.find.replace_confirm.as_ref().and_then(|c| c.counts()), Some((6305, 31)));
    ide.assert_text("Replace 6305 occurrences in 31 files?");
    ide.click("Confirm Replace All");
    ide.wait_for("replaced all", |s| !s.ws.find.replacing && s.jobs.in_flight() == 0 && s.ws.tabs.editors().all(|e| !e.doc.is_dirty()));
    ide.settle();
    for i in 0..30 {
        let eol = if i == 0 { "\r\n" } else { "\n" };
        assert_eq!(repo.read(&format!("bulk/f{i:02}.txt")), format!("pin x pin{eol}").repeat(105), "bulk/f{i:02}.txt");
    }
    assert_eq!(repo.read("src/open.ts"), "pin pin pin\npin pin\n");
    let log = ide.state().notifications.log();
    assert!(log.iter().any(|n| n.body == "Replaced 6305 occurrences in 31 files."), "{:?}", log.iter().map(|n| &n.body).collect::<Vec<_>>());
    assert!(!log.iter().any(|n| n.body.starts_with("Skipped")));
}

#[test]
fn open_in_find_window_says_when_it_is_capped() {
    let fx = Fixture::new(SUITE, "find_window_cap");
    let repo = many_needles(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    find(&mut ide, "needle");
    ide.cmd(Key::Enter);
    ide.wait_for("find tab", |s| s.jobs.in_flight() == 0 && s.ws.find_window.active_tab().is_some_and(|t| !t.items.is_empty()));
    ide.settle();
    let tab = ide.state().ws.find_window.active_tab().expect("find tab");
    assert!(tab.truncated);
    assert_eq!(tab.items.len(), harwex_ide::find::FIND_WINDOW_CAP);
    ide.assert_text("5000+ results, showing the first 5000 found");
}

#[test]
fn replace_in_an_open_file_is_undoable() {
    let fx = Fixture::new(SUITE, "replace_open");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/util.ts");
    ide.cmd_shift(Key::R);
    ide.settle();
    ide.type_text("ZERO");
    ide.click("Replace with");
    ide.type_text("NONE");
    settle_search(&mut ide);
    assert_eq!(hit_list(&ide), ["src/util.ts:5"]);
    ide.click("Replace");
    ide.wait_for("saved", |s| s.ws.tabs.editors().all(|e| !e.doc.is_dirty()));
    ide.settle();
    assert!(repo.read("src/util.ts").contains("export const NONE = 0;"));
    assert_eq!(ide.state().ws.find.hit_count(), 0);
    ide.key(Key::Escape);
    ide.cmd(Key::Z);
    ide.settle();
    assert!(ide.active_text().contains("export const ZERO = 0;"));
}

#[test]
fn unsaved_buffers_are_searched_not_the_disk() {
    let fx = Fixture::new(SUITE, "buffers");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    let disk = ide.root().join("src/app.ts");
    let mtime = || std::fs::metadata(&disk).unwrap().modified().unwrap();
    let before = mtime();
    ide.open_file("src/app.ts");
    ide.cmd(Key::A);
    ide.type_text("const fresh = 1;\n");
    ide.settle();
    assert!(ide.state().ws.tabs.active_editor().unwrap().doc.is_dirty());

    // The new text is found; the text that is only on disk is not.
    find(&mut ide, "fresh");
    assert_eq!(hit_list(&ide), ["src/app.ts:1"]);
    ide.key(Key::Escape);
    find(&mut ide, "add");
    assert_eq!(hit_list(&ide), ["src/util.ts:1"], "app.ts lost its add() in the buffer");

    // Open in Find Window and its Rerun read the same buffers.
    ide.cmd(Key::Enter);
    ide.wait_for("find tab", |s| s.ws.find_window.active_tab().is_some_and(|t| !t.searching && !t.items.is_empty()));
    ide.settle();
    let paths = |ide: &Ide| ide.state().ws.find_window.active_tab().unwrap().items.iter().map(|i| i.path.clone()).collect::<Vec<_>>();
    assert_eq!(paths(&ide), [ide.root().join("src/util.ts")]);
    ide.click("Rerun");
    ide.wait_for("rerun", |s| s.ws.find_window.active_tab().is_some_and(|t| !t.searching));
    ide.settle();
    assert_eq!(paths(&ide), [ide.root().join("src/util.ts")]);

    assert_eq!(repo.read("src/app.ts"), APP_TS, "nothing was saved");
    assert_eq!(mtime(), before);
    assert!(ide.state().ws.tabs.editors().any(|e| e.doc.is_dirty()));
}

/// Opens Replace in Files with `query` (typed into the field; `⏎` on for a multiline query)
/// and `with`.
fn replace_popup(ide: &mut Ide, query: &str, with: &str, regex: bool) {
    ide.cmd_shift(Key::R);
    ide.settle();
    if query.contains('\n') && !ide.state().ws.find.multiline {
        ide.click("Multiline");
    }
    if regex != ide.state().ws.find.regex {
        ide.click("Regex");
    }
    ide.type_text(query);
    // A multiline query grows the field and moves the replace field down.
    ide.settle();
    ide.click("Replace with");
    ide.type_text(with);
    settle_search(ide);
}

const TWO: &str = "let a = 1;\nlet b = 2;\n";

#[test]
fn multiline_literal_replace_and_replace_all() {
    let fx = Fixture::new(SUITE, "multiline");
    let repo = basic_repo(fx.path("repo"));
    repo.write("m/closed.ts", &format!("{TWO}{TWO}"));
    repo.write("m/open.ts", TWO);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("m/open.ts");
    replace_popup(&mut ide, "1;\nlet", "1; let", false);
    assert_eq!(hit_list(&ide), ["m/closed.ts:1", "m/closed.ts:3", "m/open.ts:1"]);
    assert!(ide.state().ws.find.hits().all(|h| h.replacement.as_deref() == Some("1; let")));

    // Replace: the first hit of the closed file; the next hit moves up one line.
    ide.click("Replace");
    ide.wait_for("replaced", |s| !s.ws.find.replacing);
    ide.settle();
    assert_eq!(repo.read("m/closed.ts"), format!("let a = 1; let b = 2;\n{TWO}"));
    assert_eq!(hit_list(&ide), ["m/closed.ts:2", "m/open.ts:1"]);
    assert_eq!(ide.state().ws.find.selected_hit().map(|h| h.line), Some(1));

    // Replace All: the rest, the open file through its buffer as one undo step.
    ide.click("Replace All");
    wait_for_count(&mut ide);
    ide.assert_text("Replace 2 occurrences in 2 files?");
    ide.key(Key::Enter);
    ide.wait_for("replaced all", |s| !s.ws.find.replacing && s.jobs.in_flight() == 0 && s.ws.tabs.editors().all(|e| !e.doc.is_dirty()));
    ide.settle();
    assert_eq!(repo.read("m/closed.ts"), "let a = 1; let b = 2;\nlet a = 1; let b = 2;\n");
    assert_eq!(repo.read("m/open.ts"), "let a = 1; let b = 2;\n");
    assert_eq!(ide.active_text(), "let a = 1; let b = 2;\n");
    ide.cmd(Key::Z);
    ide.settle();
    assert_eq!(ide.active_text(), TWO, "one undo step brings both lines back");
}

#[test]
fn multiline_regex_groups_in_open_and_closed_files() {
    let fx = Fixture::new(SUITE, "multiline_regex");
    let repo = basic_repo(fx.path("repo"));
    repo.write("m/closed.ts", TWO);
    repo.write("m/open.ts", TWO);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("m/open.ts");
    replace_popup(&mut ide, r"let (\w) = (\d);\nlet (\w) = (\d);", "let [$1, $3] = [$2, $4];", true);
    assert_eq!(hit_list(&ide), ["m/closed.ts:1", "m/open.ts:1"]);

    // Replace on the open file first (select it), then Replace All on the closed one.
    ide.key(Key::ArrowDown);
    ide.click("Replace");
    ide.wait_for("saved", |s| s.ws.tabs.editors().all(|e| !e.doc.is_dirty()));
    ide.settle();
    assert_eq!(repo.read("m/open.ts"), "let [a, b] = [1, 2];\n");
    assert_eq!(hit_list(&ide), ["m/closed.ts:1"]);
    ide.click("Replace All");
    wait_for_count(&mut ide);
    ide.click("Confirm Replace All");
    ide.wait_for("replaced all", |s| !s.ws.find.replacing && s.jobs.in_flight() == 0);
    ide.settle();
    assert_eq!(repo.read("m/closed.ts"), "let [a, b] = [1, 2];\n");
    ide.cmd(Key::Z);
    ide.settle();
    assert_eq!(ide.active_text(), TWO, "undo in the open file");
}

#[test]
fn a_file_changed_since_the_search_is_skipped_with_a_warning() {
    let fx = Fixture::new(SUITE, "multiline_guard");
    let repo = basic_repo(fx.path("repo"));
    repo.write("m/a.ts", TWO);
    repo.write("m/b.ts", TWO);
    let mut ide = Ide::open(SUITE, &repo.dir);
    replace_popup(&mut ide, "1;\nlet", "1; let", false);
    assert_eq!(hit_list(&ide), ["m/a.ts:1", "m/b.ts:1"]);
    ide.click("Replace All");
    wait_for_count(&mut ide);
    // b.ts changes after the count: its match is gone from its place.
    repo.write("m/b.ts", "let a = 1;\n\nlet b = 2;\n");
    ide.key(Key::Enter);
    ide.wait_for("replaced all", |s| !s.ws.find.replacing && s.jobs.in_flight() == 0);
    ide.settle();
    assert_eq!(repo.read("m/a.ts"), "let a = 1; let b = 2;\n");
    assert_eq!(repo.read("m/b.ts"), "let a = 1;\n\nlet b = 2;\n", "not corrupted");
    let log = ide.state().notifications.log();
    assert!(log.iter().any(|n| n.title == "Replace in Files" && n.body == "Skipped 1 occurrence: the text changed since the search."), "{:?}", log.iter().map(|n| &n.body).collect::<Vec<_>>());
}

#[test]
fn history_persists_per_project() {
    let fx = Fixture::new(SUITE, "history");
    let repo = basic_repo(fx.path("repo"));
    let mut storage = MemoryStorage::default();
    {
        let mut ide = Ide::open(SUITE, &repo.dir);
        find(&mut ide, "export");
        ide.key(Key::Escape);
        find(&mut ide, "add");
        ide.click("File mask pattern");
        ide.type_text("*.ts");
        ide.click("Directory");
        ide.click("Directory path");
        ide.type_text("src");
        settle_search(&mut ide);
        ide.key(Key::Escape);
        eframe::App::save(ide.harness.state_mut(), &mut storage);
    }
    let saved = storage.map.get("find_history").cloned().unwrap_or_default();
    assert!(saved.contains("\tq\tadd") && saved.contains("\tm\t*.ts") && saved.contains("\td\tsrc"), "{saved}");

    let mut ide = Ide::with_options(SUITE, test_options(Some(&repo.dir)), Some(&storage));
    ide.cmd_shift(Key::F);
    ide.settle();
    ide.click("Search History");
    ide.settle();
    let recent: Vec<String> = ide.labels().into_iter().filter(|l| l.starts_with("Recent search ")).collect();
    assert_eq!(recent, ["Recent search add", "Recent search export"], "newest first");
    ide.snapshot("history");
    ide.click("Recent search export");
    settle_search(&mut ide);
    assert_eq!(ide.state().ws.find.query, "export");
    ide.click("File Mask History");
    ide.settle();
    ide.click("Recent mask *.ts");
    settle_search(&mut ide);
    assert_eq!(ide.state().ws.find.current_mask().as_deref(), Some("*.ts"));
}
