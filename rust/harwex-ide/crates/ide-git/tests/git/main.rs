//! The integration tests of ide-git in one test binary, one module per area. One binary links
//! once after a change in `src`, where one binary per file linked five times.
//!
//! Run one area with `cargo test -p ide-git --test git <module>::`. The tests share one
//! process, so none of them may set process-wide state such as `HARWEX_GIT`: a fake git goes
//! through `Repo::with_git_binary` instead.

#[path = "../common/mod.rs"]
mod common;

mod cancel;
mod changes;
mod history;
mod large_repo;
mod status;
mod window;
