//! A cheap text pre-filter for file renames and safe delete: which files may import a file.
//!
//! A server answers only for projects it has loaded. In a monorepo the importers of a file can
//! sit in packages nobody opened yet. A file that imports `src/shapes.ts` must spell `shapes`
//! somewhere (or the package name, for a package's entry file), so a substring scan over the
//! code files finds every candidate. The server then decides which candidates really import it.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde_json::Value;

use crate::is_source;

/// The words an import of `target` must contain: the file stem (`shapes` for `shapes.ts`),
/// the folder name for an `index` file or a folder, and the package name when `target` is the
/// entry of a `package.json` (`@ws/core` for `packages/core/src/index.ts`).
pub fn import_needles(target: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let is_dir = target.is_dir();
    if is_dir {
        out.push(name);
    } else {
        let stem = strip_source_ext(&name);
        if stem == "index" {
            if let Some(dir) = target.parent().and_then(Path::file_name) {
                out.push(dir.to_string_lossy().into_owned());
            }
        } else {
            out.push(stem.to_string());
        }
    }
    if let Some(pkg) = package_of_entry(target, is_dir) {
        out.push(pkg);
    }
    out.retain(|n| !n.is_empty());
    out.dedup();
    out
}

fn strip_source_ext(name: &str) -> &str {
    for ext in [".d.ts", ".d.mts", ".d.cts"] {
        if let Some(s) = name.strip_suffix(ext) {
            return s;
        }
    }
    match name.rfind('.') {
        Some(i) if i > 0 => &name[..i],
        _ => name,
    }
}

/// The package name when `target` is the entry (`main`, `types`, `module`, or `index`) of the
/// nearest `package.json` above it, or that package's folder.
fn package_of_entry(target: &Path, is_dir: bool) -> Option<String> {
    let start = if is_dir { target } else { target.parent()? };
    let dir = start.ancestors().find(|d| d.join("package.json").is_file())?;
    let manifest: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("package.json")).ok()?).ok()?;
    let name = manifest["name"].as_str()?.to_string();
    if is_dir {
        return (target == dir || dir.starts_with(target)).then_some(name);
    }
    let without_ext = |p: &Path| p.with_file_name(strip_source_ext(&p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()));
    let target_base = without_ext(target);
    let mut entries: Vec<&str> = ["main", "types", "typings", "module"].iter().filter_map(|k| manifest[*k].as_str()).collect();
    entries.push("index");
    entries.iter().any(|e| without_ext(&dir.join(e)) == target_base).then_some(name)
}

/// Code files among `files` whose text contains one of [`import_needles`] of `target`. The
/// scan runs on all cores; `cancel` stops it early (the result is then partial). `target` and
/// files inside it are never candidates.
pub fn import_candidates(files: &[PathBuf], target: &Path, cancel: &AtomicBool) -> Vec<PathBuf> {
    let needles = import_needles(target);
    if needles.is_empty() {
        return Vec::new();
    }
    let code: Vec<&PathBuf> = files.iter().filter(|f| is_source(f) && !f.starts_with(target)).collect();
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get()).clamp(1, 8);
    let chunk = code.len().div_ceil(threads).max(1);
    let out: Mutex<Vec<PathBuf>> = Mutex::default();
    std::thread::scope(|scope| {
        for part in code.chunks(chunk) {
            let (out, needles) = (&out, &needles);
            scope.spawn(move || {
                let mut found = Vec::new();
                for f in part {
                    if cancel.load(Ordering::Relaxed) {
                        break;
                    }
                    let Ok(text) = std::fs::read(f) else { continue };
                    if needles.iter().any(|n| contains(&text, n.as_bytes())) {
                        found.push((*f).clone());
                    }
                }
                crate::server::lock(out).extend(found);
            });
        }
    });
    let mut v = out.into_inner().unwrap_or_else(|e| e.into_inner());
    v.sort();
    v
}

fn contains(hay: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty() && memchr::memmem::find(hay, needle).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, rel: &str, text: &str) -> PathBuf {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, text).unwrap();
        p
    }

    #[test]
    fn needles_and_candidates() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        write(&root, "packages/core/package.json", r#"{"name": "@ws/core", "main": "src/index.ts"}"#);
        let entry = write(&root, "packages/core/src/index.ts", "export * from './shapes';\n");
        let shapes = write(&root, "packages/core/src/shapes.ts", "export const area = 1;\n");
        let a = write(&root, "packages/a/src/use.ts", "import { area } from '../../core/src/shapes';\n");
        let b = write(&root, "packages/b/src/use.ts", "import { x } from '@ws/core';\n");
        let c = write(&root, "packages/c/src/use.ts", "export const nothing = 0;\n");
        let readme = write(&root, "packages/c/README.md", "shapes and @ws/core\n");

        assert_eq!(import_needles(&shapes), ["shapes"]);
        assert_eq!(import_needles(&entry), ["src", "@ws/core"]);
        assert_eq!(import_needles(&root.join("packages/core")), ["core", "@ws/core"]);
        assert_eq!(import_needles(&root.join("x/types.d.ts")), ["types"]);

        let files = vec![entry.clone(), shapes.clone(), a.clone(), b.clone(), c, readme];
        let no = AtomicBool::new(false);
        assert_eq!(import_candidates(&files, &shapes, &no), [a.clone(), entry.clone()]);
        // `src` (the folder of the index file) over-matches; a pre-filter may, the server decides.
        assert_eq!(import_candidates(&files, &entry, &no), [a.clone(), b.clone()], "the package name finds the importer; README is not code");
        let cancelled = AtomicBool::new(true);
        assert!(import_candidates(&files, &shapes, &cancelled).is_empty());
    }
}
