# harwex-ide plan

A native IDE in Rust. Goals in priority order:

1. Speed. Opening a 100k-line file, scrolling and typing must stay at 120 fps. Startup must be under 300 ms.
2. Git management that feels like JetBrains IDEA.
3. Right-click "Go to Declaration" in JavaScript/TypeScript. The jump must also work into dependencies (`node_modules`, workspace packages, `.d.ts` and the real `.js` source).

Target platform is macOS (Apple Silicon). Linux should compile, but nobody tests it.

## Workspace layout

```
harwex-ide/
  Cargo.toml          workspace; egui/eframe are pinned once in [workspace.dependencies]
  app/                binary crate `harwex-ide`: window, layout, panels, wiring
  crates/ide-editor/  text buffer, highlighting, the egui editor widget
  crates/ide-git/     git logic, no UI
  crates/ide-ts/      tsserver client, no UI
  docs/plan.md        this file
```

Rules for every crate:

- Use `egui`/`eframe` only through `workspace = true`. Never add another version.
- `ide-git` and `ide-ts` never depend on egui. They are plain libraries with unit tests.
- No blocking work on the UI thread. Anything that touches disk, git or a child process runs on a worker thread. Results come back through a channel. The UI calls `ctx.request_repaint()` when a result arrives.
- Each crate must pass `cargo build -p <crate>`, `cargo test -p <crate>` and `cargo clippy -p <crate>` with no warnings.
- Code and comments are in English. Comments explain why, not what.
- Do not write README files.
- Do not commit. Do not run `git add`. Other sessions share this repository's index.

## ide-editor

Crates: `ropey` for the buffer, `tree-sitter` with `tree-sitter-typescript` (TS and TSX grammars) and `tree-sitter-javascript` for highlighting. Add grammars for JSON, Rust, CSS and Markdown if they are cheap to add.

Public API (the app relies on these names; extend freely, do not rename):

```rust
pub struct Document { /* rope, path, language, undo history, tree-sitter tree, dirty flag, version: u64 */ }
impl Document {
    pub fn open(path: &Path) -> std::io::Result<Document>;
    pub fn from_text(text: &str, language: Language) -> Document;
    pub fn save(&mut self) -> std::io::Result<()>;
    pub fn text(&self) -> String;          // full copy, used for tsserver sync
    pub fn version(&self) -> u64;          // increments on every edit
    pub fn is_dirty(&self) -> bool;
    pub fn path(&self) -> Option<&Path>;
    pub fn line_count(&self) -> usize;
}

pub enum Language { TypeScript, Tsx, JavaScript, Jsx, Json, Rust, Css, Markdown, Plain }
impl Language { pub fn from_path(path: &Path) -> Language; }

/// 0-based line, 0-based column in chars.
pub struct Position { pub line: usize, pub column: usize }

pub struct EditorState { /* cursor(s), selection, scroll, pending reveal */ }
impl EditorState {
    pub fn reveal(&mut self, pos: Position);   // move the cursor and scroll it to the center
}

/// Extra per-line marks drawn in the gutter (git change bars).
pub enum GutterMark { Added, Modified, Deleted }

pub struct EditorView<'a> { /* doc, state, gutter marks, theme */ }
impl<'a> EditorView<'a> {
    pub fn new(doc: &'a mut Document, state: &'a mut EditorState) -> Self;
    pub fn gutter_marks(self, marks: &'a [(usize, GutterMark)]) -> Self;
    pub fn show(self, ui: &mut egui::Ui) -> EditorResponse;
}

pub struct EditorResponse {
    pub changed: bool,
    /// Set when the user picked an item in the editor context menu or used its shortcut.
    pub action: Option<EditorAction>,
    /// The document position under the mouse, for hover info.
    pub hover: Option<Position>,
}

pub enum EditorAction {
    GoToDeclaration(Position),        // context menu, Cmd+B, Cmd+click
    GoToSourceDefinition(Position),   // context menu "Go to Source Definition" (real .js in node_modules)
    GoToTypeDefinition(Position),     // context menu
    FindUsages(Position),             // context menu, Alt+F7
    GitAnnotate,                      // context menu "Git > Annotate with Git Blame"
    GitShowHistory,                   // context menu "Git > Show History"
    GitRollbackLines,                 // context menu "Git > Rollback Lines" (only if lines changed)
}
```

