//! The headless UI suites of the app in one test binary. Each file here is one suite and keeps
//! its own snapshot directory and fixture root (`tests/snapshots/<suite>`,
//! `<FIXTURE_ROOT>/<suite>`). One binary links once after a change in `app/src`, where one
//! binary per suite linked 30 times (and macOS checks every new executable on its first run).
//!
//! Run one suite with `cargo test -p harwex-ide --test app <suite>::`.
//!
//! The suites share one process, so a suite must not change process-wide state that another
//! one reads. Suites that have to stay in their own binary: `tests/cancel.rs` (`HARWEX_GIT`,
//! which ide-git reads once per process, and `HARWEX_LINT_TIMEOUT_MS`) and
//! `tests/instance_stale.rs` (a forked child inherits a dropped listener's fd).

#[path = "../common/mod.rs"]
mod common;

mod badges;
mod cpp_nav;
mod csharp_nav;
mod breadcrumbs;
mod diagnostics;
mod diff_edit;
mod diff_jump;
mod diff_selection;
mod editor;
mod editor_tabs;
mod find_in_files;
mod find_replace;
mod find_window;
mod format;
mod git_changes;
mod git_history;
mod git_refresh;
mod git_window;
mod horizontal_scroll;
mod instance;
mod launch;
mod lint_budget;
mod memory;
mod multi_caret;
mod navigation;
mod project_menu;
mod projects;
mod restart;
mod rust_nav;
mod shell;
mod soft_wrap;
mod tab_shortcuts;
mod terminal;
mod time_limits;
mod tool_window_esc;
mod tool_window_hide;
mod tree_multi;
mod unreal_nav;
mod workspaces;

/// Runs `common::init` before `main`, while the process has one thread. Every test then sees
/// the same environment, whichever suite runs first: the app caches some of it on first use
/// (`RUST_SRC_PATH` in the library roots), and a suite without a fixture never calls `init`.
#[used]
#[cfg_attr(target_os = "macos", link_section = "__DATA,__mod_init_func")]
#[cfg_attr(target_os = "linux", link_section = ".init_array")]
static INIT_BEFORE_MAIN: extern "C" fn() = {
    extern "C" fn init_before_main() {
        common::init();
    }
    init_before_main
};
