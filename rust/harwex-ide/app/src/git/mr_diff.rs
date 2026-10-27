//! Compare MR Diff (Beta): a Git window tab like a GitLab merge request's Changes view. The
//! files that differ between the current branch (left side) and the picked branch (right side),
//! a two-dot compare of their trees, as the Log's changes tree on the left
//! (`commit_changes::pane_ui`, with `+a -d` counts), and the selected file's unified diff on the
//! right, like a Find tab's preview.
//!
//! Speed: the worker reads the file list and the per-file diffs (`ide_git`'s line diff, in
//! parallel) and turns them into display rows. The right pane draws only the rows in view
//! (`show_rows`). Syntax colors come per file, on a worker, the first time a file is shown.
//! Binary files and files over `MAX_FILE_BYTES` show a note; a diff over `BIG_DIFF_ROWS` rows
//! waits behind a "Show Large Diff" button.

use std::collections::{HashMap, HashSet};
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use egui::{pos2, vec2, Align2, Frame, Margin, Rect, RichText, ScrollArea, Sense, Stroke, Ui};
use ide_editor::{Document, Language, Span};
use ide_git::{ChangeKind, ChangedFile, FileDiff, LineKind, MrFileDiff, Oid, Repo};

use super::commit_changes::{self, ChangesPane};
use super::diff::{display_col, line_job, Metrics};
use crate::icons;
use crate::state::AppState;
use crate::theme;

/// Unchanged lines shown around each change, like `git diff`.
pub const CONTEXT: usize = 3;
/// A side larger than this is not read: the file shows a note.
pub const MAX_FILE_BYTES: usize = 2 * 1024 * 1024;
/// A file diff with more rows waits behind a button.
pub const BIG_DIFF_ROWS: usize = 1500;
/// Syntax-coloring jobs in flight per tab.
const MAX_HL_JOBS: usize = 3;
const HEADER_H: f32 = 30.0;
const LINE_H: f32 = 18.0;
const NUM_W: f32 = 46.0;
const SIGN_W: f32 = 16.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RowKind {
    /// The `@@ -a,b +c,d @@` line of a group of changes.
    Hunk,
    Context,
    Deleted,
    Inserted,
}

/// One line of a unified diff. Line numbers are 0-based.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiffRow {
    pub kind: RowKind,
    pub old: Option<usize>,
    pub new: Option<usize>,
    pub text: String,
    /// Changed char-column ranges (word-level highlight).
    pub inline: Vec<Range<usize>>,
}

/// What a file shows below its header.
#[derive(Clone, Debug)]
pub enum Body {
    Rows(Vec<DiffRow>),
    Binary,
    TooLarge { bytes: usize },
    /// A rename or a mode change without a line change.
    NoLines,
    Error(String),
}

pub struct MrFile {
    pub change: ChangedFile,
    pub adds: usize,
    pub dels: usize,
    pub body: Body,
    /// Both sides' text, kept for the syntax-coloring job.
    texts: Option<Arc<(String, String)>>,
    /// Highlight spans per row, once the coloring job is back.
    spans: Option<Vec<Vec<Span>>>,
    hl_asked: bool,
}

impl MrFile {
    fn from_diff(change: ChangedFile, diff: ide_git::Result<MrFileDiff>) -> MrFile {
        let mut f = MrFile { change, adds: 0, dels: 0, body: Body::NoLines, texts: None, spans: None, hl_asked: false };
        match diff {
            Err(e) => f.body = Body::Error(e.to_string()),
            Ok(MrFileDiff::TooLarge { old_size, new_size }) => f.body = Body::TooLarge { bytes: old_size.max(new_size) },
            Ok(MrFileDiff::Diff(d)) if d.binary => f.body = Body::Binary,
            Ok(MrFileDiff::Diff(d)) => {
                f.adds = d.hunks.iter().map(|h| h.new_lines.len()).sum();
                f.dels = d.hunks.iter().map(|h| h.old_lines.len()).sum();
                let rows = unified_rows(&d);
                if !rows.is_empty() {
                    f.body = Body::Rows(rows);
                    f.texts = Some(Arc::new((d.old_text, d.new_text)));
                }
            }
        }
        f
    }

