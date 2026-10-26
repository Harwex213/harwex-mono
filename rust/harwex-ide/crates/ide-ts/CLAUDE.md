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
- A server answers only for the projects it has loaded (one per `tsconfig.json`). Every question that crosses packages takes candidate files from a text pre-filter, and one file per candidate project is opened first. Plain `references` searches only the loaded projects.
- File renames: `edits_for_file_rename(old, new, candidates)` before the move (edited paths are old paths), `files_renamed` / `files_deleted` after. `file_references(path, candidates)` lists importers. `import_candidates` is their pre-filter: the stem, the folder for `index`, and the package name for a package entry or an `exports` target.
- Find Usages and Rename Symbol (task 121): `symbol_scope` (Go to Declaration, then the kind) says where a symbol is declared and whether it is exported. A local, a parameter, or a module-level name that no `export` statement names is not exported; a member counts as exported. `symbol_candidates` keeps the files that contain the name and one of `visibility_needles`: the import needles of the declaration and of the files of its package that re-export it (`export { x } from`, `export *`), transitively. `references_across` and `rename_symbol` then load the candidate projects and ask. They wait until each project is loaded (tsserver `projectInfo`, a native hover), poll `Loading::cancelled` between projects and report `Loading::progress(checked, total)` over the candidate projects, the anchor's included. A project counts as loaded while its server still has the file opened for it, so a second search loads nothing.
- Package scope (task 123): `symbol_candidates` takes a `PackageGraph` (`build`/`from_files` over `package.json` paths: names, folders and `dependencies`/`devDependencies`/`peerDependencies`/`optionalDependencies` edges, `npm:` aliases and `link:`/`file:` paths; no contents; a manifest with `workspaces` is a root, not a package). It reads only the files outside any package, the files of the packages of the re-export chain and of their direct dependents. A dependent file that re-exports the symbol by package name (`export { x } from "@ws/a"`, `export *`) joins the chain, and the next round reads its dependents too (at most 8 rounds). A declaration outside any package or in `node_modules`, an empty graph, or a symbol that 2/3 of 100+ packages see (there the split by package costs more than it saves) reads every code file as before. `SymbolCandidates` says how many files and packages it read.
- Streaming (task 123): `references_streaming(.., loading, &Stream { found, loaded_asked })` asks the loaded projects first (unless the caller already asked `references`), then loads the candidate projects one by one and hands each batch of new usages (deduped, sorted) to `found`. It asks again after a load only when the loads since the last question took `ASK_RATIO` (2) times that question; the last project is always asked. A cancel or an error ends it; delivered batches stay valid. `references_across` is the collecting wrapper.

## Test

```sh
cargo xtask test-tools                                   # once: pinned TypeScript 5.9.3 and 7.0.2 in target/tools/
cargo test -p ide-ts
cargo test -p ide-ts --test ts workspace:: -- --nocapture     # navigation timings on a generated workspace
```

- The suites link TypeScript from `target/tools/` through `ts5()` / `ts7()` in `tests/common/mod.rs`. `HARWEX_TEST_TS5` and `HARWEX_TEST_TS7` override them (each a `typescript` package dir; TS 7 needs its platform package beside its real dir).
- The test files are modules of one binary, `tests/ts/main.rs` (`--test ts <module>::`). `tests/ts/rename_budget.rs` generates 200 projects with 30 importers of one file and asserts the rename preview budget on both backends.
- `tests/ts/usages_across.rs` generates four packages (an `index.ts` re-export, an `exports` subpath, an unrelated same-named symbol) and checks Find Usages and Rename Symbol across them on both backends. `tests/ts/usages_scoped.rs` generates a utils package that 20 packages list, a narrow package with one dependent and a package with same-named symbols, and checks the package scope, the streamed batches and a cancel after the first batch on both backends. `tests/ts/mono_usages.rs` is a manual, ignored measurement on a real monorepo (`HARWEX_MONO_ROOT`, `HARWEX_MONO_USAGES`, `HARWEX_MONO_MODE=before` for the task 121 flow, `HARWEX_MONO_SCAN_ONLY=1` for the pre-filter alone); without them it does nothing.
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
- The native server renames with aliases by default: at a re-export it writes `export { newName as oldName }`, and importers in other packages keep the old name. `lsp.rs` answers `workspace/configuration` with `preferences.useAliasesForRenames: false`.
- The package scope trusts `package.json`: a package that imports a workspace package it does not list (hoisted `node_modules`, a relative path or a tsconfig `paths` alias into another package) is not read, so its usages are missed. A member reached through a type of another package (`c.make().method()` without an import of the declaring package) is missed too, as before the scope.
- In the pre-filter, hash folders as `&OsStr`, never `Path`/`PathBuf`: `Path` hashing walks components, and the package lookup over 220k files of `mono` cost a second.
- TypeScript 7 answers `workspace/willRenameFiles` only when the client declares `workspace.fileOperations.willRename`.
- tsserver's `fileReferences` takes one file. A folder goes through a probe `getEditsForFileRename`.
- ropey and TypeScript disagree on VT, FF and NEL line breaks. Positions after a form feed are one line off.
