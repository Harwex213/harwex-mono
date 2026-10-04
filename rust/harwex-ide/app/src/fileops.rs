//! File operations behind the Project tree's context menu: create, move, copy with a collision
//! policy, trash, text edits on closed files, the import search fallback for safe delete, and
//! the `[project] excluded` list in `.harwex/ide.toml`.
//!
//! Everything here blocks on the disk; callers run it on a worker. The calls that reach the
//! system (Trash, Finder, the clipboard, the URL opener) go through [`Platform`], so tests swap them out.

use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use crate::lang::{FileEdit, Location, Reference, TextEdit};

/// The calls that leave the app. The UI holds one `Arc<dyn Platform>`; tests pass a
/// [`RecordingPlatform`], so a test run never touches the real Trash, Finder or clipboard.
pub trait Platform: Send + Sync {
    /// Moves a file or folder to the Trash. Blocking: call it on a worker.
    fn trash(&self, path: &Path) -> Result<(), String>;
    /// Shows the file in Finder (`open -R`). Blocking: call it on a worker.
    fn reveal(&self, path: &Path) -> Result<(), String>;
    /// Puts text on the clipboard. Called on the UI thread.
    fn copy_text(&self, ctx: &egui::Context, text: &str);
    /// Opens a URL in the default browser or mail app (`open`). Blocking: call it on a worker.
    fn open_url(&self, url: &str) -> Result<(), String>;
    /// Starts the native folder picker. Called on the UI thread (rfd creates the dialog there);
    /// the caller awaits the answer on a worker. `None` when the user cancels.
    fn pick_folder(&self, start: Option<&Path>) -> FolderPick;
    /// What a recording platform saw, oldest first ("trash /p/a.ts"). Empty for the real one.
    fn calls(&self) -> Vec<String> {
        Vec::new()
    }
}

/// The folder picker's pending answer, awaited on a worker with `util::block_on`.
pub type FolderPick = std::pin::Pin<Box<dyn std::future::Future<Output = Option<PathBuf>> + Send>>;

/// The real system: NSFileManager's Trash, `open -R`, egui's clipboard output.
pub struct SystemPlatform;

impl Platform for SystemPlatform {
    fn trash(&self, path: &Path) -> Result<(), String> {
        system_trash(path)
    }

    fn reveal(&self, path: &Path) -> Result<(), String> {
        let mut cmd = if cfg!(target_os = "macos") {
            let mut c = std::process::Command::new("open");
            c.arg("-R").arg(path);
            c
        } else {
            let mut c = std::process::Command::new("xdg-open");
            c.arg(path.parent().unwrap_or(path));
            c
        };
        let status = cmd.status().map_err(|e| e.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("{cmd:?} failed: {status}"))
        }
    }

    fn copy_text(&self, ctx: &egui::Context, text: &str) {
        ctx.copy_text(text.to_string());
    }

    fn open_url(&self, url: &str) -> Result<(), String> {
        let program = if cfg!(target_os = "macos") { "/usr/bin/open" } else { "xdg-open" };
        let mut cmd = std::process::Command::new(program);
        // The caller passes only http, https, file and mailto URLs, so the argument never
        // starts with `-` and cannot be read as an option.
        cmd.arg(url);
        let status = cmd.status().map_err(|e| e.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("{cmd:?} failed: {status}"))
        }
    }

    fn pick_folder(&self, start: Option<&Path>) -> FolderPick {
        let dialog = rfd::AsyncFileDialog::new().set_title("Open Folder");
        let dialog = match start {
            Some(dir) => dialog.set_directory(dir),
            None => dialog,
        };
        let fut = dialog.pick_folder();
        Box::pin(async move { fut.await.map(|h| h.path().to_path_buf()) })
    }
}

#[cfg(target_os = "macos")]
fn system_trash(path: &Path) -> Result<(), String> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    // SAFETY: NSFileManager's default manager is thread safe for this call, and the URL and
    // the error out-pointer live for the whole call.
    unsafe {
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        NSFileManager::defaultManager().trashItemAtURL_resultingItemURL_error(&url, None).map_err(|e| e.localizedDescription().to_string())
    }
}

#[cfg(not(target_os = "macos"))]
fn system_trash(path: &Path) -> Result<(), String> {
    Err(format!("Moving {} to the Trash is only supported on macOS.", path.display()))
}

