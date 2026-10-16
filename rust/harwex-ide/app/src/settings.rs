//! The Settings dialog (⌘, or the gear in the title bar), IDEA's layout: pages on the left
//! (System, Keymap, Editor, Languages, Frameworks), the page on the right, OK and Cancel.
//!
//! Each section has a scope badge (task 104, IDEA's IDE vs project settings):
//! - Global sections (System, Keymap, the editor font) live in the global `settings.toml`
//!   (`global.rs`). OK applies them at once and writes the changed keys on a worker.
//! - Project sections (Unreal) live in the project's `.harwex/ide.toml` (architecture rule 10).
//!   OK writes only the changed keys on a worker (`project.rs`) and applies the file like a
//!   watcher reload.
//! - Shared sections (`Shared`: oxfmt, language servers, linters) have a global value that a
//!   project can override. The badge switches the scope: Project writes the whole section into
//!   `.harwex/ide.toml`, Global removes the section's keys there, so the global values apply.
//!
//! `files.rs` makes System › Files work: autosave, backups, permanent delete and the sync of
//! open files with the disk.

pub mod files;
pub mod global;
pub mod keymap;
mod kit;
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
    /// The global settings file (`AppOptions::settings_file`). `None`: eframe storage only.
    pub file: Option<PathBuf>,
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

/// Reads the global settings: from `file` when there is one, else from eframe storage. A
/// missing file takes the values task 101 kept in storage and writes them into the file on a
/// worker. Runs once in `IdeApp::create`, before the first frame (a recorded exception to
/// rule 1, like eframe's own storage read).
pub fn load(state: &mut AppState, storage: Option<&dyn eframe::Storage>, file: Option<PathBuf>) {
    let stored = storage.and_then(|s| s.get_string(global::STORAGE_KEY));
    let Some(file) = file else {
        if let Some(text) = stored {
            state.settings.global = GlobalSettings::parse(&text);
        }
        warn_layer(state);
        return;
    };
    // Tabs are keyed by canonical path; a save of this file must find it (`saved`).
    let file = match (file.parent().and_then(|d| dunce::canonicalize(d).ok()), file.file_name()) {
        (Some(dir), Some(name)) => dir.join(name),
        _ => file,
    };
    match std::fs::read_to_string(&file) {
        Ok(text) => state.settings.global = GlobalSettings::parse(&text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if let Some(text) = stored {
                state.settings.global = GlobalSettings::parse(&text);
                let (path, text) = (file.clone(), state.settings.global.to_text());
                state.jobs.window().spawn_quiet(move || write_whole(&path, &text), |state, res| {
                    if let Err(e) = res {
                        state.notifications.error("Cannot write the global settings", e);
                    }
                });
            }
        }
        Err(e) => state.notifications.error("Cannot read the global settings", format!("{}: {e}", file.display())),
    }
    state.settings.file = Some(file);
    warn_layer(state);
}

fn warn_layer(state: &mut AppState) {
    for w in state.settings.global.layer_warnings() {
        state.notifications.warn("Global settings", w);
    }
}

fn write_whole(path: &std::path::Path, text: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    std::fs::write(path, text).map_err(|e| format!("{}: {e}", path.display()))
}

/// Keeps the global settings in eframe storage when there is no file.
pub fn save_storage(state: &AppState, storage: &mut dyn eframe::Storage) {
    if state.settings.file.is_none() {
        state.settings.global.save(storage);
    }
}

/// The default global settings file: `settings.toml` in the app data folder, or in the temp
/// dir in background mode (like the background eframe storage).
pub fn default_file(background: bool) -> Option<PathBuf> {
    if background {
        return Some(std::env::temp_dir().join("harwex-ide-background-settings.toml"));
    }
    eframe::storage_dir("harwex-ide").map(|d| d.join(global::FILE_NAME))
}

