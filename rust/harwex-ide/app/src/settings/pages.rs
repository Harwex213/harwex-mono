//! The Settings pages other than Keymap. Each section is a card (`kit::card`) whose header
//! carries its scope: a Global or Project badge (the file is on its tooltip), or for a `Shared`
//! section a Global | Project switch, with Reset to Global in Project scope.

use egui::{DragValue, TextEdit, Ui};

use super::kit::{self, card, header};
use super::{global, Detected, GlobalSettings, LayerValues, Scope, SettingsDialog, Shared};
use crate::icons::Icon;
use crate::lang::LangId;
use crate::theme;

/// The header of a shared section: a Global | Project switch while a project is open, and the
/// override strip with Reset to Global in Project scope. Switching to Project starts the
/// override from the global values. Returns the scope to edit.
fn shared_header(ui: &mut Ui, d: &mut SettingsDialog, s: Shared, icon: Icon, desc: &str) -> Scope {
    let title = s.title();
    let Some(p) = d.project.as_mut() else {
        header(ui, icon, title, desc, |ui| {
            kit::badge(ui, title, Scope::Global);
        });
        return Scope::Global;
    };
    let i = s.index();
    let mut pick = None;
    let current = p.scope[i];
    header(ui, icon, title, desc, |ui| pick = kit::scope_switch(ui, title, current));
    if current == Scope::Project && kit::override_strip(ui, title) {
        pick = Some(Scope::Global);
    }
    if let Some(scope) = pick.filter(|s| *s != p.scope[i]) {
        if scope == Scope::Project {
            s.copy(&d.global_values, &mut p.values);
        }
        p.scope[i] = scope;
    }
    p.scope[i]
}

/// The values a shared section edits in `scope`.
fn values(d: &mut SettingsDialog, scope: Scope) -> &mut LayerValues {
    match (scope, d.project.as_mut()) {
        (Scope::Project, Some(p)) => &mut p.values,
        _ => &mut d.global_values,
    }
}

pub fn system(ui: &mut Ui, g: &mut GlobalSettings) {
    let f = &mut g.files;
    card(ui, |ui| {
        header(ui, Icon::Document, "Files", "Deleting, autosave and backups", |ui| {
            kit::badge(ui, "Files", Scope::Global);
        });
        kit::switch_row(ui, &format!("Move files to the {} instead of deleting permanently", crate::os::TRASH), None, &mut f.trash);
        let unit = "seconds";
        let extra = 52.0 + 6.0 + kit::unit_width(ui, unit);
        let idle = &mut f.idle_secs;
        kit::switch_row_with(ui, "Save files if the IDE is idle for", None, &mut f.save_on_idle, extra, |ui, on| {
            kit::number(ui, on, unit, DragValue::new(idle).range(global::MIN_IDLE_SECS..=global::MAX_IDLE_SECS), "Idle seconds");
        });
        kit::switch_row(ui, "Save files when switching to a different application or to the built-in terminal", None, &mut f.save_on_deactivate);
        let backups = format!(
            "The previous version goes to the IDE's data folder: the last {} versions of each file up to {} MB, kept for {} days.",
            super::files::BACKUPS_PER_FILE,
            super::files::BACKUP_MAX_BYTES >> 20,
            super::files::BACKUP_MAX_AGE.as_secs() / 86_400
        );
        kit::switch_row(ui, "Back up files before saving", Some(&backups), &mut f.backup);
        kit::note(ui, "Autosave cannot be disabled completely: a commit always saves the files first, and closing a modified tab asks to save it.");
    });
    card(ui, |ui| {
        header(ui, Icon::Sync, "Sync external changes", "Open files without unsaved edits take the text on disk", |ui| {
            kit::badge(ui, "Sync external changes", Scope::Global);
        });
        kit::switch_row(ui, "When switching to the IDE window or opening an editor tab", None, &mut f.sync_on_activate);
        kit::switch_row(ui, "Periodically when the IDE is inactive (experimental)", None, &mut f.sync_periodically);
        kit::note(ui, "The file watcher also follows changes while the IDE runs.");
    });
    card(ui, |ui| {
        header(ui, Icon::Project, "Project view", "What the Project tree lists", |ui| {
            kit::badge(ui, "Project view", Scope::Global);
        });
        kit::switch_row(ui, "Show ignored files in Project", Some("Git-ignored files and folders, dimmed."), &mut f.show_ignored);
    });
}

