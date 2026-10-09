//! Status bar breadcrumbs: segments, the directory popup, nested popups, opening a file, the
//! keyboard, the navigation-bar keyboard (Alt+Home), the horizontal scroll in a narrow window, and
//! diff tabs.

use crate::common::*;
use egui::{Key, Modifiers};
use harwex_ide::AppState;

const SUITE: &str = "breadcrumbs";

/// `basic_repo` plus an untracked file, a modified file, an ignored directory and a deep path.
fn crumbs_repo(fx: &Fixture) -> Repo {
    let repo = basic_repo(fx.path("repo"));
    repo.write("src/core/fresh.ts", "export const fresh = 1;\n");
    repo.write("src/util.ts", "export const changed = 1;\n");
    repo.write("src/ignored/hidden.ts", "export const hidden = 1;\n");
    repo.write("src/core/deep/level_one/level_two/level_three/target_file_name.ts", "export const target = 1;\n");
    repo
}

/// Directories of the open popup levels, relative to the root.
fn levels(s: &AppState) -> Vec<String> {
    let root = s.ws.project.as_ref().map(|p| p.root.clone()).unwrap_or_default();
    s.ws.breadcrumbs.popup.as_ref().map_or_else(Vec::new, |p| {
        p.levels
            .iter()
            .map(|l| l.dir.strip_prefix(&root).map_or_else(|_| l.dir.display().to_string(), |r| r.display().to_string()))
            .collect()
    })
}

/// The selected entry of popup level `level`, relative to the root.
fn selected(s: &AppState, level: usize) -> Option<String> {
    let root = s.ws.project.as_ref()?.root.clone();
    let p = s.ws.breadcrumbs.popup.as_ref()?;
    let l = p.levels.get(level)?;
    let e = s.ws.breadcrumbs.items(l)?.get(l.selected?)?;
    Some(e.path.strip_prefix(&root).unwrap_or(&e.path).display().to_string())
}

fn names(s: &AppState, level: usize) -> Vec<String> {
    let p = s.ws.breadcrumbs.popup.as_ref().expect("popup open");
    s.ws.breadcrumbs.items(&p.levels[level]).unwrap_or_default().iter().map(|e| e.name.clone()).collect()
}

fn active_rel(ide: &Ide) -> String {
    let root = ide.root();
    let e = ide.state().ws.tabs.active_editor().expect("active editor");
    e.path.strip_prefix(&root).unwrap_or(&e.path).display().to_string()
}

#[test]
fn bar_shows_the_active_file() {
    let fx = Fixture::new(SUITE, "bar");
    let repo = crumbs_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    assert!(ide.state().ws.breadcrumbs.slots.is_empty(), "no tab, no breadcrumbs");
    ide.open_file("src/core/deep/nested.ts");
    for label in ["Breadcrumb repo", "Breadcrumb src", "Breadcrumb core", "Breadcrumb deep", "Breadcrumb nested.ts"] {
        assert!(ide.has(label), "missing {label}");
    }
    assert_eq!(ide.state().ws.breadcrumbs.slots.len(), 5);
    ide.snapshot("bar");

    // The bar follows the active tab; a modified file is drawn in the git color.
    ide.open_file("src/util.ts");
    assert!(ide.has("Breadcrumb util.ts") && !ide.has("Breadcrumb deep"));
    ide.snapshot("bar_modified_file");
}

#[test]
fn popup_lists_children_and_opens_nested_popups() {
    let fx = Fixture::new(SUITE, "popup");
    let repo = crumbs_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/core/deep/nested.ts");

    ide.click("Breadcrumb src");
    ide.wait_until("src popup", |ide| ide.has("Breadcrumb item src/app.ts"));
    ide.settle();
    // Directories first, ignored ones left out; the child on the path is selected.
    assert_eq!(names(ide.state(), 0), ["core", "app.ts", "util.ts"]);
    assert_eq!(selected(ide.state(), 0).as_deref(), Some("src/core"));
    assert!(ide.is_selected("Breadcrumb src"));
    ide.snapshot("popup_src");

    // Hovering a directory opens its children in a nested popup.
    ide.hover("Breadcrumb item src/core");
    ide.wait_until("core popup", |ide| ide.has("Breadcrumb item src/core/fresh.ts"));
    ide.settle();
    assert_eq!(levels(ide.state()), ["src", "src/core"]);
    assert_eq!(names(ide.state(), 1), ["deep", "fresh.ts"]);
    assert_eq!(selected(ide.state(), 1).as_deref(), Some("src/core/deep"));
    ide.hover("Breadcrumb item src/core/deep");
    ide.wait_until("deep popup", |ide| ide.has("Breadcrumb item src/core/deep/nested.ts"));
    ide.settle();
    assert_eq!(levels(ide.state()), ["src", "src/core", "src/core/deep"]);
    ide.snapshot_here("popup_nested");

    // Hovering a file closes the deeper level.
    ide.hover("Breadcrumb item src/core/fresh.ts");
    ide.settle();
    assert_eq!(levels(ide.state()), ["src", "src/core"]);

    // A click on a file opens it and closes the popup.
    ide.click("Breadcrumb item src/core/fresh.ts");
    ide.wait_for("fresh.ts open", |s| s.ws.tabs.active_tab().is_some_and(|t| t.title() == "fresh.ts"));
    ide.settle();
    assert!(ide.state().ws.breadcrumbs.popup.is_none());
    assert!(ide.has("Breadcrumb fresh.ts"));

    // A click outside closes the popup; a second click on the open segment closes it too.
    ide.click("Breadcrumb repo");
    ide.wait_until("root popup", |ide| ide.has("Breadcrumb item README.md"));
    assert_eq!(names(ide.state(), 0), ["docs", "src", ".gitignore", "README.md"]);
    ide.click("Breadcrumb repo");
    assert!(ide.state().ws.breadcrumbs.popup.is_none());
    ide.click("Breadcrumb core");
    ide.wait_until("core popup", |ide| ide.has("Breadcrumb item src/core/deep"));
    let editor = ide.rect("Editor fresh.ts").center();
    ide.click_at(editor);
    assert!(ide.state().ws.breadcrumbs.popup.is_none());

    // A click on the file segment opens its file menu; Esc closes it and leaves the bar the
    // keyboard, and Down lists the file's siblings with the file selected.
    ide.click("Breadcrumb fresh.ts");
    assert!(ide.state().ws.breadcrumbs.menu.is_some() && ide.state().ws.breadcrumbs.popup.is_none());
    ide.key(Key::Escape);
    assert!(ide.state().ws.breadcrumbs.menu.is_none() && bar_focused(&ide));
    ide.key(Key::ArrowDown);
    ide.wait_until("siblings", |ide| ide.has("Breadcrumb item src/core/deep"));
    ide.settle();
    assert_eq!(levels(ide.state()), ["src/core"]);
    assert_eq!(selected(ide.state(), 0).as_deref(), Some("src/core/fresh.ts"));
}

