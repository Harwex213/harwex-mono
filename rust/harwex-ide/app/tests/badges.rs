//! Count badges (task 036): open terminal tabs on the Terminal strip button, changed files on
//! the Commit strip button, open projects on the title-bar project widget. Each badge is an
//! a11y node whose label carries the count; it is hidden at 0 (1 for projects).

mod common;

use std::path::{Path, PathBuf};

use common::*;
use egui::Key;
use harwex_ide::WorkspaceId;

const SUITE: &str = "badges";

fn canonical(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).expect("canonical")
}

/// The labels of all count badges on screen.
fn badges(ide: &Ide) -> Vec<String> {
    ide.labels().into_iter().filter(|l| l.starts_with("Terminal, ") || l.starts_with("Commit, ") || l.ends_with(" open projects")).collect()
}

fn open_loaded(ide: &mut Ide, dir: &Path) -> WorkspaceId {
    let id = ide.state_mut().open_workspace(dir.to_path_buf());
    let root = canonical(dir);
    ide.wait_for("project loaded", move |s| {
        s.ws.id == id && s.ws.project.as_ref().is_some_and(|p| p.root == root && s.ws.tree.is_loaded(&p.root)) && s.ws.index.build_ms.is_some() && s.ws.git.status_ms.is_some()
    });
    ide.settle();
    id
}

/// Re-reads git status and waits until it landed.
fn refresh_git(ide: &mut Ide) {
    ide.state_mut().ws.git.status_ms = None;
    ide.state_mut().refresh_git();
    ide.wait_for("git status", |s| s.ws.git.status_ms.is_some() && !s.ws.git.refreshing);
    ide.settle();
}

/// Waits until every terminal of the active project shows its prompt, so snapshots do not
/// depend on how fast the shells start.
fn wait_prompts(ide: &mut Ide) {
    ide.wait_until("shell prompts", |ide| {
        let t = &ide.state().ws.terminals;
        (0..t.len()).all(|i| t.terminal(i).is_some_and(|t| t.screen_text().lines().any(|l| l.starts_with('$'))))
    });
    ide.settle();
}

/// The badge sits on the button's top-right corner and stays inside the strip.
fn assert_on_corner(ide: &Ide, badge: &str, button: &str) {
    let (b, r) = (ide.rect(badge), ide.rect(button));
    assert!(r.contains(b.center()), "{badge} {b:?} sits on {button} {r:?}");
    assert!(b.center().x > r.center().x && b.center().y < r.center().y, "{badge} {b:?} is at the top-right of {button} {r:?}");
    assert!(b.max.x <= harwex_ide::theme::T.space.strip_w, "{badge} {b:?} stays inside the strip");
}

#[test]
fn terminal_badge_counts_tabs() {
    let fx = Fixture::new(SUITE, "terminal");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    assert!(badges(&ide).is_empty(), "no badge without terminals or changes: {:?}", badges(&ide));

    ide.key_mods(ALT, Key::F12);
    ide.wait_for("terminal spawned", |s| s.ws.terminals.len() == 1);
    ide.settle();
    assert_eq!(badges(&ide), vec!["Terminal, 1 tab"]);
    assert_on_corner(&ide, "Terminal, 1 tab", "Terminal tool window");
    for n in 2..=3 {
        ide.click("+");
        ide.wait_for("another terminal", move |s| s.ws.terminals.len() == n);
        ide.settle();
    }
    assert_eq!(badges(&ide), vec!["Terminal, 3 tabs"]);
    wait_prompts(&mut ide);
    ide.snapshot("terminal_3");

    // The badge stays while the tool window is hidden, and the button still toggles it.
    ide.click("Terminal tool window");
    ide.settle();
    assert_eq!(ide.state().ws.layout.bottom, None);
    assert!(ide.has("Terminal, 3 tabs"));
    ide.click("Terminal tool window");
    ide.settle();

    while !ide.state().ws.terminals.is_empty() {
        let n = ide.state().ws.terminals.len();
        let close = ide.rects("x").len();
        ide.click_nth("x", close - 1);
        ide.wait_for("tab closed", move |s| s.ws.terminals.len() == n - 1);
        ide.settle();
        let left = n - 1;
        let want: Vec<String> = match left {
            0 => vec![],
            1 => vec!["Terminal, 1 tab".into()],
            _ => vec![format!("Terminal, {left} tabs")],
        };
        assert_eq!(badges(&ide), want);
    }
}