Requirements:

- Render only the visible lines. Never build one galley for the whole file. Cache line galleys keyed by (line text hash, highlight version).
- Incremental tree-sitter reparse on every edit (`InputEdit`). Highlight only the visible range plus a margin.
- Monospace font, line numbers, current line highlight, gutter marks column, horizontal scroll for long lines.
- Editing: typing, Backspace/Delete, Enter with auto-indent, Tab/Shift+Tab indent, selection with mouse and Shift+arrows, word movement with Alt+arrows, Cmd+arrows for line start/end and file start/end, Cmd+A, Cmd+C/X/V, Cmd+Z / Cmd+Shift+Z undo/redo with edit grouping, Cmd+D duplicate line, Cmd+/ toggle line comment, double-click selects word.
- Right-click opens an egui context menu with the actions above, placed at the clicked position. Right-click moves the cursor to the clicked position first, like IDEA.
- Cmd+hover underlines the identifier under the mouse. Cmd+click emits `GoToDeclaration`.
- An example binary `examples/editor.rs` opens a file in a plain eframe window, so the widget can be tried alone.
- A benchmark test that opens a 200k-line generated TS file and edits it. Report the timings in the final message.

## ide-git

Crates: `git2` (libgit2, vendored-openssl off; use the `https` feature only if needed) for reads and local writes. Use the `git` CLI as a child process for network operations (`fetch`, `pull`, `push`) so the user's SSH keys, credential helpers and hooks work. Also use the CLI for `commit`, so commit hooks run.

Public API (all functions are blocking; the app calls them from a worker thread):

```rust
pub struct Repo { /* path to workdir */ }
impl Repo {
    pub fn discover(path: &Path) -> Result<Repo>;
    pub fn workdir(&self) -> &Path;

    // Changes / commit tool window
    pub fn status(&self) -> Result<Vec<FileChange>>;           // staged + unstaged + untracked, renames detected
    pub fn stage(&self, paths: &[PathBuf]) -> Result<()>;
    pub fn unstage(&self, paths: &[PathBuf]) -> Result<()>;
    pub fn rollback(&self, paths: &[PathBuf]) -> Result<()>;   // IDEA "Rollback": restore to HEAD, delete untracked-added
    pub fn commit(&self, message: &str, paths: &[PathBuf], amend: bool) -> Result<CommitOutcome>; // commits exactly `paths`
    pub fn last_commit_message(&self) -> Result<String>;       // for "Amend"

    // Diff
    pub fn diff_file(&self, path: &Path, side: DiffSide) -> Result<FileDiff>;  // side: HeadVsWorktree, HeadVsIndex, IndexVsWorktree
    pub fn diff_commit_file(&self, commit: &Oid, path: &Path) -> Result<FileDiff>;
    pub fn line_changes(&self, path: &Path, worktree_text: &str) -> Result<Vec<LineChange>>; // for gutter marks, HEAD vs current buffer
    pub fn rollback_lines(&self, path: &Path, worktree_text: &str, lines: Range<usize>) -> Result<String>; // returns new text

    // Log
    pub fn log(&self, filter: &LogFilter, skip: usize, limit: usize) -> Result<Vec<CommitInfo>>; // filter: branch, text, author, path
    pub fn graph(&self, commits: &[CommitInfo]) -> Vec<GraphRow>;  // lane layout for drawing the branch graph
    pub fn commit_details(&self, oid: &Oid) -> Result<CommitDetails>;  // message, author, date, changed files
    pub fn file_history(&self, path: &Path, limit: usize) -> Result<Vec<CommitInfo>>;
    pub fn blame(&self, path: &Path) -> Result<Vec<BlameLine>>;

    // Branches popup
    pub fn branches(&self) -> Result<Branches>;   // current, local (with ahead/behind of upstream), remote, recent
    pub fn checkout(&self, name: &str) -> Result<()>;
    pub fn create_branch(&self, name: &str, from: Option<&str>, checkout: bool) -> Result<()>;
    pub fn delete_branch(&self, name: &str, force: bool) -> Result<()>;
    pub fn rename_branch(&self, old: &str, new: &str) -> Result<()>;
    pub fn merge(&self, name: &str) -> Result<CommandOutcome>;   // CLI
    pub fn rebase(&self, onto: &str) -> Result<CommandOutcome>;  // CLI

    // Remote
    pub fn fetch(&self) -> Result<CommandOutcome>;
    pub fn pull(&self, rebase: bool) -> Result<CommandOutcome>;
    pub fn outgoing(&self) -> Result<Vec<CommitInfo>>;          // commits the push dialog will show
    pub fn push(&self, force_with_lease: bool, set_upstream: bool) -> Result<CommandOutcome>;

    // Stash (IDEA "Stash Changes" / "Unstash")
    pub fn stash_list(&self) -> Result<Vec<StashEntry>>;
    pub fn stash_save(&self, message: &str, include_untracked: bool) -> Result<()>;
    pub fn stash_apply(&self, index: usize, pop: bool) -> Result<CommandOutcome>;
    pub fn stash_drop(&self, index: usize) -> Result<()>;

    // Conflicts
    pub fn conflicts(&self) -> Result<Vec<PathBuf>>;
    pub fn conflict_sides(&self, path: &Path) -> Result<ConflictSides>; // base, ours, theirs text
    pub fn resolve(&self, path: &Path, text: &str) -> Result<()>;      // write result and stage it
}
```