    fn rows(&self) -> &[DiffRow] {
        match &self.body {
            Body::Rows(r) => r,
            _ => &[],
        }
    }

    /// Shows a note first: nothing to read, or too long to read in passing.
    fn starts_collapsed(&self) -> bool {
        matches!(self.body, Body::Binary | Body::TooLarge { .. }) || self.rows().len() > BIG_DIFF_ROWS
    }
}

/// The unified rows of a file diff: groups of changes with `CONTEXT` lines around them, a group
/// per run of hunks closer than `2 * CONTEXT` lines, each group after its `@@` row. Deleted lines
/// of a hunk come before its inserted ones.
pub fn unified_rows(diff: &FileDiff) -> Vec<DiffRow> {
    let old: Vec<&str> = diff.old_text.lines().collect();
    let new: Vec<&str> = diff.new_text.lines().collect();
    let line = |v: &[&str], i: usize| v.get(i).copied().unwrap_or("").to_string();
    let hunks = &diff.hunks;
    let mut out = Vec::new();
    let mut i = 0;
    while i < hunks.len() {
        let mut j = i;
        while j + 1 < hunks.len() && hunks[j + 1].old_lines.start.saturating_sub(hunks[j].old_lines.end) <= 2 * CONTEXT {
            j += 1;
        }
        let (first, last) = (&hunks[i], &hunks[j]);
        let old_start = first.old_lines.start.saturating_sub(CONTEXT);
        let new_start = first.new_lines.start.saturating_sub(first.old_lines.start - old_start);
        let old_end = (last.old_lines.end + CONTEXT).min(old.len().max(last.old_lines.end));
        let new_end = last.new_lines.end + (old_end - last.old_lines.end);
        out.push(DiffRow { kind: RowKind::Hunk, old: None, new: None, text: format!("@@ -{},{} +{},{} @@", old_start + 1, old_end - old_start, new_start + 1, new_end - new_start), inline: Vec::new() });
        let context = |out: &mut Vec<DiffRow>, o: usize, n: usize| out.push(DiffRow { kind: RowKind::Context, old: Some(o), new: Some(n), text: line(&new, n), inline: Vec::new() });
        let (mut o, mut n) = (old_start, new_start);
        for h in &hunks[i..=j] {
            while o < h.old_lines.start {
                context(&mut out, o, n);
                o += 1;
                n += 1;
            }
            let mut old_inline: HashMap<usize, &Vec<Range<usize>>> = HashMap::new();
            let mut new_inline: HashMap<usize, &Vec<Range<usize>>> = HashMap::new();
            for p in h.pairs.iter().filter(|p| p.kind == LineKind::Changed) {
                if let Some(l) = p.old {
                    old_inline.insert(l, &p.old_inline);
                }
                if let Some(l) = p.new {
                    new_inline.insert(l, &p.new_inline);
                }
            }
            for l in h.old_lines.clone() {
                out.push(DiffRow { kind: RowKind::Deleted, old: Some(l), new: None, text: line(&old, l), inline: old_inline.get(&l).map_or_else(Vec::new, |r| (*r).clone()) });
            }
            for l in h.new_lines.clone() {
                out.push(DiffRow { kind: RowKind::Inserted, old: None, new: Some(l), text: line(&new, l), inline: new_inline.get(&l).map_or_else(Vec::new, |r| (*r).clone()) });
            }
            o = h.old_lines.end;
            n = h.new_lines.end;
        }
        while o < old_end {
            context(&mut out, o, n);
            o += 1;
            n += 1;
        }
        i = j + 1;
    }
    out
}

fn note_of(f: &MrFile, collapsed: bool) -> Option<String> {
    match &f.body {
        Body::Rows(rows) if collapsed && rows.len() > BIG_DIFF_ROWS => Some(format!("Large diff ({} lines) is hidden.", rows.len())),
        Body::Rows(_) => None,
        Body::Binary => Some("Binary file not shown.".to_string()),
        Body::TooLarge { bytes } => Some(format!("File too large to show ({} KB).", bytes.div_ceil(1024))),
        Body::Error(e) => Some(e.clone()),
        Body::NoLines if f.change.kind == ChangeKind::Renamed => Some("File moved without changes.".to_string()),
        Body::NoLines => Some("No line changes.".to_string()),
    }
}

