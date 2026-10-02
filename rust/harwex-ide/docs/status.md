
## ide-ts

Checks (run from `rust/harwex-ide`): `cargo build -p ide-ts --all-targets`, `cargo test -p ide-ts` (11 unit + 6 integration tests) and `cargo clippy -p ide-ts --all-targets -- -D warnings` pass.

What works:

- Locating tsserver: walk up from the file's directory to the first `node_modules/typescript/lib/tsserver.js`. The fallback is a global install through `npm root -g`, using the npm next to the found node. Lookups are cached per directory.
- Locating node: `HARWEX_NODE` override, then `PATH`, then `$SHELL -lc` and `$SHELL -ilc 'command -v node'` (5 s kill timeout), then the newest `~/.nvm/versions/node/*/bin/node`, then `/opt/homebrew/bin/node`, `/usr/local/bin/node` and `~/.volta/bin/node`. The result is cached once per process. Verified with `env -i PATH=/usr/bin:/bin`: node is found through the login shell, and that lookup costs about 490 ms. The app should call `ide_ts::find_node()` once on a worker thread at startup to warm the cache.
- Protocol: one JSON line per request on stdin. A reader thread parses `Content-Length` frames (lengths in UTF-8 bytes) and routes each response to its waiter by `request_seq`. Events are ignored. The last 4 KB of stderr are kept for crash messages.
- One process per tsserver.js path, started lazily. Flags: `--disableAutomaticTypingAcquisition --suppressDiagnosticEvents --noGetErrOnBackgroundUpdate --locale en`, plus `--useInferredProjectPerProjectRoot` and `projectRootPath` (the directory that owns `node_modules/typescript`) for a local install. `configure` turns off `includePackageJsonAutoImports`.
- Every request has a timeout (default 5 s, `set_timeout`). A timeout returns `Error::Timeout`, and the late response is dropped without affecting later requests.
- Crash restart: a dead process is detected on the next call (reader EOF or `try_wait`). The next call spawns a new process and re-opens every open file with its last editor text, including unsaved edits. Waiters of a dying process fail at once with `Error::ServerDied(stderr tail)`.
- Position conversion lives in `src/position.rs` only: 0-based line and char column in the API, 1-based line and UTF-16 offset on the wire. Lines are split by TypeScript's rules (LF, CRLF, lone CR, U+2028, U+2029). Result positions are converted with the target file's text: the editor text for open files, the disk text otherwise.
- A position request on a file that was never opened opens it from disk, because tsserver answers "No Project" otherwise. Such files are re-read when their mtime changes.
- Paths are canonicalized (`/var` becomes `/private/var`, symlinked workspace packages become their real path), because tsserver reports real paths. The app should key its tabs by canonical path, or results will open a second tab for the same file.
- `source_definition` falls back to `definition` when `findSourceDefinition` returns nothing or fails with a server error (TS < 4.7).
- "No content available" (whitespace, keywords) returns `Ok(empty)` or `Ok(None)`, not an error.

Missing or known issues:

- `change` sends the full text on each edit (as the plan allows). Incremental `textChanges` would help with 100k-line files.
- tsserver events (project loading progress, diagnostics) are not exposed.
- `Reference::is_definition` comes from tsserver. TypeScript 5.9 leaves it `false` even for the declaration, so the app should not group by it.
- `definitionAndBoundSpan`'s `textSpan` (the span under the cursor) is not returned.
- A request holds the server's state lock while it writes to stdin. A very large `change` can briefly block other callers of the same server, never the UI thread if the app follows the worker-thread rule.

Public API (exact):

```rust
pub const DEFAULT_TIMEOUT: Duration; // 5 s
pub fn find_node() -> Option<PathBuf>;                       // cached
pub fn find_local_tsserver(dir: &Path) -> Option<PathBuf>;
pub fn find_global_tsserver() -> Option<PathBuf>;            // cached, `npm root -g`

#[derive(Clone)] // Send + Sync; clones share the processes
pub struct TsService { .. }
impl Default for TsService { .. }
impl TsService {
    pub fn new() -> TsService;
    pub fn set_timeout(&self, timeout: Duration);
    pub fn timeout(&self) -> Duration;
    pub fn open(&self, path: &Path, text: &str);
    pub fn change(&self, path: &Path, text: &str);   // opens the file if it is not open
    pub fn close(&self, path: &Path);
    pub fn definition(&self, path: &Path, line: usize, column: usize) -> Result<Vec<Location>>;
    pub fn source_definition(&self, path: &Path, line: usize, column: usize) -> Result<Vec<Location>>;
    pub fn type_definition(&self, path: &Path, line: usize, column: usize) -> Result<Vec<Location>>;
    pub fn references(&self, path: &Path, line: usize, column: usize) -> Result<Vec<Reference>>;
    pub fn quick_info(&self, path: &Path, line: usize, column: usize) -> Result<Option<QuickInfo>>;
    pub fn shutdown(&self);                          // the service stays usable; the next call restarts
    #[doc(hidden)] pub fn kill_server_for(&self, path: &Path); // tests only
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Location { pub path: PathBuf, pub line: usize, pub column: usize } // 0-based, chars

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reference {
    pub location: Location,
    pub end_line: usize,
    pub end_column: usize,
    pub line_text: String,   // the whole line, without the line break
    pub is_definition: bool,
    pub is_write: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuickInfo {
    pub kind: String, pub kind_modifiers: String,
    pub display: String, pub documentation: String,
    pub tags: Vec<QuickInfoTag>,
    pub line: usize, pub column: usize, pub end_line: usize, pub end_column: usize,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuickInfoTag { pub name: String, pub text: String }

#[derive(Debug)]
pub enum Error {
    NodeNotFound,
    TsServerNotFound(PathBuf),
    Spawn(std::io::Error),
    Io(PathBuf, std::io::Error),
    Timeout { command: String, after: Duration },
    ServerDied(String),
    Server(String),
}
pub type Result<T> = std::result::Result<T, Error>;
```

Timings (`cargo run -p ide-ts --example real_repo`, file `javascript/packages/projects/harwex-notes/harwex-notes-frontend/src/ui/app.tsx`, TypeScript 5.9.3, debug build, Apple Silicon):

| Request | Time | Lands in |
|---|---|---|
| first `definition` `useEffect` (spawn + project load) | 711 ms | `node_modules/@types/react/index.d.ts:1776:14` |
| first `source_definition` `useEffect` | 620 ms | `node_modules/react/cjs/react.production.js:495` and `react.development.js:1220` |
| `definition` `TAppRegistry` (workspace `@hw/harwex-notes-protocol`) | 0.7 ms | `packages/projects/harwex-notes/harwex-notes-protocol/src/registry.ts:87:6` (real source through the workspace symlink) |
| `definition` / `source_definition` `useSignals` | 0.9 ms / 0.6 ms | `@preact/signals-react/runtime/dist/index.d.ts:60:25` / `runtime/dist/runtime.mjs:1:1993` |
| `definition` `useStore` (local) | 0.4 ms | `src/store/store.ts:29:7` |
| repeat `definition` `useEffect` (warm) | 3.2 ms | the time is mostly re-reading the 170 KB `.d.ts` to convert columns |
| `references` `useEffect` / `quick_info` | 23 ms / 1.2 ms | 4 refs / `(alias) function useEffect(...)` |

The temp-project integration tests take about 0.5 s in total.

## ide-git

Checks (run from `rust/harwex-ide`): `cargo build -p ide-git --all-targets`, `cargo test -p ide-git` (5 unit + 20 integration tests, 1 ignored timing test) and `cargo clippy -p ide-git --all-targets -- -D warnings` pass. Dependencies: `git2 0.20` with `default-features = false` (no openssl, no ssh), `similar 2`, `tempfile` (dev).

What works:

- The whole plan API, plus extras for the log context menu and conflict flow (listed below).
- Reads use libgit2. Every write to the index or worktree (stage, rollback, commit, checkout, stash, reset, revert, cherry-pick, resolve) and every network command use the `git` CLI. The CLI runs hooks, credential helpers and clean/smudge filters. harwex-mono uses git-lfs, and libgit2 would write LFS pointer files. Only `unstage` uses libgit2, because it touches the index only.
- CLI env: `GIT_TERMINAL_PROMPT=0` (a missing credential fails and does not hang), `GIT_EDITOR=true` and `GIT_SEQUENCE_EDITOR=true` (merge, revert and rebase never wait for an editor), stdin is null. Paths are passed as `:(literal)` pathspecs in chunks of 500. `GIT_LITERAL_PATHSPECS` is not used because it breaks the cleanup in `git stash -u`. The git binary is found through `HARWEX_GIT`, then `PATH`, then `/opt/homebrew/bin`, `/usr/local/bin` and `/usr/bin`. A GUI app on macOS gets a minimal PATH.
- `Repo` stores only the canonical workdir and is `Send + Sync`. Each call opens its own `git2::Repository` (under 1 ms). Paths can be absolute (also through `/var` -> `/private/var` symlinks, and for deleted files) or relative to the workdir. Returned paths are relative to the workdir.
- `status`: untracked dirs are recursed, submodules are skipped, staged renames are detected (HEAD vs index only). Worktree renames are not detected: they show as deleted + unversioned, like IDEA. Reading the untracked files to detect them would cost too much. `FileChange::kind()` gives the combined HEAD-vs-worktree kind that IDEA shows.
- `commit` commits exactly `paths` through `git commit --only --pathspec-from-file=- --pathspec-file-nul --file=<msg>`. Other staged changes stay staged. New files are `git add`-ed first, because `--only` needs paths that git knows. The old side of a staged rename is added to the path list. During a merge, cherry-pick or revert, git forbids a partial commit, so the selection is staged and the whole index is committed. A rejected commit (hook failure, empty message) returns `Ok(CommitOutcome)` with `success() == false` and the stderr. Amend with no paths changes only the message.
- `rollback`: paths that exist in HEAD get `git checkout HEAD -- …` (index and worktree). Other paths are removed from the index and deleted from disk. The old side of a staged rename is restored too.
- Diff: `similar` patience line diff on lines without terminators, so CRLF and a missing final newline do not show as changes. Hunks hold only changed blocks. A block's lines are paired 1:1 (`Changed`), and the rest is `Deleted`/`Inserted`. Word ranges are char columns. They come from a token diff over the whole block (word runs, whitespace runs, single punctuation chars), for blocks of at most 400 lines. Line diff has a 1.5 s deadline. A NUL byte in the first 8000 bytes means binary: no texts and no hunks. A staged rename diffs against the old file (`old_path`).
- `line_changes`: HEAD vs the buffer. An unversioned file has no bars. A file that is new in the index is all `Added`. `Deleted` has an empty `lines` range at the line after the removed block. `rollback_lines` reverts every change that touches the range. An empty range means the caret line. A deletion is hit from either neighbouring line. Line endings are kept exactly.
- `log`: topological + time order. `LogFilter::default()` walks HEAD and all local and remote branches (IDEA "All"). Filters: branch/any revision, text (case-insensitive message, or hash prefix), author (name or email), path (tree-entry id compare, no blob reads; a merge is shown only if it differs from every parent), since/until. `skip` counts matching commits. `CommitInfo.refs` carries branch, remote and tag labels, and the detached `HEAD` label.
- `graph`: lanes with reuse of freed slots. The first parent continues straight in the node's lane. Merge parents open a new lane or join an existing one. Lines converge in the parent's row. Each row has `up` and `down` segments, so a virtualized list can draw one row alone. The `up` of row i equals the `down` of row i-1. Lines to parents outside the loaded page run straight down.
- `file_history` follows renames: when the file appears in a single-parent commit, the rename source is found and the walk continues with it. `file_history_with_paths` returns the path per commit for `diff_commit_file`.
- `blame` uses `git blame --porcelain`, which is much faster than libgit2 blame. Uncommitted lines have a zero oid. `blame_text` blames an unsaved buffer through `--contents -`.
- Branches: ahead/behind of the upstream, `origin/HEAD` is hidden, recent branches come from the HEAD reflog (`checkout: moving from`, up to 10, existing local branches only, without the current branch). `checkout("origin/x")` creates a local tracking `x`, or checks out `x` if it exists. A tag or hash gives a detached HEAD. `branches()` works on an unborn branch (current = its name, head = None).
- Remote: `fetch` = `fetch --all --prune`. `pull(rebase)` = `pull --rebase|--no-rebase`. `push` sends `HEAD:refs/heads/<upstream name>` to the upstream remote, or to the default remote (`origin`, else the first remote) under the same name. This avoids `push.default` failures. `outgoing` = HEAD minus the upstream, or minus all `refs/remotes` when there is no upstream (capped at 1000).
- Tested: status kinds incl. staged rename, stage/unstage (also deletions and an unborn repo), commit of a subset with other staged changes kept, commit of a rename, failing pre-commit hook, amend (message only and with content), rollback (modified, deleted, added, untracked, renamed), diff in all three sides + commit diff + binary + rename, line_changes + rollback_lines, log + filters + paging + graph with a merge, commit details, file history across a rename, blame, ahead/behind with fetch/pull/push against a bare remote, outgoing, push with set-upstream, remote-branch checkout, recent, create/rename/delete (merged and unmerged), revert, cherry-pick, reset soft/hard, checkout revision, stash save/list/pop/drop with untracked files, merge conflict detection + sides + resolve + accept theirs + continue, commit during a merge, rebase conflict + abort, empty repo.

