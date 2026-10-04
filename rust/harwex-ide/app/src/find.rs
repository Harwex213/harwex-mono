//! Find in Files (Cmd+Shift+F) and Replace in Files (Cmd+Shift+R): a search over non-ignored,
//! non-excluded files on worker threads, in the whole project or one folder. Plain text uses a
//! memchr finder; whole words and regex use `regex`. Replace shows the hits with checkboxes in
//! the Find tool window; Replace All writes the checked ones: open documents through the edit
//! API (one undo step each), closed files on workers.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use egui::{Key, Modal, RichText, ScrollArea, TextEdit};
use ide_editor::{EditKind, Position};

use crate::notifications::Level;
use crate::state::AppState;
use crate::theme;

#[derive(Clone, Debug)]
pub struct FindHit {
    pub path: PathBuf,
    pub line: usize,
    /// Char column of the match start.
    pub column: usize,
    /// Char column just past the match (same line).
    pub end_column: usize,
    pub line_text: String,
    /// The matched text, checked again before a replace writes.
    pub matched: String,
    /// The text that replaces it (Replace in Files; regex groups expanded).
    pub replacement: Option<String>,
    /// Checked in the replace preview.
    pub include: bool,
}

/// What to search for.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Query {
    pub text: String,
    pub case_sensitive: bool,
    pub whole_words: bool,
    pub regex: bool,
    /// `Some` for Replace in Files.
    pub replacement: Option<String>,
}

#[derive(Default)]
pub struct FindInFiles {
    pub dialog_open: bool,
    pub query: String,
    pub case_sensitive: bool,
    pub whole_words: bool,
    pub regex: bool,
    /// Replace in Files: the dialog has a replacement field and the results have checkboxes.
    pub replace_mode: bool,
    pub replacement: String,
    /// Search only this folder; `None` is the whole project.
    pub scope: Option<PathBuf>,
    focus: bool,
    pub results: FileHits,
    pub searched_for: String,
    /// The query and scope the results belong to.
    pub searched: Option<(Query, Option<PathBuf>)>,
    pub searching: bool,
    pub truncated: bool,
    pub took_ms: f64,
    /// A broken regex, shown instead of results.
    pub error: Option<String>,
    pub replacing: bool,
    generation: u64,
    cancel: Option<Arc<AtomicBool>>,
}

const MAX_HITS: usize = 5000;
const MAX_FILE: u64 = 4 * 1024 * 1024;

impl FindInFiles {
    /// State for a newly opened project. The running search is cancelled, and the generation
    /// keeps counting so a late result of the old project cannot match a new request.
    pub fn reset(&mut self) {
        if let Some(c) = self.cancel.take() {
            c.store(true, std::sync::atomic::Ordering::Relaxed);
        }
        let generation = self.generation + 1;
        *self = FindInFiles { generation, ..Default::default() };
    }

    pub fn open_dialog(&mut self, initial: Option<String>) {
        if let Some(q) = initial.filter(|q| !q.is_empty() && !q.contains('\n')) {
            self.query = q;
        }
        self.dialog_open = true;
        self.focus = true;
    }

    /// Opens Find (or Replace) in Files for a folder, or for the project when `scope` is `None`.
    pub fn open_scoped(&mut self, scope: Option<PathBuf>, replace: bool) {
        self.scope = scope;
        self.replace_mode = replace;
        self.open_dialog(None);
    }

    pub fn hit_count(&self) -> usize {
        self.results.iter().map(|(_, h)| h.len()).sum()
    }

    pub fn checked_count(&self) -> usize {
        self.results.iter().flat_map(|(_, h)| h).filter(|h| h.include).count()
    }

    fn current_query(&self) -> Query {
        Query {
            text: self.query.clone(),
            case_sensitive: self.case_sensitive,
            whole_words: self.whole_words,
            regex: self.regex,
            replacement: self.replace_mode.then(|| self.replacement.clone()),
        }
    }
}

