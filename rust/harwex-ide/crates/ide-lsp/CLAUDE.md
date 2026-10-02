# ide-lsp

A generic Language Server Protocol client. It exists so every language server (the TypeScript 7 native server in `ide-ts`, rust-analyzer in the app's `lang/rust.rs`, future gopls) shares one tested client. It provides `Content-Length` framing, JSON-RPC routing, answers to server requests, full-text document sync, timeouts, crash restart, progress tracking and UTF-16 position conversion.

## Boundaries

- No language knowledge. No language name, server command, root marker or init option belongs here. An adapter fills a `ClientConfig` and handles language quirks.
- Never depend on egui.
- Keep the dependency list tiny (`serde_json` only).

## Contract

- All calls block. `LspClient` is `Send + Sync`. Callers use worker threads.
- Positions at the API are 0-based lines and char columns. LSP uses UTF-16 columns. `LineIndex` converts. `LineBreaks::Lsp` follows the LSP spec. `LineBreaks::Unicode` adds U+2028 and U+2029 for TypeScript.
- URIs go through `path_to_uri` / `uri_to_path` (percent-encoded: `@` becomes `%40`). Result paths are canonical (`canonical`).
- Lazy start on the first call. A dead server restarts on the next call and gets every open file back with its last text, unsaved edits included.
- `open` / `change` / `close` send full text with increasing versions. `ensure_open` opens a never-opened file from disk and re-reads it when its mtime moves.
- Each request has a timeout. A timeout sends `$/cancelRequest` and drops the late answer.
- The reader thread answers server requests at once: `workspace/configuration` from the `configuration` handler (else `null` per item), `workspace/applyEdit` as not applied, everything else `null`. Never block the reader thread. A blocked reader stalls every request of that server.
- `Error::is_retryable()` is true for content modified, server cancelled and request cancelled. Adapters retry those.
- `framing` is also used by the tsserver reader in `ide-ts`. Lengths are UTF-8 bytes.
- `LocationLink` results use `targetSelectionRange` (the declared name), like tsserver.

## Test

```sh
cargo test -p ide-lsp
```

Integration tests run against `src/bin/fake_server.rs`, a scripted LSP server (`CARGO_BIN_EXE_ide-lsp-fake-server`). A new client feature gets a fake-server script and a test. Cover out-of-order answers, timeouts and crash restart when you touch routing or sync. Real servers are exercised by `cargo test -p ide-ts --test native_lsp` and `cargo test -p harwex-ide --test rust_nav`.

## Traps

- The state lock is held only by callers of one server. Never hold it across a wait for a response.
- `initialize` has its own minimum timeout (`min_initialize_timeout`), so a small request timeout cannot break the handshake.
- Server notifications other than progress (`publishDiagnostics`, `window/logMessage`) reach only `on_notification`. Nothing shows them yet.
