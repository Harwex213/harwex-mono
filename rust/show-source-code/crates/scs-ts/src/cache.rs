//! Resolved imports per file, kept between runs. An entry is valid while the importing file
//! keeps its size and mtime. A changed entry file of the target package is not noticed; the
//! cache file can simply be deleted.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::Import;

#[derive(Debug, Clone, PartialEq)]
struct Entry {
    stamp: (u64, u128),
    imports: Vec<Import>,
}

#[derive(Debug, Default)]
pub struct ImportCache {
    entries: HashMap<PathBuf, Entry>,
    dirty: bool,
}

/// `(size, mtime in ns)` of a file.
fn stamp(path: &Path) -> Option<(u64, u128)> {
    let m = path.metadata().ok()?;
    let mtime = m.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_nanos();
    Some((m.len(), mtime))
}

impl ImportCache {
    /// Loads the cache file; a missing or broken one gives an empty cache.
    pub fn load(path: &Path) -> ImportCache {
        let Some(v) = std::fs::read(path).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()) else {
            return ImportCache::default();
        };
        let mut entries = HashMap::new();
        for (file, e) in v.as_object().into_iter().flatten() {
            let (Some(size), Some(mtime)) = (e["size"].as_u64(), e["mtime"].as_str().and_then(|s| s.parse().ok())) else {
                continue;
            };
            let imports = e["imports"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|i| Some(Import { specifier: i["s"].as_str()?.to_string(), line: i["l"].as_u64()? as usize, target: i["t"].as_str().map(PathBuf::from) }))
                .collect();
            entries.insert(PathBuf::from(file), Entry { stamp: (size, mtime), imports });
        }
        ImportCache { entries, dirty: false }
    }

    /// The cached imports of `file`, when the file did not change since.
    pub fn get(&self, file: &Path) -> Option<Vec<Import>> {
        let e = self.entries.get(file)?;
        (stamp(file)? == e.stamp).then(|| e.imports.clone())
    }

    pub fn put(&mut self, file: &Path, imports: &[Import]) {
        if let Some(stamp) = stamp(file) {
            self.entries.insert(file.to_path_buf(), Entry { stamp, imports: imports.to_vec() });
            self.dirty = true;
        }
    }

    /// Writes the cache when something changed. Errors are ignored: the cache is only a speedup.
    pub fn save(&mut self, path: &Path) {
        if !self.dirty {
            return;
        }
        let mut map = serde_json::Map::new();
        for (file, e) in &self.entries {
            let imports: Vec<Value> = e.imports.iter().map(|i| json!({"s": i.specifier, "l": i.line, "t": i.target})).collect();
            map.insert(file.to_string_lossy().into_owned(), json!({"size": e.stamp.0, "mtime": e.stamp.1.to_string(), "imports": imports}));
        }
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let tmp = path.with_extension("tmp");
        if std::fs::write(&tmp, Value::Object(map).to_string()).is_ok() && std::fs::rename(&tmp, path).is_ok() {
            self.dirty = false;
        }
    }
}

/// The cache file for a workspace root: one per root, under the system temp dir.
pub fn default_path(root: &Path) -> PathBuf {
    // FNV-1a: stable across runs, unlike the std hasher.
    let mut h: u64 = 0xcbf29ce484222325;
    for b in root.to_string_lossy().bytes() {
        h = (h ^ b as u64).wrapping_mul(0x100000001b3);
    }
    std::env::temp_dir().join("show-code-source").join(format!("imports-{h:016x}.json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_invalidates_on_change() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("a.ts");
        std::fs::write(&file, "import x from \"x\";\n").unwrap();
        let imports = vec![Import { specifier: "x".into(), line: 0, target: Some(tmp.path().join("x.ts")) }];
        let cache_path = tmp.path().join("cache.json");
        let mut c = ImportCache::default();
        c.put(&file, &imports);
        c.save(&cache_path);
        let c = ImportCache::load(&cache_path);
        assert_eq!(c.get(&file), Some(imports));
        std::fs::write(&file, "import x from \"x\";\nimport y from \"y\";\n").unwrap();
        assert_eq!(c.get(&file), None);
    }
}