enum Engine {
    Literal { finder: memchr::memmem::Finder<'static>, case_sensitive: bool },
    Regex(regex::bytes::Regex),
}

impl Engine {
    fn new(q: &Query) -> Result<Engine, String> {
        if !q.regex && !q.whole_words {
            let needle: Vec<u8> = if q.case_sensitive { q.text.as_bytes().to_vec() } else { q.text.as_bytes().to_ascii_lowercase() };
            return Ok(Engine::Literal { finder: memchr::memmem::Finder::new(&needle).into_owned(), case_sensitive: q.case_sensitive });
        }
        let body = if q.regex { q.text.clone() } else { regex::escape(&q.text) };
        let pattern = if q.whole_words { format!(r"\b(?:{body})\b") } else { body };
        regex::bytes::RegexBuilder::new(&pattern).case_insensitive(!q.case_sensitive).multi_line(true).build().map(Engine::Regex).map_err(|e| e.to_string())
    }

    /// Byte ranges of the matches in `bytes`, with the replacement of each when asked.
    fn matches(&self, bytes: &[u8], replacement: Option<&str>, limit: usize) -> Vec<(usize, usize, Option<String>)> {
        let mut out = Vec::new();
        match self {
            Engine::Literal { finder, case_sensitive } => {
                let lowered;
                let hay = if *case_sensitive {
                    bytes
                } else {
                    lowered = bytes.to_ascii_lowercase();
                    &lowered
                };
                let len = finder.needle().len();
                for at in finder.find_iter(hay) {
                    out.push((at, at + len, replacement.map(str::to_string)));
                    if out.len() >= limit {
                        break;
                    }
                }
            }
            Engine::Regex(re) => {
                for caps in re.captures_iter(bytes) {
                    let Some(m) = caps.get(0) else { continue };
                    // Empty matches and matches across lines do not fit a line list.
                    if m.is_empty() || bytes[m.range()].contains(&b'\n') {
                        continue;
                    }
                    let rep = replacement.map(|r| {
                        let mut dst = Vec::new();
                        caps.expand(r.as_bytes(), &mut dst);
                        String::from_utf8_lossy(&dst).into_owned()
                    });
                    out.push((m.start(), m.end(), rep));
                    if out.len() >= limit {
                        break;
                    }
                }
            }
        }
        out
    }
}

/// Hits grouped by file, sorted by path.
pub type FileHits = Vec<(PathBuf, Vec<FindHit>)>;

/// Searches `root` (a project or a folder in it). `skip` lists excluded folders. Returns the
/// hits and whether the hit limit cut them off.
pub fn search(root: &Path, query: &Query, skip: &[PathBuf], cancel: &AtomicBool) -> Result<(FileHits, bool), String> {
    let engine = Engine::new(query)?;
    let out: Mutex<FileHits> = Mutex::default();
    let total = AtomicUsize::new(0);
    let skip = skip.to_vec();
    let walker = ignore::WalkBuilder::new(root)
        .hidden(false)
        .filter_entry(move |e| e.file_name() != ".git" && !skip.iter().any(|s| e.path() == s))
        .build_parallel();
    walker.run(|| {
        let engine = &engine;
        let out = &out;
        let total = &total;
        Box::new(move |entry| {
            if cancel.load(Ordering::Relaxed) || total.load(Ordering::Relaxed) >= MAX_HITS {
                return ignore::WalkState::Quit;
            }
            let Ok(e) = entry else { return ignore::WalkState::Continue };
            if !e.file_type().is_some_and(|t| t.is_file()) || e.metadata().map_or(true, |m| m.len() > MAX_FILE) {
                return ignore::WalkState::Continue;
            }
            let Ok(bytes) = std::fs::read(e.path()) else { return ignore::WalkState::Continue };
            if memchr::memchr(0, &bytes[..bytes.len().min(8000)]).is_some() {
                return ignore::WalkState::Continue;
            }
            let found = engine.matches(&bytes, query.replacement.as_deref(), 200);
            let mut hits = Vec::new();
            let mut line_starts_cache: (usize, usize) = (0, 0); // (byte offset scanned, line count)
            for (at, end, replacement) in found {
                let line_start = memchr::memrchr(b'\n', &bytes[..at]).map_or(0, |i| i + 1);
                let line_end = memchr::memchr(b'\n', &bytes[at..]).map_or(bytes.len(), |i| at + i);
                // Count lines incrementally: matches arrive in order.
                let (scanned, count) = line_starts_cache;
                let line = count + memchr::memchr_iter(b'\n', &bytes[scanned..line_start]).count();
                line_starts_cache = (line_start, line);
                let text = String::from_utf8_lossy(&bytes[line_start..line_end]);
                let column = String::from_utf8_lossy(&bytes[line_start..at]).chars().count();
                let matched = String::from_utf8_lossy(&bytes[at..end]).into_owned();
                hits.push(FindHit {
                    path: e.path().to_path_buf(),
                    line,
                    column,
                    end_column: column + matched.chars().count(),
                    line_text: text.trim_end_matches('\r').chars().take(300).collect(),
                    matched,
                    replacement,
                    include: true,
                });
            }
            if !hits.is_empty() {
                total.fetch_add(hits.len(), Ordering::Relaxed);
                if let Ok(mut o) = out.lock() {
                    o.push((e.path().to_path_buf(), hits));
                }
            }
            ignore::WalkState::Continue
        })
    });
    let mut v = out.into_inner().unwrap_or_default();
    v.sort_by(|a, b| a.0.cmp(&b.0));
    let truncated = total.load(Ordering::Relaxed) >= MAX_HITS;
    Ok((v, truncated))
}

pub fn start(state: &mut AppState) {
    let Some(project_root) = state.ws.project.as_ref().map(|p| p.root.clone()) else { return };
    let f = &mut state.ws.find;
    if f.query.is_empty() {
        return;
    }
    if let Some(c) = f.cancel.take() {
        c.store(true, Ordering::Relaxed);
    }
    let cancel = Arc::new(AtomicBool::new(false));
    f.cancel = Some(cancel.clone());
    f.generation += 1;
    f.searching = true;
    f.error = None;
    f.searched_for = f.query.clone();
    let query = f.current_query();
    // The project root as a scope is the whole project.
    let scope = f.scope.clone().filter(|s| *s != project_root);
    f.searched = Some((query.clone(), scope.clone()));
    let generation = f.generation;
    let root = scope.unwrap_or(project_root);
    let skip = state.ws.tree.excluded.clone();
    let started = Instant::now();
    state.ws.layout.left = Some(crate::layout::ToolWindow::Find);
    let label = query.text.clone();
    state.jobs.spawn(
        format!("Searching for \"{label}\""),
        move || search(&root, &query, &skip, &cancel),
        move |state, res| {
            if state.ws.find.generation != generation {
                return;
            }
            state.ws.find.searching = false;
            state.ws.find.took_ms = started.elapsed().as_secs_f64() * 1000.0;
            match res {
                Ok((results, truncated)) => {
                    state.ws.find.results = results;
                    state.ws.find.truncated = truncated;
                    state.timings.log(format!("find in files: {} hits in {:.0} ms", state.ws.find.hit_count(), state.ws.find.took_ms));
                }
                Err(e) => {
                    state.ws.find.results.clear();
                    state.ws.find.error = Some(e);
                }
            }
        },
    );
}

/// The Cmd+Shift+F / Cmd+Shift+R dialog.
pub fn show_dialog(state: &mut AppState, ctx: &egui::Context) {
    if !state.ws.find.dialog_open {
        return;
    }
    let root = state.ws.project.as_ref().map(|p| p.root.clone()).unwrap_or_default();
    let enter = ctx.input_mut(|i| i.consume_key(egui::Modifiers::NONE, Key::Enter));
    let mut go = enter;
    let f = &mut state.ws.find;
    let t = &theme::T;
    let modal = Modal::new(crate::workspace::wid("find-in-files")).area(Modal::default_area(crate::workspace::wid("find-in-files-area")).anchor(egui::Align2::CENTER_TOP, [0.0, 90.0])).show(ctx, |ui| {
        ui.set_width(560.0);
        ui.horizontal(|ui| {
            ui.label(RichText::new(if f.replace_mode { "Replace in Files" } else { "Find in Files" }).strong());
            if let Some(dir) = f.scope.clone().filter(|d| *d != root) {
                let rel = dir.strip_prefix(&root).unwrap_or(&dir).display().to_string();
                ui.label(RichText::new(format!("in {}", if rel.is_empty() { "the project".to_string() } else { rel })).color(t.text_dim));
                if ui.small_button("Whole Project").clicked() {
                    f.scope = None;
                }
            }
        });
        let edit = ui.add(TextEdit::singleline(&mut f.query).hint_text("Text to find").desired_width(f32::INFINITY));
        if std::mem::take(&mut f.focus) {
            edit.request_focus();
        }
        if f.replace_mode {
            ui.add(TextEdit::singleline(&mut f.replacement).hint_text("Replace with").desired_width(f32::INFINITY));
        }
        ui.horizontal(|ui| {
            ui.checkbox(&mut f.case_sensitive, "Match case");
            ui.checkbox(&mut f.whole_words, "Words");
            ui.checkbox(&mut f.regex, "Regex");
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.button("Find").clicked() {
                    go = true;
                }
            });
        });
    });
    if go {
        state.ws.find.dialog_open = false;
        start(state);
    } else if modal.should_close() {
        state.ws.find.dialog_open = false;
    }
}

