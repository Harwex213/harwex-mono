//! System › Files at work: autosave (idle, focus loss, the built-in terminal), backups before a
//! save, permanent delete, and the sync of open files with the disk (window focus, tab
//! activation, periodically while the window is inactive).
//!
//! Saves go through `save::save_all` with `Reason::Idle` / `Reason::AppSwitch`, like every save
//! the app makes on its own: no formatting. Reads and backups run on workers. The backups
//! themselves live in `save::backup`.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use egui::{Context, Event};

use crate::state::AppState;
use crate::save::Reason;
use crate::tabs::TabId;
use crate::workspace::WorkspaceId;

pub use crate::save::backup::{backup_folder, backups_of, prune_backups, BACKUPS_PER_FILE, BACKUP_MAX_AGE, BACKUP_MAX_BYTES};

/// How often "Periodically when the IDE is inactive" re-reads the open files.
pub const PERIODIC_SYNC: Duration = Duration::from_secs(10);

/// Runtime state of autosave and sync. Window-wide.
pub struct FileSync {
    /// The last frame with any input. The idle save counts from here.
    pub last_input: Instant,
    /// The idle save's timer. Deterministic mode (all tests) turns it off, so a slow test never
    /// saves behind its back; a test of the idle save turns it on.
    pub idle_timer: bool,
    /// The window has the focus, from egui's `WindowFocused` events.
    pub window_focused: bool,
    terminal_focused: bool,
    /// The active tab seen last frame; a change is "opening an editor tab".
    last_active: Option<(WorkspaceId, TabId)>,
    last_periodic: Instant,
    /// Counters for tests.
    pub idle_saves: u64,
    pub deactivate_saves: u64,
    /// Open files re-read because the disk differed from a clean tab.
    pub reloads: u64,
    /// Sync passes over every open file (window focus, periodic).
    pub syncs: u64,
}

impl Default for FileSync {
    fn default() -> Self {
        FileSync {
            last_input: Instant::now(),
            idle_timer: true,
            window_focused: true,
            terminal_focused: false,
            last_active: None,
            last_periodic: Instant::now(),
            idle_saves: 0,
            deactivate_saves: 0,
            reloads: 0,
            syncs: 0,
        }
    }
}

/// The backup folder of a normal run (inside the app data folder), or of background mode (the
/// temp dir, like its storage). Tests pass their own or none (`AppOptions::backup_dir`).
pub fn default_backup_dir(background: bool) -> Option<PathBuf> {
    if background {
        return Some(std::env::temp_dir().join("harwex-ide-background-backups"));
    }
    eframe::storage_dir("harwex-ide").map(|d| d.join("backups"))
}

/// Per-frame work, after the frame drew: input and focus tracking, saves and syncs.
pub fn tick(s: &mut AppState, ctx: &Context) {
    let (input, focus) = ctx.input(|i| {
        let mut focus = None;
        let mut input = false;
        for e in &i.events {
            match e {
                Event::WindowFocused(f) => focus = Some(*f),
                _ => input = true,
            }
        }
        (input, focus)
    });
    let now = Instant::now();
    if input {
        s.settings.sync.last_input = now;
    }
    let files = s.settings.global.files.clone();
    if let Some(focused) = focus {
        s.settings.sync.window_focused = focused;
        if !focused && files.save_on_deactivate {
            s.settings.sync.deactivate_saves += 1;
            save_all(s, Reason::AppSwitch);
        }
        if focused {
            s.settings.sync.last_input = now;
            if files.sync_on_activate {
                sync_all(s);
            }
        }
    }
    let term = s.ws.terminals.has_focus(ctx);
    if term && !s.settings.sync.terminal_focused && files.save_on_deactivate {
        s.settings.sync.deactivate_saves += 1;
        save_all(s, Reason::AppSwitch);
    }
    s.settings.sync.terminal_focused = term;

    let active = s.ws.tabs.active.map(|t| (s.ws.id, t));
    if active != s.settings.sync.last_active {
        s.settings.sync.last_active = active;
        if let (Some((_, id)), true) = (active, files.sync_on_activate) {
            sync_tabs(s, vec![id]);
        }
    }

    if files.save_on_idle && s.settings.sync.idle_timer && has_unsaved(s) {
        let idle = Duration::from_secs(u64::from(files.idle_secs));
        let rest = s.settings.sync.last_input.elapsed();
        if rest >= idle {
            s.settings.sync.idle_saves += 1;
            s.settings.sync.last_input = now;
            save_all(s, Reason::Idle);
        } else {
            ctx.request_repaint_after(idle - rest);
        }
    }

    if files.sync_periodically && !s.settings.sync.window_focused {
        let rest = s.settings.sync.last_periodic.elapsed();
        if rest >= PERIODIC_SYNC {
            s.settings.sync.last_periodic = now;
            sync_all(s);
            ctx.request_repaint_after(PERIODIC_SYNC);
        } else {
            ctx.request_repaint_after(PERIODIC_SYNC - rest);
        }
    }
}

