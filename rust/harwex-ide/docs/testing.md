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

Suites in `app/tests/`: `shell`, `editor`, `navigation` (tsserver), `rust_nav` (rust-analyzer), `terminal`, `git_changes`, `git_history`, `git_window`, `breadcrumbs`, `launch`, `find_replace`, `soft_wrap`.

## Test tools

The language-server suites run against pinned tools, never against another repository or the tools of this machine. Provision them once per target dir:

```sh
cargo xtask test-tools
```

It downloads into `target/tools/` (or `$CARGO_TARGET_DIR/tools/`) and verifies every file: TypeScript 5.9.3 (`ts5/`), TypeScript 7.0.2 with its platform package (`ts7/`), oxlint 1.77.0 with its native binding, `oxlint-tsgolint` 7.0.2002 and its platform binary (`oxlint/`), ESLint 10.12.0 with `@eslint/js`, typescript-eslint 8.71.0 and TypeScript 5.9.3 as a full npm tree pinned by `xtask/src/eslint.lock` (`eslint/`), rust-analyzer (`rust-analyzer/bin`, plus the `librustc_driver` it links) and rust-src (`rust-src/lib/rustlib/src/rust/library`). The pins are at the top of `xtask/src/test_tools.rs`. A second run needs no network. `cargo clean` deletes the tools.

Each test helper looks up a tool in one order: the env override, then `target/tools/`, then it prints a `skipping ...` line that says to run `cargo xtask test-tools`, and the test passes.

| Tool | Override | Helper |
|---|---|---|
| TypeScript 5 (a `typescript` package dir) | `HARWEX_TEST_TS5` | `app/tests/common/fixtures.rs` `typescript()`, `crates/ide-ts/tests/common` `ts5()` |
| TypeScript 7 (a `typescript` package dir, its platform package beside its real dir) | `HARWEX_TEST_TS7` | `crates/ide-ts/tests/common` `ts7()`, `app/tests/common/fixtures.rs` `typescript7()` |
| oxlint (an `oxlint` package dir; its binding and `oxlint-tsgolint` beside its real dir) | `HARWEX_TEST_OXLINT` | `app/tests/common/fixtures.rs` `oxlint()` |
| ESLint (a `node_modules` dir with `eslint`, `@eslint/js`, `typescript-eslint`, `typescript`) | `HARWEX_TEST_ESLINT` | `app/tests/common/fixtures.rs` `eslint_modules()` |
| rust-analyzer | `HARWEX_RUST_ANALYZER` | `app/tests/common/fixtures.rs` `use_test_rust_tools()` |
| rust-src `library` dir | `RUST_SRC_PATH` | same |

A rust-analyzer on PATH or a rust-src in rustup is not used, so a run never passes by luck. Never install either into `~/.rustup` for the tests.

The timing checks that used to read other repositories now run on generated trees: `crates/ide-git/tests/large_repo.rs` (4000 files, about 1400 commits with merges, a dirty worktree), `crates/ide-ts/tests/workspace.rs` (40 linked workspace packages and a `.d.ts` + `.js` dependency) and `app/tests/lint_budget.rs` (ESLint and oxlint on 200 packages, without and with type-aware rules). Their budgets are in `docs/timings.md`.

## Clean-machine check

```sh
cargo xtask clean-check            # or: cargo xtask clean-check --dir <empty dir outside the workspace>
```

It simulates a fresh machine on this Mac. It copies the workspace without `target/` to `$TMPDIR/harwex-clean/src/harwex-ide`. It clears the environment: HOME, TMPDIR and CARGO_TARGET_DIR are empty dirs, CARGO_HOME and RUSTUP_HOME stay real (compiler and crates.io cache), and PATH holds wrappers for `cargo`, `rustc`, `rustdoc`, `git` and `node` plus `/usr/bin:/bin:/usr/sbin:/sbin` (the C compiler for libgit2, `curl`, `tar`, `shasum`). Then it runs `cargo xtask test-tools && cargo test --workspace --no-fail-fast -- --nocapture` under `sandbox-exec`. The profile denies reads and writes under `~/Projects`, `~/Library/Application Support/harwex-ide` and `$RUSTUP_HOME/toolchains/*/lib/rustlib/src`, so a test that still reads another repository fails with EPERM.

It passes with zero failed tests and zero `skipping` lines. The summary prints the counts and the log path (`$TMPDIR/harwex-clean/clean-check.log`). The first run builds everything from scratch and downloads the tools, so it takes several minutes. Run it after a change to tests, fixtures or the tool lookup.

## Fake servers

`ide-lsp` tests run against `src/bin/fake_server.rs`, a scripted LSP server (`CARGO_BIN_EXE_ide-lsp-fake-server`).

## Snapshots

- References live in `app/tests/snapshots/<suite>/<name>.png`. git tracks them through LFS.
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