pub fn editor(ui: &mut Ui, d: &mut SettingsDialog) {
    let t = &theme::T;
    card(ui, |ui| {
        header(ui, Icon::Text, "Font", "The text in editor tabs", |ui| {
            kit::badge(ui, "Font", Scope::Global);
        });
        let unit = "pt";
        let w = 52.0 + 6.0 + kit::unit_width(ui, unit);
        let size = &mut d.global.editor.font_size;
        kit::control_row(ui, "Editor font size", Some("Soft wrap is on for plain text and Markdown; the editor's context menu turns it on or off per file."), w, |ui| {
            kit::number(ui, true, unit, DragValue::new(size).range(global::MIN_FONT_SIZE..=global::MAX_FONT_SIZE).speed(0.25).fixed_decimals(1), "Editor font size");
        });
    });
    card(ui, |ui| {
        let scope = shared_header(ui, d, Shared::Formatting, Icon::Format, "Formats JS, TS, JSON, CSS and Markdown files");
        let v = values(d, scope);
        let keys = ide_editor::shortcut_label("On ⌘S and Save All (⌥⌘S). ⌥⌘L formats the active file at any time.");
        kit::switch_row(ui, "Run oxfmt on save", Some(&*keys), &mut v.on_save);
        let field_w = (ui.available_width() * 0.55).min(320.0);
        let ext = &mut v.extensions;
        kit::control_row(ui, "File types", Some("Extensions, comma-separated"), field_w, |ui| {
            let edit = ui.add(TextEdit::singleline(ext).hint_text("ts, tsx, js, json").desired_width(f32::INFINITY).margin(egui::vec2(6.0, 4.0)));
            crate::util::label_widget(&edit, egui::WidgetType::TextEdit, "oxfmt file types");
        });
        let Some(root) = d.project.as_ref().map(|p| p.root.clone()) else { return };
        let rel = |path: &std::path::Path| path.strip_prefix(&root).map_or_else(|_| path.display().to_string(), |r| r.display().to_string());
        match &d.oxfmt {
            Detected::Looking => kit::note(ui, "oxfmt: looking…"),
            Detected::Found(i) => kit::info(ui, Icon::Check, t.git_added, t.text, &format!("oxfmt {} in {}", i.version, rel(&i.package))),
            Detected::Missing(_) => {
                let from = d.probe.as_deref().map(rel).filter(|r| !r.is_empty()).unwrap_or_else(|| "the project root".into());
                kit::info(ui, Icon::Warning, t.warning, t.warning, &format!("oxfmt: not found (no node_modules/oxfmt from {from} up)"));
            }
        }
    });
}

/// The text a path field shows while empty: in Project scope the global value it inherits.
fn inherited(scope: Scope, global: &str, default: &str) -> String {
    match (scope, global.trim()) {
        (Scope::Project, g) if !g.is_empty() => format!("global: {g}"),
        _ => default.to_string(),
    }
}

/// The indent of a language's path rows under its switch.
const SUB: f32 = 18.0;

pub fn languages(ui: &mut Ui, d: &mut SettingsDialog, running: [usize; 4], off: bool) {
    let t = &theme::T;
    card(ui, |ui| {
        let scope = shared_header(ui, d, Shared::Servers, Icon::Code, "Navigation, completion and errors per language");
        let g = d.global_values.clone();
        let servers = d.servers.clone();
        let v = values(d, scope);
        for (i, lang) in LangId::ALL.into_iter().enumerate() {
            if i > 0 {
                kit::divider(ui);
            }
            let status = match (off, running[i]) {
                (true, _) => "stopped (Stop Language Servers)".to_string(),
                (false, 0) => "not running".to_string(),
                (false, 1) => "1 server running".to_string(),
                (false, n) => format!("{n} servers running"),
            };
            let hint = (lang == LangId::TypeScript).then_some("Server: the project's own TypeScript (native tsc --lsp for TypeScript 7, else tsserver.js with node).");
            let status_w = ui.painter().layout_no_wrap(status.clone(), t.small_font(), t.text_dim).size().x;
            kit::switch_row_with(ui, lang.spec().name, hint, &mut v.languages[i], status_w, |ui, _| {
                ui.label(egui::RichText::new(status).color(t.text_dim).size(t.font.small));
            });
            match lang {
                LangId::TypeScript => {}
                LangId::Rust => kit::path_row(ui, "rust-analyzer", &mut v.rust_server, &inherited(scope, &g.rust_server, "PATH, ~/.cargo/bin or rustup"), Some(&servers[0]), SUB),
                LangId::Cpp => kit::path_row(ui, "clangd", &mut v.clangd, &inherited(scope, &g.clangd, "PATH, xcrun or Homebrew LLVM"), Some(&servers[1]), SUB),
                LangId::CSharp => {
                    kit::path_row(ui, "Roslyn language server", &mut v.csharp_server, &inherited(scope, &g.csharp_server, "the VS Code C# extension or the roslyn-language-server tool"), Some(&servers[2]), SUB);
                    kit::path_row(ui, "dotnet", &mut v.dotnet, &inherited(scope, &g.dotnet, "DOTNET_ROOT, PATH or ~/.dotnet"), Some(&servers[3]), SUB);
                }
            }
        }
        kit::note(ui, "A changed path restarts that language's servers. An empty path in Project scope takes the global one.");
    });
    card(ui, |ui| {
        let scope = shared_header(ui, d, Shared::Linters, Icon::Problems, "Errors and warnings in open TS and JS files");
        let v = values(d, scope);
        kit::tri_row(ui, "TypeScript errors from the TS server", &mut v.ts_diagnostics);
        kit::tri_row(ui, "oxlint", &mut v.oxlint);
        kit::tri_row(ui, "oxlint type-aware rules", &mut v.oxlint_type_aware);
        kit::tri_row(ui, "ESLint", &mut v.eslint);
        kit::note(ui, "Auto: on where the package has the linter's config and package installed. oxlint and ESLint come from each package's node_modules. Auto in Project scope takes the global choice.");
    });
}