#[test]
fn keyboard_moves_enters_and_opens() {
    let fx = Fixture::new(SUITE, "keyboard");
    let repo = crumbs_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/core/deep/nested.ts");
    let text = ide.active_text();

    ide.click("Breadcrumb src");
    ide.wait_until("src popup", |ide| ide.has("Breadcrumb item src/app.ts"));
    ide.settle();
    ide.park_mouse();
    ide.key(Key::ArrowDown);
    assert_eq!(selected(ide.state(), 0).as_deref(), Some("src/app.ts"));
    ide.key(Key::ArrowDown);
    assert_eq!(selected(ide.state(), 0).as_deref(), Some("src/util.ts"));
    ide.key(Key::ArrowDown);
    assert_eq!(selected(ide.state(), 0).as_deref(), Some("src/core"), "Down wraps to the first row");

    // Right enters the directory: a nested popup with the keyboard focus in it.
    ide.key(Key::ArrowRight);
    ide.wait_until("core popup", |ide| ide.has("Breadcrumb item src/core/fresh.ts"));
    ide.settle();
    assert_eq!(ide.state().ws.breadcrumbs.popup.as_ref().map(|p| p.focus), Some(1));
    assert_eq!(selected(ide.state(), 1).as_deref(), Some("src/core/deep"));
    ide.key(Key::ArrowDown);
    assert_eq!(selected(ide.state(), 1).as_deref(), Some("src/core/fresh.ts"));
    ide.snapshot("keyboard_nested");

    // Left goes back and closes the nested popup.
    ide.key(Key::ArrowLeft);
    assert_eq!(levels(ide.state()), ["src"]);
    assert_eq!(ide.state().ws.breadcrumbs.popup.as_ref().map(|p| p.focus), Some(0));

    // Enter on a directory enters it; Enter on a file opens the file.
    ide.key(Key::Enter);
    ide.wait_until("core popup again", |ide| ide.has("Breadcrumb item src/core/fresh.ts"));
    ide.settle();
    ide.key(Key::ArrowDown);
    // None of the keys reached the editor.
    assert_eq!(ide.cursor(), (0, 0));
    assert_eq!(ide.active_text(), text);
    ide.key(Key::Enter);
    ide.wait_for("fresh.ts open", |s| s.ws.tabs.active_tab().is_some_and(|t| t.title() == "fresh.ts"));
    ide.settle();
    assert!(ide.state().ws.breadcrumbs.popup.is_none());
    assert_eq!(ide.active_text(), "export const fresh = 1;\n", "Enter did not type a newline");

    // Escape closes the popup.
    ide.click("Breadcrumb src");
    ide.wait_until("src popup", |ide| ide.has("Breadcrumb item src/app.ts"));
    ide.key(Key::Escape);
    assert!(ide.state().ws.breadcrumbs.popup.is_none());
    assert!(!ide.has("Breadcrumb item src/app.ts"));
    assert_eq!(active_rel(&ide), "src/core/fresh.ts");
}

/// A wheel step at `at`; egui spreads it over a few frames.
fn wheel(ide: &mut Ide, at: egui::Pos2, delta: egui::Vec2) {
    ide.move_to(at);
    ide.harness.input_mut().events.push(egui::Event::MouseWheel { unit: egui::MouseWheelUnit::Point, delta, modifiers: Modifiers::NONE });
    ide.steps(10);
    ide.settle();
}

fn bar_rect(ide: &Ide) -> egui::Rect {
    ide.state().ws.breadcrumbs.bar_rect.expect("the bar is drawn")
}

/// The crumb is drawn whole inside the bar's viewport.
fn crumb_visible(ide: &Ide, label: &str) -> bool {
    let (bar, r) = (bar_rect(ide), ide.rect(label));
    r.min.x >= bar.min.x - 0.5 && r.max.x <= bar.max.x + 0.5
}

const DEEP: &str = "src/core/deep/level_one/level_two/level_three/target_file_name.ts";

#[test]
fn narrow_window_scrolls_to_the_file() {
    let fx = Fixture::new(SUITE, "narrow");
    let repo = crumbs_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file(DEEP);
    assert_eq!(ide.state().ws.breadcrumbs.slots.len(), 8);
    assert_eq!(ide.state().ws.breadcrumbs.scroll_x, 0.0, "1280 px fits the whole path");
    ide.snapshot("wide_deep_path");

    // Every segment stays; the row starts scrolled to its end, so the file crumb is visible
    // and the root is cut on the left.
    ide.resize(egui::vec2(640.0, 800.0));
    ide.settle();
    assert_eq!(ide.state().ws.breadcrumbs.slots.len(), 8, "no segment is hidden");
    assert!(ide.state().ws.breadcrumbs.scroll_x > 0.0);
    assert!(crumb_visible(&ide, "Breadcrumb target_file_name.ts"));
    assert!((ide.rect("Breadcrumb target_file_name.ts").max.x - bar_rect(&ide).max.x).abs() < 0.5, "scrolled to the end");
    assert!(ide.rect("Breadcrumb repo").max.x < bar_rect(&ide).min.x, "the root is scrolled out");
    ide.park_mouse();
    ide.snapshot("narrow");

    // A plain wheel scrolls the row back to the start, and the row stays there.
    let at = bar_rect(&ide).center();
    wheel(&mut ide, at, egui::vec2(0.0, 2000.0));
    assert_eq!(ide.state().ws.breadcrumbs.scroll_x, 0.0);
    assert!(crumb_visible(&ide, "Breadcrumb repo") && !crumb_visible(&ide, "Breadcrumb target_file_name.ts"));
    ide.steps(5);
    ide.settle();
    assert_eq!(ide.state().ws.breadcrumbs.scroll_x, 0.0, "a manual scroll stays");

    // A popup opens under its crumb at the scrolled position.
    ide.click("Breadcrumb core");
    ide.wait_until("core popup", |ide| ide.has("Breadcrumb item src/core/fresh.ts"));
    ide.settle();
    let core = ide.rect("Breadcrumb core");
    let popup = ide.state().ws.breadcrumbs.popup_rects[0];
    assert!((popup.min.x - core.min.x).abs() < 0.5, "the popup starts at the crumb: {} vs {}", popup.min.x, core.min.x);
    ide.snapshot_here("narrow_scrolled_popup");
    ide.key(Key::Escape);

    // Another file scrolls to its end again; so does the deep file when it comes back.
    repo.write("src/core/deep/level_one/level_two/level_three/other_file_with_a_long_name.ts", "export const other = 1;\n");
    ide.open_file("src/core/deep/level_one/level_two/level_three/other_file_with_a_long_name.ts");
    assert!(crumb_visible(&ide, "Breadcrumb other_file_with_a_long_name.ts"));
    assert!(ide.state().ws.breadcrumbs.scroll_x > 0.0);
    ide.open_file(DEEP);
    assert!(crumb_visible(&ide, "Breadcrumb target_file_name.ts"));

    // A wider window keeps the row at its end until the whole path fits.
    ide.resize(egui::vec2(900.0, 800.0));
    ide.settle();
    assert!(crumb_visible(&ide, "Breadcrumb target_file_name.ts"));
    assert!((ide.rect("Breadcrumb target_file_name.ts").max.x - bar_rect(&ide).max.x).abs() < 0.5 || ide.state().ws.breadcrumbs.scroll_x == 0.0);
}

