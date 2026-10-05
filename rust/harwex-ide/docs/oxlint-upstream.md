# oxlint upstream bug reports (drafts, not filed)

Found in task 057 (oxlint 1.77, 2026-10-05). File them on github.com/oxc-project/oxc when the user decides. Delete this file once both are filed or fixed upstream.

## Draft 1: `oxlint --lsp` panics in `disable_fix.rs:52` on every JS-plugin diagnostic

> **Title:** LSP: panic `range end index N out of range for slice of length 0` in `fixer/disable_fix.rs:52` for diagnostics from `jsPlugins`
>
> **Version:** oxlint 1.77.0 (`@oxlint/binding-darwin-arm64`), node 24.13.1, macOS 26 arm64.
>
> **Repro:**
>
> `.oxlintrc.json`
> ```json
> { "jsPlugins": ["./plugin.mjs"], "rules": { "min/no-debugger": "warn" } }
> ```
> `plugin.mjs`
> ```js
> export default {
>   meta: { name: "min" },
>   rules: {
>     "no-debugger": {
>       create(context) {
>         return { DebuggerStatement(node) { context.report({ node, message: "debugger from a JS plugin" }); } };
>       },
>     },
>   },
> };
> ```
> `a.ts`
> ```ts
> const a = 1;
> debugger;
> export { a };
> ```
> Start `oxlint --lsp` in that folder, send `initialize` (any options), `initialized`, and `textDocument/didOpen` for `a.ts`.
>
> **Actual:** the server aborts right after `didOpen`:
> ```
> thread '<unnamed>' panicked at crates/oxc_linter/src/fixer/disable_fix.rs:52:22:
> range end index 13 out of range for slice of length 0
> ```
> The same happens with `oxlint.config.ts`, with `run: "onSave"`, and with every `fixKind` (`none`, `safe_fix`, `safe_fix_or_suggestion`, `dangerous_fix`, `all`). The CLI (`oxlint a.ts`) works and prints the plugin warning. Without `jsPlugins` (only the native `no-debugger`) the LSP works.
>
> **Expected:** the diagnostic is published, with or without "disable for this line" code actions.
>
> **Analysis:** `Message::add_ignore_fix(section_offset, section_source_text)` gets an empty `section_source_text` for JS-plugin messages, while `span.start` is the real offset (13). `disable_for_this_line` slices `bytes[..error_offset as usize]` with no bound check. Suggested fix: pass the real source text for JS-plugin messages, and in any case skip the ignore fix when `error_offset > section_source_text.len()` instead of panicking. In a monorepo where every package uses a JS plugin, this crash makes the language server unusable: any file with a plugin problem kills the server.

## Draft 2: `oxlint --lsp` waits for `tsgolint` with no timeout, blocks all requests, and leaves zombies

> **Title:** LSP type-aware: a `tsgolint` that does not answer blocks the server forever; finished `tsgolint` processes are never reaped
>
> **Version:** oxlint 1.77.0 with oxlint-tsgolint 7.0.2002, `typeAware: true`, node 24.13.1, macOS 26 arm64.
>
> **What happened:** macOS `syspolicyd` got stuck scanning new unsigned executables, so every exec of `tsgolint` (an ad-hoc-signed Go binary) hung before `main` for many minutes. The language server then:
> 1. did not answer `textDocument/diagnostic` for the file (the client gave up after 30 s and sent `$/cancelRequest`);
> 2. did not answer any later `textDocument/diagnostic` either, for any file: they queue behind the stuck lint;
> 3. did not kill the hung `tsgolint headless` child on cancel; it stayed until the server was killed.
>
> Separately, a long-running server collects `<defunct>` `tsgolint` children, one per finished type-aware lint (7+ after an hour). The napi binding spawns `tsgolint` with `std::process::Command` inside the node process, and nobody waits on the child after it exits.
>
> **Repro:** any type-aware LSP setup where `tsgolint` does not start or does not answer. A simple way without macOS: point `OXLINT_TSGOLINT_PATH` at a script that sleeps forever (`#!/bin/sh` + `sleep 100000`), then send `didOpen` + `textDocument/diagnostic` for a `.ts` file twice. Neither request is answered. (Not run as written here; our evidence is the real stall.)
>
> **Expected:**
> - a time limit on each `tsgolint` run (configurable), after which the server kills `tsgolint`, publishes the non-type-aware diagnostics, and logs or reports the failure (`window/showMessage`);
> - `$/cancelRequest` stops the type-aware part of that lint;
> - one stuck lint does not block requests for other files;
> - every `tsgolint` child is waited on (no zombies).
>
> **Context:** when `tsgolint` is not stuck, the same setup answers in 26-29 ms per file, so a limit of a few tens of seconds would never hit a normal run.

