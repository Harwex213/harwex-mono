//! The one path that writes a document to disk.
//!
//! Every write of document text goes through this module: editor tabs, the hidden documents of
//! editable diffs and Find previews, the commit's save of dirty documents, the merge window's
//! resolve and its Cancel write-back, and the closed files that Replace in Files and the
//! refactorings edit. Callers decide *when* to save (a debounce, focus loss, a prompt). This
//! module decides *how*:
//! 1. Format. `Reason::formats` is true for a save the user asks for (⌘S, Save All, ⌘S in a diff
//!    tab, "Save" in a close prompt). Then oxfmt runs first on a worker (`format`), when
//!    `[format.oxfmt] on_save` covers the file. Saves the app makes on its own (idle, focus loss,
//!    debounce, close of a diff, commit, refactorings, merge) never format, like IDEA's
//!    "Actions on Save".
//! 2. Snapshot on the UI thread (`snapshot`): the text as the file holds it (BOM and CRLF
//!    restored by `Document::save_snapshot`) and the undo token. The owner's `saving` flag goes
//!    on, so a reload or a second save waits.
//! 3. Write on a worker (`Pending::write`): the backup of the old version (`backup`), then the
//!    write (`write_file`).
//! 4. Finish on the UI thread (`finish`): `mark_saved` only while the target still names the
//!    same document (tab id, hidden document generation), `problems.force` (the servers check
//!    again), `settings::saved`, and `on_fs_batch` for the path (git status, gutters, tree). A
//!    commit skips the last step: its own refresh covers the paths it saved.
//!
//! `tests::one_writer` fails on a `std::fs::write`, `File::create` or `OpenOptions` in `app/src`
//! outside this module, unless the line is on its list of writes that are not document text.

pub mod backup;

use std::path::{Path, PathBuf};

use ide_editor::Document;

use crate::jobs::Jobs;
use crate::state::AppState;
use crate::tabs::TabId;

/// Why a document is saved. It decides whether oxfmt runs first.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason {
    /// ⌘S, Save All (⌥⌘S), ⌘S in an editable diff tab.
    Explicit,
    /// "Save" in a close prompt (a tab, a project).
    ClosePrompt,
    /// System › Files: the idle timer.
    Idle,
    /// System › Files: the window or the editor lost the focus to another app or a terminal.
    AppSwitch,
    /// A short debounce after the last edit, or focus loss of a diff or a Find preview.
    Debounce,
    /// A diff closes or is replaced: its hidden document is written even while a write runs.
    Close,
    /// The commit saves every dirty document first.
    Commit,
    /// Edits the app applied: Replace in Files, Rename Symbol, the import edits of a move.
    Refactor,
    /// The merge window's "Save and Mark Resolved".
    Resolve,
    /// The merge window's Cancel puts git's conflict text back.
    Discard,
}

impl Reason {
    /// oxfmt runs before the write (when the project's `on_save` covers the file).
    pub fn formats(self) -> bool {
        matches!(self, Reason::Explicit | Reason::ClosePrompt)
    }
}

/// A document the app can find again by key when a worker's result lands.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Target {
    /// An editor tab's document.
    Tab(TabId),
    /// An editable diff's hidden document: the diff tab's key and the document's generation.
    DiffHidden { key: String, gen: u64 },
}

/// Tells a detached owner about its finished write: the token on success, `None` on failure.
pub type Tell = Box<dyn FnOnce(&mut AppState, Option<u64>) + Send>;

/// Who gets told about the finished write.
pub enum Owner {
    Target(Target),
    /// A document the app cannot find by key (a Find preview's hidden document). The callback
    /// gets the token on success and `None` on failure, and must clear its own `saving` flag.
    Detached(Tell),
    /// No document: a write-back of bytes.
    Nobody,
}

/// A document's file content, taken on the UI thread, ready to be written on a worker.
pub struct Pending {
    path: PathBuf,
    bytes: Vec<u8>,
    token: u64,
    owner: Owner,
    reason: Reason,
    then_close: bool,
    backups: Option<PathBuf>,
    only_if_differs: bool,
}

