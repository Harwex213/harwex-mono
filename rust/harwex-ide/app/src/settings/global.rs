//! Global settings: they belong to the IDE, not to a project. They live in one TOML file,
//! `settings.toml` in the app data folder (`AppOptions::settings_file`). Without a file (tests
//! that set none) they live in eframe storage under `STORAGE_KEY`, where task 101 kept them;
//! the first run with a file moves them there.
//!
//! `[files]` and `[editor]` are global only. Every other key is a default for the keys of each
//! project's `.harwex/ide.toml` (`layer`): a key the project sets wins (`IdeConfig::layered`).

/// The eframe storage key of the global settings.
pub const STORAGE_KEY: &str = "global_settings";

/// The file name of the global settings, also the name the Settings dialog shows.
pub const FILE_NAME: &str = "settings.toml";

/// The idle time before an idle save, when nothing is stored.
pub const DEFAULT_IDLE_SECS: u32 = 15;
pub const MIN_IDLE_SECS: u32 = 1;
pub const MAX_IDLE_SECS: u32 = 3600;

pub const DEFAULT_FONT_SIZE: f32 = 13.0;
pub const MIN_FONT_SIZE: f32 = 9.0;
pub const MAX_FONT_SIZE: f32 = 28.0;

/// System › Files (IDEA's "Autosave" and "Synchronization" blocks).
#[derive(Clone, Debug, PartialEq)]
pub struct FilesSettings {
    /// Delete in the tree moves items to the macOS Trash. Off: they are deleted for good.
    pub trash: bool,
    /// Save every modified file after `idle_secs` without input.
    pub save_on_idle: bool,
    pub idle_secs: u32,
    /// Save every modified file when the window loses focus or the built-in terminal takes it.
    pub save_on_deactivate: bool,
    /// Copy the previous version of a file into the backup folder before a save.
    pub backup: bool,
    /// Re-read open files when the window gets the focus and when an editor tab is activated.
    pub sync_on_activate: bool,
    /// Re-read open files every `files::PERIODIC_SYNC` while the window has no focus.
    pub sync_periodically: bool,
    /// System › Project view: git-ignored files show in the Project tree, dimmed (IDEA's
    /// default). Off: they are hidden. Search and the file index skip them either way.
    pub show_ignored: bool,
}

impl Default for FilesSettings {
    fn default() -> Self {
        FilesSettings { trash: true, save_on_idle: true, idle_secs: DEFAULT_IDLE_SECS, save_on_deactivate: true, backup: true, sync_on_activate: true, sync_periodically: false, show_ignored: true }
    }
}

/// Editor options that are the same in every project.
#[derive(Clone, Debug, PartialEq)]
pub struct EditorSettings {
    pub font_size: f32,
}

