# app (`harwex-ide`)

The IDE itself: window, layout, tool windows, tabs, Git UI, navigation and the language registry. The crate is a library plus a thin `main.rs`. `main.rs` only parses the command line and sets up background mode. Tests build the same `IdeApp` headlessly through `IdeApp::create(ctx, storage, AppOptions)`.

## Boundaries

- Git logic belongs in `ide-git`. Text editing and highlighting belong in `ide-editor`. Terminal emulation belongs in `ide-term`. LSP mechanics belong in `ide-lsp`. The app wires them together and draws the panels.
- Language-specific server setup is the exception: the language registry (`lang/`) holds the TypeScript adapter and the rust-analyzer adapter (locating, root detection, init options, `ide.toml`).
- Colors, radii, spacing and font sizes come from `theme::T` (`src/theme.rs`). Widgets write no color literals. This check must find nothing: `grep -rnE "Color32::(from_|[A-Z])|hex\(0x" app/src | grep -v theme.rs`.
- `src/icons.rs` draws the icons from shapes that egui stores inline (segments, circles, rects, Béziers). Icons use no textures and no SVG, and they allocate nothing per frame.

Read `docs/app-internals.md` when you add a panel, a custom tab, a Git UI action or a language.

## Contracts inside the app

- Background work: `state.jobs.spawn(label, work, done)` runs `work` on a thread and `done(&mut AppState, result)` on the UI thread. `spawn_quiet` has no spinner label. `post(f)` schedules a closure from any thread. `busy(label)` guards long-lived workers. A panic in a job becomes an error toast.
- Every git write goes through `git::remote::run_op`, or at least calls `state.refresh_git()` afterwards. `refresh_git` re-reads status and branch and recomputes the gutters.
- Language traffic goes through `state.langs`. Each language has one queue thread, so sync commands and requests reach the server in UI order. Call `nav::flush_lsp` before a request, so the server has the current buffer text.
- Results that arrive late must not act on newer state. Use the generation counters (`nav`, `find`, `search`, the project generation) and drop stale results. Line numbers captured at click time go stale when the doc version changes. Stash entries are resolved by oid, not by index.
- A new global shortcut goes into `app::shortcuts` after the `terminal::shortcuts` check. Otherwise the shortcut fires while the user types in a terminal.
- Cmd+F, Cmd+R, Cmd+G, Shift+Cmd+G and Ctrl+Cmd+G (Select All Occurrences) (`app::editor_find_keys`) act on the active editor only while it or its find bar has the focus, or nothing has (`EditorState::owns_focus`). The other multi-caret keys (Alt+click, Ctrl+G, double Alt) live in the editor widget.
- A popup that handles keys consumes them at the start of the frame (see `nav::take_popup_keys`, `breadcrumbs::take_keys`). Otherwise Enter and the arrows also reach the focused editor.
- New tool-window rows and hand-painted widgets need an accessibility label. The tests find widgets by label.
- There is no right strip. Every tool window toggle sits on the left strip; the islands keep a full `gap` to the right window edge.
- The macOS window buttons sit vertically centered in our 40 pt title bar. `chrome::title_bar_layout` is the layout math (buttons, content x, none in full screen); `chrome/macos.rs` moves the native buttons there; `--test-chrome` checks a real background window against it.
- The title bar holds only the project widget, Settings and the display-only branch. Git and search actions live on shortcuts (Cmd+T, Cmd+K, Cmd+Shift+K, Shift Shift, Ctrl+Shift+Backtick for branches). Do not add action buttons there.
- The project tree has focus while egui's focus is on `tree::focus_id()`. Focus picks the selection color (blue focused, grey otherwise) and routes the arrow keys. A row press selects; a double click anywhere on the row toggles a folder or opens a file; a click in the chevron cell toggles at once. The row is the only click widget: the chevron cell is a hover-only a11y node, and the row decides by the pointer x. A row's rect includes the spacing under it, is exactly the viewport wide, and its id is `("tree-row", path)`.
- Project tree drag and drop (`tree.rs`): a press that moves past egui's click distance starts `state.tree.drag`; the drop goes through `tree_menu::drop_into`, the same `paste` as Cut/Copy + Paste (Alt copies). The target is the row's folder or a file row's parent (`tree::drop_dir`), refused inside the dragged folder; a11y node `Drop target <rel>`. The tree's `ScrollArea` has drag-to-scroll off.
- Breadcrumbs of a file outside the project start at a library root (`breadcrumbs::external_root`): the rust-src crate, `<crate> <version>` from a Cargo registry, the `node_modules` package, or `External` with at most 3 segments. The label never holds a disk path, so snapshots of external files do not depend on the checkout location.
- The Commit tree (`git::changes`) has the groups Staged, Unstaged and Unversioned Files. A row is a (path, group) item, and a partly staged file has two. A11y labels: `<Title> group`, `Directory <dir> in <Title>`, the file path, and `<path> in Staged` for the Staged row of a partly staged file. Boxes are `Include <label>`; during a drag the target group is `Drop target <Title>`. Stage, Unstage and drops go through `run_op`.
- Project tree file operations: `tree_menu.rs` (menu, keys, dialogs, the rename/move/delete/usages pipeline) on top of `fileops.rs` (disk work, no UI). Rename, Paste after Cut, Delete and Find Usages first run `ide_ts::import_candidates` over the file index on a worker, then ask each language through `state.langs`; a dialog shows the progress, and Cancel or a newer question drops the answer by generation. Moves apply closed-file edits in parallel on workers and open documents with one `transact` each, then save.
- Trash, Finder and the clipboard go through `state.platform` (`fileops::Platform`). Deterministic mode (all tests) gets a `RecordingPlatform` that records calls and moves trashed items to `$TMPDIR/harwex-ide-test-trash`. Never call the system directly.
- `[project] excluded` in `.harwex/ide.toml` becomes `state.tree.excluded`: dimmed in the tree, skipped by the file index and Find in Files. `apply_ide_config` rebuilds the index when the list changes.
- Custom tabs (diff, merge) implement `tabs::CustomTab`. Use `CustomTab::file_path()` when the tab shows one file, so the breadcrumbs follow it.
- Problems in `.harwex/ide.toml` become warning toasts and fall back to defaults. They are never hard errors.
- Diagnostics (`diagnostics/`): only open TS/JS files are checked. The TS server answers type errors through `LanguageServer::diagnostics` on the TypeScript queue; linters run on `state.langs.lint`. `strategy::plan` (pure) picks the sources; the UI reads only `Problem`s, so a new source is a `LintSource` plus a `SourceId`. Results stay visible and shift through edits until new ones land. A TS failure only logs to the timings log (navigation already reports a missing server); a linter failure toasts once.
- ESLint (`diagnostics/eslint.rs`): one `node --expose-gc -e eslint_server.js` per workspace root (topmost `node_modules/eslint` above the config), one `ESLint` instance per config dir inside it. The app sends the config dir with each `textDocument/diagnostic` (`harwex.configDir`); the script never searches for configs. The process gets `HARWEX_IDE=1`. Keep the script dependency-free: it loads only the project's own `eslint`.
- The memory indicator (`memory.rs`) samples on its own thread and is not part of `is_idle()`. In deterministic mode the OS source is off, so live numbers never reach a snapshot. Tests pass `MemorySource::Custom` (see `docs/app-internals.md`).

