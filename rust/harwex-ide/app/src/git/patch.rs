//! Patches of local changes from the Commit window: Copy as Patch to Clipboard and Create
//! Patch... (task 114). The diff runs on a worker (`ide_git::Repo::local_patch`); the UI only
//! puts the text on the clipboard or names the file.

use std::path::PathBuf;

use egui::{Context, Key, Modal, RichText, TextEdit};
use ide_git::{LocalPatch, LocalPatchFile};

use crate::state::AppState;

/// The file a new patch is offered under, in the repository root, like IDEA.
const DEFAULT_NAME: &str = "Local_Changes.patch";

/// The open Create Patch dialog.
pub struct PatchDialog {
    files: Vec<LocalPatchFile>,
    dest: String,
}

/// "3 files", "1 file".
fn files_label(n: usize) -> String {
    format!("{n} file{}", if n == 1 { "" } else { "s" })
}

/// Copy as Patch to Clipboard: the patch of `files` goes on the clipboard through
/// `state.platform`, then one toast "Patch copied (N files)".
pub fn copy(state: &mut AppState, files: Vec<LocalPatchFile>) {
    let Some(repo) = state.ws.git.repo.clone() else { return };
    if files.is_empty() {
        return;
    }
    state.jobs.spawn(
        "Copy as Patch",
        move || repo.local_patch(&files),
        |state, res| match res {
            Ok(LocalPatch { files: 0, .. }) => state.notifications.warn("Nothing to copy", "The selected files have no changes for a patch."),
            Ok(patch) => {
                let text = String::from_utf8_lossy(&patch.bytes);
                let ctx = state.ctx.clone();
                state.platform.copy_text(&ctx, &text);
                state.notifications.info(format!("Patch copied ({})", files_label(patch.files)), "");
            }
            Err(e) => state.notifications.error("Copy as Patch failed", e.to_string()),
        },
    );
}

/// Create Patch...: asks for the file, then writes the patch of `files` there on a worker.
pub fn open_dialog(state: &mut AppState, files: Vec<LocalPatchFile>) {
    let Some(repo) = state.ws.git.repo.as_ref() else { return };
    if files.is_empty() {
        return;
    }
    let dest = repo.workdir().join(DEFAULT_NAME).display().to_string();
    state.ws.git_ui.changes.patch_dialog = Some(PatchDialog { files, dest });
}

pub fn show_dialog(state: &mut AppState, ctx: &Context) {
    let Some(dialog) = state.ws.git_ui.changes.patch_dialog.as_mut() else { return };
    let mut close = false;
    let mut submit = false;
    let m = Modal::new(crate::workspace::wid("changes-create-patch")).show(ctx, |ui| {
        ui.set_width(520.0);
        ui.label(RichText::new(format!("Create Patch: {} of local changes", files_label(dialog.files.len()))).strong());
        ui.add_space(6.0);
        let r = ui.add(TextEdit::singleline(&mut dialog.dest).hint_text("Patch file").desired_width(f32::INFINITY));
        // Re-grabbing the focus on the frame Enter released it would hide that Enter.
        if !r.lost_focus() {
            r.request_focus();
        }
        ui.add_space(6.0);
        let enter = r.lost_focus() && ui.input(|i| i.key_pressed(Key::Enter));
        ui.horizontal(|ui| {
            let valid = !dialog.dest.trim().is_empty();
            if (ui.add_enabled(valid, egui::Button::new("Save Patch")).clicked() || (enter && valid)) && !submit {
                submit = true;
            }
            if ui.button("Cancel").clicked() {
                close = true;
            }
        });
    });
    close |= m.should_close();
    if !submit && !close {
        return;
    }
    let Some(dialog) = state.ws.git_ui.changes.patch_dialog.take() else { return };
    if submit {
        save(state, dialog.files, PathBuf::from(dialog.dest.trim()));
    }
}

/// Writes the patch on a worker. A patch is no document text, so it does not go through
/// `crate::save` (it is on `save::tests::NOT_DOCUMENTS`), like the Git window's Create Patch.
fn save(state: &mut AppState, files: Vec<LocalPatchFile>, dest: PathBuf) {
    let Some(repo) = state.ws.git.repo.clone() else { return };
    let dest = if dest.is_absolute() { dest } else { repo.workdir().join(dest) };
    state.jobs.spawn(
        "Create Patch",
        move || {
            let patch = repo.local_patch(&files).map_err(|e| e.to_string())?;
            std::fs::write(&dest, &patch.bytes).map_err(|e| format!("{}: {e}", dest.display()))?;
            Ok::<(PathBuf, usize), String>((dest, patch.files))
        },
        |state, res| match res {
            Ok((p, n)) => state.notifications.info(format!("Patch created ({})", files_label(n)), p.display().to_string()),
            Err(e) => state.notifications.error("Create Patch failed", e),
        },
    );
}
