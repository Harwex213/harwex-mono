//! Git-ignored files in the Project tree (task 110): listed dimmed like IDEA, an ignored folder
//! read only when expanded, Select Opened File into an ignored folder, the watcher's folder
//! reloads, the System › Project view setting, and search that keeps skipping them.

use std::collections::HashSet;
use std::path::PathBuf;

use crate::common::*;
use egui::Key;

const SUITE: &str = "tree_ignored";

/// `basic_repo` with ignored files: `node_modules/` (two levels), `ignored/` and `*.log`.
fn ignored_repo(fx: &Fixture) -> Repo {
    let repo = basic_repo(fx.path("repo"));
    repo.write(".gitignore", "ignored/\nnode_modules/\n*.log\n");
    repo.commit_all("ignore");
    repo.write("node_modules/pkg/index.js", "export const needle = 1;\n");
    repo.write("node_modules/pkg/lib/deep.js", "export const deep = 'needle';\n");
    repo.write("ignored/secret.txt", "needle\n");
    repo.write("debug.log", "needle\n");
    repo.write("src/found.ts", "export const needle = 2;\n");
    repo.commit_all("found");
    repo
}

fn ignored(ide: &Ide, rel: &str) -> bool {
    let path = ide.root().join(rel);
    ide.state().ws.tree.is_ignored(&path)
}

#[test]
fn ignored_rows_are_dimmed_and_listed_lazily() {
    let fx = Fixture::new(SUITE, "rows");
    let repo = ignored_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    let root = ide.root();
    for rel in ["node_modules", "ignored", "debug.log"] {
        assert!(ide.has(rel), "{rel} shows in the tree");
        assert!(ignored(&ide, rel), "{rel} is marked ignored");
    }
    for rel in ["src", "docs", ".gitignore", "README.md"] {
        assert!(!ignored(&ide, rel), "{rel} is not ignored");
    }
    assert!(!ide.has(".git"), ".git stays hidden");
    // Nothing reads an ignored folder before it is expanded.
    assert!(!ide.state().ws.tree.is_loaded(&root.join("node_modules")));

    // The file index, so Search Everywhere and Go to File, skips them.
    let files = ide.state().ws.index.files.clone();
    assert!(files.iter().any(|f| f == "src/found.ts"));
    assert!(!files.iter().any(|f| f.starts_with("node_modules/") || f.starts_with("ignored/") || f == "debug.log"), "{files:?}");

    // Expanding lists the folder on a worker; its content is ignored too.
    ide.double_click("node_modules");
    ide.wait_for("node_modules listed", |s| s.ws.tree.is_loaded(&root.join("node_modules")));
    ide.settle();
    assert!(ide.has("node_modules/pkg"));
    assert!(ignored(&ide, "node_modules/pkg"));
    assert!(!ide.state().ws.tree.is_loaded(&root.join("node_modules/pkg")), "one level only");
    ide.double_click("node_modules/pkg");
    ide.wait_for("pkg listed", |s| s.ws.tree.is_loaded(&root.join("node_modules/pkg")));
    ide.settle();
    assert!(ignored(&ide, "node_modules/pkg/index.js") && ignored(&ide, "node_modules/pkg/lib"));
    ide.snapshot("ignored_rows");

    // Find in Files skips them as well.
    ide.click("README.md");
    ide.cmd_shift(Key::F);
    ide.settle();
    ide.type_text("needle");
    ide.wait_for("search finished", |s| !s.ws.find.has_pending_debounce() && !s.ws.find.searching);
    ide.settle();
    let hits: Vec<PathBuf> = ide.state().ws.find.results.iter().map(|(p, _)| p.clone()).collect();
    assert_eq!(hits, [root.join("src/found.ts")], "Find in Files skips ignored files");
    ide.key(Key::Escape);
    ide.settle();
}

