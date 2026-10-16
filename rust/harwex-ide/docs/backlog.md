# Backlog

One line per task. Details live in `tasks/<id>-<slug>.md`. A closed task loses its line and its file. An `[idea]` line is a known gap that nobody works on. It gets an id and a task file when someone picks it up.

Run at most 2–3 agents that build at once: on 2026-10-05 seven parallel cargo builds flooded macOS `syspolicyd` (Gatekeeper checks every new unsigned binary), every new process froze at `dyld_start`, and in the end WindowServer hung.

## Ideas

Windows (`docs/windows.md`):
- [idea] Windows: two title bars (the native one above ours). An undecorated window needs our own min/max/close buttons, `BeginResize` edges and the snap layouts.
- [idea] Windows: `test-tools` needs `shasum`/`tar`/`curl` replacements; `clean-check` uses macOS `sandbox-exec`; nextest has no pinned Windows binary.
- [idea] Windows: the app integration suites are not run (macOS snapshots, sh fixtures, directory symlinks need Developer Mode). ide-git: 44 pass; the 4 cancel tests are ignored (sh fake git) and need a Windows twin.
- [idea] Windows: Unreal source builds are registered in `HKCU\Software\Epic Games\Unreal Engine\Builds`, which is not read; `cpp::is_system_header` does not know MSVC/Windows Kits include dirs.
- [idea] Windows: AltGr reaches winit as Ctrl+Alt; check that text typed with AltGr (Polish, German layouts) is not dropped by the editor, diff and speed search.
- [idea] Windows: the terminal cannot read the foreground process's cwd (no process group in ConPTY), so relative links resolve against the spawn dir only.
- [idea] Windows: `fileops::apply_edits_on_disk` inserts LSP `newText` with `\n` into CRLF files; pushed diagnostics (`ide-lsp` client, clangd) are keyed by `uri_to_path` without `canonical`, so a server that changes component case misses the tab.
- [idea] Windows: rust-analyzer and clangd navigation are not smoke-tested (TS 5 tsserver and TS 7 native were, with jumps into `node_modules`).

Diagnostics:

Tooling:
- [idea] One save path (task 115) has no tests for the commit save (`take_all`), merge Cancel `write_back`, or backups of closed files edited by Replace in Files / Rename / moves.
- [idea] Flaky: `cpp_nav::find_usages_across_files` and `cpp_nav::rename_symbol_shows_a_preview_then_edits_every_file` fail in full `cargo xtask test` runs (clangd under load) but pass alone 9/9; seen in tasks 101 and 109.
- [idea] Flaky: `cancel::hung_annotate_is_cancelled_from_the_status_bar_and_runs_again` fails now and then under load ("Annotate failed" instead of a second "Cancelled"); seen in tasks 103 and 105.
- [idea] Settings: a server lookup error still names `.harwex/ide.toml` when the path came from the global `settings.toml`; a project cannot force Auto over a global value (TOML has no null) (found in task 104).
- [idea] Release bench `bench_10k_carets` misses its 8 ms Backspace budget now and then under load (8.5–10.9 ms with the occurrence update, 7.4–8.1 ms without). Rerun on a quiet machine (found in task 091).
- [idea] Two `cargo xtask test-tools` runs at once corrupt each other's downloads (shared `tools/.<name>.partial`). Take a lock or use a per-process partial name (found in task 083).
- [idea] Flaky: `xtask full_test::second_run_waits_until_the_first_ends` failed once under load (task 083).
- [idea] The workspace is not rustfmt-clean. Run `cargo fmt --all` once and add `cargo fmt --all --check` to "Done means" and to `cargo xtask clean-check`.

Commit window:
- [idea] Commit patches (task 114) do not save dirty editor tabs first (IDEA does); the Git window's Create Patch in `git/log.rs` still has its own dialog, move it onto `git/patch.rs`.
- [idea] Commit tree rows are `available_width().max(240)` wide inside `ScrollArea::both`, so in a narrow panel the clipped end of each row takes no clicks (same bug task 014 fixed in Project). Make rows exactly the viewport wide.
- [idea] Stage/Unstage (drop or menu) shows a success toast on every action, because it goes through `run_op`. IDEA is silent on success. Make stage/unstage success quiet; keep error toasts.