`FileDiff` holds both full texts and a list of hunks with aligned line pairs, so the app can draw a side-by-side diff like IDEA. Compute line diffs with the `similar` crate (patience algorithm), plus word-level inline ranges for changed lines.

`CommandOutcome` carries success, stdout and stderr, so the app can show IDEA-style notifications.

Tests: build throwaway repositories in a temp dir (`tempfile`) and cover status, stage/unstage, commit of a subset, amend, rollback, rollback_lines, diff, log + graph with a merge, branches with ahead/behind, stash, conflict detection.

## ide-ts

Talks to TypeScript's own `tsserver` over stdio. Do not reimplement module resolution: tsserver already follows `paths`, `exports`, workspaces and `node_modules`.

Finding tsserver for a file: walk up from the file's directory and use the first `node_modules/typescript/lib/tsserver.js`. Fall back to a global `typescript` install found through `npm root -g`. Run it with `node`. Find `node` on `PATH`; on macOS a GUI app gets a minimal PATH, so also try the user's login shell (`$SHELL -lc 'command -v node'`), `~/.nvm/versions/node/*/bin/node` and `/opt/homebrew/bin/node`. Cache the result.

Protocol: requests are one JSON object per line on stdin. Responses and events arrive on stdout with a `Content-Length` header. One reader thread parses them and routes responses to waiting requests by `request_seq`.

Public API:

```rust
pub struct TsService { /* one tsserver process per tsserver.js path, started lazily */ }
impl TsService {
    pub fn new() -> TsService;
    pub fn open(&self, path: &Path, text: &str);                     // `open` with fileContent
    pub fn change(&self, path: &Path, text: &str);                   // full-text `updateOpen`; fine for now
    pub fn close(&self, path: &Path);
    pub fn definition(&self, path: &Path, line: usize, column: usize) -> Result<Vec<Location>>;        // `definitionAndBoundSpan`
    pub fn source_definition(&self, path: &Path, line: usize, column: usize) -> Result<Vec<Location>>; // `findSourceDefinition`, falls back to `definition`
    pub fn type_definition(&self, path: &Path, line: usize, column: usize) -> Result<Vec<Location>>;
    pub fn references(&self, path: &Path, line: usize, column: usize) -> Result<Vec<Reference>>;      // with the line text for a usages list
    pub fn quick_info(&self, path: &Path, line: usize, column: usize) -> Result<Option<QuickInfo>>;   // hover
    pub fn shutdown(&self);
}

pub struct Location { pub path: PathBuf, pub line: usize, pub column: usize }  // 0-based in this API
```