#[test]
fn diff_tab_shows_the_diffed_file() {
    let fx = Fixture::new(SUITE, "diff");
    let repo = crumbs_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    let path = ide.root().join("src/util.ts");
    harwex_ide::git::diff::open_worktree_diff(ide.state_mut(), &path);
    ide.wait_for("diff tab", |s| s.ws.tabs.active_tab().is_some_and(|t| t.title() == "util.ts (Diff)"));
    ide.settle();
    assert!(ide.has("Breadcrumb repo") && ide.has("Breadcrumb src") && ide.has("Breadcrumb util.ts"));
    ide.snapshot("diff_tab");

    // The directory popup works from a diff tab too, and a click opens the file in an editor.
    ide.click("Breadcrumb src");
    ide.wait_until("src popup", |ide| ide.has("Breadcrumb item src/app.ts"));
    ide.settle();
    ide.click("Breadcrumb item src/app.ts");
    ide.wait_for("app.ts open", |s| s.ws.tabs.active_tab().is_some_and(|t| t.title() == "app.ts"));
    ide.settle();
    assert_eq!(ide.tab_titles(), ["util.ts (Diff)", "app.ts"]);
    assert!(ide.has("Breadcrumb app.ts"));
}

// ---------------------------------------------------------------------------------------------
// Files outside the project: the bar starts at a library label, not at `/`.

const REGISTRY_CRATE: &str = "cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde-1.0.228";

/// Opens `path` (absolute, outside the project) and waits for its tab.
fn open_external(ide: &mut Ide, path: &std::path::Path) {
    let path = std::fs::canonicalize(path).expect("file exists");
    ide.state_mut().open_location(&path, None, true);
    ide.wait_for("external tab", |s| s.ws.tabs.active_editor().is_some_and(|e| e.path == path));
    ide.settle();
}

/// The directory of popup level `level`, absolute.
fn level_dir(ide: &Ide, level: usize) -> Option<std::path::PathBuf> {
    ide.state().ws.breadcrumbs.popup.as_ref()?.levels.get(level).map(|l| l.dir.clone())
}

#[test]
fn registry_file_roots_at_crate_and_version() {
    let fx = Fixture::new(SUITE, "external_registry");
    let repo = crumbs_repo(&fx);
    let krate = fx.path(REGISTRY_CRATE);
    // No `Cargo.toml`: a crate folder without one starts no rust-analyzer, so the status bar
    // stays still for the snapshot.
    write(&krate, "README.md", "# serde\n");
    write(&krate, "src/lib.rs", "pub mod de;\n");
    write(&krate, "src/de/mod.rs", "pub trait Deserialize {}\n");
    write(&krate, "src/de/value.rs", "pub struct Value;\n");
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_external(&mut ide, &krate.join("src/de/mod.rs"));
    for label in ["Breadcrumb serde 1.0.228", "Breadcrumb src", "Breadcrumb de", "Breadcrumb mod.rs"] {
        assert!(ide.has(label), "missing {label}: {:?}", ide.labels());
    }
    assert_eq!(ide.state().ws.breadcrumbs.slots.len(), 4, "nothing above the crate folder");
    assert!(!ide.has("Breadcrumb registry") && !ide.has("Breadcrumb /"));

    // The root popup lists the crate folder, never a folder above it.
    ide.click("Breadcrumb serde 1.0.228");
    ide.wait_until("crate popup", |ide| ide.state().ws.breadcrumbs.popup.as_ref().is_some_and(|p| ide.state().ws.breadcrumbs.items(&p.levels[0]).is_some()));
    ide.settle();
    let krate = std::fs::canonicalize(&krate).expect("crate dir");
    assert_eq!(level_dir(&ide, 0).as_deref(), Some(krate.as_path()));
    assert_eq!(names(ide.state(), 0), ["src", "README.md"]);
    ide.snapshot("external_registry");
}

#[test]
fn other_external_file_shows_three_segments() {
    let fx = Fixture::new(SUITE, "external_file");
    let repo = crumbs_repo(&fx);
    write(&fx.dir, "outside/notes/todo/list.md", "# List\n");
    write(&fx.dir, "outside/notes/todo/done.md", "# Done\n");
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_external(&mut ide, &fx.path("outside/notes/todo/list.md"));
    for label in ["Breadcrumb External", "Breadcrumb notes", "Breadcrumb todo", "Breadcrumb list.md"] {
        assert!(ide.has(label), "missing {label}: {:?}", ide.labels());
    }
    assert_eq!(ide.state().ws.breadcrumbs.slots.len(), 4);

    // The file segment lists its siblings; the root lists the folder that holds `notes`.
    ide.click("Breadcrumb list.md");
    ide.wait_until("siblings", |ide| ide.state().ws.breadcrumbs.popup.as_ref().is_some_and(|p| ide.state().ws.breadcrumbs.items(&p.levels[0]).is_some()));
    ide.settle();
    assert_eq!(names(ide.state(), 0), ["done.md", "list.md"]);
    ide.snapshot("external_file");
    ide.key(Key::Escape);
    ide.click("Breadcrumb External");
    ide.wait_until("root popup", |ide| ide.state().ws.breadcrumbs.popup.as_ref().is_some_and(|p| ide.state().ws.breadcrumbs.items(&p.levels[0]).is_some()));
    let outside = std::fs::canonicalize(fx.path("outside")).expect("outside dir");
    assert_eq!(level_dir(&ide, 0).as_deref(), Some(outside.as_path()));
    assert_eq!(names(ide.state(), 0), ["notes"]);
}

// ---------------------------------------------------------------------------------------------
// Navigation-bar keyboard: Alt+Home, segments, popups and hops between them.

fn bar_focused(ide: &Ide) -> bool {
    ide.state().ws.breadcrumbs.bar_focused(&ide.ctx())
}

fn selected_slot(ide: &Ide) -> Option<usize> {
    ide.state().ws.breadcrumbs.selected_slot
}

fn focus_level(ide: &Ide) -> Option<usize> {
    ide.state().ws.breadcrumbs.popup.as_ref().map(|p| p.focus)
}

fn alt_home(ide: &mut Ide) {
    ide.key_mods(Modifiers::ALT, Key::Home);
}

/// Presses `key` and waits until level `level` of the popup selects `expected`.
fn key_then(ide: &mut Ide, key: Key, level: usize, expected: &str) {
    ide.key(key);
    ide.wait_until(expected, |ide| selected(ide.state(), level).as_deref() == Some(expected));
    ide.settle();
}

/// The editor has the keyboard: Right moves its caret one column.
fn assert_editor_has_keyboard(ide: &mut Ide) {
    let (line, col) = ide.cursor();
    ide.key(Key::ArrowRight);
    assert_eq!(ide.cursor(), (line, col + 1), "the editor got the key");
    ide.key(Key::ArrowLeft);
    assert_eq!(ide.cursor(), (line, col));
}