/// Replace All: the checked hits of the replace preview. Each hit is checked against the
/// current text first, so a line edited since the search is left alone.
pub fn replace_all(state: &mut AppState) {
    let mut open_files: Vec<(crate::tabs::TabId, Vec<FindHit>)> = Vec::new();
    let mut closed: Vec<(PathBuf, Vec<FindHit>)> = Vec::new();
    for (path, hits) in &state.ws.find.results {
        let hits: Vec<FindHit> = hits.iter().filter(|h| h.include && h.replacement.is_some()).cloned().collect();
        if hits.is_empty() {
            continue;
        }
        match state.ws.tabs.editor_by_path(path) {
            Some(id) => open_files.push((id, hits)),
            None => closed.push((path.clone(), hits)),
        }
    }
    let mut replaced = 0;
    let mut files = 0;
    for (id, hits) in open_files {
        let Some(e) = state.ws.tabs.editor_mut(id) else { continue };
        let mut edits: Vec<(std::ops::Range<usize>, String)> = Vec::new();
        for h in &hits {
            let line: Vec<char> = e.doc.line(h.line).trim_end_matches(['\n', '\r']).chars().collect();
            let current: String = line.get(h.column..h.end_column).map(|c| c.iter().collect()).unwrap_or_default();
            if current != h.matched {
                continue;
            }
            let s = e.doc.position_to_char(Position::new(h.line, h.column));
            let end = e.doc.position_to_char(Position::new(h.line, h.end_column));
            edits.push((s..end, h.replacement.clone().unwrap_or_default()));
        }
        if edits.is_empty() {
            continue;
        }
        edits.sort_by_key(|(r, _)| std::cmp::Reverse(r.start));
        replaced += edits.len();
        files += 1;
        let sel = e.view.selection();
        e.doc.seal_undo_group();
        e.doc.transact(edits, sel, sel, EditKind::Other);
        e.doc.seal_undo_group();
        state.save_tab(id, false);
    }
    state.ws.find.replacing = true;
    state.jobs.spawn(
        "Replacing in files",
        move || replace_in_closed_files(&closed),
        move |state, (n, f, errors)| {
            state.ws.find.replacing = false;
            for e in errors {
                state.notifications.error("Replace failed", e);
            }
            let (n, f) = (n + replaced, f + files);
            state.notifications.log_only(Level::Info, "Replace in Files", format!("Replaced {n} occurrences in {f} files."));
            let paths: HashSet<PathBuf> = state.ws.find.results.iter().map(|(p, _)| p.clone()).collect();
            state.on_fs_batch(crate::watcher::FsBatch { paths, structure_changed: false, git_changed: true });
            start(state);
        },
    );
}