/// One Compare MR Diff tab.
pub struct MrTab {
    pub source: String,
    pub target: String,
    view_id: u64,
    /// Bumped by each load; older results are dropped.
    generation: u64,
    data: Option<Result<MrData, String>>,
    pane: ChangesPane,
    /// Big diffs the user chose to show.
    expanded: HashSet<usize>,
    /// The file the right pane showed last frame.
    shown: Option<usize>,
    hl_jobs: usize,
}

pub struct MrData {
    /// The current branch's commit (the left side).
    pub base: Oid,
    pub files: Vec<MrFile>,
}

impl MrTab {
    pub(super) fn new(source: String, target: String) -> MrTab {
        MrTab { source, target, view_id: super::log::next_view_id(), generation: 0, data: None, pane: ChangesPane::default(), expanded: HashSet::new(), shown: None, hl_jobs: 0 }
    }

    pub fn title(&self) -> String {
        format!("MR: {} → {}", self.source, self.target)
    }

    /// The files once loaded.
    pub fn files(&self) -> Option<&[MrFile]> {
        self.data.as_ref()?.as_ref().ok().map(|d| d.files.as_slice())
    }

    pub fn error(&self) -> Option<&str> {
        self.data.as_ref()?.as_ref().err().map(String::as_str)
    }

    /// The file whose diff the right pane shows.
    pub fn shown_file(&self) -> Option<&Path> {
        Some(&self.files()?.get(self.shown?)?.change.path)
    }

    /// Whether the diff of `path` waits behind its "Show Large Diff" note.
    pub fn is_collapsed(&self, path: &Path) -> bool {
        self.files().and_then(|f| f.iter().position(|f| f.change.path == path)).is_some_and(|i| self.collapsed(i))
    }

    /// The tree's selected rows.
    pub fn tree_selection(&self) -> &[PathBuf] {
        self.pane.selected_rows()
    }

    /// Whether the syntax colors of `path` are in.
    pub fn highlighted(&self, path: &Path) -> bool {
        self.files().and_then(|f| f.iter().find(|f| f.change.path == path)).is_some_and(|f| f.spans.is_some())
    }

    fn collapsed(&self, i: usize) -> bool {
        self.files().is_some_and(|f| f[i].starts_collapsed()) && !self.expanded.contains(&i)
    }

    fn set_data(&mut self, generation: u64, data: Result<MrData, String>) {
        if generation != self.generation {
            return;
        }
        self.expanded.clear();
        self.shown = None;
        if let Ok(d) = &data {
            self.pane.set_list(d.files.iter().map(|f| f.change.clone()).collect());
            // A binary or unread file has no line counts to show.
            self.pane.stats = d.files.iter().filter(|f| matches!(f.body, Body::Rows(_))).map(|f| (f.change.path.clone(), (f.adds, f.dels))).collect();
            // The first file shows at once, like the first match of a Find tab.
            if let Some(f) = d.files.first() {
                self.pane.reveal(&f.change.path);
            }
        }
        self.data = Some(data);
    }
}

/// Reads the MR diff on a worker into the tab `id` (a Git window tab id).
pub(super) fn load(state: &mut AppState, id: u64, tab: &mut MrTab) {
    let Some(repo) = state.ws.git.repo.clone() else { return };
    tab.generation += 1;
    tab.data = None;
    let generation = tab.generation;
    let source = tab.source.clone();
    state.jobs.spawn(
        format!("MR diff of {source}"),
        move || compute(&repo, &source),
        move |state, res| {
            if let Some(tab) = super::window::mr_tab_mut(state, id) {
                tab.set_data(generation, res);
            }
        },
    );
}