/// A press on a project row's button in Frameworks.
pub enum UnrealAction {
    Regenerate(std::path::PathBuf),
    Stop(std::path::PathBuf),
}

/// `live`: each project row's state now (`unreal::status_of`), in row order.
pub fn frameworks(ui: &mut Ui, d: &mut SettingsDialog, live: &[Option<crate::unreal::Status>]) -> Option<UnrealAction> {
    let mut action = None;
    card(ui, |ui| {
        header(ui, Icon::Cube, "Unreal Engine", "The engine and clangd setup of Unreal projects", |ui| {
            kit::badge(ui, "Unreal Engine", Scope::Project);
        });
        let Some(p) = d.project.as_mut() else {
            kit::note(ui, "Open a project to change its settings.");
            return;
        };
        let v = &mut p.values;
        kit::path_row(ui, "Default engine", &mut v.unreal_engine, "from EngineAssociation via the Epic launcher", None, 0.0);
        kit::switch_row(ui, "Index the engine's files (clangd background index)", None, &mut v.unreal_index_engine);
        if v.unreal_projects.is_empty() {
            kit::note(ui, "No Unreal project found yet. A project (a folder with a *.uproject) is detected when one of its C/C++ files opens.");
        }
        for (i, row) in v.unreal_projects.iter_mut().enumerate() {
            kit::divider(ui);
            let folder = if row.rel.is_empty() { "the opened folder".to_string() } else { row.rel.clone() };
            kit::subheading(ui, &format!("{} ({folder})", row.name));
            let shown = match &row.detected {
                Ok(s) => Detected::Found(s.clone()),
                Err(e) => Detected::Missing(e.clone()),
            };
            kit::path_row(ui, &format!("Engine for {}", row.name), &mut row.engine, "the default engine", Some(&shown), 0.0);
            if let Some(status) = live.get(i).and_then(Option::as_ref) {
                if let Some(a) = regenerate_row(ui, row, status) {
                    action = Some(a);
                }
            }
        }
    });
    card(ui, |ui| {
        header(ui, Icon::Cube, "Unity", "C# projects made with Unity", |ui| {
            kit::badge(ui, "Unity", Scope::Project);
        });
        kit::note(ui, "Unity projects need no settings here: C# goes through the Roslyn server (Languages).");
    });
    action
}

/// The project's database (age and entries) and its Regenerate button, or Stop while UBT
/// runs. A11y: the row `Compile database of <name>`, the button `Regenerate <name>` /
/// `Stop UnrealBuildTool for <name>`.
fn regenerate_row(ui: &mut Ui, row: &super::UnrealRow, status: &crate::unreal::Status) -> Option<UnrealAction> {
    let t = &theme::T;
    let label = format!("Compile database of {}", row.name);
    let hint = if status.running { "UnrealBuildTool is writing it now…".to_string() } else { status.db.text() };
    let text = if status.running { "Stop" } else { "Regenerate" };
    let w = ui.painter().layout_no_wrap("Regenerate".into(), t.ui_font(), t.text).size().x + 2.0 * ui.spacing().button_padding.x;
    let mut action = None;
    kit::control_row(ui, &label, Some(&hint), w, |ui| {
        let enabled = status.running || status.can.is_ok();
        let r = ui.add_enabled(enabled, egui::Button::new(text).min_size(egui::vec2(w, 22.0)));
        let a11y = if status.running { format!("Stop UnrealBuildTool for {}", row.name) } else { format!("Regenerate {}", row.name) };
        crate::util::label_widget(&r, egui::WidgetType::Button, a11y);
        let r = match &status.can {
            Err(why) if !status.running => r.on_disabled_hover_text(why),
            _ => r.on_hover_text(if status.running { crate::unreal::STOP } else { crate::unreal::REGENERATE }),
        };
        if r.clicked() {
            action = Some(if status.running { UnrealAction::Stop(row.root.clone()) } else { UnrealAction::Regenerate(row.root.clone()) });
        }
    });
    action
}
