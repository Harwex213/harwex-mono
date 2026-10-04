//! Several projects in one window (task 032): each workspace keeps its tabs, tree, scroll and
//! terminals across switches; background results reach their own workspace; closing asks about
//! unsaved files; a restart restores the open projects and the active one.

mod common;

use std::path::{Path, PathBuf};

use common::*;
use egui::Key;
use harwex_ide::layout::ToolWindow;
use harwex_ide::WorkspaceId;

const SUITE: &str = "workspaces";

fn canonical(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).expect("canonical")
}

/// Opens `dir` as another workspace and waits until its tree, index and git status loaded.
fn open_second(ide: &mut Ide, dir: &Path) -> WorkspaceId {
    let id = open_loaded(ide, dir);
    ide.settle();
    id
}

/// `open_second` without the final settle, for tests that hold a job of another workspace.
fn open_loaded(ide: &mut Ide, dir: &Path) -> WorkspaceId {
    let id = ide.state_mut().open_workspace(dir.to_path_buf());
    let root = canonical(dir);
    ide.wait_for("second project loaded", move |s| {
        s.ws.id == id && s.ws.project.as_ref().is_some_and(|p| p.root == root && s.ws.tree.is_loaded(&p.root)) && s.ws.index.build_ms.is_some() && s.ws.git.status_ms.is_some()
    });
    id
}

fn activate(ide: &mut Ide, id: WorkspaceId) {
    assert!(ide.state_mut().activate(id));
    ide.settle();
    assert_eq!(ide.state().ws.id, id);
}

fn terminal_screen(ide: &Ide) -> String {
    let t = &ide.state().ws.terminals;
    t.terminal(t.active_index()).map(|t| t.screen_text()).unwrap_or_default()
}

/// Switching keeps each project's tabs, tree expansion, tree scroll and terminal. The other
/// project's terminal keeps running in the background, and focus does not leak across.
#[test]
fn switching_keeps_each_projects_state() {
    let fx = Fixture::new(SUITE, "switch");
    let a = basic_repo(fx.path("alpha"));
    // Folders sort first: enough of them that the tree scrolls.
    for i in 0..60 {
        a.write(&format!("a{i:02}/x.txt"), "x\n");
    }
    let b = basic_repo(fx.path("beta"));
    let mut ide = Ide::open(SUITE, &a.dir);
    let a_id = ide.state().ws.id;
    ide.open_file("src/app.ts");
    ide.state_mut().ws.tree.set_expanded(&canonical(&a.dir).join("src"), true);
    ide.key_mods(ALT, Key::F12);
    ide.wait_until("shell prompt in alpha", |ide| terminal_screen(ide).lines().any(|l| l.starts_with('$')));
    let shell = ide.state().ws.terminals.terminal(0).and_then(|t| t.process_id()).expect("shell pid");
    assert!(ide.state().ws.owned_pids().contains(&shell), "the shell belongs to alpha");
    // Output that arrives while beta is active.
    ide.type_text("sleep 1; echo done-in-alpha\n");
    // Scroll the tree so that "a00" is out of view.
    ide.click("a00");
    assert!(harwex_ide::tree::has_focus(&ide.ctx()));
    let row = ide.rect("a00");
    ide.move_to(egui::pos2(row.min.x + 20.0, row.center().y));
    for _ in 0..10 {
        ide.harness.input_mut().events.push(egui::Event::MouseWheel { unit: egui::MouseWheelUnit::Point, delta: egui::vec2(0.0, -80.0), modifiers: egui::Modifiers::NONE });
        ide.step();
    }
    ide.settle();
    assert!(!ide.has("a00"), "alpha's tree scrolled");

    let b_id = open_second(&mut ide, &b.dir);
    assert_ne!(a_id, b_id);
    let names: Vec<(String, bool)> = ide.state().workspaces().into_iter().map(|w| (w.name, w.is_active)).collect();
    assert_eq!(names, vec![("alpha".to_string(), false), ("beta".to_string(), true)]);
    assert!(ide.state().ws.tabs.list.is_empty(), "beta starts without tabs");
    assert!(ide.state().ws.terminals.is_empty(), "beta starts without terminals");
    assert!(!harwex_ide::tree::has_focus(&ide.ctx()), "alpha's tree focus does not reach beta");
    assert!(ide.has("src") && ide.has("docs"), "beta's tree starts at the top");
    ide.assert_no_text("a01");
    ide.open_file("README.md");
    assert_eq!(ide.tab_titles(), vec!["README.md"]);
    ide.wait_until("alpha's shell ran while beta was active", |ide| {
        ide.state().workspace(a_id).and_then(|w| w.terminals.terminal(0)).is_some_and(|t| t.screen_text().lines().any(|l| l == "done-in-alpha"))
    });

    activate(&mut ide, a_id);
    assert_eq!(ide.tab_titles(), vec!["app.ts"]);
    assert!(ide.state().ws.tree.is_expanded(&canonical(&a.dir).join("src")));
    assert!(!ide.has("a00"), "alpha's tree scroll survived the switch");
    assert_eq!(ide.state().ws.terminals.len(), 1);
    assert!(terminal_screen(&ide).lines().any(|l| l == "done-in-alpha"));
    assert_eq!(ide.state().ws.layout.bottom, Some(ToolWindow::Terminal));
    ide.snapshot("alpha_again");

    activate(&mut ide, b_id);
    assert_eq!(ide.tab_titles(), vec!["README.md"]);
    assert_eq!(ide.state().ws.layout.bottom, None, "layouts are per project");
}

