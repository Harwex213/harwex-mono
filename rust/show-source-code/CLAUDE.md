# show-code-source

A desktop app (Rust, egui/eframe 0.31 on wgpu) that shows a yarn + TypeScript monorepo as one zoomable canvas: packages are boxes, source files are cards with their code, package dependencies are arrows. `show-code-source [path]` opens `path` (default: the current directory).

The architecture copies `rust/harwex-ide`; its `CLAUDE.md` explains the reasons behind these rules.

## Crates and their direction

- `app` (binary `show-code-source`, library `show_code_source`): the window, the camera, and the canvas painter. The canvas uses egui's `Painter` directly, not widgets.
- `crates/scs-workspace`: finds packages from the root `package.json` `workspaces`, reads source previews, and builds package edges from package.json deps. It works without node. `fixture.rs` holds the demo monorepo for tests.
- `crates/scs-layout`: pure geometry. It packs cards, lays out packages Sugiyama-style per connected component, and routes the arrows. It has no egui and no disk access.
- `crates/scs-ts`: the tsserver client. It resolves cross-package imports to files and caches the results.

Library crates never depend on `app`. Only `app` depends on egui. egui and eframe come only from `[workspace.dependencies]`.

## Rules

- Never block the UI thread. Disk work and tsserver run as `jobs::Jobs::spawn` workers, and results come back as closures over `State`.
- Every color and size lives in `app/src/theme.rs` (`T`). No `Color32` literals elsewhere.
- Font sizes on the canvas go through `canvas::quantize`. Each distinct size fills the font atlas again.
- The app must work without node or TypeScript. tsserver only adds to the package graph from package.json.
- Never write an absolute user path into code, tests or docs (`app/tests/no_machine_paths.rs` checks).
- Do not run the real window from an agent. Use the headless tests or `--stats`.
- Do not commit, do not `git add`, do not write README files.

## Run

```sh
cargo run --release -p show-code-source -- <monorepo>          # the window
cargo run --release -p show-code-source -- <monorepo> --stats  # counts and timings, no window
cargo install-app                                              # puts show-code-source on PATH
```

## Test

```sh
perl -e 'alarm 1800; exec @ARGV' cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

- Snapshots: the `egui_kittest` suites in `app/tests/` render the demo fixture headlessly at 1280x800 in deterministic mode with tsserver off. The goldens are `app/tests/snapshots/<suite>/<name>.png`. `UPDATE_SNAPSHOTS=1 cargo test -p show-code-source --test canvas` rewrites them. Look at every changed PNG before you keep it.
- The fixture is rebuilt per test under the system temp dir (`show-code-source-kittest/<test>`). This keeps its path stable.
- `crates/scs-ts/tests/tsserver.rs` runs the real tsserver. It needs node and a `typescript` package: set `SCS_TYPESCRIPT_DIR`, or it uses harwex-mono's `javascript/node_modules/typescript`. Without them it passes and does nothing.
- Real repo, headless: `SCS_REAL_REPO=<abs path> [SCS_REAL_REPO_OUT=<png>] [SCS_REAL_REPO_TS=1 SCS_TEST_WAIT_SECS=900] [SCS_REAL_REPO_ZOOM=0.12 | SCS_REAL_REPO_PACKAGE=<name>] cargo test -p show-code-source --test real_repo -- --nocapture`. It writes a PNG that is not compared with anything.

## Traps

- Scale: a real repo has 665 packages and 170k files. Discovery collects only paths and sizes. It counts lines exactly only up to `EXACT_LINES_UP_TO` files, and estimates them from the file size above that. Card text is read lazily (`State::texts`), only for cards on screen at bar or text zoom.
- egui puts a whole frame into one vertex buffer and one index buffer, and wgpu refuses buffers over 256 MB. `canvas::Budget` caps the cards, text lines, bars and edge points drawn per frame, and far zoom draws packages as plain boxes. `app/tests/huge.rs` (700 x 300 synthetic) asserts the tessellated size. Keep it green whenever you add drawing.
- `scs_workspace::find_root` resolves the folder the user names. Inside a workspace, it walks up to the nearest `workspaces` root. Above one, it takes the broadest workspace root found below. Otherwise it uses the folder itself.
- Crossing counts use a Fenwick tree. The pairwise test takes minutes on 10k edges.

- The tsserver import cache is in `<temp>/show-code-source/imports-<hash>.json`. Its entries are keyed by the importing file's size and mtime. A changed package entry point is not noticed; delete the file.
- Imports that no package.json declares get a direct S-curve (orange, dashed). It can cross other boxes because the layout did not plan it.
