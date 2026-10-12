//! Discovery of a yarn + TypeScript monorepo: the workspace packages named by the root
//! `package.json`, their source files, and the package graph from their `package.json` deps.
//!
//! Everything here works without node. Calls read the disk and block, so the app runs them on a
//! worker thread.

pub mod fixture;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use serde_json::Value;

/// Directories that never hold source worth showing: installed, built or generated output.
/// Matched without case (`Generated`, `Build`). Hidden directories are skipped as well.
pub const SKIP_DIRS: &[&str] = &["node_modules", "dist", "build", "generated", "__generated__", "target", "coverage"];

/// Extensions of the files that become cards.
pub const SOURCE_EXTS: &[&str] = &["ts", "tsx", "js", "jsx", "mts", "cts"];

/// Longest line kept in a preview, in chars. Minified files have megabyte-long lines.
const MAX_LINE_CHARS: usize = 160;

/// Up to this many files, discovery counts the lines of each one, so cards get their exact
/// height. Above it, reading every file costs tens of seconds, and the height comes from the
/// file size instead.
pub const EXACT_LINES_UP_TO: usize = 20_000;

/// Bytes per line for the size estimate (typical TypeScript).
const BYTES_PER_LINE: u64 = 32;

/// A preview reads at most this much of a file.
const PREVIEW_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone)]
pub struct Options {
    /// Lines of each file a card shows at most.
    pub preview_lines: usize,
    /// Counts files found so far, for a progress line while discovery runs.
    pub progress: Option<Arc<AtomicUsize>>,
}

impl Default for Options {
    fn default() -> Self {
        Options { preview_lines: 36, progress: None }
    }
}

/// The text a card shows. Read lazily, only for cards on screen.
#[derive(Debug, Clone, Default)]
pub struct Preview {
    /// The first lines, tabs expanded, long lines cut.
    pub lines: Arc<[String]>,
    pub total_lines: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum DepKind {
    Prod,
    Dev,
    Peer,
}

/// `from` depends on `to` (indices into `Workspace::packages`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Dep {
    pub from: usize,
    pub to: usize,
    pub kind: DepKind,
}

#[derive(Debug, Clone)]
pub struct SourceFile {
    /// Path relative to the package directory, with `/` separators.
    pub rel_path: String,
    /// Path under the canonical root (real for everything but symlinked files, which the walk
    /// does not follow), the key that tsserver results map back to.
    pub path: PathBuf,
    pub size: u64,
    /// Line count: exact for small repos, estimated from the size above `EXACT_LINES_UP_TO`.
    pub lines: usize,
}

#[derive(Debug, Clone)]
pub struct Package {
    /// `name` from package.json, or the directory when it has none.
    pub name: String,
    pub dir: PathBuf,
    /// Directory relative to the workspace root, with `/` separators.
    pub rel_dir: String,
    pub files: Vec<SourceFile>,
}

#[derive(Debug, Clone)]
pub struct Workspace {
    /// Canonical root.
    pub root: PathBuf,
    /// Sorted by `rel_dir`.
    pub packages: Vec<Package>,
    /// Deduplicated: one edge per package pair, the strongest kind (Prod over Peer over Dev).
    pub deps: Vec<Dep>,
    /// `nodeLinker` from `.yarnrc.yml` (`node-modules`, `pnp`, `pnpm`), when set.
    pub node_linker: Option<String>,
}

impl Workspace {
    pub fn file_count(&self) -> usize {
        self.packages.iter().map(|p| p.files.len()).sum()
    }

    /// Package index by its package.json name.
    pub fn package_by_name(&self, name: &str) -> Option<usize> {
        self.packages.iter().position(|p| p.name == name)
    }
}

#[derive(Debug)]
pub enum Error {
    NotADirectory(PathBuf),
    Io(PathBuf, std::io::Error),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::NotADirectory(p) => write!(f, "not a directory: {}", p.display()),
            Error::Io(p, e) => write!(f, "{}: {e}", p.display()),
        }
    }
}

impl std::error::Error for Error {}

