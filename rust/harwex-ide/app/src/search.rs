//! Background file index and Search Everywhere (Shift Shift, Cmd+Shift+O).

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use egui::{text::LayoutJob, FontId, Key, Modal, RichText, ScrollArea, TextEdit, TextFormat};
use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};

use crate::state::AppState;
use crate::theme;

/// Every non-ignored file of the project, as `/`-separated paths relative to the root.
#[derive(Default)]
pub struct FileIndex {
    pub files: Arc<Vec<String>>,
    pub building: bool,
    /// A rebuild was asked for while one was running.
    rebuild_queued: bool,
    pub build_ms: Option<f64>,
}

/// Every non-ignored file under `root`, minus the excluded folders in `skip`.
pub fn build_file_list(root: &Path, skip: &[PathBuf]) -> Vec<String> {
    let out = Mutex::new(Vec::with_capacity(16 * 1024));
    let skip = skip.to_vec();
    let walker = ignore::WalkBuilder::new(root)
        .hidden(false)
        .filter_entry(move |e| e.file_name() != ".git" && !skip.iter().any(|s| e.path() == s))
        .threads(std::thread::available_parallelism().map_or(4, |n| n.get().min(8)))
        .build_parallel();
    walker.run(|| {
        let out = &out;
        Box::new(move |entry| {
            if let Ok(e) = entry {
                if e.file_type().is_some_and(|t| t.is_file()) {
                    if let Ok(rel) = e.path().strip_prefix(root) {
                        let s = rel.to_string_lossy().replace('\\', "/");
                        if let Ok(mut v) = out.lock() {
                            v.push(s);
                        }
                    }
                }
            }
            ignore::WalkState::Continue
        })
    });
    let mut v = out.into_inner().unwrap_or_default();
    v.sort_unstable();
    v
}

pub fn rebuild_index(state: &mut AppState) {
    let Some(root) = state.ws.project.as_ref().map(|p| p.root.clone()) else { return };
    if state.ws.index.building {
        state.ws.index.rebuild_queued = true;
        return;
    }
    state.ws.index.building = true;
    let generation = state.project_generation();
    let started = Instant::now();
    let skip = state.ws.tree.excluded.clone();
    state.jobs.spawn(
        "Indexing files",
        move || {
            let files = build_file_list(&root, &skip);
            (files, started.elapsed())
        },
        move |state, (files, took)| {
            if state.project_generation() != generation {
                return;
            }
            let ms = took.as_secs_f64() * 1000.0;
            if state.ws.index.build_ms.is_none() {
                state.timings.log(format!("file index built in {ms:.1} ms ({} files)", files.len()));
            }
            state.ws.index.build_ms = Some(ms);
            state.ws.index.files = Arc::new(files);
            state.ws.index.building = false;
            if std::mem::take(&mut state.ws.index.rebuild_queued) {
                rebuild_index(state);
            }
            // Results computed against the old list may point at deleted files.
            if state.ws.search.open {
                state.ws.search.last_query = None;
            }
        },
    );
}

#[derive(Default)]
pub struct SearchEverywhere {
    pub open: bool,
    pub query: String,
    last_query: Option<String>,
    results: Vec<SearchHit>,
    selected: usize,
    generation: u64,
    focus: bool,
    /// Shift Shift detection: when Shift was last released after being pressed alone.
    last_shift_tap: Option<Instant>,
    shift_down_clean: bool,
    shift_was_down: bool,
    /// Cmd+E: the popup lists recently opened files instead of the whole index.
    pub recent_mode: bool,
    /// Opened files, most recent first.
    recent: Vec<PathBuf>,
}

/// How many recent files Cmd+E keeps.
const RECENT_LIMIT: usize = 50;

impl SearchEverywhere {
    /// State for a newly opened project; the generation keeps counting (see `FindInFiles::reset`).
    pub fn reset(&mut self) {
        let generation = self.generation + 1;
        *self = SearchEverywhere { generation, ..Default::default() };
    }
}

#[derive(Clone)]
pub struct SearchHit {
    pub path: String,
    /// Char indices into `path` that matched, for highlighting.
    pub indices: Vec<u32>,
}

const MAX_RESULTS: usize = 60;

