# App internals

Read this file when you add a panel, a custom tab, a Git UI action or a language to the app. The contracts that every app change needs are in `app/CLAUDE.md`. This file lists the extension points behind them.

## State and jobs

- `AppState` (`app/src/state.rs`) owns, among others, `git: GitInfo`, `git_ui`, `tabs`, `tree`, `layout`, `notifications`, `jobs`, `project`, `langs`, `nav`, `find`, `search`, `index`, `terminals` and `breadcrumbs`.
- `AppState` methods: `refresh_git()`, `open_location(path, Option<Position>, record_history)`, `save_tab(id, then_close)`, `save_all()`, `close_tab(id, force)`.
- `GitInfo` holds `repo: Option<Repo>`, the branch, `detached`, `status` (absolute path to `ChangeKind`), `changes: Vec<FileChange>` and `dirty_dirs`.
- `state.jobs` (`app/src/jobs.rs`): `spawn(label, work, done)`, `spawn_quiet(work, done)`, `post(f)`, `busy(label)`. The label shows next to the status bar spinner.
- `state.notifications`: `info`, `warn` and `error(title, body)` show a toast and log it. `log_only(level, title, body)` only logs it. For a git CLI result, use `CommandOutcome.stderr` as the body.
- `AppState::is_idle()` is true when no job, queued language command, git refresh, index build or debounce is pending. The test driver's `settle()` waits for it. A new debounce or worker must report itself there, or the tests race it.

## Tabs

- An editor tab is an `EditorTab`: `doc`, `view` (`EditorState`), `marks`, `annotations: Vec<String>` (an empty list hides the blame column), `invalidate_marks()`, `path` (canonical), `read_only` (set for library paths), `lang: Option<LangId>` and the crate-private `lsp_version` (the doc version the server has seen). Get one with `state.tabs.editor_mut(id)`.
- A custom tab implements `tabs::CustomTab`: `key`, `title`, `ui(&mut self, ui, &mut TabEnv)`, and optionally `tooltip`, `is_dirty`, `file_path`, `on_close`, `as_any_mut`. `state.tabs.open_custom(Box::new(tab))` opens it. A key that is already open activates the existing tab.
- A job delivers results to a custom tab through `state.tabs.custom_mut::<T>(key)`.
- Inside `ui`, `TabEnv` gives `jobs`, `notifications`, `project`, `git`, `tab_id`, `editor_theme` and `commands`. Push `AppCommand::OpenLocation`, `CloseTab`, `OpenCustomTab` or `RefreshGit`. The commands run after the frame.
- Existing custom tabs: the diff tab (`git/diff.rs`, keys `diff:wt:<rel>` and `diff:<oid>:<rel>`) and the merge tab (`git/conflicts/merge.rs`, key `merge:<path>`).

## Git UI

- `app/src/git/mod.rs` holds the hooks the shell calls: `open_branches_popup` (Ctrl+Shift+Backtick), `update_project_clicked` (Cmd+T), `push_clicked` (Cmd+Shift+K), `commit_tool_window`, `log_tool_window`, `on_editor_action`, `on_gutter_click`, `on_annotation_click`, `show_windows` (every frame after the panels: popups, dialogs) and `on_git_refreshed`.
- The modules: `changes.rs` (commit tool window), `diff.rs`, `editor_git.rs` (gutter popup, blame), `log.rs`, `branches.rs`, `remote.rs` (push, update, stash dialogs), `conflicts.rs` and `conflicts/merge.rs`.
- Entry points other modules call: `diff::open_worktree_diff`, `diff::open_commit_diff`, `log::show_file_history`, `remote::open_push_dialog`.
- `remote::run_op(state, title, ok_body, check_conflicts, work, then)` runs a git write on a worker. It shows a toast, calls `refresh_git()`, checks for conflicts when asked, and then calls `then(state, ok)`.
- The log reloads after a git refresh only when a ref moved. It compares a fingerprint of HEAD and all branch tips.

## Languages