/// Writes the replacements into closed files on all cores. Returns (replaced, files, errors).
fn replace_in_closed_files(files: &[(PathBuf, Vec<FindHit>)]) -> (usize, usize, Vec<String>) {
    let replaced = AtomicUsize::new(0);
    let changed = AtomicUsize::new(0);
    let errors: Mutex<Vec<String>> = Mutex::default();
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get()).min(8);
    let chunk = files.len().div_ceil(threads).max(1);
    std::thread::scope(|scope| {
        for part in files.chunks(chunk) {
            let (replaced, changed, errors) = (&replaced, &changed, &errors);
            scope.spawn(move || {
                for (path, hits) in part {
                    match replace_in_file(path, hits) {
                        Ok(0) => {}
                        Ok(n) => {
                            replaced.fetch_add(n, Ordering::Relaxed);
                            changed.fetch_add(1, Ordering::Relaxed);
                        }
                        Err(e) => crate::lang::lock(errors).push(e),
                    }
                }
            });
        }
    });
    (replaced.into_inner(), changed.into_inner(), errors.into_inner().unwrap_or_default())
}

/// Replaces the hits in one file. Line breaks (LF or CRLF) are kept as they are.
pub fn replace_in_file(path: &Path, hits: &[FindHit]) -> Result<usize, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut lines: Vec<String> = text.split('\n').map(str::to_string).collect();
    let mut sorted: Vec<&FindHit> = hits.iter().collect();
    sorted.sort_by_key(|h| std::cmp::Reverse((h.line, h.column)));
    let mut n = 0;
    for h in sorted {
        let Some(line) = lines.get_mut(h.line) else { continue };
        let chars: Vec<char> = line.chars().collect();
        let current: String = chars.get(h.column..h.end_column).map(|c| c.iter().collect()).unwrap_or_default();
        if current != h.matched {
            continue;
        }
        let mut out: String = chars[..h.column].iter().collect();
        out.push_str(h.replacement.as_deref().unwrap_or_default());
        out.extend(&chars[h.end_column..]);
        *line = out;
        n += 1;
    }
    if n > 0 {
        std::fs::write(path, lines.join("\n")).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    Ok(n)
}