/// Ranks files by fuzzy score. The file name gets extra weight, like IDEA's "Files" tab.
pub fn match_files(files: &[String], query: &str) -> Vec<SearchHit> {
    let query = query.trim();
    if query.is_empty() {
        return Vec::new();
    }
    let mut matcher = Matcher::new(Config::DEFAULT.match_paths());
    let pattern = Pattern::parse(query, CaseMatching::Smart, Normalization::Smart);
    let mut buf = Vec::new();
    let mut scored: Vec<(u32, usize)> = Vec::new();
    for (i, f) in files.iter().enumerate() {
        let Some(score) = pattern.score(Utf32Str::new(f, &mut buf), &mut matcher) else { continue };
        let name = f.rsplit('/').next().unwrap_or(f);
        // Each word that matches the file name itself earns a bonus, like IDEA's "Files" tab.
        // Scoring the whole query against the name would reward names where every word
        // matches with big gaps over names that match one word tightly.
        let name_bonus: u32 = pattern
            .atoms
            .iter()
            .filter_map(|a| a.score(Utf32Str::new(name, &mut buf), &mut matcher))
            .map(|s| s as u32 * 2)
            .sum();
        // Shorter paths win ties: they are usually the "real" file and not a deep copy.
        let total = (score + name_bonus).saturating_mul(4);
        scored.push((total.saturating_sub(f.len() as u32 / 8), i));
    }
    scored.sort_unstable_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    scored
        .into_iter()
        .take(MAX_RESULTS)
        .map(|(_, i)| {
            let path = files[i].clone();
            let mut indices = Vec::new();
            pattern.indices(Utf32Str::new(&path, &mut buf), &mut matcher, &mut indices);
            indices.sort_unstable();
            indices.dedup();
            SearchHit { path, indices }
        })
        .collect()
}

impl SearchEverywhere {
    /// The ranked hits of the last finished query.
    pub fn results(&self) -> &[SearchHit] {
        &self.results
    }

    pub fn selected(&self) -> usize {
        self.selected
    }

    pub fn open(&mut self) {
        self.open = true;
        self.focus = true;
        self.selected = 0;
        self.last_query = None;
        self.recent_mode = false;
    }

    /// Cmd+E, like IDEA's Recent Files: the previous file is preselected, so Enter goes back.
    pub fn open_recent(&mut self) {
        self.open();
        self.query.clear();
        self.recent_mode = true;
    }

    /// Records `path` as the most recently opened file.
    pub fn touch(&mut self, path: &Path) {
        self.recent.retain(|p| p != path);
        self.recent.insert(0, path.to_path_buf());
        self.recent.truncate(RECENT_LIMIT);
    }

    pub fn recent(&self) -> &[PathBuf] {
        &self.recent
    }

    /// Detects a double tap of Shift with no other key in between. egui has no key event for
    /// a bare modifier, so this watches the modifier state across frames.
    pub fn detect_double_shift(&mut self, ctx: &egui::Context) -> bool {
        let (shift, other) = ctx.input(|i| {
            let other = i.events.iter().any(|e| matches!(e, egui::Event::Key { .. } | egui::Event::Text(_) | egui::Event::PointerButton { .. }));
            (i.modifiers.shift && !i.modifiers.command && !i.modifiers.alt && !i.modifiers.ctrl, other)
        });
        let mut fire = false;
        if other {
            self.shift_down_clean = false;
            self.last_shift_tap = None;
        }
        if shift && !self.shift_was_down {
            self.shift_down_clean = !other;
        }
        if !shift && self.shift_was_down {
            if self.shift_down_clean {
                let now = Instant::now();
                if self.last_shift_tap.is_some_and(|t| now.duration_since(t).as_millis() < 400) {
                    fire = true;
                    self.last_shift_tap = None;
                } else {
                    self.last_shift_tap = Some(now);
                }
            }
            self.shift_down_clean = false;
        }
        self.shift_was_down = shift;
        fire
    }
}

