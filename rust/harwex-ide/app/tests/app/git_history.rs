//! Git history: the log (graph with a merge, HEAD and merge styles, long-edge arrows, every
//! filter, paging, multi-select), the changes pane (folder chains, colours, context menu),
//! the branches popup, push to a bare remote, Update Project, stash / unstash, the conflict
//! flow (dialog, merge tab, Continue, Abort) and the Cmd+T / Cmd+Shift+K shortcuts.

use crate::common::*;
use egui::Key;
use harwex_ide::git::log::LogView;
use harwex_ide::layout::ToolWindow;
use ide_git::RepoState;

const SUITE: &str = "git_history";

fn view(ide: &Ide) -> &LogView {
    &ide.state().ws.git_ui.window.log_tab(0).expect("the main Log tab").view
}

fn subjects(ide: &Ide) -> Vec<String> {
    view(ide).commits().iter().map(|c| c.summary.clone()).collect()
}

fn loaded(s: &harwex_ide::state::AppState) -> bool {
    s.ws.git_ui.window.log_tab(0).is_some_and(|t| !t.view.is_loading() && t.view.error().is_none()) && s.is_idle()
}

fn open_log(ide: &mut Ide) {
    ide.click("Git tool window");
    ide.wait_for("log loaded", |s| s.ws.git_ui.window.log_tab(0).is_some_and(|t| !t.view.is_loading() && !t.view.commits().is_empty()));
    ide.settle();
    assert_eq!(ide.state().ws.layout.bottom, Some(ToolWindow::Git));
}

/// Drags the top edge of the bottom tool window up, so the Git window shows more rows.
fn tall_git_window(ide: &mut Ide) {
    let top = ide.rect("Git tab Log: HEAD").min.y - 12.0;
    ide.drag(egui::pos2(700.0, top), egui::pos2(700.0, 260.0));
    ide.settle();
}

/// The "Text or hash" box: the text input just left of the regex toggle.
fn text_box(ide: &Ide) -> egui::Rect {
    let regex = ide.rect("Regex");
    ide.role_rects(egui::accesskit::Role::TextInput).into_iter().filter(|r| r.max.x <= regex.min.x && (r.center().y - regex.center().y).abs() < 10.0).max_by(|a, b| a.min.x.total_cmp(&b.min.x)).expect("text box")
}

/// Waits until the main Log tab shows exactly `n` commits.
fn wait_commits(ide: &mut Ide, what: &str, n: usize) {
    ide.wait_until(what, |ide| loaded(ide.state()) && view(ide).commits().len() == n);
    ide.settle();
}

/// Waits until the changes pane holds the changes of the current selection.
fn wait_changes(ide: &mut Ide) {
    ide.wait_until("changes loaded", |ide| view(ide).changes().is_some() && ide.state().is_idle());
    ide.settle();
}

/// Clicks the last widget labelled `label` (a dialog button that shares its name with another
/// widget).
fn click_last(ide: &mut Ide, label: &str) {
    // Toasts never expire in tests and can cover dialog buttons.
    ide.dismiss_toasts();
    let n = ide.rects(label).len();
    assert!(n > 0, "no widget labelled {label:?}; {:?}", ide.labels());
    ide.click_nth(label, n - 1);
}

fn open_branches(ide: &mut Ide) {
    ide.dismiss_toasts();
    // The title bar's branch is display-only; IDEA's "Branches..." shortcut opens the popup.
    ide.key_mods(CTRL_SHIFT, Key::Backtick);
    ide.wait_until("branches popup", |ide| ide.state().ws.git_ui.branches.is_open() && ide.has("Fetch"));
    ide.settle();
}

/// Hovers a branch row; its submenu opens to the right.
fn branch_menu(ide: &mut Ide, row: &str) {
    let name = row.rsplit(' ').next().expect("branch name").to_string();
    ide.hover(row);
    let item = format!("New Branch from '{name}'...");
    ide.wait_until("branch submenu", move |ide| ide.has(&item));
    ide.settle();
}