Navigation and languages:
- [idea] Find in Files: a case-insensitive non-ASCII query now goes to the regex path; its speed on mono is not measured. An all-ASCII query still misses Unicode folds like the Kelvin sign (found in task 103).
- [idea] Problems has single selection only; IDEA copies several selected rows (found in task 103).
- [idea] Find in Files on mono: a no-match search still reads all 500k files (16 s with 4 threads; rg 25.8 s). Only an index makes it instant: IDEA keeps a trigram index of file contents. Build one on a worker (persisted, updated from watcher batches), filter candidate files by the query's trigrams, then grep only those (found in task 099).
- [idea] The Find window shows only a spinner while it fills; stream results into it like the popup. Editing a `.gitignore` does not rebuild the file index (found in task 099).
- [idea] Inline-code background applies to every `Language::Plain` file, so backticks in shell scripts and Dockerfiles get it too; `Language` does not know the extension. Limit it to `.txt`/no extension. Code spans broken by a newline are not marked (found in task 094).
- [idea] The terminal never sets `PlatformOutput::ime`, so IME (dead keys, CJK) is off there and the input-source bubble sits at a stale rect (found in task 090).
- [idea] Opening an Unreal engine source tree itself as the project makes its `Engine/Source` files read-only: the engine-path check looks only at the path (found in task 085).
- [idea] Language servers for Java (JDT LS) and Kotlin (kotlin-lsp, weak). Java reuses the read-only virtual documents of task 084 for `jdt://` URIs. Discussed on 2026-10-05; highlighting only for now.
- [idea] Unreal headers: `class MYGAME_API AFoo : public AActor` parses as a function in tree-sitter-cpp, so `TArray<…>`, the base class and members stay uncolored inside such a class. A query tweak or a pre-pass that hides `*_API` would fix it.
- [idea] Grammars added 15.7 MB to the binary (Kotlin 5.8, C# 5.3, C++ 3.4). `tree-sitter-kotlin-ng` with our own highlight query would save ~2 MB.
- [idea] ide-lsp `kill_tree` can SIGKILL the group id of a server that `try_wait` already reaped; once the group is empty, that id could in theory belong to a new group. Skip the group kill after the leader is reaped (found in task 070).
- [idea] Rust diagnostics: rust-analyzer runs with diagnostics off. Turn them on as a source in the diagnostics layer.
- [idea] Incremental `textChanges` / `didChange` instead of full text on every edit, for 100k-line files.
- [idea] Nav chooser previews and Find in Files columns read the unsaved buffer, not the disk. A BOM shifts Find in Files columns on line 1.
- [idea] A Rust file outside any Cargo package gets no server.
- [idea] Search Everywhere for symbols and actions, not only files.

Project tree and shell:
- [idea] Settings (task 101) gaps: font size skips diff and preview views; no global soft-wrap default; removing a key from `ide.toml` also drops the comment above it.
- [idea] Viewers (task 095) gaps: image tabs are not restored after restart or by Cmd+Shift+T; preview mode is not persisted; animated GIF shows frame 1; SVG text not drawn. A binary `FileDiff` keeps both sides' raw bytes, check the memory on big binaries (cap by size).

Git:
- [idea] The full status on mono stays 12 s (startup, Refresh, Unstash): 9.8 s untracked walk + 2.1 s lstat. Only fsmonitor plus the untracked cache gets it near 1 s, and both need a written index (a private copy through `GIT_INDEX_FILE` in our cache, refreshed when the real index entries change) and, for fsmonitor, a daemon that writes into the user's `.git` (`-c core.fsmonitor=true`) or our own watcher as an fsmonitor hook (found in task 100).
- [idea] Unstage takes 3.1 s on mono: libgit2 `rename_sources` + `reset_default` read the whole 108 MB index. `git reset -q -- <paths>` through the CLI is a candidate (found in task 067).
- [idea] A cached log walker. Paging re-walks from the tip, O(skip), which matters only past 100k commits.

Tests:
- [idea] Flaky: `git_window::push_non_current_branch_from_tree` failed 1 of 22 runs under load (seen in task 064). Not investigated.