#[test]
fn commit_badge_counts_changed_files() {
    let fx = Fixture::new(SUITE, "commit");
    // Modified, added (staged), deleted, untracked.
    let repo = changed_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    assert_eq!(badges(&ide), vec!["Commit, 4 changed files"]);
    assert_on_corner(&ide, "Commit, 4 changed files", "Commit tool window");

    // Staging moves a file between groups; the count stays. A partly staged file counts once.
    repo.git(&["add", "src/app.ts"]);
    repo.write("src/app.ts", "changed again\n");
    refresh_git(&mut ide);
    assert_eq!(badges(&ide), vec!["Commit, 4 changed files"]);

    repo.write("new.txt", "new\n");
    refresh_git(&mut ide);
    assert_eq!(badges(&ide), vec!["Commit, 5 changed files"]);
    ide.snapshot("commit_5");

    repo.commit_all("everything");
    refresh_git(&mut ide);
    assert!(badges(&ide).is_empty(), "a clean tree has no badge: {:?}", badges(&ide));
    repo.write("README.md", "one\n");
    refresh_git(&mut ide);
    assert_eq!(badges(&ide), vec!["Commit, 1 changed file"]);
}

/// Above 99 the badge reads "99+" and still fits in the strip; the label keeps the real count.
#[test]
fn commit_badge_caps_at_99() {
    let fx = Fixture::new(SUITE, "many");
    let repo = many_changes_repo(fx.path("repo"), 120);
    let mut ide = Ide::open(SUITE, &repo.dir);
    let n = ide.state().ws.git.changes.len();
    assert!(n > 99, "{n} changes");
    let label = format!("Commit, {n} changed files");
    assert_eq!(badges(&ide), vec![label.clone()]);
    assert_eq!(harwex_ide::badge::text(n), "99+");
    assert_on_corner(&ide, &label, "Commit tool window");
    ide.snapshot("commit_99_plus");
}

#[test]
fn project_badge_counts_open_projects() {
    let fx = Fixture::new(SUITE, "projects");
    let a = basic_repo(fx.path("alpha"));
    let b = basic_repo(fx.path("beta"));
    let c = basic_repo(fx.path("gamma"));
    let mut ide = Ide::open(SUITE, &a.dir);
    assert!(badges(&ide).is_empty(), "one project has no badge");

    let b_id = open_loaded(&mut ide, &b.dir);
    assert_eq!(badges(&ide), vec!["2 open projects"]);
    let (badge, widget) = (ide.rect("2 open projects"), ide.rect("Project beta"));
    assert!(widget.contains(badge.center()), "the badge {badge:?} sits on the project widget {widget:?}");
    assert!(badge.max.y <= harwex_ide::theme::T.space.title_h, "inside the title bar");
    let c_id = open_loaded(&mut ide, &c.dir);
    assert_eq!(badges(&ide), vec!["3 open projects"]);
    ide.snapshot("projects_3");

    ide.state_mut().close_workspace(c_id);
    ide.settle();
    assert_eq!(badges(&ide), vec!["2 open projects"]);
    ide.state_mut().close_workspace(b_id);
    ide.settle();
    assert!(badges(&ide).is_empty(), "back to one project: {:?}", badges(&ide));
}

/// All three badges, also at 2x, where the digits must stay crisp and centered.
#[test]
fn badges_at_2x() {
    let fx = Fixture::new(SUITE, "retina");
    let a = changed_repo(fx.path("alpha"));
    let b = basic_repo(fx.path("beta"));
    let mut ide = Ide::open(SUITE, &a.dir);
    let a_id = ide.state().ws.id;
    open_loaded(&mut ide, &b.dir);
    assert!(ide.state_mut().activate(a_id));
    ide.settle();
    ide.key_mods(ALT, Key::F12);
    ide.wait_for("terminal spawned", |s| s.ws.terminals.len() == 1);
    ide.click("+");
    ide.wait_for("second terminal", |s| s.ws.terminals.len() == 2);
    wait_prompts(&mut ide);
    assert_eq!(badges(&ide), vec!["2 open projects", "Commit, 4 changed files", "Terminal, 2 tabs"]);
    ide.snapshot("all_1x");
    ide.ctx().set_pixels_per_point(2.0);
    ide.snapshot("all_2x");
}
