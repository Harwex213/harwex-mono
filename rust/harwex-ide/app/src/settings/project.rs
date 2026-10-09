//! Writes the project pages' changes into `.harwex/ide.toml`. Only the keys the user changed
//! are written; the rest of the file keeps its text and comments.

use std::path::Path;

use crate::lang::config::CONFIG_PATH;

/// One key change: `path` is the table path plus the key (`["format", "oxfmt", "on_save"]`).
/// `None` removes the key, so the default applies again.
#[derive(Clone, Debug)]
pub struct Edit {
    pub path: Vec<String>,
    pub value: Option<toml_edit::Value>,
}

impl Edit {
    pub fn set(path: &[&str], value: impl Into<toml_edit::Value>) -> Edit {
        Edit { path: path.iter().map(|s| s.to_string()).collect(), value: Some(value.into()) }
    }

    pub fn remove(path: &[&str]) -> Edit {
        Edit { path: path.iter().map(|s| s.to_string()).collect(), value: None }
    }

    /// A path setting: an empty field removes the key.
    pub fn path_or_remove(path: &[&str], text: &str) -> Edit {
        match text.trim() {
            "" => Edit::remove(path),
            t => Edit::set(path, t),
        }
    }

    /// A tri-state setting: `None` (Auto) removes the key.
    pub fn flag_or_remove(path: &[&str], value: Option<bool>) -> Edit {
        match value {
            Some(v) => Edit::set(path, v),
            None => Edit::remove(path),
        }
    }
}

/// Applies `edits` to the TOML text.
pub fn apply(text: &str, edits: &[Edit]) -> Result<String, String> {
    let mut doc: toml_edit::DocumentMut = text.parse().map_err(|e| format!("{CONFIG_PATH} is not valid TOML: {e}"))?;
    for edit in edits {
        let Some((key, tables)) = edit.path.split_last() else { continue };
        let mut table: &mut dyn toml_edit::TableLike = doc.as_table_mut();
        let mut walked = Vec::new();
        let mut missing = false;
        for (i, name) in tables.iter().enumerate() {
            walked.push(name.as_str());
            if edit.value.is_none() && !table.contains_key(name) {
                missing = true;
                break;
            }
            // A table that only holds other tables stays implicit (`[format.oxfmt]` without an
            // empty `[format]` above it).
            let last = i + 1 == tables.len();
            let item = table.entry(name).or_insert_with(|| {
                let mut t = toml_edit::Table::new();
                t.set_implicit(!last);
                toml_edit::Item::Table(t)
            });
            table = item.as_table_like_mut().ok_or_else(|| format!("{CONFIG_PATH}: `{}` must be a table", walked.join(".")))?;
        }
        if missing {
            continue;
        }
        match &edit.value {
            Some(v) => {
                table.insert(key, toml_edit::Item::Value(v.clone()));
            }
            None => {
                table.remove(key);
            }
        }
    }
    Ok(doc.to_string())
}

/// Reads, edits and writes `<root>/.harwex/ide.toml`. Blocking: call it on a worker.
pub fn write(root: &Path, edits: &[Edit]) -> Result<(), String> {
    let path = root.join(CONFIG_PATH);
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(format!("{}: {e}", path.display())),
    };
    let out = apply(&text, edits)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    std::fs::write(&path, out).map_err(|e| format!("{}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edits_keep_the_rest() {
        let text = "# mine\nidle_timeout_secs = 5\nlanguages = [\"ts\"]\n\n[rust]\nserver = \"/old\" # here\n";
        let out = apply(
            text,
            &[
                Edit::set(&["format", "oxfmt", "on_save"], true),
                Edit::remove(&["rust", "server"]),
                Edit::remove(&["cpp", "clangd"]),
                Edit::set(&["unreal", "projects", "Sub/Game", "engine"], "/e"),
                Edit::remove(&["languages"]),
            ],
        )
        .unwrap();
        assert_eq!(out, "# mine\nidle_timeout_secs = 5\n\n[rust]\n\n[format.oxfmt]\non_save = true\n\n[unreal.projects.\"Sub/Game\"]\nengine = \"/e\"\n");
        assert_eq!(apply("", &[Edit::set(&["format", "oxfmt", "on_save"], true)]).unwrap(), "[format.oxfmt]\non_save = true\n");
        assert!(apply("format = 1\n", &[Edit::set(&["format", "oxfmt", "on_save"], true)]).is_err());
        assert!(apply("[x\n", &[]).is_err());
    }
}