/// An editor tab in any workspace has unsaved edits that a save would write.
fn has_unsaved(s: &AppState) -> bool {
    s.all_ws().any(|w| w.tabs.editors().any(|e| e.doc.is_dirty() && !e.read_only && !e.saving))
}

/// Saves every modified editor tab of every workspace, and the diffs' hidden documents, with
/// no formatting (a save the app makes on its own).
pub fn save_all(s: &mut AppState, reason: Reason) {
    let ids: Vec<WorkspaceId> = s.all_ws().map(|w| w.id).collect();
    for ws in ids {
        s.with_ws(ws, |s| crate::save::save_all(s, reason));
    }
}

/// Re-reads every open file of every workspace, and lets git compare its stamp (a commit made
/// outside while the window was in the background).
pub fn sync_all(s: &mut AppState) {
    s.settings.sync.syncs += 1;
    let ids: Vec<WorkspaceId> = s.all_ws().map(|w| w.id).collect();
    for ws in ids {
        s.with_ws(ws, |s| {
            let tabs: Vec<TabId> = s.ws.tabs.editors_mut().map(|(id, _)| id).collect();
            sync_tabs(s, tabs);
            crate::git::refresh::git_dir_changed(s);
        });
    }
}

/// Re-reads the files of clean editor tabs on a worker. A tab whose file differs from its text
/// takes the disk text (one reload, like a watcher event); a dirty tab keeps its edits.
pub fn sync_tabs(s: &mut AppState, ids: Vec<TabId>) {
    for id in ids {
        let Some(e) = s.ws.tabs.editor_mut(id) else { continue };
        if e.doc.is_dirty() || e.saving || e.virtual_kind.is_some() {
            continue;
        }
        // A rope clone is cheap; the compare runs on the worker, never on the UI thread.
        let rope = e.doc.rope().clone();
        let path = e.path.clone();
        s.jobs.spawn_quiet(
            move || {
                let bytes = std::fs::read(&path).ok()?;
                let body = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
                let text = String::from_utf8_lossy(body).replace("\r\n", "\n");
                (rope != text.as_str()).then_some((path, bytes))
            },
            move |state, changed| {
                let Some((path, bytes)) = changed else { return };
                let tracked = {
                    let Some(e) = state.ws.tabs.editor_mut(id) else { return };
                    if e.doc.is_dirty() || e.saving || !e.doc.reload_from_bytes(&bytes) {
                        return;
                    }
                    e.invalidate_marks();
                    e.lsp_version.is_some()
                };
                state.settings.sync.reloads += 1;
                if tracked {
                    crate::nav::flush_lsp(state, id);
                }
                crate::git::refresh::paths(state, vec![path], false);
            },
        );
    }
}

/// Deletes a file, a symlink (not its target) or a folder with everything in it, for good.
/// Blocking: call it on a worker.
pub fn delete_permanently(path: &Path) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let res = if meta.is_dir() { std::fs::remove_dir_all(path) } else { std::fs::remove_file(path) };
    res.map_err(|e| format!("{}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("harwex-settings-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn permanent_delete() {
        let root = temp("delete");
        std::fs::create_dir_all(root.join("d/e")).unwrap();
        std::fs::write(root.join("d/e/f.txt"), "x").unwrap();
        std::fs::write(root.join("g.txt"), "x").unwrap();
        delete_permanently(&root.join("d")).unwrap();
        delete_permanently(&root.join("g.txt")).unwrap();
        assert!(!root.join("d").exists() && !root.join("g.txt").exists());
        assert!(delete_permanently(&root.join("missing")).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