impl Default for EditorSettings {
    fn default() -> Self {
        EditorSettings { font_size: DEFAULT_FONT_SIZE }
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct GlobalSettings {
    pub files: FilesSettings,
    pub editor: EditorSettings,
    /// The `.harwex/ide.toml` keys every project gets unless it sets its own: the file without
    /// `[files]` and `[editor]`.
    pub layer: toml::Table,
}

/// The sections that belong to the global file only.
const OWN_SECTIONS: [&str; 2] = ["files", "editor"];

impl GlobalSettings {
    /// Reads the stored text. Unknown keys and broken values keep their defaults.
    pub fn parse(text: &str) -> GlobalSettings {
        let mut s = GlobalSettings::default();
        let Ok(table) = text.parse::<toml::Table>() else { return s };
        let flag = |section: &str, key: &str, value: &mut bool| {
            if let Some(v) = table.get(section).and_then(|t| t.get(key)).and_then(toml::Value::as_bool) {
                *value = v;
            }
        };
        let f = &mut s.files;
        flag("files", "trash", &mut f.trash);
        flag("files", "save_on_idle", &mut f.save_on_idle);
        flag("files", "save_on_deactivate", &mut f.save_on_deactivate);
        flag("files", "backup", &mut f.backup);
        flag("files", "sync_on_activate", &mut f.sync_on_activate);
        flag("files", "sync_periodically", &mut f.sync_periodically);
        flag("files", "show_ignored", &mut f.show_ignored);
        if let Some(v) = table.get("files").and_then(|t| t.get("idle_secs")).and_then(toml::Value::as_integer) {
            f.idle_secs = (v.clamp(MIN_IDLE_SECS as i64, MAX_IDLE_SECS as i64)) as u32;
        }
        let size = table.get("editor").and_then(|t| t.get("font_size")).and_then(|v| v.as_float().or_else(|| v.as_integer().map(|i| i as f64)));
        if let Some(v) = size {
            s.editor.font_size = (v as f32).clamp(MIN_FONT_SIZE, MAX_FONT_SIZE);
        }
        s.layer = table.into_iter().filter(|(k, _)| !OWN_SECTIONS.contains(&k.as_str())).collect();
        s
    }

    /// The whole file: `[files]`, `[editor]` and the project defaults.
    pub fn to_text(&self) -> String {
        let f = &self.files;
        let mut text = toml::to_string(&self.layer).unwrap_or_default();
        if !text.is_empty() {
            text.push('\n');
        }
        // The layer's top-level values must come before any table, so the own sections go last.
        text.push_str(&format!(
            "[files]\ntrash = {}\nsave_on_idle = {}\nidle_secs = {}\nsave_on_deactivate = {}\nbackup = {}\nsync_on_activate = {}\nsync_periodically = {}\nshow_ignored = {}\n\n[editor]\nfont_size = {:.1}\n",
            f.trash, f.save_on_idle, f.idle_secs, f.save_on_deactivate, f.backup, f.sync_on_activate, f.sync_periodically, f.show_ignored, self.editor.font_size
        ));
        text
    }

    /// The edits that turn `old`'s `[files]` and `[editor]` into `self`'s, only changed keys.
    pub fn own_edits(&self, old: &GlobalSettings) -> Vec<super::project::Edit> {
        use super::project::Edit;
        let (n, o) = (&self.files, &old.files);
        let mut out = Vec::new();
        let flags = [
            ("trash", n.trash, o.trash),
            ("save_on_idle", n.save_on_idle, o.save_on_idle),
            ("save_on_deactivate", n.save_on_deactivate, o.save_on_deactivate),
            ("backup", n.backup, o.backup),
            ("sync_on_activate", n.sync_on_activate, o.sync_on_activate),
            ("sync_periodically", n.sync_periodically, o.sync_periodically),
            ("show_ignored", n.show_ignored, o.show_ignored),
        ];
        for (key, new, old) in flags {
            if new != old {
                out.push(Edit::set(&["files", key], new));
            }
        }
        if n.idle_secs != o.idle_secs {
            out.push(Edit::set(&["files", "idle_secs"], n.idle_secs as i64));
        }
        if self.editor.font_size != old.editor.font_size {
            out.push(Edit::set(&["editor", "font_size"], (self.editor.font_size as f64 * 10.0).round() / 10.0));
        }
        out
    }

    /// Problems in the project defaults, named after the global file.
    pub fn layer_warnings(&self) -> Vec<String> {
        let config = crate::lang::IdeConfig::parse_table(&self.layer);
        config.warnings.into_iter().map(|w| w.replace(crate::lang::config::CONFIG_PATH, FILE_NAME)).collect()
    }

    pub fn load(storage: &dyn eframe::Storage) -> GlobalSettings {
        storage.get_string(STORAGE_KEY).map(|t| GlobalSettings::parse(&t)).unwrap_or_default()
    }

    pub fn save(&self, storage: &mut dyn eframe::Storage) {
        storage.set_string(STORAGE_KEY, self.to_text());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_defaults() {
        let mut s = GlobalSettings::default();
        assert!(s.files.trash && s.files.save_on_idle && s.files.save_on_deactivate && s.files.backup && s.files.sync_on_activate);
        assert!(!s.files.sync_periodically);
        assert!(s.files.show_ignored);
        assert_eq!(s.files.idle_secs, 15);
        s.files.trash = false;
        s.files.idle_secs = 42;
        s.files.sync_periodically = true;
        s.files.show_ignored = false;
        s.editor.font_size = 15.0;
        assert_eq!(GlobalSettings::parse(&s.to_text()), s);
        // Project defaults keep their place before the own sections.
        s.layer = "languages = [\"ts\"]\n[rust]\nserver = \"/ra\"\n".parse().unwrap();
        let text = s.to_text();
        assert!(text.starts_with("languages = [\"ts\"]\n"), "{text}");
        assert_eq!(GlobalSettings::parse(&text), s);
        assert!(s.layer_warnings().is_empty());
        s.layer = "[rust]\nservr = 1\n".parse().unwrap();
        assert_eq!(s.layer_warnings(), ["settings.toml: unknown key rust.servr"]);
    }

    #[test]
    fn own_edits_only_changed_keys() {
        let old = GlobalSettings::default();
        assert!(old.own_edits(&old).is_empty());
        let mut new = old.clone();
        new.files.trash = false;
        new.editor.font_size = 14.5;
        let text = super::super::project::apply("# mine\nlanguages = [\"ts\"]\n", &new.own_edits(&old)).unwrap();
        assert_eq!(text, "# mine\nlanguages = [\"ts\"]\n\n[files]\ntrash = false\n\n[editor]\nfont_size = 14.5\n");
        let back = GlobalSettings::parse(&text);
        assert!(!back.files.trash && back.editor.font_size == 14.5 && back.layer.contains_key("languages"));
    }

    #[test]
    fn broken_values_keep_defaults() {
        assert_eq!(GlobalSettings::parse("not toml ["), GlobalSettings::default());
        let s = GlobalSettings::parse("[files]\ntrash = \"no\"\nidle_secs = 0\n[editor]\nfont_size = 100\n");
        assert!(s.files.trash);
        assert_eq!(s.files.idle_secs, MIN_IDLE_SECS);
        assert_eq!(s.editor.font_size, MAX_FONT_SIZE);
    }
}
