//! The Settings dialog (⌘, or the gear in the title bar), IDEA's layout: pages on the left
//! (System, Keymap, Editor, Languages, Frameworks), the page on the right, OK and Cancel.
//!
//! Two kinds of values, and each section says which it holds:
//! - Global settings (`global.rs`) belong to the IDE and live in eframe storage (the app config).
//!   OK applies them at once.
//! - Project settings live in the project's `.harwex/ide.toml` (architecture rule 10). OK
//!   writes only the changed keys on a worker (`project.rs`) and applies the file like a
//!   watcher reload.
//!
//! `files.rs` makes System › Files work: autosave, backups, permanent delete and the sync of
//! open files with the disk.

pub mod files;
pub mod global;
pub mod keymap;
mod pages;
pub mod project;

use std::path::PathBuf;

use egui::{Context, Modal, RichText};

use crate::format::oxfmt::OxfmtInstall;
use crate::lang::config::normalize_extension;
use crate::lang::{IdeConfig, LangId};
use crate::state::AppState;
use crate::theme;
use crate::workspace::wid;

pub use global::GlobalSettings;
use project::Edit;

/// The window-wide settings state in `AppState::settings`.
#[derive(Default)]
pub struct AppSettings {
    /// The values in force.
    pub global: GlobalSettings,
    /// Autosave and sync at work.
    pub sync: files::FileSync,
    /// Where backups go (`AppOptions::backup_dir`). `None`: no backups, whatever the setting.
    pub backup_dir: Option<PathBuf>,
    /// The page the dialog opens on: the one shown last.
    pub last_page: Page,
}

impl AppSettings {
    /// The backup folder for the next save, when backups are on.
    pub fn backup_target(&self) -> Option<PathBuf> {
        self.backup_dir.clone().filter(|_| self.global.files.backup)
    }
}

/// Reads the global settings from eframe storage.
pub fn load_storage(state: &mut AppState, storage: &dyn eframe::Storage) {
    state.settings.global = GlobalSettings::load(storage);
}

pub fn save_storage(state: &AppState, storage: &mut dyn eframe::Storage) {
    state.settings.global.save(storage);
}

/// Startup: the backup folder, the idle timer (off in deterministic mode) and the removal of
/// old backups on a worker.
pub fn start(state: &mut AppState, backup_dir: Option<PathBuf>, deterministic: bool) {
    state.settings.sync.idle_timer = !deterministic;
    state.settings.backup_dir = backup_dir.clone();
    if let Some(dir) = backup_dir {
        state.jobs.window().spawn_quiet(move || files::prune_backups(&dir, files::BACKUP_MAX_AGE), |_, ()| {});
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Page {
    #[default]
    System,
    Keymap,
    Editor,
    Languages,
    Frameworks,
}

impl Page {
    pub const ALL: [Page; 5] = [Page::System, Page::Keymap, Page::Editor, Page::Languages, Page::Frameworks];

    pub fn title(self) -> &'static str {
        match self {
            Page::System => "System",
            Page::Keymap => "Keymap",
            Page::Editor => "Editor",
            Page::Languages => "Languages",
            Page::Frameworks => "Frameworks",
        }
    }

    /// The a11y label of the page's row in the list.
    pub fn label(self) -> String {
        format!("Settings page {}", self.title())
    }
}

/// What a lookup on a worker found: oxfmt for the Editor page, a server for Languages.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Detected<T> {
    Looking,
    Found(T),
    Missing(String),
}

/// One detected Unreal project, for the Frameworks page.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UnrealRow {
    /// The folder relative to the opened one (`""` for the opened folder itself).
    pub rel: String,
    pub name: String,
    /// The `[unreal.projects."<rel>"] engine` override.
    pub engine: String,
    /// What the project uses now ("UE 5.4 at <path>"), or why there is none.
    pub detected: Result<String, String>,
}

/// The values of the project pages, as the fields show them.
#[derive(Clone, Debug, PartialEq)]
pub struct ProjectValues {
    pub on_save: bool,
    /// The file types as the user types them: comma-separated extensions.
    pub extensions: String,
    /// Per `LangId::ALL`: the server may start.
    pub languages: [bool; 4],
    pub rust_server: String,
    pub clangd: String,
    pub csharp_server: String,
    pub dotnet: String,
    pub ts_diagnostics: Option<bool>,
    pub oxlint: Option<bool>,
    pub oxlint_type_aware: Option<bool>,
    pub eslint: Option<bool>,
    pub unreal_engine: String,
    pub unreal_index_engine: bool,
    pub unreal_projects: Vec<UnrealRow>,
}

fn path_text(p: &Option<PathBuf>) -> String {
    p.as_ref().map(|p| p.display().to_string()).unwrap_or_default()
}

