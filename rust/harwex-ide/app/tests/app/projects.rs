//! The project selector in the title bar (task 033): a press on the project widget opens the
//! popup; Open... goes through `state.platform`; Open Projects switch and close; Recent Projects
//! open, drop out with the cross and survive a restart.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::common::*;
use egui::Key;
use harwex_ide::fileops::{Platform, RecordingPlatform};
use harwex_ide::WorkspaceId;

const SUITE: &str = "projects";

fn canonical(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).expect("canonical")
}

/// Opens `dir` as another workspace and waits until it loaded.
fn open_loaded(ide: &mut Ide, dir: &Path) -> WorkspaceId {
    let id = ide.state_mut().open_workspace(dir.to_path_buf());
    let root = canonical(dir);
    ide.wait_for("project loaded", move |s| {
        s.ws.id == id && s.ws.project.as_ref().is_some_and(|p| p.root == root && s.ws.tree.is_loaded(&p.root)) && s.ws.index.build_ms.is_some() && s.ws.git.status_ms.is_some()
    });
    ide.settle();
    id
}

/// An IDE on `dir` whose platform the test keeps, to answer the folder picker.
fn open_with_platform(dir: &Path) -> (Ide, Arc<RecordingPlatform>) {
    let platform = Arc::new(RecordingPlatform::new(std::env::temp_dir().join("harwex-ide-test-trash")));
    let options = harwex_ide::AppOptions { platform: Some(platform.clone()), ..test_options(Some(dir)) };
    (Ide::with_options(SUITE, options, None), platform)
}

fn popup_open(ide: &Ide) -> bool {
    ide.state().projects.open
}

fn active_name(ide: &Ide) -> Option<String> {
    ide.state().ws.project.as_ref().map(|p| p.name.clone())
}

/// The labels of the Recent rows, top to bottom.
fn recent_rows(ide: &Ide) -> Vec<String> {
    let mut rows: Vec<(f32, String)> = ide.labels().into_iter().filter(|l| l.starts_with("Recent project ")).map(|l| (ide.rect(&l).min.y, l)).collect();
    rows.sort_by(|a, b| a.0.total_cmp(&b.0));
    rows.into_iter().map(|(_, l)| l.trim_start_matches("Recent project ").to_string()).collect()
}

/// A press on the project widget opens the popup, not the native picker. Open... asks the
/// platform's picker, and the picked folder opens as a new active project.
#[test]
fn widget_opens_popup_and_open_goes_through_the_platform() {
    let fx = Fixture::new(SUITE, "open");
    let a = basic_repo(fx.path("alpha"));
    let b = basic_repo(fx.path("beta"));
    let (mut ide, platform) = open_with_platform(&a.dir);
    ide.click("Project alpha");
    ide.settle();
    assert!(popup_open(&ide));
    assert!(ide.has("Open..."));
    assert!(ide.has("Open project alpha"));
    assert!(!platform.calls().iter().any(|c| c.starts_with("pick-folder")), "no native picker: {:?}", platform.calls());

    // A second press on the widget closes it again.
    ide.click("Project alpha");
    ide.settle();
    assert!(!popup_open(&ide));
    assert!(!ide.has("Open..."));

    ide.click("Project alpha");
    ide.settle();
    platform.set_picked_folder(Some(b.dir.clone()));
    ide.click("Open...");
    let root = canonical(&b.dir);
    ide.wait_for("picked folder opened", move |s| s.ws.project.as_ref().is_some_and(|p| p.root == root) && s.ws.git.status_ms.is_some());
    ide.settle();
    assert!(!popup_open(&ide));
    let parent = canonical(&a.dir).parent().expect("parent").display().to_string();
    assert!(platform.calls().contains(&format!("pick-folder {parent}")), "{:?}", platform.calls());
    assert_eq!(ide.state().workspaces().len(), 2);
    assert_eq!(active_name(&ide).as_deref(), Some("beta"));

    // Cancel in the picker opens nothing.
    ide.click("Project beta");
    ide.settle();
    ide.click("Open...");
    ide.settle();
    assert_eq!(ide.state().workspaces().len(), 2);
}

