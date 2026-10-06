# Backlog

One line per task. Details live in `tasks/<id>-<slug>.md`. A closed task loses its line and its file. An `[idea]` line is a known gap that nobody works on. It gets an id and a task file when someone picks it up.

Run at most 2–3 agents that build at once: on 2026-10-05 seven parallel cargo builds flooded macOS `syspolicyd` (Gatekeeper checks every new unsigned binary), every new process froze at `dyld_start`, and in the end WindowServer hung.

## Ideas

Diagnostics:
- [idea] Cmd+S in an editable diff tab (task 071) saves without oxfmt: `git/diff.rs` saves through its own path, not `format::save` (found in task 081).
- [idea] oxlint 1.77 panics in `disable_fix.rs:52` on every file with a `jsPlugins` diagnostic, and its LSP waits for tsgolint with no timeout. We work around both (quarantine, restart, type-aware fallback). File the upstream reports drafted in `oxlint-upstream.md` when the user decides.

Git window:
- [idea] In a very narrow commit table the date column draws over the graph (`git_history/filter_bar_narrow.png`). Shrink or hide columns by priority.
- [idea] Create Patch asks for a path in a text box. Use a native save dialog through `state.platform`.
- [idea] Ref labels cut the HEAD commit message without an ellipsis (`Afte`). Truncate the message with `…` and collapse labels to `+N` earlier.

Tooling:
- [idea] Two `cargo xtask test-tools` runs at once corrupt each other's downloads (shared `tools/.<name>.partial`). Take a lock or use a per-process partial name (found in task 083).
- [idea] Flaky: `xtask full_test::second_run_waits_until_the_first_ends` failed once under load (task 083).
- [idea] The workspace is not rustfmt-clean. Run `cargo fmt --all` once and add `cargo fmt --all --check` to "Done means" and to `cargo xtask clean-check`.

Commit window:
- [idea] Commit tree rows are `available_width().max(240)` wide inside `ScrollArea::both`, so in a narrow panel the clipped end of each row takes no clicks (same bug task 014 fixed in Project). Make rows exactly the viewport wide.
- [idea] Stage/Unstage (drop or menu) shows a success toast on every action, because it goes through `run_op`. IDEA is silent on success. Make stage/unstage success quiet; keep error toasts.

Navigation and languages:
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
- [idea] The editor has no file context menu (its right-click menu holds only code actions). IDEA puts file actions (Copy Path, Reveal, Rename File, Git → Annotate/History…) into the editor tab menu; reuse `tree_menu::file_menu` there (found in task 082).
- [idea] Show ignored files (like `node_modules`) in olive in the tree, like IDEA, instead of hiding them.
- [idea] Opening another folder with dirty tabs asks Save / Discard instead of refusing.

Terminal:
- [idea] Closing a terminal tab blocks the UI thread up to 200 ms: portable-pty's `kill` waits for the shell after SIGHUP (breaks rule 1). Move the kill to a worker (found in task 070).
- [idea] Terminal: kitty keyboard protocol, OSC 8 hyperlinks, scrollback search, bell indicator, a real bold face.
- [idea] Terminal color queries (OSC 4/10/11) answer the program's own OSC 4 overrides.

Git:
- [idea] Unstage takes 3.1 s on mono: libgit2 `rename_sources` + `reset_default` read the whole 108 MB index. `git reset -q -- <paths>` through the CLI is a candidate (found in task 067).
- [idea] Diff tab: apply/revert hunk arrows, unified view, ignore whitespace, collapse unchanged runs.
- [idea] Editable diff without an open tab: edits younger than the 500 ms autosave are lost on an immediate quit, and the diff tab shows no dirty mark (found in task 071).
- [idea] Commit window: changelists, Group By options, keyboard navigation, partial commit per hunk.
- [idea] Merge tab: syntax highlighting and word-level marks. Show line-ending-only changes, which `diff_texts` hides. Scroll the Result editor sideways to follow the caret.
- [idea] Git log: column resizing, date and user filter popups, multi-select, Show Diff with Working Tree.
- [idea] A conflicted merge shows an error toast next to the Conflicts dialog. Show a softer "Merge conflicts" notice like IDEA.
- [idea] Unstash dialog and stash diff list the untracked files from the stash's third parent.
- [idea] LFS-tracked text files: diff the smudged content, not the pointer text.
- [idea] File history and the log path filter follow renames on side branches.
- [idea] Submodule support (today they are excluded from status).
- [idea] A cached log walker. Paging re-walks from the tip, O(skip), which matters only past 100k commits.

Tests:
- [idea] Flaky: `git_window::push_non_current_branch_from_tree` failed 1 of 22 runs under load (seen in task 064). Not investigated.
- [idea] Cover with tests: the file watcher and the reload of unmodified editors, Cmd+Alt+S, Find in Files "Match case", running Stage, Unstage and Delete from the commit context menu, Commit and Push, force push, Fetch, branch rename and delete, running Checkout Revision, Revert and Cherry-Pick from the log, rebase conflict labels, per-block `>>` / `<<` and hand edits in the merge tab, "Show more" in toasts, terminal selection, copy and mouse reporting, horizontal scrolling in the diff and merge tabs.
