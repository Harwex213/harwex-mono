//! A cheap text pre-filter: which files may import a file (file renames, safe delete), and which
//! files may use an exported symbol (Find Usages, Rename Symbol).
//!
//! A server answers only for projects it has loaded. In a monorepo the importers of a file can
//! sit in packages nobody opened yet. A file that imports `src/shapes.ts` must spell `shapes`
//! somewhere (or the package name, for a package's entry file), so a substring scan over the
//! code files finds every candidate. The server then decides which candidates really import it.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
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
    let mut exports = Vec::new();
    export_targets(&manifest["exports"], &mut exports);
    let is_entry = entries.iter().any(|e| without_ext(&dir.join(e)) == target_base);
    // `"./common": "./src/Common/index.ts"`; a pattern (`"./*": "./src/*.ts"`) covers its folder.
    let is_export = exports.iter().any(|e| match e.split_once('*') {
        Some((prefix, _)) => target.starts_with(dir.join(prefix)),
        None => without_ext(&dir.join(e)) == target_base,
    });
    (is_entry || is_export).then_some(name)
}

/// The file paths of a `package.json` `exports` field: a string, or an object of subpaths and
/// conditions, nested.
fn export_targets<'a>(exports: &'a Value, out: &mut Vec<&'a str>) {
    match exports {
        Value::String(s) => out.push(s),
        Value::Object(map) => map.values().for_each(|v| export_targets(v, out)),
        Value::Array(items) => items.iter().for_each(|v| export_targets(v, out)),
        _ => {}
    }
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
    scan(&code, threads, &|| {}, &|| cancel.load(Ordering::Relaxed), &|text| needles.iter().any(|n| contains(text, n.as_bytes())))
}

/// Where a symbol is declared and whether other modules can see it ([`crate::TsService::symbol_scope`]).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SymbolScope {
    /// The name as written at the declaration.
    pub name: String,
    /// The declaring files (canonical), as Go to Declaration finds them.
    pub declarations: Vec<PathBuf>,
    /// `false` for a declaration no other module can name: a local, a parameter, a module-level
    /// name that is not exported. Such a symbol needs no pre-filter.
    pub exported: bool,
}

/// How [`symbol_candidates`] scans: the thread count, a hook each scan thread runs first (the
/// app lowers the thread's priority there), and a cancel check polled per file (the result is
/// then partial).
pub struct ScanOptions<'a> {
    pub threads: usize,
    pub prepare_thread: &'a (dyn Fn() + Sync),
    pub cancelled: &'a (dyn Fn() -> bool + Sync),
}

/// Code files among `files` that may use the exported symbol of `scope`: the text contains the
/// name, and one of [`visibility_needles`], so the file can import a module that declares or
/// re-exports it. Empty for a symbol that is not exported.
pub fn symbol_candidates(files: &[PathBuf], scope: &SymbolScope, options: &ScanOptions) -> Vec<PathBuf> {
    if !scope.exported || scope.name.is_empty() || scope.declarations.is_empty() {
        return Vec::new();
    }
    let needles = visibility_needles(files, &scope.declarations);
    if needles.is_empty() {
        return Vec::new();
    }
    let code: Vec<&PathBuf> = files.iter().filter(|f| is_source(f) && !scope.declarations.contains(f) && !in_node_modules(f)).collect();
    let name = scope.name.as_bytes();
    scan(&code, options.threads.max(1), options.prepare_thread, options.cancelled, &|text| {
        contains(text, name) && needles.iter().any(|n| contains(text, n.as_bytes()))
    })
}

/// The words an import of a declaring file or of a file that re-exports it must contain:
/// [`import_needles`] of each declaration, and of each file of the same package that re-exports
/// from it (`export { x } from "./x"`, `export * from "./common"`), transitively. The package
/// name comes in when one of them is the package's entry or an `exports` target.
pub fn visibility_needles(files: &[PathBuf], declarations: &[PathBuf]) -> Vec<String> {
    let mut needles: Vec<String> = Vec::new();
    for f in reexport_chain(files, declarations) {
        for n in import_needles(&f) {
            if !needles.contains(&n) {
                needles.push(n);
            }
        }
    }
    needles
}

/// A re-export chain longer than this is cut; the needles found so far are kept.
const CHAIN_LIMIT: usize = 256;

