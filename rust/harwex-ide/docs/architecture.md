# Architecture rules

IntelliJ IDEA is slow because of its architecture, not because of one bug. These rules keep harwex-ide from repeating that architecture. The root `CLAUDE.md` lists them in short form. This file gives the full text and the way the code follows each rule.

A change that breaks a rule needs a written reason under "Recorded exceptions" at the end of this file.

## The rules

1. **The UI thread never waits.** No disk, git, process or language-server call runs on it. Work goes to a worker. The result comes back through a channel.
2. **No global locks.** IDEA has one read/write lock for the whole model, so one slow writer freezes everything. We share data through snapshots. A rope clone is cheap, and a worker reads its own copy.
3. **Language analysis lives in separate processes.** The compiler's own server does the work: tsserver or the TypeScript 7 native server, rust-analyzer, later gopls. We never write our own parser or type model for navigation. A server that hangs or grows too big can be killed and restarted without hurting the editor. Tree-sitter is used only for highlighting.
4. **No global index.** IDEA indexes the whole project plus every dependency and blocks features until indexing ends ("dumb mode"). We keep only a file-name index, and it respects `.gitignore`. The language server computes everything else on request.
5. **Lazy everything.** A language server starts only when a file of its language is opened. It stops after it has been idle for a while (default 10 minutes) and no file of its language is open. Opening a JS project never starts rust-analyzer.
6. **One server per toolchain, many projects inside it.** A TypeScript server starts once per TypeScript installation, not once per package. tsserver and the native server already manage many `tsconfig.json` projects in one process and share parsed files between them. rust-analyzer starts once per Cargo workspace. A server loads a project only when a file of that project is opened.
7. **The file system is the source of truth.** No VFS snapshot of the whole tree and no "Synchronizing files" on window focus. We watch with `notify` and update only what changed.
8. **No in-process plugins.** If extensions ever come, they run out of process, with a protocol between them and the editor.
9. **Speed has budgets in tests.** Keystroke, frame, startup and git status times have limits in the test suite. A regression fails the build instead of being noticed months later.
10. **Per-project overrides, no global modes.** An optional `.harwex/ide.toml` in the project root can turn languages off (`languages = ["ts"]`) or turn off heavy server features (for example `cargo check` on save in a huge repository). Without the file, the lazy rules above decide.

## How the code follows them

1. Background work goes through `state.jobs` (`app/src/jobs.rs`). Each language has a queue thread in `app/src/lang/` (`Bridge`). rust-analyzer requests run on their own threads once the queue reaches them. `LanguageServer::status()` reads cached maps only, so the status bar can call it every frame.
2. Each service keeps small maps of its own. `LspClient` has one state lock, and only the callers of that one server share it. Nothing holds a lock across a wait for a server answer.
3. tsserver, the TypeScript 7 server and rust-analyzer are child processes. A crashed server restarts on the next request and gets every open file back with its last editor text.
4. The only index is the file-name index in `app/src/search.rs`. rust-analyzer primes its own cache inside its own process.
5. A server starts with the first open file of its language (`rust_nav` asserts it). It stops after the idle timeout when none of its files is open (`rust_nav` tests it with 0.5 s). TypeScript servers get the same idle stop.
6. One rust-analyzer per Cargo workspace root. A dependency file (cargo registry, rust-src) goes to the server used last, so a jump into std keeps one server. `ide-ts` keeps one server per installation and project root.
7. The watcher (`app/src/watcher.rs`) batches events until 200 ms of quiet, or at most 1 s after the first event. `AppState` then reloads only the directories, editors and git state that the batch touches, and re-reads `.harwex/ide.toml` when it changed. rust-analyzer watches the files itself.
8. There are no plugins.
9. Asserted budgets: the `ide-editor` release benchmark and the warm Go to Declaration in `rust_nav` (< 500 ms). There is no cold-start budget for language servers, because the cold time depends on the workspace. See `docs/timings.md`.
10. `app/src/lang/config.rs` parses `.harwex/ide.toml`: `languages`, `idle_timeout_secs`, `[rust]` (`server`, `idle_timeout_secs`, `check_on_save`, `build_scripts`, `proc_macros`), `[rust.init]` and `[ts] idle_timeout_secs`. Problems become warning toasts and fall back to defaults.

## Recorded exceptions

- Rule 1: `on_exit` stops the language servers on the UI thread. Nothing waits for the UI at that point.
