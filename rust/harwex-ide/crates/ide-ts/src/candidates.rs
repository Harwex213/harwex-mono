//! A cheap text pre-filter: which files may import a file (file renames, safe delete), and which
//! files may use an exported symbol (Find Usages, Rename Symbol).
//!
//! A server answers only for projects it has loaded. In a monorepo the importers of a file can
//! sit in packages nobody opened yet. A file that imports `src/shapes.ts` must spell `shapes`
//! somewhere (or the package name, for a package's entry file), so a substring scan over the
//! code files finds every candidate. The server then decides which candidates really import it.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde_json::Value;

use crate::is_source;
use crate::packages::{in_node_modules, PackageGraph};

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
    let mut found = scan(&code, threads, &|| {}, &|| cancel.load(Ordering::Relaxed), &|f: &&PathBuf, text| needles.iter().any(|n| contains(text, n.as_bytes())).then(|| (*f).clone()));
    found.sort();
    found
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

/// How [`symbol_candidates`] scans: the thread count, a hook each scan thread runs first, and a
/// cancel check polled per file (the result is then partial).
pub struct ScanOptions<'a> {
    pub threads: usize,
    pub prepare_thread: &'a (dyn Fn() + Sync),
    pub cancelled: &'a (dyn Fn() -> bool + Sync),
}

/// What [`symbol_candidates`] found and how much it read.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SymbolCandidates {
    /// Sorted, without duplicates.
    pub files: Vec<PathBuf>,
    /// Code files read (a file checked again in a later round counts again).
    pub scanned: usize,
    /// Packages whose files were scanned; `None` when the scan covered every code file (no
    /// package graph, a declaration outside any package, or a symbol that 2/3 of 100 or more
    /// packages see).
    pub packages: Option<usize>,
}

/// A cross-package re-export chain longer than this many rounds is cut.
const ROUND_LIMIT: usize = 8;

/// In a workspace of at least `WIDE_MIN_PACKAGES` packages, a symbol that at least
/// `WIDE_MULTIPLE / WIDE_DIVISOR` (2/3) of them can see is scanned over the whole index.
const WIDE_MIN_PACKAGES: usize = 100;
const WIDE_MULTIPLE: usize = 2;
const WIDE_DIVISOR: usize = 3;

