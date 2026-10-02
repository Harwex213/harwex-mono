# harwex-ide

A native IDE in Rust for macOS (Apple Silicon). It exists because IntelliJ IDEA is slow by architecture. The goals, in priority order:

1. Speed. A 100k-line file scrolls and types at 120 fps. Startup takes under 300 ms.
2. Git management that feels like JetBrains IDEA.
3. Go to Declaration in JS/TS and Rust, including jumps into dependencies (`node_modules`, `.d.ts`, the real `.js`, `~/.cargo/registry`, std).

Linux should compile, but nobody tests it.

Read first: this file, the `CLAUDE.md` of each crate you touch (its contract and traps), and your task file in `docs/tasks/`. Other docs, when the task needs them:
- `docs/architecture.md`: the full architecture rules, how the code follows them, and the recorded exceptions.
- `docs/testing.md`: headless UI tests, snapshots, fixtures, real-window smoke tests.
- `docs/timings.md`: the asserted speed budgets and reference numbers. Read it when you touch a hot path.
- `docs/usage.md`: the user manual (in Russian). Update it when a user-visible behaviour changes.

Open work is in `docs/backlog.md`, one line per task.

## Crates and their direction

- `app` (binary and library `harwex-ide`): window, panels, wiring. It depends on every crate below.
- `crates/ide-editor`: text buffer, highlighting, the egui editor widget.
- `crates/ide-term`: PTY plus terminal emulator, and the egui terminal widget.
- `crates/ide-git`: git logic. No UI.
- `crates/ide-ts`: the TypeScript server client. No UI. It uses `ide-lsp`.
- `crates/ide-lsp`: the generic LSP client. No UI and no language knowledge.
- `xtask`: `cargo install-ide` / `cargo uninstall-ide`, `cargo xtask test-tools` (pinned test tools) and `cargo xtask clean-check` (tests on a simulated clean machine).

`ide-git`, `ide-ts` and `ide-lsp` never depend on egui. Library crates never depend on `app`. egui and eframe come only from `[workspace.dependencies]` (`egui.workspace = true`). Never add a second egui version.

## Global rules

- Never block the UI thread. Disk, git, child processes and language-server calls run on a worker. The result comes back through a channel or `state.jobs`, and the UI calls `ctx.request_repaint()`.
- Never open a real IDE window without `HARWEX_IDE_BACKGROUND=1`. Any hidden `--test-*` flag also turns background mode on. A foreground window from an agent yanks the user to another macOS Space. Prefer the headless kittest suites; they open no window at all.
- Never run the `ide-editor` or `ide-term` examples. They open plain eframe windows and have no background mode.
- Never write to other repositories. This covers harwex-mono outside `rust/harwex-ide`. Tests never need another repository. Read-only checks there are fine. Do not run `yarn`, `npm install` or git writes in them. After a smoke run there, check with `find <repo> -newer <marker>` that nothing changed.
- Never touch `~/Library/Application Support/harwex-ide`. It holds the user's own IDE state. Background mode and the tests use their own storage.
- Never install toolchain components into `~/.rustup` or `~/.cargo`. Tests use the pinned tools that `cargo xtask test-tools` puts into `target/tools/` (see docs/testing.md).
- Do not commit and do not run `git add`. Other sessions share this repository's index.
- Do not write README files.
- Code and comments are in English. Comments explain why, not what. The JS/TS code style rules of harwex-mono do not apply here; rustfmt and clippy decide.
- A change that breaks an architecture rule needs a written reason under "Recorded exceptions" in `docs/architecture.md`.
- Never write an absolute user path (a home directory, a temp dir of this machine) into code, tests or docs. Name the env variable instead. `xtask/tests/no_machine_paths.rs` fails on home-directory and agent temp paths.

## Architecture rules (full text in docs/architecture.md)

1. The UI thread never waits.
2. No global locks. Share data through snapshots (a rope clone is cheap).
3. Language analysis lives in separate processes (tsserver, the TS 7 native server, rust-analyzer). Tree-sitter is used only for highlighting. Never write our own parser or type model for navigation.
4. No global index. The only index is the file-name index, and it respects `.gitignore`.
5. Lazy everything. A server starts with the first file of its language and stops after an idle timeout.
6. One server per toolchain: one TypeScript server per installation, one rust-analyzer per Cargo workspace.
7. The file system is the source of truth. Watch with `notify` and update only what changed.
8. No in-process plugins.
9. Speed has budgets in tests. A regression fails the build.
10. Per-project overrides live in `.harwex/ide.toml`. No global modes.

## Shared contracts

- Positions at every crate API are 0-based lines and 0-based columns in chars. Wire formats differ (tsserver is 1-based with UTF-16 offsets, LSP uses UTF-16 columns). Each crate converts in one place. `ide-term`'s `open_path` is the exception: it is 1-based as printed, so the app subtracts 1.
- Paths are canonical (`/var` becomes `/private/var`, symlinked workspace packages become their real path). Servers report real paths. Tabs are keyed by canonical path. Canonicalize on a worker, never on the UI thread.
- Library calls into `ide-git`, `ide-ts` and `ide-lsp` block. Call them only from worker threads.

## Done means

Every change ends with these two commands green, run from `rust/harwex-ide`:

```sh
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

A change to tests, fixtures or the tool lookup also needs `cargo xtask clean-check` green (zero failures, zero skips; `docs/testing.md`).

A UI change also needs its snapshots checked by eye (`docs/testing.md`, "Verify a UI change visually").

Log progress, timings and open problems in your task file's "Progress" section. Put a new contract or trap into the `CLAUDE.md` of its crate, short and without history. There is no project-wide status log.
