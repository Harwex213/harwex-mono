//! The Conflict Resolve (Merge) window (task 106): the left and right panes are read-only
//! editors (selection, copy, highlighting), the result is the file's own editor (free edits,
//! the language server's problems), chunks follow free edits, the >> / << buttons show the
//! applied state and come back on undo, unchanged runs fold, and the header keeps its buttons
//! while the path loses its middle.

use std::path::PathBuf;

use crate::common::*;
use egui::{Event, Key, Modifiers, MouseWheelUnit, OutputCommand, Pos2, Vec2};
use harwex_ide::git::conflicts::merge::MergeTab;
use ide_editor::{Document, Language, Position};

const SUITE: &str = "merge_window";

/// `n` unchanged lines named after `tag`.
fn filler(tag: &str, n: usize) -> String {
    (0..n).map(|i| format!("export const {tag}{i} = {i};\n")).collect()
}

/// A merge of two branches that change `rel`: a conflict on `value`, a left-only change of
/// `tail` and a right-only change of `end`, with long unchanged runs between them. The merge
/// is left in progress, so the file holds git's markers.
fn merge_repo(dir: PathBuf, rel: &str) -> Repo {
    let r = Repo::init(dir);
    let text = |value: &str, tail: &str, end: &str| {
        format!(
            "import {{ readFileSync }} from \"fs\";\n\n{}export const value = {value};\n{}export const tail = \"{tail}\";\n{}export const end = {end};\n",
            filler("head", 20),
            filler("mid", 16),
            filler("low", 4)
        )
    };
    r.write(rel, &text("1", "base", "0"));
    r.write("README.md", "# merge\n");
    r.commit_all("Base");
    r.git(&["checkout", "-q", "-b", "left"]);
    r.write(rel, &text("2", "ours", "0"));
    r.commit_all("Left change");
    r.git(&["checkout", "-q", "-b", "right", "main"]);
    r.write(rel, &text("3", "base", "42"));
    r.commit_all("Right change");
    r.git(&["checkout", "-q", "left"]);
    let out = r.git_status(&["merge", "right"]);
    assert!(!out.status.success(), "the merge must stop on the conflict");
    r
}

/// Opens the repo and the merge tab of `rel`.
fn open_merge(name: &str, rel: &str) -> (Fixture, Repo, Ide) {
    let fx = Fixture::new(SUITE, name);
    let repo = merge_repo(fx.path("repo"), rel);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.wait_for("conflicts found", |s| s.ws.git_ui.conflicts.files().len() == 1 && s.is_idle());
    ide.dismiss_toasts();
    harwex_ide::git::conflicts::open_merge(ide.state_mut(), PathBuf::from(rel));
    ide.wait_until("merge tab", |ide| ide.active_title().is_some_and(|t| t.starts_with("Merge: ")));
    ide.settle();
    (fx, repo, ide)
}

fn key(rel: &str) -> String {
    format!("merge:{rel}")
}

fn tab<'a>(ide: &'a mut Ide, rel: &str) -> &'a mut MergeTab {
    ide.state_mut().ws.tabs.custom_mut::<MergeTab>(&key(rel)).expect("the merge tab")
}

fn result_doc<'a>(ide: &'a Ide, rel: &str) -> &'a Document {
    let abs = ide.root().join(rel);
    let id = ide.state().ws.tabs.editor_by_path(&abs).expect("the file's editor tab");
    &ide.state().ws.tabs.get(id).and_then(|t| t.editor()).expect("an editor").doc
}

/// Screen point just right of the caret boundary before a char in the result pane.
fn result_at(ide: &mut Ide, rel: &str, line: usize, col: usize) -> Pos2 {
    let doc = result_doc(ide, rel).text();
    let doc = Document::from_text(&doc, Language::Plain);
    let view = tab(ide, rel).result_view();
    let c = view.char_center(&doc, Position::new(line, col)).expect("the result drawn");
    let w = view.geometry().expect("drawn").char_w;
    Pos2::new(c.x - w / 2.0 + 1.0, c.y)
}

fn copied(ide: &Ide) -> Option<String> {
    ide.harness.output().platform_output.commands.iter().find_map(|c| match c {
        OutputCommand::CopyText(t) => Some(t.clone()),
        _ => None,
    })
}

const REL: &str = "src/values.ts";