- `app/tests/common/mod.rs` has the driver: `click(label)`, `right_click`, `double_click`, `hover`, `click_button_at(pos, button, mods)`, `drag`, `key`, `cmd`, `cmd_shift`, `key_mods`, `type_text`, `double_shift`, `settle`, `wait_for`, `wait_until`, `snapshot` (parks the mouse first), `snapshot_here` (keeps hover effects) and `take_viewport_commands` (zoom, minimize and drag commands the app sent).
- Widgets are found by their accessibility label. Hand-painted rows carry one: tree rows use the relative path, commit window rows the path or `Directory <dir>`, their boxes `Include <name>`, log rows `Commit <subject>`, branch rows `Local branch <name>`, tabs `Tab <title>`, strip buttons `<Title> tool window`, the editor `Editor <file>`, the terminal grid `Terminal output`. `ide.labels()` lists what is on screen.
- Fixtures in `app/tests/common/fixtures.rs` build git repositories with fixed dates, so hashes are stable: `basic_repo`, `changed_repo` (modified, staged add, deletion, untracked), `history_repo` (a merge and a tag), `long_history_repo(n)` (fast-import), `repo_with_remote` plus `push_from_other_clone` (a bare remote and a second clone), `conflict_repo`, `many_changes_repo(n)`, `big_file_repo` (10k lines with changes), `ts_project` (`node_modules/fake-lib` with `.d.ts` and `.js`, a workspace package link) and `cargo_project` (`app` and `util` crates). Git commands that the app runs get a fixed identity and date from `common::init()`.
- A fixture lives at `/private/tmp/harwex-ide-kittest/<suite>/<test>`, so drawn paths are stable. It is wiped when created and removed on drop.
- Tests never read or write the user's app storage: `AppOptions` from `test_options()` has no storage, no file watcher and a `zsh -f` terminal with the prompt `$ `. Use `MemoryStorage` to test persistence.
- `ide.settle()` steps frames until no job, tsserver request or debounce (gutter, log filter, blame, hover) is pending. Use `wait_for` for anything a child process produces (terminal output, git results).

## Real-window smoke tests

Use a real window only when no headless suite can cover the path, for example a smoke test against a real repository. Run it in background mode, and only read the repository.

`HARWEX_IDE_BACKGROUND=1`, or any hidden `--test-*` flag, makes `main.rs` start an accessory app: no activation, an inactive viewport, no restored window state, and its own storage file in `$TMPDIR`.

The hidden flags live in `app/src/testhook.rs` and `app/src/git/remote/testing.rs`. Lines in them are 1-based. The steps run the real UI code paths and log to stderr.

- `--open <file> [--goto L:C]`, `--test-nav definition|source|type|usages@L:C` (repeatable), `--test-goto-definition L:C`, `--test-search <q>`, `--test-find <q>`, `--test-term "<command>"`, `--test-quit`.
- Changes and editor git steps: `--test-git-changes`, `--test-git-commit "<msg>" <comma-separated paths>`, `--test-git-diff <path>`, `--test-git-diff-next <n>`, `--test-git-gutter <L>`, `--test-git-rollback-lines <L>`, `--test-git-annotate`, `--test-git-blame-click <L>`, `--test-git-history`.
- `--test-git-<step> [arg]` for the log, branches, remote and conflict UI. Each step waits until no labelled job runs. Steps: `log`, `select`, `filter`, `filehistory`, `logfile`, `diffstate`, `logaction`, `branches`, `branch-menu`, `checkout`, `merge`, `rebase`, `newbranch`, `push`, `push-go`, `update`, `update-go`, `stash`, `stash-go`, `unstash`, `unstash-pop`, `conflicts`, `mergetool`, `take`, `save`, `continue`, `abort`, `dump`, `wait`.
- `--test-tree-hits <w1,w2,...>` (`testhook/tree_hits.rs`): for each Project panel width, logs every other click or drag widget that overlaps a tree row, then probes a few folder rows and a file row with injected pointer events (hover every 1 pt, click and double click every 8 pt) and logs one line per row: `.` the row gets the event, `X` another widget, `_` nothing; `s` selects, `t` toggles. The hook owns the input clock, so probes never merge into double clicks. A background window draws about 10 frames per second, so three widths take several minutes.
- `HARWEX_DEBUG_FS=1` logs the watcher batches.
- `HARWEX_IDE_INPUT_LOG=<file>` (`inputlog.rs`, not in tests) records every frame with pointer input: the egui input time, the wall clock, the previous frame's `update` time, the raw pointer events, egui's click count, and the Project tree's decision for the row under the pointer (hovered, clicked, chain press count, toggle, `hits.click`). Use it when the user sees an input bug the headless suites do not: ask them to start the app with it once and repeat the action.
- Tests run with the macOS default double-click interval (`chrome::DEFAULT_DOUBLE_CLICK_INTERVAL`, 0.5 s), set through the same path as the real app. The driver's `click_at` and `double_click_at` wait twice that interval first, so a test click is always fresh; `click_now` and `double_click_now` do not wait, for tests of quick click sequences.