The API is 0-based. tsserver is 1-based for line and offset. Convert in one place. tsserver `offset` counts UTF-16 code units; the editor counts chars. Convert using the line text.

Every request has a timeout (default 5 s) and returns an error instead of hanging. If the process dies, the next request restarts it and re-opens the files that were open.

Tests: create a temp project with a `node_modules/fake-lib` package (a `package.json` with `types`, an `index.d.ts`, an `index.js`) and a `src/main.ts` that imports it. Use the `typescript` package from `/Users/aleh_kaportsau/Projects/harwex-mono/javascript/node_modules/typescript` by symlinking it into the temp project. Check that `definition` on the imported name lands in `index.d.ts`, that `source_definition` lands in `index.js`, and that a definition on a local import lands in the local file. Skip the tests with a message when node is not found.

## app (`harwex-ide` binary)

Layout like IDEA, dark theme (Darcula-like colors):

- Top bar: project name, current branch button (opens the branches popup), Update Project (pull), Commit, Push buttons.
- Left tool window strip with toggles: Project (file tree), Commit (changes), Find results.
- Bottom tool window strip: Git (log), Find Usages results, Notifications/Console.
- Center: editor tabs. Middle-click or Cmd+W closes a tab. A dirty tab shows a dot.
- Status bar: cursor line:column, language, git branch, background task spinner.

Behaviour:

- `harwex-ide <path>` opens a folder. With no argument it reopens the last folder (eframe persistence) or shows an "Open Folder" button (`rfd` file dialog).
- Project tree: lazy directory loading, respects `.gitignore` (`ignore` crate), git status colors on file names (blue modified, green added, red untracked, like IDEA). File watching with `notify` refreshes the tree and git status (debounced 200 ms).
- Search Everywhere: Shift Shift or Cmd+Shift+O opens a fuzzy file finder (`nucleo-matcher`) over all non-ignored files. Index in the background.
- Cmd+S saves. Cmd+Shift+F does a text search across the project in the background (`grep`-like using the `ignore` walker, results in the Find tool window).
- Navigation: `EditorAction::GoToDeclaration` calls `TsService::definition` on a worker thread. One result opens the file and reveals the position. Several results show a small popup list at the cursor. Navigation history with Cmd+[ and Cmd+] like IDEA (back/forward).
- Hover over an identifier for 500 ms shows `quick_info` in a tooltip.
- Find Usages fills the bottom tool window with grouped results; clicking a row navigates.

Git UI, modelled on IDEA:

- Commit tool window: tree of changed files grouped by directory, a checkbox on each file and directory, a commit message box, "Amend" checkbox (fills the last message), "Commit" and "Commit and Push…" buttons. Double-click a file opens a side-by-side diff in an editor tab. Right-click a file: Show Diff, Rollback, Jump to Source, Stage/Unstage, Delete. Unversioned files in their own group.
- Diff tab: side-by-side, synchronized scrolling, changed-line backgrounds, word-level highlights, connecting ribbons between the two sides, next/previous change buttons (F7 / Shift+F7).
- Git log tool window: branch graph with colored lanes, columns subject / author / date, filter boxes (text, branch, author), infinite scroll paging, right panel with the selected commit's changed files and details. Right-click a commit: Copy Revision Number, Checkout Revision, New Branch…, Reset Current Branch to Here…, Revert Commit, Cherry-Pick. Implement the ones `ide-git` supports and add the rest to `ide-git` if they are cheap.
- Branches popup: search field, Recent, Local, Remote groups. Each branch has a submenu: Checkout, New Branch from…, Merge into Current, Rebase Current onto…, Rename…, Delete. Ahead/behind arrows next to tracked branches.
- Push dialog: list of outgoing commits with their files, "Force push (with lease)" option, Push button.
- Update Project: pull with merge or rebase choice.
- Gutter change bars in the editor from `line_changes`, recomputed in the background after edits (debounced). Clicking a bar shows a small popup with the old text and a Rollback button.
- Annotate (blame) column in the editor gutter, toggled from the context menu.
- File history in the Git tool window from the context menu.
- Conflicts dialog after merge/rebase/pull: list of files, Accept Yours, Accept Theirs, Merge… (three-pane view: ours / result / theirs).
- Notifications: a toast in the bottom right for every git CLI command, with the stderr on failure.