#[test]
fn log_graph_details_and_commit_diff() {
    let fx = Fixture::new(SUITE, "log");
    let repo = history_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_log(&mut ide);
    // Topological order, newest first: the main-line commit is newer than the side work.
    assert_eq!(subjects(&ide), ["After merge", "Merge branch 'side'", "Main line change", "More side work", "Side work", "Add ONE", "Initial commit"]);
    let v = view(&ide);
    assert_eq!(v.filter_label(), "HEAD");
    let merge = v.commits().iter().position(|c| c.parents.len() == 2).expect("merge commit");
    assert!(v.graph()[merge].down.len() >= 2, "the merge row opens a second lane");
    assert!(v.graph().iter().any(|g| g.lane == 1), "side commits sit in their own lane");
    // HEAD's node is hollow, the merge row is grey, and every commit is the user's own.
    let log = &ide.state().ws.git_ui.log;
    assert!(v.row_style(log, 0).hollow && !v.row_style(log, 1).hollow);
    assert!(v.row_style(log, merge).dimmed && !v.row_style(log, 0).dimmed);
    assert!((0..v.commits().len()).all(|i| v.row_style(log, i).bold_author));
    ide.snapshot("log_graph");

    // Selecting a commit loads its files; a double click on a file opens the commit diff.
    ide.click("Commit More side work");
    wait_changes(&mut ide);
    assert!(view(&ide).selected().is_some_and(|o| view(&ide).commits().iter().any(|c| c.oid == o && c.summary == "More side work")));
    assert_eq!(view(&ide).changes().map(<[_]>::len), Some(1));
    ide.double_click("Changed file src/side.ts");
    ide.wait_until("commit diff tab", |ide| ide.active_title().is_some_and(|t| t.starts_with("side.ts @ ")));
    ide.settle();
    ide.assert_text("1 difference");
    ide.snapshot("commit_diff");

    // Up/Down move the selection while the table has focus.
    ide.click("Commit Merge branch 'side'");
    ide.key(Key::ArrowDown);
    assert_eq!(view(&ide).selection(), [view(&ide).commits()[2].oid]);
    // Shift+Down extends it.
    ide.key_mods(SHIFT, Key::ArrowDown);
    assert_eq!(view(&ide).selection().len(), 2);
}

#[test]
fn log_text_filters() {
    let fx = Fixture::new(SUITE, "filters");
    let repo = history_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_log(&mut ide);

    // The text filter reloads after typing rests (300 ms).
    let text = text_box(&ide);
    ide.click_at(text.center());
    ide.type_text("side");
    wait_commits(&mut ide, "text filter", 3);
    assert_eq!(subjects(&ide), ["Merge branch 'side'", "More side work", "Side work"]);
    ide.snapshot("filter_text");

    // Cc: "side" no longer matches "Side work".
    ide.click("Match Case");
    wait_commits(&mut ide, "case-sensitive filter", 2);
    assert_eq!(subjects(&ide), ["Merge branch 'side'", "More side work"]);
    assert!(ide.is_selected("Match Case"));
    ide.click("Match Case");
    wait_commits(&mut ide, "case off", 3);

    // .*: the text is a regular expression.
    ide.click_at(text.center());
    for _ in 0..4 {
        ide.key(Key::Backspace);
    }
    ide.type_text("^(Add|Main)");
    ide.click("Regex");
    wait_commits(&mut ide, "regex filter", 2);
    assert_eq!(subjects(&ide), ["Main line change", "Add ONE"]);
    assert!(view(&ide).filter().regex);
}

#[test]
fn log_branch_filter_and_no_merges() {
    let fx = Fixture::new(SUITE, "branch_filter");
    let repo = history_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_log(&mut ide);

    // The Branch popup: HEAD off, side on.
    ide.click("Branch filter");
    ide.settle();
    ide.click("HEAD");
    ide.click("side");
    wait_commits(&mut ide, "branch filter", 4);
    assert_eq!(subjects(&ide), ["More side work", "Side work", "Add ONE", "Initial commit"]);
    assert_eq!(view(&ide).filter_label(), "side");
    ide.key(Key::Escape);
    ide.snapshot("filter_branch");

    // The cross resets the filter: all branches.
    ide.click("Reset branch filter");
    wait_commits(&mut ide, "all branches", 7);
    assert!(view(&ide).filter().branches.is_empty());
    assert_eq!(view(&ide).filter_label(), "all");
    assert!(!ide.has("Reset branch filter"));

    // No Merges hides the merge commit.
    ide.click("No Merges");
    wait_commits(&mut ide, "no merges", 6);
    assert!(view(&ide).commits().iter().all(|c| c.parents.len() < 2));
}

/// Hovers the splitter left of the changes pane and checks the resize cursor on both sides of
/// the edge: the table's scroll bar must not cover the grab area.
fn splitter_x(ide: &mut Ide, edge: f32, y: f32) -> f32 {
    for x in [edge - 4.0, edge + 4.0, edge] {
        ide.move_to(egui::pos2(x, y));
        ide.steps(2);
        assert_eq!(ide.cursor_icon(), egui::CursorIcon::ResizeHorizontal, "resize cursor at x {x}, edge {edge}");
    }
    edge
}