#[test]
fn alt_home_focuses_the_bar_and_moves_between_segments() {
    let fx = Fixture::new(SUITE, "nav_bar");
    let repo = crumbs_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/core/deep/nested.ts");
    ide.park_mouse();
    let text = ide.active_text();

    // Alt+Home selects the file segment; no popup opens.
    alt_home(&mut ide);
    assert_eq!(selected_slot(&ide), Some(4));
    assert!(bar_focused(&ide));
    assert!(ide.state().ws.breadcrumbs.popup.is_none());
    assert!(ide.is_selected("Breadcrumb nested.ts"));
    ide.snapshot("nav_bar_focused");

    // Left and Right move the selection and stop at the ends.
    ide.key(Key::ArrowLeft);
    ide.key(Key::ArrowLeft);
    assert_eq!(selected_slot(&ide), Some(2));
    assert!(ide.is_selected("Breadcrumb core") && !ide.is_selected("Breadcrumb nested.ts"));
    ide.snapshot("nav_bar_left");
    for _ in 0..4 {
        ide.key(Key::ArrowLeft);
    }
    assert_eq!(selected_slot(&ide), Some(0));
    assert!(ide.is_selected("Breadcrumb repo"));
    for _ in 0..6 {
        ide.key(Key::ArrowRight);
    }
    assert_eq!(selected_slot(&ide), Some(4));
    assert!(ide.state().ws.breadcrumbs.popup.is_none(), "Left and Right open no popup");

    // Up leaves the bar; the editor has the keyboard again.
    ide.key(Key::ArrowUp);
    assert_eq!(selected_slot(&ide), None);
    assert!(!bar_focused(&ide));
    assert!(!ide.is_selected("Breadcrumb nested.ts"));
    assert_eq!(ide.cursor(), (0, 0), "no arrow reached the editor");
    assert_editor_has_keyboard(&mut ide);

    // Escape leaves the bar too.
    alt_home(&mut ide);
    ide.key(Key::ArrowLeft);
    assert!(bar_focused(&ide));
    ide.key(Key::Escape);
    assert!(!bar_focused(&ide) && selected_slot(&ide).is_none());
    assert_editor_has_keyboard(&mut ide);

    // A click into the editor takes the keyboard from the bar.
    alt_home(&mut ide);
    assert!(bar_focused(&ide));
    let editor = ide.rect("Editor nested.ts").center();
    ide.click_at(editor);
    assert!(!bar_focused(&ide) && selected_slot(&ide).is_none());
    assert!(ide.cursor() != (0, 0) || ide.active_text().lines().count() == 1);

    // Down opens the selected segment's popup: the file segment lists its siblings.
    ide.click_at(ide.caret_pos(0, 0));
    alt_home(&mut ide);
    key_then(&mut ide, Key::ArrowDown, 0, "src/core/deep/nested.ts");
    assert_eq!(levels(ide.state()), ["src/core/deep"]);
    assert_eq!(selected_slot(&ide), Some(4));
    ide.key(Key::Escape);
    // Enter opens the popup too.
    alt_home(&mut ide);
    ide.key(Key::ArrowLeft);
    ide.key(Key::ArrowLeft);
    key_then(&mut ide, Key::Enter, 0, "src/core/deep");
    assert_eq!(levels(ide.state()), ["src/core"]);
    ide.key(Key::Escape);
    assert!(ide.state().ws.breadcrumbs.popup.is_none());
    assert_eq!(ide.active_text(), text, "no key reached the editor");
    assert_eq!(active_rel(&ide), "src/core/deep/nested.ts");
}

#[test]
fn popup_keys_wrap_enter_back_out_and_hop_between_segments() {
    let fx = Fixture::new(SUITE, "nav_popup");
    let repo = crumbs_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/core/deep/nested.ts");
    ide.park_mouse();
    let text = ide.active_text();

    // The bar on `src`, Down opens its popup with the current child selected.
    alt_home(&mut ide);
    for _ in 0..3 {
        ide.key(Key::ArrowLeft);
    }
    assert_eq!(selected_slot(&ide), Some(1));
    key_then(&mut ide, Key::ArrowDown, 0, "src/core");
    assert_eq!(levels(ide.state()), ["src"]);
    ide.snapshot("nav_popup_open");

    // Down wraps from the last row to the first.
    ide.key(Key::ArrowDown);
    assert_eq!(selected(ide.state(), 0).as_deref(), Some("src/app.ts"));
    ide.key(Key::ArrowDown);
    assert_eq!(selected(ide.state(), 0).as_deref(), Some("src/util.ts"));
    ide.key(Key::ArrowDown);
    assert_eq!(selected(ide.state(), 0).as_deref(), Some("src/core"), "Down wraps");

    // Up on the first row of the first level goes back to the segments.
    ide.key(Key::ArrowUp);
    assert!(ide.state().ws.breadcrumbs.popup.is_none());
    assert!(bar_focused(&ide));
    assert_eq!(selected_slot(&ide), Some(1));
    assert!(ide.is_selected("Breadcrumb src"));
    ide.snapshot("nav_popup_up_to_bar");

    // Right enters a directory; inside, Up and Down wrap; Right on a file does nothing.
    key_then(&mut ide, Key::ArrowDown, 0, "src/core");
    key_then(&mut ide, Key::ArrowRight, 1, "src/core/deep");
    assert_eq!(focus_level(&ide), Some(1));
    ide.key(Key::ArrowUp);
    assert_eq!(selected(ide.state(), 1).as_deref(), Some("src/core/fresh.ts"), "Up wraps in a nested level");
    ide.key(Key::ArrowDown);
    assert_eq!(selected(ide.state(), 1).as_deref(), Some("src/core/deep"), "Down wraps in a nested level");
    ide.key(Key::ArrowDown);
    ide.key(Key::ArrowRight);
    assert_eq!(levels(ide.state()), ["src", "src/core"]);
    assert_eq!(focus_level(&ide), Some(1));
    assert_eq!(selected(ide.state(), 1).as_deref(), Some("src/core/fresh.ts"), "Right on a file does nothing");
    ide.snapshot("nav_popup_nested");

    // Left in a nested level goes back one level.
    ide.key(Key::ArrowLeft);
    assert_eq!(levels(ide.state()), ["src"]);
    assert_eq!(focus_level(&ide), Some(0));
    assert_eq!(selected(ide.state(), 0).as_deref(), Some("src/core"));

    // Right on a file at the first level hops to the next segment's popup.
    ide.key(Key::ArrowDown);
    assert_eq!(selected(ide.state(), 0).as_deref(), Some("src/app.ts"));
    key_then(&mut ide, Key::ArrowRight, 0, "src/core/deep");
    assert_eq!(levels(ide.state())[0], "src/core");
    assert_eq!(selected_slot(&ide), Some(2));
    assert!(ide.is_selected("Breadcrumb core"));
    ide.snapshot("nav_popup_hop_right");

    // Right on a directory still enters it; Left backs out.
    key_then(&mut ide, Key::ArrowRight, 1, "src/core/deep/nested.ts");
    assert_eq!(levels(ide.state()), ["src/core", "src/core/deep"]);
    ide.key(Key::ArrowLeft);
    assert_eq!(levels(ide.state()), ["src/core"]);

    // Left at the first level hops to the previous segment, down to the root.
    key_then(&mut ide, Key::ArrowLeft, 0, "src/core");
    assert_eq!(levels(ide.state())[0], "src");
    assert_eq!(selected_slot(&ide), Some(1));
    key_then(&mut ide, Key::ArrowLeft, 0, "src");
    assert_eq!(levels(ide.state())[0], "");
    assert_eq!(selected_slot(&ide), Some(0));
    assert_eq!(names(ide.state(), 0), ["docs", "src", ".gitignore", "README.md"]);
    ide.snapshot("nav_popup_hop_left");
    ide.key(Key::ArrowLeft);
    assert_eq!(selected_slot(&ide), Some(0), "Left at the first segment stays");
    assert_eq!(levels(ide.state())[0], "");

    // Hops reach the file segment; Right there has no next segment.
    ide.key(Key::ArrowDown);
    key_then(&mut ide, Key::ArrowRight, 0, "src/core");
    ide.key(Key::ArrowDown);
    key_then(&mut ide, Key::ArrowRight, 0, "src/core/deep");
    ide.key(Key::ArrowDown);
    key_then(&mut ide, Key::ArrowRight, 0, "src/core/deep/nested.ts");
    assert_eq!(levels(ide.state()), ["src/core/deep"]);
    assert_eq!(selected_slot(&ide), Some(3));
    key_then(&mut ide, Key::ArrowRight, 0, "src/core/deep/nested.ts");
    assert_eq!(selected_slot(&ide), Some(4), "the file segment lists its siblings");
    ide.key(Key::ArrowRight);
    assert_eq!(selected_slot(&ide), Some(4), "no segment after the file");
    assert!(ide.state().ws.breadcrumbs.popup.is_some());

    // Escape closes everything and gives the editor the keyboard back.
    ide.key(Key::Escape);
    assert!(ide.state().ws.breadcrumbs.popup.is_none());
    assert!(!bar_focused(&ide) && selected_slot(&ide).is_none());
    assert_eq!(ide.cursor(), (0, 0), "no arrow reached the editor");
    assert_eq!(ide.active_text(), text, "no key reached the editor");
    assert_eq!(active_rel(&ide), "src/core/deep/nested.ts");
    assert_editor_has_keyboard(&mut ide);

    // Enter on a file opens it.
    alt_home(&mut ide);
    ide.key(Key::ArrowLeft);
    ide.key(Key::ArrowLeft);
    key_then(&mut ide, Key::Enter, 0, "src/core/deep");
    ide.key(Key::ArrowDown);
    ide.key(Key::Enter);
    ide.wait_for("fresh.ts open", |s| s.ws.tabs.active_tab().is_some_and(|t| t.title() == "fresh.ts"));
    ide.settle();
    assert!(ide.state().ws.breadcrumbs.popup.is_none() && selected_slot(&ide).is_none());
    assert_eq!(ide.active_text(), "export const fresh = 1;\n");
}