/// Code files among `files` that may use the exported symbol of `scope`: the text contains the
/// name, and one of [`visibility_needles`], so the file can import a module that declares or
/// re-exports it. Empty for a symbol that is not exported.
///
/// With a package graph, only these files are read: the files outside any package, the files
/// of the packages that declare or re-export the symbol, and of their direct dependents. A
/// dependent that re-exports the symbol by package name (`export { x } from "@ws/a"`,
/// `export * from "@ws/a"`) joins the chain, and the next round scans its dependents too. A
/// declaration outside any package (or in `node_modules`) falls back to scanning every file, and
/// so does a symbol that at least 2/3 of 100 or more packages see (there the split costs more than it
/// saves, and re-exports by package name are not followed).
pub fn symbol_candidates(files: &[PathBuf], scope: &SymbolScope, packages: &PackageGraph, options: &ScanOptions) -> SymbolCandidates {
    if !scope.exported || scope.name.is_empty() || scope.declarations.is_empty() {
        return SymbolCandidates::default();
    }
    let mut chain = reexport_chain(files, &scope.declarations);
    let mut needles: Vec<String> = Vec::new();
    add_needles(&mut needles, &chain);
    if needles.is_empty() {
        return SymbolCandidates::default();
    }
    let code: Vec<&PathBuf> = files.iter().filter(|f| is_source(f) && !scope.declarations.contains(f) && !in_node_modules(f)).collect();
    let name = scope.name.as_bytes();
    let threads = options.threads.max(1);
    let chain_packages: Option<HashSet<usize>> = if packages.is_empty() { None } else { chain.iter().map(|f| packages.package_of(f)).collect() };
    // When most packages see the symbol anyway, splitting the files by package costs more than
    // the few files it saves: read everything, as without a graph.
    let wide = packages.len() >= WIDE_MIN_PACKAGES && chain_packages.as_ref().is_some_and(|c| {
        let seeing: HashSet<usize> = c.iter().flat_map(|&p| std::iter::once(p).chain(packages.dependents(p).iter().copied())).collect();
        seeing.len() * WIDE_DIVISOR >= packages.len() * WIDE_MULTIPLE
    });
    let Some(mut chain_packages) = chain_packages.filter(|_| !wide) else {
        let mut found = scan(&code, threads, options.prepare_thread, options.cancelled, &|f: &&PathBuf, text| {
            (contains(text, name) && needles.iter().any(|n| contains(text, n.as_bytes()))).then(|| (*f).clone())
        });
        found.sort();
        return SymbolCandidates { files: found, scanned: code.len(), packages: None };
    };

    // The memo is keyed by the folders' bytes: hashing a `Path` walks its components, which
    // cost a second over the 220k code files of a big monorepo.
    let mut by_package: HashMap<Option<usize>, Vec<&PathBuf>> = HashMap::new();
    let mut memo: HashMap<&std::ffi::OsStr, Option<usize>> = HashMap::new();
    for f in &code {
        let Some(dir) = f.parent() else { continue };
        by_package.entry(packages.package_of_dir(dir, &mut memo)).or_default().push(f);
    }
    let mut scanned_packages: HashSet<usize> = HashSet::new();
    let mut targets: Vec<(&PathBuf, Option<usize>)> = by_package.get(&None).into_iter().flatten().map(|f| (*f, None)).collect();
    let mut visible: Vec<usize> = chain_packages.iter().copied().collect();
    let mut found: BTreeSet<PathBuf> = BTreeSet::new();
    // Files that name the symbol but none of the needles yet: a later round's needles may match.
    let mut name_only: BTreeMap<PathBuf, Option<usize>> = BTreeMap::new();
    let mut recheck: Vec<(PathBuf, Option<usize>)> = Vec::new();
    let mut scanned = 0;
    for round in 0..ROUND_LIMIT {
        let mut opened: Vec<usize> = Vec::new();
        for p in visible.drain(..) {
            opened.push(p);
            opened.extend_from_slice(packages.dependents(p));
        }
        for p in opened {
            if scanned_packages.insert(p) {
                targets.extend(by_package.get(&Some(p)).into_iter().flatten().map(|f| (*f, Some(p))));
            }
        }
        let names: Vec<String> = chain_packages.iter().filter_map(|&p| packages.name(p)).map(str::to_string).collect();
        let mut items: Vec<(&PathBuf, Option<usize>)> = std::mem::take(&mut targets);
        items.extend(recheck.iter().map(|(f, p)| (f, *p)));
        scanned += items.len();
        let in_chain = &chain_packages;
        let symbol = scope.name.as_str();
        let hits = scan(&items, threads, options.prepare_thread, options.cancelled, &|(f, owner): &(&PathBuf, Option<usize>), text| {
            let named = contains(text, name);
            let candidate = named && needles.iter().any(|n| contains(text, n.as_bytes()));
            let reexports = owner.is_some_and(|o| !in_chain.contains(&o)) && reexports_from(text, &names, symbol);
            (named || reexports).then(|| ((*f).clone(), *owner, candidate, reexports))
        });
        recheck.clear();
        let mut joined: Vec<PathBuf> = Vec::new();
        for (f, owner, candidate, reexports) in hits {
            if candidate {
                name_only.remove(&f);
                found.insert(f.clone());
            } else if !found.contains(&f) {
                name_only.insert(f.clone(), owner);
            }
            if reexports && !chain.contains(&f) && !joined.contains(&f) {
                joined.push(f);
            }
        }
        if joined.is_empty() || (options.cancelled)() || round + 1 == ROUND_LIMIT {
            break;
        }
        // The re-exporting files, and the files of their packages that re-export them.
        let mut grown: Vec<PathBuf> = Vec::new();
        for f in reexport_chain(files, &joined) {
            if !chain.contains(&f) {
                chain.push(f.clone());
                grown.push(f);
            }
        }
        add_needles(&mut needles, &grown);
        let mut fresh: Vec<usize> = Vec::new();
        for f in &grown {
            if let Some(p) = packages.package_of(f) {
                if chain_packages.insert(p) {
                    fresh.push(p);
                }
            }
        }
        // Files of packages that see the new links: those scanned before with the old needles
        // and that named the symbol are read again.
        let mut seeing: HashSet<usize> = fresh.iter().copied().collect();
        for &p in &fresh {
            seeing.extend(packages.dependents(p).iter().copied());
        }
        recheck = name_only.iter().filter(|(_, o)| o.is_some_and(|o| seeing.contains(&o) && scanned_packages.contains(&o))).map(|(f, o)| (f.clone(), *o)).collect();
        visible = fresh;
    }
    SymbolCandidates { files: found.into_iter().collect(), scanned, packages: Some(scanned_packages.len()) }
}