Missing or known issues:

- Diffs read the raw blob for LFS-tracked files, so the HEAD side shows the LFS pointer text. This only matters for text files tracked by LFS.
- `log` paging re-walks from the tip on every page, so the cost is O(skip). It is 3 ms at skip 1000 on harwex-mono, which is fine. A cached walker would be needed for repositories with 100k+ commits.
- The path filter and `file_history` follow first-parent-like simplification only approximately. A rename on a side branch is not followed.
- No submodule support (they are excluded from status).
- `conflict_sides` gives no branch labels for ours/theirs (during a rebase, "ours" is the upstream).
- Stash diff: use `commit_details(&entry.oid)` and `diff_commit_file(&entry.oid, path)`. A stash commit's first parent is the HEAD at stash time. Untracked files stored in the third parent are not listed.

Timings on /Users/aleh_kaportsau/Projects/harwex-mono (9115 tracked files, 74 changed entries; release build; read-only; `cargo test -p ide-git --release --test large_repo -- --ignored --nocapture`):

- discover: 0.4 ms
- status: 343 ms cold first call, then 90–103 ms warm. For comparison, `GIT_OPTIONAL_LOCKS=0 git status --porcelain -uall` takes 73 ms.
- log first 200 (all branches): 8 ms. Page at skip 1000: 3 ms. Path-filtered log (50): 26 ms.
- graph of 152 rows: 13 µs.
- branches (5 local, 10 remote, with ahead/behind): 1.7 ms.

Public API (exact):

```rust
pub use git2::Oid;
pub type Result<T> = std::result::Result<T, Error>;
#[derive(Debug)]
pub enum Error { Git(git2::Error), Io(std::io::Error), Command(CommandOutcome), Other(String) } // Display + std::error::Error

#[derive(Debug, Clone)] // Send + Sync
pub struct Repo { .. }
impl Repo {
    pub fn discover(path: &Path) -> Result<Repo>;
    pub fn workdir(&self) -> &Path;

    // Changes / commit
    pub fn status(&self) -> Result<Vec<FileChange>>;
    pub fn status_of(&self, paths: &[PathBuf]) -> Result<Vec<FileChange>>;
    pub fn stage(&self, paths: &[PathBuf]) -> Result<()>;
    pub fn unstage(&self, paths: &[PathBuf]) -> Result<()>;
    pub fn rollback(&self, paths: &[PathBuf]) -> Result<()>;
    pub fn commit(&self, message: &str, paths: &[PathBuf], amend: bool) -> Result<CommitOutcome>;
    pub fn last_commit_message(&self) -> Result<String>;

    // Diff
    pub fn diff_file(&self, path: &Path, side: DiffSide) -> Result<FileDiff>;
    pub fn diff_commit_file(&self, commit: &Oid, path: &Path) -> Result<FileDiff>;
    pub fn line_changes(&self, path: &Path, worktree_text: &str) -> Result<Vec<LineChange>>;
    pub fn rollback_lines(&self, path: &Path, worktree_text: &str, lines: Range<usize>) -> Result<String>;

    // Log
    pub fn log(&self, filter: &LogFilter, skip: usize, limit: usize) -> Result<Vec<CommitInfo>>;
    pub fn graph(&self, commits: &[CommitInfo]) -> Vec<GraphRow>;
    pub fn commit_details(&self, oid: &Oid) -> Result<CommitDetails>;
    pub fn file_history(&self, path: &Path, limit: usize) -> Result<Vec<CommitInfo>>;
    pub fn file_history_with_paths(&self, path: &Path, limit: usize) -> Result<Vec<(CommitInfo, PathBuf)>>;
    pub fn blame(&self, path: &Path) -> Result<Vec<BlameLine>>;
    pub fn blame_text(&self, path: &Path, text: &str) -> Result<Vec<BlameLine>>;

    // Log context menu
    pub fn checkout_revision(&self, oid: &Oid) -> Result<()>;                  // detached HEAD
    pub fn reset(&self, oid: &Oid, mode: ResetMode) -> Result<CommandOutcome>;
    pub fn revert(&self, oid: &Oid) -> Result<CommandOutcome>;                 // -m 1 for merges
    pub fn cherry_pick(&self, oid: &Oid) -> Result<CommandOutcome>;            // -m 1 for merges

    // Branches
    pub fn branches(&self) -> Result<Branches>;
    pub fn checkout(&self, name: &str) -> Result<()>;
    pub fn create_branch(&self, name: &str, from: Option<&str>, checkout: bool) -> Result<()>;
    pub fn delete_branch(&self, name: &str, force: bool) -> Result<()>;
    pub fn delete_remote_branch(&self, name: &str) -> Result<CommandOutcome>;  // "origin/x"
    pub fn rename_branch(&self, old: &str, new: &str) -> Result<()>;
    pub fn merge(&self, name: &str) -> Result<CommandOutcome>;
    pub fn rebase(&self, onto: &str) -> Result<CommandOutcome>;

    // Remote
    pub fn fetch(&self) -> Result<CommandOutcome>;
    pub fn pull(&self, rebase: bool) -> Result<CommandOutcome>;
    pub fn outgoing(&self) -> Result<Vec<CommitInfo>>;
    pub fn push(&self, force_with_lease: bool, set_upstream: bool) -> Result<CommandOutcome>;

    // Stash
    pub fn stash_list(&self) -> Result<Vec<StashEntry>>;
    pub fn stash_save(&self, message: &str, include_untracked: bool) -> Result<()>;
    pub fn stash_apply(&self, index: usize, pop: bool) -> Result<CommandOutcome>;
    pub fn stash_apply_with(&self, index: usize, pop: bool, reinstate_index: bool) -> Result<CommandOutcome>;
    pub fn stash_drop(&self, index: usize) -> Result<()>;

    // Conflicts and operations in progress
    pub fn conflicts(&self) -> Result<Vec<PathBuf>>;
    pub fn conflict_sides(&self, path: &Path) -> Result<ConflictSides>;
    pub fn resolve(&self, path: &Path, text: &str) -> Result<()>;
    pub fn resolve_with(&self, path: &Path, choice: ConflictChoice) -> Result<()>;
    pub fn state(&self) -> Result<RepoState>;
    pub fn abort_operation(&self) -> Result<CommandOutcome>;     // merge/rebase/cherry-pick/revert --abort
    pub fn continue_operation(&self) -> Result<CommandOutcome>;  // commit --no-edit / rebase|cherry-pick|revert --continue
}

// Pure helpers (no repository)
pub fn diff_texts(old_text: &str, new_text: &str) -> Vec<DiffHunk>;
pub fn line_changes_between(old_text: &str, new_text: &str) -> Vec<LineChange>;
pub fn graph_layout(commits: &[CommitInfo]) -> Vec<GraphRow>;

pub struct CommandOutcome { pub success: bool, pub code: Option<i32>, pub command: String, pub stdout: String, pub stderr: String }
impl CommandOutcome { pub fn into_result(self) -> Result<CommandOutcome>; }

pub enum ChangeKind { Added, Modified, Deleted, Renamed, TypeChange, Untracked, Conflicted }
pub struct FileChange { pub path: PathBuf, pub old_path: Option<PathBuf>, pub staged: Option<ChangeKind>, pub unstaged: Option<ChangeKind> }
impl FileChange { pub fn kind(&self) -> ChangeKind; pub fn is_untracked(&self) -> bool; }
pub struct CommitOutcome { pub oid: Option<Oid>, pub output: CommandOutcome }
impl CommitOutcome { pub fn success(&self) -> bool; }

pub enum DiffSide { HeadVsWorktree, HeadVsIndex, IndexVsWorktree }
pub struct FileDiff { pub path: PathBuf, pub old_path: Option<PathBuf>, pub old_text: String, pub new_text: String,
                      pub old_exists: bool, pub new_exists: bool, pub binary: bool, pub hunks: Vec<DiffHunk> }
pub struct DiffHunk { pub old_lines: Range<usize>, pub new_lines: Range<usize>, pub pairs: Vec<LinePair> }
pub enum LineKind { Changed, Deleted, Inserted }
pub struct LinePair { pub kind: LineKind, pub old: Option<usize>, pub new: Option<usize>,
                      pub old_inline: Vec<Range<usize>>, pub new_inline: Vec<Range<usize>> }   // char columns
pub enum LineChangeKind { Added, Modified, Deleted }
pub struct LineChange { pub kind: LineChangeKind, pub lines: Range<usize>, pub old_lines: Range<usize>, pub old_text: String }

#[derive(Default)]
pub struct LogFilter { pub branch: Option<String>, pub text: Option<String>, pub author: Option<String>,
                       pub path: Option<PathBuf>, pub since: Option<i64>, pub until: Option<i64> }
pub enum RefKind { Head, LocalBranch, RemoteBranch, Tag }
pub struct RefLabel { pub name: String, pub kind: RefKind, pub is_current: bool }
pub struct CommitInfo { pub oid: Oid, pub parents: Vec<Oid>, pub summary: String, pub author_name: String, pub author_email: String,
                        pub author_time: i64, pub author_offset_minutes: i32, pub committer_time: i64, pub refs: Vec<RefLabel> }
pub struct ChangedFile { pub path: PathBuf, pub old_path: Option<PathBuf>, pub kind: ChangeKind }
pub struct CommitDetails { pub info: CommitInfo, pub message: String, pub committer_name: String, pub committer_email: String, pub files: Vec<ChangedFile> }
pub struct BlameLine { pub line: usize, pub oid: Oid, pub author: String, pub author_email: String, pub author_time: i64,
                       pub summary: String, pub original_line: usize }   // 0-based lines, zero oid = not committed
pub struct GraphEdge { pub from: usize, pub to: usize, pub color: usize }   // from = lane in upper row, to = lane in lower row
pub struct GraphRow { pub lane: usize, pub color: usize, pub up: Vec<GraphEdge>, pub down: Vec<GraphEdge>, pub width: usize }

pub struct BranchInfo { pub name: String, pub oid: Oid, pub upstream: Option<String>, pub ahead: usize, pub behind: usize,
                        pub is_current: bool, pub tip_time: i64 }
#[derive(Default)]
pub struct Branches { pub current: Option<String>, pub head: Option<Oid>, pub detached: bool,
                      pub local: Vec<BranchInfo>, pub remote: Vec<BranchInfo>, pub recent: Vec<String> }

pub struct StashEntry { pub index: usize, pub message: String, pub oid: Oid, pub time: i64 }
pub struct ConflictSides { pub path: PathBuf, pub base: Option<String>, pub ours: Option<String>, pub theirs: Option<String>, pub binary: bool }
pub enum ConflictChoice { Ours, Theirs }
pub enum ResetMode { Soft, Mixed, Hard }
pub enum RepoState { Clean, Merge, Rebase, CherryPick, Revert, Bisect, Other }
```

