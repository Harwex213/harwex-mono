# 126 — Restart Language Servers must forget the TypeScript lookup

## Bug
`yarn install` in a worktree after a failed Go to Declaration; Restart Language Servers still fails with
"no TypeScript server ...: no node_modules/typescript above ...".

## Cause
`LanguageServer::restart` (app/src/lang/mod.rs:224) promises to "forget cached lookups, so a server installed
since then is found". The TS adapter (app/src/lang/ts.rs) does not override `restart`; the default calls
`shutdown`, and `TsService::shutdown` (crates/ide-ts/src/lib.rs:940) never clears `inner.lookup`
(the per-folder `find_typescript` cache, lib.rs:972). Failures are cached too.

## Scope
- TS restart clears `inner.lookup` (and any other per-folder cache the TS service holds, e.g. the global lookup
  is a process OnceLock: a failed global lookup must also be retried after a restart).
- Check the other adapters (rust, cpp, csharp, eslint/oxlint locate caches) against the same contract; fix those that break it.
- Test: a fixture folder with no typescript, a call fails, typescript appears, restart, the call succeeds.

## Progress
- Fixed. `TsService::restart` (ide-ts) = `shutdown` + clears `lookup` and `projects` + `locate::forget_failed_global_lookups` (the global install and `npm root -g` moved from `OnceLock` to `Mutex<Option<..>>`; a failure is dropped, a success stays). `TsServer` (app) overrides `restart`.
- Other adapters: rust, cpp, csharp already clear their exe/tools caches in `restart`. The linters broke the contract: the detection (`DiagnosticsState::markers`, `FileProblems::plan`) survived a restart. `lang/restart.rs` now resets them on Restart and Start (`FileProblems::redetect` keeps the old results visible).
- Test: `crates/ide-ts/tests/ts/restart.rs` (no typescript -> error; link TS 7 -> still cached after `shutdown`; `restart` -> local install, definition works).
- Not done: `find_node()` stays a process `OnceLock`; a node installed after start needs an IDE restart. No app-level test for the linter re-detection.