#[test]
fn select_opened_file_reveals_an_ignored_file() {
    let fx = Fixture::new(SUITE, "locate");
    let repo = ignored_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    let root = ide.root();
    // A file of an ignored folder opens as a normal tab.
    ide.open_file("node_modules/pkg/lib/deep.js");
    assert_eq!(ide.active_title().as_deref(), Some("deep.js"));
    assert!(ide.active_text().contains("needle"));
    harwex_ide::tree::select_opened_file(ide.state_mut());
    let file = root.join("node_modules/pkg/lib/deep.js");
    ide.wait_for("revealed", |s| s.ws.tree.is_loaded(&root.join("node_modules/pkg/lib")));
    ide.settle();
    assert_eq!(ide.state().ws.tree.selected.as_deref(), Some(file.as_path()));
    assert!(ide.has("node_modules/pkg/lib/deep.js"));
    assert!(ide.is_selected("node_modules/pkg/lib/deep.js"));
    assert!(ignored(&ide, "node_modules/pkg/lib/deep.js"));
}

#[test]
fn watcher_reloads_only_shown_ignored_folders() {
    let fx = Fixture::new(SUITE, "watch");
    let repo = ignored_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    let root = ide.root();
    ide.double_click("node_modules");
    ide.wait_for("node_modules listed", |s| s.ws.tree.is_loaded(&root.join("node_modules")));
    ide.double_click("node_modules/pkg");
    ide.wait_for("pkg listed", |s| s.ws.tree.is_loaded(&root.join("node_modules/pkg")));
    ide.settle();

    // An expanded ignored folder is listed again.
    repo.write("node_modules/pkg/added.js", "1\n");
    ide.state_mut().on_ignored_dirs(HashSet::from([root.join("node_modules/pkg")]));
    ide.wait_for("added row", |s| s.ws.tree.is_ignored(&root.join("node_modules/pkg/added.js")));
    ide.settle();
    assert!(ide.has("node_modules/pkg/added.js"));

    // A collapsed one forgets its listing and reads it again on the next expand.
    ide.double_click("node_modules/pkg");
    ide.settle();
    repo.write("node_modules/pkg/later.js", "2\n");
    ide.state_mut().on_ignored_dirs(HashSet::from([root.join("node_modules/pkg")]));
    ide.settle();
    assert!(!ide.state().ws.tree.is_loaded(&root.join("node_modules/pkg")));
    ide.double_click("node_modules/pkg");
    ide.wait_for("pkg listed again", |s| s.ws.tree.is_ignored(&root.join("node_modules/pkg/later.js")));
    // A folder the tree never listed costs nothing.
    ide.state_mut().on_ignored_dirs(HashSet::from([root.join("node_modules/pkg/lib/none")]));
    ide.settle();
    assert!(!ide.state().ws.tree.is_loaded(&root.join("node_modules/pkg/lib/none")));
}

#[test]
fn the_setting_hides_ignored_files() {
    let fx = Fixture::new(SUITE, "setting");
    let repo = ignored_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    let root = ide.root();
    assert!(ide.state().settings.global.files.show_ignored, "on by default, like IDEA");
    ide.double_click("node_modules");
    ide.wait_for("node_modules listed", |s| s.ws.tree.is_loaded(&root.join("node_modules")));
    ide.settle();

    ide.cmd(Key::Comma);
    ide.settle();
    ide.click("Show ignored files in Project");
    ide.click("OK");
    ide.wait_for("relisted", |s| s.ws.tree.is_loaded(&root) && !s.settings.global.files.show_ignored);
    ide.settle();
    for rel in ["node_modules", "node_modules/pkg", "ignored", "debug.log"] {
        assert!(!ide.has(rel), "{rel} is hidden");
    }
    assert!(ide.has("src") && ide.has(".gitignore"));
    assert!(!repo.dir.join(".harwex/ide.toml").exists(), "a global setting writes nothing into the project");

    // On again: the expanded folder comes back expanded.
    ide.cmd(Key::Comma);
    ide.settle();
    ide.click("Show ignored files in Project");
    ide.click("OK");
    ide.wait_for("relisted", |s| s.ws.tree.is_loaded(&root.join("node_modules")) && s.settings.global.files.show_ignored);
    ide.settle();
    assert!(ide.has("node_modules/pkg") && ide.has("debug.log"));
}
