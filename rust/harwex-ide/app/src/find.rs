//! Find in Files (Cmd+Shift+F): a literal text search over non-ignored files on worker threads.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use egui::{Id, Key, Modal, RichText, ScrollArea, TextEdit};
use ide_editor::Position;

use crate::state::AppState;
use crate::theme;

#[derive(Clone, Debug)]
pub struct FindHit {
    pub path: PathBuf,
    pub line: usize,
    /// Char column of the match start.
    pub column: usize,
    pub line_text: String,
}

#[derive(Default)]
pub struct FindInFiles {
    pub dialog_open: bool,
    pub query: String,
    pub case_sensitive: bool,
    focus: bool,
    pub results: Vec<(PathBuf, Vec<FindHit>)>,
    pub searched_for: String,
    pub searching: bool,
    pub truncated: bool,
    pub took_ms: f64,
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

    pub fn hit_count(&self) -> usize {
        self.results.iter().map(|(_, h)| h.len()).sum()
    }
}

pub fn search(root: &Path, query: &str, case_sensitive: bool, cancel: &AtomicBool) -> (Vec<(PathBuf, Vec<FindHit>)>, bool) {
    let needle: Vec<u8> = if case_sensitive { query.as_bytes().to_vec() } else { query.as_bytes().to_ascii_lowercase() };
    let finder = memchr::memmem::Finder::new(&needle).into_owned();
    let out: Mutex<Vec<(PathBuf, Vec<FindHit>)>> = Mutex::default();
    let total = AtomicUsize::new(0);
    let walker = ignore::WalkBuilder::new(root)
        .hidden(false)
        .filter_entry(|e| e.file_name() != ".git")
        .build_parallel();
    walker.run(|| {
        let finder = &finder;
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
            let hay = if case_sensitive { None } else { Some(bytes.to_ascii_lowercase()) };
            let hay_ref = hay.as_deref().unwrap_or(&bytes);
            let mut hits = Vec::new();
            let mut line_starts_cache: (usize, usize) = (0, 0); // (byte offset scanned, line count)
            for at in finder.find_iter(hay_ref) {
                let line_start = memchr::memrchr(b'\n', &bytes[..at]).map_or(0, |i| i + 1);
                let line_end = memchr::memchr(b'\n', &bytes[at..]).map_or(bytes.len(), |i| at + i);
                // Count lines incrementally: matches arrive in order.
                let (scanned, count) = line_starts_cache;
                let line = count + memchr::memchr_iter(b'\n', &bytes[scanned..line_start]).count();
                line_starts_cache = (line_start, line);
                let text = String::from_utf8_lossy(&bytes[line_start..line_end]);
                let column = String::from_utf8_lossy(&bytes[line_start..at]).chars().count();
                hits.push(FindHit {
                    path: e.path().to_path_buf(),
                    line,
                    column,
                    line_text: text.trim_end_matches('\r').chars().take(300).collect(),
                });
                if hits.len() >= 200 {
                    break;
                }
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
    (v, truncated)
}

pub fn start(state: &mut AppState) {
    let Some(root) = state.project.as_ref().map(|p| p.root.clone()) else { return };
    let f = &mut state.find;
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
    f.searched_for = f.query.clone();
    let generation = f.generation;
    let query = f.query.clone();
    let case = f.case_sensitive;
    let started = Instant::now();
    state.layout.left = Some(crate::layout::ToolWindow::Find);
    state.jobs.spawn(
        format!("Searching for \"{query}\""),
        move || search(&root, &query, case, &cancel),
        move |state, (results, truncated)| {
            if state.find.generation != generation {
                return;
            }
            state.find.results = results;
            state.find.truncated = truncated;
            state.find.searching = false;
            state.find.took_ms = started.elapsed().as_secs_f64() * 1000.0;
            state.timings.log(format!("find in files: {} hits in {:.0} ms", state.find.hit_count(), state.find.took_ms));
        },
    );
}

/// The Cmd+Shift+F dialog.
pub fn show_dialog(state: &mut AppState, ctx: &egui::Context) {
    if !state.find.dialog_open {
        return;
    }
    let enter = ctx.input_mut(|i| i.consume_key(egui::Modifiers::NONE, Key::Enter));
    let mut go = enter;
    let f = &mut state.find;
    let modal = Modal::new(Id::new("find-in-files")).area(Modal::default_area(Id::new("find-in-files-area")).anchor(egui::Align2::CENTER_TOP, [0.0, 90.0])).show(ctx, |ui| {
        ui.set_width(560.0);
        ui.label(RichText::new("Find in Files").strong());
        let edit = ui.add(TextEdit::singleline(&mut f.query).hint_text("Text to find").desired_width(f32::INFINITY));
        if std::mem::take(&mut f.focus) {
            edit.request_focus();
        }
        ui.horizontal(|ui| {
            ui.checkbox(&mut f.case_sensitive, "Match case");
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.button("Find").clicked() {
                    go = true;
                }
            });
        });
    });
    if go {
        state.find.dialog_open = false;
        start(state);
    } else if modal.should_close() {
        state.find.dialog_open = false;
    }
}

/// The Find tool window body. Returns a location to open.
pub fn show_results(state: &mut AppState, ui: &mut egui::Ui) -> Option<(PathBuf, Position)> {
    let root = state.project.as_ref().map(|p| p.root.clone()).unwrap_or_default();
    let f = &state.find;
    let took = if state.deterministic { String::new() } else { format!(" ({:.0} ms)", f.took_ms) };
    ui.horizontal(|ui| {
        if f.searching {
            ui.spinner();
            ui.label(format!("Searching for \"{}\"...", f.searched_for));
        } else if f.searched_for.is_empty() {
            ui.label(RichText::new("⇧⌘F to search in files").weak());
        } else {
            ui.label(RichText::new(format!(
                "\"{}\": {} matches in {} files{}{took}",
                f.searched_for,
                f.hit_count(),
                f.results.len(),
                if f.truncated { ", truncated" } else { "" },
            )).strong());
        }
    });
    ui.separator();
    let mut open = None;
    ScrollArea::both().auto_shrink([false, false]).id_salt("find-results").show(ui, |ui| {
        for (path, hits) in &f.results {
            let rel = path.strip_prefix(&root).unwrap_or(path);
            egui::CollapsingHeader::new(RichText::new(format!("{}  ({})", rel.display(), hits.len())).color(theme::T.text_bright))
                .id_salt(path)
                .default_open(true)
                .show(ui, |ui| {
                    for h in hits {
                        let label = format!("{:>5}  {}", h.line + 1, h.line_text.trim());
                        if ui.add(egui::Button::new(RichText::new(label).monospace()).frame(false).wrap_mode(egui::TextWrapMode::Truncate)).clicked() {
                            open = Some((h.path.clone(), Position::new(h.line, h.column)));
                        }
                    }
                });
        }
    });
    open
}