/// Reads the monorepo at `root`. A root without `workspaces` is shown as one package.
pub fn discover(root: &Path, options: &Options) -> Result<Workspace, Error> {
    let root = root.canonicalize().map_err(|e| Error::Io(root.to_path_buf(), e))?;
    if !root.is_dir() {
        return Err(Error::NotADirectory(root));
    }
    let root_manifest = read_json(&root.join("package.json"));
    let patterns = root_manifest.as_ref().map(workspace_patterns).unwrap_or_default();

    let (manifest_dirs, source_files) = walk(&root, options.progress.as_deref());

    let mut packages: Vec<(Package, Value)> = Vec::new();
    if patterns.is_empty() {
        let manifest = root_manifest.clone().unwrap_or(Value::Null);
        packages.push((new_package(&root, "", &manifest), manifest));
    } else {
        let (include, exclude) = build_globs(&patterns);
        for rel in manifest_dirs {
            if rel.is_empty() || !include.is_match(&rel) || exclude.is_match(&rel) {
                continue;
            }
            let dir = root.join(&rel);
            let Some(manifest) = read_json(&dir.join("package.json")) else {
                continue;
            };
            packages.push((new_package(&dir, &rel, &manifest), manifest));
        }
    }
    packages.sort_by(|a, b| a.0.rel_dir.cmp(&b.0.rel_dir));

    assign_files(&root, &mut packages, source_files);

    let names: HashMap<&str, usize> = packages.iter().enumerate().map(|(i, (p, _))| (p.name.as_str(), i)).collect();
    let mut strongest: HashMap<(usize, usize), DepKind> = HashMap::new();
    for (from, (_, manifest)) in packages.iter().enumerate() {
        for (field, kind) in [
            ("dependencies", DepKind::Prod),
            ("optionalDependencies", DepKind::Prod),
            ("peerDependencies", DepKind::Peer),
            ("devDependencies", DepKind::Dev),
        ] {
            let Some(map) = manifest.get(field).and_then(Value::as_object) else {
                continue;
            };
            for dep in map.keys() {
                if let Some(&to) = names.get(dep.as_str()) {
                    if to != from {
                        let e = strongest.entry((from, to)).or_insert(kind);
                        *e = (*e).min(kind);
                    }
                }
            }
        }
    }
    let mut deps: Vec<Dep> = strongest.into_iter().map(|((from, to), kind)| Dep { from, to, kind }).collect();
    deps.sort_by_key(|d| (d.from, d.to));

    Ok(Workspace {
        node_linker: read_node_linker(&root),
        root,
        packages: packages.into_iter().map(|(p, _)| p).collect(),
        deps,
    })
}

/// `workspaces` is either an array of globs or `{ "packages": [...] }`.
pub fn workspace_patterns(manifest: &Value) -> Vec<String> {
    let ws = &manifest["workspaces"];
    let list = ws.as_array().or_else(|| ws["packages"].as_array());
    list.map(|l| l.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default()
}

fn build_globs(patterns: &[String]) -> (GlobSet, GlobSet) {
    let mut include = GlobSetBuilder::new();
    let mut exclude = GlobSetBuilder::new();
    for p in patterns {
        let (target, pat) = match p.strip_prefix('!') {
            Some(rest) => (&mut exclude, rest),
            None => (&mut include, p.as_str()),
        };
        let pat = pat.trim_start_matches("./").trim_end_matches('/');
        // `*` must stop at `/`, as in yarn: `packages/*` does not reach `packages/a/b`.
        if let Ok(g) = GlobBuilder::new(pat).literal_separator(true).build() {
            target.add(g);
        }
    }
    let empty = || GlobSetBuilder::new().build().expect("empty glob set");
    (include.build().unwrap_or_else(|_| empty()), exclude.build().unwrap_or_else(|_| empty()))
}

/// One parallel walk over the tree: directories that have a package.json (relative paths)
/// and source files (absolute, with sizes). Symlinks are not followed, so linked workspace
/// packages in node_modules never count twice. `.gitignore` applies inside a git repository.
fn walk(root: &Path, progress: Option<&AtomicUsize>) -> (Vec<String>, Vec<(PathBuf, u64)>) {
    let shared = Shared::default();
    let mut builder = VisitorBuilder { root, progress, shared: &shared };
    ignore::WalkBuilder::new(root)
        .hidden(true)
        .follow_links(false)
        .filter_entry(|e| !(e.file_type().is_some_and(|t| t.is_dir()) && e.depth() > 0 && is_skipped_dir(&e.file_name().to_string_lossy())))
        .build_parallel()
        .visit(&mut builder);
    (shared.manifests.into_inner().unwrap_or_default(), shared.sources.into_inner().unwrap_or_default())
}

#[derive(Default)]
struct Shared {
    manifests: Mutex<Vec<String>>,
    sources: Mutex<Vec<(PathBuf, u64)>>,
}

struct VisitorBuilder<'s> {
    root: &'s Path,
    progress: Option<&'s AtomicUsize>,
    shared: &'s Shared,
}

impl<'s> ignore::ParallelVisitorBuilder<'s> for VisitorBuilder<'s> {
    fn build(&mut self) -> Box<dyn ignore::ParallelVisitor + 's> {
        Box::new(Visitor { root: self.root, progress: self.progress, shared: self.shared, manifests: Vec::new(), sources: Vec::new() })
    }
}