/// The declarations and the files of their packages that re-export them, transitively.
fn reexport_chain(files: &[PathBuf], declarations: &[PathBuf]) -> Vec<PathBuf> {
    let mut chain: Vec<PathBuf> = declarations.to_vec();
    // Package folder -> (file, re-export specifiers) of its code files, read once.
    let mut packages: HashMap<PathBuf, Vec<(PathBuf, Vec<String>)>> = HashMap::new();
    let mut i = 0;
    while i < chain.len() && chain.len() < CHAIN_LIMIT {
        let file = chain[i].clone();
        i += 1;
        if in_node_modules(&file) {
            continue;
        }
        let Some(pkg) = file.parent().and_then(|d| d.ancestors().find(|a| a.join("package.json").is_file())).map(Path::to_path_buf) else {
            continue;
        };
        let reexports = packages.entry(pkg.clone()).or_insert_with(|| {
            files
                .iter()
                .filter(|f| f.starts_with(&pkg) && is_source(f) && !in_node_modules(f))
                .filter_map(|f| {
                    let text = std::fs::read_to_string(f).ok()?;
                    let specs = reexport_specifiers(&text);
                    (!specs.is_empty()).then(|| (f.clone(), specs))
                })
                .collect()
        });
        for (f, specs) in reexports.iter() {
            if !chain.contains(f) && specs.iter().any(|s| specifier_names(f, s, &file)) {
                chain.push(f.clone());
            }
        }
    }
    chain
}

/// The module specifiers of the re-export statements in `text`: `export { a, b as c } from "x"`,
/// `export * from "x"`, `export * as ns from "x"`, `export type { T } from "x"`. Statements may
/// span lines. Text between `export` and `from` other than names, braces, commas and `*` means
/// some other statement (`export const a = f("from")`).
pub(crate) fn reexport_specifiers(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(i) = rest.find("export") {
        let before_ok = rest[..i].chars().next_back().is_none_or(|c| !is_ident(c));
        let after = &rest[i + "export".len()..];
        rest = after;
        if !before_ok || after.chars().next().is_some_and(is_ident) {
            continue;
        }
        let Some(from) = after.find("from") else { break };
        let between = &after[..from];
        if between.len() > 2000 || !between.chars().all(|c| is_ident(c) || c.is_whitespace() || matches!(c, '{' | '}' | ',' | '*')) {
            continue;
        }
        let spec = after[from + "from".len()..].trim_start();
        let Some(quote) = spec.chars().next().filter(|c| *c == '"' || *c == '\'') else { continue };
        if let Some(end) = spec[1..].find(quote) {
            out.push(spec[1..1 + end].to_string());
        }
    }
    out
}

fn is_ident(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '$'
}

/// Whether specifier `spec`, written in `from`, may name `target`. A relative specifier is
/// compared as a path (`./x` names `x.ts` and `x/index.ts`); any other one (a package
/// self-reference, a `paths` alias) by its last segment.
fn specifier_names(from: &Path, spec: &str, target: &Path) -> bool {
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let stem = strip_source_ext(&name);
    // `x/index.ts` is named by `x`; `x.ts` by `x` too (and by `x.js` under ESM rules).
    let target_base = if stem == "index" { target.parent().map(Path::to_path_buf) } else { Some(target.with_file_name(stem)) };
    let Some(target_base) = target_base else { return false };
    if spec.starts_with("./") || spec.starts_with("../") || spec == "." || spec == ".." {
        let Some(dir) = from.parent() else { return false };
        let joined = lexical_join(dir, spec);
        let joined_name = joined.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let joined_base = joined.with_file_name(strip_source_ext(&joined_name));
        return joined == target_base || joined_base == target_base || (stem == "index" && joined_base == target.with_file_name("index"));
    }
    let last = spec.rsplit('/').next().unwrap_or(spec);
    let wanted = target_base.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    strip_source_ext(last) == wanted
}

/// `dir` joined with a relative specifier, `.` and `..` resolved without touching the disk.
fn lexical_join(dir: &Path, spec: &str) -> PathBuf {
    let mut out = dir.to_path_buf();
    for c in Path::new(spec).components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            Component::Normal(n) => out.push(n),
            _ => {}
        }
    }
    out
}

fn in_node_modules(path: &Path) -> bool {
    path.components().any(|c| c.as_os_str() == "node_modules")
}