/// The result of `Pending::write`, for `finish`.
pub struct Written {
    path: PathBuf,
    token: u64,
    owner: Owner,
    reason: Reason,
    then_close: bool,
    res: Result<(), String>,
}

impl Pending {
    /// Bytes that go back as they are (the merge's Cancel). Nothing is written when the file
    /// already holds them.
    pub fn write_back(path: PathBuf, bytes: Vec<u8>, reason: Reason, backups: Option<PathBuf>) -> Pending {
        Pending { path, bytes, token: 0, owner: Owner::Nobody, reason, then_close: false, backups, only_if_differs: true }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Backup, then write. Blocking: call it on a worker.
    pub fn write(self) -> Written {
        let same = self.only_if_differs && std::fs::read(&self.path).ok().as_deref() == Some(&self.bytes[..]);
        let res = if same { Ok(()) } else { write_file(&self.path, &self.bytes, self.backups.as_deref()) };
        Written { path: self.path, token: self.token, owner: self.owner, reason: self.reason, then_close: self.then_close, res }
    }
}

impl Written {
    pub fn ok(&self) -> bool {
        self.res.is_ok()
    }

    pub fn error(&self) -> Option<&str> {
        self.res.as_ref().err().map(String::as_str)
    }
}

/// Writes `bytes` to `path`. With a backup folder, the previous version is copied there first;
/// a failed backup never stops the save. Blocking: call it on a worker. This is the only write
/// of document text in the app.
pub fn write_file(path: &Path, bytes: &[u8], backups: Option<&Path>) -> Result<(), String> {
    if let Some(dir) = backups {
        let _ = backup::backup(dir, path, bytes);
    }
    std::fs::write(path, bytes).map_err(|err| format!("{}: {err}", path.display()))
}

/// The backup folder for saves now: Settings › System › Files › "Back up files before saving".
pub fn backups(state: &AppState) -> Option<PathBuf> {
    state.settings.backup_target()
}

/// Saves a document. Nothing happens when it is clean, read-only or already being written.
pub fn save(state: &mut AppState, target: Target, reason: Reason) {
    request(state, target, reason, false);
}

/// "Save" in a tab's close prompt: formats, saves, then closes the tab. A clean tab closes at once.
pub fn save_then_close(state: &mut AppState, id: TabId) {
    request(state, Target::Tab(id), Reason::ClosePrompt, true);
}

/// Saves every modified editor tab and every diff's hidden document of the workspace in context.
pub fn save_all(state: &mut AppState, reason: Reason) {
    let ids: Vec<TabId> = state.ws.tabs.editors_mut().filter(|(_, e)| e.doc.is_dirty() && !e.read_only).map(|(id, _)| id).collect();
    for id in ids {
        save(state, Target::Tab(id), reason);
    }
    for target in crate::git::diff::due_hidden(state, false) {
        save(state, target, reason);
    }
}

/// Takes the snapshots of every dirty editor tab and hidden diff document that is not being
/// written, for a worker that writes them itself before it goes on (the commit). Each one
/// must come back through `finish`.
pub fn take_all(state: &mut AppState, reason: Reason) -> Vec<Pending> {
    let backups = backups(state);
    let mut targets: Vec<Target> = state.ws.tabs.editors_mut().filter(|(_, e)| e.doc.is_dirty() && !e.read_only && !e.saving).map(|(id, _)| Target::Tab(id)).collect();
    targets.extend(crate::git::diff::due_hidden(state, false));
    let mut out = Vec::new();
    for target in targets {
        if crate::format::in_flight_for(state, &target) {
            continue;
        }
        let Some(s) = slot(state, &target) else { continue };
        if !s.doc.is_dirty() || *s.saving {
            continue;
        }
        out.push(snapshot(s.doc, s.saving, s.path, Owner::Target(target), reason, false, backups.clone()));
    }
    out
}

fn request(state: &mut AppState, target: Target, reason: Reason, then_close: bool) {
    // A manual reformat is running: the save waits for it.
    if crate::format::queue_save(state, &target, reason, then_close) {
        return;
    }
    let Some(s) = slot(state, &target) else { return };
    if s.read_only {
        // The view ignores edits, so there is nothing to write.
        return;
    }
    let dirty = s.doc.is_dirty();
    if !dirty || (*s.saving && reason != Reason::Close) {
        if let (true, false, Target::Tab(id)) = (then_close, dirty, &target) {
            state.close_tab(*id, true);
        }
        return;
    }
    let path = s.path;
    let config = &state.ws.langs.config.oxfmt;
    if reason.formats() && config.on_save && config.covers(&path) {
        crate::format::start_save(state, target, reason, then_close);
        return;
    }
    write_now(state, target, reason, then_close);
}

/// The write without the format step: `request` for a reason that does not format, and the
/// end of a format that a save waited for.
pub(crate) fn write_now(state: &mut AppState, target: Target, reason: Reason, then_close: bool) {
    let backups = backups(state);
    let Some(s) = slot(state, &target) else { return };
    let dirty = s.doc.is_dirty();
    if s.read_only || !dirty || (*s.saving && reason != Reason::Close) {
        if let (true, false, false, Target::Tab(id)) = (then_close, dirty, s.read_only, &target) {
            state.close_tab(*id, true);
        }
        return;
    }
    let pending = snapshot(s.doc, s.saving, s.path, Owner::Target(target), reason, then_close, backups);
    spawn(&state.jobs, pending);
}

/// A document's place: its text, its `saving` flag, its file.
pub struct Slot<'a> {
    pub doc: &'a mut Document,
    pub saving: &'a mut bool,
    pub path: PathBuf,
    pub read_only: bool,
}