fn add_needles(needles: &mut Vec<String>, files: &[PathBuf]) {
    for f in files {
        for n in import_needles(f) {
            if !needles.contains(&n) {
                needles.push(n);
            }
        }
    }
}

/// Whether `text` re-exports `symbol` (by name or `*`) from one of the packages `names`. Only
/// the places where a package name follows a quote are examined: most files that name the
/// package import from it, and parsing every statement of them cost seconds on a big monorepo.
fn reexports_from(text: &[u8], names: &[String], symbol: &str) -> bool {
    for name in names {
        let finder = memchr::memmem::Finder::new(name.as_bytes());
        for at in finder.find_iter(text) {
            if at == 0 || !matches!(text[at - 1], b'"' | b'\'') {
                continue;
            }
            let quote = text[at - 1];
            let rest = &text[at + name.len()..];
            // The specifier is the package or one of its subpaths: `"@ws/a"`, `"@ws/a/common"`.
            if !(rest.first() == Some(&quote) || rest.first() == Some(&b'/')) {
                continue;
            }
            if reexport_before(&text[..at - 1], symbol) {
                return true;
            }
        }
    }
    false
}

/// Whether the statement that ends at `head` (the text up to a specifier's opening quote) is
/// `export <names, braces, commas, *> from`, naming `symbol` or `*`.
fn reexport_before(head: &[u8], symbol: &str) -> bool {
    let head = trim_end(head);
    let Some(head) = head.strip_suffix(b"from") else { return false };
    let window = &head[head.len().saturating_sub(2000)..];
    let Some(export) = memchr::memmem::rfind(window, b"export") else { return false };
    if export > 0 && is_ident(window[export - 1] as char) {
        return false;
    }
    let list = &window[export + "export".len()..];
    if list.first().is_some_and(|c| is_ident(*c as char)) || !list.iter().all(|&c| is_ident(c as char) || c.is_ascii_whitespace() || matches!(c, b'{' | b'}' | b',' | b'*')) {
        return false;
    }
    list.contains(&b'*') || list.split(|&c| !is_ident(c as char)).any(|w| w == symbol.as_bytes())
}

fn trim_end(bytes: &[u8]) -> &[u8] {
    let end = bytes.iter().rposition(|c| !c.is_ascii_whitespace()).map_or(0, |i| i + 1);
    &bytes[..end]
}