/// Item 1: the side panes are editors. A double click selects a word, Cmd+C copies it, and the
/// text is highlighted as TypeScript. Cancel puts git's file back and closes the tab it opened.
#[test]
fn side_panes_select_copy_and_highlight() {
    let (_fx, repo, mut ide) = open_merge("side_panes", REL);
    for name in ["Editor Merge Yours", "Editor Merge Result", "Editor Merge Theirs"] {
        assert!(ide.has(name), "{name}: {:?}", ide.labels());
    }
    assert_eq!(tab(&mut ide, REL).side_doc(false).language(), Language::TypeScript);
    let spans = {
        let t = tab(&mut ide, REL);
        let mut doc = Document::from_text(&t.side_doc(true).text(), Language::TypeScript);
        doc.wait_syntax();
        doc.highlight(0..1)
    };
    assert!(!spans[0].is_empty(), "the right side's first line is highlighted");
    ide.snapshot("merge_window");

    // `value` on the conflict line of the left side (line 22).
    let p = {
        let t = tab(&mut ide, REL);
        let doc = Document::from_text(&t.side_doc(false).text(), Language::Plain);
        t.side_view(false).char_center(&doc, Position::new(22, 15)).expect("the left side drawn")
    };
    ide.double_click_at(p);
    ide.settle();
    let sel = tab(&mut ide, REL).side_view(false).selection();
    assert_eq!(sel.range(), {
        let t = tab(&mut ide, REL);
        let s = t.side_doc(false).line_start(22) + 13;
        s..s + 5
    });
    ide.harness.input_mut().modifiers = Modifiers::COMMAND;
    ide.harness.input_mut().events.push(Event::Copy);
    ide.step();
    ide.harness.input_mut().modifiers = Modifiers::NONE;
    assert_eq!(copied(&ide).as_deref(), Some("value"));
    // A read-only side ignores typing.
    let before = tab(&mut ide, REL).side_doc(false).text();
    ide.type_text("zz");
    assert_eq!(tab(&mut ide, REL).side_doc(false).text(), before);

    let on_disk = repo.read(REL);
    assert!(on_disk.contains("<<<<<<<"), "the file still holds the markers");
    ide.click("Cancel");
    ide.wait_for("merge closed", |s| s.ws.tabs.list.is_empty() && s.is_idle());
    assert_eq!(repo.read(REL), on_disk, "Cancel leaves git's file as it was");
}

/// Item 2: the result is the file. A line typed above every chunk, outside any chunk, moves
/// the chunks and their buttons down one line; text typed inside a conflict resolves it.
#[test]
fn result_edits_anywhere_and_chunks_follow() {
    let (_fx, _repo, mut ide) = open_merge("free_edits", REL);
    let doc = Document::from_text(&result_doc(&ide, REL).text(), Language::Plain);
    let before: Vec<_> = tab(&mut ide, REL).chunk_lines(&doc).iter().map(|c| c[1].clone()).collect();
    assert_eq!(before.len(), 3, "conflict, left change, right change: {before:?}");
    // The head's fold would take the new line in; open it, so the chunks move on screen.
    let fold = tab(&mut ide, REL).result_view().fold_rects()[0].1;
    ide.click_at(fold.center());
    ide.settle();
    let top_before = tab(&mut ide, REL).result_view().line_span(before[0].start).expect("drawn").0;
    let at = result_at(&mut ide, REL, 0, 0);
    ide.click_at(at);
    ide.type_text("// note\n");
    ide.settle();
    let text = result_doc(&ide, REL).text();
    assert!(text.starts_with("// note\nimport"), "{}", &text[..40]);
    let after: Vec<_> = tab(&mut ide, REL).chunk_lines(&Document::from_text(&text, Language::Plain)).iter().map(|c| c[1].clone()).collect();
    let shifted: Vec<_> = before.iter().map(|r| r.start + 1..r.end + 1).collect();
    assert_eq!(after, shifted, "every chunk moved down with the text");
    let top_after = tab(&mut ide, REL).result_view().line_span(after[0].start).expect("drawn").0;
    let line_h = tab(&mut ide, REL).result_view().geometry().expect("drawn").line_h;
    assert!((top_after - top_before - line_h).abs() < 1.5, "the conflict's band moved one line down: {top_before} -> {top_after}");

    // Typing in the conflict line resolves it, and the count says so.
    ide.assert_text("1 conflict(s) left");
    let line = after[0].start;
    let at = result_at(&mut ide, REL, line, 0);
    ide.click_at(at);
    ide.type_text("/* mine */ ");
    ide.settle();
    assert!(tab(&mut ide, REL).chunk_states()[0].1, "an edited conflict is resolved");
    ide.assert_text("All conflicts resolved");
    ide.snapshot("merge_free_edit");
}

