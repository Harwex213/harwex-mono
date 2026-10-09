# Timings

Read this file when a change touches a hot path and you need the budget or a reference number to compare with. Numbers are from Apple Silicon, release builds. Update a number when you measure it again. Do not add a history of old numbers.

## Asserted budgets (a regression fails the test)

| What | Budget | Test |
|---|---|---|
| keystroke (edit + highlight on the UI thread), avg of 1000 | < 4 ms | `cargo test -p ide-editor --release --test editor bench:: -- --nocapture` |
| editor steady frame | < 4 ms | same |
| editor typing frame | < 8 ms | same |
| editor jump-scroll frame (nothing cached) | < 12 ms | same |
| find bar: frame while typing a query (search on a worker) | < 8 ms | same |
| find bar: steady frame with 100k matches | < 4 ms | same |
| find bar: typing frame in the text with 100k matches (incremental update) | < 8 ms | same |
| 10k carets: steady frame | < 4 ms | same (`bench_10k_carets`) |
| 10k carets: typing frame / Backspace frame, avg | < 8 ms / < 8 ms | same |
| 10k problem underlines: steady frame / jump-scroll frame | < 4 ms / < 12 ms | same (`bench_10k_problems`) |
| identifier under the caret (2000 occurrences shown): steady / caret move / typing frame | < 4 / 8 / 8 ms | same (`bench_occurrences`) |
| soft wrap, 100k-line Markdown: steady / jump-scroll / wheel scroll / typing / sweep and resize frames | < 4 / 12 / 8 / 8 / 12 ms | same (`bench_wrapped_markdown`) |
| soft wrap, one 2 MB line: steady / typing / Down frame | < 4 / 8 / 8 ms | same (`bench_wrapped_giant_line`) |
| 200k-line C++ file (Unreal-style macros): keystroke / steady / typing / jump-scroll frame | < 4 / 4 / 8 / 12 ms | same (`bench_200k_lines_cpp`) |
| warm Go to Declaration in Rust | < 500 ms | `cargo test -p harwex-ide --test app rust_nav::` |
| git status warm (fastest of 3, git CLI) / log page of 200 / log at skip 1000, generated 4000-file repo | < 300 / 100 / 100 ms | `cargo test -p ide-git --test git large_repo::` |
| TS cold / warm definition, source definition, references, generated 1240-file workspace | < 15 s / 50 ms, < 3 s, < 5 s | `cargo test -p ide-ts --test ts workspace::` |
| file rename preview (pre-filter + loading 30 importer projects + edits), generated 200-project workspace, warm server | pre-filter < 500 ms; native < 2 s, tsserver < 8 s | `cargo test -p ide-ts --test ts rename_budget:: -- --nocapture` |
| UI frame while a rename preview loads 30 projects (tsserver, 60 projects) | < 250 ms worst frame (with the other tests of the `app` binary in parallel) | `cargo test -p harwex-ide --test app project_menu::rename_preview_keeps_frames_fast` |
| ESLint and oxlint, generated 200-package monorepo: warm per-file lint after an edit (median) / cold first diagnostics | < 300 ms without types, < 1 s type-aware / < 20 s | `cargo test -p harwex-ide --test app lint_budget:: -- --nocapture` |
| one memory indicator sample (thread CPU time, median of 30) | < 0.5 ms | `cargo test -p harwex-ide --test app memory::sampling_cost -- --nocapture` |

The benchmark file has 200k lines (4.2 MB of TypeScript).

## Reference numbers

Editor benchmark: keystroke 0.11 ms avg (max 3.5 ms), steady frame 0.02 ms, jump-scroll frame 0.40 ms avg (max 4.8 ms), typing frame 0.28 ms avg (max 1.8 ms), open 17 ms, full tree-sitter parse 238 ms (on a worker), reparse after edits 18 ms (on a worker).

Find bar on the same file: query typing frame 0.10 ms avg (max 0.13 ms), search for an 11-match query 1.8 ms (worker, until the result is shown), capped search of a one-letter query 3.0 ms (100k matches, worker), steady frame with 100k matches 0.19 ms, typing frame in the text with 100k matches 0.51 ms avg (max 1.8 ms).

Identifier under the caret on the same file (`label`, 40k hits, capped at 2000): the worker answers within the first frames, steady frame 0.07 ms, caret move frame 0.09 ms, typing frame in the identifier 0.25 ms (a new worker search per keystroke).