All types except `Error` derive `Debug, Clone`. The data types also derive `PartialEq, Eq`, except `FileDiff`, `CommitDetails` and `CommitOutcome`. The kind/mode enums are `Copy`.

## ide-editor

Crate `crates/ide-editor`. Dependencies: ropey 1.6 (built with only `simd`, so lines break on `\n` only and agree with tree-sitter and git), tree-sitter 0.27, tree-sitter-typescript 0.23 (TS + TSX), tree-sitter-javascript 0.25, json 0.24, rust 0.24, css 0.25, md 0.5 (block grammar only), `egui.workspace`. Dev-dependency: `eframe.workspace`. No workspace changes needed.

### What works
- `Document`: ropey buffer, open/save/save_as/reload, CRLF and BOM kept on save, lossy UTF-8 decode, indent detection (tabs or 2/4/8 spaces), `version` incremented on every edit, dirty flag tied to the undo stack (undoing back to the saved state is clean again).
- Undo/redo with grouping. Typing groups by word, deletes group together, and a group ends after 1.2 s, after a caret jump or after a save. Each undo step restores the selection.
- Tree-sitter: every edit sends an `InputEdit` to the tree, and the reparse waits until the next highlight request (a burst of edits costs one parse). Files over 256 KB are parsed on a worker thread, both at open and after edits. Until the new tree arrives, the edited old tree keeps highlighting. Edits made during the parse are replayed on the tree when it lands. Files over 32 MB get no tree.
- Highlighting queries only the visible lines plus one screen of margin (at least 60 lines). It uses the grammar crates' own highlights queries (TS = JS + TS, TSX = JS + JSX + TS). A pattern that does not compile is dropped instead of disabling the language (no pattern is dropped with the current versions).
- `EditorView` widget: virtualized. Only visible lines are laid out. Line galleys are cached by hash(text, spans, window, font size, theme), so the cache survives edits above. Lines over 2000 columns are laid out in 1024-column windows. Monospace column math with tab expansion (tab = 4). Line numbers, current line highlight, gutter change marks (Added/Modified bar, Deleted triangle), optional annotation (blame) column, horizontal + vertical scroll (egui ScrollArea), caret kept in view, `reveal` centers.
- Keys: typing, Backspace (back to the previous indent stop inside leading spaces), Delete, Alt+Backspace/Delete (word), Cmd+Backspace (delete line, IDEA), Enter with auto-indent (extra level after `{[(` and splitting `{}`), Shift+Enter, Tab / Shift+Tab (indent/dedent the selected lines), typing `}` on a blank line dedents, Shift+arrows, Alt+Left/Right word moves, Cmd+Left (smart home)/Right, Cmd+Up/Down, Home/End, PageUp/PageDown, Cmd+A, Cmd+C/X/V (copy and cut take the whole line when nothing is selected), Cmd+Z / Cmd+Shift+Z (Ctrl+Y off macOS), Cmd+D (duplicate line or selection), Cmd+/ (line comment; CSS uses `/* */`), Escape, Cmd+B → GoToDeclaration, Cmd+Shift+B → GoToTypeDefinition, Alt+F7 → FindUsages.
- Mouse: click, Shift+click, drag-select with auto-scroll, double-click selects a word, triple-click selects a line. Right-click first moves the caret (and keeps the selection when the click is inside it). Then it opens a context menu at the pointer: Go to Declaration, Go to Source Definition, Go to Type Definition, Find Usages, Cut/Copy/Paste, Comment, and Git > Annotate / Show History / Rollback Lines. Rollback Lines is enabled only when a gutter mark is on the selected lines. Cmd+hover underlines the identifier and shows a hand cursor. Cmd+click emits `GoToDeclaration`. A gutter click is reported.
- `examples/editor.rs` (demo marks, status bar with cursor, hover position and frame time; Cmd+S saves). Checked on `typescript.d.ts` (11k lines): it renders with colors and opens in 17 ms.
- Tests: 9 unit tests, 9 document/highlight tests and 1 benchmark test.

### Missing / known limits
- Only one cursor (no multi-caret). No bracket matching, auto-close, folding, soft wrap, find/replace inside the editor, or IME composition (only plain text events).
- Column math assumes one cell per char. Emoji and CJK glyphs get misaligned.
- Markdown highlights blocks only (no inline emphasis or links). No language injections (CSS-in-JS, code fences).
- The cursor does not blink (on purpose, so idle frames are free).
- When an edit lands in a big file, the colors near it can be one parse behind (~18 ms on 200k lines) before they update.
- Paste from the context menu goes through `ViewportCommand::RequestPaste`, so it arrives one frame later.

### Public API (exact)
```rust
pub enum Language { TypeScript, Tsx, JavaScript, Jsx, Json, Rust, Css, Markdown, Plain }
impl Language {
    pub fn from_path(path: &Path) -> Language;
    pub fn name(self) -> &'static str;
    pub fn comment_tokens(self) -> Option<(&'static str, &'static str)>;
}
pub struct Position { pub line: usize, pub column: usize }   // 0-based, column in chars
impl Position { pub fn new(line: usize, column: usize) -> Position; }
pub struct Selection { pub anchor: usize, pub head: usize } // char indices
impl Selection { pub fn caret(at: usize) -> Selection; pub fn new(anchor: usize, head: usize) -> Selection;
    pub fn is_empty(&self) -> bool; pub fn start(&self) -> usize; pub fn end(&self) -> usize; pub fn range(&self) -> Range<usize>; }
pub enum EditKind { Insert, Delete, Other }
pub struct Indent { pub use_tabs: bool, pub width: usize }
impl Indent { pub fn unit(&self) -> String; }

pub struct Document { .. }   // Send
impl Document {
    pub fn open(path: &Path) -> std::io::Result<Document>;
    pub fn from_text(text: &str, language: Language) -> Document;
    pub fn save(&mut self) -> std::io::Result<()>;
    pub fn save_as(&mut self, path: &Path) -> std::io::Result<()>;
    pub fn reload(&mut self) -> std::io::Result<()>;
    pub fn text(&self) -> String;
    pub fn version(&self) -> u64;
    pub fn is_dirty(&self) -> bool;
    pub fn path(&self) -> Option<&Path>;
    pub fn language(&self) -> Language;
    pub fn indent(&self) -> Indent;
    pub fn rope(&self) -> &Rope;
    pub fn line_count(&self) -> usize;
    pub fn len_chars(&self) -> usize;
    pub fn line_len(&self, line: usize) -> usize;
    pub fn line(&self, line: usize) -> String;
    pub fn line_start(&self, line: usize) -> usize;
    pub fn line_end(&self, line: usize) -> usize;
    pub fn char_to_position(&self, idx: usize) -> Position;
    pub fn position_to_char(&self, pos: Position) -> usize;
    pub fn slice(&self, range: Range<usize>) -> String;
    pub fn char_at(&self, idx: usize) -> Option<char>;
    pub fn word_at(&self, pos: Position) -> Option<Range<Position>>;
    pub fn edit(&mut self, range: Range<usize>, text: &str, before: Selection, after: Selection, kind: EditKind);
    pub fn transact(&mut self, edits: Vec<(Range<usize>, String)>, before: Selection, after: Selection, kind: EditKind);
    pub fn replace(&mut self, start: Position, end: Position, text: &str);
    pub fn set_text(&mut self, text: &str);
    pub fn undo(&mut self) -> Option<Selection>;
    pub fn redo(&mut self) -> Option<Selection>;
    pub fn can_undo(&self) -> bool;
    pub fn can_redo(&self) -> bool;
    pub fn seal_undo_group(&mut self);
    pub fn syntax_ready(&mut self) -> bool;
    pub fn wait_syntax(&mut self);
    pub fn highlight_version(&self) -> (u64, u64);
    pub fn highlight(&mut self, lines: Range<usize>) -> Vec<Vec<Span>>;
    pub fn syntax_tree(&mut self) -> Option<&Tree>;
}
pub enum HlKind { None, Keyword, String, Escape, Number, Comment, DocComment, Function, Macro, Type, Property,
                  Constant, Builtin, Variable, Parameter, Operator, Punctuation, Tag, Attribute, Title, Link }
pub struct Span { pub start: u32, pub end: u32, pub kind: HlKind }   // byte offsets within the line

pub enum GutterMark { Added, Modified, Deleted }
pub enum EditorAction { GoToDeclaration(Position), GoToSourceDefinition(Position), GoToTypeDefinition(Position),
                        FindUsages(Position), GitAnnotate, GitShowHistory, GitRollbackLines }
pub struct EditorResponse {
    pub changed: bool,
    pub action: Option<EditorAction>,
    pub hover: Option<Position>,
    pub gutter_clicked: Option<usize>,
    pub annotation_clicked: Option<usize>,
    pub cursor: Position,
    pub has_focus: bool,
    pub response: egui::Response,
}
pub struct EditorTheme { pub background, foreground, gutter_background, gutter_separator, line_number, line_number_current,
    current_line, selection, caret, link, annotation, mark_added, mark_modified, mark_deleted: Color32,
    pub kinds: [Color32; HlKind::COUNT] }
impl EditorTheme { pub fn darcula() -> EditorTheme; pub fn color(&self, kind: HlKind) -> Color32; }  // Default = darcula

pub struct EditorState { .. }   // Default, Send
impl EditorState {
    pub fn new() -> EditorState;
    pub fn reveal(&mut self, pos: Position);
    pub fn cursor(&self) -> Position;
    pub fn selection(&self) -> Selection;
    pub fn set_selection(&mut self, anchor: Position, head: Position);
    pub fn request_focus(&mut self);
    pub fn scroll_offset(&self) -> Vec2;
    pub fn clear_caches(&mut self);
}
pub struct EditorView<'a> { .. }
impl<'a> EditorView<'a> {
    pub fn new(doc: &'a mut Document, state: &'a mut EditorState) -> Self;
    pub fn gutter_marks(self, marks: &'a [(usize, GutterMark)]) -> Self;
    pub fn annotations(self, annotations: &'a [String]) -> Self;   // indexed by line; empty hides the column
    pub fn theme(self, theme: &'a EditorTheme) -> Self;
    pub fn font_size(self, size: f32) -> Self;                     // default 13
    pub fn show(self, ui: &mut egui::Ui) -> EditorResponse;
}
pub mod editing;   // egui-free commands: newline, tab, dedent, toggle_comment, duplicate, word_left/right, ...
```
App notes: one `EditorState` per tab. `EditorView` fills `ui.available_rect_before_wrap()`. Call `state.request_focus()` after opening a tab. `hover` is set only over real characters.

### Benchmark (`cargo test -p ide-editor --release --test bench -- --nocapture`, M-series Mac, 200k lines / 4.2 MB TS)
| step | time |
|---|---|
| open (rope + scans) | 17 ms |
| full tree-sitter parse (worker thread) | 238 ms |
| highlight 60 lines, cold | 0.25 ms |
| keystroke: edit + highlight on UI thread, avg of 1000 | 0.11 ms (max 3.4 ms) |
| background reparse after edits | 18 ms (off the UI thread) |
| paste 2000 lines + highlight | 0.34 ms |
| undo everything (1001 steps) | 4 ms |
| `text()` full copy | 0.35 ms |
| widget steady frame (headless egui) | 0.024 ms |
| widget jump-scroll frame (nothing cached) | 0.41 ms avg, 5 ms max |
| widget typing frame | 0.28 ms avg, 1.4 ms max |

The release build asserts these limits: keystroke < 4 ms, steady frame < 4 ms, typing frame < 8 ms, jump frame < 12 ms.

## app shell

Checks (run from `rust/harwex-ide`): `cargo build --release -p harwex-ide`, `cargo clippy -p harwex-ide --all-targets -- -D warnings` and `cargo test --workspace` pass. App dependencies: `ignore 0.4`, `notify 8`, `nucleo-matcher 0.3`, `rfd 0.15`, `memchr 2`.

