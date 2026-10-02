# Backlog

One line per task. Details live in `tasks/<id>-<slug>.md`. A closed task loses its line and its file. An `[idea]` line is a known gap that nobody works on. It gets an id and a task file when someone picks it up.

## Ideas

Flaky:
- [idea] `git_changes::amend_with_cmd_enter` failed a snapshot once in a full run and passed alone and in the next run. Find the timing dependency. It also failed once under load in `cargo xtask clean-check` (commit box 1 px higher).

Memory indicator:
- [idea] Click on the RAM widget: "Restart language servers". Needs a `Languages` restart that re-opens the open files.

Editor:
- [idea] Multi-caret, bracket matching, auto-close, folding, soft wrap.
- [idea] Find and replace inside the editor.
- [idea] Make ropey break lines like the servers do. VT, FF and NEL shift TypeScript positions by one line.

Navigation and languages:
- [idea] Show diagnostics. TypeScript events and `publishDiagnostics` are dropped, and rust-analyzer runs with diagnostics off.
- [idea] Incremental `textChanges` / `didChange` instead of full text on every edit, for 100k-line files.
- [idea] Nav chooser previews and Find in Files columns read the unsaved buffer, not the disk. A BOM shifts Find in Files columns on line 1.
- [idea] Share unsaved edits between two TypeScript servers (two `node_modules/typescript` installs in one workspace).
- [idea] A Rust file outside any Cargo package gets no server.
- [idea] Search Everywhere for symbols and actions, not only files.
- [idea] Find in Files with regex, whole word and Unicode case folding.

Project tree and shell:
- [idea] Project tree: Select Opened File (`ProjectTree::reveal` exists, nothing calls it), keyboard navigation, create, rename and delete files.
- [idea] Show ignored files (like `node_modules`) in olive in the tree, like IDEA, instead of hiding them.
- [idea] Opening another folder with dirty tabs asks Save / Discard instead of refusing.
- [idea] Breadcrumb popups: speed search. Merge tabs: breadcrumbs. A selected directory with a git color stays dim on the selection.
- [idea] Startup under 300 ms on cold runs (eframe and wgpu setup dominate; try the glow backend). Add an app startup budget test (rule 9).
- [idea] Title bar: center the traffic lights in the taller bar (needs an `objc2` call).
- [idea] IDEA-style checkboxes, radio buttons and dialog layouts (push, stash, conflicts). Today they are egui widgets in theme colors.

Terminal:
- [idea] Terminal tabs: persist, rename, reorder.
- [idea] Terminal: kitty keyboard protocol, OSC 8 hyperlinks, scrollback search, bell indicator, a real bold face.
- [idea] Terminal color queries (OSC 4/10/11) answer the program's own OSC 4 overrides.

Git:
- [idea] Smart checkout: stash, checkout, unstash when local changes block a checkout.
- [idea] Diff tab: selection and copy, editing the right side, apply/revert hunk arrows, unified view, ignore whitespace, collapse unchanged runs.
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
- [idea] Cover with tests: the file watcher and the reload of unmodified editors, Cmd+Alt+S, Find in Files "Match case", running Stage, Unstage and Delete from the commit context menu, Commit and Push, force push, Fetch, branch rename and delete, running Checkout Revision, Revert and Cherry-Pick from the log, rebase conflict labels, per-block `>>` / `<<` and hand edits in the merge tab, "Show more" in toasts, terminal selection, copy and mouse reporting, horizontal scrolling in the diff and merge tabs.