pub(crate) fn slot<'a>(state: &'a mut AppState, target: &Target) -> Option<Slot<'a>> {
    match target {
        Target::Tab(id) => {
            let e = state.ws.tabs.editor_mut(*id)?;
            Some(Slot { path: e.path.clone(), read_only: e.read_only, doc: &mut e.doc, saving: &mut e.saving })
        }
        Target::DiffHidden { key, gen } => crate::git::diff::hidden_slot(state, key, *gen),
    }
}

/// Takes the file content of `doc` and turns its `saving` flag on. For an owner that holds
/// its document outside `AppState` while it calls (a custom tab, a Find preview); hand the
/// result to `spawn`.
pub fn snapshot(doc: &mut Document, saving: &mut bool, path: PathBuf, owner: Owner, reason: Reason, then_close: bool, backups: Option<PathBuf>) -> Pending {
    *saving = true;
    let (text, token) = doc.save_snapshot();
    Pending { path, bytes: text.into_bytes(), token, owner, reason, then_close, backups, only_if_differs: false }
}

/// Writes on a worker and finishes on the UI thread.
pub fn spawn(jobs: &Jobs, pending: Pending) {
    jobs.spawn_quiet(move || pending.write(), finish);
}

/// The bookkeeping after a write, on the UI thread.
pub fn finish(state: &mut AppState, w: Written) {
    let token = w.res.is_ok().then_some(w.token);
    let close = match &w.owner {
        Owner::Target(Target::Tab(id)) if w.then_close => Some(*id),
        _ => None,
    };
    match w.owner {
        Owner::Target(Target::Tab(id)) => {
            if let Some(e) = state.ws.tabs.editor_mut(id) {
                e.saving = false;
                if let Some(t) = token {
                    e.doc.mark_saved(t);
                    // IDEA checks again on save; servers that read the disk see it now.
                    e.problems.force = true;
                }
            }
        }
        Owner::Target(Target::DiffHidden { key, gen }) => crate::git::diff::hidden_saved(state, &key, gen, token),
        Owner::Detached(tell) => tell(state, token),
        Owner::Nobody => {}
    }
    match w.res {
        Ok(()) => {
            if let Some(id) = close {
                state.close_tab(id, false);
            }
            crate::settings::saved(state, &w.path);
            if w.reason != Reason::Commit {
                // No watcher in tests, and the watcher is slow: refresh status and gutters now.
                let paths = std::iter::once(w.path).collect();
                state.on_fs_batch(crate::watcher::FsBatch { paths, structure_changed: false, git_changed: false });
            }
        }
        Err(e) => state.notifications.error("Save failed", e),
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(dir).expect("read dir").flatten() {
            let path = entry.path();
            if path.is_dir() {
                rust_files(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs") {
                out.push(path);
            }
        }
    }

    /// Only a save the user asks for formats; every save the app makes on its own does not.
    #[test]
    fn only_saves_the_user_asks_for_format() {
        use super::Reason::*;
        let formats: Vec<_> = [Explicit, ClosePrompt, Idle, AppSwitch, Debounce, Close, Commit, Refactor, Resolve, Discard].into_iter().filter(|r| r.formats()).collect();
        assert_eq!(formats, [Explicit, ClosePrompt]);
    }

    /// Writes in `app/src` that are not document text: (file, a part of the line).
    const NOT_DOCUMENTS: &[(&str, &str)] = &[
        // The global settings.toml.
        ("settings.rs", "std::fs::write(path, text)"),
        // `.harwex/ide.toml` edits.
        ("settings/project.rs", "std::fs::write(path, out)"),
        ("format/mod.rs", "std::fs::write(&path, doc.to_string())"),
        ("fileops.rs", "std::fs::write(&path, doc.to_string())"),
        // New File: an empty file that must not exist yet.
        ("fileops.rs", "OpenOptions::new().write(true).create_new(true)"),
        // Create Patch.
        ("git/log.rs", "std::fs::write(&dest, text)"),
        ("git/patch.rs", "std::fs::write(&dest, &patch.bytes)"),
        // The Unreal compile database and its ignore file.
        ("lang/unreal.rs", "std::fs::write(db_dir.join(\".gitignore\")"),
        ("lang/unreal.rs", "std::fs::write(&tmp, text)"),
        // The npm cache.
        ("lang/npm/registry.rs", "std::fs::write(&ignore"),
        ("lang/npm/registry.rs", "std::fs::write(&tmp, doc.to_string())"),
        // The input log.
        ("inputlog.rs", "std::fs::File::create(&path)"),
        // Find in Files opens files for reading only (non-blocking for FIFOs).
        ("find/source.rs", "std::fs::OpenOptions::new()"),
    ];

    /// Every write of document text goes through `save`. A new file write elsewhere either
    /// belongs here or, when it is no document (a config, a cache), on `NOT_DOCUMENTS`.
    #[test]
    fn one_writer() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = Vec::new();
        rust_files(&src, &mut files);
        assert!(files.len() > 20, "the scan found the sources");
        let mut found = Vec::new();
        let mut used = vec![false; NOT_DOCUMENTS.len()];
        for file in &files {
            let rel = file.strip_prefix(&src).expect("under src").to_string_lossy().replace('\\', "/");
            if rel.starts_with("save/") {
                continue;
            }
            let text = std::fs::read_to_string(file).expect("read source");
            // Unit tests write their own fixtures.
            let code = text.split("#[cfg(test)]\nmod tests").next().unwrap_or_default();
            for (n, line) in code.lines().enumerate() {
                let writes = line.contains("fs::write(") || line.contains("File::create(") || line.contains("OpenOptions::new()");
                if !writes {
                    continue;
                }
                match NOT_DOCUMENTS.iter().position(|(f, part)| rel == *f && line.contains(part)) {
                    Some(i) => used[i] = true,
                    None => found.push(format!("app/src/{rel}:{}: {}", n + 1, line.trim())),
                }
            }
        }
        assert!(found.is_empty(), "write documents through crate::save (or list a non-document write in NOT_DOCUMENTS):\n{}", found.join("\n"));
        let stale: Vec<_> = NOT_DOCUMENTS.iter().zip(&used).filter(|(_, u)| !**u).map(|(e, _)| e).collect();
        assert!(stale.is_empty(), "NOT_DOCUMENTS entries that match nothing any more: {stale:?}");
    }
}
