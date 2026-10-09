//! System › Files at work: autosave (idle, focus loss, the built-in terminal), backups before a
//! save, permanent delete, and the sync of open files with the disk (window focus, tab
//! activation, periodically while the window is inactive).
//!
//! Saves the app makes here go through `AppState::save_tab`, like every save the app makes on
//! its own: no formatting. Reads and backups run on workers.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

use egui::{Context, Event};

use crate::state::AppState;
use crate::tabs::TabId;
use crate::workspace::WorkspaceId;

/// How often "Periodically when the IDE is inactive" re-reads the open files.
pub const PERIODIC_SYNC: Duration = Duration::from_secs(10);
/// A file larger than this gets no backup.
pub const BACKUP_MAX_BYTES: u64 = 1 << 20;
/// Backups kept per file; the oldest go first.
pub const BACKUPS_PER_FILE: usize = 5;
/// A file's backups that are all older than this are removed at startup.
pub const BACKUP_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 3600);
/// The file in a backup folder that names the original path.
const ORIGIN_FILE: &str = "origin";

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
            save_all(s);
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
        save_all(s);
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
            save_all(s);
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
pub fn save_all(s: &mut AppState) {
    let ids: Vec<WorkspaceId> = s.all_ws().map(|w| w.id).collect();
    for ws in ids {
        s.with_ws(ws, |s| {
            let tabs: Vec<TabId> = s.ws.tabs.editors_mut().filter(|(_, e)| e.doc.is_dirty() && !e.read_only && !e.saving).map(|(id, _)| id).collect();
            for id in tabs {
                s.save_tab(id, false);
            }
            crate::git::diff::save_hidden_all(s);
        });
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

/// Writes `text` to `path`. With a backup folder, the previous version is copied there first
/// (`backup`); a failed backup never stops the save. Blocking: call it on a worker.
pub fn write_file(path: &Path, text: &str, backups: Option<&Path>) -> Result<(), String> {
    if let Some(dir) = backups {
        let _ = backup(dir, path, text);
    }
    std::fs::write(path, text).map_err(|err| format!("{}: {err}", path.display()))
}

/// Copies the current content of `path` into `<dir>/<hash of path>/<millis>-<name>` unless the
/// file is missing, bigger than `BACKUP_MAX_BYTES`, or already holds `new_text`. Keeps the
/// newest `BACKUPS_PER_FILE`. Returns the backup's path.
pub fn backup(dir: &Path, path: &Path, new_text: &str) -> std::io::Result<Option<PathBuf>> {
    let Ok(meta) = std::fs::metadata(path) else { return Ok(None) };
    if !meta.is_file() || meta.len() > BACKUP_MAX_BYTES {
        return Ok(None);
    }
    let old = std::fs::read(path)?;
    if old == new_text.as_bytes() {
        return Ok(None);
    }
    let folder = backup_folder(dir, path);
    std::fs::create_dir_all(&folder)?;
    let origin = folder.join(ORIGIN_FILE);
    if !origin.exists() {
        std::fs::write(&origin, path.display().to_string())?;
    }
    let millis = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_millis());
    let name = path.file_name().map_or_else(|| "file".into(), |n| n.to_string_lossy().into_owned());
    // Two saves in one millisecond get distinct names; the order stays by name.
    let mut n = 0;
    let target = loop {
        let t = folder.join(format!("{millis:014}-{n:02}-{name}"));
        if !t.exists() {
            break t;
        }
        n += 1;
    };
    std::fs::write(&target, &old)?;
    let mut kept = backups_of(&folder);
    while kept.len() > BACKUPS_PER_FILE {
        let _ = std::fs::remove_file(kept.remove(0));
    }
    Ok(Some(target))
}

/// The backup folder of one file: a stable FNV-1a hash of its path.
pub fn backup_folder(dir: &Path, path: &Path) -> PathBuf {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in path.as_os_str().as_encoded_bytes() {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    dir.join(format!("{h:016x}"))
}

/// The backups in one file's folder, oldest first.
pub fn backups_of(folder: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = std::fs::read_dir(folder).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.file_name().is_some_and(|n| n != ORIGIN_FILE)).collect();
    out.sort();
    out
}

/// Removes the folders of files whose newest backup is older than `max_age`. Blocking.
pub fn prune_backups(dir: &Path, max_age: Duration) {
    let now = SystemTime::now();
    for folder in std::fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.is_dir()) {
        let newest = backups_of(&folder).iter().filter_map(|p| p.metadata().and_then(|m| m.modified()).ok()).max();
        if newest.is_none_or(|t| now.duration_since(t).unwrap_or_default() > max_age) {
            let _ = std::fs::remove_dir_all(&folder);
        }
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
    fn backups_keep_the_previous_versions() {
        let root = temp("backups");
        let dir = root.join("backups");
        let file = root.join("a.txt");
        // A new file has no previous version.
        write_file(&file, "v0", Some(&dir)).unwrap();
        assert!(!dir.exists());
        for i in 1..=7 {
            write_file(&file, &format!("v{i}"), Some(&dir)).unwrap();
        }
        // The same text again makes no backup.
        write_file(&file, "v7", Some(&dir)).unwrap();
        let folder = backup_folder(&dir, &file);
        let kept: Vec<String> = backups_of(&folder).iter().map(|p| std::fs::read_to_string(p).unwrap()).collect();
        assert_eq!(kept, ["v2", "v3", "v4", "v5", "v6"]);
        assert_eq!(std::fs::read_to_string(folder.join(ORIGIN_FILE)).unwrap(), file.display().to_string());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "v7");
        // A big file gets none.
        let big = root.join("big.bin");
        std::fs::write(&big, vec![b'x'; BACKUP_MAX_BYTES as usize + 1]).unwrap();
        assert_eq!(backup(&dir, &big, "small").unwrap(), None);
        prune_backups(&dir, Duration::from_secs(3600));
        assert!(folder.exists(), "fresh backups stay");
        prune_backups(&dir, Duration::ZERO);
        assert!(!folder.exists(), "old backups go");
        let _ = std::fs::remove_dir_all(&root);
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
