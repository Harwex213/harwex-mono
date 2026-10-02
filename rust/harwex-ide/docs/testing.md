# Testing harwex-ide

The UI tests are headless. They drive the real `IdeApp` through `egui_kittest`: real pointer and key events go in, frames are rendered offscreen with wgpu, and PNG snapshots come out. No window opens, so the tests also work while the Mac screen is locked.

## Rule for agents: never steal the user's screen

- Prefer the headless suites. They cover almost everything an agent used to check by hand.
- Never launch the real IDE window without `HARWEX_IDE_BACKGROUND=1`. Any hidden `--test-*` flag turns it on as well. In background mode the app is an accessory app: no Dock icon, no activation, no Space switch, and it keeps its own storage (`$TMPDIR/harwex-ide-background.ron`) instead of the user's `~/Library/Application Support/harwex-ide`. The log line `[harwex-ide] background mode: activation policy Accessory` confirms the mode.

## Run

From `rust/harwex-ide`:

```sh
cargo test --workspace                       # everything, about 20 s warm
cargo test -p harwex-ide --test git_history  # one suite
cargo test -p harwex-ide --test shell tabs   # tests whose name contains "tabs"
```

Suites in `app/tests/`: `shell`, `editor`, `navigation` (tsserver), `terminal`, `git_changes`, `git_history`, `breadcrumbs`, `launch`. The navigation tests print `skipping <test>: ...` and pass when node or `javascript/node_modules/typescript` is missing.

## Snapshots

- References live in `app/tests/snapshots/<suite>/<name>.png`. They are files on disk, not in git.
- A comparison allows 64 differing pixels (anti-aliasing noise). On a real mismatch the test fails and leaves `<name>.new.png` (this run) and `<name>.diff.png` (changed pixels) next to the reference.
- `UPDATE_SNAPSHOTS=1 cargo test -p harwex-ide` rewrites the references (the old one is kept as `<name>.old.png`; delete those afterwards).
- Window size is 1280x800, 1 point per pixel. `ide.resize(size)` changes it for one test (narrow-window checks). Toasts never expire in tests, and durations ("12 ms", "3s ago") are hidden, so the same input draws the same pixels.

## Verify a UI change visually

1. Run the suite that covers the change, without `UPDATE_SNAPSHOTS`.
2. For each failed snapshot, Read `<name>.new.png` and `<name>.diff.png` with the Read tool. Decide whether the new picture is what you intended.
3. If it is, rerun that suite with `UPDATE_SNAPSHOTS=1`, Read the updated `<name>.png`, and delete `*.old.png`.
4. A new feature needs a new snapshot: add the test, run it with `UPDATE_SNAPSHOTS=1`, and Read the PNG to confirm it shows what the test name claims.

## Add a test

```rust
mod common;
use common::*;

#[test]
fn my_feature() {
    let fx = Fixture::new("my_suite", "my_feature");          // /private/tmp/harwex-ide-kittest/my_suite/my_feature
    let repo = changed_repo(fx.path("repo"));                  // or basic_repo, history_repo, ts_project, ...
    let mut ide = Ide::open("my_suite", &repo.dir);            // waits for tree, index and git status
    ide.open_file("src/app.ts");
    ide.click_at(ide.caret_pos(3, 2));                          // real pointer press and release
    ide.type_text("x\n");
    ide.cmd(egui::Key::S);
    ide.wait_for("saved", |s| !s.tabs.active_tab().unwrap().is_dirty());
    assert!(repo.read("src/app.ts").contains("x"));             // always assert state, not only pixels
    ide.snapshot("after_save");                                 // tests/snapshots/my_suite/after_save.png
}
```

- `app/tests/common/mod.rs` has the driver: `click(label)`, `right_click`, `double_click`, `hover`, `click_button_at(pos, button, mods)`, `drag`, `key`, `cmd`, `cmd_shift`, `key_mods`, `type_text`, `double_shift`, `settle`, `wait_for`, `wait_until`, `snapshot` (parks the mouse first) and `snapshot_here` (keeps hover effects).
- Widgets are found by their accessibility label. Hand-painted rows carry one: tree rows use the relative path, commit window rows the path or `Directory <dir>`, their boxes `Include <name>`, log rows `Commit <subject>`, branch rows `Local branch <name>`, tabs `Tab <title>`, strip buttons `<Title> tool window`, the editor `Editor <file>`, the terminal grid `Terminal output`. `ide.labels()` lists what is on screen.
- Fixtures in `app/tests/common/fixtures.rs` build git repositories with fixed dates (stable hashes) and a TypeScript project with `node_modules/fake-lib` and a workspace package. Git commands that the app runs get a fixed identity and date from `common::init()`.
- Tests never read or write the user's app storage: `AppOptions` from `test_options()` has no storage, no file watcher and a `zsh -f` terminal with the prompt `$ `. Use `MemoryStorage` to test persistence.
- `ide.settle()` steps frames until no job, tsserver request or debounce (gutter, log filter, blame, hover) is pending. Use `wait_for` for anything a child process produces (terminal output, git results).
