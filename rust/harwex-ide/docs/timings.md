# Timings

Read this file when a change touches a hot path and you need the budget or a reference number to compare with. Numbers are from Apple Silicon, release builds. Update a number when you measure it again. Do not add a history of old numbers.

## Asserted budgets (a regression fails the test)

| What | Budget | Test |
|---|---|---|
| keystroke (edit + highlight on the UI thread), avg of 1000 | < 4 ms | `cargo test -p ide-editor --release --test bench -- --nocapture` |
| editor steady frame | < 4 ms | same |
| editor typing frame | < 8 ms | same |
| editor jump-scroll frame (nothing cached) | < 12 ms | same |
| find bar: frame while typing a query (search on a worker) | < 8 ms | same |
| find bar: steady frame with 100k matches | < 4 ms | same |
| find bar: typing frame in the text with 100k matches (incremental update) | < 8 ms | same |
| 10k carets: steady frame | < 4 ms | same (`bench_10k_carets`) |
| 10k carets: typing frame / Backspace frame, avg | < 8 ms / < 8 ms | same |
| warm Go to Declaration in Rust | < 500 ms | `cargo test -p harwex-ide --test rust_nav` |
| git status warm / log page of 200 / log at skip 1000, generated 4000-file repo | < 150 / 100 / 100 ms | `cargo test -p ide-git --test large_repo` |
| TS cold / warm definition, source definition, references, generated 1240-file workspace | < 15 s / 50 ms, < 3 s, < 5 s | `cargo test -p ide-ts --test workspace` |
| file rename preview (pre-filter + loading 30 importer projects + edits), generated 200-project workspace, warm server | pre-filter < 500 ms; native < 2 s, tsserver < 8 s | `cargo test -p ide-ts --test rename_budget -- --nocapture` |
| UI frame while a rename preview loads 30 projects (tsserver, 60 projects) | < 250 ms worst frame (parallel suite) | `cargo test -p harwex-ide --test project_menu rename_preview_keeps_frames_fast` |
| one memory indicator sample (thread CPU time, median of 30) | < 0.5 ms | `cargo test -p harwex-ide --test memory sampling_cost -- --nocapture` |

The benchmark file has 200k lines (4.2 MB of TypeScript).

## Reference numbers

Editor benchmark: keystroke 0.11 ms avg (max 3.5 ms), steady frame 0.02 ms, jump-scroll frame 0.40 ms avg (max 4.8 ms), typing frame 0.28 ms avg (max 1.8 ms), open 17 ms, full tree-sitter parse 238 ms (on a worker), reparse after edits 18 ms (on a worker).

Find bar on the same file: query typing frame 0.10 ms avg (max 0.13 ms), search for an 11-match query 1.8 ms (worker, until the result is shown), capped search of a one-letter query 3.0 ms (100k matches, worker), steady frame with 100k matches 0.19 ms, typing frame in the text with 100k matches 0.51 ms avg (max 1.8 ms).

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

ide-git on the generated repo (`cargo test -p ide-git --test large_repo -- --nocapture`, debug, 4000 files, 1441 commits): status 22 ms cold, 18 ms warm. Log page of 200: 7 ms, at skip 1000: 8 ms. Graph of 200 rows: 0.1 ms.

TypeScript on the generated workspace (`cargo test -p ide-ts --test workspace -- --nocapture`, 1240 files): cold definition 72 ms native / 490 ms tsserver, warm under 0.4 ms, references with 2401 results 89 ms / 195 ms.

File rename on the generated monorepo (`cargo test -p ide-ts --test rename_budget -- --nocapture`, debug, 1002 files in 201 projects, 30 importers): pre-filter 13 ms over 1002 code files (31 candidates), whole preview 59 ms native / 0.9 s tsserver, 31 projects loaded, 31 files changed. In the app (`project_menu`, tsserver, 60 projects): preview about 1 s, worst UI frame under 1 ms when the test runs alone.

Memory indicator: one sample of 9 processes costs 113 µs of CPU in release (137 µs in debug), with about 1140 processes on the machine. Each `proc_listchildpids` call scans every process, so the cost grows with the number of processes in the walked tree. Terminal subtrees are not walked.

Terminal: about 110 MB/s through the PTY and the emulator, at 120 fps in a window. Measure with `yes | head -c 50000000 | cat`. Without `cat`, macOS `head` limits the run to about 5 MB/s.