/// Records every call. `trash` moves the item into its own folder, so a test can check both
/// that the file left the project and that it was not deleted for good.
pub struct RecordingPlatform {
    trash_dir: PathBuf,
    calls: Mutex<Vec<String>>,
    next: AtomicU64,
    /// What the next folder pick answers (`set_picked_folder`); `None` acts as Cancel.
    picked: Mutex<Option<PathBuf>>,
}

impl RecordingPlatform {
    pub fn new(trash_dir: PathBuf) -> RecordingPlatform {
        RecordingPlatform { trash_dir, calls: Mutex::default(), next: AtomicU64::new(1), picked: Mutex::default() }
    }

    /// The folder the next `pick_folder` returns, as if the user chose it.
    pub fn set_picked_folder(&self, folder: Option<PathBuf>) {
        *crate::lang::lock(&self.picked) = folder;
    }

    fn record(&self, call: String) {
        crate::lang::lock(&self.calls).push(call);
    }
}

impl Platform for RecordingPlatform {
    fn trash(&self, path: &Path) -> Result<(), String> {
        self.record(format!("trash {}", path.display()));
        let n = self.next.fetch_add(1, Ordering::Relaxed);
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let dest = self.trash_dir.join(format!("{}-{n}-{name}", std::process::id()));
        std::fs::create_dir_all(&self.trash_dir).map_err(|e| e.to_string())?;
        move_path(path, &dest)
    }

    fn reveal(&self, path: &Path) -> Result<(), String> {
        self.record(format!("reveal {}", path.display()));
        Ok(())
    }

    fn copy_text(&self, _ctx: &egui::Context, text: &str) {
        self.record(format!("copy {text}"));
    }

    fn open_url(&self, url: &str) -> Result<(), String> {
        self.record(format!("open-url {url}"));
        Ok(())
    }

    fn pick_folder(&self, start: Option<&Path>) -> FolderPick {
        self.record(format!("pick-folder {}", start.map(|p| p.display().to_string()).unwrap_or_default()));
        let picked = crate::lang::lock(&self.picked).take();
        Box::pin(std::future::ready(picked))
    }

    fn calls(&self) -> Vec<String> {
        crate::lang::lock(&self.calls).clone()
    }
}

/// Checks a name typed into New File / New Directory: relative, `/`-separated segments
/// (`a/b/c.ts` creates the folders), no `.` or `..`.
pub fn check_new_name(name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Enter a name.".into());
    }
    if name.starts_with('/') {
        return Err("Use a name relative to the folder.".into());
    }
    if name.trim_end_matches('/').split('/').any(|s| s.is_empty() || s == "." || s == "..") {
        return Err("The name has an empty, \".\" or \"..\" part.".into());
    }
    Ok(())
}

/// Checks a new name for Rename: one path segment.
pub fn check_rename(name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Enter a name.".into());
    }
    if name.contains('/') || name == "." || name == ".." {
        return Err("A name cannot contain \"/\".".into());
    }
    Ok(())
}

/// Creates `dir/rel` (a file, or a folder when `is_dir`) with every missing folder on the way.
/// Returns the deepest new path. An existing target is an error.
pub fn create_entry(dir: &Path, rel: &str, is_dir: bool) -> Result<PathBuf, String> {
    check_new_name(rel)?;
    let target = dir.join(rel.trim().trim_end_matches('/'));
    if target.exists() {
        return Err(format!("{} already exists.", target.display()));
    }
    let made = |e: std::io::Error| format!("{}: {e}", target.display());
    if is_dir || rel.trim().ends_with('/') {
        std::fs::create_dir_all(&target).map_err(made)?;
    } else {
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(made)?;
        }
        std::fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(made)?;
    }
    Ok(target)
}

/// What to do when the paste target already exists.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Collision {
    /// Move the existing item to the Trash first.
    Overwrite,
    /// Paste under a free name: `name copy.ext`, `name copy 2.ext`, ...
    KeepBoth,
}

/// A free name for a second copy of `name` in `dir`, like Finder: `a copy.ts`, `a copy 2.ts`.
pub fn keep_both_path(dir: &Path, name: &str) -> PathBuf {
    keep_both_path_avoiding(dir, name, &std::collections::HashSet::new())
}