10k carets on the same file (one every 20 lines): steady frame 0.11 ms, typing frame 4.6 ms avg (max 6.8 ms), Backspace frame 6.7 ms avg (max 26 ms when a finished parse made the rope shared), undo of 21 steps in one frame 130 ms, full reparse after the edits 250-700 ms (worker). Select All Occurrences of a word with 40k hits 2.2 ms, then one typing frame at 40k carets 37 ms.

App on harwex-mono (about 9200 indexed files):

| Step | Time |
|---|---|
| process start to first frame | 140-360 ms. Warm runs meet the 300 ms goal, cold runs do not. Almost all of it is eframe and wgpu setup |
| file index (parallel walk) | 22-37 ms warm, about 100 ms cold |
| git status + branch (worker) | 100-200 ms |
| first Go to Declaration, tsserver (TS 5.9) | 0.7-1.0 s |
| warm Go to Declaration | under 4 ms |
| Find in Files, 275 hits | 233 ms |
| idle CPU | 0 % |

TypeScript servers on a large repository with TypeScript 7:

| Request | Native server cold / warm | tsserver (TS 6) cold / warm |
|---|---|---|
| first `definition` | 1.2 s / 0.14 ms | 13.4 s / 0.31 ms |
| `references` with 807 results | 126 ms | 810 ms |

The app's request timeout is 20 s. A cold tsserver on a big repository comes close to that limit.

rust-analyzer on this workspace: the first cold request waits for the workspace load, about 17-20 s with an empty `target/rust-analyzer`, and about 4 s on the next start. Warm requests take about 0.2 ms.

ide-git on harwex-mono: status 343 ms cold, 90-103 ms warm (`git status` itself takes 73 ms). First log page of 200: 8 ms. Log page at skip 1000: 3 ms. Graph of 152 rows: 13 µs.

Git refresh on a `git clone --local` copy of mono (484,662 files, release build, task 067): full status + branch 14-17 s (the CLI; libgit2 took 19-23 s). Stage of 2 files to updated Commit window 0.52 s, Commit of 2 files 4.6 s (`git commit` itself 4.5 s), status of 1-2 paths 0.10-0.11 s. The `.git` events of our own writes and a stat-only index rewrite run no status; an outside `git add` runs one full status.

Git refresh on mono itself, read-only (500,334 index entries, 112 MB index, release, `cargo test --release -p ide-git --test git large_repo::bench_external_repo -- --ignored --nocapture` with `HARWEX_GIT_BENCH_REPO`, task 100): full status 12.1-12.4 s on a quiet machine (15-23 s while other agents build); of it the untracked walk 9.8 s and the lstat of all entries 2.1 s; `-uno` 2.4 s. The incremental status after a HEAD or index change: `changed_paths` 0.4-0.75 s (18-153 paths), `status_of` of those 0.17-1.7 s, the stamp 0.7 s beside them; about 1-2 s against the 12 s walk that ran before after every checkout, merge, rebase, pull, stash, reset, fetch and outside commit. `status_of` costs about 4 ms per file pathspec there; 190 directory pathspecs took 7.5 s.

ide-git on the generated repo (`cargo test -p ide-git --test git large_repo:: -- --nocapture`, debug, 4000 files, 1441 commits): status 55 ms cold, 48 ms warm through the git CLI (22 and 18 ms with libgit2 before task 067; the CLI pays one process start). Log page of 200: 7 ms, at skip 1000: 8 ms. Graph of 200 rows: 0.1 ms.

TypeScript on the generated workspace (`cargo test -p ide-ts --test ts workspace:: -- --nocapture`, 1240 files): cold definition 72 ms native / 490 ms tsserver, warm under 0.4 ms, references with 2401 results 89 ms / 195 ms.

File rename on the generated monorepo (`cargo test -p ide-ts --test ts rename_budget:: -- --nocapture`, debug, 1002 files in 201 projects, 30 importers): pre-filter 13 ms over 1002 code files (31 candidates), whole preview 59 ms native / 0.9 s tsserver, 31 projects loaded, 31 files changed. In the app (`project_menu`, tsserver, 60 projects): preview about 1 s, worst UI frame under 1 ms when the test runs alone.

10k problem underlines on the same file (every 20 lines, all four severities): steady frame 0.14 ms, jump-scroll frame 0.45 ms.

C++ benchmark (`bench_200k_lines_cpp`, 200k lines, 4.1 MB, an Unreal class every 20 lines): first open 36 ms (about 30 ms of it compiles the C++ highlight query, once per process; the app opens files on a worker), open 6 ms, full parse 0.7-1.1 s and reparse after edits 1.3 s (both on a worker), keystroke 0.07 ms avg (max 0.27 ms), steady frame 0.02 ms, jump-scroll frame 0.29 ms avg (max 0.40 ms), typing frame 0.29-0.34 ms avg (max 3.2 ms).