/// The filter bar spans only the table column, with No Merges and Refresh right after Paths and
/// no commit count. The changes pane starts at the filter bar's top and holds only the tree.
#[test]
fn log_filter_bar_spans_the_table_and_changes_pane_is_only_the_tree() {
    let fx = Fixture::new(SUITE, "filter_bar");
    let repo = history_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_log(&mut ide);
    ide.click("Commit More side work");
    wait_changes(&mut ide);

    let check = |ide: &Ide| {
        let bar = ide.rect("Log filter bar");
        let pane = ide.rect("Log changes pane");
        let table_right = ide.rect("Commit More side work").max.x;
        assert!((bar.max.x - table_right).abs() <= 1.0, "the bar ends at the table's right edge: {bar:?}, table right {table_right}");
        assert!(bar.max.x <= pane.min.x, "the bar stays left of the changes pane: {bar:?} {pane:?}");
        assert!((pane.min.y - bar.min.y).abs() <= 1.0, "the changes pane starts at the bar's top: {pane:?} {bar:?}");
        let paths = ide.rect("Paths filter");
        let merges = ide.rect("No Merges");
        let refresh = ide.rect("Refresh log");
        assert!(merges.min.x > paths.max.x && merges.min.x - paths.max.x < 20.0, "No Merges right after Paths: {paths:?} {merges:?}");
        assert!(refresh.min.x > merges.max.x && refresh.max.x <= bar.max.x, "Refresh after No Merges, inside the bar: {refresh:?} {bar:?}");
        assert!((merges.center().y - bar.center().y).abs() < 4.0, "No Merges sits in the bar row");
        // The tree fills the pane down to its bottom; no commit info below it.
        let tree = ide.rect("Changes tree");
        assert!((tree.max.y - pane.max.y).abs() <= 1.0, "the tree reaches the pane's bottom: {tree:?} {pane:?}");
    };
    check(&ide);
    ide.assert_no_text(" commits");
    assert!(!ide.has("Copy"), "no hash Copy button in the changes pane");
    let oid = view(&ide).selected().expect("selected commit").to_string();
    ide.assert_no_text(&oid);
    ide.snapshot("filter_bar_and_changes_pane");

    // The bar follows the splitter.
    let before = ide.rect("Log filter bar").max.x;
    let pane = ide.rect("Log changes pane");
    let y = pane.center().y;
    let x = splitter_x(&mut ide, pane.min.x, y);
    ide.drag(egui::pos2(x, y), egui::pos2(x - 100.0, y));
    ide.settle();
    let after = ide.rect("Log filter bar").max.x;
    assert!(after < before - 80.0, "the bar shrinks with the table: {before} -> {after}");
    check(&ide);

    // A narrow table clips the filters that do not fit; nothing reaches the changes pane.
    let pane = ide.rect("Log changes pane");
    let x = splitter_x(&mut ide, pane.min.x, y);
    ide.drag(egui::pos2(x, y), egui::pos2(x - 400.0, y));
    ide.settle();
    let (bar, pane) = (ide.rect("Log filter bar"), ide.rect("Log changes pane"));
    assert!(bar.width() < 500.0 && bar.max.x <= pane.min.x, "narrow bar: {bar:?} {pane:?}");
    ide.snapshot("filter_bar_narrow");
}

/// A repository with a second author: "Other Dev" wrote one commit.
fn two_authors_repo(fx: &Fixture) -> Repo {
    let repo = history_repo(fx.path("repo"));
    repo.write("src/other.ts", "export const other = 1;\n");
    repo.git(&["add", "-A"]);
    repo.git(&["commit", "-q", "--author", "Other Dev <other@example.com>", "-m", "Work by someone else"]);
    repo
}

#[test]
fn log_user_and_paths_filters() {
    let fx = Fixture::new(SUITE, "user_paths");
    let repo = two_authors_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_log(&mut ide);
    assert_eq!(subjects(&ide).len(), 8);
    // Only the user's own commits have a bold author.
    let v = view(&ide);
    let log = &ide.state().ws.git_ui.log;
    assert_eq!(v.commits()[0].author_name, "Other Dev");
    assert!(!v.row_style(log, 0).bold_author && v.row_style(log, 1).bold_author);
    ide.snapshot("log_authors");

    // User: me.
    ide.click("User filter");
    ide.settle();
    assert!(ide.has("Other Dev"), "authors seen in the log are offered");
    ide.click("me");
    wait_commits(&mut ide, "user me", 7);
    assert!(!subjects(&ide).contains(&"Work by someone else".to_string()));
    ide.key(Key::Escape);
    ide.click("Reset user filter");
    wait_commits(&mut ide, "user reset", 8);

    // Paths: commits that touch src/side.ts.
    ide.click("Paths filter");
    ide.settle();
    ide.type_text("side.ts");
    ide.settle();
    ide.click("src/side.ts");
    ide.wait_until("paths filter", |ide| loaded(ide.state()) && view(ide).filter().paths.len() == 1);
    ide.settle();
    let s = subjects(&ide);
    assert!(s.contains(&"Side work".to_string()) && s.contains(&"More side work".to_string()), "{s:?}");
    assert!(!s.contains(&"Add ONE".to_string()), "{s:?}");
    ide.key(Key::Escape);
    ide.snapshot("filter_paths");
}