/// The words an import of a declaring file or of a file that re-exports it must contain:
/// [`import_needles`] of each declaration, and of each file of the same package that re-exports
/// from it (`export { x } from "./x"`, `export * from "./common"`), transitively. The package
/// name comes in when one of them is the package's entry or an `exports` target.
pub fn visibility_needles(files: &[PathBuf], declarations: &[PathBuf]) -> Vec<String> {
    let mut needles: Vec<String> = Vec::new();
    add_needles(&mut needles, &reexport_chain(files, declarations));
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

/// What `keep` returns for the items of `items` it accepts, each file read once, on `threads`
/// threads. The order is unspecified.
fn scan<I: Sync + AsPath, T: Send>(items: &[I], threads: usize, prepare_thread: &(dyn Fn() + Sync), cancelled: &(dyn Fn() -> bool + Sync), keep: &(dyn Fn(&I, &[u8]) -> Option<T> + Sync)) -> Vec<T> {
    let chunk = items.len().div_ceil(threads.max(1)).max(1);
    let out: Mutex<Vec<T>> = Mutex::default();
    std::thread::scope(|scope| {
        for part in items.chunks(chunk) {
            let out = &out;
            scope.spawn(move || {
                prepare_thread();
                let mut found = Vec::new();
                for item in part {
                    if cancelled() {
                        break;
                    }
                    let Ok(text) = std::fs::read(item.as_path()) else { continue };
                    if let Some(t) = keep(item, &text) {
                        found.push(t);
                    }
                }
                crate::server::lock(out).extend(found);
            });
        }
    });
    out.into_inner().unwrap_or_else(|e| e.into_inner())
}

/// The file a scan item reads.
trait AsPath {
    fn as_path(&self) -> &Path;
}

impl AsPath for &PathBuf {
    fn as_path(&self) -> &Path {
        self
    }
}

impl AsPath for (&PathBuf, Option<usize>) {
    fn as_path(&self) -> &Path {
        self.0
    }
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

    /// 120 packages that all list `@ws/utils`: the split by package would save nothing.
    #[test]
    fn a_symbol_most_packages_see_reads_the_whole_index() {
        let tmp = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(tmp.path()).unwrap();
        let mut files = vec![write(&root, "utils/package.json", r#"{"name": "@ws/utils", "main": "src/index.ts"}"#)];
        let decl = write(&root, "utils/src/index.ts", "export const LIMIT = 1;\n");
        files.push(decl.clone());
        for i in 0..120 {
            files.push(write(&root, &format!("p{i}/package.json"), &format!(r#"{{"name": "@ws/p{i}", "dependencies": {{"@ws/utils": "*"}}}}"#)));
            files.push(write(&root, &format!("p{i}/src/a.ts"), if i == 7 { "import { LIMIT } from '@ws/utils';\n" } else { "export {};\n" }));
        }
        let graph = PackageGraph::from_files(&files);
        let scope = SymbolScope { name: "LIMIT".into(), declarations: vec![decl], exported: true };
        let options = ScanOptions { threads: 2, prepare_thread: &|| {}, cancelled: &|| false };
        let found = symbol_candidates(&files, &scope, &graph, &options);
        assert_eq!(found.packages, None);
        assert_eq!(found.files, [root.join("p7/src/a.ts")]);
    }

    #[test]
    fn reexports_by_package_name() {
        let names = ["@ws/a".to_string()];
        let yes = |t: &str| reexports_from(t.as_bytes(), &names, "rootOrm");
        assert!(yes("export { rootOrm } from \"@ws/a\";"));
        assert!(yes("import x from '@ws/b';\nexport {\n  other,\n  rootOrm as orm,\n} from '@ws/a/common';"));
        assert!(yes("export * from '@ws/a';"));
        assert!(!yes("import { rootOrm } from '@ws/a';\nexport { rootOrm };"), "an import, not a re-export");
        assert!(!yes("export { other } from '@ws/a';"));
        assert!(!yes("export { rootOrm } from '@ws/abc';"), "another package");
        assert!(!yes("export const x = 1; import { rootOrm } from '@ws/a';"));
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
        let none = PackageGraph::default();
        let found = symbol_candidates(&files, &scope, &none, &options);
        assert_eq!(found.files, [common, b, c], "D names rootOrm but imports nothing of A; E imports A but never names rootOrm");
        assert_eq!(found.packages, None, "no graph: every file is read");
        let local = SymbolScope { exported: false, ..scope.clone() };
        assert!(symbol_candidates(&files, &local, &none, &options).files.is_empty());
        let cancelled = ScanOptions { cancelled: &|| true, ..options };
        assert!(symbol_candidates(&files, &scope, &none, &cancelled).files.is_empty());
    }

    /// `@ws/utils` declares `formatDate`; `@ws/app` and `@ws/core` list it. `@ws/core` re-exports
    /// it, and `@ws/leaf` lists only `@ws/core`. `@ws/shop` lists neither but has its own
    /// `formatDate` in a file of the same stem. A root script outside any package imports it by
    /// path.
    #[test]
    fn symbol_candidates_scan_only_packages_that_see_the_symbol() {
        let tmp = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(tmp.path()).unwrap();
        let mut files = vec![
            write(&root, "package.json", r#"{"name": "root", "workspaces": ["packages/*"]}"#),
            write(&root, "packages/utils/package.json", r#"{"name": "@ws/utils", "main": "src/index.ts"}"#),
            write(&root, "packages/app/package.json", r#"{"name": "@ws/app", "dependencies": {"@ws/utils": "workspace:*"}}"#),
            write(&root, "packages/core/package.json", r#"{"name": "@ws/core", "main": "src/index.ts", "dependencies": {"@ws/utils": "workspace:*"}}"#),
            write(&root, "packages/leaf/package.json", r#"{"name": "@ws/leaf", "dependencies": {"@ws/core": "workspace:*"}}"#),
            write(&root, "packages/shop/package.json", r#"{"name": "@ws/shop"}"#),
        ];
        let decl = write(&root, "packages/utils/src/dates.ts", "export const formatDate = 1;\n");
        let entry = write(&root, "packages/utils/src/index.ts", "export * from './dates';\n");
        let app = write(&root, "packages/app/src/use.ts", "import { formatDate } from '@ws/utils';\nformatDate;\n");
        let app_other = write(&root, "packages/app/src/other.ts", "export const formatDate2 = 'dates';\n");
        let core = write(&root, "packages/core/src/index.ts", "export { formatDate } from '@ws/utils';\n");
        let leaf = write(&root, "packages/leaf/src/use.ts", "import { formatDate } from '@ws/core';\nformatDate;\n");
        let shop_decl = write(&root, "packages/shop/src/dates.ts", "export const formatDate = 2;\n");
        let shop = write(&root, "packages/shop/src/use.ts", "import { formatDate } from './dates';\nformatDate;\n");
        let script = write(&root, "scripts/build.ts", "import { formatDate } from '../packages/utils/src/dates';\n");
        files.extend([decl.clone(), entry.clone(), app.clone(), app_other.clone(), core.clone(), leaf.clone(), shop_decl, shop.clone(), script.clone()]);
        files.sort();
        let graph = PackageGraph::from_files(&files);
        let scope = SymbolScope { name: "formatDate".into(), declarations: vec![decl.clone()], exported: true };
        let options = ScanOptions { threads: 2, prepare_thread: &|| {}, cancelled: &|| false };

        let everything = symbol_candidates(&files, &scope, &PackageGraph::default(), &options);
        assert!(everything.files.contains(&shop), "without the graph the same-named symbol of shop passes the text test");
        assert!(!everything.files.contains(&leaf), "and leaf names neither a file of utils nor its package");

        let scoped = symbol_candidates(&files, &scope, &graph, &options);
        assert_eq!(scoped.files, [app_other, app, core, leaf, script.clone()], "shop is not read; leaf comes through core's re-export");
        assert_eq!(scoped.packages, Some(4), "utils, app, core, then leaf");
        assert!(scoped.scanned < everything.scanned, "{} < {}", scoped.scanned, everything.scanned);

        // The declaration outside any package: every file is read.
        let loose = SymbolScope { declarations: vec![script.clone()], ..scope.clone() };
        assert_eq!(symbol_candidates(&files, &loose, &graph, &options).packages, None);
    }
}