/// A job started in alpha that finishes while beta is active lands in alpha.
#[test]
fn background_job_lands_in_its_own_workspace() {
    let fx = Fixture::new(SUITE, "job");
    let a = basic_repo(fx.path("alpha"));
    let b = basic_repo(fx.path("beta"));
    let mut ide = Ide::open(SUITE, &a.dir);
    let a_id = ide.state().ws.id;
    let (release, gate) = std::sync::mpsc::channel::<()>();
    ide.state().jobs.spawn_quiet(
        move || {
            let _ = gate.recv();
        },
        |state, ()| {
            state.ws.find.query = format!("landed in {}", state.ws.project.as_ref().map_or("", |p| p.name.as_str()));
        },
    );
    // Git status of alpha, refreshed after a change, also finishes in the background.
    a.write("README.md", "changed\n");
    ide.state_mut().refresh_git();
    let b_id = open_loaded(&mut ide, &b.dir);
    assert_eq!(ide.state().workspace(a_id).map(|w| w.find.query.as_str()), Some(""), "the job still waits");
    release.send(()).expect("job waits");
    ide.settle();
    assert_eq!(ide.state().ws.id, b_id, "beta stays active");
    assert_eq!(ide.state().ws.find.query, "", "nothing landed in beta");
    assert!(ide.state().ws.git.status.is_empty(), "beta has no changes");
    let alpha = ide.state().workspace(a_id).expect("alpha open");
    assert_eq!(alpha.find.query, "landed in alpha");
    assert_eq!(alpha.git.status.len(), 1, "alpha's refresh landed in alpha: {:?}", alpha.git.status);
}

/// Closing a workspace with unsaved files asks first: Cancel keeps it, "Close Without Saving"
/// drops the edit, "Save and Close" writes it. Closing the last project leaves the welcome screen.
#[test]
fn closing_with_unsaved_files_asks() {
    let fx = Fixture::new(SUITE, "close");
    let a = basic_repo(fx.path("alpha"));
    let b = basic_repo(fx.path("beta"));
    let mut ide = Ide::open(SUITE, &a.dir);
    let a_id = ide.state().ws.id;
    let b_id = open_second(&mut ide, &b.dir);
    ide.open_file("README.md");
    ide.type_text("X");
    activate(&mut ide, a_id);

    // Closing the background beta brings it forward with the prompt.
    ide.state_mut().close_workspace(b_id);
    ide.settle();
    assert_eq!(ide.state().ws.id, b_id);
    ide.assert_text("Close project beta?");
    ide.dismiss_toasts();
    ide.snapshot("close_prompt");
    ide.click("Cancel");
    ide.settle();
    assert_eq!(ide.state().workspaces().len(), 2);
    assert!(ide.active_text().starts_with('X'), "the edit is still there");

    ide.state_mut().close_workspace(b_id);
    ide.settle();
    ide.click("Close Without Saving");
    ide.settle();
    assert_eq!(ide.state().workspaces().len(), 1);
    assert_eq!(ide.state().ws.id, a_id, "alpha is active again");
    assert_eq!(b.read("README.md"), "# demo\n\nA small project.\n");
    assert!(ide.state().workspace(b_id).is_none());

    // Again, with Save.
    let b2 = open_second(&mut ide, &b.dir);
    assert_ne!(b2, b_id, "a closed workspace's id is not reused");
    ide.open_file("README.md");
    ide.type_text("Y");
    ide.state_mut().close_workspace(b2);
    ide.settle();
    ide.click("Save and Close");
    ide.wait_for("beta closed after the save", move |s| s.workspace(b2).is_none());
    assert_eq!(b.read("README.md"), "Y# demo\n\nA small project.\n");

    // The last project: a blank workspace (the welcome screen) remains.
    ide.state_mut().close_workspace(a_id);
    ide.settle();
    let left = ide.state().workspaces();
    assert_eq!(left.len(), 1);
    assert!(left[0].root.is_none() && left[0].is_active);
    ide.assert_text("Open Folder...");
}