## Test

```sh
cargo test -p harwex-ide                        # all suites, headless
cargo test -p harwex-ide --test git_history     # one suite
UPDATE_SNAPSHOTS=1 cargo test -p harwex-ide --test shell   # re-record, then Read the PNGs, delete *.old.png
```

- `project_menu` covers the tree menu and file operations; its rename and delete tests need TypeScript 5 or rust-analyzer from `target/tools/`.
- The suites in `tests/` drive the real `IdeApp` through `egui_kittest` with real pointer and key events. Read `docs/testing.md` before you add a test. Use the `tests/common` driver and fixtures. Assert state, not only pixels.
- A failed snapshot leaves `<name>.new.png` and `<name>.diff.png`. Read both before you re-record. A change in a shared area (status bar, top bar) re-records many snapshots. Check that the pixel difference stays inside the area you changed.
- `diagnostics` needs node, TypeScript 5 and 7, oxlint (`HARWEX_TEST_OXLINT`) and the ESLint tree (`HARWEX_TEST_ESLINT`). `lint_budget` needs ESLint and oxlint and prints the linter table with `--nocapture`.
- `navigation` needs node and TypeScript 5, `rust_nav` needs rust-analyzer and rust-src. All come from `cargo xtask test-tools` (`target/tools/`), or from `HARWEX_TEST_TS5`, `HARWEX_RUST_ANALYZER` and `RUST_SRC_PATH`. Tools on PATH or in rustup are not used. Missing tools print `skipping ...` and pass, so read the output for skips.
- `test_options()` gives no storage, no file watcher and a `zsh -f` terminal with the prompt `$ `. Use `MemoryStorage` for persistence tests. Never point a test at the user's storage.
- Fixtures live at fixed paths, so two processes that run the same test take turns on a lock file (`<suite>/<name>.lock`). A test that seems to hang may be waiting for another session's run.
- A real window run needs `HARWEX_IDE_BACKGROUND=1`, or a `--test-*` hook from `src/testhook.rs`. Use it only when the headless suites cannot cover the path (real repository smoke tests).

## Traps already hit