/// Like `keep_both_path`, and also skips the names in `taken` (targets planned by the same
/// paste that do not exist yet).
pub fn keep_both_path_avoiding(dir: &Path, name: &str, taken: &std::collections::HashSet<PathBuf>) -> PathBuf {
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    let mut n = 1;
    loop {
        let candidate = if n == 1 { format!("{stem} copy{ext}") } else { format!("{stem} copy {n}{ext}") };
        let p = dir.join(candidate);
        if !p.exists() && p.symlink_metadata().is_err() && !taken.contains(&p) {
            return p;
        }
        n += 1;
    }
}

/// Copies a file or a folder tree. Symlinks are copied as links.
pub fn copy_path(src: &Path, dst: &Path) -> Result<(), String> {
    let err = |p: &Path, e: std::io::Error| format!("{}: {e}", p.display());
    let meta = src.symlink_metadata().map_err(|e| err(src, e))?;
    if meta.file_type().is_symlink() {
        let target = std::fs::read_link(src).map_err(|e| err(src, e))?;
        #[cfg(unix)]
        return std::os::unix::fs::symlink(target, dst).map_err(|e| err(dst, e));
        #[cfg(not(unix))]
        return Err(format!("cannot copy the link {} to {}", src.display(), target.display()));
    }
    if meta.is_dir() {
        std::fs::create_dir(dst).map_err(|e| err(dst, e))?;
        for entry in std::fs::read_dir(src).map_err(|e| err(src, e))? {
            let entry = entry.map_err(|e| err(src, e))?;
            copy_path(&entry.path(), &dst.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        std::fs::copy(src, dst).map(|_| ()).map_err(|e| err(dst, e))
    }
}

/// Moves a file or folder. Across file systems the rename fails, so it copies and removes.
pub fn move_path(src: &Path, dst: &Path) -> Result<(), String> {
    match std::fs::rename(src, dst) {
        Ok(()) => Ok(()),
        Err(e) if e.raw_os_error() == Some(18) => {
            // EXDEV: another volume.
            copy_path(src, dst)?;
            if src.is_dir() { std::fs::remove_dir_all(src) } else { std::fs::remove_file(src) }.map_err(|e| format!("{}: {e}", src.display()))
        }
        Err(e) => Err(format!("{} -> {}: {e}", src.display(), dst.display())),
    }
}

/// Where a moved or copied item lands, or why it cannot: a folder never goes into itself.
pub fn paste_target(src: &Path, dir: &Path) -> Result<PathBuf, String> {
    let name = src.file_name().ok_or_else(|| format!("{} has no name", src.display()))?;
    if dir.starts_with(src) {
        return Err(format!("Cannot paste {} into itself.", src.display()));
    }
    Ok(dir.join(name))
}

/// Pastes `src` into `dir`: a move (`cut`) or a copy. `collision` decides when the target
/// exists. A copy onto itself always keeps both; a move onto itself does nothing. The
/// overwritten item goes to the Trash. Returns the new path.
pub fn paste(platform: &dyn Platform, src: &Path, dir: &Path, cut: bool, collision: Option<Collision>) -> Result<PathBuf, String> {
    let mut dst = paste_target(src, dir)?;
    if dst == src {
        if cut {
            return Ok(dst);
        }
        dst = keep_both_path(dir, &file_name(src));
    } else if dst.symlink_metadata().is_ok() {
        match collision {
            Some(Collision::Overwrite) => platform.trash(&dst)?,
            Some(Collision::KeepBoth) => dst = keep_both_path(dir, &file_name(src)),
            None => return Err(format!("{} already exists.", dst.display())),
        }
    }
    if cut {
        move_path(src, &dst)?;
    } else {
        copy_path(src, &dst)?;
    }
    Ok(dst)
}

pub fn file_name(p: &Path) -> String {
    p.file_name().map_or_else(|| p.display().to_string(), |n| n.to_string_lossy().into_owned())
}

/// `path` after the item at `old` moved to `new`: the same relative place under `new`.
pub fn moved_path(path: &Path, old: &Path, new: &Path) -> Option<PathBuf> {
    let rel = path.strip_prefix(old).ok()?;
    Some(if rel.as_os_str().is_empty() { new.to_path_buf() } else { new.join(rel) })
}

/// `/`-separated path relative to `root` (the path itself when outside).
pub fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/")
}

/// Applies server edits to a file's text. Positions count lines the way servers do (LF, CRLF
/// or a lone CR ends a line) and columns in chars. The edits never overlap; they are applied
/// last first, so earlier positions stay valid.
pub fn apply_edits(text: &str, edits: &[TextEdit]) -> String {
    // Char offset of each line start.
    let mut starts = vec![0usize];
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '\r' if chars.get(i + 1) == Some(&'\n') => {
                starts.push(i + 2);
                i += 1;
            }
            '\r' | '\n' => starts.push(i + 1),
            _ => {}
        }
        i += 1;
    }
    let len = chars.len();
    let offset = |line: usize, col: usize| -> usize {
        match starts.get(line) {
            Some(&s) => {
                let end = starts.get(line + 1).copied().unwrap_or(len);
                (s + col).min(end)
            }
            None => len,
        }
    };
    let mut sorted: Vec<&TextEdit> = edits.iter().collect();
    sorted.sort_by_key(|e| std::cmp::Reverse((e.start_line, e.start_column)));
    let mut out = chars;
    for e in sorted {
        let s = offset(e.start_line, e.start_column);
        let t = offset(e.end_line, e.end_column).max(s);
        out.splice(s..t, e.new_text.chars());
    }
    out.into_iter().collect()
}

