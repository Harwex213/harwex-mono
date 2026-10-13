//! Speed search in the change trees: the Commit tool window's tree and the changed files of a
//! Log tab. Typing in the focused tree selects the first match (file names and folder rows,
//! compressed `a/b` chains too) and expands the folders above it; Up/Down move between the
//! matches, Escape clears the search, Enter acts and ends it, a row press ends it.

use std::path::PathBuf;

use crate::common::*;
use egui::Key;
use harwex_ide::git::log::LogView;
use harwex_ide::layout::ToolWindow;

const SUITE: &str = "changes_search";

const UPLOAD: &str = "etc/ci/include/generated/upload_ui_artifact.yml";
const LINE: &str = "etc/ci/template/docker-swarm/line.docker-compose.yml";
const SHARED: &str = "etc/ci/template/docker-swarm/shared.docker-compose.yml";
const UTILS: &str = "javascript/packages/libs/src/Utils/math.ts";

/// A repository whose working tree changes nested files, like the reference screenshot.
fn nested_repo(fx: &Fixture) -> Repo {
    let repo = basic_repo(fx.path("repo"));
    for p in [UPLOAD, LINE, SHARED, UTILS] {
        repo.write(p, "one\n");
    }
    repo.commit_all("Nested files");
    for p in [UPLOAD, LINE, SHARED, UTILS, "README.md"] {
        repo.write(p, "two\n");
    }
    repo
}

fn commit_search(ide: &Ide) -> String {
    ide.state().ws.git_ui.changes.search().to_string()
}

fn commit_selected(ide: &Ide) -> Vec<PathBuf> {
    ide.state().ws.git_ui.changes.selected_paths()
}

fn commit_selected_dir(ide: &Ide) -> Option<String> {
    ide.state().ws.git_ui.changes.selected_dir()
}

fn type_search(ide: &mut Ide, text: &str) {
    ide.type_text(text);
    ide.settle();
}

#[test]
fn commit_tree_speed_search() {
    let fx = Fixture::new(SUITE, "commit_tree");
    let repo = nested_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.click("Commit tool window");
    ide.settle();
    assert_eq!(ide.state().ws.layout.left, Some(ToolWindow::Commit));
    ide.click("Collapse All");
    ide.settle();
    assert!(!ide.has(SHARED));
    // A press on a row gives the tree the focus.
    ide.click("README.md");
    ide.settle();

    // The first match is selected and the folders above it expand.
    type_search(&mut ide, "shared");
    assert_eq!(commit_search(&ide), "shared");
    assert!(ide.has("Speed search shared"), "{:?}", ide.labels());
    assert_eq!(commit_selected(&ide), [PathBuf::from(SHARED)]);
    assert!(ide.has(SHARED), "the folders above the match expand");
    ide.snapshot("commit_match");

    // Escape clears the search; the tree keeps the focus, so typing starts a new one.
    ide.key(Key::Escape);
    ide.settle();
    assert_eq!(commit_search(&ide), "");
    assert!(!ide.labels().iter().any(|l| l.starts_with("Speed search")));

    // "dock" matches the compressed template/docker-swarm folder row and the two files in it.
    // The selected row still matches, so it stays.
    type_search(&mut ide, "dock");
    assert_eq!(commit_search(&ide), "dock", "Escape left the focus in the tree");
    assert_eq!(commit_selected(&ide), [PathBuf::from(SHARED)]);
    // Down and Up move between the matches and wrap.
    ide.key(Key::ArrowDown);
    assert_eq!(commit_selected_dir(&ide).as_deref(), Some("Directory etc/ci/template/docker-swarm in Unstaged"), "Down at the last match wraps");
    assert!(commit_selected(&ide).is_empty());
    ide.key(Key::ArrowDown);
    assert_eq!(commit_selected(&ide), [PathBuf::from(LINE)]);
    assert_eq!(commit_selected_dir(&ide), None);
    ide.snapshot("commit_highlight");
    ide.key(Key::ArrowUp);
    ide.key(Key::ArrowUp);
    assert_eq!(commit_selected(&ide), [PathBuf::from(SHARED)], "Up at the first match wraps");

    // A compressed chain matches as one name.
    ide.key(Key::Escape);
    type_search(&mut ide, "etc/ci");
    assert_eq!(commit_selected_dir(&ide).as_deref(), Some("Directory etc/ci in Unstaged"));

    // A text with no match keeps the selection and turns the field red.
    ide.key(Key::Escape);
    type_search(&mut ide, "math");
    assert_eq!(commit_selected(&ide), [PathBuf::from(UTILS)]);
    type_search(&mut ide, "zz");
    assert_eq!(commit_search(&ide), "mathzz");
    assert_eq!(commit_selected(&ide), [PathBuf::from(UTILS)]);
    ide.snapshot("commit_no_match");

    // A press on a row ends the search.
    ide.click(LINE);
    ide.settle();
    assert_eq!(commit_search(&ide), "");

    // Enter on a folder match toggles it, like a double click.
    type_search(&mut ide, "generated");
    assert_eq!(commit_selected_dir(&ide).as_deref(), Some("Directory etc/ci/include/generated in Unstaged"));
    ide.key(Key::Enter);
    ide.settle();
    assert_eq!(commit_search(&ide), "");
    assert!(ide.has(UPLOAD), "Enter expanded the folder");

    // Enter on a file match opens its diff and ends the search.
    type_search(&mut ide, "read");
    assert_eq!(commit_selected(&ide), [PathBuf::from("README.md")]);
    ide.key(Key::Enter);
    ide.wait_until("diff tab", |ide| ide.active_title().is_some_and(|t| t.contains("README.md")));
    assert_eq!(commit_search(&ide), "");
}