- An `egui::Area` offers its content only last frame's size. A list that starts with "Loading..." stays cut off. Ask for last frame's content height.
- A `TextEdit` that requests focus on the same frame never reports `lost_focus()`. Enter then does nothing. Re-focus only when the box did not just lose focus.
- `consume_key(NONE, F7)` ignores an extra Shift. Consume Shift+F7 first.
- A focus requested in a frame with an arrow press, while nothing had focus, is moved by egui's arrow navigation. Request the focus again on the next frame.
- The UI fonts are bundled Inter and JetBrains Mono (`assets/fonts/`). They have ⇧ ⌘ ⌥ ⏎, arrows, › and …. A symbol outside that set may draw as a box: add it to `theme::tests::fonts_cover_shortcut_symbols` before you use it.
- `std::fs::canonicalize` on the UI thread is a blocking call. Paths in state are already canonical.
- Clippy's `items_after_test_module`: the test module sits at the end of the file.
- A widget that keeps focus without a click sense (a tree, a table) must call `ui.interact(rect, id, Sense::focusable_noninteractive())` every frame. Otherwise egui drops the focus at the end of the frame.
- A layout above the status bar must use the frame's total margin, not the Area's last-frame size, or nested popups drift.
- egui drops a widget's focus when a press lands outside it, and a `focusable_noninteractive` widget never counts as hovered. A press inside it still drops the focus until the release. Re-request the focus on the press frame, after the `interact` call (see `tree::show`).
- A small click widget on top of a bigger one (a chevron on a row) steals clicks near its edge through the interact radius, and a double click on it reaches only it. Use one click widget and split it by the pointer position.
- egui reports no `clicked()` for a press held longer than its click time. Act on `is_pointer_button_down_on()` when a long press must still count.
- A `TopBottomPanel` stores its content height as its new height every frame. Content sized from a guess (the available height minus a fixed button height) moves the panel a few pixels per frame, and egui asks for no repaint. Make the content fill the panel exactly: add the bottom row first in a bottom-up layout, then give the rest to the box (see `git::changes::message_area`).
- In a bottom-up layout, `ui.horizontal` reserves only `interact_size.y`, so taller buttons grow down past the edge. Use `Layout::left_to_right(Align::Max)` for a bottom row.
- macOS puts the window buttons back at its default spot on resize, key-window changes, full screen exit and theme changes. `chrome::sync` re-applies them every frame, writes only when a frame differs, and asks for one more frame after a move.
- A row with `Sense::click_and_drag` under a click-only widget (the commit tree's checkbox) gets the drag, and the checkbox gets the click. In a virtualized list, find the drop row from the pointer y before the rows paint, so every target row can show the highlight.
- macOS turns ⌘X, ⌘C and ⌘V into `Event::Cut`, `Copy` and `Paste` with no key event, and sends `Paste` only when the clipboard holds text. ⇧⌘C is a `Copy` with Shift held. The tree reads both forms, and Cut/Copy put the name on the clipboard so ⌘V arrives. Tests push the events, not keys.
- The tree consumes Escape and the arrows while it has focus. While a context menu is open it must not (`ctx.is_context_menu_open()`), or Escape never closes the menu.
- A tree command that opens a dialog must not set the tree's `focus_pending`: the next frame the tree would take the focus back from the dialog's text box.
- rust-analyzer answers `willRenameFiles` with nothing for a short while after it reports `quiescent`. `RustService::retry_module` asks again while a declared module gets no edits.
- egui opens and closes its one context menu only inside the owner's `Response::context_menu` call. When the owner is not drawn (a virtualized row scrolled out, its tool window switched by a shortcut), the menu stays open and invisible: its old rect swallows every right-click below it and `is_context_menu_open()` stays true. `util::close_orphaned_context_menu` closes it at the end of each frame. Give menu rows ids that follow the item, not the position, or the menu moves to another row after a scroll.
- A row wider than its scroll viewport (`available_width().max(N)`) has a clipped part that takes no clicks, and the a11y rect still claims it.
- A click widget drawn over the editor's text area (the problems counts widget) must live in its own `egui::Area`. In the editor's layer the text area still counts as hovered and moves the caret on the same press.
- oxlint 1.77's language server panics (`disable_fix.rs:52`) on unsaved buffers in a repository with JS configs and `jsPlugins` (seen on `mono`, 3 of 3 edits; a JSON-config project does not crash). `OxlintSource` stops retrying after 3 crashes in a row until the settings change.
- typescript-eslint guesses a missing `tsconfigRootDir` from every config file that read `tseslint.configs` in the process. With two package configs loaded in one ESLint process, files of a config without `tsconfigRootDir` fail with "multiple candidate TSConfigRootDirs". `eslint_server.js` narrows the guess to the linted config before each lint; keep that.
- typescript-eslint builds one-shot programs (no updates after edits) when it infers a CLI run (`CI=true`, argv names the eslint bin). The ESLint server sets `TSESTREE_SINGLE_RUN=false`.
- `Ide::open_file` settles, so it waits out a first lint. A test that watches a cold start (the "ESLint: loading" label) opens the file with `state_mut().open_location` instead.
- `Ide::snapshot` fails when one more frame moves any widget ("the layout still moves without a repaint request"). Fix the layout. Extra settle frames only hide the drift.