/// Collects per thread and hands its results over when the walk drops it.
struct Visitor<'s> {
    root: &'s Path,
    progress: Option<&'s AtomicUsize>,
    shared: &'s Shared,
    manifests: Vec<String>,
    sources: Vec<(PathBuf, u64)>,
}

impl ignore::ParallelVisitor for Visitor<'_> {
    fn visit(&mut self, entry: Result<ignore::DirEntry, ignore::Error>) -> ignore::WalkState {
        let Ok(entry) = entry else { return ignore::WalkState::Continue };
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            return ignore::WalkState::Continue;
        }
        let path = entry.path();
        if entry.file_name() == "package.json" {
            if let Some(dir) = path.parent() {
                self.manifests.push(rel_slash(self.root, dir));
            }
        } else if is_source(path) {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            self.sources.push((path.to_path_buf(), size));
            if let Some(p) = self.progress {
                p.fetch_add(1, Ordering::Relaxed);
            }
        }
        ignore::WalkState::Continue
    }
}

impl Drop for Visitor<'_> {
    fn drop(&mut self) {
        lock(&self.shared.manifests).append(&mut self.manifests);
        lock(&self.shared.sources).append(&mut self.sources);
    }
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn is_skipped_dir(name: &str) -> bool {
    SKIP_DIRS.iter().any(|d| d.eq_ignore_ascii_case(name))
}

pub fn is_source(path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    // Declaration files describe code that lives elsewhere; they would double every card.
    if name.ends_with(".d.ts") || name.ends_with(".d.mts") || name.ends_with(".d.cts") {
        return false;
    }
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| SOURCE_EXTS.contains(&e))
}

fn new_package(dir: &Path, rel: &str, manifest: &Value) -> Package {
    let name = manifest["name"].as_str().map(str::to_string).unwrap_or_else(|| if rel.is_empty() { dir_name(dir) } else { rel.to_string() });
    Package { name, dir: dir.to_path_buf(), rel_dir: rel.to_string(), files: Vec::new() }
}

/// Each file goes to the deepest package that contains it: yarn allows nested workspaces, and
/// the inner package owns its files.
fn assign_files(root: &Path, packages: &mut [(Package, Value)], files: Vec<(PathBuf, u64)>) {
    let by_rel: HashMap<String, usize> = packages.iter().enumerate().map(|(i, (p, _))| (p.rel_dir.clone(), i)).collect();
    let exact = files.len() <= EXACT_LINES_UP_TO;
    let lines = if exact { count_lines_parallel(&files) } else { files.iter().map(|(_, size)| estimate_lines(*size)).collect() };
    for ((path, size), lines) in files.into_iter().zip(lines) {
        let rel = rel_slash(root, &path);
        let mut dir = rel.as_str();
        let owner = loop {
            dir = match dir.rfind('/') {
                Some(i) => &dir[..i],
                None if !dir.is_empty() => "",
                None => break None,
            };
            if let Some(&i) = by_rel.get(dir) {
                break Some(i);
            }
            if dir.is_empty() {
                break None;
            }
        };
        let Some(i) = owner else {
            continue;
        };
        let pkg = &mut packages[i].0;
        let rel_path = if pkg.rel_dir.is_empty() { rel.clone() } else { rel[pkg.rel_dir.len() + 1..].to_string() };
        pkg.files.push(SourceFile { rel_path, path, size, lines });
    }
    for (p, _) in packages.iter_mut() {
        p.files.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    }
}

fn estimate_lines(size: u64) -> usize {
    size.div_ceil(BYTES_PER_LINE).max(1) as usize
}

fn count_lines_parallel(files: &[(PathBuf, u64)]) -> Vec<usize> {
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get()).min(16);
    let chunk = files.len().div_ceil(threads).max(1);
    std::thread::scope(|scope| {
        let handles: Vec<_> = files.chunks(chunk).map(|c| scope.spawn(move || c.iter().map(|(p, size)| count_lines(p, *size)).collect::<Vec<_>>())).collect();
        handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    })
}

fn count_lines(path: &Path, size: u64) -> usize {
    let Ok(bytes) = std::fs::read(path) else { return estimate_lines(size) };
    let text = String::from_utf8_lossy(&bytes);
    let mut n = text.lines().count();
    // Trailing blank lines are not shown, so they do not count.
    for l in text.lines().rev() {
        if !l.trim().is_empty() {
            break;
        }
        n -= 1;
    }
    n
}

