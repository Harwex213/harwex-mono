# Backlog

One line per task. Details live in `tasks/<id>-<slug>.md`. A closed task loses its line and its file. An `[idea]` line is a known gap that nobody works on. It gets an id and a task file when someone picks it up.


## Ideas

Git window:
- [idea] In a very narrow commit table the date column draws over the graph (`git_history/filter_bar_narrow.png`). Shrink or hide columns by priority.
- [idea] Create Patch asks for a path in a text box. Use a native save dialog through `state.platform`.
- [idea] Ref labels cut the HEAD commit message without an ellipsis (`Afte`). Truncate the message with `…` and collapse labels to `+N` earlier.
- [idea] The reference's vertical toolbar left of the branch tree and the `⋮` header menu are not built.

Project selector:
- [idea] Type-to-filter in the project selector.
- [idea] Grey out a recent project whose folder no longer exists (disk check on a worker).

Tooling:
- [idea] The workspace is not rustfmt-clean. Run `cargo fmt --all` once and add `cargo fmt --all --check` to "Done means" and to `cargo xtask clean-check`.

Project tree:
- [idea] Move by Cut+Paste or drag and drop updates imports without a preview dialog. Rename has one ("update N imports in M files", Cancel). Give moves the same preview.
- [idea] Multi-selection in Project (Cmd+click, Shift+click), so drag and drop and the context menu act on several items.

Commit window:
- [idea] Commit tree rows are `available_width().max(240)` wide inside `ScrollArea::both`, so in a narrow panel the clipped end of each row takes no clicks (same bug task 014 fixed in Project). Make rows exactly the viewport wide.
- [idea] Stage/Unstage (drop or menu) shows a success toast on every action, because it goes through `run_op`. IDEA is silent on success. Make stage/unstage success quiet; keep error toasts.

Memory indicator:
- [idea] Click on the RAM widget: "Restart language servers". Needs a `Languages` restart that re-opens the open files.

Editor:
- [idea] Bracket matching, auto-close, folding, soft wrap.
- [idea] Find and replace inside the editor.
- [idea] Make ropey break lines like the servers do. VT, FF and NEL shift TypeScript positions by one line.

Navigation and languages:
- [idea] Rust diagnostics: rust-analyzer runs with diagnostics off. Turn them on as a source in the diagnostics layer.
- [idea] Problems window: a "Project Errors" tab, quick fixes (oxlint and TS code actions) and Alt+Enter.
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
