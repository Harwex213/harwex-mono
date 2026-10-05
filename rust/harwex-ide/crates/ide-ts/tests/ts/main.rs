//! The integration tests of ide-ts in one test binary, one module per backend or budget. One
//! binary links once after a change in `src`, where one binary per file linked four times.
//!
//! Run one module with `cargo test -p ide-ts --test ts <module>::`.

#[path = "../common/mod.rs"]
mod common;

mod native_lsp;
mod rename_budget;
mod tsserver;
mod workspace;