/// Opening a root that is open already activates its workspace, also when the path is spelled
/// differently (canonicalized on a worker).
#[test]
fn same_root_twice_activates_the_open_workspace() {
    let fx = Fixture::new(SUITE, "twice");
    let a = basic_repo(fx.path("alpha"));
    let b = basic_repo(fx.path("beta"));
    let mut ide = Ide::open(SUITE, &a.dir);
    let a_id = ide.state().ws.id;
    let b_id = open_second(&mut ide, &b.dir);

    let again = ide.state_mut().open_workspace(canonical(&a.dir));
    assert_eq!(again, a_id);
    ide.settle();
    assert_eq!(ide.state().ws.id, a_id);

    activate(&mut ide, b_id);
    ide.state_mut().open_workspace(a.dir.join("src").join(".."));
    ide.settle();
    assert_eq!(ide.state().workspaces().len(), 2, "no second workspace for the same root");
    assert_eq!(ide.state().ws.id, a_id);
}

/// A restart reopens both projects, activates the one that was active, and restores each
/// project's layout and open files.
#[test]
fn restart_restores_projects_and_active() {
    let fx = Fixture::new(SUITE, "restart");
    let a = basic_repo(fx.path("alpha"));
    let b = basic_repo(fx.path("beta"));
    let (ra, rb) = (canonical(&a.dir), canonical(&b.dir));
    let mut storage = MemoryStorage::default();
    {
        let mut ide = Ide::open(SUITE, &a.dir);
        ide.open_file("src/util.ts");
        ide.open_file("src/app.ts");
        open_second(&mut ide, &b.dir);
        ide.open_file("README.md");
        ide.click("Find tool window");
        ide.settle();
        eframe::App::save(ide.harness.state_mut(), &mut storage);
    }
    let lines = |key: &str| storage.map.get(key).map(|t| t.lines().map(str::to_string).collect::<Vec<_>>()).unwrap_or_default();
    assert_eq!(lines("open_projects"), vec![ra.display().to_string(), rb.display().to_string()]);
    assert_eq!(lines("active_project"), vec![rb.display().to_string()]);
    assert_eq!(lines("last_folder"), vec![rb.display().to_string()]);

    let options = harwex_ide::AppOptions { restore_last_folder: true, ..test_options(None) };
    let mut ide = Ide::with_options(SUITE, options, Some(&storage));
    let (ra2, rb2) = (ra.clone(), rb.clone());
    ide.wait_for("both projects and their files restored", move |s| {
        let roots: Vec<Option<PathBuf>> = s.workspaces().into_iter().map(|w| w.root).collect();
        let a_tabs = s.all_ws().find(|w| w.project.as_ref().is_some_and(|p| p.root == ra2)).map_or(0, |w| w.tabs.list.len());
        roots == vec![Some(ra2.clone()), Some(rb2.clone())] && a_tabs == 2 && !s.ws.tabs.list.is_empty() && s.ws.git.status_ms.is_some()
    });
    ide.settle();
    assert_eq!(ide.state().ws.project.as_ref().map(|p| p.root.clone()), Some(rb.clone()), "beta is active again");
    assert_eq!(ide.tab_titles(), vec!["README.md"]);
    assert_eq!(ide.state().ws.layout.left, Some(ToolWindow::Find));
    let a_id = ide.state().workspaces()[0].id;
    activate(&mut ide, a_id);
    assert_eq!(ide.tab_titles(), vec!["util.ts", "app.ts"]);
    assert_eq!(ide.active_title().as_deref(), Some("app.ts"));
    assert_eq!(ide.state().ws.layout.left, Some(ToolWindow::Project));

    // An explicit folder (a terminal start) opens next to the restored ones and wins.
    let c = basic_repo(fx.path("gamma"));
    let options = harwex_ide::AppOptions { project: Some(c.dir.clone()), restore_last_folder: true, ..test_options(None) };
    let ide = Ide::with_options(SUITE, options, Some(&storage));
    let names: Vec<String> = ide.state().workspaces().into_iter().map(|w| w.name).collect();
    assert_eq!(names, vec!["alpha", "beta", "gamma"]);
    assert_eq!(ide.state().ws.project.as_ref().map(|p| p.name.as_str()), Some("gamma"));
}