/// Reads the first `max_lines` lines of a file for its card. Blocks on the disk: call it
/// from a worker.
pub fn read_preview(path: &Path, max_lines: usize) -> Preview {
    use std::io::Read;
    let mut bytes = Vec::new();
    let full = match std::fs::File::open(path) {
        Ok(f) => {
            let len = f.metadata().map(|m| m.len()).unwrap_or(0);
            let _ = f.take(PREVIEW_BYTES as u64).read_to_end(&mut bytes);
            len as usize <= PREVIEW_BYTES
        }
        Err(_) => return Preview::default(),
    };
    let text = String::from_utf8_lossy(&bytes);
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    let mut total = if full { text.lines().count() } else { text.lines().count().max(estimate_lines(std::fs::metadata(path).map(|m| m.len()).unwrap_or(0))) };
    let mut lines: Vec<String> = text.lines().take(max_lines).map(clean_line).collect();
    // Trailing blank lines only make the card taller.
    while lines.last().is_some_and(|l| l.trim().is_empty()) && total == lines.len() {
        lines.pop();
        total -= 1;
    }
    Preview { lines: Arc::from(lines), total_lines: total }
}

/// Entries in the folders that a root's workspace globs start from (`packages` for
/// `packages/**/*`): a cheap size measure that needs no walk.
fn workspace_breadth(root: &Path) -> usize {
    let Some(m) = read_json(&root.join("package.json")) else { return 0 };
    workspace_patterns(&m)
        .iter()
        .filter(|p| !p.starts_with('!'))
        .map(|p| {
            let base: Vec<&str> = p.trim_start_matches("./").split('/').take_while(|c| !c.contains(['*', '?', '[', '{'])).collect();
            std::fs::read_dir(root.join(base.join("/"))).map(|d| d.count()).unwrap_or(0)
        })
        .sum()
}

/// The monorepo root for a folder the user named. Inside a workspace (a package or a folder
/// in it), the nearest ancestor whose package.json has `workspaces`. Above one (a repository
/// root that keeps the JS monorepo in a subfolder), the shallowest workspace root below it,
/// searched without entering skipped or hidden directories. Otherwise the folder itself.
pub fn find_root(start: &Path) -> PathBuf {
    let start = start.canonicalize().unwrap_or_else(|_| start.to_path_buf());
    let has_workspaces = |dir: &Path| read_json(&dir.join("package.json")).is_some_and(|m| !workspace_patterns(&m).is_empty());
    if let Some(up) = start.ancestors().find(|d| has_workspaces(d)) {
        return up.to_path_buf();
    }
    let mut level = vec![start.clone()];
    for _ in 0..4 {
        let mut next = Vec::new();
        for dir in &level {
            let Ok(entries) = std::fs::read_dir(dir) else { continue };
            let mut subdirs: Vec<PathBuf> = entries
                .flatten()
                .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
                .filter(|e| {
                    let n = e.file_name().to_string_lossy().into_owned();
                    !n.starts_with('.') && !is_skipped_dir(&n)
                })
                .map(|e| e.path())
                .collect();
            subdirs.sort();
            next.extend(subdirs);
        }
        // Several workspace roots on one level (a repository with `javascript/` and
        // `artifacts/`): take the one whose package folders hold the most entries.
        let found = next.iter().filter(|d| has_workspaces(d)).max_by_key(|d| (workspace_breadth(d), std::cmp::Reverse((*d).clone())));
        if let Some(found) = found {
            return found.clone();
        }
        // A wide tree (a home folder) is not worth searching further.
        if next.len() > 2000 {
            break;
        }
        level = next;
    }
    start
}

fn clean_line(line: &str) -> String {
    let mut out = String::with_capacity(line.len().min(MAX_LINE_CHARS));
    let mut chars = 0;
    for c in line.trim_end().chars() {
        if chars >= MAX_LINE_CHARS {
            out.push('…');
            break;
        }
        if c == '\t' {
            let n = 4 - chars % 4;
            out.extend(std::iter::repeat_n(' ', n));
            chars += n;
        } else if !c.is_control() {
            out.push(c);
            chars += 1;
        }
    }
    out
}

fn read_node_linker(root: &Path) -> Option<String> {
    let text = std::fs::read_to_string(root.join(".yarnrc.yml")).ok()?;
    text.lines().find_map(|l| {
        let v = l.trim().strip_prefix("nodeLinker:")?;
        Some(v.trim().trim_matches(['"', '\'']).to_string())
    })
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

fn rel_slash(root: &Path, path: &Path) -> String {
    let rel = path.strip_prefix(root).unwrap_or(path);
    rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/")
}

fn dir_name(dir: &Path) -> String {
    dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "root".to_string())
}

#[cfg(test)]
mod tests;