#[test]
fn keyboard_scrolls_the_selected_crumb_into_view() {
    let fx = Fixture::new(SUITE, "nav_scroll");
    let repo = crumbs_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file(DEEP);
    ide.resize(egui::vec2(640.0, 800.0));
    ide.settle();
    ide.park_mouse();
    let text = ide.active_text();
    let last = ide.state().ws.breadcrumbs.slots.len() - 1;
    assert_eq!(last, 7);

    alt_home(&mut ide);
    assert_eq!(selected_slot(&ide), Some(last));
    assert!(crumb_visible(&ide, "Breadcrumb target_file_name.ts"));
    // Left walks to the root; each selected crumb scrolls into view.
    for _ in 0..last {
        ide.key(Key::ArrowLeft);
        ide.settle();
    }
    assert_eq!(selected_slot(&ide), Some(0));
    assert!(ide.is_selected("Breadcrumb repo"));
    assert!(crumb_visible(&ide, "Breadcrumb repo"), "the root scrolled into view");
    ide.snapshot("nav_scrolled_root");

    // Down opens the root's popup under the crumb.
    key_then(&mut ide, Key::ArrowDown, 0, "src");
    let root_x = ide.rect("Breadcrumb repo").min.x;
    assert!((ide.state().ws.breadcrumbs.popup_rects[0].min.x - root_x).abs() < 0.5);
    // Right on a file row hops to the next crumb, `src`, which stays in view.
    ide.key(Key::ArrowDown);
    assert_eq!(selected(ide.state(), 0).as_deref(), Some(".gitignore"));
    key_then(&mut ide, Key::ArrowRight, 0, "src/core");
    assert_eq!(selected_slot(&ide), Some(1));
    assert!(crumb_visible(&ide, "Breadcrumb src"));

    // Alt+Home selects the file crumb again and scrolls it back into view.
    ide.key(Key::Escape);
    alt_home(&mut ide);
    assert!(crumb_visible(&ide, "Breadcrumb target_file_name.ts"));
    ide.key(Key::Escape);
    assert_eq!(ide.cursor(), (0, 0));
    assert_eq!(ide.active_text(), text);
    assert_editor_has_keyboard(&mut ide);
}

#[test]
fn keyboard_works_after_a_click_and_not_in_the_terminal() {
    let fx = Fixture::new(SUITE, "nav_click");
    let repo = crumbs_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/core/deep/nested.ts");
    let text = ide.active_text();

    // A popup opened by a click takes the same keys.
    ide.click("Breadcrumb src");
    ide.wait_until("src popup", |ide| selected(ide.state(), 0).as_deref() == Some("src/core"));
    ide.settle();
    ide.park_mouse();
    key_then(&mut ide, Key::ArrowLeft, 0, "src");
    assert_eq!(selected_slot(&ide), Some(0));
    ide.key(Key::ArrowUp);
    assert_eq!(selected(ide.state(), 0).as_deref(), Some("docs"));
    ide.key(Key::ArrowUp);
    assert!(ide.state().ws.breadcrumbs.popup.is_none() && bar_focused(&ide));
    assert!(ide.is_selected("Breadcrumb repo"));
    ide.key(Key::ArrowRight);
    assert!(ide.is_selected("Breadcrumb src"));
    ide.key(Key::Escape);
    assert!(!bar_focused(&ide));
    assert_eq!(ide.active_text(), text);
    assert_eq!(ide.cursor(), (0, 0));
    assert_editor_has_keyboard(&mut ide);

    // Alt+Home is skipped while a terminal has focus.
    ide.key_mods(Modifiers::ALT, Key::F12);
    ide.wait_until("terminal focus", |ide| ide.state().ws.terminals.has_focus(&ide.ctx()));
    alt_home(&mut ide);
    assert_eq!(selected_slot(&ide), None);
    assert!(!bar_focused(&ide));
    assert!(ide.state().ws.terminals.has_focus(&ide.ctx()));
}

// ---------------------------------------------------------------------------------------------
// Popup layout: every level rests on the status bar, nested levels touch their parent, heights
// are whole rows (at most 18), and a chain that leaves the window moves left.

const ROW_H: f32 = 20.0;
const DEEP_FILE: &str = "javascript/packages/infrastructure/di/src/index.js";

/// A project as deep as harwex-mono: `javascript/packages/infrastructure/di/src/index.js`.
/// The levels list 5, 6, 8, 3, 4 and 30 items.
fn mono_repo(fx: &Fixture) -> Repo {
    let repo = basic_repo(fx.path("repo"));
    for f in ["package.json", "tsconfig.json", "yarn.lock", ".yarnrc.yml", "scripts/build.sh"] {
        repo.write(&format!("javascript/{f}"), "x\n");
    }
    for d in ["apps", "games", "libs", "projects", "prototypes", "tools", "widgets"] {
        repo.write(&format!("javascript/packages/{d}/README.md"), "x\n");
    }
    for d in ["eslint-config", "logger"] {
        repo.write(&format!("javascript/packages/infrastructure/{d}/package.json"), "{}\n");
    }
    for f in ["package.json", "README.md", "tsconfig.json"] {
        repo.write(&format!("javascript/packages/infrastructure/di/{f}"), "x\n");
    }
    // 20 files before `index.js` and 9 after it: the current file needs a scroll.
    for i in 0..20 {
        repo.write(&format!("javascript/packages/infrastructure/di/src/alpha_{i:02}.js"), "x\n");
    }
    for i in 0..9 {
        repo.write(&format!("javascript/packages/infrastructure/di/src/zeta_{i}.js"), "x\n");
    }
    repo.write(DEEP_FILE, "export const di = 1;\n");
    repo.commit_all("mono layout");
    repo
}

