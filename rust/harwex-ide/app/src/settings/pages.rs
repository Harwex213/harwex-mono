//! The Settings pages other than Keymap. Each section names where its values live: "Global"
//! (the app config) or the project's `.harwex/ide.toml`.

use egui::{DragValue, RichText, TextEdit, Ui};

use super::{global, Detected, GlobalSettings, SettingsDialog};
use crate::lang::LangId;
use crate::theme;

#[derive(Clone, Copy)]
enum Scope {
    Global,
    Project,
}

fn section(ui: &mut Ui, title: &str, scope: Scope) {
    let t = &theme::T;
    ui.add_space(8.0);
    ui.horizontal(|ui| {
        ui.label(RichText::new(title).strong());
        let tag = match scope {
            Scope::Global => "Global · all projects".to_string(),
            Scope::Project => format!("Project · {}", crate::lang::config::CONFIG_PATH),
        };
        ui.label(RichText::new(tag).color(t.text_dim).size(t.font.small));
    });
    ui.add_space(2.0);
}

fn hint(ui: &mut Ui, text: impl Into<String>) {
    let t = &theme::T;
    ui.label(RichText::new(text.into()).color(t.text_dim).size(t.font.small));
}

fn no_project(ui: &mut Ui) {
    hint(ui, "Open a project to change its settings.");
}

/// A path field with its label above; an empty field means the default lookup. The field's
/// a11y label is `<label> path`, apart from the label above it.
fn path_field(ui: &mut Ui, label: &str, text: &mut String, default: &str) {
    ui.label(label);
    let edit = ui.add(TextEdit::singleline(text).hint_text(default).desired_width(f32::INFINITY));
    crate::util::label_widget(&edit, egui::WidgetType::TextEdit, format!("{label} path"));
}

/// Auto / On / Off for a setting whose default depends on the project (`None` is Auto).
fn tri(ui: &mut Ui, label: &str, value: &mut Option<bool>) {
    ui.horizontal(|ui| {
        ui.label(label);
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            // Right to left: the last added shows first.
            for (text, v) in [("Off", Some(false)), ("On", Some(true)), ("Auto", None)] {
                let selected = *value == v;
                let r = ui.selectable_label(selected, text);
                crate::util::label_selectable(&r, format!("{label}: {text}"), selected);
                if r.clicked() {
                    *value = v;
                }
            }
        });
    });
}

fn found_line(ui: &mut Ui, what: &str, d: &Detected<String>) {
    let t = &theme::T;
    let (text, color) = match d {
        Detected::Looking => (format!("{what}: looking…"), t.text_dim),
        Detected::Found(p) => (format!("{what}: {p}"), t.text_dim),
        Detected::Missing(e) => (format!("{what}: not found. {e}"), t.warning),
    };
    ui.add(egui::Label::new(RichText::new(text).color(color).size(t.font.small)).truncate());
}

pub fn system(ui: &mut Ui, g: &mut GlobalSettings) {
    let f = &mut g.files;
    section(ui, "Files", Scope::Global);
    ui.checkbox(&mut f.trash, "Move files to the Trash instead of deleting permanently");
    ui.horizontal(|ui| {
        ui.checkbox(&mut f.save_on_idle, "Save files if the IDE is idle for");
        let r = ui.add_enabled(f.save_on_idle, DragValue::new(&mut f.idle_secs).range(global::MIN_IDLE_SECS..=global::MAX_IDLE_SECS));
        crate::util::label_widget(&r, egui::WidgetType::DragValue, "Idle seconds");
        ui.label("seconds");
    });
    ui.checkbox(&mut f.save_on_deactivate, "Save files when switching to a different application or to the built-in terminal");
    ui.checkbox(&mut f.backup, "Back up files before saving");
    hint(
        ui,
        format!(
            "The previous version goes to the IDE's data folder: the last {} versions of each file up to {} MB, kept for {} days.",
            super::files::BACKUPS_PER_FILE,
            super::files::BACKUP_MAX_BYTES >> 20,
            super::files::BACKUP_MAX_AGE.as_secs() / 86_400
        ),
    );
    ui.add_space(4.0);
    hint(ui, "Autosave cannot be disabled completely: a commit always saves the files first, and closing a modified tab asks to save it.");
    section(ui, "Sync external changes", Scope::Global);
    ui.checkbox(&mut f.sync_on_activate, "When switching to the IDE window or opening an editor tab");
    ui.checkbox(&mut f.sync_periodically, "Periodically when the IDE is inactive (experimental)");
    hint(ui, "Open files without unsaved edits take the text on disk. The file watcher also follows changes while the IDE runs.");
}