/// Reads, edits and writes one closed file.
pub fn apply_edits_on_disk(path: &Path, edits: &[TextEdit]) -> Result<(), String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    std::fs::write(path, apply_edits(&text, edits)).map_err(|e| format!("{}: {e}", path.display()))
}

const TS_EXTENSIONS: [&str; 8] = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];

fn ext_of(p: &Path) -> String {
    p.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase()
}

/// Joins the import edits of several moves done together (Cut + Paste or a drop of several
/// items). Each server answer assumes only its own item moves. One clash needs a fix: a moved
/// file that imports another moved item gets an edit from both moves at the same place. The
/// edit of the imported item's move names the item's new place from the importer's old
/// folder; it is re-based to the importer's new folder. `moves` pairs (old, new) by index with
/// `per_move`.
pub fn merge_move_edits(moves: &[(PathBuf, PathBuf)], per_move: Vec<Vec<FileEdit>>) -> Vec<FileEdit> {
    let mut out: Vec<FileEdit> = Vec::new();
    for (i, files) in per_move.into_iter().enumerate() {
        for f in files {
            let at = match out.iter().position(|o| o.path == f.path) {
                Some(at) => at,
                None => {
                    out.push(FileEdit { path: f.path.clone(), edits: Vec::new() });
                    out.len() - 1
                }
            };
            // The move that carries the edited file itself, if any.
            let own = moves.iter().position(|(old, _)| f.path.starts_with(old));
            for e in f.edits {
                let same = |x: &TextEdit| (x.start_line, x.start_column, x.end_line, x.end_column) == (e.start_line, e.start_column, e.end_line, e.end_column);
                let Some(k) = out[at].edits.iter().position(same) else {
                    out[at].edits.push(e);
                    continue;
                };
                if out[at].edits[k].new_text == e.new_text {
                    continue;
                }
                // The text of the other move: it already names the imported item's new place.
                let theirs = if own == Some(i) { out[at].edits[k].new_text.clone() } else { e.new_text.clone() };
                let rebased = own.and_then(|j| {
                    let (old, new) = &moves[j];
                    let new_file = moved_path(&f.path, old, new)?;
                    rebase_specifier(&theirs, f.path.parent()?, new_file.parent()?)
                });
                out[at].edits[k].new_text = rebased.unwrap_or(theirs);
            }
        }
    }
    out.retain(|f| !f.edits.is_empty());
    out
}

/// A relative import specifier written in `old_dir`, rewritten for a file in `new_dir` so it
/// names the same place. `None` for a specifier that is not relative (a package name).
pub fn rebase_specifier(spec: &str, old_dir: &Path, new_dir: &Path) -> Option<String> {
    if !(spec.starts_with("./") || spec.starts_with("../")) {
        return None;
    }
    let target = normalize(&old_dir.join(spec));
    let new_dir = normalize(new_dir);
    let from: Vec<Component> = new_dir.components().collect();
    let to: Vec<Component> = target.components().collect();
    let common = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    let mut parts: Vec<String> = vec!["..".into(); from.len() - common];
    parts.extend(to[common..].iter().map(|c| c.as_os_str().to_string_lossy().into_owned()));
    let joined = parts.join("/");
    Some(if joined.starts_with("..") { joined } else { format!("./{joined}") })
}