fn popup_rects(ide: &Ide) -> Vec<egui::Rect> {
    ide.state().ws.breadcrumbs.popup_rects.clone()
}

fn baseline(ide: &Ide) -> f32 {
    ide.state().ws.breadcrumbs.baseline.expect("status bar drawn")
}

/// Rows of level `level` that are fully visible inside its popup.
fn visible_rows(ide: &Ide, level: usize) -> Vec<String> {
    let s = ide.state();
    let root = ide.root();
    let p = s.ws.breadcrumbs.popup.as_ref().expect("popup open");
    let rect = popup_rects(ide)[level];
    s.ws.breadcrumbs
        .items(&p.levels[level])
        .unwrap_or_default()
        .iter()
        .filter(|e| {
            let rel = e.path.strip_prefix(&root).unwrap_or(&e.path).display().to_string();
            ide.rects(&format!("Breadcrumb item {rel}")).iter().any(|r| rect.contains_rect(*r))
        })
        .map(|e| e.name.clone())
        .collect()
}

/// Every level rests on the status bar and is a whole number of rows tall.
fn assert_rests_on_status_bar(ide: &Ide) {
    let base = baseline(ide);
    let rects = popup_rects(ide);
    let s = ide.state();
    let p = s.ws.breadcrumbs.popup.as_ref().expect("popup open");
    let mut margins = Vec::new();
    for (i, r) in rects.iter().enumerate() {
        assert!((r.max.y - base).abs() < 0.5, "level {i} bottom {} != status bar top {base}", r.max.y);
        assert!(r.min.y >= 0.0, "level {i} leaves the window at the top");
        let rows = s.ws.breadcrumbs.items(&p.levels[i]).map_or(1, |v| v.len().clamp(1, 18));
        margins.push(r.height() - rows as f32 * ROW_H);
    }
    assert!(margins.windows(2).all(|m| (m[0] - m[1]).abs() < 0.5), "heights are whole rows plus the same padding: {margins:?}");
}

/// Opens the whole chain from the root segment with Right, one level at a time.
fn open_mono_chain(ide: &mut Ide) {
    ide.click("Breadcrumb repo");
    ide.wait_until("root popup", |ide| selected(ide.state(), 0).as_deref() == Some("javascript"));
    ide.settle();
    ide.park_mouse();
    let path = ["javascript/packages", "javascript/packages/infrastructure", "javascript/packages/infrastructure/di", "javascript/packages/infrastructure/di/src", DEEP_FILE];
    for (i, expected) in path.iter().enumerate() {
        key_then(ide, Key::ArrowRight, i + 1, expected);
    }
}

#[test]
fn nested_popups_rest_on_the_status_bar() {
    let fx = Fixture::new(SUITE, "layout_chain");
    let repo = mono_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file(DEEP_FILE);
    open_mono_chain(&mut ide);
    ide.settle();

    assert_eq!(levels(ide.state()), ["", "javascript", "javascript/packages", "javascript/packages/infrastructure", "javascript/packages/infrastructure/di", "javascript/packages/infrastructure/di/src"]);
    let counts: Vec<usize> = (0..6).map(|l| names(ide.state(), l).len()).collect();
    assert_eq!(counts, [5, 6, 8, 3, 4, 30]);
    assert_rests_on_status_bar(&ide);
    let rects = popup_rects(&ide);
    for (i, w) in rects.windows(2).enumerate() {
        assert!((w[1].min.x - w[0].max.x).abs() < 0.5, "level {} touches its parent: {} vs {}", i + 1, w[1].min.x, w[0].max.x);
    }
    // No row is cut: each short level shows all its rows.
    for (l, &count) in counts.iter().enumerate().take(5) {
        assert_eq!(visible_rows(&ide, l).len(), count, "level {l} shows every row");
    }
    // 30 items: exactly 18 rows show, and the current file is among them.
    let rows = visible_rows(&ide, 5);
    assert_eq!(rows.len(), 18, "visible rows: {rows:?}");
    assert!(rows.iter().any(|r| r == "index.js"), "the current file is scrolled into view: {rows:?}");
    ide.snapshot("layout_chain");
}

#[test]
fn long_directory_shows_18_rows_and_follows_the_selection() {
    let fx = Fixture::new(SUITE, "layout_long");
    let repo = mono_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file(DEEP_FILE);
    alt_home(&mut ide);
    ide.key(Key::ArrowDown);
    ide.wait_until("siblings", |ide| selected(ide.state(), 0).as_deref() == Some(DEEP_FILE));
    ide.settle();
    ide.park_mouse();
    assert_eq!(names(ide.state(), 0).len(), 30);
    assert_rests_on_status_bar(&ide);
    let rows = visible_rows(&ide, 0);
    assert_eq!(rows.len(), 18);
    assert!(rows.iter().any(|r| r == "index.js"));
    ide.snapshot("layout_long_list");

    // Down to the last row and on to the first (wrap): the selection stays in view.
    for _ in 0..9 {
        ide.key(Key::ArrowDown);
    }
    assert_eq!(selected(ide.state(), 0).as_deref(), Some("javascript/packages/infrastructure/di/src/zeta_8.js"));
    ide.settle();
    assert_eq!(visible_rows(&ide, 0).last().map(String::as_str), Some("zeta_8.js"));
    ide.key(Key::ArrowDown);
    ide.settle();
    let rows = visible_rows(&ide, 0);
    assert_eq!(rows.len(), 18);
    assert_eq!(rows.first().map(String::as_str), Some("alpha_00.js"), "wrap scrolls back to the top");
    ide.snapshot("layout_long_list_top");
}

#[test]
fn chain_moves_left_at_the_right_edge() {
    let fx = Fixture::new(SUITE, "layout_edge");
    let repo = mono_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file(DEEP_FILE);
    // A narrow window scrolls the crumbs to their end, and a smaller window would move the
    // crumbs left with it. Scrolled back to the start by hand, the row stays put.
    ide.resize(egui::vec2(640.0, 800.0));
    ide.settle();
    assert!(ide.state().ws.breadcrumbs.scroll_x > 0.0, "the path scrolls at 640 pt");
    let at = bar_rect(&ide).center();
    wheel(&mut ide, at, egui::vec2(0.0, 2000.0));
    assert_eq!(ide.state().ws.breadcrumbs.scroll_x, 0.0);
    // A chain from `infrastructure`: infrastructure, di, src.
    ide.click("Breadcrumb infrastructure");
    ide.wait_until("infrastructure popup", |ide| selected(ide.state(), 0).as_deref() == Some("javascript/packages/infrastructure/di"));
    ide.settle();
    ide.park_mouse();
    key_then(&mut ide, Key::ArrowRight, 1, "javascript/packages/infrastructure/di/src");
    key_then(&mut ide, Key::ArrowRight, 2, DEEP_FILE);
    let wide = popup_rects(&ide);
    assert_eq!(wide.len(), 3);
    let chain = wide[2].max.x - wide[0].min.x;
    let anchor = ide.state().ws.breadcrumbs.popup.as_ref().expect("popup").anchor.x;

    // A window where the chain fits, but not from its segment.
    let width = (anchor + chain - 30.0).round();
    assert!(width >= chain, "the test window fits the chain");
    ide.resize(egui::vec2(width, 800.0));
    ide.settle();
    assert_eq!(ide.state().ws.breadcrumbs.scroll_x, 0.0, "a manual scroll survives a resize");
    let moved = ide.state().ws.breadcrumbs.popup.as_ref().expect("a resize keeps the popup").anchor.x;
    assert!((moved - anchor).abs() < 0.5, "the segment stays put");
    assert!(ide.state().ws.breadcrumbs.popup.is_some(), "a resize keeps the popup");
    assert_rests_on_status_bar(&ide);
    let rects = popup_rects(&ide);
    assert_eq!(rects.len(), 3);
    assert!((rects[2].max.x - width).abs() < 0.5, "the last level ends at the right edge: {} vs {width}", rects[2].max.x);
    for w in rects.windows(2) {
        assert!((w[1].min.x - w[0].max.x).abs() < 0.5, "the chain stays connected");
    }
    assert!(rects[0].min.x < anchor - 20.0, "the chain moved left of its segment");
    ide.snapshot("layout_right_edge");
}