## Phases

1. Libraries in parallel: `ide-editor`, `ide-git`, `ide-ts`. Each agent owns only its crate directory.
2. App shell: layout, project tree, tabs, editor integration, search, navigation through `ide-ts`.
3. Git UI on top of the shell.
4. Review: run the app against `/Users/aleh_kaportsau/Projects/harwex-mono` (a big real repo with a JS workspace under `javascript/`), fix what is broken, check speed.

Every phase ends by appending a short section to `docs/status.md`: what works, what is missing, known bugs, timings. The next phase reads that file first.

## ide-term (added later)

Integrated terminals, like IDEA's Terminal tool window. Several terminals at once, each in its own tab inside the bottom tool window.

- PTY: `portable-pty`. Spawn the user's login shell (`$SHELL -l`, fallback `/bin/zsh`) in the project root, with `TERM=xterm-256color` and `COLORTERM=truecolor`.
- Emulation: `alacritty_terminal` (grid, scrollback, VT parsing). Do not write a VT parser.
- The PTY reader runs on its own thread and feeds the emulator; the UI thread only draws the grid and calls `ctx.request_repaint()` when output arrives.
- Widget: draws only the visible rows with per-cell colors, bold/italic/underline, cursor, selection with the mouse, Cmd+C/Cmd+V, scrollback with the mouse wheel, resize sends the new size to the PTY. Keyboard: printable text, Enter, Backspace, Tab, arrows, Home/End, PageUp/PageDown, Ctrl+letter, Alt as Meta, bracketed paste. Cmd+K clears.
- Clickable `path:line:col` in the output opens the file (the widget only reports the click; the app opens the file).

Public API:

```rust
pub struct Terminal { /* pty, child, emulator, title */ }
impl Terminal {
    pub fn spawn(cwd: &Path, ctx: egui::Context) -> std::io::Result<Terminal>;
    pub fn title(&self) -> String;          // from OSC title, else the shell name
    pub fn is_alive(&self) -> bool;
    pub fn kill(&mut self);
}
pub struct TerminalView<'a> { /* terminal, font size, theme */ }
impl<'a> TerminalView<'a> {
    pub fn new(term: &'a mut Terminal) -> Self;
    pub fn show(self, ui: &mut egui::Ui) -> TerminalResponse;
}
pub struct TerminalResponse { pub open_path: Option<(PathBuf, Option<usize>, Option<usize>)> }
```

App side: the bottom tool window gets a "Terminal" tab strip with a "+" button. Alt+F12 toggles the Terminal tool window.

## Queued after the visual-test phase

1. **Open the cwd from a terminal.** `harwex-ide` with no argument opens the current directory when started from a terminal (cwd is not `/`, or stdin/stdout is a TTY). From Spotlight/Dock (cwd `/`) it keeps reopening the last folder. Explicit path arguments still win.
2. **Breadcrumbs in the status bar, like IDEA.** On the left of the status bar show the active file's path as segments: project root (with a folder icon) › dir › dir › file (with a file-type icon). Each directory segment is clickable and opens a popup listing that directory's children: directories first, then files, git status colors on names, the current child highlighted. Hovering or clicking a directory in the popup opens its children in a nested popup. Clicking a file opens it in the editor. Keyboard: arrows move, Enter opens, Escape closes. Directory listing runs on a worker and respects `.gitignore` like the project tree. Long paths collapse middle segments to `…`, which is also clickable. The breadcrumbs follow the active tab, including diff tabs (they show the diffed file).
Both need headless kittest tests with snapshots (see docs/testing.md) and a line in docs/usage.md.