/// A side commit 40 commits below the merge: the line between them is cut into two stubs.
#[test]
fn log_long_edge_arrows() {
    let fx = Fixture::new(SUITE, "long_edge");
    let repo = basic_repo(fx.path("repo"));
    repo.git(&["checkout", "-q", "-b", "old"]);
    repo.write("old.txt", "old\n");
    repo.commit_all("Old side work");
    repo.git(&["checkout", "-q", "main"]);
    for i in 0..40 {
        repo.write("counter.txt", &format!("{i}\n"));
        repo.commit_all(&format!("Main {i}"));
    }
    repo.git(&["merge", "-q", "--no-ff", "old", "-m", "Merge old"]);
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_log(&mut ide);
    let g = view(&ide).graph();
    assert!(g[0].arrows.iter().any(|a| a.dir == ide_git::ArrowDir::Down) || g[1].arrows.iter().any(|a| a.dir == ide_git::ArrowDir::Down), "a down arrow below the merge");
    assert!(g.iter().any(|r| r.arrows.iter().any(|a| a.dir == ide_git::ArrowDir::Up)), "an up arrow above the old commit");
    ide.snapshot("log_long_edge");
}

/// A commit that modifies, adds, deletes and renames files under one folder chain.
fn studio_repo(fx: &Fixture) -> Repo {
    let repo = basic_repo(fx.path("repo"));
    let dir = "javascript/packages/studio-web-ui";
    for name in ["board", "calibration", "gl", "old-name"] {
        repo.write(&format!("{dir}/src/scene/{name}.ts"), &format!("export const {} = 1;\n// {name} body that stays the same\n", name.replace('-', "_")));
    }
    repo.write(&format!("{dir}/index.html"), "<html></html>\n");
    repo.commit_all("Studio scene");
    repo.write(&format!("{dir}/src/scene/board.ts"), "export const board = 2;\n");
    repo.write(&format!("{dir}/src/scene/shaders.ts"), "export const shaders = 1;\n");
    std::fs::remove_file(repo.dir.join(format!("{dir}/src/scene/calibration.ts"))).expect("delete");
    repo.git(&["mv", &format!("{dir}/src/scene/old-name.ts"), &format!("{dir}/src/scene/renamed.ts")]);
    repo.write(&format!("{dir}/index.html"), "<html><body></body></html>\n");
    repo.commit_all("Studio rework");
    repo
}

#[test]
fn changes_tree_chains_colors_and_multi_select() {
    let fx = Fixture::new(SUITE, "changes_tree");
    let repo = studio_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_log(&mut ide);
    tall_git_window(&mut ide);
    wait_changes(&mut ide);
    let rows: Vec<(usize, String, usize)> = view(&ide).changes_pane().rows().into_iter().map(|r| (r.depth, r.name, r.count)).collect();
    assert_eq!(
        rows,
        [
            (0, "javascript/packages/studio-web-ui".into(), 5),
            (1, "src/scene".into(), 4),
            (2, "board.ts".into(), 1),
            (2, "calibration.ts".into(), 1),
            (2, "renamed.ts".into(), 1),
            (2, "shaders.ts".into(), 1),
            (1, "index.html".into(), 1),
        ]
    );
    let kinds: Vec<Option<ide_git::ChangeKind>> = view(&ide).changes_pane().rows().iter().map(|r| r.kind).collect();
    use ide_git::ChangeKind::*;
    assert_eq!(kinds, [None, None, Some(Modified), Some(Deleted), Some(Renamed), Some(Added), Some(Modified)]);
    let renamed = view(&ide).changes_pane().rows().into_iter().find(|r| r.name == "renamed.ts").expect("renamed row");
    assert!(renamed.old_path.is_some_and(|p| p.ends_with("old-name.ts")));
    assert!(ide.has("Changes root javascript/packages/studio-web-ui") && ide.has("Changes folder src/scene"));
    ide.snapshot("changes_tree");

    // Collapse All keeps the root; Expand All brings the rows back.
    ide.click("Collapse All");
    assert_eq!(view(&ide).changes_pane().rows().len(), 3);
    ide.click("Expand All");
    assert_eq!(view(&ide).changes_pane().rows().len(), 7);

    // Cmd+click adds the older commit: the pane shows the combined change.
    let older = ide.rect("Commit Studio scene").center();
    ide.click_button_at(older, egui::PointerButton::Primary, CMD);
    assert_eq!(view(&ide).selection().len(), 2);
    wait_changes(&mut ide);
    let files = view(&ide).changes().expect("combined changes").to_vec();
    let names: Vec<String> = files.iter().map(|f| f.path.file_name().unwrap().to_string_lossy().into_owned()).collect();
    assert_eq!(names, ["index.html", "board.ts", "gl.ts", "renamed.ts", "shaders.ts"]);
    assert!(files.iter().all(|f| f.kind == Added), "{files:?}");
    ide.assert_text("2 commits selected");

    // Shift+click selects the range from the anchor.
    let first = ide.rect("Commit Studio rework").center();
    ide.click_at(first);
    let last = ide.rect("Commit Initial commit").center();
    ide.click_button_at(last, egui::PointerButton::Primary, SHIFT);
    assert_eq!(view(&ide).selection().len(), 3);
}