/// Puts `new` in force. A change of the project defaults re-applies every project's config,
/// except `skip` (its own write applies it).
pub fn set_global(state: &mut AppState, new: GlobalSettings, skip: Option<crate::workspace::WorkspaceId>) {
    let layer_changed = new.layer != state.settings.global.layer;
    let relist = new.files.show_ignored != state.settings.global.files.show_ignored;
    state.settings.global = new;
    if relist {
        for ws in state.all_ws_mut() {
            ws.tree.relist();
            ws.breadcrumbs.relist();
        }
    }
    if !layer_changed {
        return;
    }
    let ids: Vec<_> = state.all_ws().filter(|w| w.project.is_some() && Some(w.id) != skip).map(|w| w.id).collect();
    for id in ids {
        state.with_ws(id, |s| {
            let mut config = s.ws.langs.config.clone();
            // Its warnings were shown when the project file was read.
            config.warnings.clear();
            s.apply_ide_config(config);
        });
    }
}

/// A save of `path` finished. The global settings file is read again and put in force.
pub fn saved(state: &mut AppState, path: &std::path::Path) {
    if state.settings.file.as_deref() != Some(path) {
        return;
    }
    let path = path.to_path_buf();
    state.jobs.window().spawn_quiet(
        move || std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display())),
        |state, res| match res {
            Ok(text) => {
                let new = GlobalSettings::parse(&text);
                set_global(state, new, None);
                warn_layer(state);
            }
            Err(e) => state.notifications.error("Cannot read the global settings", e),
        },
    );
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

    /// The one line under the page's title.
    pub fn subtitle(self) -> &'static str {
        match self {
            Page::System => "Files, autosave and the Project view",
            Page::Keymap => "The keyboard shortcuts of every action",
            Page::Editor => "Font and formatting",
            Page::Languages => "Language servers, linters and checks",
            Page::Frameworks => "Game engine projects",
        }
    }

    pub fn icon(self) -> crate::icons::Icon {
        use crate::icons::Icon;
        match self {
            Page::System => Icon::Monitor,
            Page::Keymap => Icon::Keyboard,
            Page::Editor => Icon::Edit,
            Page::Languages => Icon::Code,
            Page::Frameworks => Icon::Cube,
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

/// Where a section's values live.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scope {
    Global,
    Project,
}

/// The sections that have a global value and a per-project override.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shared {
    /// Editor › Formatting: oxfmt.
    Formatting,
    /// Languages › Language servers.
    Servers,
    /// Languages › Linters and checks.
    Linters,
}

impl Shared {
    pub const ALL: [Shared; 3] = [Shared::Formatting, Shared::Servers, Shared::Linters];

