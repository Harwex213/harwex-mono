//! The integration tests of ide-editor in one test binary, one module per area. One binary
//! links once after a change in `src`, where one binary per file linked seven times.
//!
//! Run one area with `cargo test -p ide-editor --test editor <module>::`, the benchmark with
//! `cargo test -p ide-editor --release --test editor bench:: -- --nocapture`.

mod bench;
mod caret;
mod click;
mod document;
mod find;
mod hscroll;
mod wrap;