/// A topic branch commit that changes two files; main does not have it.
fn topic_repo(fx: &Fixture) -> Repo {
    let repo = basic_repo(fx.path("repo"));
    repo.git(&["checkout", "-q", "-b", "topic"]);
    repo.write("src/util.ts", "export function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport const ZERO = 0;\nexport const TWO = 2;\n");
    repo.write("src/extra.ts", "export const extra = 1;\n");
    repo.commit_all("Topic work");
    repo.git(&["checkout", "-q", "main"]);
    repo
}

fn open_topic_commit(ide: &mut Ide) {
    open_log(ide);
    // The changes tree needs room: a row half under the commit info would miss right-clicks.
    tall_git_window(ide);
    ide.click("Reset branch filter");
    wait_commits(ide, "all branches", 2);
    ide.click("Commit Topic work");
    wait_changes(ide);
}

#[test]
fn changes_menu_cherry_pick_and_patches() {
    let fx = Fixture::new(SUITE, "changes_menu");
    let repo = topic_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_topic_commit(&mut ide);
    ide.right_click("Changed file src/util.ts");
    ide.settle();
    for item in ["Show Diff", "Compare with Local", "Edit Source", "Cherry-Pick Selected Changes", "Create Patch...", "Copy Patch"] {
        assert!(ide.has(item), "changes menu item {item:?}");
    }
    ide.snapshot_here("changes_context_menu");

    // Copy Patch puts the patch of the chosen file on the clipboard.
    ide.click("Copy Patch");
    ide.wait_until("patch copied", |ide| ide.state().platform.calls().iter().any(|c| c.starts_with("copy diff --git a/src/util.ts b/src/util.ts")));
    let calls = ide.state().platform.calls();
    let patch = calls.iter().find(|c| c.starts_with("copy diff")).expect("patch");
    assert!(!patch.contains("src/extra.ts"), "only the chosen file: {patch}");

    // Create Patch writes the file the dialog names.
    ide.dismiss_toasts();
    ide.right_click("Changed file src/util.ts");
    ide.settle();
    ide.click("Create Patch...");
    ide.settle();
    ide.assert_text("Create Patch: 1 file(s) of 1 commit(s)");
    ide.click("Save Patch");
    ide.wait_until("patch saved", |_| std::fs::read_dir(&repo.dir).expect("repo dir").flatten().any(|e| e.path().extension().is_some_and(|x| x == "patch")));

    // Cherry-Pick Selected Changes applies only util.ts to the working tree and the index.
    ide.dismiss_toasts();
    ide.right_click("Changed file src/util.ts");
    ide.settle();
    ide.click("Cherry-Pick Selected Changes");
    ide.wait_until("cherry-picked", |ide| ide.state().is_idle() && repo.read("src/util.ts").contains("TWO"));
    assert!(repo.status_short().contains("M  src/util.ts"), "{}", repo.status_short());
    assert!(!repo.dir.join("src/extra.ts").exists());
    assert_eq!(repo.subjects("HEAD"), ["Initial commit"], "nothing is committed");
}

#[test]
fn changes_menu_edit_source_and_compare_with_local() {
    let fx = Fixture::new(SUITE, "changes_open");
    let repo = topic_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_topic_commit(&mut ide);

    // Edit Source opens the working-tree file in the editor.
    ide.right_click("Changed file src/util.ts");
    ide.settle();
    ide.click("Edit Source");
    ide.wait_until("editor tab", |ide| ide.active_title().as_deref() == Some("util.ts"));

    // Compare with Local: the commit's file vs the file on disk (main lacks TWO).
    ide.click("Git tool window");
    ide.settle();
    if ide.state().ws.layout.bottom != Some(ToolWindow::Git) {
        ide.click("Git tool window");
        ide.settle();
    }
    ide.right_click("Changed file src/util.ts");
    ide.settle();
    ide.click("Compare with Local");
    ide.wait_until("compare tab", |ide| ide.active_title().is_some_and(|t| t.starts_with("util.ts (") && t.ends_with("vs Local)")));
    ide.settle();
    ide.assert_text("1 difference");

    // F4 in the focused tree opens the file too, Enter shows the diff.
    ide.click("Changed file src/extra.ts");
    ide.key(Key::Enter);
    ide.wait_until("diff tab", |ide| ide.active_title().is_some_and(|t| t.starts_with("extra.ts @ ")));
}