- `app/src/lang/` is the language registry. `LangId { TypeScript, Rust }` has a `LanguageSpec` each: extensions, root markers, server description, request concurrency.
- The `LanguageServer` trait: `open`, `change`, `close`, `locations` (Declaration, Source, Type), `references`, `hover`, `rename_edits` and `file_references` (file renames and safe delete, with candidate files), `files_renamed` and `files_deleted`, `status`, `stop_idle`, `running`, `take_notice`, `configure`, `shutdown`.
- `Bridge` runs one queue thread per language. TypeScript keeps strict request order. A Rust request runs on its own thread once the queue reaches it, so a request that waits for indexing does not hold up the next one.
- Read-only library paths (`lang::is_library_path`): `node_modules`, `$CARGO_HOME/registry`, `$CARGO_HOME/git`, `$RUST_SRC_PATH` and any `lib/rustlib/src/rust/` path.
- rust-analyzer (`lang/rust.rs`): the lookup order is `rust.server` from `ide.toml`, `HARWEX_RUST_ANALYZER`, `PATH`, `~/.cargo/bin`, `rustup which rust-analyzer`. A candidate counts only if `--version` answers with `rust-analyzer`. The root is the topmost `Cargo.toml` with a `workspace` table, else the nearest `Cargo.toml`. The init options set `cargo.targetDir: true`, so rust-analyzer builds into its own `target/rust-analyzer` and never takes the lock of the user's `cargo build`. Diagnostics are off.
- rust-analyzer loading: `experimental/serverStatus` and `$/progress` feed a per-server status. An empty answer while the server is not quiescent waits for the next status change. "content modified" and "server cancelled" retry after 100 ms. Both stop at the 20 s request timeout.

## Diagnostics

- `app/src/diagnostics/`: `strategy.rs` (markers on disk, the pure `plan`), `oxlint.rs` (the oxlint `LintSource`), `eslint.rs` + `eslint_server.js` (the ESLint `LintSource` and the node script it runs with `node -e`), `problems.rs` (the counts widget, the hover text, the Problems tool window), `mod.rs` (`Problem`, `FileProblems` per editor tab, `LintQueue`, scheduling, F2).
- `EditorTab::problems` holds the plan, the last result per `SourceId` with the doc version it belongs to, and `marks` for `EditorView::problems`. `refresh(&doc)` shifts results through `Document::changes_since` once per version.
- `diagnostics::schedule` runs every frame: detection on a worker (cached per directory in `state.diagnostics`), then a request 300 ms after the last edit, or at once after a save (`force`). `FileProblems::pending` is part of `is_idle()`.
- TS requests: `LanguageServer::diagnostics` on the TypeScript bridge, after `nav::flush_lsp`. Lint requests: `state.langs.lint` (one thread, `LintCmd`). A request carries a generation; the queue skips one that is no longer the newest, and `deliver` drops a stale answer.
- A new linter: implement `LintSource`, add a `SourceId` and a `LintTarget` variant, extend `strategy::plan`. The UI needs no change. `LintQueue::counts(source)` gives the lint calls made and the stale requests skipped (tests check debounce with it).
- ESLint: `strategy::detect` finds the nearest config, the install and the TS project (`Markers::eslint_*`); `EslintPlan` carries the config dir and the root. The request is `textDocument/diagnostic` with an extra `harwex: {configDir, legacy}`. A cold (config dir, project) pair holds `jobs.busy("ESLint: loading <project>")` for the lint.

## Memory indicator

- `app/src/memory.rs`: a `memory sampler` thread walks the process tree from our pid every `[memory] interval_secs` and posts an `Arc<Sample>` to `state.memory.sample`. The status bar draws nothing until the first sample.
- Kinds: our own process is `Ide`. A direct child named `node`, `tsc`, `tsgo`, `*tsserver*` or `*rust-analyzer*` roots a `LanguageServer` subtree. Any other direct child roots an `Other` subtree. Descendants take the kind of their subtree root.
- Skipped subtrees: terminal shells (`Terminals::shell_pids`, sent to the thread when they change) and direct children named `git` or `git-*`. The walk never lists their children.
- `AppOptions::memory`: `Auto` (the OS source, off in deterministic mode), `Off`, `Real`, `Custom(Arc<dyn ProcessSource>)`. Tests pass a fake tree; its `now()` steps 15 s per sample, so CPU% is stable.
- `state.memory.sample_now()` asks for a sample at once. Tests wait for `sample.seq` to grow. The thread is not part of `is_idle()`.

## Theme and icons

- `app/src/theme.rs`: `theme::T` is one `static Theme`. It owns every color, `T.radius`, `T.space`, `T.font`, `T.badges`, `T.editor` (an `ide_editor::EditorTheme`) and `T.terminal` (an `ide_term::TerminalTheme`). The palette follows IDEA 2025 Islands Dark.
- `theme::install_fonts` bundles Inter Regular and SemiBold (UI) and JetBrains Mono Regular (editor, terminal, diff) from `app/assets/fonts/` with `include_bytes!`. egui's own fonts stay behind them as fallbacks. `theme::tests::fonts_cover_shortcut_symbols` asserts the shortcut glyphs (⇧ ⌘ ⌥ ⌃ ⏎ ⌫ ⎋, arrows, › … • ✓ ×).
- `app/src/icons.rs` draws line icons on a 16×16 grid from shapes that egui stores inline (segments, circles, rects, cubic Béziers). Icons need no textures, no SVG parsing and no allocation per frame. Keep new icons that way.
- The title bar is merged with the window chrome (`with_fullsize_content_view`) and leaves 78 px for the macOS traffic lights.