/// Item 3: the non-conflicting changes start applied, with a check mark instead of the arrow.
/// Undo takes them back and the arrows return; a click applies again; undo again.
#[test]
fn applied_mark_and_undo() {
    let (_fx, _repo, mut ide) = open_merge("applied", REL);
    // Chunk 1 is the conflict, 2 the left change, 3 the right change.
    assert!(ide.has("Applied left change 2") && ide.has("Applied right change 3"), "{:?}", ide.labels());
    assert!(ide.has("Apply left change 1") && ide.has("Apply right change 1"));
    let text = result_doc(&ide, REL).text();
    assert!(text.contains("tail = \"ours\"") && text.contains("end = 42"));
    ide.snapshot("merge_applied");

    let at = result_at(&mut ide, REL, 0, 0);
    ide.click_at(at);
    ide.cmd(Key::Z);
    ide.settle();
    let text = result_doc(&ide, REL).text();
    assert!(text.contains("tail = \"base\"") && text.contains("end = 0"), "undo took both changes back");
    assert!(ide.has("Apply left change 2") && ide.has("Apply right change 3"), "{:?}", ide.labels());
    assert_eq!(tab(&mut ide, REL).chunk_states()[1], ([false, false], false));
    ide.snapshot("merge_undone");

    ide.click("Apply left change 2");
    ide.settle();
    assert!(ide.has("Applied left change 2"));
    assert!(result_doc(&ide, REL).text().contains("tail = \"ours\""));
    ide.cmd(Key::Z);
    ide.settle();
    assert!(ide.has("Apply left change 2"), "undo of the click brings the arrow back");
    assert!(result_doc(&ide, REL).text().contains("tail = \"base\""));
    // Undo stops at the merge's start: git's markers never come back.
    for _ in 0..3 {
        ide.cmd(Key::Z);
    }
    ide.settle();
    assert!(!result_doc(&ide, REL).text().contains("<<<<<<<"));

    // Both sides of the conflict: the left one, then the right one after it.
    ide.click("Apply left change 1");
    ide.settle();
    ide.click("Apply right change 1");
    ide.settle();
    assert!(ide.has("Applied left change 1") && ide.has("Applied right change 1"));
    assert!(result_doc(&ide, REL).text().contains("value = 2;\nexport const value = 3;\n"));
    ide.assert_text("All conflicts resolved");
}

/// Unchanged runs fold in all three panes; a click on a fold opens it everywhere. A wheel over
/// the result scrolls the side panes to the same lines.
#[test]
fn unchanged_runs_fold_and_scroll_together() {
    let (_fx, _repo, mut ide) = open_merge("folds", REL);
    let counts = |ide: &mut Ide| {
        let t = tab(ide, REL);
        [t.side_view(false).folds().len(), t.result_view().folds().len(), t.side_view(true).folds().len()]
    };
    assert_eq!(counts(&mut ide), [2, 2, 2], "the 22-line head and the 16-line middle fold");
    assert_eq!(tab(&mut ide, REL).result_view().folds()[0].label, "16 unchanged lines");
    let fold = tab(&mut ide, REL).result_view().fold_rects()[0].1;
    ide.click_at(fold.center());
    ide.settle();
    assert_eq!(counts(&mut ide), [1, 1, 1], "the fold opened in every pane");

    let p = ide.rect("Editor Merge Result").center();
    ide.move_to(p);
    let line_h = tab(&mut ide, REL).result_view().geometry().expect("drawn").line_h;
    ide.harness.input_mut().events.push(Event::MouseWheel { unit: MouseWheelUnit::Point, delta: Vec2::new(0.0, -8.0 * line_h), modifiers: Modifiers::NONE });
    ide.settle();
    let tops = {
        let t = tab(&mut ide, REL);
        let l = t.side_view(false).view_state(t.side_doc(false)).expect("drawn").line;
        let r = t.side_view(true).view_state(t.side_doc(true)).expect("drawn").line;
        (l, r)
    };
    let doc = Document::from_text(&result_doc(&ide, REL).text(), Language::Plain);
    let result_top = tab(&mut ide, REL).result_view().view_state(&doc).expect("drawn").line;
    assert!(result_top >= 6, "the result scrolled: {result_top}");
    assert_eq!(tops, (result_top, result_top), "the sides follow the result above the first chunk");
    ide.snapshot("merge_unfolded_scrolled");
}

