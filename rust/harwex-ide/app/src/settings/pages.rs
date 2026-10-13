//! The Settings pages other than Keymap. Each section header carries its scope badge: Global
//! (the global `settings.toml`), Project (`.harwex/ide.toml`), or for a `Shared` section a
//! Global | Project switch with Reset to Global.

use egui::{DragValue, RichText, Sense, TextEdit, Ui};

use super::{global, Detected, GlobalSettings, LayerValues, Scope, SettingsDialog, Shared};
use crate::lang::LangId;
use crate::theme;

fn scope_name(scope: Scope) -> &'static str {
    match scope {
        Scope::Global => "Global",
        Scope::Project => "Project",
    }
}

fn scope_file(scope: Scope) -> &'static str {
    match scope {
        Scope::Global => global::FILE_NAME,
        Scope::Project => crate::lang::config::CONFIG_PATH,
    }
}

/// A scope pill. `selected` fills it with the scope's color; an unselected one is a dim
/// outline. A11y: `<section> scope <Global|Project>`.
fn chip(ui: &mut Ui, section: &str, scope: Scope, selected: bool, clickable: bool) -> egui::Response {
    let t = &theme::T;
    let text = scope_name(scope);
    let color = if selected { t.scope_text } else { t.text_dim };
    let galley = ui.painter().layout_no_wrap(text.to_string(), t.small_font(), color);
    let size = galley.size() + egui::vec2(14.0, 4.0);
    let (rect, resp) = ui.allocate_exact_size(size, if clickable { Sense::click() } else { Sense::hover() });
    let radius = t.radius.badge;
    if selected {
        let fill = match scope {
            Scope::Global => t.scope_global_bg,
            Scope::Project => t.scope_project_bg,
        };
        ui.painter().rect_filled(rect, radius, fill);
    } else {
        let fill = if resp.hovered() { t.button_hover } else { t.popup_bg };
        ui.painter().rect(rect, radius, fill, egui::Stroke::new(1.0_f32, t.popup_border), egui::StrokeKind::Inside);
    }
    ui.painter().galley(rect.center() - galley.size() / 2.0, galley, color);
    let label = format!("{section} scope {text}");
    if clickable {
        crate::util::label_selectable(&resp, label, selected);
    } else {
        crate::util::label_widget(&resp, egui::WidgetType::Label, label);
    }
    resp
}

/// The header of a section with one home: title, badge and file.
pub(super) fn section(ui: &mut Ui, title: &str, scope: Scope) {
    let t = &theme::T;
    ui.add_space(8.0);
    ui.horizontal(|ui| {
        ui.label(RichText::new(title).strong());
        chip(ui, title, scope, true, false);
        ui.label(RichText::new(scope_file(scope)).color(t.text_dim).size(t.font.small));
    });
    ui.add_space(2.0);
}

/// The header of a shared section: a Global | Project switch while a project is open, and
/// Reset to Global in Project scope. Switching to Project starts the override from the global
/// values. Returns the scope to edit.
fn shared_section(ui: &mut Ui, d: &mut SettingsDialog, s: Shared) -> Scope {
    let t = &theme::T;
    let title = s.title();
    let Some(p) = d.project.as_mut() else {
        section(ui, title, Scope::Global);
        return Scope::Global;
    };
    ui.add_space(8.0);
    let i = s.index();
    let mut pick = None;
    ui.horizontal(|ui| {
        ui.label(RichText::new(title).strong());
        ui.spacing_mut().item_spacing.x = 2.0;
        for scope in [Scope::Global, Scope::Project] {
            if chip(ui, title, scope, p.scope[i] == scope, true).clicked() {
                pick = Some(scope);
            }
        }
        ui.spacing_mut().item_spacing.x = 8.0;
        ui.add_space(6.0);
        ui.label(RichText::new(scope_file(p.scope[i])).color(t.text_dim).size(t.font.small));
        if p.scope[i] == Scope::Project {
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                let r = ui.add(egui::Button::new(RichText::new("Reset to Global").size(t.font.small)).small());
                crate::util::label_widget(&r, egui::WidgetType::Button, format!("Reset {title} to Global"));
                if r.clicked() {
                    pick = Some(Scope::Global);
                }
            });
        }
    });
    if let Some(scope) = pick.filter(|s| *s != p.scope[i]) {
        if scope == Scope::Project {
            s.copy(&d.global_values, &mut p.values);
        }
        p.scope[i] = scope;
    }
    let scope = p.scope[i];
    let text = match scope {
        Scope::Global => "All projects use these values. Project overrides them for this project only.",
        Scope::Project => "This project overrides the global values.",
    };
    hint(ui, text);
    ui.add_space(2.0);
    scope
}