impl ProjectValues {
    pub fn of(config: &IdeConfig, unreal: Vec<UnrealRow>) -> ProjectValues {
        let languages = LangId::ALL.map(|l| config.languages.as_ref().is_none_or(|ls| ls.contains(&l)));
        ProjectValues {
            on_save: config.oxfmt.on_save,
            extensions: config.oxfmt.extensions.join(", "),
            languages,
            rust_server: path_text(&config.rust.server),
            clangd: path_text(&config.cpp.clangd),
            csharp_server: path_text(&config.csharp.server),
            dotnet: path_text(&config.csharp.dotnet),
            ts_diagnostics: config.diagnostics.ts,
            oxlint: config.diagnostics.oxlint.enabled,
            oxlint_type_aware: config.diagnostics.oxlint.type_aware,
            eslint: config.diagnostics.eslint.enabled,
            unreal_engine: path_text(&config.unreal.engine),
            unreal_index_engine: config.unreal.index_engine,
            unreal_projects: unreal,
        }
    }

    /// The `.harwex/ide.toml` changes from `old` to `self`; only keys whose value changed.
    pub fn edits(&self, old: &ProjectValues) -> Vec<Edit> {
        use crate::lang::config::OXFMT_DEFAULT_EXTENSIONS;
        let mut out = Vec::new();
        if self.on_save != old.on_save {
            out.push(Edit::set(&["format", "oxfmt", "on_save"], self.on_save));
        }
        let ext = parse_extensions(&self.extensions);
        if ext != parse_extensions(&old.extensions) {
            if ext.iter().map(String::as_str).eq(OXFMT_DEFAULT_EXTENSIONS) {
                out.push(Edit::remove(&["format", "oxfmt", "extensions"]));
            } else {
                out.push(Edit::set(&["format", "oxfmt", "extensions"], ext.iter().map(String::as_str).collect::<toml_edit::Array>()));
            }
        }
        if self.languages != old.languages {
            if self.languages.iter().all(|on| *on) {
                out.push(Edit::remove(&["languages"]));
            } else {
                let keys: toml_edit::Array = LangId::ALL.iter().zip(self.languages).filter(|(_, on)| *on).map(|(l, _)| l.key()).collect();
                out.push(Edit::set(&["languages"], keys));
            }
        }
        let paths: [(&String, &String, &[&str]); 5] = [
            (&self.rust_server, &old.rust_server, &["rust", "server"]),
            (&self.clangd, &old.clangd, &["cpp", "clangd"]),
            (&self.csharp_server, &old.csharp_server, &["csharp", "server"]),
            (&self.dotnet, &old.dotnet, &["csharp", "dotnet"]),
            (&self.unreal_engine, &old.unreal_engine, &["unreal", "engine"]),
        ];
        for (new, old, key) in paths {
            if new.trim() != old.trim() {
                out.push(Edit::path_or_remove(key, new));
            }
        }
        let flags: [(Option<bool>, Option<bool>, &[&str]); 4] = [
            (self.ts_diagnostics, old.ts_diagnostics, &["diagnostics", "ts"]),
            (self.oxlint, old.oxlint, &["diagnostics", "oxlint", "enabled"]),
            (self.oxlint_type_aware, old.oxlint_type_aware, &["diagnostics", "oxlint", "type_aware"]),
            (self.eslint, old.eslint, &["diagnostics", "eslint", "enabled"]),
        ];
        for (new, old, key) in flags {
            if new != old {
                out.push(Edit::flag_or_remove(key, new));
            }
        }
        if self.unreal_index_engine != old.unreal_index_engine {
            out.push(if self.unreal_index_engine { Edit::set(&["unreal", "index_engine"], true) } else { Edit::remove(&["unreal", "index_engine"]) });
        }
        for row in &self.unreal_projects {
            let before = old.unreal_projects.iter().find(|r| r.rel == row.rel).map_or("", |r| r.engine.as_str());
            if row.engine.trim() != before.trim() {
                let key = crate::lang::config::project_key(&row.rel);
                out.push(Edit::path_or_remove(&["unreal", "projects", &key, "engine"], &row.engine));
            }
        }
        out
    }
}

/// The project part of the dialog. `None` without an open project.
pub struct ProjectDraft {
    pub root: PathBuf,
    pub initial: ProjectValues,
    pub values: ProjectValues,
}

/// The servers the Languages page looks up, in its order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Server {
    RustAnalyzer,
    Clangd,
    Roslyn,
    Dotnet,
}