/// Item 4: a long path loses its middle (the file name stays), shows whole on hover, and the
/// buttons stay inside the tab at any width.
#[test]
fn header_keeps_buttons_and_cuts_the_path() {
    let rel = "javascript/packages/@projects/playerui/@playerui-libs/playerui-core/src/Sportsbookui/Containers/MainLineContainers/Selectors/PreLiveMainLineSelectors.ts";
    let (_fx, _repo, mut ide) = open_merge("long_path", rel);
    let width = ide.ctx().screen_rect().width();
    let label = format!("Merge path {rel}");
    let path = ide.rect(&label);
    let first = ide.rect("Apply Non-Conflicting");
    let cancel = ide.rect("Cancel");
    assert!(path.max.x < first.min.x, "the path ends before the buttons: {path:?} {first:?}");
    assert!(cancel.max.x <= width, "Cancel stays in the window: {cancel:?}");
    for b in ["Accept Yours", "Accept Theirs", "Save and Mark Resolved"] {
        let r = ide.rect(b);
        assert!(r.min.x > path.max.x && r.max.x <= cancel.min.x, "{b} visible between the path and Cancel: {r:?}");
    }
    ide.snapshot("merge_header_narrow");
    ide.move_to(path.center());
    ide.idle(1.0);
    assert!(ide.has(rel), "the hover shows the whole path: {:?}", ide.labels());
    ide.snapshot_here("merge_header_path_hover");
}

/// Item 2: the result gets the language server's problems, like a normal tab of the file.
#[test]
fn result_shows_type_errors() {
    if skip_without_tsserver("result_shows_type_errors") {
        return;
    }
    let fx = Fixture::new(SUITE, "diagnostics");
    let repo = merge_repo(fx.path("repo"), REL);
    repo.write("tsconfig.json", "{\n  \"compilerOptions\": { \"strict\": true, \"module\": \"commonjs\", \"target\": \"es2020\" },\n  \"include\": [\"src\"]\n}\n");
    repo.write("package.json", "{ \"name\": \"merge\", \"private\": true }\n");
    std::fs::create_dir_all(repo.dir.join("node_modules")).expect("node_modules");
    std::os::unix::fs::symlink(typescript().expect("TypeScript 5"), repo.dir.join("node_modules/typescript")).expect("typescript link");
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.wait_for("conflicts found", |s| s.ws.git_ui.conflicts.files().len() == 1 && s.is_idle());
    harwex_ide::git::conflicts::open_merge(ide.state_mut(), PathBuf::from(REL));
    ide.wait_until("merge tab", |ide| ide.active_title().is_some_and(|t| t.starts_with("Merge: ")));
    // A type error typed into the result, outside every chunk.
    let at = result_at(&mut ide, REL, 1, 0);
    ide.click_at(at);
    ide.type_text("const wrong: number = \"x\";");
    ide.wait_until("the TS error in the result", |ide| {
        let abs = ide.root().join(REL);
        let e = ide.state().ws.tabs.editor_by_path(&abs).and_then(|id| ide.state().ws.tabs.get(id)).and_then(|t| t.editor());
        e.is_some_and(|e| e.problems.current.iter().any(|p| p.origin() == "ts(2322)"))
    });
    ide.steps(3);
    assert!(tab(&mut ide, REL).result_problems() > 0, "the result pane draws the problems");
}

/// "Save and Mark Resolved" writes through the one save path: git's conflict text goes into a
/// backup, oxfmt does not run (`on_save` is on, oxfmt is not installed, and no "Saved
/// unformatted" line appears), and the file is staged.
#[test]
fn save_and_mark_resolved_backs_up_and_does_not_format() {
    let (fx, repo, mut ide) = open_merge("save_backup", REL);
    let backups = fx.path("backups");
    ide.state_mut().settings.backup_dir = Some(backups.clone());
    ide.state_mut().ws.langs.config.oxfmt.on_save = true;
    let conflicted = repo.read(REL);
    ide.click("Accept Theirs");
    ide.settle();
    let result = result_doc(&ide, REL).text();
    ide.click("Save and Mark Resolved");
    ide.wait_for("resolved", |s| s.ws.git_ui.conflicts.files().is_empty() && s.is_idle());
    assert_eq!(repo.read(REL), result);
    let folder = harwex_ide::settings::files::backup_folder(&backups, &ide.root().join(REL));
    let kept: Vec<String> = harwex_ide::settings::files::backups_of(&folder).iter().map(|p| std::fs::read_to_string(p).expect("backup")).collect();
    assert_eq!(kept, [conflicted]);
    let notes: Vec<String> = ide.state().notifications.log().iter().filter(|n| n.title.starts_with("oxfmt")).map(|n| n.title.clone()).collect();
    assert!(notes.is_empty(), "the merge's save never formats: {notes:?}");
    assert!(repo.status_short().lines().any(|l| l.starts_with("M ") && l.ends_with(REL)), "staged: {}", repo.status_short());
}
