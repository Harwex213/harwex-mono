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
- A popup that handles keys consumes them at the start of the frame (see `nav::take_popup_keys`, `breadcrumbs::take_keys`). Otherwise Enter and the arrows also reach the focused editor.
- New tool-window rows and hand-painted widgets need an accessibility label. The tests find widgets by label.
- Custom tabs (diff, merge) implement `tabs::CustomTab`. Use `CustomTab::file_path()` when the tab shows one file, so the breadcrumbs follow it.
- Problems in `.harwex/ide.toml` become warning toasts and fall back to defaults. They are never hard errors.
- The memory indicator (`memory.rs`) samples on its own thread and is not part of `is_idle()`. In deterministic mode the OS source is off, so live numbers never reach a snapshot. Tests pass `MemorySource::Custom` (see `docs/app-internals.md`).

## Test

```sh
cargo test -p harwex-ide                        # all suites, headless
cargo test -p harwex-ide --test git_history     # one suite
UPDATE_SNAPSHOTS=1 cargo test -p harwex-ide --test shell   # re-record, then Read the PNGs, delete *.old.png
```

- The suites in `tests/` drive the real `IdeApp` through `egui_kittest` with real pointer and key events. Read `docs/testing.md` before you add a test. Use the `tests/common` driver and fixtures. Assert state, not only pixels.
- A failed snapshot leaves `<name>.new.png` and `<name>.diff.png`. Read both before you re-record. A change in a shared area (status bar, top bar) re-records many snapshots. Check that the pixel difference stays inside the area you changed.
- `navigation` needs node and TypeScript 5, `rust_nav` needs rust-analyzer and rust-src. All come from `cargo xtask test-tools` (`target/tools/`), or from `HARWEX_TEST_TS5`, `HARWEX_RUST_ANALYZER` and `RUST_SRC_PATH`. Tools on PATH or in rustup are not used. Missing tools print `skipping ...` and pass, so read the output for skips.
- `test_options()` gives no storage, no file watcher and a `zsh -f` terminal with the prompt `$ `. Use `MemoryStorage` for persistence tests. Never point a test at the user's storage.
- A real window run needs `HARWEX_IDE_BACKGROUND=1`, or a `--test-*` hook from `src/testhook.rs`. Use it only when the headless suites cannot cover the path (real repository smoke tests).

## Traps already hit

- An `egui::Area` offers its content only last frame's size. A list that starts with "Loading..." stays cut off. Ask for last frame's content height.
- A `TextEdit` that requests focus on the same frame never reports `lost_focus()`. Enter then does nothing. Re-focus only when the box did not just lose focus.
- `consume_key(NONE, F7)` ignores an extra Shift. Consume Shift+F7 first.
- A focus requested in a frame with an arrow press, while nothing had focus, is moved by egui's arrow navigation. Request the focus again on the next frame.
- The UI fonts are bundled Inter and JetBrains Mono (`assets/fonts/`). They have ⇧ ⌘ ⌥ ⏎, arrows, › and …. A symbol outside that set may draw as a box: add it to `theme::tests::fonts_cover_shortcut_symbols` before you use it.
- `std::fs::canonicalize` on the UI thread is a blocking call. Paths in state are already canonical.
- Clippy's `items_after_test_module`: the test module sits at the end of the file.
- A layout above the status bar must use the frame's total margin, not the Area's last-frame size, or nested popups drift.