/// `a/./b/../c` -> `a/c`, without touching the disk.
fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out
}

/// The files a relative import specifier may name, in TypeScript's order: the path itself,
/// the path with a source extension, a folder's `index`. An ESM `./x.js` may mean `./x.ts`.
fn import_candidates(base: &Path) -> Vec<PathBuf> {
    let mut out = vec![base.to_path_buf()];
    let s = base.to_string_lossy();
    for ext in TS_EXTENSIONS {
        out.push(PathBuf::from(format!("{s}.{ext}")));
        out.push(base.join(format!("index.{ext}")));
    }
    for (js, ts) in [("js", ["ts", "tsx"]), ("mjs", ["mts", "mts"]), ("cjs", ["cts", "cts"]), ("jsx", ["tsx", "tsx"])] {
        if ext_of(base) == js {
            for t in ts {
                out.push(base.with_extension(t));
            }
        }
    }
    out
}

/// The folder a Rust file's child modules live in: `src/a.rs` -> `src/a`, `src/lib.rs` -> `src`.
fn rust_module_dir(file: &Path) -> Option<PathBuf> {
    let stem = file.file_stem()?.to_string_lossy();
    let parent = file.parent()?;
    Some(if matches!(stem.as_ref(), "mod" | "lib" | "main") { parent.to_path_buf() } else { parent.join(stem.as_ref()) })
}