/// Draws the popup and returns a file to open.
pub fn show(state: &mut AppState, ctx: &egui::Context) -> Option<PathBuf> {
    if !state.ws.search.open {
        return None;
    }
    let root = state.ws.project.as_ref().map(|p| p.root.clone())?;
    if state.ws.search.recent_mode && state.ws.search.last_query.as_deref() != Some(state.ws.search.query.as_str()) {
        // A few dozen paths: matching them is cheaper than a round trip to a worker.
        let s = &mut state.ws.search;
        s.last_query = Some(s.query.clone());
        let rel: Vec<String> = s.recent.iter().map(|p| p.strip_prefix(&root).unwrap_or(p).to_string_lossy().replace('\\', "/")).collect();
        s.results = if s.query.trim().is_empty() { rel.into_iter().map(|path| SearchHit { path, indices: Vec::new() }).collect() } else { match_files(&rel, &s.query) };
        s.selected = usize::from(s.query.trim().is_empty() && s.results.len() > 1);
    } else if !state.ws.search.recent_mode && state.ws.search.last_query.as_deref() != Some(state.ws.search.query.as_str()) {
        state.ws.search.last_query = Some(state.ws.search.query.clone());
        state.ws.search.generation += 1;
        let generation = state.ws.search.generation;
        let files = state.ws.index.files.clone();
        let query = state.ws.search.query.clone();
        state.jobs.spawn_quiet(
            move || match_files(&files, &query),
            move |state, hits| {
                if state.ws.search.generation == generation {
                    state.ws.search.results = hits;
                    state.ws.search.selected = 0;
                }
            },
        );
    }

    let mut chosen = None;
    let (up, down, enter) = ctx.input_mut(|i| {
        (
            i.consume_key(egui::Modifiers::NONE, Key::ArrowUp),
            i.consume_key(egui::Modifiers::NONE, Key::ArrowDown),
            i.consume_key(egui::Modifiers::NONE, Key::Enter),
        )
    });
    let s = &mut state.ws.search;
    if up {
        s.selected = s.selected.saturating_sub(1);
    }
    if down && s.selected + 1 < s.results.len() {
        s.selected += 1;
    }
    if enter {
        if let Some(hit) = s.results.get(s.selected) {
            chosen = Some(root.join(&hit.path));
        }
    }
    let indexing = state.ws.index.building;
    let count = state.ws.index.files.len();
    let modal = Modal::new(crate::workspace::wid("search-everywhere"))
        .area(Modal::default_area(crate::workspace::wid("search-everywhere-area")).anchor(egui::Align2::CENTER_TOP, [0.0, 90.0]))
        .show(ctx, |ui| {
            ui.set_width(640.0);
            ui.horizontal(|ui| {
                if s.recent_mode {
                    ui.label(RichText::new("Recent Files").strong());
                } else {
                    ui.label(RichText::new("Search Everywhere").strong());
                    ui.label(RichText::new(if indexing { "indexing...".to_string() } else { format!("{count} files") }).weak().size(theme::T.font.tiny));
                }
            });
            let hint = if s.recent_mode { "Type to filter recent files" } else { "Type a file name" };
            let edit = ui.add(TextEdit::singleline(&mut s.query).hint_text(hint).desired_width(f32::INFINITY).font(FontId::proportional(theme::T.font.big)));
            if std::mem::take(&mut s.focus) {
                edit.request_focus();
            }
            ui.add_space(4.0);
            // A fixed height: results arrive from a worker, and an auto-sized area would lag one
            // frame behind and clip the list until the next repaint.
            let row_h = theme::T.space.row_h + 2.0;
            let rows_h = (s.results.len().max(1) as f32 * (row_h + ui.spacing().item_spacing.y)).min(420.0);
            ScrollArea::vertical().min_scrolled_height(rows_h).max_height(rows_h).auto_shrink([false, false]).show(ui, |ui| {
                // Rows look like list items, not buttons, until hovered or selected.
                ui.visuals_mut().widgets.inactive.weak_bg_fill = theme::T.clear;
                ui.visuals_mut().widgets.inactive.bg_stroke = egui::Stroke::NONE;
                for (i, hit) in s.results.iter().enumerate() {
                    let job = hit_job(hit);
                    let resp = ui.add(egui::Button::new(job).selected(i == s.selected).wrap_mode(egui::TextWrapMode::Truncate).min_size(egui::vec2(ui.available_width(), row_h)));
                    if i == s.selected && (up || down) {
                        resp.scroll_to_me(None);
                    }
                    if resp.clicked() {
                        chosen = Some(root.join(&hit.path));
                    }
                }
                if s.results.is_empty() && !s.query.trim().is_empty() {
                    ui.label(RichText::new("Nothing found").weak());
                }
            });
        });
    if modal.should_close() || chosen.is_some() {
        s.open = false;
    }
    chosen
}

fn hit_job(hit: &SearchHit) -> LayoutJob {
    let name_start = hit.path.rfind('/').map_or(0, |i| i + 1);
    let mut job = LayoutJob::default();
    let name_char_start = hit.path[..name_start].chars().count() as u32;
    let name = &hit.path[name_start..];
    for (idx, c) in name.chars().enumerate() {
        let matched = hit.indices.binary_search(&(name_char_start + idx as u32)).is_ok();
        let color = if matched { theme::T.match_text } else { theme::T.text_bright };
        job.append(&c.to_string(), 0.0, TextFormat { font_id: theme::T.ui_font(), color, ..Default::default() });
    }
    if name_start > 0 {
        job.append(&format!("  {}", &hit.path[..name_start - 1]), 0.0, TextFormat {
            font_id: theme::T.small_font(),
            color: theme::T.text_dim,
            ..Default::default()
        });
    }
    job
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranks_file_name_matches_first() {
        let files: Vec<String> = [
            "javascript/packages/projects/harwex-notes/harwex-notes-frontend/src/ui/app.tsx",
            "javascript/packages/projects/headless-blender-mcp/vendor/bpy.types.GeometryNodeSetGreasePencilDepth.rst",
            "javascript/packages/prototypes/faenwald/faenwald-server/scripts/assign-default-fortress-supply.ts",
            "javascript/packages/projects/harwex-notes/harwex-notes-frontend/src/store/store.ts",
        ]
        .map(String::from)
        .to_vec();
        let hits = match_files(&files, "appts notes");
        let paths: Vec<&str> = hits.iter().map(|h| h.path.as_str()).collect();
        eprintln!("{paths:#?}");
        assert_eq!(paths[0], files[0]);
        let hits = match_files(&files, "store");
        assert_eq!(hits[0].path, files[3]);
    }
}