/// The values a shared section edits in `scope`.
fn values(d: &mut SettingsDialog, scope: Scope) -> &mut LayerValues {
    match (scope, d.project.as_mut()) {
        (Scope::Project, Some(p)) => &mut p.values,
        _ => &mut d.global_values,
    }
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
    section(ui, "Project view", Scope::Global);
    ui.checkbox(&mut f.show_ignored, "Show ignored files in Project");
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
    let scope = shared_section(ui, d, Shared::Formatting);
    let v = values(d, scope);
    ui.checkbox(&mut v.on_save, "Run oxfmt on save");
    hint(ui, "On ⌘S and Save All (⌥⌘S). ⌥⌘L formats the active file at any time.");
    ui.add_space(6.0);
    ui.label("File types (extensions):");
    let edit = ui.add(TextEdit::singleline(&mut v.extensions).hint_text("ts, tsx, js, json").desired_width(f32::INFINITY));
    crate::util::label_widget(&edit, egui::WidgetType::TextEdit, "oxfmt file types");
    ui.add_space(6.0);
    let Some(root) = d.project.as_ref().map(|p| p.root.clone()) else { return };
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

/// The text a path field shows while empty: in Project scope the global value it inherits.
fn inherited(scope: Scope, global: &str, default: &str) -> String {
    match (scope, global.trim()) {
        (Scope::Project, g) if !g.is_empty() => format!("global: {g}"),
        _ => default.to_string(),
    }
}

pub fn languages(ui: &mut Ui, d: &mut SettingsDialog, running: [usize; 4], off: bool) {
    let scope = shared_section(ui, d, Shared::Servers);
    let g = d.global_values.clone();
    let servers = d.servers.clone();
    let v = values(d, scope);
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
                path_field(ui, "rust-analyzer", &mut v.rust_server, &inherited(scope, &g.rust_server, "PATH, ~/.cargo/bin or rustup"));
                found_line(ui, "In use", &servers[0]);
            }
            LangId::Cpp => {
                path_field(ui, "clangd", &mut v.clangd, &inherited(scope, &g.clangd, "PATH, xcrun or Homebrew LLVM"));
                found_line(ui, "In use", &servers[1]);
            }
            LangId::CSharp => {
                path_field(ui, "Roslyn language server", &mut v.csharp_server, &inherited(scope, &g.csharp_server, "the VS Code C# extension or the roslyn-language-server tool"));
                found_line(ui, "In use", &servers[2]);
                path_field(ui, "dotnet", &mut v.dotnet, &inherited(scope, &g.dotnet, "DOTNET_ROOT, PATH or ~/.dotnet"));
                found_line(ui, "In use", &servers[3]);
            }
        });
    }
    hint(ui, "A changed path restarts that language's servers. An empty path in Project scope takes the global one.");
    let scope = shared_section(ui, d, Shared::Linters);
    let v = values(d, scope);
    tri(ui, "TypeScript errors from the TS server", &mut v.ts_diagnostics);
    tri(ui, "oxlint", &mut v.oxlint);
    tri(ui, "oxlint type-aware rules", &mut v.oxlint_type_aware);
    tri(ui, "ESLint", &mut v.eslint);
    hint(ui, "Auto: on where the package has the linter's config and package installed. oxlint and ESLint come from each package's node_modules. Auto in Project scope takes the global choice.");
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
