//! The one save path (`app/src/save`): every writer makes a backup, and only a save the user
//! asks for runs oxfmt. The projects turn `[format.oxfmt] on_save` on without installing
//! oxfmt, so a save that tries to format leaves "oxfmt is not installed ... Saved unformatted."
//! in the log, and a save that skips the format leaves nothing. The `format` suite checks the
//! formatted text with the real oxfmt.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::common::*;
use egui::{Key, Pos2};
use harwex_ide::git::diff::{DiffTab, Side};
use harwex_ide::notifications::Level;

const SUITE: &str = "save_path";
const NOT_INSTALLED: &str = "oxfmt is not installed (node_modules/oxfmt). Saved unformatted.";

/// Opens `repo` with backups into `<fixture>/backups` and `on_save` on.
fn open(fx: &Fixture, repo: &Repo) -> (Ide, PathBuf) {
    let backups = fx.path("backups");
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.state_mut().settings.backup_dir = Some(backups.clone());
    ide.state_mut().ws.langs.config.oxfmt.on_save = true;
    (ide, backups)
}

/// The previous versions kept for `rel`, oldest first.
fn backups_of(ide: &Ide, backups: &Path, rel: &str) -> Vec<String> {
    let folder = harwex_ide::settings::files::backup_folder(backups, &ide.root().join(rel));
    harwex_ide::settings::files::backups_of(&folder).iter().map(|p| std::fs::read_to_string(p).expect("backup")).collect()
}

/// Warnings that the formatter left in the Notifications log.
fn oxfmt_notes(ide: &Ide) -> Vec<String> {
    ide.state().notifications.log().iter().filter(|n| n.level == Level::Warning && n.title.starts_with("oxfmt")).map(|n| n.title.clone()).collect()
}

fn tab_dirty(ide: &Ide) -> bool {
    ide.state().ws.tabs.active_tab().is_some_and(|t| t.is_dirty())
}

#[test]
fn idle_save_backs_up_and_does_not_format() {
    let fx = Fixture::new(SUITE, "idle");
    let repo = basic_repo(fx.path("repo"));
    let before = repo.read("src/util.ts");
    let (mut ide, backups) = open(&fx, &repo);
    ide.open_file("src/util.ts");
    ide.click_at(ide.caret_pos(0, 0));
    ide.type_text("// a\n");
    assert!(tab_dirty(&ide));
    ide.state_mut().settings.sync.idle_timer = true;
    ide.state_mut().settings.sync.last_input = Instant::now() - Duration::from_secs(16);
    ide.wait_until("idle save", |ide| !tab_dirty(ide));
    ide.settle();
    assert_eq!(ide.state().settings.sync.idle_saves, 1);
    assert_eq!(repo.read("src/util.ts"), format!("// a\n{before}"));
    assert_eq!(backups_of(&ide, &backups, "src/util.ts"), [before]);
    assert!(oxfmt_notes(&ide).is_empty(), "an idle save never formats: {:?}", oxfmt_notes(&ide));
}

#[test]
fn close_prompt_save_formats_backs_up_and_closes() {
    let fx = Fixture::new(SUITE, "close_prompt");
    let repo = basic_repo(fx.path("repo"));
    let before = repo.read("src/util.ts");
    let (mut ide, backups) = open(&fx, &repo);
    ide.open_file("src/util.ts");
    ide.click_at(ide.caret_pos(0, 0));
    ide.type_text("// b\n");
    ide.cmd(Key::W);
    ide.settle();
    ide.assert_text("Save changes to util.ts?");
    ide.click("Save");
    ide.wait_until("saved and closed", |ide| ide.tab_titles().is_empty() && ide.state().is_idle());
    assert_eq!(repo.read("src/util.ts"), format!("// b\n{before}"));
    assert_eq!(backups_of(&ide, &backups, "src/util.ts"), [before]);
    assert_eq!(oxfmt_notes(&ide), [NOT_INSTALLED], "the prompt's Save tries oxfmt first");
}

/// A point just right of the left edge of char `col` on the diff's right side.
fn diff_at(ide: &mut Ide, key: &str, line: usize, col: usize) -> Pos2 {
    let t = ide.state_mut().ws.tabs.custom_mut::<DiffTab>(key).expect("diff tab");
    let a = t.char_center(Side::New, line, col).expect("diff drawn");
    let b = t.char_center(Side::New, line, col + 1).expect("diff drawn");
    Pos2::new(a.x - (b.x - a.x) / 2.0 + 1.0, a.y)
}

fn hidden_dirty(ide: &mut Ide, key: &str) -> Option<bool> {
    ide.state_mut().ws.tabs.custom_mut::<DiffTab>(key).and_then(|t| t.hidden_doc().map(|d| d.is_dirty()))
}

/// The hidden document of an editable diff: the debounce save backs up and does not format;
/// Cmd+S in the diff tries oxfmt like Cmd+S in an editor tab.
#[test]
fn diff_hidden_document_saves_through_the_one_path() {
    let fx = Fixture::new(SUITE, "diff_hidden");
    let repo = basic_repo(fx.path("repo"));
    let changed = repo.read("src/util.ts").replace("ZERO = 0", "ZERO = 10");
    repo.write("src/util.ts", &changed);
    let (mut ide, backups) = open(&fx, &repo);
    let path = ide.root().join("src/util.ts");
    harwex_ide::git::diff::open_worktree_diff(ide.state_mut(), &path);
    let key = "diff:wt:src/util.ts".to_string();
    ide.wait_until("diff and hidden document", |ide| ide.state().is_idle() && ide.state().ws.tabs.custom_by_key(&key).is_some());
    ide.settle();
    assert_eq!(hidden_dirty(&mut ide, &key), Some(false), "no editor tab: the diff edits a hidden document");

    // The debounce save.
    let p = diff_at(&mut ide, &key, 0, 0);
    ide.click_at(p);
    ide.type_text("x");
    let want = format!("x{changed}");
    ide.wait_until("debounce save", |ide| ide.state().is_idle() && repo.read("src/util.ts") == want);
    assert_eq!(hidden_dirty(&mut ide, &key), Some(false));
    assert_eq!(backups_of(&ide, &backups, "src/util.ts"), std::slice::from_ref(&changed));
    assert!(oxfmt_notes(&ide).is_empty(), "the debounce save never formats: {:?}", oxfmt_notes(&ide));

    // Cmd+S.
    ide.type_text("y");
    ide.cmd(Key::S);
    let want = format!("xy{changed}");
    ide.wait_until("Cmd+S save", |ide| ide.state().is_idle() && repo.read("src/util.ts") == want);
    assert_eq!(hidden_dirty(&mut ide, &key), Some(false));
    assert_eq!(backups_of(&ide, &backups, "src/util.ts"), [changed.clone(), format!("x{changed}")]);
    assert_eq!(oxfmt_notes(&ide), [NOT_INSTALLED], "Cmd+S in a diff tries oxfmt first");
}