    pub fn title(self) -> &'static str {
        match self {
            Shared::Formatting => "Formatting: oxfmt",
            Shared::Servers => "Language servers",
            Shared::Linters => "Linters and checks",
        }
    }

    pub fn index(self) -> usize {
        self as usize
    }

    /// The `ide.toml` keys of the section.
    pub fn keys(self) -> &'static [&'static [&'static str]] {
        match self {
            Shared::Formatting => &[&["format", "oxfmt", "on_save"], &["format", "oxfmt", "extensions"]],
            Shared::Servers => &[&["languages"], &["rust", "server"], &["cpp", "clangd"], &["csharp", "server"], &["csharp", "dotnet"]],
            Shared::Linters => &[&["diagnostics", "ts"], &["diagnostics", "oxlint", "enabled"], &["diagnostics", "oxlint", "type_aware"], &["diagnostics", "eslint", "enabled"]],
        }
    }

    /// Project when the project file sets any key of the section.
    pub fn scope_in(self, own: &toml::Table) -> Scope {
        let set = |path: &[&str]| {
            let (key, tables) = path.split_last().expect("a key");
            let mut t = own;
            for name in tables {
                match t.get(*name).and_then(toml::Value::as_table) {
                    Some(inner) => t = inner,
                    None => return false,
                }
            }
            t.contains_key(*key)
        };
        if self.keys().iter().any(|k| set(k)) {
            Scope::Project
        } else {
            Scope::Global
        }
    }

    /// Copies the section's fields.
    pub fn copy(self, from: &LayerValues, to: &mut LayerValues) {
        match self {
            Shared::Formatting => {
                to.on_save = from.on_save;
                to.extensions = from.extensions.clone();
            }
            Shared::Servers => {
                to.languages = from.languages;
                to.rust_server = from.rust_server.clone();
                to.clangd = from.clangd.clone();
                to.csharp_server = from.csharp_server.clone();
                to.dotnet = from.dotnet.clone();
            }
            Shared::Linters => {
                to.ts_diagnostics = from.ts_diagnostics;
                to.oxlint = from.oxlint;
                to.oxlint_type_aware = from.oxlint_type_aware;
                to.eslint = from.eslint;
            }
        }
    }

    /// The edits from `old` to `new` for this section; `None` writes every key. `explicit` (a
    /// project override) writes values equal to the defaults too, since a missing project key
    /// means "the global value". An empty path or Auto always removes the key.
    pub fn edits(self, new: &LayerValues, old: Option<&LayerValues>, explicit: bool) -> Vec<Edit> {
        use crate::lang::config::OXFMT_DEFAULT_EXTENSIONS;
        let mut out = Vec::new();
        match self {
            Shared::Formatting => {
                if old.is_none_or(|o| o.on_save != new.on_save) {
                    out.push(if new.on_save || explicit { Edit::set(&["format", "oxfmt", "on_save"], new.on_save) } else { Edit::remove(&["format", "oxfmt", "on_save"]) });
                }
                let ext = parse_extensions(&new.extensions);
                if old.is_none_or(|o| parse_extensions(&o.extensions) != ext) {
                    let default = ext.iter().map(String::as_str).eq(OXFMT_DEFAULT_EXTENSIONS);
                    if ext.is_empty() || (default && !explicit) {
                        out.push(Edit::remove(&["format", "oxfmt", "extensions"]));
                    } else {
                        out.push(Edit::set(&["format", "oxfmt", "extensions"], ext.iter().map(String::as_str).collect::<toml_edit::Array>()));
                    }
                }
            }
            Shared::Servers => {
                if old.is_none_or(|o| o.languages != new.languages) {
                    if new.languages.iter().all(|on| *on) && !explicit {
                        out.push(Edit::remove(&["languages"]));
                    } else {
                        let keys: toml_edit::Array = LangId::ALL.iter().zip(new.languages).filter(|(_, on)| *on).map(|(l, _)| l.key()).collect();
                        out.push(Edit::set(&["languages"], keys));
                    }
                }
                let paths: [(&String, Option<&String>, &[&str]); 4] = [
                    (&new.rust_server, old.map(|o| &o.rust_server), &["rust", "server"]),
                    (&new.clangd, old.map(|o| &o.clangd), &["cpp", "clangd"]),
                    (&new.csharp_server, old.map(|o| &o.csharp_server), &["csharp", "server"]),
                    (&new.dotnet, old.map(|o| &o.dotnet), &["csharp", "dotnet"]),
                ];
                for (new, old, key) in paths {
                    if old.is_none_or(|o| o.trim() != new.trim()) {
                        out.push(Edit::path_or_remove(key, new));
                    }
                }
            }
            Shared::Linters => {
                type Flag = fn(&LayerValues) -> Option<bool>;
                let flags: [(Flag, &[&str]); 4] = [
                    (|v| v.ts_diagnostics, &["diagnostics", "ts"]),
                    (|v| v.oxlint, &["diagnostics", "oxlint", "enabled"]),
                    (|v| v.oxlint_type_aware, &["diagnostics", "oxlint", "type_aware"]),
                    (|v| v.eslint, &["diagnostics", "eslint", "enabled"]),
                ];
                for (get, key) in flags {
                    if old.map(get) != Some(get(new)) {
                        out.push(Edit::flag_or_remove(key, get(new)));
                    }
                }
            }
        }
        out
    }

    /// Removes the section's keys: the global values apply again.
    pub fn reset(self) -> Vec<Edit> {
        self.keys().iter().map(|k| Edit::remove(k)).collect()
    }
}