pub struct SettingsDialog {
    pub page: Page,
    /// The global values being edited.
    pub global: GlobalSettings,
    pub project: Option<ProjectDraft>,
    pub keymap_filter: String,
    /// What the oxfmt section found for the active file's folder.
    pub oxfmt: Detected<OxfmtInstall>,
    /// The folder the oxfmt lookup started from.
    probe: Option<PathBuf>,
    /// Per `Server`, filled when the Languages page first shows.
    pub servers: [Detected<String>; 4],
    servers_asked: bool,
    generation: u64,
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

/// Opens the dialog on the page shown last, with the current values.
pub fn open(state: &mut AppState) {
    open_page(state, state.settings.last_page);
}

pub fn open_page(state: &mut AppState, page: Page) {
    let generation = state.ws.settings.as_ref().map_or(0, |d| d.generation) + 1;
    let root = state.ws.project.as_ref().map(|p| p.root.clone());
    let project = root.as_ref().map(|root| {
        let values = ProjectValues::of(&state.ws.langs.config, unreal_rows(state, root));
        ProjectDraft { root: root.clone(), initial: values.clone(), values }
    });
    let probe = root.as_ref().map(|r| crate::format::probe_dir(state).unwrap_or_else(|| r.clone()));
    let looking = || Detected::Looking;
    state.ws.settings = Some(SettingsDialog {
        page,
        global: state.settings.global.clone(),
        project,
        keymap_filter: String::new(),
        oxfmt: if probe.is_some() { Detected::Looking } else { Detected::Missing(String::new()) },
        probe: probe.clone(),
        servers: [looking(), looking(), looking(), looking()],
        servers_asked: false,
        generation,
    });
    if let Some(probe) = probe {
        state.jobs.spawn_quiet(
            move || crate::format::oxfmt::find(&probe),
            move |state, found| {
                if let Some(d) = state.ws.settings.as_mut().filter(|d| d.generation == generation) {
                    d.oxfmt = found.map_or(Detected::Missing(String::new()), Detected::Found);
                }
            },
        );
    }
}

fn unreal_rows(state: &AppState, root: &std::path::Path) -> Vec<UnrealRow> {
    let config = &state.ws.langs.config.unreal;
    state
        .ws
        .unreal
        .projects
        .values()
        .map(|p| {
            let rel = p.root.strip_prefix(root).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
            let engine = config.projects.get(&crate::lang::config::project_key(&rel)).and_then(|o| o.engine.as_ref()).map(|e| e.display().to_string()).unwrap_or_default();
            let detected = match &p.engine {
                Ok(e) => Ok(format!("{} at {}", p.engine_label().unwrap_or_else(|| "Engine".into()), e.root.display())),
                Err(e) => Err(e.clone()),
            };
            UnrealRow { rel, name: p.name.clone(), engine, detected }
        })
        .collect()
}

/// Looks up the servers the Languages page shows, with the project's configured paths.
fn ask_servers(state: &mut AppState) {
    let Some(d) = state.ws.settings.as_mut() else { return };
    if d.servers_asked || d.project.is_none() {
        return;
    }
    d.servers_asked = true;
    let generation = d.generation;
    let config = state.ws.langs.config.clone();
    state.jobs.spawn_quiet(
        move || {
            let show = |r: Result<PathBuf, String>| match r {
                Ok(p) => Detected::Found(p.display().to_string()),
                Err(e) => Detected::Missing(e),
            };
            [
                show(crate::lang::rust::find_rust_analyzer(config.rust.server.as_deref())),
                show(crate::lang::cpp::find_clangd(config.cpp.clangd.as_deref()).map(|c| c.exe)),
                show(crate::lang::csharp::find_server(config.csharp.server.as_deref())),
                show(crate::lang::csharp::find_dotnet(config.csharp.dotnet.as_deref()).map(|d| d.exe)),
            ]
        },
        move |state, found| {
            if let Some(d) = state.ws.settings.as_mut().filter(|d| d.generation == generation) {
                d.servers = found;
            }
        },
    );
}

/// The width of the page list and of the page.
const NAV_W: f32 = 150.0;
const PAGE_W: f32 = 600.0;
/// The height of every page; fixed, so the dialog never changes size.
pub const PAGE_H: f32 = 430.0;

pub fn show(state: &mut AppState, ctx: &Context) {
    if state.ws.settings.as_ref().is_some_and(|d| d.page == Page::Languages) {
        ask_servers(state);
    }
    let running: [usize; 4] = LangId::ALL.map(|l| state.ws.langs.running(l));
    let langs_off = state.ws.langs.is_off();
    let Some(dialog) = state.ws.settings.as_mut() else { return };
    let t = &theme::T;
    let mut ok = false;
    let mut cancel = false;
    let mut open_file = false;
    // Anchored at the top like the tree dialogs: the title must not move.
    let area = Modal::default_area(wid("settings-dialog-area")).anchor(egui::Align2::CENTER_TOP, [0.0, 70.0]);
    let modal = Modal::new(wid("settings-dialog")).area(area).show(ctx, |ui| {
        ui.set_width(NAV_W + PAGE_W + 25.0);
        ui.label(RichText::new("Settings").strong());
        ui.add_space(8.0);
        ui.horizontal_top(|ui| {
            // Justified: each row is the list's width, its text on the left like IDEA's.
            let nav = ui.allocate_ui_with_layout(egui::vec2(NAV_W, PAGE_H), egui::Layout::top_down_justified(egui::Align::Min), |ui| {
                ui.set_width(NAV_W);
                ui.set_height(PAGE_H);
                ui.spacing_mut().button_padding = egui::vec2(8.0, 5.0);
                for page in Page::ALL {
                    let selected = dialog.page == page;
                    let r = ui.add(egui::SelectableLabel::new(selected, page.title()));
                    crate::util::label_selectable(&r, page.label(), selected);
                    if r.clicked() {
                        dialog.page = page;
                    }
                }
            });
            // A drawn line: egui's vertical separator grows with the row and moves the modal.
            let x = nav.response.rect.right() + 8.0;
            ui.painter().vline(x, nav.response.rect.y_range(), egui::Stroke::new(1.0_f32, t.popup_border));
            ui.add_space(16.0);
            ui.allocate_ui_with_layout(egui::vec2(PAGE_W, PAGE_H), egui::Layout::top_down(egui::Align::Min), |ui| {
                ui.set_width(PAGE_W);
                ui.set_height(PAGE_H);
                ui.label(RichText::new(dialog.page.title()).strong().size(t.font.big));
                ui.add_space(6.0);
                if dialog.page == Page::Keymap {
                    keymap::page(ui, &mut dialog.keymap_filter);
                    return;
                }
                egui::ScrollArea::vertical().id_salt(("settings-page", dialog.page.title())).auto_shrink([false, false]).min_scrolled_height(0.0).show(ui, |ui| {
                    ui.set_width(PAGE_W - 14.0);
                    match dialog.page {
                        Page::System => pages::system(ui, &mut dialog.global),
                        Page::Editor => pages::editor(ui, dialog),
                        Page::Languages => pages::languages(ui, dialog, running, langs_off),
                        Page::Frameworks => pages::frameworks(ui, dialog),
                        Page::Keymap => {}
                    }
                });
            });
        });
        ui.add_space(10.0);
        ui.horizontal(|ui| {
            let config = ui.add_enabled(dialog.project.is_some(), egui::Button::new(format!("Open {}", crate::lang::config::CONFIG_PATH)));
            open_file = config.clicked();
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                cancel = ui.button("Cancel").clicked();
                ok = ui.button("OK").clicked();
            });
        });
    });
    let page = dialog.page;
    state.settings.last_page = page;
    if open_file {
        let path = state.ws.settings.take().and_then(|d| d.project).map(|p| p.root.join(crate::lang::config::CONFIG_PATH));
        if let Some(path) = path {
            state.open_location(&path, None, true);
        }
        return;
    }
    if cancel || (!ok && modal.should_close()) {
        state.ws.settings = None;
        return;
    }
    if !ok {
        return;
    }
    let Some(dialog) = state.ws.settings.take() else { return };
    state.settings.global = dialog.global;
    let Some(project) = dialog.project else { return };
    let edits = project.values.edits(&project.initial);
    if edits.is_empty() {
        return;
    }
    let root = project.root;
    let generation = state.project_generation();
    state.jobs.spawn(
        "Saving settings",
        move || project::write(&root, &edits).map(|_| IdeConfig::load(&root)),
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

    #[test]
    fn only_changed_keys_are_written() {
        let config = IdeConfig::parse("[rust]\nserver = \"/ra\"\n");
        let old = ProjectValues::of(&config, vec![UnrealRow { rel: "Sub/Game".into(), name: "Game".into(), engine: String::new(), detected: Err("none".into()) }]);
        assert!(old.edits(&old).is_empty());
        let mut new = old.clone();
        new.on_save = true;
        new.languages[1] = false;
        new.rust_server = "  ".into();
        new.oxlint = Some(false);
        new.unreal_projects[0].engine = "/ue".into();
        let text = project::apply("", &new.edits(&old)).unwrap();
        let back = IdeConfig::parse(&text);
        assert!(back.warnings.is_empty(), "{:?}", back.warnings);
        assert!(back.oxfmt.on_save);
        assert_eq!(back.languages, Some(vec![LangId::TypeScript, LangId::Cpp, LangId::CSharp]));
        assert_eq!(back.rust.server, None);
        assert_eq!(back.diagnostics.oxlint.enabled, Some(false));
        assert_eq!(back.unreal.for_project("Sub/Game").engine, Some(PathBuf::from("/ue")));
        // Every language on again removes the list.
        let mut all = new.clone();
        all.languages = [true; 4];
        let edits = all.edits(&new);
        assert!(edits.len() == 1 && edits[0].path == ["languages"] && edits[0].value.is_none(), "{edits:?}");
    }
}