pub fn editor(ui: &mut Ui, d: &mut SettingsDialog) {
    let t = &theme::T;
    section(ui, "Font", Scope::Global);
    ui.horizontal(|ui| {
        ui.label("Editor font size");
        let r = ui.add(DragValue::new(&mut d.global.editor.font_size).range(global::MIN_FONT_SIZE..=global::MAX_FONT_SIZE).speed(0.25).fixed_decimals(1));
        crate::util::label_widget(&r, egui::WidgetType::DragValue, "Editor font size");
        ui.label("pt");
    });
    hint(ui, "Soft wrap is on by default for plain text and Markdown; the editor's context menu turns it on or off per file.");
    section(ui, "Formatting: oxfmt", Scope::Project);
    let Some(p) = d.project.as_mut() else {
        no_project(ui);
        return;
    };
    ui.checkbox(&mut p.values.on_save, "Run oxfmt on save");
    hint(ui, "On ⌘S and Save All (⌥⌘S). ⌥⌘L formats the active file at any time.");
    ui.add_space(6.0);
    ui.label("File types (extensions):");
    let edit = ui.add(TextEdit::singleline(&mut p.values.extensions).hint_text("ts, tsx, js, json").desired_width(f32::INFINITY));
    crate::util::label_widget(&edit, egui::WidgetType::TextEdit, "oxfmt file types");
    ui.add_space(6.0);
    let root = p.root.clone();
    let rel = |path: &std::path::Path| path.strip_prefix(&root).map_or_else(|_| path.display().to_string(), |r| r.display().to_string());
    let (text, color) = match &d.oxfmt {
        Detected::Looking => ("oxfmt: looking…".to_string(), t.text_dim),
        Detected::Found(i) => (format!("oxfmt {} in {}", i.version, rel(&i.package)), t.text),
        Detected::Missing(_) => {
            let from = d.probe.as_deref().map(rel).filter(|r| !r.is_empty()).unwrap_or_else(|| "the project root".into());
            (format!("oxfmt: not found (no node_modules/oxfmt from {from} up)"), t.warning)
        }
    };
    ui.label(RichText::new(text).color(color));
}

pub fn languages(ui: &mut Ui, d: &mut SettingsDialog, running: [usize; 4], off: bool) {
    section(ui, "Language servers", Scope::Project);
    let Some(p) = d.project.as_mut() else {
        no_project(ui);
        return;
    };
    let v = &mut p.values;
    for (i, lang) in LangId::ALL.into_iter().enumerate() {
        ui.add_space(4.0);
        ui.horizontal(|ui| {
            ui.checkbox(&mut v.languages[i], lang.spec().name);
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                let status = match (off, running[i]) {
                    (true, _) => "stopped (Stop Language Servers)".to_string(),
                    (false, 0) => "not running".to_string(),
                    (false, 1) => "1 server running".to_string(),
                    (false, n) => format!("{n} servers running"),
                };
                hint(ui, status);
            });
        });
        ui.indent(("lang", i), |ui| match lang {
            LangId::TypeScript => hint(ui, "Server: the project's own TypeScript (native tsc --lsp for TypeScript 7, else tsserver.js with node)."),
            LangId::Rust => {
                path_field(ui, "rust-analyzer", &mut v.rust_server, "PATH, ~/.cargo/bin or rustup");
                found_line(ui, "In use", &d.servers[0]);
            }
            LangId::Cpp => {
                path_field(ui, "clangd", &mut v.clangd, "PATH, xcrun or Homebrew LLVM");
                found_line(ui, "In use", &d.servers[1]);
            }
            LangId::CSharp => {
                path_field(ui, "Roslyn language server", &mut v.csharp_server, "the VS Code C# extension or the roslyn-language-server tool");
                found_line(ui, "In use", &d.servers[2]);
                path_field(ui, "dotnet", &mut v.dotnet, "DOTNET_ROOT, PATH or ~/.dotnet");
                found_line(ui, "In use", &d.servers[3]);
            }
        });
    }
    hint(ui, "A changed path restarts that language's servers.");
    section(ui, "Linters and checks", Scope::Project);
    tri(ui, "TypeScript errors from the TS server", &mut v.ts_diagnostics);
    tri(ui, "oxlint", &mut v.oxlint);
    tri(ui, "oxlint type-aware rules", &mut v.oxlint_type_aware);
    tri(ui, "ESLint", &mut v.eslint);
    hint(ui, "Auto: on where the package has the linter's config and package installed. oxlint and ESLint come from each package's node_modules.");
}

pub fn frameworks(ui: &mut Ui, d: &mut SettingsDialog) {
    section(ui, "Unreal Engine", Scope::Project);
    let Some(p) = d.project.as_mut() else {
        no_project(ui);
        return;
    };
    let v = &mut p.values;
    path_field(ui, "Default engine", &mut v.unreal_engine, "from EngineAssociation via the Epic launcher");
    ui.checkbox(&mut v.unreal_index_engine, "Index the engine's files (clangd background index)");
    ui.add_space(4.0);
    if v.unreal_projects.is_empty() {
        hint(ui, "No Unreal project found yet. A project (a folder with a *.uproject) is detected when one of its C/C++ files opens.");
    }
    for row in &mut v.unreal_projects {
        ui.add_space(4.0);
        let folder = if row.rel.is_empty() { "the opened folder".to_string() } else { row.rel.clone() };
        ui.label(RichText::new(format!("{} ({folder})", row.name)).strong());
        path_field(ui, &format!("Engine for {}", row.name), &mut row.engine, "the default engine");
        let shown = match &row.detected {
            Ok(s) => Detected::Found(s.clone()),
            Err(e) => Detected::Missing(e.clone()),
        };
        found_line(ui, "In use", &shown);
    }
    section(ui, "Unity", Scope::Project);
    hint(ui, "Unity projects need no settings here: C# goes through the Roslyn server (Languages).");
}