fn compute(repo: &Repo, source: &str) -> Result<MrData, String> {
    let mr = repo.mr_changes(source).map_err(|e| e.to_string())?;
    let cancel = crate::jobs::current_cancel();
    let next = AtomicUsize::new(0);
    let done = AtomicUsize::new(0);
    let total = mr.files.len().max(1);
    let threads = crate::find::search_threads().min(mr.files.len()).max(1);
    let work = |report: bool| -> Vec<(usize, MrFile)> {
        let mut out = Vec::new();
        loop {
            let i = next.fetch_add(1, Ordering::Relaxed);
            if i >= mr.files.len() || cancel.load(Ordering::Relaxed) {
                return out;
            }
            let f = &mr.files[i];
            out.push((i, MrFile::from_diff(f.clone(), repo.mr_file_diff(&mr.base, &mr.tip, f, MAX_FILE_BYTES))));
            let n = done.fetch_add(1, Ordering::Relaxed) + 1;
            if report {
                crate::jobs::report_progress(n as f32 / total as f32);
            }
        }
    };
    let mut parts: Vec<(usize, MrFile)> = std::thread::scope(|s| {
        let helpers: Vec<_> = (1..threads).map(|_| s.spawn(|| work(false))).collect();
        // This thread works too and reports the progress: only the job's own thread can.
        let mut all = work(true);
        for h in helpers {
            all.extend(h.join().unwrap_or_default());
        }
        all
    });
    if cancel.load(Ordering::Relaxed) {
        return Err(format!("MR diff {}", ide_git::CANCELLED));
    }
    parts.sort_by_key(|(i, _)| *i);
    Ok(MrData { base: mr.base, files: parts.into_iter().map(|(_, f)| f).collect() })
}

/// Syntax spans per row of one file: both sides parsed whole, only the shown lines colored.
fn highlight_rows(path: &Path, texts: &(String, String), rows: &[DiffRow]) -> Vec<Vec<Span>> {
    let language = Language::from_path(path);
    let side = |text: &str, lines: Vec<usize>| -> HashMap<usize, Vec<Span>> {
        let mut map = HashMap::new();
        if lines.is_empty() {
            return map;
        }
        let mut doc = Document::from_text(text, language);
        doc.wait_syntax();
        let mut k = 0;
        while k < lines.len() {
            let mut e = k;
            while e + 1 < lines.len() && lines[e + 1] == lines[e] + 1 {
                e += 1;
            }
            for (l, spans) in (lines[k]..=lines[e]).zip(doc.highlight(lines[k]..lines[e] + 1)) {
                map.insert(l, spans);
            }
            k = e + 1;
        }
        map
    };
    let wanted = |pick: fn(&DiffRow) -> Option<usize>| -> Vec<usize> {
        let mut v: Vec<usize> = rows.iter().filter_map(pick).collect();
        v.sort_unstable();
        v.dedup();
        v
    };
    let old = side(&texts.0, wanted(|r| (r.kind == RowKind::Deleted).then_some(r.old).flatten()));
    let new = side(&texts.1, wanted(|r| (matches!(r.kind, RowKind::Context | RowKind::Inserted)).then_some(r.new).flatten()));
    rows.iter()
        .map(|r| {
            let got = match r.kind {
                RowKind::Deleted => r.old.and_then(|l| old.get(&l)),
                RowKind::Context | RowKind::Inserted => r.new.and_then(|l| new.get(&l)),
                RowKind::Hunk => None,
            };
            got.cloned().unwrap_or_default()
        })
        .collect()
}

fn request_highlight(state: &mut AppState, id: u64, tab: &mut MrTab, file: usize) {
    if tab.hl_jobs >= MAX_HL_JOBS {
        return;
    }
    let Some(Ok(data)) = &mut tab.data else { return };
    let f = &mut data.files[file];
    if f.hl_asked {
        return;
    }
    let (Some(texts), Body::Rows(rows)) = (f.texts.clone(), &f.body) else { return };
    f.hl_asked = true;
    tab.hl_jobs += 1;
    let rows = rows.clone();
    let path = f.change.path.clone();
    let generation = tab.generation;
    state.jobs.spawn_quiet(
        move || highlight_rows(&path, &texts, &rows),
        move |state, spans| {
            let Some(tab) = super::window::mr_tab_mut(state, id) else { return };
            tab.hl_jobs = tab.hl_jobs.saturating_sub(1);
            if tab.generation != generation {
                return;
            }
            if let Some(Ok(d)) = &mut tab.data {
                d.files[file].spans = Some(spans);
            }
        },
    );
}

