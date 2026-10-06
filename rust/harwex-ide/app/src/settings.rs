//! The Settings dialog (⌘, or Settings in the title bar menu). Every value lives in the
//! project's `.harwex/ide.toml` (architecture rule 10): OK writes the file on a worker and
//! applies it like a watcher reload. Pages: Tools › oxfmt.

use std::path::PathBuf;

use egui::{Context, Modal, RichText, TextEdit};

use crate::format::oxfmt::OxfmtInstall;
use crate::lang::config::normalize_extension;
use crate::state::AppState;
use crate::theme;
use crate::workspace::wid;

/// What the oxfmt page found for the active file's folder.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Detected {
    Looking,
    Found(OxfmtInstall),
    Missing,
}

/// The height of a settings page; fixed, so the dialog never changes size.
const PAGE_H: f32 = 170.0;

pub struct SettingsDialog {
    pub on_save: bool,
    /// The file types as the user types them: comma-separated extensions.
    pub extensions: String,
    pub detected: Detected,
    /// The folder the detection started from.
    probe: Option<PathBuf>,
    generation: u64,
}

/// Opens the dialog with the project's current values. Needs an open project.
pub fn open(state: &mut AppState) {
    let Some(root) = state.ws.project.as_ref().map(|p| p.root.clone()) else { return };
    let config = &state.ws.langs.config.oxfmt;
    let generation = state.ws.settings.as_ref().map_or(0, |d| d.generation) + 1;
    let probe = crate::format::probe_dir(state).unwrap_or(root);
    state.ws.settings = Some(SettingsDialog { on_save: config.on_save, extensions: config.extensions.join(", "), detected: Detected::Looking, probe: Some(probe.clone()), generation });
    state.jobs.spawn_quiet(
        move || crate::format::oxfmt::find(&probe),
        move |state, found| {
            if let Some(d) = state.ws.settings.as_mut().filter(|d| d.generation == generation) {
                d.detected = found.map_or(Detected::Missing, Detected::Found);
            }
        },
    );
}

/// The extensions in the text field: split on commas and spaces, without dots, deduplicated.
pub fn parse_extensions(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for e in text.split([',', ' ', ';']).map(normalize_extension).filter(|e| !e.is_empty()) {
        if !out.contains(&e) {
            out.push(e);
        }
    }
    out
}

pub fn show(state: &mut AppState, ctx: &Context) {
    let Some(dialog) = state.ws.settings.as_mut() else { return };
    let root = state.ws.project.as_ref().map(|p| p.root.clone()).unwrap_or_default();
    let t = &theme::T;
    let mut ok = false;
    let mut cancel = false;
    // Anchored at the top like the tree dialogs: the page height may change, the title must not move.
    let area = Modal::default_area(wid("settings-dialog-area")).anchor(egui::Align2::CENTER_TOP, [0.0, 90.0]);
    let modal = Modal::new(wid("settings-dialog")).area(area).show(ctx, |ui| {
        ui.set_width(620.0);
        ui.label(RichText::new("Settings").strong());
        ui.label(RichText::new(format!("Project settings, stored in {}", crate::lang::config::CONFIG_PATH)).color(t.text_dim).size(t.font.small));
        ui.add_space(8.0);
        ui.horizontal_top(|ui| {
            let nav = ui.allocate_ui_with_layout(egui::vec2(140.0, PAGE_H), egui::Layout::top_down(egui::Align::Min), |ui| {
                ui.set_width(140.0);
                ui.set_height(PAGE_H);
                ui.label(RichText::new("Tools").color(t.text_dim).size(t.font.small));
                let _ = ui.selectable_label(true, "oxfmt");
            });
            // A drawn line: egui's vertical separator grows with the row and moves the modal.
            let x = nav.response.rect.right() + 8.0;
            ui.painter().vline(x, nav.response.rect.y_range(), egui::Stroke::new(1.0_f32, t.popup_border));
            ui.add_space(16.0);
            ui.allocate_ui_with_layout(egui::vec2(440.0, PAGE_H), egui::Layout::top_down(egui::Align::Min), |ui| {
                ui.set_width(440.0);
                ui.set_height(PAGE_H);
                ui.label(RichText::new("Tools › oxfmt").strong());
                ui.add_space(6.0);
                ui.checkbox(&mut dialog.on_save, "Run oxfmt on save");
                ui.label(RichText::new("On ⌘S and Save All (⌥⌘S). ⌥⌘L formats the active file at any time.").color(t.text_dim).size(t.font.small));
                ui.add_space(8.0);
                ui.label("File types (extensions):");
                let edit = ui.add(TextEdit::singleline(&mut dialog.extensions).hint_text("ts, tsx, js, json").desired_width(f32::INFINITY));
                crate::util::label_widget(&edit, egui::WidgetType::TextEdit, "oxfmt file types");
                ui.add_space(8.0);
                let rel = |p: &std::path::Path| p.strip_prefix(&root).map_or_else(|_| p.display().to_string(), |r| r.display().to_string());
                let (text, color) = match &dialog.detected {
                    Detected::Looking => ("oxfmt: looking…".to_string(), t.text_dim),
                    Detected::Found(i) => (format!("oxfmt {} in {}", i.version, rel(&i.package)), t.text),
                    Detected::Missing => {
                        let from = dialog.probe.as_deref().map(rel).filter(|r| !r.is_empty()).unwrap_or_else(|| "the project root".into());
                        (format!("oxfmt: not found (no node_modules/oxfmt from {from} up)"), t.warning)
                    }
                };
                ui.label(RichText::new(text).color(color));
            });
        });
        ui.add_space(10.0);
        ui.horizontal(|ui| {
            ok = ui.button("OK").clicked();
            cancel = ui.button("Cancel").clicked();
        });
    });
    if cancel || (!ok && modal.should_close()) {
        state.ws.settings = None;
        return;
    }
    if !ok {
        return;
    }
    let Some(dialog) = state.ws.settings.take() else { return };
    let extensions = parse_extensions(&dialog.extensions);
    let on_save = dialog.on_save;
    let generation = state.project_generation();
    state.jobs.spawn(
        "Saving settings",
        move || crate::format::write_config(&root, on_save, &extensions).map(|_| crate::lang::IdeConfig::load(&root)),
        move |state, res| match res {
            Ok(config) if state.project_generation() == generation => state.apply_ide_config(config),
            Ok(_) => {}
            Err(e) => state.notifications.error("Cannot change .harwex/ide.toml", e),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extensions_field() {
        assert_eq!(parse_extensions(" .TS, tsx;js  js,, md "), vec!["ts", "tsx", "js", "md"]);
        assert!(parse_extensions(" , ").is_empty());
    }
}