/// 700 commits: pages of 300 load as PageDown nears the end.
#[test]
fn log_paging() {
    let fx = Fixture::new(SUITE, "paging");
    let repo = long_history_repo(fx.path("repo"), 700);
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_log(&mut ide);
    assert_eq!(view(&ide).commits().len(), 300);
    assert!(view(&ide).has_more());
    ide.click("Commit Commit 699");
    // The next page loads only while the view is near the end of the loaded rows. A page that
    // arrives after the last PageDown leaves the view far from the new end, and no further page
    // loads. So keep paging until the last page is in, and bound the loop by time, not by keys.
    let start = std::time::Instant::now();
    while !(view(&ide).commits().len() == 700 && !view(&ide).has_more()) {
        assert!(start.elapsed() < std::time::Duration::from_secs(60), "all pages: {} commits loaded", view(&ide).commits().len());
        ide.key(Key::PageDown);
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    ide.settle();
    let last = view(&ide).commits().last().map(|c| c.summary.clone());
    assert_eq!(last.as_deref(), Some("Commit 0"));
}

#[test]
fn branches_popup_search_checkout_and_new_branch() {
    let fx = Fixture::new(SUITE, "branches");
    let (repo, _bare) = repo_with_remote(&fx);
    repo.git(&["branch", "feature"]);
    repo.git(&["branch", "fix/other"]);
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_branches(&mut ide);
    for row in ["+ New Branch...", "Update Project...", "Push...", "Fetch", "Stash Changes...", "Unstash Changes...", "Local branch main", "Local branch feature", "Remote branch origin/main"] {
        assert!(ide.has(row), "{row:?} missing; {:?}", ide.labels());
    }
    // main is one commit ahead of origin/main: the row draws an up arrow with 1, and its
    // tooltip says so.
    ide.snapshot("branches_popup");
    ide.hover("Local branch main");
    ide.wait_until("ahead/behind tooltip", |ide| ide.shows_text("Tracks origin/main; 1 to push, 0 to pull"));
    ide.park_mouse();

    // The search filters branches and actions.
    ide.type_text("fea");
    ide.settle();
    assert!(ide.has("Local branch feature"));
    assert!(!ide.has("Local branch main") && !ide.has("Fetch"));
    ide.snapshot("branches_search");

    // The submenu checks out the hovered branch.
    branch_menu(&mut ide, "Local branch feature");
    ide.click("Checkout");
    ide.wait_for("checked out", |s| s.ws.git.branch.as_deref() == Some("feature"));
    assert_eq!(repo.branch(), "feature");
    assert!(!ide.state().ws.git_ui.branches.is_open());

    // + New Branch... asks for a name and checks the branch out.
    open_branches(&mut ide);
    ide.click("+ New Branch...");
    ide.settle();
    ide.assert_text("Create New Branch");
    ide.type_text("topic/new\n");
    ide.wait_for("new branch", |s| s.ws.git.branch.as_deref() == Some("topic/new"));
    assert_eq!(repo.branch(), "topic/new");
}

#[test]
fn push_to_bare_remote_with_set_upstream() {
    let fx = Fixture::new(SUITE, "push");
    let (repo, bare) = repo_with_remote(&fx);
    let remote_log = |b: &str| {
        let out = std::process::Command::new("git").args(["--git-dir", bare.to_str().expect("utf8"), "log", "--format=%s", b]).output().expect("git log");
        String::from_utf8_lossy(&out.stdout).lines().map(str::to_string).collect::<Vec<_>>()
    };
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.cmd_shift(Key::K);
    ide.wait_for("push dialog", |s| s.ws.git_ui.remote.push_open() && !s.ws.git_ui.remote.push_commits().is_empty());
    ide.settle();
    assert_eq!(ide.state().ws.git_ui.remote.push_commits(), ["Local work to push"]);
    ide.assert_text("main -> origin/main");
    ide.snapshot("push_dialog");
    click_last(&mut ide, "Push");
    ide.wait_for("pushed", |s| !s.ws.git_ui.remote.push_open());
    assert_eq!(remote_log("main")[0], "Local work to push");

    // A branch without upstream: the dialog offers "Set upstream" (on by default).
    repo.git(&["checkout", "-q", "-b", "topic"]);
    repo.write("topic.txt", "topic\n");
    repo.commit_all("Topic work");
    ide.state_mut().refresh_git();
    ide.wait_for("on topic", |s| s.ws.git.branch.as_deref() == Some("topic"));
    ide.cmd_shift(Key::K);
    ide.wait_for("push dialog for topic", |s| s.ws.git_ui.remote.push_open() && !s.ws.git_ui.remote.push_commits().is_empty());
    ide.settle();
    ide.assert_text("topic -> origin/topic  (new)");
    assert!(ide.is_selected("Set upstream"));
    ide.snapshot("push_new_branch");
    click_last(&mut ide, "Push");
    ide.wait_for("pushed topic", |s| !s.ws.git_ui.remote.push_open());
    assert_eq!(remote_log("topic")[0], "Topic work");
    assert_eq!(repo.git(&["rev-parse", "--abbrev-ref", "topic@{u}"]).trim(), "origin/topic");
}

/// Update Project has no shortcut (Cmd+T opens a terminal); the branches popup offers it.
fn open_update_dialog(ide: &mut Ide) {
    open_branches(ide);
    ide.click("Update Project...");
    ide.wait_for("update dialog", |s| s.ws.git_ui.remote.update_open());
    ide.settle();
}

fn diverged(name: &str) -> (Fixture, Repo) {
    let fx = Fixture::new(SUITE, name);
    let (repo, bare) = repo_with_remote(&fx);
    push_from_other_clone(&fx, &bare, "README.md", "# demo\n\nChanged elsewhere.\n", "Remote change");
    repo.git(&["fetch", "-q"]);
    (fx, repo)
}

#[test]
fn update_project_merge() {
    let (_fx, repo) = diverged("update_merge");
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_update_dialog(&mut ide);
    ide.click("Merge incoming changes into the current branch");
    ide.snapshot("update_dialog");
    ide.click("OK");
    ide.wait_for("updated", |s| !s.ws.git_ui.remote.update_open() && s.is_idle());
    ide.wait_until("merge done", |_| repo.git(&["log", "-1", "--format=%p"]).split_whitespace().count() == 2);
    let s = repo.subjects("HEAD");
    assert!(s.contains(&"Remote change".to_string()) && s.contains(&"Local work to push".to_string()), "{s:?}");
    assert_eq!(repo.read("README.md"), "# demo\n\nChanged elsewhere.\n");
}

#[test]
fn update_project_rebase() {
    let (_fx, repo) = diverged("update_rebase");
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_update_dialog(&mut ide);
    ide.click("Rebase the current branch on top of incoming changes");
    ide.click("OK");
    ide.wait_until("rebased", |_| repo.subjects("HEAD").first().map(String::as_str) == Some("Local work to push") && repo.subjects("HEAD").get(1).map(String::as_str) == Some("Remote change"));
    assert_eq!(repo.git(&["log", "-1", "--format=%p"]).split_whitespace().count(), 1, "linear history");
}

#[test]
fn stash_and_unstash_pop_and_drop_by_id() {
    let fx = Fixture::new(SUITE, "stash");
    let repo = basic_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    let stash = |ide: &mut Ide, file: &str, message: &str| {
        repo.write(file, &format!("{message}\n"));
        ide.state_mut().refresh_git();
        ide.settle();
        open_branches(ide);
        ide.click("Stash Changes...");
        ide.wait_for("stash dialog", |s| s.ws.git_ui.remote.stash_open());
        ide.settle();
        ide.type_text(message);
        ide.click("Include untracked files");
        ide.dismiss_toasts();
        ide.click("Create Stash");
        ide.wait_for("stashed", |s| !s.ws.git_ui.remote.stash_open() && s.is_idle());
    };
    stash(&mut ide, "src/util.ts", "wip one");
    stash(&mut ide, "new.txt", "wip two");
    assert!(repo.status_short().is_empty(), "both stashes took everything, untracked too");

    open_branches(&mut ide);
    ide.click("Unstash Changes...");
    ide.wait_for("unstash list", |s| s.ws.git_ui.remote.unstash_entries().is_some_and(|e| e.len() == 2) && !s.ws.git_ui.remote.unstash_busy());
    ide.settle();
    ide.snapshot("unstash_dialog");

    // Pop the older stash (index 1).
    ide.click_containing("wip one");
    ide.settle();
    ide.dismiss_toasts();
    ide.click("Pop");
    ide.wait_for("popped", |s| s.ws.git_ui.remote.unstash_entries().is_none() && s.is_idle());
    assert!(repo.read("src/util.ts").starts_with("wip one"));
    assert_eq!(repo.git(&["stash", "list", "--format=%s"]).trim(), "On main: wip two");

    // Drop by id: a stash made while the dialog is open shifts the indices, and Drop must
    // still remove the entry the dialog showed.
    open_branches(&mut ide);
    ide.click("Unstash Changes...");
    ide.wait_for("unstash list", |s| s.ws.git_ui.remote.unstash_entries().is_some_and(|e| e.len() == 1) && !s.ws.git_ui.remote.unstash_busy());
    repo.write("other.txt", "other\n");
    repo.git(&["stash", "push", "-u", "-q", "-m", "made outside"]);
    ide.dismiss_toasts();
    ide.click("Drop");
    ide.settle();
    ide.assert_text("Drop stash@{0}? Its changes are lost.");
    let n = ide.rects("Drop").len();
    ide.click_nth("Drop", n - 1);
    ide.wait_for("dropped", |s| s.is_idle() && s.ws.git_ui.remote.unstash_entries().is_some_and(|e| e.len() == 1));
    assert_eq!(repo.git(&["stash", "list", "--format=%s"]).trim(), "On main: made outside");
}

fn start_conflict(name: &str) -> (Fixture, Repo, Ide) {
    let fx = Fixture::new(SUITE, name);
    let repo = conflict_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_branches(&mut ide);
    branch_menu(&mut ide, "Local branch conflict-b");
    ide.click("Merge 'conflict-b' into 'conflict-a'");
    ide.wait_for("conflicts dialog", |s| s.ws.git_ui.conflicts.dialog_open() && s.ws.git_ui.conflicts.files().len() == 1 && s.is_idle());
    ide.settle();
    (fx, repo, ide)
}

/// A double click on a conflict row 0.6 s after the click that selected it opens the merge
/// tab. egui's own count calls it "triple" (`clicks.rs`).
#[test]
fn conflict_double_click_after_select() {
    let (_fx, _repo, mut ide) = start_conflict("double_click_chain");
    let row = ide.rect("Conflict conflict.txt").center();
    ide.click_at(row);
    assert!(ide.is_selected("Conflict conflict.txt"));
    assert!(ide.active_title().is_none_or(|t| !t.contains("conflict.txt")), "a single click opens nothing");
    ide.idle(0.6);
    ide.double_click_now(row);
    ide.wait_until("merge tab", |ide| ide.active_title().is_some_and(|t| t.contains("conflict.txt")));
}

#[test]
fn merge_conflict_resolved_in_merge_tab() {
    let (_fx, repo, mut ide) = start_conflict("conflict");
    assert_eq!(ide.state().ws.git_ui.conflicts.op(), RepoState::Merge);
    ide.assert_text("1 file(s) have conflicts. Pick a side, or merge them by hand.");
    ide.dismiss_toasts();
    ide.snapshot("conflicts_dialog");

    ide.click("Merge...");
    ide.wait_until("merge tab", |ide| ide.active_title().is_some_and(|t| t.contains("conflict.txt")));
    ide.settle();
    ide.snapshot("merge_tab");
    ide.click("Accept Theirs");
    ide.settle();
    ide.click("Save and Mark Resolved");
    ide.wait_for("resolved", |s| s.ws.git_ui.conflicts.files().is_empty() && s.is_idle());
    ide.settle();
    assert_eq!(repo.read("conflict.txt"), "line one\ntheirs version\nline three\n");
    ide.assert_text("Merge in progress: all conflicts resolved");
    ide.dismiss_toasts();
    ide.snapshot("banner_resolved");

    // Continue commits the merge.
    ide.click("Continue");
    ide.wait_for("merge committed", |s| s.ws.git_ui.conflicts.op() == RepoState::Clean && s.is_idle());
    assert_eq!(repo.git(&["log", "-1", "--format=%p"]).split_whitespace().count(), 2);
    assert!(repo.status_short().is_empty());
}

#[test]
fn abort_from_the_banner() {
    let (_fx, repo, mut ide) = start_conflict("abort");
    // Closing the dialog leaves the banner.
    ide.click("Accept Yours");
    ide.wait_for("resolved with ours", |s| s.ws.git_ui.conflicts.files().is_empty() && s.is_idle());
    ide.settle();
    ide.dismiss_toasts();
    ide.click("Abort");
    ide.settle();
    ide.assert_text("Abort merge?");
    ide.snapshot("abort_confirm");
    let n = ide.rects("Abort").len();
    ide.click_nth("Abort", n - 1);
    ide.wait_for("aborted", |s| s.ws.git_ui.conflicts.op() == RepoState::Clean && s.is_idle());
    assert_eq!(repo.read("conflict.txt"), "line one\nours version\nline three\n");
    assert!(repo.status_short().is_empty());
    assert!(!ide.shows_text("Merge in progress"));
}

#[test]
fn log_context_menu_new_branch_and_reset() {
    let fx = Fixture::new(SUITE, "log_menu");
    let repo = history_repo(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    open_log(&mut ide);
    ide.right_click("Commit Add ONE");
    ide.settle();
    for item in ["Copy Revision Number", "Checkout Revision", "New Branch...", "New Tag...", "Reset Current Branch to Here...", "Revert Commit", "Cherry-Pick"] {
        assert!(ide.has(item), "log menu item {item:?}");
    }
    ide.snapshot_here("log_context_menu");
    ide.click("New Branch...");
    ide.settle();
    ide.assert_text("New branch from ");
    // Regression: Enter in the name box used to do nothing, because the box took the focus
    // back on the same frame.
    ide.type_text("from-log\n");
    ide.wait_for("branch from log", |s| s.ws.git.branch.as_deref() == Some("from-log"));
    assert_eq!(repo.subjects("HEAD")[0], "Add ONE");
    // The new ref reloads the log; a menu opened before the reload lands would close with it.
    ide.settle();

    // Reset --hard asks twice; the branch then points at the chosen commit.
    // The last row sits partly below the visible area; the click scrolls it into view, so the
    // right click aims at its new place.
    ide.click("Commit Initial commit");
    ide.settle();
    ide.right_click("Commit Initial commit");
    ide.settle();
    ide.click("Reset Current Branch to Here...");
    ide.settle();
    ide.click("Hard: discard all changes");
    ide.click("Reset");
    ide.settle();
    ide.assert_text("Hard reset discards all uncommitted changes");
    ide.snapshot("reset_hard_confirm");
    ide.click("Reset --hard");
    ide.wait_until("reset done", |_| repo.subjects("HEAD") == ["Initial commit"]);
}