/// The safe delete fallback when no language server answers: files under `root` whose
/// relative imports (`from`, `import()`, `require()`) resolve to `target` or into it, and Rust
/// `mod` declarations of it. `skip` lists folders to leave out (excluded folders).
pub fn text_import_search(root: &Path, target: &Path, skip: &[PathBuf]) -> Vec<Reference> {
    let import = regex::Regex::new(r#"(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']([^"'\n]+)["']"#).expect("import pattern");
    // `mod name;` of a Rust target: `x.rs`, `x/mod.rs` or the folder `x`.
    let rust_mod = {
        let (name, declared_in) = if target.is_dir() || ext_of(target) != "rs" {
            (file_name(target), target.parent().map(Path::to_path_buf))
        } else if target.file_stem().is_some_and(|s| s == "mod") {
            let dir = target.parent();
            (dir.map(file_name).unwrap_or_default(), dir.and_then(Path::parent).map(Path::to_path_buf))
        } else {
            (target.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(), target.parent().map(Path::to_path_buf))
        };
        let pattern = format!(r"\bmod\s+{}\s*;", regex::escape(&name));
        (regex::Regex::new(&pattern).ok(), declared_in)
    };
    let skip: Vec<PathBuf> = skip.to_vec();
    let walker = ignore::WalkBuilder::new(root)
        .hidden(false)
        .filter_entry(move |e| e.file_name() != ".git" && e.file_name() != "node_modules" && !skip.iter().any(|s| e.path() == s))
        .build();
    let mut out = Vec::new();
    for entry in walker.filter_map(Result::ok) {
        let path = entry.path();
        if !entry.file_type().is_some_and(|t| t.is_file()) || path.starts_with(target) {
            continue;
        }
        let ext = ext_of(path);
        let is_ts = TS_EXTENSIONS.contains(&ext.as_str());
        let is_rs = ext == "rs" && rust_mod.0.is_some() && rust_module_dir(path) == rust_mod.1;
        if !is_ts && !is_rs {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(path) else { continue };
        for (line_no, line) in text.lines().enumerate() {
            let mut hit: Option<usize> = None;
            if is_ts {
                for caps in import.captures_iter(line) {
                    let spec = &caps[1];
                    if !spec.starts_with('.') {
                        continue;
                    }
                    let base = normalize(&path.parent().unwrap_or(root).join(spec));
                    let names_target = base.starts_with(target) || import_candidates(&base).iter().any(|c| c == target);
                    if names_target {
                        hit = caps.get(1).map(|m| m.start());
                        break;
                    }
                }
            } else if let Some(m) = rust_mod.0.as_ref().and_then(|re| re.find(line)) {
                hit = Some(m.start());
            }
            if let Some(byte) = hit {
                let column = line[..byte].chars().count();
                out.push(Reference {
                    location: Location { path: path.to_path_buf(), line: line_no, column },
                    end_line: line_no,
                    end_column: column,
                    line_text: line.to_string(),
                    is_definition: false,
                    is_write: false,
                });
            }
        }
    }
    out.sort_by(|a, b| (&a.location.path, a.location.line).cmp(&(&b.location.path, b.location.line)));
    out
}

/// Adds `rel` to (or removes it from) `[project] excluded` in `<root>/.harwex/ide.toml`. The
/// rest of the file keeps its text and comments. Blocking: call it on a worker.
pub fn set_excluded(root: &Path, rel: &str, excluded: bool) -> Result<(), String> {
    let path = root.join(crate::lang::config::CONFIG_PATH);
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(format!("{}: {e}", path.display())),
    };
    let mut doc: toml_edit::DocumentMut = text.parse().map_err(|e| format!("{} is not valid TOML: {e}", crate::lang::config::CONFIG_PATH))?;
    let rel = rel.trim_end_matches('/').to_string();
    let project = doc.entry("project").or_insert_with(toml_edit::table);
    let Some(project) = project.as_table_like_mut() else {
        return Err(format!("{}: `project` must be a table", crate::lang::config::CONFIG_PATH));
    };
    let list = project.entry("excluded").or_insert(toml_edit::value(toml_edit::Array::new()));
    let Some(list) = list.as_array_mut() else {
        return Err(format!("{}: project.excluded must be a list", crate::lang::config::CONFIG_PATH));
    };
    let present = list.iter().any(|v| v.as_str().map(|s| s.trim_end_matches('/')) == Some(rel.as_str()));
    if excluded && !present {
        list.push(rel.as_str());
    } else if !excluded {
        list.retain(|v| v.as_str().map(|s| s.trim_end_matches('/')) != Some(rel.as_str()));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    std::fs::write(&path, doc.to_string()).map_err(|e| format!("{}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec_edit(line: usize, text: &str) -> TextEdit {
        TextEdit { start_line: line, start_column: 20, end_line: line, end_column: 25, new_text: text.into() }
    }

    #[test]
    fn rebase_specifier_follows_the_importer() {
        let p = Path::new;
        assert_eq!(rebase_specifier("../lib/b", p("/r/src"), p("/r/lib")).as_deref(), Some("./b"));
        assert_eq!(rebase_specifier("./x/b", p("/r/src"), p("/r/src/deep")).as_deref(), Some("../x/b"));
        assert_eq!(rebase_specifier("./deep/x/b", p("/r/src"), p("/r/src/deep")).as_deref(), Some("./x/b"));
        assert_eq!(rebase_specifier("./b", p("/r/src"), p("/r/lib/a")).as_deref(), Some("../../src/b"));
        assert_eq!(rebase_specifier("fake-lib", p("/r/src"), p("/r/lib")), None);
    }

    #[test]
    fn merged_moves_fix_imports_between_moved_files() {
        // src/a.ts imports ./b; both move to lib/. main.ts imports both.
        let moves = vec![(PathBuf::from("/r/src/a.ts"), PathBuf::from("/r/lib/a.ts")), (PathBuf::from("/r/src/b.ts"), PathBuf::from("/r/lib/b.ts"))];
        let a_move = vec![FileEdit { path: "/r/src/a.ts".into(), edits: vec![spec_edit(0, "../src/b")] }, FileEdit { path: "/r/main.ts".into(), edits: vec![spec_edit(0, "./lib/a")] }];
        let b_move = vec![FileEdit { path: "/r/src/a.ts".into(), edits: vec![spec_edit(0, "../lib/b")] }, FileEdit { path: "/r/main.ts".into(), edits: vec![spec_edit(1, "./lib/b")] }];
        let merged = merge_move_edits(&moves, vec![a_move, b_move]);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].path, PathBuf::from("/r/src/a.ts"));
        assert_eq!(merged[0].edits, vec![spec_edit(0, "./b")]);
        assert_eq!(merged[1].edits, vec![spec_edit(0, "./lib/a"), spec_edit(1, "./lib/b")]);
        // The other order gives the same text.
        let a_move = vec![FileEdit { path: "/r/src/a.ts".into(), edits: vec![spec_edit(0, "../src/b")] }];
        let b_move = vec![FileEdit { path: "/r/src/a.ts".into(), edits: vec![spec_edit(0, "../lib/b")] }];
        let merged = merge_move_edits(&[moves[1].clone(), moves[0].clone()], vec![b_move, a_move]);
        assert_eq!(merged[0].edits, vec![spec_edit(0, "./b")]);
    }

    fn tmp() -> (tempfile::TempDir, PathBuf) {
        let t = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(t.path()).unwrap();
        (t, root)
    }

    fn write(root: &Path, rel: &str, text: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    fn edit(sl: usize, sc: usize, el: usize, ec: usize, t: &str) -> TextEdit {
        TextEdit { start_line: sl, start_column: sc, end_line: el, end_column: ec, new_text: t.into() }
    }

    #[test]
    fn create_nested_file_and_folder() {
        let (_t, root) = tmp();
        let f = create_entry(&root, "a/b/c.ts", false).unwrap();
        assert_eq!(f, root.join("a/b/c.ts"));
        assert!(f.is_file());
        assert!(create_entry(&root, "a/b/c.ts", false).unwrap_err().contains("already exists"));
        let d = create_entry(&root, "x/y", true).unwrap();
        assert!(d.is_dir());
        assert!(create_entry(&root, "q/", false).unwrap().is_dir(), "a trailing slash makes a folder");
        assert!(check_new_name("../up.ts").is_err());
        assert!(check_new_name("a//b").is_err());
        assert!(check_new_name("/abs").is_err());
        assert!(check_rename("a/b").is_err());
        assert!(check_rename(" ").is_err());
    }

    #[test]
    fn move_and_copy_with_collision_policies() {
        let (_t, root) = tmp();
        let platform = RecordingPlatform::new(root.join(".trash"));
        write(&root, "src/a.ts", "A");
        write(&root, "dst/a.ts", "old");
        write(&root, "src/dir/inner.ts", "I");

        // Copy onto an existing name: no policy is an error, Keep Both picks a free name.
        let src = root.join("src/a.ts");
        let dst_dir = root.join("dst");
        assert!(paste(&platform, &src, &dst_dir, false, None).unwrap_err().contains("already exists"));
        let kept = paste(&platform, &src, &dst_dir, false, Some(Collision::KeepBoth)).unwrap();
        assert_eq!(kept, root.join("dst/a copy.ts"));
        let kept2 = paste(&platform, &src, &dst_dir, false, Some(Collision::KeepBoth)).unwrap();
        assert_eq!(kept2, root.join("dst/a copy 2.ts"));
        assert_eq!(std::fs::read_to_string(&kept).unwrap(), "A");

        // Overwrite trashes the old file first, then moves.
        let moved = paste(&platform, &src, &dst_dir, true, Some(Collision::Overwrite)).unwrap();
        assert_eq!(std::fs::read_to_string(&moved).unwrap(), "A");
        assert!(!src.exists());
        assert_eq!(platform.calls(), [format!("trash {}", root.join("dst/a.ts").display())]);
        let trashed: Vec<_> = std::fs::read_dir(root.join(".trash")).unwrap().collect();
        assert_eq!(trashed.len(), 1, "the overwritten file sits in the trash, not deleted");

        // A copy onto itself keeps both; a move onto itself does nothing; a folder never goes
        // into itself.
        let again = paste(&platform, &moved, &dst_dir, false, None).unwrap();
        assert_eq!(again, root.join("dst/a copy 3.ts"));
        assert_eq!(paste(&platform, &moved, &dst_dir, true, None).unwrap(), moved);
        let dir = root.join("src/dir");
        assert!(paste(&platform, &dir, &dir, true, None).unwrap_err().contains("into itself"));
        let copied = paste(&platform, &dir, &dst_dir, false, None).unwrap();
        assert_eq!(std::fs::read_to_string(copied.join("inner.ts")).unwrap(), "I");
        assert!(dir.join("inner.ts").exists());
    }

    #[test]
    fn trash_goes_through_the_platform() {
        let (_t, root) = tmp();
        let platform = RecordingPlatform::new(root.join(".trash"));
        write(&root, "gone/x.ts", "x");
        platform.trash(&root.join("gone")).unwrap();
        assert!(!root.join("gone").exists());
        assert_eq!(platform.calls(), [format!("trash {}", root.join("gone").display())]);
        let mut entries = std::fs::read_dir(root.join(".trash")).unwrap();
        let kept = entries.next().unwrap().unwrap().path();
        assert!(kept.join("x.ts").is_file());
    }

    #[test]
    fn edits_apply_last_first_with_any_line_breaks() {
        let text = "import a from \"./a\";\r\nimport b from \"./b\";\nlet 😀 = 1;";
        let out = apply_edits(text, &[edit(0, 15, 0, 18, "./x"), edit(1, 15, 1, 18, "./y"), edit(2, 4, 2, 5, "z")]);
        assert_eq!(out, "import a from \"./x\";\r\nimport b from \"./y\";\nlet z = 1;");
        assert_eq!(apply_edits("a", &[edit(5, 0, 5, 0, "!")]), "a!", "past the end appends");
        assert_eq!(moved_path(Path::new("/p/a/b.ts"), Path::new("/p/a"), Path::new("/p/c")), Some(PathBuf::from("/p/c/b.ts")));
        assert_eq!(moved_path(Path::new("/p/a"), Path::new("/p/a"), Path::new("/p/c")), Some(PathBuf::from("/p/c")));
        assert_eq!(moved_path(Path::new("/p/ab"), Path::new("/p/a"), Path::new("/p/c")), None);
    }

    #[test]
    fn import_search_resolves_relative_specifiers() {
        let (_t, root) = tmp();
        write(&root, "src/util.ts", "export const x = 1;\n");
        write(&root, "src/main.ts", "import { x } from \"./util\";\nimport y from \"../lib/y\";\n");
        write(&root, "src/deep/other.ts", "const u = require('../util.js');\n");
        write(&root, "src/unrelated.ts", "import { x } from \"./utility\";\n");
        write(&root, "src/feature/index.ts", "export {};\n");
        write(&root, "src/uses_feature.ts", "export * from \"./feature\";\n");
        let refs = text_import_search(&root, &root.join("src/util.ts"), &[]);
        let found: Vec<(String, usize, usize)> = refs.iter().map(|r| (relative(&root, &r.location.path), r.location.line, r.location.column)).collect();
        assert_eq!(found, [("src/deep/other.ts".to_string(), 0, 19), ("src/main.ts".to_string(), 0, 19)]);
        let refs = text_import_search(&root, &root.join("src/feature"), &[]);
        assert_eq!(refs.len(), 1);
        assert!(refs[0].line_text.contains("./feature"));
        // An excluded folder is not searched.
        assert!(text_import_search(&root, &root.join("src/util.ts"), &[root.join("src/deep")]).iter().all(|r| !r.location.path.starts_with(root.join("src/deep"))));
    }

    #[test]
    fn import_search_finds_rust_mod_declarations() {
        let (_t, root) = tmp();
        write(&root, "src/lib.rs", "pub mod shapes;\nmod other;\n");
        write(&root, "src/shapes.rs", "pub mod circle;\n");
        write(&root, "src/shapes/circle.rs", "pub struct Circle;\n");
        write(&root, "src/other.rs", "mod shapes_extra;\n");
        let refs = text_import_search(&root, &root.join("src/shapes.rs"), &[]);
        assert_eq!(refs.len(), 1);
        assert_eq!((relative(&root, &refs[0].location.path), refs[0].location.column), ("src/lib.rs".to_string(), 4));
        let refs = text_import_search(&root, &root.join("src/shapes/circle.rs"), &[]);
        assert_eq!(relative(&root, &refs[0].location.path), "src/shapes.rs");
    }

    #[test]
    fn exclusion_config_round_trip() {
        let (_t, root) = tmp();
        write(&root, ".harwex/ide.toml", "# my settings\nlanguages = [\"ts\"]\n");
        set_excluded(&root, "build/out/", true).unwrap();
        set_excluded(&root, "dist", true).unwrap();
        set_excluded(&root, "dist", true).unwrap();
        let text = std::fs::read_to_string(root.join(".harwex/ide.toml")).unwrap();
        assert!(text.starts_with("# my settings\nlanguages = [\"ts\"]\n"), "{text}");
        let config = crate::lang::IdeConfig::load(&root);
        assert!(config.warnings.is_empty(), "{:?}", config.warnings);
        assert_eq!(config.excluded, ["build/out", "dist"]);
        set_excluded(&root, "build/out", false).unwrap();
        assert_eq!(crate::lang::IdeConfig::load(&root).excluded, ["dist"]);
        // No file yet: one is created.
        let (_t2, fresh) = tmp();
        set_excluded(&fresh, "target", true).unwrap();
        assert_eq!(crate::lang::IdeConfig::load(&fresh).excluded, ["target"]);
    }
}