// ---------------------------------------------------------------------------------------------
// Crumbs as files: Select in Project, the file menu and the file keys.

fn calls(ide: &Ide) -> Vec<String> {
    ide.state().platform.calls()
}

/// The labels in `after` that `before` does not have, in order, counted per occurrence.
fn new_labels(before: &[String], after: &[String]) -> Vec<String> {
    let mut left = before.to_vec();
    after
        .iter()
        .filter(|l| match left.iter().position(|b| b == *l) {
            Some(i) => {
                left.remove(i);
                false
            }
            None => true,
        })
        .cloned()
        .collect()
}

#[test]
fn double_click_on_a_folder_selects_and_expands_it_in_project() {
    let fx = Fixture::new(SUITE, "select_in_project");
    let repo = crumbs_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/core/deep/nested.ts");
    ide.state_mut().ws.layout.left = None;
    ide.settle();
    assert!(!ide.has("src/core/deep"), "the Project window is hidden");
    let root = ide.root();
    assert!(!ide.state().ws.tree.is_expanded(&root.join("src/core/deep")), "the folder starts collapsed");

    ide.double_click("Breadcrumb deep");
    ide.wait_until("deep expanded", |ide| ide.has("src/core/deep/nested.ts"));
    ide.settle();
    // The folder is expanded, so its files show under it.
    assert!(ide.state().ws.tree.is_expanded(&root.join("src/core/deep")));
    assert_eq!(ide.state().ws.layout.left, Some(harwex_ide::layout::ToolWindow::Project));
    assert_eq!(ide.state().ws.tree.selected.as_deref(), Some(root.join("src/core/deep").as_path()));
    assert!(ide.has("src/core/deep"), "the row is drawn: {:?}", ide.labels());
    assert!(harwex_ide::tree::has_focus(&ide.ctx()), "the tree has the keyboard");
    assert!(ide.state().ws.breadcrumbs.popup.is_none(), "the first click's popup is closed again");
    ide.snapshot("select_in_project");
}

#[test]
fn file_crumb_menu_lists_the_tree_file_menu() {
    let fx = Fixture::new(SUITE, "file_menu");
    let repo = crumbs_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/util.ts");
    let root = ide.root();
    let file = root.join("src/util.ts");
    ide.state_mut().ws.tree.reveal(&root, &file);
    ide.settle();

    // The Project tree's menu of the same file.
    let before = ide.labels();
    ide.right_click("src/util.ts");
    ide.settle();
    let tree_items = new_labels(&before, &ide.labels());
    assert!(tree_items.iter().any(|l| l == "Copy Absolute Path"), "tree menu: {tree_items:?}");
    ide.key(Key::Escape);
    ide.settle();

    // The file crumb's menu: Select in Project, then the same items in the same order.
    let before = ide.labels();
    ide.click("Breadcrumb util.ts");
    ide.settle();
    let crumb_items = new_labels(&before, &ide.labels());
    assert_eq!(crumb_items.first().map(String::as_str), Some("Select in Project"));
    assert_eq!(crumb_items[1..], tree_items[..]);
    let menu = ide.state().ws.breadcrumbs.menu_rect.expect("menu drawn");
    assert!((menu.max.y - baseline(&ide)).abs() < 1.0, "the menu rests on the status bar");
    ide.snapshot("file_menu");

    // A second click on the crumb closes the menu; a right-click opens it again.
    ide.click("Breadcrumb util.ts");
    assert!(ide.state().ws.breadcrumbs.menu.is_none());
    ide.right_click("Breadcrumb util.ts");
    ide.settle();
    assert!(ide.has("Select in Project"));

    // An item acts on the crumb's file.
    ide.click("Copy Absolute Path");
    ide.settle();
    assert_eq!(calls(&ide).last().cloned(), Some(format!("copy {}", file.display())));
    assert!(ide.state().ws.breadcrumbs.menu.is_none());

    // A right-click on a folder crumb opens the folder's menu; a click outside closes it.
    ide.right_click("Breadcrumb src");
    ide.settle();
    assert_eq!(ide.state().ws.breadcrumbs.menu.as_ref().map(|m| m.target.path.clone()), Some(root.join("src")));
    assert!(ide.has("Mark Directory as Excluded"), "folder items");
    let editor = ide.rect("Editor util.ts").center();
    ide.click_at(editor);
    assert!(ide.state().ws.breadcrumbs.menu.is_none());
}

#[test]
fn file_keys_act_on_the_focused_crumb() {
    let fx = Fixture::new(SUITE, "file_keys");
    let repo = crumbs_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/core/deep/nested.ts");
    let root = ide.root();
    let text = ide.active_text();

    // Alt+Home selects the file crumb: ⇧⌘C copies its absolute path, ⌥C its project path.
    alt_home(&mut ide);
    assert!(bar_focused(&ide));
    ide.cmd_shift(Key::C);
    assert_eq!(calls(&ide).last().cloned(), Some(format!("copy {}", root.join("src/core/deep/nested.ts").display())));
    ide.key(Key::ArrowLeft);
    ide.key_mods(Modifiers::ALT, Key::C);
    assert_eq!(calls(&ide).last().map(String::as_str), Some("copy src/core/deep"), "the folder crumb");
    assert!(bar_focused(&ide));
    assert_eq!(ide.active_text(), text, "the editor got no key");

    // Esc gives the keyboard back to the editor.
    ide.key(Key::Escape);
    assert!(!bar_focused(&ide));
    assert_editor_has_keyboard(&mut ide);

    // After a click on the file crumb the bar keeps the keyboard once the menu closes.
    ide.click("Breadcrumb nested.ts");
    ide.key(Key::Escape);
    assert!(ide.state().ws.breadcrumbs.menu.is_none() && bar_focused(&ide));
    ide.key_mods(Modifiers::ALT, Key::C);
    assert_eq!(calls(&ide).last().map(String::as_str), Some("copy src/core/deep/nested.ts"));

    // ⇧F6 renames the crumb's file through the tree's dialog.
    ide.key_mods(Modifiers::SHIFT, Key::F6);
    ide.settle();
    assert!(ide.state().ws.tree_ops.dialog.is_some(), "rename dialog");
    ide.key(Key::Escape);
    ide.settle();

    // Alt+F1 on a folder crumb selects the folder in the Project tree.
    alt_home(&mut ide);
    ide.key(Key::ArrowLeft);
    ide.key(Key::ArrowLeft);
    ide.key_mods(Modifiers::ALT, Key::F1);
    ide.settle();
    assert_eq!(ide.state().ws.tree.selected.as_deref(), Some(root.join("src/core").as_path()));
    assert!(harwex_ide::tree::has_focus(&ide.ctx()));
}