/// The tab body: the changes tree on the left, the selected file's diff on the right (the Find
/// window's layout: a row on the left, its preview on the right).
pub(super) fn body(state: &mut AppState, tab: &mut MrTab, id: u64, ui: &mut Ui) {
    let t = &theme::T;
    match &tab.data {
        None => {
            ui.label(RichText::new(format!("Comparing {} with {}...", tab.source, tab.target)).color(t.text_dim));
            return;
        }
        Some(Err(e)) => {
            ui.label(RichText::new(e).color(t.error));
            return;
        }
        Some(Ok(_)) => {}
    }
    egui::SidePanel::left(crate::workspace::wid(("git-mr-tree", id)))
        .resizable(true)
        .default_width(300.0)
        .width_range(160.0..=600.0)
        .frame(Frame::NONE.inner_margin(Margin { left: 0, right: 6, top: 0, bottom: 0 }))
        .show_inside(ui, |ui| {
            let (files, adds, dels) = tab.files().map_or((0, 0, 0), |f| (f.len(), f.iter().map(|f| f.adds).sum::<usize>(), f.iter().map(|f| f.dels).sum::<usize>()));
            let note = format!("{files} file{}  +{adds} -{dels}", if files == 1 { "" } else { "s" });
            // The selection is the whole interface: Enter and double clicks have nothing more to do.
            let _ = commit_changes::pane_ui(state, tab.view_id, &mut tab.pane, ui, Some(note), false);
        });
    let selected = tab.pane.selected_rows().last().cloned();
    tab.shown = selected.and_then(|p| tab.files().and_then(|f| f.iter().position(|f| f.change.path == p)));
    egui::CentralPanel::default().frame(Frame::NONE.inner_margin(Margin { left: 6, right: 0, top: 0, bottom: 0 })).show_inside(ui, |ui| file_view(state, tab, id, ui));
}

fn file_view(state: &mut AppState, tab: &mut MrTab, id: u64, ui: &mut Ui) {
    let t = &theme::T;
    let Some(i) = tab.shown else {
        ui.add_space(6.0);
        ui.label(RichText::new("Select a file to see its diff.").color(t.text_dim));
        return;
    };
    let collapsed = tab.collapsed(i);
    let Some(Ok(data)) = &tab.data else { return };
    let file = &data.files[i];
    let (bar, _) = ui.allocate_exact_size(vec2(ui.available_width(), HEADER_H), Sense::hover());
    header(ui, bar, file);
    if let Some(note) = note_of(file, collapsed) {
        ui.add_space(8.0);
        ui.horizontal(|ui| {
            ui.add_space(8.0);
            ui.label(RichText::new(&note).color(t.text_dim));
        });
        if collapsed {
            ui.add_space(4.0);
            let mut show = false;
            ui.horizontal(|ui| {
                ui.add_space(8.0);
                show = ui.button("Show Large Diff").clicked();
            });
            if show {
                tab.expanded.insert(i);
            }
        }
        return;
    }
    let th = state.editor_theme.clone();
    let font = t.mono_font();
    let char_w = ui.fonts(|f| ide_editor::column_advance(f, &font));
    let metrics = Metrics { char_w, font };
    let rows = file.rows();
    ui.spacing_mut().item_spacing.y = 0.0;
    // One scroll state per file: a file comes back where the user left it.
    let out = ScrollArea::vertical().id_salt(("git-mr-diff", id, i)).auto_shrink([false, false]).show_rows(ui, LINE_H, rows.len(), |ui, range| {
        let w = ui.available_width();
        for r in range {
            let (rect, _) = ui.allocate_exact_size(vec2(w, LINE_H), Sense::hover());
            let spans = file.spans.as_ref().and_then(|s| s.get(r)).map_or(&[][..], Vec::as_slice);
            draw_row(ui, rect, &rows[r], spans, &metrics, &th);
        }
    });
    let node = ui.interact(out.inner_rect, crate::workspace::wid(("git-mr-diff-body", id)), Sense::hover());
    crate::util::label_widget(&node, egui::WidgetType::Other, "MR diff");
    if file.spans.is_none() && !file.hl_asked {
        request_highlight(state, id, tab, i);
    }
}

