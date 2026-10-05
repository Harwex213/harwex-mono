# ide-ts

The client for TypeScript's own servers: `tsserver` (TypeScript 6 and older, run with node) and the native TypeScript 7 server (`tsc --lsp --stdio`, or `tsgo` from `@typescript/native-preview`). It powers Go to Declaration, Source Definition, Type Definition, Find Usages and hover for JS/TS, also into `node_modules` and workspace packages.

## Boundaries

- Never depend on egui.
- Never reimplement module resolution, a parser or a type model (architecture rule 3). The server already follows `paths`, `exports`, workspaces and `node_modules`.
- LSP mechanics (framing, JSON-RPC, sync, restart) live in `ide-lsp`. The native backend in `src/lsp.rs` is only an adapter: the command, the capabilities, the line-break rules and the error mapping.

## Contract

- All calls block. `TsService` is `Clone + Send + Sync`, and clones share the processes. The app calls it from its language queue thread.
- Positions are 0-based lines and char columns in the API. tsserver is 1-based with UTF-16 offsets. LSP is 0-based with UTF-16 columns. Convert only in `src/position.rs`, using the line text. Result positions use the target file's text: the editor text for open files, the disk text otherwise.
- Returned paths are canonical. The app keys tabs by canonical path.
- One server per installation and project root, started lazily (rules 5 and 6). The native server is preferred. `set_backend_preference` picks tsserver for comparisons.
- Every request has a timeout (default 5 s) and returns `Error::Timeout` instead of hanging. A dead server restarts on the next call and gets every open file back with its last editor text, unsaved edits included.
- A position request on a file the editor never opened opens it from disk. Otherwise the server answers "No Project".
- "No content available" returns `Ok(empty)` or `Ok(None)`, not an error.
- `diagnostics(path)`: tsserver `syntacticDiagnosticsSync` + `semanticDiagnosticsSync` + `suggestionDiagnosticsSync` (tsserver runs with `--suppressDiagnosticEvents`, so no events), or the native server's pull. Hints that are not unused code (refactoring suggestions) are dropped on both backends.
- `kill_server_for` is for tests only.
- File renames: `edits_for_file_rename(old, new, candidates)` before the move (edited paths are old paths), `files_renamed` / `files_deleted` after. `file_references(path, candidates)` lists importers. `import_candidates` is the text pre-filter (stem, folder for `index`, package name for a package entry) over code files; one file per candidate project is opened first.

## Test

```sh
cargo xtask test-tools                                   # once: pinned TypeScript 5.9.3 and 7.0.2 in target/tools/
cargo test -p ide-ts
cargo test -p ide-ts --test ts workspace:: -- --nocapture     # navigation timings on a generated workspace
```

- The suites link TypeScript from `target/tools/` through `ts5()` / `ts7()` in `tests/common/mod.rs`. `HARWEX_TEST_TS5` and `HARWEX_TEST_TS7` override them (each a `typescript` package dir; TS 7 needs its platform package beside its real dir).
- The test files are modules of one binary, `tests/ts/main.rs` (`--test ts <module>::`). `tests/ts/rename_budget.rs` generates 200 projects with 30 importers of one file and asserts the rename preview budget on both backends.
- `tests/ts/tsserver.rs` links TypeScript 5 into a temp project with a `node_modules/fake-lib` fixture. `tests/ts/native_lsp.rs` links TypeScript 7, and TypeScript 5 as `@typescript/old`. `tests/ts/workspace.rs` generates 40 linked `@ws/*` packages and a `.d.ts` + `.js` dependency, and asserts loose timing budgets for both backends.
- A missing node or install prints `skipping: ...` with the hint to run `cargo xtask test-tools`, and the test passes. `cargo xtask clean-check` fails on such a line.
- `HARWEX_NODE` overrides the node lookup. The app suite `cargo test -p harwex-ide --test app navigation::` covers the UI side.

## Traps

- TypeScript 7 has no `lib/tsserver.js`. The locator reads `typescript/package.json` and finds the native executable the way `getExePath.js` does. `@typescript/old` provides a tsserver next to TS 7.
- Finding node through the login shell costs about 490 ms. The app warms `find_node()` once on a worker at startup.
- tsserver (TS 5.9) leaves `Reference::is_definition` false even for the declaration. Do not group usages by it.
- The native server rejects `shutdown` with `null` params. Send it without params.
- `initialize` waits at least 10 s, so a small request timeout cannot break the handshake.
- A cold tsserver on the big `mono` repository takes 13-14 s. The app's request timeout is 20 s. The native server takes about 1.2 s.
- `change` sends the full text. A request holds the server's state lock while it writes to stdin, so a huge `change` briefly blocks other callers of the same server.
- A server only answers file renames for projects it has loaded. In a monorepo an importer in an unopened package is missed unless a file of its project is opened first; that is what the candidates are for.
- TypeScript 7 answers `workspace/willRenameFiles` only when the client declares `workspace.fileOperations.willRename`.
- tsserver's `fileReferences` takes one file. A folder goes through a probe `getEditsForFileRename`.
- ropey and TypeScript disagree on VT, FF and NEL line breaks. Positions after a form feed are one line off.