Library change: `ide-editor` got `Document::save_snapshot() -> (String, u64)`, `Document::mark_saved(token)` and `Document::reload_from_bytes(&[u8]) -> bool` (plus a test). With them, the app writes files and reloads changed files on worker threads. `save_as` now uses `save_snapshot`, so its behaviour is unchanged.

### What works
- Window: Darcula-like theme (`app/src/theme.rs`). Top bar has the project name (a click opens another folder), the branch button (current branch from `ide_git`, "detached: <hash>" when detached), and Update / Commit / Push buttons that call stub hooks in `app/src/git/mod.rs`. Below it: the left strip (Project, Commit, Find, with rotated labels), the bottom strip (Git, Find Usages, Notifications), editor tabs and a status bar (spinner with the running job labels, line:col, language, read-only marker, branch).
- Opening a folder: the CLI argument first, then the last folder (eframe storage key `last_folder`), then a welcome screen with "Open Folder...". The rfd dialog is async and is awaited on a worker, so the UI thread never blocks on it.
- Project tree: lazy per-directory listing on workers through `ignore` (`.gitignore` of parent directories, `.git/info/exclude` and the global excludes apply; dotfiles are shown, `.git` is hidden). Git colors come from `Repo::status`: blue modified, green added, red untracked, teal renamed, gray deleted. Directories that contain changes are blue. A double-click opens a file.
- File watching: `notify` with FSEvents, recursive. Events are batched until 200 ms of quiet, or at most 1 s after the first event. Events under `node_modules`, `target`, `.yarn`, `dist` and `.git` objects are dropped. A change to `.git/HEAD`, `.git/index` or `.git/refs` triggers a git refresh. A batch reloads the loaded directories it touches and refreshes git status. It rebuilds the file index when files were created or removed. Unmodified open editors reload from disk, and nothing changes when the text is equal (for example after our own save).
- Tabs: keyed by canonical path (the path is canonicalized on the worker that opens the file). New tabs open after the active one. Closing activates the most recently used tab. A dirty tab shows a dot. Cmd+W or middle-click closes a tab. A dirty tab asks Save / Don't Save / Cancel. Cmd+S saves and Cmd+Alt+S saves all, both on a worker. Files under `node_modules` open as "read-only": editing is possible, saving is refused with a warning.
- Search Everywhere: Shift Shift or Cmd+Shift+O. The file index is built on a parallel `ignore` walk. nucleo-matcher scores run on a worker per keystroke, and stale results are dropped by a generation counter. Each query word that matches the file name gets a bonus, so `appts notes` puts `harwex-notes-frontend/src/ui/app.tsx` first. Matched chars are highlighted. Up/Down/Enter/Escape work.
- Find in Files: Cmd+Shift+F opens a dialog (the selected text is the default query, "Match case" is optional). The search is a literal `memchr::memmem` search on a parallel `ignore` walk. It skips binary files and files over 4 MB, and it stops at 5000 hits. Results show in the Find tool window, grouped by file. A click navigates. A new search cancels the running one.
- Navigation: the editor's Go to Declaration (Cmd+B, Cmd+click, context menu), Go to Source Definition, Go to Type Definition (Cmd+Shift+B) and Find Usages (Alt+F7) go through `nav::request`. All tsserver traffic goes through one queue thread (`nav::TsBridge`), so open/change/close and requests reach tsserver in UI order. A tab of a TS/JS/TSX/JSX file sends `open` when it opens and `close` when it closes. `change` is sent 300 ms after the last edit, and always right before any request (`nav::flush_ts`). One result opens the file and reveals the position. Several results show a chooser popup at the pointer (Up/Down/Enter/Escape, click outside closes). Zero results show an info toast. Back/forward history: Cmd+[ / Cmd+] (also Cmd+Alt+Left/Right). Every jump records the place it left.
- Hover: 500 ms on one identifier sends `quick_info` through the queue. The tooltip shows the display string, the docs and up to 8 tags. Hover is off while Cmd is held or a popup is open.
- Find Usages results are grouped by file in the bottom tool window (`w` marks writes). A click navigates.
- Gutter change bars: `Repo::line_changes(path, buffer_text)` runs on a worker. It runs 300 ms after the last edit and at once for a new tab. `refresh_git()` recomputes it for every tab. Its results become `GutterMark`s.
- `ide_ts::find_node()` runs once on a worker at startup.
- Notifications: toasts in the bottom-right corner (info 6 s, warning 10 s, error 15 s; hovering keeps a toast open; long bodies get "Show more") and a log in the Notifications tool window. A dot on the strip button counts unread entries.
- Hidden test hooks (`app/src/testhook.rs`): `--open <file> [--goto L:C] [--test-nav definition|source|type|usages@L:C]... [--test-goto-definition L:C] [--test-search <q>] [--test-find <q>] [--test-quit]`. The steps run the real UI code paths and log to stderr. `HARWEX_DEBUG_FS=1` logs watcher batches.

### Verified on harwex-mono (release build, `target/release/harwex-ide /Users/aleh_kaportsau/Projects/harwex-mono --open .../harwex-notes-frontend/src/ui/app.tsx --test-nav ...`)
- `definition@8:10` (`useEffect`) opened `javascript/node_modules/@types/react/index.d.ts` and revealed 1776:14 (screenshot checked).
- `source@8:10` showed the chooser with `react/cjs/react.production.js:495` and `react.development.js:1220` (screenshot checked).
- `definition@10:15` (`TAppRegistry`, workspace package `@hw/harwex-notes-protocol`) opened `packages/projects/harwex-notes/harwex-notes-protocol/src/registry.ts` at 87:6, which is the real source through the workspace symlink.
- `usages@8:10` listed 4 usages in 2 files in the Find Usages window.
- Gutter bars appear on a modified file (`assets-harness/electron/agent/claude.ts`). The tree colors, the Search Everywhere popup and the Find results were checked on screenshots.
- At idle the app uses 0% CPU (no repaint loop, and git refreshes do not feed back through `.git/index`).

### Timings (Apple Silicon, release, harwex-mono: 9169 indexed files)
| step | time |
|---|---|
| process start to window created (eframe + wgpu init) | 108-230 ms |
| first `update` call | 135-260 ms |
| first frame presented (second `update`) | 226-363 ms. Warm runs are about 230-250 ms. Cold or loaded-machine runs exceed 300 ms; almost all of the time is eframe/wgpu setup and the first paint |
| tree root listing (on worker) | 1.1-1.3 ms warm |
| file index (parallel walk, 9169 files) | 22-37 ms warm, ~100 ms cold |
| git status + branch (on worker) | 100-195 ms |
| first Go to Declaration (tsserver spawn + project load) | 0.75-1.0 s |
| warm Go to Declaration | 0.5-3.4 ms |
| first Go to Source Definition | 0.64-1.26 s |
| Find Usages `useEffect` (warm) | 22 ms |
| Find in Files `useSignals` (275 hits, 125 files) | 233 ms |

### Missing / known issues
- Hover tooltips, Shift Shift, Cmd+[ / Cmd+] and middle-click close are built but untested with real input: I could not drive the keyboard or mouse in this session. The user was using the machine during the screenshots.
- No "Select Opened File" in the tree (`ProjectTree::reveal` exists but nothing calls it). No tree keyboard navigation, no file create/rename/delete. Ignored files (like `node_modules`) are hidden from the tree, not shown in olive like IDEA does.
- Read-only for `node_modules` is advisory: the buffer stays editable and only saving is refused.
- Search Everywhere searches files only (no symbols or actions). Its ranking is a heuristic: sometimes a long name that matches every word with gaps outranks a second exact file-name match.
- Find in Files is literal only (no regex, no whole-word) and ASCII-only case-insensitive.
- Tool window sizes and the open tool windows are not persisted. Only the last folder is.
- The startup budget of 300 ms is met only on warm runs. The glow backend might start faster, but I did not try it.
- When tsserver loads a project, the first request can take a second. The request timeout is 20 s (`TsBridge::new`).

### Extension surface for the Git UI
- `app/src/git/mod.rs` is the Git UI's home. Replace the hook bodies and add sibling modules (`git/commit.rs`, `git/log.rs`, `git/diff.rs`, ...). The shell calls these hooks:
  - `branch_button_clicked(state, anchor)`, `update_project_clicked(state)`, `commit_clicked(state)`, `push_clicked(state)` from the top bar;
  - `commit_tool_window(state, ui)` (left "Commit" window) and `log_tool_window(state, ui)` (bottom "Git" window);
  - `on_editor_action(state, tab_id, &EditorAction)` for `GitAnnotate` / `GitShowHistory` / `GitRollbackLines`;
  - `on_gutter_click(state, tab_id, line)` and `on_annotation_click(state, tab_id, line)`;
  - `show_windows(state, ctx)` every frame after the panels (popups, dialogs, modals);
  - `on_git_refreshed(state)` after every status/branch refresh.
  - `GitUi` (in `state.git_ui`) is an empty struct to fill with Git UI state.
- `AppState` (`app/src/state.rs`) fields: `git: GitInfo` (`repo: Option<Repo>`, `branch`, `detached`, `status: HashMap<abs path, ChangeKind>`, `changes: Vec<FileChange>`, `dirty_dirs`), `tabs`, `layout`, `notifications`, `jobs`, `project`, `editor_theme`. Methods: `refresh_git()` (re-reads status and branch, then recomputes all gutters; call it after every git write), `open_location(path, Option<Position>, record_history)`, `save_tab`, `save_all`, `close_tab(id, force)`.
- Jobs (`app/src/jobs.rs`): `state.jobs.spawn(label, work, done)` runs `work` on a thread and `done(&mut AppState, result)` on the UI thread. The label shows by the status bar spinner. `spawn_quiet` is the same without a label. `post(f)` schedules a closure from any thread. `busy(label)` returns a guard for long-lived workers. Panics inside a job become error toasts.
- Notifications: `state.notifications.info/warn/error(title, body)` shows a toast and logs it; `log_only(level, ..)` only logs it. For git CLI results, use `CommandOutcome.stderr` as the body.
- Custom tabs (the diff viewer): implement `tabs::CustomTab` (`key`, `title`, `ui(&mut self, ui, &mut TabEnv)`, optional `tooltip`, `is_dirty`, `on_close`, `as_any_mut`). Open one with `state.tabs.open_custom(Box::new(tab))`; an open key is re-activated. A job delivers results to it with `state.tabs.custom_mut::<T>(key)`. Inside `ui`, `TabEnv` gives `jobs`, `notifications`, `project`, `git`, `editor_theme`, and `commands` (push `AppCommand::OpenLocation` / `CloseTab` / `OpenCustomTab` / `RefreshGit`; they run after the frame).
- Editor tabs: `state.tabs.editor_mut(id)` returns an `EditorTab` with `doc`, `view` (`EditorState`), `marks`, `annotations: Vec<String>` (set it to show blame; empty hides the column), `invalidate_marks()` and `path` (canonical).
- `layout::ToolWindow::{Commit, Git}` already exist, with strip buttons. `state.layout.show(w)` / `toggle(w)` open them.

## ide-term

Checks (run from `rust/harwex-ide`): `cargo build -p ide-term --all-targets`, `cargo test -p ide-term` (19 unit tests, plus 1 ignored throughput test) and `cargo clippy -p ide-term --all-targets -- -D warnings` pass. Dependencies: `alacritty_terminal 0.25.1`, `portable-pty 0.9.0`, `libc 0.2` (unix), `eframe` (dev only).

What works:

- Spawn: `$SHELL -l` (fallback `/bin/zsh`) in the given directory, with `TERM=xterm-256color`, `COLORTERM=truecolor` and `TERM_PROGRAM=harwex-ide`. Inherited `TERM_PROGRAM_VERSION`, `TERM_SESSION_ID` and `ITERM_SESSION_ID` are removed. `LANG=en_US.UTF-8` is set when the IDE has no locale, which happens when it starts from Finder. `SpawnOptions` can run any command instead.
- Threads: a reader thread does blocking 64 KiB PTY reads into a bounded channel of 16 chunks, so a flood throttles the child. A parser thread drains every queued chunk under one lock (at most 256 KiB per lock) and requests a repaint only when the dirty flag goes from false to true. That gives one repaint per frame. A writer thread owns the PTY input. Keys, pastes and the emulator's replies (DA, DSR, OSC 4/10/11 color queries, `CSI 14 t`) go through it, so neither the UI nor the parser blocks on a write. Synchronized updates (DECSET 2026) are flushed at their timeout. When the child exits, `[Process completed]` is printed.
- Widget: draws only the visible rows. The emulator lock is held only while cells are copied into a reusable buffer. Layout and painting happen after the lock is released. Draws per-cell foreground and background colors: 16 named, 256 indexed and truecolor, with OSC 4 overrides. Supports bold (bright color plus a second pass 1 px to the right), italic, all underline kinds (drawn as one underline), strikeout, dim, inverse, hidden and combining marks. Wide chars get their own galley so they cannot shift the row. Cursor shapes: block, beam, underline, and hollow when unfocused. A `\t` cell draws as blank.
- Selection: drag selects, double-click selects a word (semantic), triple-click selects a line. Dragging past the top or bottom edge scrolls. Cmd+C copies, with no selection it does nothing on macOS. OSC 52 copy goes to the clipboard.
- Scrolling: the wheel and trackpad scroll the scrollback (10 000 lines). On the alternate screen the wheel sends arrow keys (less, man). Shift+PageUp/PageDown/Home/End scroll locally. Typing jumps back to the bottom.
- Mouse reporting: SGR and legacy encodings for press, release, drag and wheel when the program asks for them (vim, htop). Hold Shift to select instead.
- Keyboard (`key_to_bytes`): text, Enter, Backspace, Tab, Shift+Tab, Esc, arrows/Home/End (CSI, or SS3 in app-cursor mode, `CSI 1;m X` with modifiers), Insert/Delete/PageUp/PageDown, F1-F12, Ctrl+letter and Ctrl+symbol, Alt as Meta (ESC prefix; macOS composed text after it is dropped). macOS shortcuts: Cmd+Left/Right/Backspace send Ctrl+A/E/U, and Alt+Left/Right send ESC b/f. Paste is bracketed when DECSET 2004 is on, and an embedded end marker is stripped. Cmd+K clears the scrollback and moves the cursor line to the top locally. It works without the shell's help (Ctrl+Shift+K off macOS).
- Focus: a click focuses the widget. While focused, Tab, the arrows and Esc reach the terminal instead of moving egui focus. The widget id is unique per `Terminal`, so focus survives tab reordering.
- Title: the OSC 0/2 title, else the program name (`zsh`).
- Links: hovering a `path:line:col`, `path:line`, `path(line,col)` (tsc) or plain-path token whose file exists shows an underline and a hand cursor. A click returns it in `TerminalResponse::open_path`. Wrapped lines are joined. Relative paths are tried against the foreground process's cwd (`proc_pidinfo` on macOS, `/proc` on Linux), so links work after `cd`, and then against the spawn directory. The result is cached while the hovered token stays the same.

Throughput (M-series Mac, release):

| case | result |
|---|---|
| raw emulator parse of `y\r\n` | ~110 MB/s |
| `yes \| head -c 50000000 \| cat` through PTY + emulator (headless) | 75 MB in 0.67 s = 112 MB/s |
| same in the eframe window, plus 2 × 28 MB `cat` | 108 MB/s parsed, 122 fps, worst frame gap 15.7 ms, worst `update` 9.7 ms |
| `yes \| head -c 50000000` (no `cat`) | 5 MB/s, limited by macOS `head`: it line-buffers on a tty and makes one 2-byte write per line. The PTY reads average 7 bytes. The UI stays at 120 fps. |

Missing or known issues:

- No real bold face: egui ships no bold monospace font, so bold is faked with a double draw.
- Ctrl+click and Cmd+click are not special: a plain click on an existing path opens it. A double-click on a path opens it on the first click.
- No IME composition (the widget does not set `ime` output). Committed IME text is accepted.
- No kitty keyboard protocol, no OSC 8 hyperlinks, no search in the scrollback, no bell indicator, no blinking cursor.
- Color queries (OSC 4/10/11) answer from the theme and ignore the program's own OSC 4 overrides.
- `open_path` line and column are 1-based, as printed. ide-ts and ide-editor are 0-based, so the app must subtract 1.
- The example (`cargo run -p ide-term --release --example term [dir]`) was checked by screenshot only. macOS denied synthetic keystrokes, so typing was covered by the unit test that writes into a running `read`. Hooks: `HARWEX_TERM_CMD` runs a command first, `HARWEX_TERM_STATS=1` prints fps and MB/s.

Public API (exact):

```rust
pub struct SpawnOptions { pub cwd: PathBuf, pub command: Option<Vec<String>>, pub env: Vec<(String, String)>,
                          pub cols: u16, pub rows: u16, pub scrollback: usize }
impl SpawnOptions { pub fn new(cwd: &Path) -> Self; }          // 80x24, 10 000 lines, login shell

pub struct Terminal { .. }                                      // Send; kill() on drop
impl Terminal {
    pub fn spawn(cwd: &Path, ctx: egui::Context) -> std::io::Result<Terminal>;
    pub fn spawn_with(options: SpawnOptions, ctx: egui::Context) -> std::io::Result<Terminal>;
    pub fn title(&self) -> String;                 // OSC title, else program name
    pub fn is_alive(&self) -> bool;
    pub fn kill(&mut self);                        // SIGHUP, idempotent
    pub fn cwd(&self) -> &Path;                    // spawn directory
    pub fn current_dir(&self) -> Option<PathBuf>;  // foreground process cwd
    pub fn write(&self, bytes: impl Into<Vec<u8>>);
    pub fn paste(&self, text: &str);
    pub fn clear(&self);                           // Cmd+K
    pub fn resize(&mut self, cols: u16, rows: u16, cell_width_px: u16, cell_height_px: u16);
    pub fn grid_size(&self) -> (usize, usize);     // (cols, rows)
    pub fn screen_text(&self) -> String;           // visible rows, trailing spaces trimmed
    pub fn bytes_processed(&self) -> u64;
    pub fn set_theme(&mut self, theme: TerminalTheme);
    pub fn theme(&self) -> &TerminalTheme;
    pub fn scroll_to_bottom(&self);
}

pub struct TerminalView<'a> { .. }
impl<'a> TerminalView<'a> {
    pub fn new(term: &'a mut Terminal) -> Self;
    pub fn font_size(self, size: f32) -> Self;     // default 13
    pub fn theme(self, theme: TerminalTheme) -> Self;
    pub fn alt_is_meta(self, on: bool) -> Self;    // default true
    pub fn id(self, id: egui::Id) -> Self;
    pub fn show(self, ui: &mut egui::Ui) -> TerminalResponse;   // fills ui.available_size()
}
pub struct TerminalResponse {
    pub open_path: Option<(PathBuf, Option<usize>, Option<usize>)>,  // existing file, 1-based line/col
    pub response: egui::Response,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TerminalTheme { pub foreground, pub background, pub cursor, pub selection, pub link: Color32, pub ansi: [Color32; 16] }
impl TerminalTheme { pub fn darcula() -> Self; pub fn indexed(&self, i: u8) -> Color32; .. }   // Default = darcula

pub struct KeyMode { pub app_cursor: bool, pub alt_is_meta: bool }
pub fn key_to_bytes(key: egui::Key, mods: egui::Modifiers, mode: KeyMode) -> Option<Vec<u8>>;
pub fn paste_bytes(text: &str, bracketed: bool) -> Vec<u8>;
pub struct PathHit { pub path: String, pub line: Option<usize>, pub column: Option<usize>, pub start: usize, pub end: usize }
pub fn path_at(line: &[char], col: usize) -> Option<PathHit>;
pub fn resolve_path(path: &str, bases: &[&Path]) -> Option<PathBuf>;
```

App notes: call `TerminalView::new(&mut term).show(ui)` inside the tool window. Use `response.response.request_focus()` after creating a tab. Drop or `kill()` a `Terminal` when its tab closes. `Terminal::title()` is cheap enough to call each frame for the tab label.

## terminal integration

Checks: `cargo build --release -p harwex-ide` and `cargo clippy -p harwex-ide -- -D warnings` pass. The app depends on `ide-term` (path dependency).

What works:

- `app/src/terminal.rs` holds all terminal code. `Terminals` (in `state.terminals`) keeps one `ide_term::Terminal` per tab, with a stable widget id per tab.
- `ToolWindow::Terminal` is a new bottom tool window, placed between Find Usages and Notifications. It has a tab strip: one tab per shell with the `Terminal::title()` label (cut at 32 chars), an "x" per tab and a "+" button.
- The first shell spawns when the window is drawn with no tabs. The cwd is the project root, or `$HOME` when no project is open. Closing the last tab hides the window. Opening the window again starts a new shell.
- "x" kills the shell (SIGHUP) and removes the tab. A dead shell shows a dimmed tab title and a "[process exited]" bar with a Close button above the output. The crate's own "[Process completed]" line stays in the output.
- Alt+F12: when the window is hidden, it opens the window and focuses the active terminal. When the window is visible but not focused, it focuses the terminal. When the terminal is focused, it hides the window and focuses the editor.
- Keyboard focus: `terminal::shortcuts` runs at the start of `app::shortcuts`. When a terminal has focus, it returns true and the app skips its other global shortcuts (Cmd+W, Cmd+S, Shift Shift, Cmd+Shift+F, Cmd+[ and so on). Only Alt+F12 and Escape are handled. Escape moves focus to the active editor, or drops focus when no editor is open.
- `TerminalResponse::open_path` calls `open_location` with a 0-based position (line - 1, col - 1). The column defaults to 0. A path with no line opens without a position.
- `on_exit` kills all shells. `Terminal` also kills its shell on drop.
- Test hook: `--test-term "<command>"` opens the Terminal window and types the command plus Enter into the first shell.

Verified (release build, screenshots of the window by window id):

- `harwex-ide /private/tmp/claude-501/termtest --open .../src/main.ts --test-term 'echo hello-from-test; ls src; echo src/main.ts:3:2'`: the Terminal window opened under the editor, zsh started in the project root, and the output showed all three lines with the user's prompt colors.
- `--test-term exit`: the tab showed the "[process exited]" bar with Close, and the output ended with "[Process completed]".

Missing / known issues:

- Clicking a path, Alt+F12, Escape and the tab buttons are untested with real input: the session could not send keys or clicks.
- Escape never reaches the shell, because it returns focus to the editor. That breaks Escape in vim or less inside the terminal. A fix would let Escape through on the alternate screen, but `ide-term` does not expose the screen mode.
- For the Git UI: a new global shortcut must go into `app::shortcuts` after the terminal check, or check `state.terminals.has_focus(ctx)`. Otherwise the shortcut also fires while the user types in a terminal (Cmd+K would clear the terminal and open Commit).
- Terminal tabs are not persisted, and there is no rename or reorder.

## git ui: changes, diff, editor

Files: `app/src/git/changes.rs`, `app/src/git/diff.rs`, `app/src/git/editor_git.rs`, plus the `--test-git-*` flags in `testhook.rs`. No library changes. `cargo build --release -p harwex-ide` passes. `cargo clippy -p harwex-ide -- -D warnings` reports nothing in these files.

What works:

- Commit tool window. The change tree is grouped by directory, and chains of single-child directories are merged into one row ("core/deep/nested"). "Unversioned Files" is a separate group. Each file, directory and group has a tri-state checkbox, and a prefix sum over the display order makes each tri-state O(1). Tracked changes start checked and unversioned files start unchecked, like IDEA. Checkbox state is kept by path across refreshes. File names use the IDEA status colors, and renames show "from <old path>". The rows are virtualized (`show_rows`), and the flat row list is rebuilt only when the status or the collapse state changes. With 1206 changes the window stays smooth.
- Selection supports click, Cmd+click and Shift+click. A double-click opens the diff. The toolbar has Refresh, Rollback, Diff, Expand All, Collapse All and an "N of M selected" counter. The file and directory context menu has Show Diff, Jump to Source, Rollback... (with a confirm dialog that marks added files "will be deleted"; unversioned files are excluded), Stage, Unstage and Delete... (with a confirm dialog). The actions apply to the whole selection when the right-clicked row is part of it.
- Commit message box (Cmd+Enter commits). The Amend checkbox fills in the last commit message. Unticking it restores the draft when the message was not edited. Commit and "Commit and Push..." call `Repo::commit` with exactly the checked paths on a worker. Before that, the worker writes every dirty editor buffer, as IDEA does, and the tabs are then marked saved. A success toast shows the hash and subject. A failure toast shows the stderr. After a commit the window calls `refresh_git`, and after "Commit and Push..." it calls `remote::open_push_dialog`. Cmd+K opens the Commit window and focuses the message. Cmd+K is ignored while a terminal has focus or Shift is held, so Cmd+Shift+K still reaches Push.
- Diff tab (`DiffTab`, a CustomTab; key `diff:wt:<rel>` or `diff:<oid>:<rel>`). It shows the two sides next to each other with line numbers and tree-sitter colors. Each side is an `ide_editor::Document` parsed on the worker, and its spans are cached per line. Hunk backgrounds use IDEA Darcula colors: green for inserted, gray for deleted, blue for modified. Word-level highlights come from `LinePair::*_inline`. Their x positions come from the galley, so the highlights do not drift. Filled curved ribbons connect the two sides (a mesh, because the band is not convex). An empty side gets a thin line at the gap. A custom scrollbar shows change markers.
- Scrolling: both sides use one virtual coordinate. An unchanged line counts once, and a hunk counts as many lines as its taller side. Each pane maps that coordinate to its own line, so the two sides stay aligned through every hunk. Wheel and trackpad scrolling, arrow and Page keys (after a click in the body), and dragging or clicking the scrollbar all work. Horizontal scrolling is shared by both sides. Only visible lines are laid out, so a 10k-line diff costs the same per frame as a short one.
- Prev/Next buttons and F7 / Shift+F7 move between changes and put the change one third down the view. The tab opens at the first change. "Jump to Source" (F4) opens the file at the current change. A binary diff shows "Binary files differ", and equal texts show "Contents are identical".
- A worktree diff reloads after every git status refresh, which follows saves and external edits. The worker compares the texts, so an unchanged file costs no UI work. A dirty editor buffer is diffed instead of the disk file (`ide_git::diff_texts`). `open_worktree_diff` and `open_commit_diff` accept absolute paths and paths relative to the workdir.
- Editor: clicking a gutter bar opens a popup with the old text and three buttons: Rollback, Show Diff and Copy. Rollback and "Git > Rollback Lines" (selection or caret line) run `rollback_lines` on a worker. The result goes into the Document through `set_text` inside sealed undo groups, so Cmd+Z restores the change. The rollback is skipped with a warning when the buffer changed in the meantime.
- "Git > Annotate" toggles a blame column (`blame_text`, so unsaved buffers work). Each line shows the date and the author. The blame is recomputed 600 ms after edits and after every git refresh. A click on an annotation opens a commit popup with the subject, the body, the author and email, the date with its time zone, the full hash, and two buttons: Show Diff (`open_commit_diff` for this file) and Copy Hash. "Git > Show History" calls `log::show_file_history`.
- Test hooks (they run after the first status refresh, about 1.2 s apart): `--test-git-changes`, `--test-git-commit "<msg>" <comma-separated rel paths>`, `--test-git-diff <rel path>`, `--test-git-diff-next <n>` (presses F7 n times on the active diff and logs the state), and these steps on the active editor: `--test-git-gutter <L>`, `--test-git-rollback-lines <L>`, `--test-git-annotate`, `--test-git-blame-click <L>`, `--test-git-history`. Lines are 1-based.

Verified on a throwaway repo (`/private/tmp/claude-501/gitui-changes/repo`: 1206 changes, a 10k-line TS file with 17 hunks):

- Screenshots: the change tree with groups, compressed directories, checkboxes, colors and counters; the app.tsx diff with word highlights and a ribbon for an insertion; the big.ts diff opened at the first change, then F7 to the insertion hunk at line 301; the gutter popup with the old line; the blame column with the commit popup.
- From the logs and the repo: a commit of 3 checked paths (modified, deleted, staged-new) committed exactly those 3 files, and the others stayed uncommitted. Rollback Lines applied. Blame gave 10 lines. Blame clicks loaded the right commits ("Initial commit", "Change app title"). An external edit of an open worktree diff reloaded it (from 0 to 2 hunks).

Missing / known issues:

- The confirm dialogs were not screenshotted. Real mouse and keyboard input (checkbox clicks, context menus, F7 keys, Cmd+K) was never sent; hooks drove the same code paths instead.
- The diff is read-only: no text selection, copying or editing in the right pane, and no "apply/revert hunk" arrows in the ribbon gutter. No unified view, no "ignore whitespace" option, no collapsing of unchanged runs.
- Blame dates are UTC (no local time zone without a date crate). Annotations are not shifted live while typing. They are refreshed 600 ms after the edit.
- No changelists, no "Group by" options (directory grouping only), no keyboard navigation in the change tree, and no per-hunk partial commit.

## git ui: log, branches, remote, conflicts

Checks: `cargo build --release -p harwex-ide` and `cargo clippy -p harwex-ide -- -D warnings` pass. `cargo test -p harwex-ide` has 3 tests for this part: the merge block layout and the date math. Files: `app/src/git/log.rs`, `branches.rs`, `remote.rs` (+ `remote/testing.rs`), `conflicts.rs` (+ `conflicts/merge.rs`). Shell edits: `testhook.rs` only (the `--test-git-<step>` catch-all). Library edit: `Repo::pull` now passes `--autostash`, like IDEA's stash/unstash update. A dirty tree no longer blocks a rebase update.

What works:

- Shared runner `remote::run_op(state, title, ok_body, check_conflicts, work, then)`. It runs a git write on a worker. Then it shows a toast: the last stdout/stderr lines on success, the command and stderr on failure. It calls `refresh_git()`, checks for conflicts when asked, and then calls `then(state, ok)`. Every write in these four modules goes through it.
- Git log tool window. Filter bar: text or hash (debounced 300 ms), a Branch combo (All, then local, then remote), author, a "Path: …" chip with x, and Refresh. The table is virtualized (`show_rows`, 22 px rows). Columns: lane graph, ref labels (current branch, local, remote, tag and detached HEAD in different colors), subject, author, date ("Today 14:03", "Yesterday", or the date in the author's time zone). Pages hold 300 commits. The next page loads when the view is within 60 rows of the end. The graph is recomputed over all loaded rows; it costs microseconds. Merge commits get a hollow dot. A text, author or path filter draws one straight line, because the filtered-out parents would open a lane per row. Up/Down/PageUp/PageDown move the selection while the table has focus. The right pane shows the changed files (a click calls `diff::open_commit_diff`), the full message, the hash with Copy, the author, the full date, the committer when different, the parents and the refs. Context menu: Copy Revision Number, Checkout Revision, New Branch… (name + checkout), Reset Current Branch to Here… (soft/mixed/hard; hard asks again), Revert Commit, Cherry-Pick. `show_file_history(path)` sets the path filter, clears text and author, and opens the Git window. The log reloads after a git refresh only when a ref moved. A fingerprint of HEAD and all branch tips is compared. A hidden window reloads the next time it is shown.
- Branches popup, anchored under the top-bar button. It has a search field (Enter checks out the first match, Escape or a click outside closes it). Actions at the top: + New Branch…, Update Project…, Push…, Fetch, Stash Changes…, Unstash Changes…. The search filters these too. Groups: Recent, Local, Remote. The current branch has a dot, and drawn arrows show ahead/behind counts; the default fonts have no arrow glyphs. Hovering a row opens a submenu on the right: Checkout, New Branch from '<x>'…, Merge '<x>' into '<cur>', Rebase '<cur>' onto '<x>', Rename…, Delete. The current branch shows Update and Push instead. Delete asks first. A local branch offers "Force delete" and "Also delete the tracked remote branch". A remote branch is deleted with `delete_remote_branch`.
- Push dialog: "branch -> upstream", or "-> origin/branch (new)" with a "Set upstream" checkbox (default on) when there is no upstream. It lists the outgoing commits; the selected commit's files open its diff. "Force push (with lease)" asks for confirmation. The dialog closes on success and stays open on failure. Update Project: a Merge/Rebase choice, remembered between runs. Stash: a message and "Include untracked files". Unstash: a stash list, the selected stash's files, a "Reinstate index" checkbox, and Apply / Pop / Drop (Drop asks first).
- Conflicts: `on_git_refreshed` and every merge, rebase, pull, cherry-pick, revert and unstash read `state()` and `conflicts()` on a worker. The dialog opens after an operation that left conflicts, or when conflicts appear on their own, for example from a merge in the terminal. Dialog: a file list, then Accept Yours / Accept Theirs (`resolve_with`) and Merge… (also a double-click). During a rebase the labels say "Upstream (ours)" and "Your commit (theirs)". While a merge, rebase, cherry-pick or revert is in progress, a banner sits at the top right. It has Resolve…, Continue (enabled when no conflicts are left) and Abort (asks first).
- Merge tab (`conflicts/merge.rs`, a `CustomTab` keyed `merge:<path>`) has three aligned columns: Yours, the editable Result, and Theirs. A diff3-style sweep over the base->ours and base->theirs hunks (`ide_git::diff_texts`) cuts the file into blocks. Each block is one row in all three columns, so the panes scroll together. Changes made on one side only go into the result automatically (blue). A conflict starts with the base text (red) and turns green when resolved. `>>` and `<<` take a side. Taking the second side after the first appends it, so both changes are kept. Each result block is a `TextEdit`, and an edit marks it resolved. Unchanged runs over 12 lines fold to 3+3 context lines. "Accept Yours/Theirs" apply to all blocks. "Save and Mark Resolved" calls `resolve()` (it asks first when conflicts are left), closes the tab and refreshes the conflict list.
- Test hooks: `--test-git-<step> [arg]` in order. Each step waits until no labelled job runs, plus 0.9 s. Steps: log, select <row>, filter <text>, filehistory <path>, branches, branch-menu <name>, checkout|merge|rebase <branch>, logaction <copy|checkout|newbranch|reset|revert|cherry-pick>, newbranch <name>, push, push-go, update, update-go <merge|rebase>, stash, stash-go <msg>, unstash, unstash-pop, conflicts, mergetool <path>, take <ours|theirs>, save, continue, abort, dump (prints the dialog state to stderr), wait <ms>. The names `--test-git-history` and `--test-git-diff` belong to the changes agent and are parsed before the catch-all.

Verified on a throwaway repo (`/private/tmp/claude-501/gitui-history/make.sh`: 717 commits, branches, tags, a merge, a bare remote, conflicting branches), with screenshots: the log with lanes and merges, paging 300 -> 600 -> 717 (18–23 ms per page), the branches popup and submenu, a merge with a README conflict -> merge tab -> take theirs -> save -> Continue (merge commit created), a second merge conflict (conflict + theirs-only block) in the three-pane tab, the Push dialog, a push to the bare remote, a push of a new branch with set-upstream, stash with untracked files -> Unstash dialog -> Pop, Update with rebase (autostash) -> rebase conflict -> Conflicts (Rebase) -> Abort (tree and autostash restored), a cherry-pick conflict with banner, the revert failure toast, the Reset dialog.

harwex-mono (read-only run): first log page (152 commits, all of history) 15 ms; file history of `javascript/package.json` (9 commits) 34 ms; git status + branch 181 ms at startup.

Missing / known issues:

- No smart checkout: a checkout that local changes would overwrite fails with git's message in the toast.
- The merge tab has no syntax highlighting, no word-level marks and no horizontal scroll (long lines are clipped). A file with huge conflicting blocks lays out every block each frame; unchanged runs are folded, so normal files stay fast.
- The log has no column resizing, no date/user filter popups, no multi-select, and no "Show Diff with Working Tree".
- The Unstash file list omits untracked files stored in a stash (see ide-git).
- A conflicted merge also shows an error toast ("Merge … failed" with git's CONFLICT lines) next to the Conflicts dialog. IDEA shows a softer "Merge conflicts" notice.
- Context menus, hover submenus and keyboard selection were driven through the test hooks only; no real mouse input was possible in this session.

## final review

Checks: `cargo build --release --workspace`, `cargo clippy --workspace --all-targets -- -D warnings` and `cargo test --workspace` pass. Clippy failed at the start (`items_after_test_module` in `git/log.rs`). The test module now sits at the end of the file.

### Gaps closed

- Terminal Escape: `ide_term::Terminal::is_alt_screen()` reads `TermMode::ALT_SCREEN`. `terminal::shortcuts` leaves Escape alone when the focused terminal is on the alternate screen, so vim, less and htop get it.
- Log details → commit diff: a click calls `diff::open_commit_diff`, and the tab loads. Checked on harwex-mono: `yarn.lock @ 7fbd9668` (1 hunk, opened at the change, t = 3803), `TennisWidget.tsx` (new file, 238 lines) and `install-state.gz` (binary). Checked through the new `--test-git-logfile <n>` and `--test-git-diffstate` steps, because no screenshot was possible (see below).
- node_modules: `EditorView::read_only(bool)` drops text input, paste, cut, Backspace/Delete/Enter/Tab, Cmd+Z/D// and Ctrl+Y. Copy, selection, navigation and the context-menu jumps still work. Cut, Paste, Comment and Rollback Lines are disabled in the menu. The tab draws a padlock, and its tooltip says "(read-only)". Cmd+S on such a tab does nothing, and Git rollback skips it.
- Layout persistence: `Layout::to_storage`/`from_storage` save the open left and bottom tool windows under the eframe key `tool_windows`. Panel sizes were already in egui memory (`PanelState` is `insert_persisted`), which eframe saves. Checked: a graceful quit wrote `left=Project;bottom=Terminal`.
- Merge tab: the three panes share one horizontal offset. A scrollbar sits under the panes, and the horizontal wheel or trackpad works over the rows. The Result `TextEdit` is as wide as the longest line, and the column clips it.
- Cmd+T (Update Project) and Cmd+Shift+K (Push) were shown in tooltips but not wired. They now work, after the terminal-focus check.

### Bugs found and fixed

1. Nav chooser popup: Enter and the arrows reached the focused editor or terminal too. Enter inserted a newline before the jump. The keys are now consumed at the start of the frame (`nav::take_popup_keys`).
2. Opening another folder closed dirty tabs with `force` and lost unsaved edits. The switch is now refused with a warning while a tab is dirty.
3. Project switch: the `nav`, `find` and `search` generation counters restarted at 0. A late reply from the old project could open its file in the new one. The counters now keep counting (`reset()`). The old Find walk is cancelled. Pending opens are cleared and checked against the project generation.
4. Project switch did not reset `git_ui`. Push and Unstash dialogs of the old repo could act on the new one. A conflicts check that outlived the switch left `checking = true` forever, so the conflict banner and dialog stopped updating. Both are fixed.
5. Find Usages spinner stuck forever when a newer navigation request replaced the usages request.
6. Back history recorded the place where the user was when the reply arrived. It should record the place of the request. The jump now pushes the request origin.
7. Gutter popup Rollback used line numbers from click time, so an edit in between reverted other lines. The popup now closes when the doc version changes, and a stale popup result is dropped. Annotation clicks during the blame debounce are refused, because their line numbers are stale.
8. A diff reload asked for while one ran was dropped, so the diff could show old text. It now runs once more.
9. Unstash Pop/Apply/Drop used `stash@{n}` from dialog-open time. A stash made since then shifted the numbers, so Drop could delete another entry. The index is now resolved by oid on the worker, and the action fails when the entry is gone.
10. `std::fs::canonicalize` ran on the UI thread in `diff::rel_and_abs` and `log::show_file_history`. It was removed, because the paths are already canonical.

Checked, no problem found: all git, fs and tsserver work runs on workers or the ts queue thread. `flush_ts` runs before every request, and after reload, undo and `set_text` (the version bumps). Tabs are keyed by canonical path, and duplicates are re-checked after canonicalize. No panics on user data were found.

### Still missing / known issues

- No screenshots this round: the Mac screen was locked (`CGSSessionScreenIsLocked = 1`). `screencapture -l` returns "could not create image from window", and a full-screen capture is black. Everything was checked through logs and test-hook state dumps. The read-only lock icon, the merge-tab scrollbar and the layout restore were never seen on screen.
- Real keyboard and mouse input was never sent. The new Escape routing, the popup key capture, Cmd+T and Cmd+Shift+K are untested by hand.
- Merge tab: a line-ending-only change on one side (CRLF/LF, final newline) is invisible to `diff_texts`. The saved result keeps "ours" line endings without a warning. The Result editor does not scroll sideways to follow the caret.
- ide-ts: ropey breaks lines on VT, FF and NEL, TypeScript does not. A file with a form feed gets positions one line off after it. Unsaved edits are not shared between two tsserver processes (two `node_modules/typescript` installs in one workspace).
- Nav chooser previews and Find-in-Files columns are read from disk, not from an unsaved buffer. A BOM shifts Find-in-Files columns on line 1 by one.
- Switching folders with dirty tabs is refused instead of asking Save / Discard.
- Running the IDE with test hooks writes `last_folder` and `tool_windows` to `~/Library/Application Support/harwex-ide/app.ron`. They were restored by hand after this round.

### Smoke on harwex-mono (read-only) and timings

Release build, Apple Silicon, screen locked (no vsync), 9179 indexed files.

| step | result |
|---|---|
| process start → first frame presented | 140-175 ms (3 runs) |
| git status + branch | 101-107 ms (finished at 226-240 ms) |
| file index | 26 ms |
| Go to Declaration `useEffect` (cold tsserver) | 714-772 ms → `@types/react/index.d.ts:1776:14` |
| Go to Declaration `TAppRegistry` (`@hw/harwex-notes-protocol`) | 0.5 ms → `harwex-notes-protocol/src/registry.ts:87:6` |
| Go to Source Definition `useEffect` | 673 ms → `react.production.js:495`, `react.development.js:1220` |
| Commit window | 111 entries |
| worktree diff `assets-harness/electron/agent/claude.ts` | 5 hunks; F7 steps 0 → 1 |
| terminal `git status --short` | correct output in the dumped screen |
| idle CPU (editor open, 12 s after start) | 0.0 % (4 samples), 120 MB |

Git write flow on `/private/tmp/claude-501/gitui-history` (rebuilt with `make.sh`): stash with untracked → checkout `conflict-a` → merge `conflict-b` → conflict → merge tab → take theirs → save → Continue (merge commit `Merge branch 'conflict-b' into conflict-a`) → Unstash Pop (dirty `util.ts` and `untracked.txt` restored, stash list empty).

## visual tests

Checks (run from `rust/harwex-ide`): `cargo test --workspace` and `cargo clippy --workspace --all-targets -- -D warnings` pass. How to run, update and read snapshots: `docs/testing.md`.

### What exists

- The app is a library now. `app/src/lib.rs` exposes every module, `IdeApp::create(ctx, storage, AppOptions)` builds the app, and `main.rs` only parses the command line. `AppOptions` controls the project, last-folder restore, the file watcher, the node warm-up, the terminal command and a `deterministic` mode (toasts never expire, no durations or ages in the UI).
- Headless driver: `app/tests/common/mod.rs` wraps `egui_kittest` 0.31 (`wgpu` + `snapshot` + `eframe`) around the real `IdeApp`, 1280x800 at 1 point per pixel, 0.05 s of egui time per frame. Input goes in as real events: pointer move, press and release (also middle and right button, Cmd+click, drag, double click), keys with modifiers, text, a Shift Shift tap. Widgets are found by accessibility label; hand-painted rows (tree, tabs, strips, commit tree and its boxes, log rows, branch rows, push/stash/conflict lists, editor, terminal grid) got labels. `settle()` steps until `AppState::is_idle()`: no job thread or undelivered callback (`Jobs::in_flight`), no tsserver command queued (`TsBridge::queued`), no git refresh, no pending debounce (gutter, ts sync, log filter, blame, hover).
- Fixtures: `app/tests/common/fixtures.rs` builds git repos with fixed dates (stable hashes): basic, changed (modified, staged add, deletion, untracked), history with a merge and a tag, 700 commits (fast-import), bare remote with a second clone, conflicting branches, 1200 changed files, a 10k-line file, and a TS project with `node_modules/fake-lib` (`.d.ts` + `.js`), a workspace package link and TypeScript linked from harwex-mono. Fixtures live at `/private/tmp/harwex-ide-kittest/<suite>/<test>` so drawn paths are stable; they are wiped when created and removed on drop.
- Tests never use the user's storage or a real window. A `MemoryStorage` covers the layout round trip. The terminal runs `zsh -f` with the prompt `$ `.
- Small library additions for tests: `EditorState::geometry()` (`EditorGeometry`: char, gutter-mark and annotation positions), accessibility names in the editor and terminal widgets, read accessors on the commit window, diff tab, log, push/stash dialogs, conflicts and branches popup.

| suite | tests | snapshots | covers |
|---|---|---|---|
| `shell` | 9 | 14 | layout, tree with git colors and expand/collapse, tabs (double-click open, click, Cmd+W, middle click, x), dirty dot, Cmd+S, close prompt, Search Everywhere (Shift Shift, Cmd+Shift+O, ranking, arrows, Enter, Escape), Find in Files (dialog, results, click to open), status bar, tool window toggles, layout + last folder persistence |
| `editor` | 7 | 8 | typing, Backspace, undo/redo to the clean state, Shift+arrows, double click, drag select, Cmd+A, Cmd+D, Cmd+/, right click moves the caret, context menu and Git submenu, Cmd+hover underline and hand cursor, read-only `node_modules` tab (typing ignored, padlock, menu items disabled), gutter marks for modified, added and deleted lines |
| `navigation` | 7 | 5 | Cmd+B into `fake-lib/index.d.ts`, Cmd+click into a local module, context-menu Go to Declaration into a workspace package (real path, editable), Go to Source Definition into `.js`, the multi-target chooser with Down + Enter (no newline reaches the editor) and Escape, Cmd+[ / Cmd+], Find Usages panel and row click, hover quick info (hidden while Cmd is held) |
| `terminal` | 7 | 5 | Alt+F12 open/focus/hide, `echo` output in the grid, "+" second tab, tab switch and x, Escape at a prompt returns to the editor, Escape reaches `less` on the alternate screen, focused terminal blocks Cmd+K and Cmd+W (Cmd+K clears), `path:line:col` hover and click opens the file, exited-shell bar and Close |
| `git_changes` | 8 | 13 | commit tree rows, file/directory/group boxes, click/Cmd+click selection, collapse, commit of exactly the ticked files (deletion left out, untracked added), Amend fill/restore, Cmd+K focus, Cmd+Enter amend, Rollback with confirm (toolbar and context menu, "will be deleted"), diff tab of a 10k-line file with F7 / Shift+F7 / Next / Jump to Source, gutter popup rollback + Cmd+Z, Annotate column and commit popup + Show Diff, 1200 changes |
| `git_history` | 11 | 16 | log graph with a merge lane, details pane and commit diff tab, arrow keys, text/branch/author filters, paging 300 → 700 with PageDown, branches popup (groups, ahead tooltip, search, checkout, + New Branch with Enter), push dialog and push to a bare remote, push of a new branch with Set upstream (Cmd+Shift+K), Update Project merge and rebase (Cmd+T), stash with untracked, Unstash Pop and Drop by id while the indices shift, merge conflict → dialog → merge tab → Accept Theirs → Save → Continue, Accept Yours → Abort with confirm, log context menu New Branch (Enter) and Reset --hard confirm |

49 UI tests, 61 snapshots (about 5 MB, `app/tests/snapshots/`, not in git). Every snapshot was opened and checked by eye. Runtime on Apple Silicon (debug, warm build): the six UI suites run in 7-9 s of test time; the whole `cargo test --workspace` takes about 19 s. Four repeated runs gave identical pixels.

### Bugs found by the tests and fixed

1. Editor context menu: "⇧⌘B" and "⌥F7" drew boxes, because egui's default fonts have no ⇧ or ⌥ glyph. They read "Shift+⌘B" and "Alt+F7" now.
2. Diff tab: Shift+F7 moved to the next change. `consume_key(NONE, F7)` ignores an extra Shift and ran first. Shift+F7 is consumed first now.
3. Gutter popup Rollback left the keyboard focus on the popup button, so Cmd+Z right after the rollback did nothing. The editor takes the focus back.
4. Branches popup: the list stayed as tall as the first frame ("Loading..."), so every branch below the actions was cut off and could not be hovered or clicked. An egui Area only offers its last size to the content. The list now asks for last frame's content height (`min_scrolled_height`). The same happened when a search was cleared.
5. Enter did nothing in Create New Branch, Rename and the log's New Branch dialogs. The name box took the focus back on the same frame, so `lost_focus()` never fired. The box is re-focused only when it did not just lose the focus.
6. The merge/rebase "in progress" banner floated over the editor area and covered the merge tab's Save and Mark Resolved / Cancel buttons. It is a panel under the top bar now (`git::conflicts::banner`, called from `app.rs`).
7. Commit popup said "1 files changed".
8. Runs with hidden `--test-*` hooks wrote `last_folder` and `tool_windows` into the user's `~/Library/Application Support/harwex-ide/app.ron` (listed as a known issue above). Background mode now uses its own storage file. Note: my one verification run before this fix replaced the user's `last_folder` with a temp folder; I set it back to `/Users/aleh_kaportsau/Projects/harwex-mono`, which is the most likely previous value. `tool_windows` may have been reset to `left=Project;bottom=`.

Checked and found fine: Cmd+/ moving the caret down after commenting one line is intentional (IDEA behaviour); `consume_key` order elsewhere in the app has no Shift/Alt conflicts.

### Background mode (no focus stealing)

`HARWEX_IDE_BACKGROUND=1`, also implied by any hidden `--test-*` flag: `main.rs` sets winit's `ActivationPolicy::Accessory` and `with_activate_ignoring_other_apps(false)` through `NativeOptions::event_loop_builder`, opens the viewport with `with_active(false)`, not fullscreen or maximized, does not restore the stored window state, and stores app state in `$TMPDIR/harwex-ide-background.ron`. It logs `[harwex-ide] background mode: activation policy Accessory, activate_ignoring_other_apps false, window inactive`. Verified only by that log line (one run with `--open ... --test-quit`); Spaces and focus cannot be observed from here. The kittest suites never open a window. `docs/testing.md` states the rule for agents.

### Test hooks

The `--test-*` flags in `app/src/testhook.rs` stay. The suites replace them for fixtures, but they are still the only way to smoke-test the real window against a real repository such as harwex-mono, and background mode keys off them.

### Not covered yet

- The real window path: winit events, IME composition, clipboard paste (`RequestPaste`), the rfd folder dialog, window persistence, vsync and startup time.
- The file watcher (tests run without it, because FSEvents timing is not deterministic) and reload of unmodified editors after external edits.
- Go to Type Definition, Cmd+Alt+S, Find in Files "Match case", Stage/Unstage/Delete from the commit context menu, Commit and Push..., force push, Fetch, branch rename/delete, Checkout Revision / Revert / Cherry-Pick from the log, rebase conflicts with the "Upstream (ours)" labels, the merge tab's per-block `>>` / `<<` and hand editing, "Show more" in toasts, terminal selection, copy and mouse reporting, horizontal scrolling in the diff and merge tabs.
- Timing budgets of the app (only `ide-editor`'s benchmark asserts timings).

## breadcrumbs and cwd launch

Checks (run from `rust/harwex-ide`): `cargo test --workspace` and `cargo clippy --workspace --all-targets -- -D warnings` pass.

### Startup folder

- `app/src/launch.rs`: `startup_folder(args, cwd, tty) -> Option<PathBuf>` is a pure function with 5 unit tests. An explicit path argument wins. Without one, a terminal start opens the cwd. A start counts as a terminal start when the cwd is not `/` or stdin/stdout is a TTY. Otherwise it returns `None`, and the app reopens the stored last folder.
- Arguments that start with `-` are not paths. This covers the `-psn_...` argument that older macOS versions pass to apps. Before, any single-dash argument would have been opened as a folder.
- `main.rs` passes the real arguments, `std::env::current_dir()` and `IsTerminal` on stdin and stdout.
- The `.app` launcher from `xtask` (`Contents/MacOS/harwex-ide`) only sets PATH and `exec`s the binary. It does not `cd`. Spotlight and the Dock start it with cwd `/`, so the last folder still reopens.
- `app/tests/launch.rs` (3 tests, 2 snapshots): a terminal cwd beats a stored last folder, cwd `/` without a TTY reopens the last folder, an argument beats both.

### Breadcrumbs

- `app/src/breadcrumbs.rs`, drawn on the left of the status bar. The status bar draws its right part first (branch, language, caret, jobs). The breadcrumbs get the width that is left. The last notification title follows them, truncated.
- Segments: the project root with a folder icon, the directories, the file with a file-type icon. A file outside the project starts at `/`. The file name has its git color. The bar follows the active tab. Editor tabs give their path. Custom tabs can give one through the new `CustomTab::file_path()` (default `None`). Diff tabs return the diffed file; `Source::Commit` now keeps the working-tree path too. Merge tabs return `None`, because they keep a repo-relative path.
- `fit(widths, sep, ellipsis, available)` is pure and has unit tests. It keeps the root and the file. It hides middle segments from the left, so the parents nearest to the file stay. When even `root … file` does not fit, the root goes into the `…` as well.
- A click on a directory segment opens a popup of its children. A click on the file segment opens its siblings. A click on `…` lists the hidden segments. Directories come first. Names have git colors. The child on the active path is selected and has a blue mark on its left edge. Each level is an `egui::Area`. All levels rest on the status bar; see "## breadcrumbs keyboard" for the layout.
- Mouse: hovering a directory row opens its nested popup. Hovering a file row closes deeper levels. A hover only acts when the pointer moved, so it does not fight the keyboard. A click on a file opens it and closes the popup. A press outside the popups and the bar closes them. A second click on the open segment closes the popup too.
- Keyboard (`take_keys` consumes the keys before the editor sees them): Up/Down move in the focused level, Right or Enter on a directory opens it and moves the focus into it, Left goes back one level, Enter on a file opens it, Escape closes.
- Listings run on a worker through `tree::list_dir`, the project tree's lister. So `.gitignore`, `.git/info/exclude` and the global excludes apply, and `.git` is hidden. Each popup open re-lists the directory. A cached listing stays on screen until the new one arrives. Results of an older project are dropped by the project generation.
- Icons are painter shapes: a folder with a tab, a page with a folded corner in the extension color, a two-line chevron for `›`, and three dots for `…`. No glyphs are needed beyond Latin text.
- Test driver: `Ide::resize(size)` changes the window size; `park_mouse` follows it.
- `app/tests/breadcrumbs.rs` (5 tests, 9 snapshots): the bar for a deep file and a modified file, the popup of `src` (dirs first, ignored `src/ignored` left out, `core` selected), nested popups three levels deep by hover, hovering a file closes the deeper level, a click on a file opens it, a click outside and a second click close the popup, file-segment siblings, keyboard Up/Down/Right/Left/Enter/Escape without any key reaching the editor, collapse at 640 px with the `…` popup and a nested popup from it, a diff tab's breadcrumbs and opening a file from them.
- The breadcrumbs changed 28 existing snapshots (every one with an open tab). A pixel diff of each old/new pair showed that only the bar area changed (x 14..312, y 782..795). They were re-recorded.

### Not covered yet

- No speed search (typing to filter) in the popups, unlike IDEA.
- Directory popups of a merge tab: merge tabs show no breadcrumbs.
- The real-window start from Spotlight was not run: the decision function and the launcher script were checked instead.

## breadcrumbs keyboard

Checks (run from `rust/harwex-ide`): `cargo test --workspace` and `cargo clippy --workspace --all-targets -- -D warnings` pass.

### Keys

- Alt+Home (`breadcrumbs::shortcut`, after `terminal::shortcuts`, so a focused terminal skips it) selects the file segment. No popup opens.
- The bar holds egui focus on `breadcrumbs::focus_id()`. It is a zero-size focusable widget with a focus lock on arrows, Tab and Escape. The editor loses focus, and egui cannot move focus with the arrows. Any press elsewhere drops the focus, and `take_keys` then leaves keyboard mode.
- Bar, no popup: Left/Right move `selected_slot` over the slots, `…` included, and stop at the ends. Down or Enter opens the slot's popup. Up or Escape leaves and focuses the editor (`terminal::focus_editor`, now `pub(crate)`).
- Popup: Up/Down wrap. Up on the first row of level 0 closes the popup and selects its segment in the bar. Right on a directory enters it. At level 0, Right on a file (or on a loading or empty list) opens the next segment's popup. Left at level 0 opens the previous one. The current child is preselected there. Left in a nested level goes back. Enter opens a file or enters a directory. Escape closes everything and focuses the editor.
- The same keys work in a popup opened by a click.
- The keyboard selection is drawn as a filled slot with a blue ring and is marked selected in the accessibility tree.
- egui trap: a focus requested in a frame with an arrow press while nothing had focus gets moved by egui's arrow navigation at the end of that frame. `focus_bar` then requests the focus again on the next frame (`refocus`).

### Popup layout

- Every level rests on the top edge of the status bar (`Breadcrumbs::baseline`, set from the status panel rect) and grows upward. Nested levels sit right of their parent and touch it. Positions are computed from the frame's total margin, not from the Area's last-frame size, so the staircase and the clipped rows are gone.
- Height is a whole number of 20 px rows plus padding, at most 18 rows (`MAX_ROWS`), and never above the window top. Longer lists scroll. The clip margin is 0, so `scroll_to_rect` lands on whole rows. The selected row is scrolled into view on open and on every move.
- A chain that leaves the window on the right moves left as a whole, but not past the left edge. A level that still does not fit moves left on its own.
- Area and scroll ids include the level's directory. A hop or a new directory does not inherit the old size or scroll offset.
- The shadow is lifted by half its blur, so it does not darken the status bar.

### Tests

- `app/tests/breadcrumbs.rs` has 12 tests and 22 snapshots now. 7 tests are new:
  - entry and segment moves: Alt+Home, Left/Right with stops at the ends, Up and Escape back to the editor, a click into the editor, Down and Enter open.
  - popup keys: wrap at level 0 and nested, Up to the bar, Right enters, Right on a file does nothing, Left backs out, hops right and left down to the root, hops up to the file segment, Escape, Enter opens a file.
  - `…`: selected by the keyboard, its popup, entering, hopping to the root and back.
  - after a click: hop, Up to the bar, Right in the bar. Alt+Home is ignored while a terminal has focus.
  - layout on a harwex-mono-deep fixture (`javascript/packages/infrastructure/di/src/index.js`, levels of 5, 6, 8, 3, 4 and 30 items): six levels all end on the status bar, touch each other, show every row, and the 30-item level shows exactly 18 rows with `index.js` visible. A pixel check of `layout_chain.png` found every popup's bottom border on y = 775, right above the status bar.
  - long list: 18 rows, the selection stays visible down to the last row and after the wrap to the top.
  - right edge: a 3-level chain in a narrow window ends on the right edge and stays connected.
- Each test checks that the editor text did not change. It also checks that the caret did not move, and that the editor gets the keyboard back afterwards.
- The old keyboard test now expects Down to wrap. 7 old popup snapshots were re-recorded for the new layout.

### Not covered yet

- No speed search in the popups.
- A selected directory with a git color stays dim on the blue selection.