/// Files of `code` whose bytes pass `keep`, read on `threads` threads, sorted.
fn scan(code: &[&PathBuf], threads: usize, prepare_thread: &(dyn Fn() + Sync), cancelled: &(dyn Fn() -> bool + Sync), keep: &(dyn Fn(&[u8]) -> bool + Sync)) -> Vec<PathBuf> {
    let chunk = code.len().div_ceil(threads).max(1);
    let out: Mutex<Vec<PathBuf>> = Mutex::default();
    std::thread::scope(|scope| {
        for part in code.chunks(chunk) {
            let out = &out;
            scope.spawn(move || {
                prepare_thread();
                let mut found = Vec::new();
                for f in part {
                    if cancelled() {
                        break;
                    }
                    let Ok(text) = std::fs::read(f) else { continue };
                    if keep(&text) {
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
        let root = dunce::canonicalize(tmp.path()).unwrap();
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

    #[test]
    fn reexport_statements() {
        let text = "import { a } from './a';\nexport { rootOrm } from \"./Services/Orm/RootOrm\";\nexport * from './common';\nexport * as ns from \"./ns\";\nexport type {\n  T,\n  U as V,\n} from './types';\nexport const x = f(\"from\");\nexport function g() { return 'from'; }\nexported from './no';\n";
        assert_eq!(reexport_specifiers(text), ["./Services/Orm/RootOrm", "./common", "./ns", "./types"]);
    }

    #[test]
    fn exports_subpaths_name_the_package() {
        let tmp = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(tmp.path()).unwrap();
        write(&root, "a/package.json", r#"{"name": "@ws/a", "exports": {".": {"types": "./src/index.ts"}, "./common": "./src/common/index.ts", "./util/*": "./src/util/*.ts"}}"#);
        let common = write(&root, "a/src/common/index.ts", "");
        let util = write(&root, "a/src/util/dates.ts", "");
        let other = write(&root, "a/src/other.ts", "");
        assert_eq!(import_needles(&common), ["common", "@ws/a"]);
        assert_eq!(import_needles(&util), ["dates", "@ws/a"]);
        assert_eq!(import_needles(&other), ["other"]);
    }

    #[test]
    fn symbol_candidates_follow_reexports() {
        let tmp = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(tmp.path()).unwrap();
        write(&root, "packages/a/package.json", r#"{"name": "@ws/a", "exports": {".": "./src/index.ts", "./common": "./src/Common/index.ts"}}"#);
        let decl = write(&root, "packages/a/src/Common/Services/RootOrm.ts", "export const rootOrm = {};\n");
        let common = write(&root, "packages/a/src/Common/index.ts", "export { rootOrm } from \"./Services/RootOrm\";\n");
        let entry = write(&root, "packages/a/src/index.ts", "export * from './Common';\n");
        let unrelated = write(&root, "packages/a/src/Other.ts", "export const other = 1;\n");
        let b = write(&root, "packages/b/src/use.ts", "import { rootOrm } from \"@ws/a/common\";\nrootOrm;\n");
        let c = write(&root, "packages/c/src/use.ts", "import { rootOrm } from '@ws/a';\nrootOrm;\n");
        let d = write(&root, "packages/d/src/use.ts", "import { rootOrm } from './local';\nrootOrm;\n");
        let e = write(&root, "packages/e/src/use.ts", "import { other } from '@ws/a';\n");
        let files = vec![decl.clone(), common.clone(), entry.clone(), unrelated, b.clone(), c.clone(), d, e];
        let needles = visibility_needles(&files, std::slice::from_ref(&decl));
        assert_eq!(needles, ["RootOrm", "Common", "@ws/a", "src"]);
        let scope = SymbolScope { name: "rootOrm".into(), declarations: vec![decl.clone()], exported: true };
        let options = ScanOptions { threads: 2, prepare_thread: &|| {}, cancelled: &|| false };
        assert_eq!(symbol_candidates(&files, &scope, &options), [common, b, c], "D names rootOrm but imports nothing of A; E imports A but never names rootOrm");
        let local = SymbolScope { exported: false, ..scope.clone() };
        assert!(symbol_candidates(&files, &local, &options).is_empty());
        let cancelled = ScanOptions { cancelled: &|| true, ..options };
        assert!(symbol_candidates(&files, &scope, &cancelled).is_empty());
    }
}