/// The file's header over its diff: icon, folder, name in its change color, old path, counts.
fn header(ui: &mut Ui, rect: Rect, file: &MrFile) {
    let t = &theme::T;
    let path = file.change.path.display().to_string();
    let node = ui.interact(rect, ui.id().with("mr-file-header"), Sense::hover());
    crate::util::label_widget(&node, egui::WidgetType::Label, format!("MR file {path}"));
    let p = ui.painter().with_clip_rect(rect.intersect(ui.clip_rect()));
    p.rect_filled(rect, 0.0, t.tab_active_bg);
    p.rect_stroke(rect, 0.0, Stroke::new(1.0_f32, t.border), egui::StrokeKind::Inside);
    let cy = rect.center().y;
    let mut x = rect.min.x + 10.0;
    let name = file.change.path.file_name().map_or_else(|| path.clone(), |n| n.to_string_lossy().into_owned());
    icons::file(&p, pos2(x + 7.0, cy), 14.0, &name);
    x += 20.0;
    if let Some(dir) = file.change.path.parent().filter(|d| !d.as_os_str().is_empty()) {
        x = p.text(pos2(x, cy), Align2::LEFT_CENTER, format!("{}/", dir.display()), t.ui_font(), t.text_dim).right();
    }
    x = p.text(pos2(x, cy), Align2::LEFT_CENTER, name, t.semibold(t.font.ui), crate::tree::change_color(file.change.kind)).right();
    if let Some(old) = &file.change.old_path {
        p.text(pos2(x + 8.0, cy), Align2::LEFT_CENTER, format!("← {}", old.display()), t.ui_font(), t.text_dim);
    }
    if matches!(file.body, Body::Rows(_)) {
        let r = p.text(pos2(rect.max.x - 10.0, cy), Align2::RIGHT_CENTER, format!("-{}", file.dels), t.small_font(), t.git_deleted);
        p.text(pos2(r.min.x - 6.0, cy), Align2::RIGHT_CENTER, format!("+{}", file.adds), t.small_font(), t.git_added);
    }
}

fn side_borders(p: &egui::Painter, rect: Rect) {
    let stroke = Stroke::new(1.0_f32, theme::T.border);
    p.vline(rect.min.x + 0.5, rect.y_range(), stroke);
    p.vline(rect.max.x - 0.5, rect.y_range(), stroke);
}

