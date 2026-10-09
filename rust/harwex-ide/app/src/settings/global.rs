//! Global settings: they belong to the IDE, not to a project, and live in eframe storage (the
//! app config) under `STORAGE_KEY`, as TOML text. Per-project settings stay in
//! `.harwex/ide.toml` (architecture rule 10).

/// The eframe storage key of the global settings.
pub const STORAGE_KEY: &str = "global_settings";

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
}

impl Default for FilesSettings {
    fn default() -> Self {
        FilesSettings { trash: true, save_on_idle: true, idle_secs: DEFAULT_IDLE_SECS, save_on_deactivate: true, backup: true, sync_on_activate: true, sync_periodically: false }
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
}

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
        if let Some(v) = table.get("files").and_then(|t| t.get("idle_secs")).and_then(toml::Value::as_integer) {
            f.idle_secs = (v.clamp(MIN_IDLE_SECS as i64, MAX_IDLE_SECS as i64)) as u32;
        }
        let size = table.get("editor").and_then(|t| t.get("font_size")).and_then(|v| v.as_float().or_else(|| v.as_integer().map(|i| i as f64)));
        if let Some(v) = size {
            s.editor.font_size = (v as f32).clamp(MIN_FONT_SIZE, MAX_FONT_SIZE);
        }
        s
    }

    pub fn to_text(&self) -> String {
        let f = &self.files;
        format!(
            "[files]\ntrash = {}\nsave_on_idle = {}\nidle_secs = {}\nsave_on_deactivate = {}\nbackup = {}\nsync_on_activate = {}\nsync_periodically = {}\n\n[editor]\nfont_size = {:.1}\n",
            f.trash, f.save_on_idle, f.idle_secs, f.save_on_deactivate, f.backup, f.sync_on_activate, f.sync_periodically, self.editor.font_size
        )
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
        assert_eq!(s.files.idle_secs, 15);
        s.files.trash = false;
        s.files.idle_secs = 42;
        s.files.sync_periodically = true;
        s.editor.font_size = 15.0;
        assert_eq!(GlobalSettings::parse(&s.to_text()), s);
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