/// A press on an open project switches to it; Escape closes the popup; the keyboard walks the
/// rows and Enter picks one.
#[test]
fn switch_by_click_and_keyboard() {
    let fx = Fixture::new(SUITE, "switch");
    let a = basic_repo(fx.path("alpha"));
    let b = basic_repo(fx.path("beta"));
    let mut ide = Ide::open(SUITE, &a.dir);
    let a_id = ide.state().ws.id;
    let b_id = open_loaded(&mut ide, &b.dir);

    ide.click("Project beta");
    ide.settle();
    assert!(ide.is_selected("Open..."), "the first row starts selected");
    ide.click("Open project alpha");
    ide.settle();
    assert_eq!(ide.state().ws.id, a_id);
    assert!(!popup_open(&ide));

    ide.click("Project alpha");
    ide.settle();
    ide.key(Key::Escape);
    ide.settle();
    assert!(!popup_open(&ide));
    assert_eq!(ide.state().ws.id, a_id);

    // Open..., alpha, beta: two steps down is beta.
    ide.click("Project alpha");
    ide.park_mouse();
    ide.key(Key::ArrowDown);
    ide.key(Key::ArrowDown);
    ide.settle();
    assert!(ide.is_selected("Open project beta"));
    ide.key(Key::Enter);
    ide.settle();
    assert_eq!(ide.state().ws.id, b_id);
    assert!(!popup_open(&ide));
    assert_eq!(ide.tab_titles(), Vec::<String>::new(), "Enter did not reach an editor");
}

/// The cross on an open project closes it, and the project moves to Recent Projects. A press
/// outside the popup closes it.
#[test]
fn close_from_popup() {
    let fx = Fixture::new(SUITE, "close");
    let a = basic_repo(fx.path("alpha"));
    let b = basic_repo(fx.path("beta"));
    let mut ide = Ide::open(SUITE, &a.dir);
    let a_id = ide.state().ws.id;
    open_loaded(&mut ide, &b.dir);

    ide.click("Project beta");
    ide.settle();
    assert!(recent_rows(&ide).is_empty(), "open projects are not recent rows");
    ide.hover("Open project beta");
    ide.click("Close project beta");
    ide.settle();
    assert_eq!(ide.state().workspaces().len(), 1);
    assert_eq!(ide.state().ws.id, a_id);
    assert!(popup_open(&ide), "the popup stays open after a close");
    assert!(!ide.has("Open project beta"));
    assert_eq!(recent_rows(&ide), vec!["beta"]);
    ide.key(Key::Escape);
    ide.settle();

    // Unsaved files: the close prompt takes over from the popup.
    let b_id = open_loaded(&mut ide, &b.dir);
    ide.open_file("README.md");
    ide.type_text("X");
    ide.click("Project beta");
    ide.settle();
    ide.hover("Open project beta");
    ide.click("Close project beta");
    ide.settle();
    assert!(!popup_open(&ide));
    ide.assert_text("Close project beta?");
    ide.click("Cancel");
    ide.settle();
    assert!(ide.state().workspace(b_id).is_some());

    // A press outside closes the popup.
    ide.click("Project beta");
    ide.settle();
    assert!(popup_open(&ide));
    ide.click_at(egui::pos2(900.0, 500.0));
    ide.settle();
    assert!(!popup_open(&ide));
}

/// Recent Projects: newest first, without the open ones; the cross removes an entry; a press
/// opens one; the list survives a restart.
#[test]
fn recent_order_removal_and_persistence() {
    let fx = Fixture::new(SUITE, "recent");
    let a = basic_repo(fx.path("alpha"));
    let b = basic_repo(fx.path("beta"));
    let c = basic_repo(fx.path("gamma"));
    let mut storage = MemoryStorage::default();
    {
        let mut ide = Ide::open(SUITE, &a.dir);
        let b_id = open_loaded(&mut ide, &b.dir);
        let c_id = open_loaded(&mut ide, &c.dir);
        // Closing gamma activates beta; closing beta activates alpha.
        ide.state_mut().close_workspace(c_id);
        ide.settle();
        ide.state_mut().close_workspace(b_id);
        ide.settle();
        ide.click("Project alpha");
        ide.settle();
        assert_eq!(recent_rows(&ide), vec!["beta", "gamma"]);

        ide.hover("Recent project gamma");
        ide.click("Remove recent project gamma");
        ide.settle();
        assert!(popup_open(&ide), "the popup stays open after a removal");
        assert_eq!(recent_rows(&ide), vec!["beta"]);
        ide.key(Key::Escape);
        ide.settle();
        eframe::App::save(ide.harness.state_mut(), &mut storage);
    }
    let lines: Vec<String> = storage.map.get("recent_projects").map(|t| t.lines().map(str::to_string).collect()).unwrap_or_default();
    assert_eq!(lines, vec![canonical(&a.dir).display().to_string(), canonical(&b.dir).display().to_string()]);

    let options = harwex_ide::AppOptions { restore_last_folder: true, ..test_options(None) };
    let mut ide = Ide::with_options(SUITE, options, Some(&storage));
    let ra = canonical(&a.dir);
    ide.wait_for("alpha restored", move |s| s.ws.project.as_ref().is_some_and(|p| p.root == ra) && s.ws.git.status_ms.is_some());
    ide.settle();
    ide.click("Project alpha");
    ide.settle();
    assert_eq!(recent_rows(&ide), vec!["beta"]);
    ide.click("Recent project beta");
    let rb = canonical(&b.dir);
    ide.wait_for("beta opened from Recent", move |s| s.ws.project.as_ref().is_some_and(|p| p.root == rb) && s.ws.git.status_ms.is_some());
    ide.settle();
    assert!(!popup_open(&ide));
    assert_eq!(ide.state().workspaces().len(), 2);
    assert_eq!(ide.state().projects.recent.first(), Some(&canonical(&b.dir)), "beta is the newest");
}