fn draw_row(ui: &Ui, rect: Rect, row: &DiffRow, spans: &[Span], m: &Metrics, th: &ide_editor::EditorTheme) {
    let t = &theme::T;
    let p = ui.painter().with_clip_rect(rect.intersect(ui.clip_rect()));
    let (bg, word, sign) = match row.kind {
        RowKind::Deleted => (Some(t.diff_deleted_bg), t.diff_deleted_word, "-"),
        RowKind::Inserted => (Some(t.diff_inserted_bg), t.diff_inserted_word, "+"),
        RowKind::Hunk => (Some(t.code_bg), t.diff_modified_word, ""),
        RowKind::Context => (None, t.diff_modified_word, ""),
    };
    let gutter = Rect::from_min_max(rect.min, pos2(rect.min.x + 2.0 * NUM_W, rect.max.y));
    p.rect_filled(gutter, 0.0, th.gutter_background);
    if let Some(bg) = bg {
        p.rect_filled(Rect::from_min_max(pos2(gutter.max.x, rect.min.y), rect.max), 0.0, bg);
    }
    side_borders(&p, rect);
    let cy = rect.center().y;
    for (n, x) in [(row.old, gutter.min.x + NUM_W - 8.0), (row.new, gutter.max.x - 8.0)] {
        if let Some(n) = n {
            p.text(pos2(x, cy), Align2::RIGHT_CENTER, (n + 1).to_string(), t.mono_small_font(), th.line_number);
        }
    }
    let text_x = gutter.max.x + SIGN_W;
    if row.kind == RowKind::Hunk {
        p.text(pos2(gutter.max.x + 6.0, cy), Align2::LEFT_CENTER, &row.text, t.mono_small_font(), t.text_dim);
        return;
    }
    p.text(pos2(gutter.max.x + 5.0, cy), Align2::LEFT_CENTER, sign, m.font.clone(), th.line_number);
    let galley = p.layout_job(line_job(&row.text, spans, m, th));
    let x_at = |col: usize| galley.pos_from_ccursor(egui::text::CCursor::new(display_col(&row.text, col))).min.x;
    for r in &row.inline {
        let a = x_at(r.start);
        let b = x_at(r.end).max(a + m.char_w * 0.5);
        p.rect_filled(Rect::from_min_max(pos2(text_x + a, rect.min.y + 1.0), pos2(text_x + b, rect.max.y - 1.0)), 2.0, word);
    }
    p.galley(pos2(text_x, rect.min.y + (LINE_H - galley.size().y) / 2.0), galley, th.foreground);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn diff(old: &str, new: &str) -> FileDiff {
        FileDiff {
            path: PathBuf::from("f.txt"),
            old_path: None,
            old_text: old.into(),
            new_text: new.into(),
            old_exists: true,
            new_exists: true,
            binary: false,
            hunks: ide_git::diff_texts(old, new),
            old_bytes: Vec::new(),
            new_bytes: Vec::new(),
        }
    }

    fn render(rows: &[DiffRow]) -> Vec<String> {
        rows.iter()
            .map(|r| match r.kind {
                RowKind::Hunk => r.text.clone(),
                RowKind::Context => format!(" {}", r.text),
                RowKind::Deleted => format!("-{}", r.text),
                RowKind::Inserted => format!("+{}", r.text),
            })
            .collect()
    }

    #[test]
    fn rows_group_hunks_with_context() {
        let old: String = (1..=20).map(|i| format!("{i}\n")).collect();
        let new: String = (1..=20)
            .filter(|&i| i != 18)
            .map(|i| match i {
                2 => "two\n".to_string(),
                4 => "four\n".to_string(),
                _ => format!("{i}\n"),
            })
            .collect();
        let rows = unified_rows(&diff(&old, &new));
        assert_eq!(
            render(&rows),
            [
                "@@ -1,7 +1,7 @@", " 1", "-2", "+two", " 3", "-4", "+four", " 5", " 6", " 7",
                "@@ -15,6 +15,5 @@", " 15", " 16", " 17", "-18", " 19", " 20",
            ]
        );
        let changed = rows.iter().find(|r| r.text == "two").unwrap();
        assert_eq!((changed.old, changed.new), (None, Some(1)));
        assert_eq!(changed.inline, vec![Range { start: 0, end: 3 }]);
        let ctx = rows.iter().find(|r| r.text == "19").unwrap();
        assert_eq!((ctx.old, ctx.new), (Some(18), Some(17)));
    }

    #[test]
    fn added_file_is_all_inserted_and_big_files_start_collapsed() {
        let rows = unified_rows(&diff("", "a\nb\n"));
        assert_eq!(render(&rows), ["@@ -1,0 +1,2 @@", "+a", "+b"]);
        let text: String = (0..BIG_DIFF_ROWS).map(|i| format!("{i}\n")).collect();
        let d = diff("", &text);
        let f = MrFile::from_diff(ChangedFile { path: d.path.clone(), old_path: None, kind: ChangeKind::Added }, Ok(MrFileDiff::Diff(d)));
        assert_eq!((f.adds, f.dels), (BIG_DIFF_ROWS, 0));
        assert!(f.starts_collapsed());
        let bin = MrFile::from_diff(ChangedFile { path: "x.png".into(), old_path: None, kind: ChangeKind::Added }, Ok(MrFileDiff::TooLarge { old_size: 0, new_size: 5000 }));
        assert!(bin.starts_collapsed());
        assert_eq!(note_of(&bin, false).as_deref(), Some("File too large to show (5 KB)."));
    }
}