fn view(ide: &Ide) -> &LogView {
    &ide.state().ws.git_ui.window.log_tab(0).expect("the main Log tab").view
}

fn log_search(ide: &Ide) -> String {
    view(ide).changes_pane().search().to_string()
}

fn log_selected(ide: &Ide) -> Vec<PathBuf> {
    view(ide).changes_pane().selected_rows().to_vec()
}

#[test]
fn log_changes_speed_search() {
    let fx = Fixture::new(SUITE, "log_changes");
    let repo = nested_repo(&fx);
    repo.commit_all("Rework nested files");
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.click("Git tool window");
    ide.wait_for("log loaded", |s| s.ws.git_ui.window.log_tab(0).is_some_and(|t| !t.view.is_loading() && !t.view.commits().is_empty()));
    ide.settle();
    // A taller Git window, so every changed file shows.
    let top = ide.rect("Git tab Log: HEAD").min.y - 12.0;
    ide.drag(egui::pos2(700.0, top), egui::pos2(700.0, 260.0));
    ide.settle();
    ide.wait_until("changes loaded", |ide| view(ide).changes().is_some() && ide.state().is_idle());
    ide.settle();
    ide.click("Collapse All");
    ide.settle();
    assert!(!ide.has(&format!("Changed file {SHARED}")));
    let root = ide.labels().into_iter().find(|l| l.starts_with("Changes root")).expect("root row");
    ide.click(&root);
    ide.settle();

    // The first match is selected and the folders above it expand.
    type_search(&mut ide, "shared");
    assert_eq!(log_search(&ide), "shared");
    assert!(ide.has("Speed search shared"), "{:?}", ide.labels());
    assert_eq!(log_selected(&ide), [PathBuf::from(SHARED)]);
    assert!(ide.has(&format!("Changed file {SHARED}")));
    ide.snapshot("log_match");

    // Folder rows match, Down and Up move between the matches and wrap.
    ide.key(Key::Escape);
    ide.settle();
    assert_eq!(log_search(&ide), "");
    type_search(&mut ide, "dock");
    assert_eq!(log_search(&ide), "dock", "Escape left the focus in the tree");
    assert_eq!(log_selected(&ide), [PathBuf::from(SHARED)], "a selected row that still matches stays");
    ide.key(Key::ArrowDown);
    assert_eq!(log_selected(&ide), [PathBuf::from("etc/ci/template/docker-swarm")], "Down at the last match wraps");
    ide.key(Key::ArrowDown);
    assert_eq!(log_selected(&ide), [PathBuf::from(LINE)]);
    ide.key(Key::ArrowUp);
    ide.key(Key::ArrowUp);
    assert_eq!(log_selected(&ide), [PathBuf::from(SHARED)], "Up at the first match wraps");

    // A press on a row ends the search.
    ide.click(&format!("Changed file {SHARED}"));
    ide.settle();
    assert_eq!(log_search(&ide), "");

    // Enter opens the diff of the file match and ends the search.
    type_search(&mut ide, "math");
    assert_eq!(log_selected(&ide), [PathBuf::from(UTILS)]);
    ide.key(Key::Enter);
    ide.wait_until("diff tab", |ide| ide.active_title().is_some_and(|t| t.contains("math.ts")));
    assert_eq!(log_search(&ide), "");
}