/// The values of the pages that write `ide.toml` keys, as the fields show them: the global
/// layer's or a project's.
#[derive(Clone, Debug, PartialEq)]
pub struct LayerValues {
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

impl LayerValues {
    pub fn of(config: &IdeConfig, unreal: Vec<UnrealRow>) -> LayerValues {
        let languages = LangId::ALL.map(|l| config.languages.as_ref().is_none_or(|ls| ls.contains(&l)));
        LayerValues {
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

    /// The edits of the project-only fields (Unreal), only keys whose value changed.
    pub fn project_edits(&self, old: &LayerValues) -> Vec<Edit> {
        let mut out = Vec::new();
        if self.unreal_engine.trim() != old.unreal_engine.trim() {
            out.push(Edit::path_or_remove(&["unreal", "engine"], &self.unreal_engine));
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
    /// The values in force (the project file over the global layer).
    pub initial: LayerValues,
    pub values: LayerValues,
    /// Per `Shared`: the scope when the dialog opened, and the one chosen.
    pub initial_scope: [Scope; 3],
    pub scope: [Scope; 3],
}

impl ProjectDraft {
    /// The `.harwex/ide.toml` edits of the dialog.
    pub fn edits(&self) -> Vec<Edit> {
        let mut out = self.values.project_edits(&self.initial);
        for s in Shared::ALL {
            let i = s.index();
            out.extend(match (self.initial_scope[i], self.scope[i]) {
                (Scope::Project, Scope::Project) => s.edits(&self.values, Some(&self.initial), true),
                (Scope::Global, Scope::Project) => s.edits(&self.values, None, true),
                (Scope::Project, Scope::Global) => s.reset(),
                (Scope::Global, Scope::Global) => Vec::new(),
            });
        }
        out
    }
}

/// Which values a shared section shows and edits.
pub fn scope_of(project: &Option<ProjectDraft>, s: Shared) -> Scope {
    project.as_ref().map_or(Scope::Global, |p| p.scope[s.index()])
}

/// The scope a page's footer button opens: Project when a section of the page is.
pub fn page_scope(page: Page, project: &Option<ProjectDraft>) -> Scope {
    let shared: &[Shared] = match page {
        Page::System | Page::Keymap => return Scope::Global,
        Page::Frameworks => return if project.is_some() { Scope::Project } else { Scope::Global },
        Page::Editor => &[Shared::Formatting],
        Page::Languages => &[Shared::Servers, Shared::Linters],
    };
    if shared.iter().any(|s| scope_of(project, *s) == Scope::Project) {
        Scope::Project
    } else {
        Scope::Global
    }
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
    /// The global values being edited (`[files]`, `[editor]`; `layer` stays as it was).
    pub global: GlobalSettings,
    /// The global layer's values of the shared sections, as opened and as edited.
    pub global_initial: LayerValues,
    pub global_values: LayerValues,
    pub project: Option<ProjectDraft>,
    pub keymap: keymap::KeymapView,
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
        let config = &state.ws.langs.config;
        let values = LayerValues::of(config, unreal_rows(state, root));
        let scope = Shared::ALL.map(|s| s.scope_in(&config.own));
        ProjectDraft { root: root.clone(), initial: values.clone(), values, initial_scope: scope, scope }
    });
    let global_values = LayerValues::of(&IdeConfig::parse_table(&state.settings.global.layer), Vec::new());
    let probe = root.as_ref().map(|r| crate::format::probe_dir(state).unwrap_or_else(|| r.clone()));
    let looking = || Detected::Looking;
    state.ws.settings = Some(SettingsDialog {
        page,
        global: state.settings.global.clone(),
        global_initial: global_values.clone(),
        global_values,
        project,
        keymap: Default::default(),
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

/// Looks up the servers the Languages page shows, with the paths in force.
fn ask_servers(state: &mut AppState) {
    let Some(d) = state.ws.settings.as_mut() else { return };
    if d.servers_asked {
        return;
    }
    d.servers_asked = true;
    let generation = d.generation;
    let config = state.ws.langs.config.layered(&state.settings.global.layer);
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

/// The dialog's size: as big as `DIALOG` allows, smaller in a small window, fixed for a
/// window size so the dialog never moves.
const DIALOG: egui::Vec2 = egui::vec2(880.0, 580.0);
const DIALOG_TOP: f32 = 64.0;
/// The page list's width, and in a dialog under `NARROW` wide.
const NAV_W: f32 = 200.0;
const NAV_W_NARROW: f32 = 156.0;
const NARROW: f32 = 760.0;
const FOOTER_H: f32 = 56.0;

pub fn dialog_size(screen: egui::Rect) -> egui::Vec2 {
    egui::vec2((screen.width() - 32.0).clamp(480.0, DIALOG.x), (screen.height() - DIALOG_TOP - 24.0).clamp(320.0, DIALOG.y))
}

/// The page list: the dialog's title, then one row per page with its icon. The selected row
/// has an accent tint and an accent bar at its left edge. A11y: `Settings page <title>`.
fn nav(ui: &mut egui::Ui, rect: egui::Rect, page: &mut Page) {
    let t = &theme::T;
    let title_pos = rect.min + egui::vec2(20.0, 20.0);
    let title = ui.painter().text(title_pos, egui::Align2::LEFT_TOP, "Settings", t.semibold(t.font.big), t.text_bright);
    let r = ui.interact(title, wid("settings-title"), egui::Sense::hover());
    crate::util::label_widget(&r, egui::WidgetType::Label, "Settings");
    let mut y = rect.top() + 56.0;
    for p in Page::ALL {
        let row = egui::Rect::from_min_size(egui::pos2(rect.left() + 10.0, y), egui::vec2(rect.width() - 20.0, 32.0));
        y += 34.0;
        let resp = ui.interact(row, wid(("settings-nav", p.title())), egui::Sense::click());
        let selected = *page == p;
        let painter = ui.painter();
        if selected {
            painter.rect_filled(row, t.radius.button, t.settings_nav_selected);
            let bar = egui::Rect::from_min_size(egui::pos2(row.left(), row.top() + 8.0), egui::vec2(3.0, row.height() - 16.0));
            painter.rect_filled(bar, 1.5, t.accent);
        } else if resp.hovered() {
            painter.rect_filled(row, t.radius.button, t.hover);
        }
        let icon = egui::Rect::from_center_size(egui::pos2(row.left() + 20.0, row.center().y), egui::vec2(16.0, 16.0));
        crate::icons::paint(painter, icon, p.icon(), if selected { t.section_icon } else { t.tree_chevron });
        let (font, color) = if selected { (t.semibold(t.font.ui), t.text_bright) } else { (t.ui_font(), t.text) };
        painter.text(egui::pos2(icon.right() + 10.0, row.center().y), egui::Align2::LEFT_CENTER, p.title(), font, color);
        crate::util::label_selectable(&resp, p.label(), selected);
        if resp.clicked() {
            *page = p;
        }
    }
}

pub fn show(state: &mut AppState, ctx: &Context) {
    if state.ws.settings.as_ref().is_some_and(|d| d.page == Page::Languages) {
        ask_servers(state);
    }
    let running: [usize; 4] = LangId::ALL.map(|l| state.ws.langs.running(l));
    let langs_off = state.ws.langs.is_off();
    let has_file = state.settings.file.is_some();
    let Some(dialog) = state.ws.settings.as_mut() else { return };
    let t = &theme::T;
    let mut ok = false;
    let mut cancel = false;
    let mut open_file = false;
    let size = dialog_size(ctx.screen_rect());
    // Anchored at the top like the tree dialogs: the title must not move.
    let area = Modal::default_area(wid("settings-dialog-area")).anchor(egui::Align2::CENTER_TOP, [0.0, DIALOG_TOP]);
    let frame = egui::Frame::new().fill(t.popup_bg).stroke(egui::Stroke::new(1.0_f32, t.popup_border)).corner_radius(t.radius.popup).shadow(t.popup_shadow());
    let modal = Modal::new(wid("settings-dialog")).area(area).frame(frame).show(ctx, |ui| {
        let (rect, _) = ui.allocate_exact_size(size, egui::Sense::hover());
        let nav_w = if size.x < NARROW { NAV_W_NARROW } else { NAV_W };
        let nav_rect = egui::Rect::from_min_size(rect.min, egui::vec2(nav_w, size.y));
        let r = t.radius.popup as u8;
        ui.painter().rect_filled(nav_rect, egui::CornerRadius { nw: r, sw: r, ne: 0, se: 0 }, t.settings_nav_bg);
        ui.painter().vline(nav_rect.right(), nav_rect.y_range(), egui::Stroke::new(1.0_f32, t.popup_border));
        nav(ui, nav_rect, &mut dialog.page);

        let footer = egui::Rect::from_min_max(egui::pos2(nav_rect.right(), rect.bottom() - FOOTER_H), rect.max);
        ui.painter().hline(footer.x_range(), footer.top(), egui::Stroke::new(1.0_f32, t.popup_border));
        // The page: title and subtitle, then the content, which scrolls on its own.
        let page_rect = egui::Rect::from_min_max(egui::pos2(nav_rect.right() + 24.0, rect.top() + 18.0), egui::pos2(rect.right() - 10.0, footer.top()));
        let mut page_ui = ui.new_child(egui::UiBuilder::new().max_rect(page_rect).layout(egui::Layout::top_down(egui::Align::Min)));
        let ui = &mut page_ui;
        ui.spacing_mut().item_spacing.y = 0.0;
        ui.label(RichText::new(dialog.page.title()).font(t.semibold(t.font.title)).color(t.text_bright));
        ui.add_space(3.0);
        ui.label(RichText::new(dialog.page.subtitle()).color(t.text_dim));
        ui.add_space(14.0);
        // The scroll bar floats in the page's right margin.
        let content_w = ui.available_width() - 14.0;
        if dialog.page == Page::Keymap {
            keymap::page(ui, &mut dialog.keymap, content_w);
        } else {
            egui::ScrollArea::vertical().id_salt(("settings-page", dialog.page.title())).auto_shrink([false, false]).min_scrolled_height(0.0).show(ui, |ui| {
                ui.set_width(content_w);
                ui.spacing_mut().item_spacing.y = 0.0;
                match dialog.page {
                    Page::System => pages::system(ui, &mut dialog.global),
                    Page::Editor => pages::editor(ui, dialog),
                    Page::Languages => pages::languages(ui, dialog, running, langs_off),
                    Page::Frameworks => pages::frameworks(ui, dialog),
                    Page::Keymap => {}
                }
            });
        }

        let mut foot = page_ui.new_child(egui::UiBuilder::new().max_rect(footer.shrink2(egui::vec2(16.0, 0.0))).layout(egui::Layout::left_to_right(egui::Align::Center)));
        let ui = &mut foot;
        ui.spacing_mut().button_padding = egui::vec2(14.0, 5.0);
        let (text, enabled) = match page_scope(dialog.page, &dialog.project) {
            Scope::Global => ("Open global settings".to_string(), has_file),
            Scope::Project => (format!("Open {}", crate::lang::config::CONFIG_PATH), dialog.project.is_some()),
        };
        open_file = ui.add_enabled(enabled, egui::Button::new(text)).clicked();
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            let min = egui::vec2(76.0, 28.0);
            cancel = ui.add(egui::Button::new("Cancel").min_size(min)).clicked();
            ok = ui.add(egui::Button::new(RichText::new("OK").color(t.on_accent)).fill(t.accent).stroke(egui::Stroke::NONE).min_size(min)).clicked();
        });
    });
    let page = dialog.page;
    state.settings.last_page = page;
    if open_file {
        let Some(d) = state.ws.settings.take() else { return };
        match page_scope(d.page, &d.project) {
            Scope::Project => {
                if let Some(p) = d.project {
                    state.open_location(&p.root.join(crate::lang::config::CONFIG_PATH), None, true);
                }
            }
            Scope::Global => open_global_file(state),
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
    apply_ok(state, dialog);
}

/// Opens the global settings file in an editor tab; a missing file is written first.
fn open_global_file(state: &mut AppState) {
    let Some(path) = state.settings.file.clone() else { return };
    let text = state.settings.global.to_text();
    state.jobs.spawn_quiet(
        move || if path.exists() { Ok(path) } else { write_whole(&path, &text).map(|_| path) },
        |state, res| match res {
            Ok(path) => state.open_location(&path, None, true),
            Err(e) => state.notifications.error("Cannot write the global settings", e),
        },
    );
}

/// OK: the global values go in force at once and into the global file; the project's changes
/// go into `.harwex/ide.toml` on a worker, then apply.
fn apply_ok(state: &mut AppState, dialog: SettingsDialog) {
    let old = state.settings.global.clone();
    let mut global_edits = dialog.global.own_edits(&old);
    let layer_edits: Vec<Edit> = Shared::ALL.iter().flat_map(|s| s.edits(&dialog.global_values, Some(&dialog.global_initial), false)).collect();
    // The layer may have been read again from the file while the dialog was open.
    let mut new = GlobalSettings { layer: old.layer.clone(), ..dialog.global };
    if !layer_edits.is_empty() {
        let text = toml::to_string(&old.layer).unwrap_or_default();
        match project::apply_to(global::FILE_NAME, &text, &layer_edits).map(|t| t.parse::<toml::Table>()) {
            Ok(Ok(layer)) => new.layer = layer,
            Ok(Err(e)) => state.notifications.error("Cannot change the global settings", e.to_string()),
            Err(e) => state.notifications.error("Cannot change the global settings", e),
        }
        global_edits.extend(layer_edits);
    }
    let project_edits = dialog.project.as_ref().map(ProjectDraft::edits).unwrap_or_default();
    let skip = (!project_edits.is_empty()).then_some(state.ws.id);
    set_global(state, new, skip);
    if let Some(file) = state.settings.file.clone().filter(|_| !global_edits.is_empty()) {
        state.jobs.window().spawn(
            "Saving settings",
            move || project::write_file(&file, global::FILE_NAME, &global_edits),
            |state, res| {
                if let Err(e) = res {
                    state.notifications.error("Cannot change the global settings", e);
                }
            },
        );
    }
    let Some(project) = dialog.project else { return };
    if project_edits.is_empty() {
        return;
    }
    let root = project.root;
    let generation = state.project_generation();
    state.jobs.spawn(
        "Saving settings",
        move || project::write(&root, &project_edits).map(|_| IdeConfig::load(&root)),
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

    fn row() -> UnrealRow {
        UnrealRow { rel: "Sub/Game".into(), name: "Game".into(), engine: String::new(), detected: Err("none".into()) }
    }

    fn draft(global: &str, project: &str) -> (IdeConfig, ProjectDraft) {
        let global: toml::Table = global.parse().unwrap();
        let config = IdeConfig::parse(project).layered(&global);
        let values = LayerValues::of(&config, vec![row()]);
        let scope = Shared::ALL.map(|s| s.scope_in(&config.own));
        (config, ProjectDraft { root: PathBuf::from("/p"), initial: values.clone(), values, initial_scope: scope, scope })
    }

    fn written(edits: &[Edit]) -> IdeConfig {
        let text = project::apply("", edits).unwrap();
        let back = IdeConfig::parse(&text);
        assert!(back.warnings.is_empty(), "{:?}", back.warnings);
        back
    }

    #[test]
    fn only_changed_keys_are_written() {
        let (_, mut d) = draft("", "[rust]\nserver = \"/ra\"\n");
        assert_eq!(d.scope, [Scope::Global, Scope::Project, Scope::Global]);
        assert!(d.edits().is_empty());
        d.values.languages[1] = false;
        d.values.rust_server = "  ".into();
        d.values.unreal_projects[0].engine = "/ue".into();
        let back = written(&d.edits());
        assert_eq!(back.languages, Some(vec![LangId::TypeScript, LangId::Cpp, LangId::CSharp]));
        assert_eq!(back.rust.server, None);
        assert_eq!(back.unreal.for_project("Sub/Game").engine, Some(PathBuf::from("/ue")));
        // A project override keeps "every language" explicit: a missing key means the global list.
        let mut all = d.values.clone();
        all.languages = [true; 4];
        let edits = Shared::Servers.edits(&all, Some(&d.values), true);
        assert_eq!(written(&edits).languages, Some(LangId::ALL.to_vec()));
        // In the global file the default removes the key.
        let edits = Shared::Servers.edits(&all, Some(&d.values), false);
        assert!(edits.len() == 1 && edits[0].path == ["languages"] && edits[0].value.is_none(), "{edits:?}");
    }

    #[test]
    fn scope_resolution() {
        // Global only: the project gets the global values.
        let (config, d) = draft("languages = [\"ts\"]\n[rust]\nserver = \"/g/ra\"\n[format.oxfmt]\non_save = true\n", "");
        assert_eq!(config.languages, Some(vec![LangId::TypeScript]));
        assert_eq!(config.rust.server, Some(PathBuf::from("/g/ra")));
        assert!(config.oxfmt.on_save);
        assert_eq!(d.scope, [Scope::Global; 3]);

        // A project key wins, a table merges key by key, and the other sections stay global.
        let (config, d) = draft("languages = [\"ts\"]\n[rust]\nserver = \"/g/ra\"\ncheck_on_save = true\n", "[rust]\nserver = \"/p/ra\"\n");
        assert_eq!(config.languages, Some(vec![LangId::TypeScript]));
        assert_eq!(config.rust.server, Some(PathBuf::from("/p/ra")));
        assert!(config.rust.check_on_save);
        assert_eq!(d.scope, [Scope::Global, Scope::Project, Scope::Global]);
        assert_eq!(config.own, "[rust]\nserver = \"/p/ra\"\n".parse::<toml::Table>().unwrap());

        // Layering again starts from the project's own keys.
        let back = config.layered(&toml::Table::new());
        assert_eq!(back.languages, None);
        assert!(!back.rust.check_on_save);
        assert_eq!(back.rust.server, Some(PathBuf::from("/p/ra")));

        // Global -> Project writes the whole section, explicitly.
        let (_, mut d) = draft("[format.oxfmt]\non_save = false\n", "");
        d.scope[Shared::Formatting.index()] = Scope::Project;
        let back = written(&d.edits());
        assert!(back.own.get("format").is_some_and(|f| f.get("oxfmt").is_some_and(|o| o.get("on_save").is_some() && o.get("extensions").is_some())), "{:?}", back.own);
        assert_eq!(Shared::Formatting.scope_in(&back.own), Scope::Project);

        // Reset to global removes the section's keys and nothing else.
        let (_, mut d) = draft("", "languages = [\"rust\"]\n[cpp]\nclangd = \"/c\"\nbackground_index = false\n[diagnostics]\nts = false\n");
        d.scope[Shared::Servers.index()] = Scope::Global;
        let text = project::apply("languages = [\"rust\"]\n[cpp]\nclangd = \"/c\"\nbackground_index = false\n[diagnostics]\nts = false\n", &d.edits()).unwrap();
        assert_eq!(text, "[cpp]\nbackground_index = false\n[diagnostics]\nts = false\n");
    }
}
