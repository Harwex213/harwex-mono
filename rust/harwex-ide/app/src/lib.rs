//! harwex-ide as a library: the eframe app and every UI module. `main.rs` only parses the
//! command line; tests build the same app headlessly with `egui_kittest`.

pub mod app;
pub mod breadcrumbs;
pub mod chrome;
pub mod clicks;
pub mod diagnostics;
pub mod fileops;
pub mod find;
pub mod git;
pub mod icons;
pub mod inputlog;
pub mod instance;
pub mod jobs;
pub mod lang;
pub mod launch;
pub mod layout;
pub mod memory;
pub mod nav;
pub mod notifications;
pub mod persist;
pub mod projects_popup;
pub mod search;
pub mod state;
pub mod tabs;
pub mod terminal;
pub mod testhook;
pub mod theme;
pub mod tree;
pub mod tree_menu;
pub mod util;
pub mod watcher;
pub mod workspace;

pub use app::{AppOptions, IdeApp, TerminalCommand};
pub use state::AppState;
pub use workspace::{Workspace, WorkspaceId, WorkspaceInfo};