// ---------------------------------------------------------------------------------------------
// The thin scrollbar and the speed search in popups.

/// Every rect and text shape painted inside `area` this frame, nested shapes included.
fn shapes_in(ide: &Ide, area: egui::Rect) -> (Vec<egui::Rect>, Vec<egui::Rect>) {
    fn walk(shape: &egui::Shape, area: egui::Rect, rects: &mut Vec<egui::Rect>, texts: &mut Vec<egui::Rect>) {
        match shape {
            egui::Shape::Vec(v) => v.iter().for_each(|s| walk(s, area, rects, texts)),
            egui::Shape::Rect(r) if area.contains_rect(r.rect) && r.fill.a() > 0 => rects.push(r.rect),
            egui::Shape::Text(t) if area.contains_rect(t.visual_bounding_rect()) && !t.galley.is_empty() => texts.push(t.visual_bounding_rect()),
            _ => {}
        }
    }
    let (mut rects, mut texts) = (Vec::new(), Vec::new());
    for c in &ide.harness.output().shapes {
        walk(&c.shape, area, &mut rects, &mut texts);
    }
    (rects, texts)
}

#[test]
fn hovered_scrollbar_stays_thin_under_the_text() {
    let fx = Fixture::new(SUITE, "scrollbar");
    let repo = crumbs_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file(DEEP);
    ide.resize(egui::vec2(640.0, 800.0));
    ide.settle();
    assert!(ide.state().ws.breadcrumbs.scroll_x > 0.0, "the path scrolls, so the bar has a scrollbar");
    let bar = bar_rect(&ide);
    // The pointer right on the scrollbar: egui's default bar grows to 10 pt there.
    ide.move_to(egui::pos2(bar.center().x, bar.max.y - 1.0));
    ide.steps(20);
    let (rects, texts) = shapes_in(&ide, bar.expand(1.0));
    // The scrollbar lies on the bar's bottom edge; the crumb icons are centered.
    let thumbs: Vec<_> = rects.iter().filter(|r| r.max.y > bar.max.y - 1.0 && r.height() < bar.height() / 2.0).collect();
    assert!(!thumbs.is_empty(), "the hovered scrollbar is drawn: {rects:?}");
    for r in &thumbs {
        assert!(r.height() <= harwex_ide::breadcrumbs::SCROLLBAR_H + 0.01, "the hovered scrollbar stays thin: {r:?}");
        assert!((r.max.y - bar.max.y).abs() < 0.5, "it sits on the bar's bottom edge: {r:?} in {bar:?}");
    }
    assert!(!texts.is_empty());
    let bar_top = thumbs.iter().map(|r| r.min.y).fold(f32::MAX, f32::min);
    for t in &texts {
        assert!(t.max.y <= bar_top, "crumb text {t:?} reaches under the scrollbar at {bar_top}");
    }
    ide.snapshot_here("scrollbar_hovered");
}

/// The popup rows drawn in every level, left level first, relative to the root.
fn drawn_rows(ide: &Ide) -> Vec<String> {
    ide.labels().into_iter().filter_map(|l| l.strip_prefix("Breadcrumb item ").map(str::to_string)).collect()
}

#[test]
fn typing_filters_a_popup_like_speed_search() {
    let fx = Fixture::new(SUITE, "filter");
    let repo = crumbs_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/core/deep/nested.ts");
    let text = ide.active_text();
    ide.click("Breadcrumb src");
    ide.wait_until("src popup", |ide| selected(ide.state(), 0).as_deref() == Some("src/core"));
    ide.settle();
    ide.park_mouse();
    assert_eq!(drawn_rows(&ide), ["src/core", "src/app.ts", "src/util.ts"]);

    // Typing hides the rows that do not match and selects the first match.
    ide.type_text("ts");
    ide.settle();
    assert!(ide.has("Speed search ts"), "{:?}", ide.labels());
    assert_eq!(drawn_rows(&ide), ["src/app.ts", "src/util.ts"]);
    assert_eq!(selected(ide.state(), 0).as_deref(), Some("src/app.ts"));
    ide.snapshot("filter_typed");

    // Up and Down move within the matches and wrap.
    ide.key(Key::ArrowDown);
    assert_eq!(selected(ide.state(), 0).as_deref(), Some("src/util.ts"));
    ide.key(Key::ArrowDown);
    assert_eq!(selected(ide.state(), 0).as_deref(), Some("src/app.ts"), "Down wraps within the matches");
    ide.key(Key::ArrowUp);
    assert_eq!(selected(ide.state(), 0).as_deref(), Some("src/util.ts"), "Up wraps, it does not leave for the bar");
    assert!(ide.state().ws.breadcrumbs.popup.is_some());

    // A filter that matches nothing shows so; Backspace edits the filter.
    ide.type_text("x");
    ide.settle();
    assert!(ide.has("Speed search tsx") && drawn_rows(&ide).is_empty());
    ide.snapshot("filter_no_matches");
    ide.key(Key::Backspace);
    ide.settle();
    assert!(ide.has("Speed search ts"));
    assert_eq!(drawn_rows(&ide), ["src/app.ts", "src/util.ts"]);
    assert_eq!(selected(ide.state(), 0).as_deref(), Some("src/util.ts"), "a selection that still matches stays");

    // The first Escape clears the filter, the second closes the popup.
    ide.key(Key::Escape);
    ide.settle();
    assert!(ide.state().ws.breadcrumbs.popup.is_some(), "the first Escape keeps the popup");
    assert!(!ide.labels().iter().any(|l| l.starts_with("Speed search")));
    assert_eq!(drawn_rows(&ide), ["src/core", "src/app.ts", "src/util.ts"]);
    ide.key(Key::Escape);
    assert!(ide.state().ws.breadcrumbs.popup.is_none());
    assert_eq!(ide.active_text(), text, "no typed key reached the editor");

    // A nested level has its own filter; Enter opens the match.
    ide.click("Breadcrumb src");
    ide.wait_until("src popup", |ide| selected(ide.state(), 0).as_deref() == Some("src/core"));
    ide.settle();
    ide.park_mouse();
    key_then(&mut ide, Key::ArrowRight, 1, "src/core/deep");
    ide.type_text("fr");
    ide.settle();
    assert_eq!(levels(ide.state()), ["src", "src/core"]);
    assert_eq!(selected(ide.state(), 1).as_deref(), Some("src/core/fresh.ts"));
    assert_eq!(drawn_rows(&ide), ["src/core", "src/app.ts", "src/util.ts", "src/core/fresh.ts"], "the first level keeps its rows");
    ide.snapshot("filter_nested");
    ide.key(Key::Enter);
    ide.wait_for("fresh.ts open", |s| s.ws.tabs.active_tab().is_some_and(|t| t.title() == "fresh.ts"));
    ide.settle();
    assert!(ide.state().ws.breadcrumbs.popup.is_none());
    assert_eq!(ide.active_text(), "export const fresh = 1;\n");
}