/// The Find tool window body. Returns a location to open.
pub fn show_results(state: &mut AppState, ui: &mut egui::Ui) -> Option<(PathBuf, Position)> {
    let root = state.ws.project.as_ref().map(|p| p.root.clone()).unwrap_or_default();
    let deterministic = state.deterministic;
    let f = &mut state.ws.find;
    let t = &theme::T;
    let took = if deterministic { String::new() } else { format!(" ({:.0} ms)", f.took_ms) };
    let replace = f.searched.as_ref().is_some_and(|(q, _)| q.replacement.is_some());
    let mut replace_clicked = false;
    ui.horizontal(|ui| {
        if f.searching {
            ui.spinner();
            ui.label(format!("Searching for \"{}\"...", f.searched_for));
        } else if let Some(e) = &f.error {
            ui.label(RichText::new(format!("Invalid pattern: {e}")).color(t.error));
        } else if f.searched_for.is_empty() {
            ui.label(RichText::new("⇧⌘F to search in files, ⇧⌘R to replace").weak());
        } else {
            let scope = f.searched.as_ref().and_then(|(_, s)| s.as_ref()).map(|d| format!(" in {}", d.strip_prefix(&root).unwrap_or(d).display())).unwrap_or_default();
            ui.label(RichText::new(format!(
                "\"{}\": {} matches in {} files{scope}{}{took}",
                f.searched_for,
                f.hit_count(),
                f.results.len(),
                if f.truncated { ", truncated" } else { "" },
            )).strong());
            if replace {
                let n = f.checked_count();
                if ui.add_enabled(n > 0 && !f.replacing, egui::Button::new("Replace All")).clicked() {
                    replace_clicked = true;
                }
            }
        }
    });
    ui.separator();
    let mut open = None;
    ScrollArea::both().auto_shrink([false, false]).id_salt("find-results").show(ui, |ui| {
        for (path, hits) in &mut f.results {
            let rel = path.strip_prefix(&root).unwrap_or(path);
            egui::CollapsingHeader::new(RichText::new(format!("{}  ({})", rel.display(), hits.len())).color(t.text_bright))
                .id_salt(&*path)
                .default_open(true)
                .show(ui, |ui| {
                    for h in hits.iter_mut() {
                        let label = format!("{:>5}  {}", h.line + 1, h.line_text.trim());
                        ui.horizontal(|ui| {
                            if replace {
                                let r = ui.checkbox(&mut h.include, "");
                                crate::util::label_widget(&r, egui::WidgetType::Checkbox, format!("Replace {}:{}", rel.display(), h.line + 1));
                            }
                            // The replacement goes first: a narrow window still shows it.
                            let mut job = egui::text::LayoutJob::default();
                            let font = egui::FontId::monospace(t.font.ui);
                            if let Some(rep) = &h.replacement {
                                job.append(&format!("{} → {rep}  ", h.matched), 0.0, egui::TextFormat { font_id: font.clone(), color: t.git_added, ..Default::default() });
                            }
                            job.append(&label, 0.0, egui::TextFormat { font_id: font, color: t.text, ..Default::default() });
                            if ui.add(egui::Button::new(job).frame(false).wrap_mode(egui::TextWrapMode::Truncate)).clicked() {
                                open = Some((h.path.clone(), Position::new(h.line, h.column)));
                            }
                        });
                    }
                });
        }
    });
    if replace_clicked {
        replace_all(state);
    }
    open
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hits(root: &Path, q: Query) -> Vec<(String, usize, usize, Option<String>)> {
        let (r, _) = search(root, &q, &[], &AtomicBool::new(false)).unwrap();
        r.into_iter().flat_map(|(_, h)| h).map(|h| (h.matched, h.line, h.column, h.replacement)).collect()
    }

    #[test]
    fn words_regex_case_and_replacement() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        std::fs::write(root.join("a.ts"), "let addOne = add(1);\nADD(2);\r\nadd_x\n").unwrap();
        let q = |text: &str| Query { text: text.into(), ..Default::default() };
        assert_eq!(hits(&root, q("add")).len(), 4, "plain, case-insensitive");
        assert_eq!(hits(&root, Query { case_sensitive: true, ..q("add") }).len(), 3);
        let words = hits(&root, Query { whole_words: true, ..q("add") });
        assert_eq!(words.iter().map(|h| (h.1, h.2)).collect::<Vec<_>>(), [(0, 13), (1, 0)]);
        let re = hits(&root, Query { regex: true, case_sensitive: true, replacement: Some("call_$1".into()), ..q(r"add\((\d)\)") });
        assert_eq!(re, [("add(1)".to_string(), 0, 13, Some("call_1".to_string()))]);
        assert!(search(&root, &Query { regex: true, ..q("(") }, &[], &AtomicBool::new(false)).is_err());

        // Replacing keeps CRLF lines and skips a hit whose text moved.
        let path = root.join("a.ts");
        let (r, _) = search(&root, &Query { whole_words: true, replacement: Some("plus".into()), ..q("add") }, &[], &AtomicBool::new(false)).unwrap();
        let mut found = r[0].1.clone();
        found.push(FindHit { matched: "zzz".into(), ..found[0].clone() });
        assert_eq!(replace_in_file(&path, &found).unwrap(), 2);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "let addOne = plus(1);\nplus(2);\r\nadd_x\n");
    }

    #[test]
    fn scope_and_exclusions() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        for rel in ["src/a.ts", "dist/a.js", "src/sub/b.ts"] {
            let p = root.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, "needle\n").unwrap();
        }
        let q = Query { text: "needle".into(), ..Default::default() };
        let no = AtomicBool::new(false);
        assert_eq!(search(&root, &q, &[], &no).unwrap().0.len(), 3);
        assert_eq!(search(&root, &q, &[root.join("dist")], &no).unwrap().0.len(), 2);
        assert_eq!(search(&root.join("src/sub"), &q, &[], &no).unwrap().0.len(), 1);
    }
}