Soft wrap on a generated 100k-line Markdown file (9.6 MB, 160 columns): first frame 3.4-4.1 ms, then 9 sweep frames of 2.3 ms that count every line's rows, steady frame 0.03 ms, jump-scroll frame 0.30 ms avg (max 0.40 ms), wheel scroll frame 0.10 ms, typing frame 0.20 ms avg (max 0.30 ms), resize frame 2.5 ms avg (max 2.8 ms) followed by 9 sweep frames. One 2 MB line (about 13k rows): steady frame 0.06 ms, typing frame 3.9 ms avg (max 8 ms, a full re-wrap of the line per keystroke), Down 0.21 ms. The same line without wrap: steady 2.9 ms, typing 5.0 ms.

Diagnostics on the `mono` repository (read-only, three files in three packages, unsaved edits that add one TS error each):

| | TS server (TS 7.0.2 native, pull) | oxlint 1.77 LSP, type-aware | oxlint 1.77 CLI `--type-aware --type-check` |
|---|---|---|---|
| TS errors found (of 3) | 3 (2322, 2345, 2339) | 0: the server has no type check, and all 3 edited buffers crash it (panic in `disable_fix.rs:52`) | not comparable: reads the disk only; on the unchanged files 0 errors, like the TS server |
| cold start | initialize 44 ms, first file 74 ms, all three 1.1 s | first file 6.1 s (loads the JS configs of 616 packages), all three 7.6 s | 0.17-1.5 s per run |
| memory | 1.07 GB phys_footprint (the server navigation already uses) | 0.30 GB (node); tsgolint runs per request | up to 1.09 GB max RSS per run (tsgolint) |

Linters on the generated monorepo (`cargo test -p harwex-ide --test app lint_budget:: -- --nocapture`: 200 packages with 5 files each, a per-package `eslint.config.mjs` from a shared root module, `@eslint/js` recommended + typescript-eslint recommended, or `recommendedTypeChecked` with `projectService`; one root `.oxlintrc.json`). Memory is the phys_footprint of the linter's process tree: every process below the test process, so the numbers hold only when the filter runs this suite alone.

| | cold first file (process start included) | cold file in a 2nd package | warm per file after an edit | memory, 1 / 22 packages | memory after all files closed |
|---|---|---|---|---|---|
| ESLint 10.12, no types | 360 ms | 9 ms | 5 ms | 270 / 315 MB | 315 MB |
| ESLint 10.12 + typescript-eslint 8.71, `projectService` | 470 ms | 55 ms | 11 ms | 350 / 450 MB | 450 MB (heap 190 → 85 MB) |
| oxlint 1.77, no types | 45 ms | 1 ms | 1 ms | 24 / 24 MB | 24 MB |
| oxlint 1.77 + tsgolint, type-aware | 50 ms | 11 ms | 11 ms | 24 / 24 MB | 24 MB |

After the last close the ESLint server drops its instances and TS projects; the V8 heap shrinks, the process keeps its pages until the idle stop. `import-x/no-cycle` (eslint-plugin-import-x 4.17, measured by hand, not pinned): on the shallow graph +20 ms cold, warm unchanged; on a 200-file import cycle +56 ms cold, warm 2.4 ms instead of 1.4 ms, because the import graph stays cached in the process.

Budgets: none asserted for the cold start on a real repository, because it depends on the workspace. The editor stays in the frame budgets above with any number of problems.

Memory indicator: one sample of 9 processes costs 113 µs of CPU in release (137 µs in debug), with about 1140 processes on the machine. Each `proc_listchildpids` call scans every process, so the cost grows with the number of processes in the walked tree. Terminal subtrees are not walked.

Terminal: about 110 MB/s through the PTY and the emulator, at 120 fps in a window. Measure with `yes | head -c 50000000 | cat`. Without `cat`, macOS `head` limits the run to about 5 MB/s.

Test binaries (`cargo test --workspace`, debug, warm target dir, 16 cores; `docs/testing.md`, "Test binaries"):

| | one binary per test file | merged (`tests/<name>/main.rs`) |
|---|---|---|
| test executables / integration binaries | 61 / 53 | 17 / 9 |
| `cargo test --workspace --no-run` after a one-line change in `app/src` | 5.5-7.9 s | 1.9-3.0 s |
| `cargo test --workspace` | 127 s (the binaries run one after another) | 59 s (the `app` binary 31 s, `editor` 14 s) |
| `cargo xtask nextest --workspace` | 46 s | 43 s |