/// The popup with two open and two recent projects, for comparison with IDEA's.
#[test]
fn popup_snapshot() {
    let fx = Fixture::new(SUITE, "snapshot");
    let a = basic_repo(fx.path("harwex-notes"));
    let b = basic_repo(fx.path("harwex-mono"));
    let c = basic_repo(fx.path("rxjs"));
    let d = basic_repo(fx.path("unity-repo"));
    let mut ide = Ide::open(SUITE, &a.dir);
    open_loaded(&mut ide, &b.dir);
    {
        let recent = &mut ide.state_mut().projects;
        recent.note_opened(&canonical(&d.dir));
        recent.note_opened(&canonical(&c.dir));
    }
    ide.click("Project harwex-mono");
    ide.settle();
    assert_eq!(recent_rows(&ide), vec!["rxjs", "unity-repo"]);
    ide.snapshot("popup");
    // Hover effects: the selection follows the pointer, and the row shows its cross.
    ide.hover("Open project harwex-notes");
    ide.snapshot_here("popup_hover");
}

/// A Recent folder deleted from disk (task 039): the row draws grey after the worker check, a
/// press shows a toast and opens nothing, and its cross still removes it. An existing Recent
/// row still opens.
#[test]
fn missing_recent_folder_is_grey_and_does_not_open() {
    let fx = Fixture::new(SUITE, "missing");
    let a = basic_repo(fx.path("alpha"));
    let b = basic_repo(fx.path("beta"));
    let c = basic_repo(fx.path("gamma"));
    let mut ide = Ide::open(SUITE, &a.dir);
    let gone = canonical(&c.dir);
    {
        let recent = &mut ide.state_mut().projects;
        recent.note_opened(&gone);
        recent.note_opened(&canonical(&b.dir));
    }
    std::fs::remove_dir_all(&c.dir).expect("delete gamma");

    ide.click("Project alpha");
    ide.settle();
    assert!(ide.state().projects.is_missing(&gone));
    assert!(!ide.state().projects.is_missing(&canonical(&b.dir)));
    assert_eq!(recent_rows(&ide), vec!["beta", "gamma (missing)"]);
    ide.snapshot("popup_missing");

    ide.click("Recent project gamma (missing)");
    ide.settle();
    assert_eq!(ide.state().workspaces().len(), 1, "a missing folder does not open");
    assert!(popup_open(&ide), "the popup stays open, so the row can be removed");
    let toast = format!("Folder not found: {}", gone.display());
    assert!(ide.state().notifications.toast_titles().contains(&toast), "{:?}", ide.state().notifications.toast_titles());

    ide.hover("Recent project gamma (missing)");
    ide.click("Remove recent project gamma");
    ide.settle();
    assert_eq!(recent_rows(&ide), vec!["beta"]);
    assert!(!ide.state().projects.recent.contains(&gone));

    ide.click("Recent project beta");
    let rb = canonical(&b.dir);
    ide.wait_for("beta opened from Recent", move |s| s.ws.project.as_ref().is_some_and(|p| p.root == rb) && s.ws.git.status_ms.is_some());
    ide.settle();
    assert_eq!(ide.state().workspaces().len(), 2);
}
