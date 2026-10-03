# ide-git

Git logic for the IDE's IDEA-style Git UI: status, commit of a file subset, diffs, gutter line changes, log and graph, blame, branches, remote, stash and conflicts. No UI.

## Boundaries

- Never depend on egui. No UI strings beyond git's own output. The app turns `CommandOutcome` into toasts.
- Every function blocks. The app calls them only from worker threads.
- Never reimplement a git write in libgit2. See the split below.

## The libgit2 / CLI split, and why

- Reads use libgit2 (`git2`, no default features: no openssl, no ssh). Reads are fast and need no child process.
- Every write to the index or the worktree uses the `git` CLI: stage, rollback, commit, checkout, stash, reset, revert, cherry-pick, resolve. So do all network commands. The CLI runs hooks, credential helpers, SSH agents and clean/smudge filters. harwex-mono uses git-lfs, and libgit2 would write LFS pointer files into the worktree. Only `unstage` uses libgit2, because it touches the index only.
- The CLI runs with `GIT_TERMINAL_PROMPT=0`, `GIT_EDITOR=true`, `GIT_SEQUENCE_EDITOR=true` and a null stdin. A command must fail, never hang waiting for input.
- Paths go to the CLI as `:(literal)` pathspecs in chunks of 500. Do not use `GIT_LITERAL_PATHSPECS`: it breaks the cleanup in `git stash -u`.
- The git binary: `HARWEX_GIT`, then `PATH`, then `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`. A GUI app on macOS gets a minimal PATH.

## Contract

- `Repo` stores the canonical workdir plus an optional command sink, and is `Send + Sync`. Each call opens its own `git2::Repository`, because that type is not `Sync`.
- Input paths may be absolute (also through `/var` symlinks, also for deleted files) or relative to the workdir. Returned paths are relative to the workdir.
- Lines are 0-based. Inline diff ranges are char columns.
- `commit(message, paths, amend)` commits exactly `paths`. Other staged changes stay staged. A rejected commit (hook failure) returns `Ok` with `success() == false` and the stderr.
- `commit_selection(message, whole, staged_only, amend)` also commits the index version of `staged_only` (a partly staged file without its unstaged rest). It builds the commit in a temporary index (`GIT_INDEX_FILE=.git/HARWEX_COMMIT_INDEX`): HEAD, plus the real index entries of `staged_only`, plus the worktree of `whole`. Hooks see that index. Afterwards `whole` is staged in the real index, like `--only` does.
- A failed CLI command returns `CommandOutcome` with `success == false` or `Error::Command`. Keep stderr: the UI shows it.
- Every CLI run goes through `cli::git_run`, which reports a start and a finish `CommandEvent` (same `id`) to the sink from `set_command_sink`. Clones share the sink. libgit2 reads are not reported.
- `LogFilter` lists (`branches`, `authors`, `paths`) match when any entry matches. Empty `branches` walks HEAD plus all branches.
- A commit selection (`changes_of`, `diff_commits_file`, `patch`): a first-parent chain is one tree diff from the oldest commit's parent; anything else is merged per path in history order. `patch` is `git diff --binary --full-index -M`; `cherry_pick_paths` pipes it to `git apply --3way --index`.
- Push takes a local branch: `push_branch(name, force_with_lease, set_upstream)`, `outgoing_of(name)` and `push_target(name)` (the branch's upstream, else the default remote under the same name). They never check out. `push` and `outgoing` are the current-branch shortcuts.
- Graph lines longer than `LONG_EDGE_ROWS` (30) rows are cut into two one-row stubs with `GraphRow.arrows`; between them the line holds no lane.
- Diffs (`similar`, patience) have a 1.5 s line-diff deadline. Word ranges are computed only for blocks of at most 400 lines.

## Test

```sh
cargo test -p ide-git
cargo test -p ide-git --test large_repo -- --nocapture   # status/log budgets on a generated large repo
```

Tests build throwaway repositories in a temp dir (`tests/common`). The helpers set fixed dates and `GIT_EDITOR=true`. New behaviour gets a temp-repo test, including a bare remote for network commands. `large_repo` builds 4000 files and about 1400 commits with merges through `git fast-import` and asserts the status and log budgets. The UI side is covered by `cargo test -p harwex-ide --test git_changes` and `--test git_history`.

## Traps

- `git commit --only` needs paths that git knows. New files are `git add`-ed first.
- During a merge, cherry-pick or revert, git forbids a partial commit. The selection is staged and the whole index is committed.
- `push_branch` sends `refs/heads/<name>:refs/heads/<upstream>` explicitly, so a user's `push.default` cannot make it fail and a branch that is not checked out pushes too.
- A branch that tracks a local branch (`branch.<name>.remote = .`) has no push upstream; pushing to `.` would move that local branch. `push_target` treats it as untracked.
- `pull` passes `--autostash`, so a dirty tree does not block a rebase update.
- Worktree renames are not detected (deleted + unversioned, like IDEA). Detecting them means reading every untracked file.
- Diffs read the raw blob. For LFS-tracked text files the HEAD side shows the pointer text.
- Diffs compare lines without terminators, so CRLF and a missing final newline do not show as changes. A line-ending-only change is therefore invisible.
- `blame` uses `git blame --porcelain`. libgit2 blame is much slower.
- A regex `$` must match the end of the message, so the text filter matches the message without its trailing newline.
- `patch` forces `--no-textconv --no-ext-diff --no-relative --src-prefix=a/ --dst-prefix=b/`: user config (textconv, `diff.noprefix`) would make the patch unappliable.
- A root commit's base is the empty tree id (`Oid::hash_object`); git knows it without storing it.
- Stash indices shift when a new stash is made. Callers resolve an entry by oid.
- A stash's untracked files sit in the stash commit's third parent. `commit_details(&entry.oid)` does not list them.
