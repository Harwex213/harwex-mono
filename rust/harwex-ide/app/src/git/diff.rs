//! Side-by-side diff tabs. The history agent calls `open_commit_diff` from the log.
//!
//! Both panes scroll through one "virtual" coordinate: unchanged runs count once, and a hunk
//! counts as many lines as its taller side. Each pane maps that coordinate to its own line, so
//! the two sides stay aligned at every hunk, like IDEA. Only visible lines are laid out, and
//! highlight spans are cached per line, so a 10k-line diff costs the same per frame as a short one.

use std::any::Any;
use std::collections::HashMap;
use std::ops::Range;
use std::path::{Path, PathBuf};

use egui::text::{LayoutJob, TextFormat};
use egui::{pos2, vec2, Align2, Color32, CursorIcon, FontId, Id, Key, Mesh, Rect, RichText, Sense, Shape, Stroke, Ui};
use ide_editor::{Document, EditorTheme, HlKind, Language, Position, Span};
use ide_git::{DiffHunk, DiffSide, FileDiff, LineKind, Oid, Repo};

use crate::state::{AppCommand, AppState, TabEnv};
use crate::tabs::CustomTab;
use crate::theme;

const LINE_H: f32 = 18.0;
const RIBBON_W: f32 = 36.0;
const SCROLLBAR_W: f32 = 12.0;
/// Longer lines are cut for display; nobody reads column 3000 in a diff.
const MAX_COLS: usize = 3000;

#[derive(Clone, Copy, PartialEq, Eq)]
enum HunkKind {
    Inserted,
    Deleted,
    Modified,
}

impl HunkKind {
    fn of(h: &DiffHunk) -> HunkKind {
        if h.old_lines.is_empty() {
            HunkKind::Inserted
        } else if h.new_lines.is_empty() {
            HunkKind::Deleted
        } else {
            HunkKind::Modified
        }
    }
    fn bg(self) -> Color32 {
        match self {
            HunkKind::Inserted => theme::T.diff_inserted_bg,
            HunkKind::Deleted => theme::T.diff_deleted_bg,
            HunkKind::Modified => theme::T.diff_modified_bg,
        }
    }
    fn word(self) -> Color32 {
        match self {
            HunkKind::Inserted => theme::T.diff_inserted_word,
            HunkKind::Deleted => theme::T.diff_deleted_word,
            HunkKind::Modified => theme::T.diff_modified_word,
        }
    }
    fn edge(self) -> Color32 {
        match self {
            HunkKind::Inserted => theme::T.diff_inserted_edge,
            HunkKind::Deleted => theme::T.diff_deleted_edge,
            HunkKind::Modified => theme::T.diff_modified_edge,
        }
    }
}

#[derive(Clone)]
enum Source {
    /// HEAD vs the file on disk (or the unsaved editor buffer).
    Worktree { abs: PathBuf, rel: PathBuf },
    /// Parent vs commit. `abs` is the file's place in the working tree.
    Commit { oid: Oid, rel: PathBuf, abs: PathBuf },
}

/// One side of the diff.
struct Pane {
    doc: Document,
    lines: usize,
    /// Hunk index per line, `u32::MAX` outside hunks.
    hunk_of: Vec<u32>,
    /// Changed char-column ranges per line (word-level highlight).
    inline: HashMap<usize, Vec<Range<usize>>>,
    /// Highlight spans per line, filled lazily for visible lines.
    spans: Vec<Option<Vec<Span>>>,
    spans_version: (u64, u64),
    max_cols: usize,
    exists: bool,
}

impl Pane {
    fn new(text: &str, language: Language, exists: bool) -> Pane {
        let mut doc = Document::from_text(text, language);
        // Parse on the worker that builds the model, so the first frame does not stall.
        doc.wait_syntax();
        let lines = if text.is_empty() {
            0
        } else if text.ends_with('\n') {
            doc.line_count() - 1
        } else {
            doc.line_count()
        };
        let mut max_cols = 0;
        for l in text.split('\n') {
            let n = l.chars().map(|c| if c == '\t' { 4 } else { 1 }).sum::<usize>();
            max_cols = max_cols.max(n.min(MAX_COLS));
        }
        let spans_version = doc.highlight_version();
        Pane { doc, lines, hunk_of: vec![u32::MAX; lines], inline: HashMap::new(), spans: vec![None; lines], spans_version, max_cols, exists }
    }

    /// Fills the span cache for `range` (plus a margin) in one highlight call.
    fn ensure_spans(&mut self, range: Range<usize>) {
        let v = self.doc.highlight_version();
        if v != self.spans_version {
            self.spans_version = v;
            self.spans.iter_mut().for_each(|s| *s = None);
        }
        let range = range.start.min(self.lines)..range.end.min(self.lines);
        if range.clone().all(|l| self.spans[l].is_some()) {
            return;
        }
        let from = range.start.saturating_sub(40);
        let to = (range.end + 40).min(self.lines);
        let hl = self.doc.highlight(from..to);
        for (i, s) in hl.into_iter().enumerate() {
            if let Some(slot) = self.spans.get_mut(from + i) {
                *slot = Some(s);
            }
        }
    }
}

/// A run of the virtual coordinate: either unchanged lines or one hunk.
#[derive(Clone, Copy)]
struct Segment {
    v0: f64,
    len: f64,
    old0: usize,
    old_len: usize,
    new0: usize,
    new_len: usize,
    hunk: Option<usize>,
}

struct Model {
    diff: FileDiff,
    old: Pane,
    new: Pane,
    segments: Vec<Segment>,
    total: f64,
    /// Text the new side was built from, for "did anything change" checks on reload.
    new_text: String,
}

impl Model {
    fn build(diff: FileDiff, new_override: Option<String>) -> Model {
        let mut diff = diff;
        if let Some(buf) = new_override {
            if !diff.binary && buf != diff.new_text {
                diff.hunks = ide_git::diff_texts(&diff.old_text, &buf);
                diff.new_text = buf;
                diff.new_exists = true;
            }
        }
        let language = Language::from_path(&diff.path);
        let mut old = Pane::new(&diff.old_text, language, diff.old_exists);
        let mut new = Pane::new(&diff.new_text, language, diff.new_exists);
        for (hi, h) in diff.hunks.iter().enumerate() {
            for l in h.old_lines.clone() {
                if let Some(s) = old.hunk_of.get_mut(l) {
                    *s = hi as u32;
                }
            }
            for l in h.new_lines.clone() {
                if let Some(s) = new.hunk_of.get_mut(l) {
                    *s = hi as u32;
                }
            }
            for p in &h.pairs {
                if p.kind != LineKind::Changed {
                    continue;
                }
                if let (Some(o), false) = (p.old, p.old_inline.is_empty()) {
                    old.inline.insert(o, p.old_inline.clone());
                }
                if let (Some(n), false) = (p.new, p.new_inline.is_empty()) {
                    new.inline.insert(n, p.new_inline.clone());
                }
            }
        }
        let mut segments = Vec::with_capacity(diff.hunks.len() * 2 + 1);
        let (mut o, mut n, mut v) = (0usize, 0usize, 0f64);
        let push_equal = |segments: &mut Vec<Segment>, o: &mut usize, n: &mut usize, v: &mut f64, upto_old: usize| {
            let len = upto_old.saturating_sub(*o);
            if len > 0 {
                segments.push(Segment { v0: *v, len: len as f64, old0: *o, old_len: len, new0: *n, new_len: len, hunk: None });
                *o += len;
                *n += len;
                *v += len as f64;
            }
        };
        for (hi, h) in diff.hunks.iter().enumerate() {
            push_equal(&mut segments, &mut o, &mut n, &mut v, h.old_lines.start);
            // Re-sync in case the hunk list skipped lines on one side.
            o = h.old_lines.start;
            n = h.new_lines.start;
            let (ol, nl) = (h.old_lines.len(), h.new_lines.len());
            let len = ol.max(nl).max(1) as f64;
            segments.push(Segment { v0: v, len, old0: o, old_len: ol, new0: n, new_len: nl, hunk: Some(hi) });
            o += ol;
            n += nl;
            v += len;
        }
        let rest = old.lines.saturating_sub(o).max(new.lines.saturating_sub(n));
        if rest > 0 {
            segments.push(Segment { v0: v, len: rest as f64, old0: o, old_len: rest, new0: n, new_len: rest, hunk: None });
            v += rest as f64;
        }
        let new_text = diff.new_text.clone();
        Model { diff, old, new, segments, total: v, new_text }
    }

    /// Line (fractional) shown at virtual position `t` on one side.
    fn map(&self, t: f64, old_side: bool) -> f64 {
        if self.segments.is_empty() {
            return t;
        }
        let i = self.segments.partition_point(|s| s.v0 <= t).saturating_sub(1);
        let s = self.segments[i];
        let frac = ((t - s.v0) / s.len).clamp(0.0, 1.0);
        let (start, len) = if old_side { (s.old0, s.old_len) } else { (s.new0, s.new_len) };
        if s.hunk.is_none() {
            // Past the last segment the shorter side simply runs out.
            return start as f64 + (t - s.v0).max(0.0);
        }
        start as f64 + frac * len as f64
    }

    fn hunk_v0(&self, hunk: usize) -> f64 {
        self.segments.iter().find(|s| s.hunk == Some(hunk)).map_or(0.0, |s| s.v0)
    }
}

enum Load {
    Loading,
    Failed(String),
    Ready(Box<Model>),
}

pub struct DiffTab {
    key: String,
    title: String,
    tooltip: String,
    source: Source,
    load: Load,
    /// Top of the view in virtual lines.
    t: f64,
    hscroll: f32,
    /// Hunk F7 / Shift+F7 last moved to; cleared by manual scrolling.
    current: Option<usize>,
    goto_first: bool,
    reloading: bool,
    /// A reload was asked for while one ran; it runs again when the first one lands.
    reload_pending: bool,
    view_lines: f64,
    dragging_thumb: Option<f32>,
}

impl DiffTab {
    fn new(source: Source) -> DiffTab {
        let (key, title, tooltip) = match &source {
            Source::Worktree { rel, .. } => {
                (format!("diff:wt:{}", rel.display()), format!("{} (Diff)", name_of(rel)), format!("{}: HEAD vs working tree", rel.display()))
            }
            Source::Commit { oid, rel, .. } => {
                let short = &oid.to_string()[..8];
                (format!("diff:{oid}:{}", rel.display()), format!("{} @ {short}", name_of(rel)), format!("{}: changes in {short}", rel.display()))
            }
        };
        DiffTab { key, title, tooltip, source, load: Load::Loading, t: 0.0, hscroll: 0.0, current: None, goto_first: true, reloading: false, reload_pending: false, view_lines: 30.0, dragging_thumb: None }
    }

    fn set_model(&mut self, model: Model) {
        let keep = matches!(self.load, Load::Ready(_));
        self.load = Load::Ready(Box::new(model));
        if !keep {
            self.goto_first = true;
        }
        self.clamp();
    }

    fn model(&self) -> Option<&Model> {
        match &self.load {
            Load::Ready(m) => Some(m),
            _ => None,
        }
    }

    fn max_t(&self) -> f64 {
        self.model().map_or(0.0, |m| (m.total - self.view_lines + 3.0).max(0.0))
    }

    fn clamp(&mut self) {
        self.t = self.t.clamp(0.0, self.max_t());
    }

    fn go_to_hunk(&mut self, hunk: usize) {
        let Some(m) = self.model() else { return };
        let v = m.hunk_v0(hunk);
        self.t = v - (self.view_lines / 3.0).floor();
        self.current = Some(hunk);
        self.clamp();
    }

    fn step(&mut self, forward: bool) {
        let Some(m) = self.model() else { return };
        let n = m.diff.hunks.len();
        if n == 0 {
            return;
        }
        let next = match self.current {
            Some(c) if forward => (c + 1 < n).then_some(c + 1),
            Some(c) => c.checked_sub(1),
            None => {
                let anchor = self.t + (self.view_lines / 3.0).floor();
                if forward {
                    (0..n).find(|&h| m.hunk_v0(h) > anchor + 0.5)
                } else {
                    (0..n).rev().find(|&h| m.hunk_v0(h) < anchor - 0.5)
                }
            }
        };
        if let Some(h) = next {
            self.go_to_hunk(h);
        }
    }

    /// Number of changed blocks, once the diff is loaded.
    pub fn hunk_count(&self) -> Option<usize> {
        self.model().map(|m| m.diff.hunks.len())
    }

    /// The change F7 / Shift+F7 last moved to.
    pub fn current_hunk(&self) -> Option<usize> {
        self.current
    }

    /// First new-side line of hunk `i`.
    pub fn hunk_new_start(&self, i: usize) -> Option<usize> {
        self.model().and_then(|m| m.diff.hunks.get(i)).map(|h| h.new_lines.start)
    }

    pub fn is_binary(&self) -> bool {
        self.model().is_some_and(|m| m.diff.binary)
    }

    fn rel(&self) -> &Path {
        match &self.source {
            Source::Worktree { rel, .. } | Source::Commit { rel, .. } => rel,
        }
    }
}

fn name_of(p: &Path) -> String {
    p.file_name().map_or_else(|| p.display().to_string(), |n| n.to_string_lossy().into_owned())
}

impl CustomTab for DiffTab {
    fn key(&self) -> String {
        self.key.clone()
    }
    fn title(&self) -> String {
        self.title.clone()
    }
    fn tooltip(&self) -> String {
        self.tooltip.clone()
    }
    fn file_path(&self) -> Option<PathBuf> {
        match &self.source {
            Source::Worktree { abs, .. } | Source::Commit { abs, .. } => Some(abs.clone()),
        }
    }
    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
    fn ui(&mut self, ui: &mut Ui, env: &mut TabEnv) {
        let body_id = Id::new(("diff-body", &self.key));
        toolbar(self, ui, env, body_id);
        match &self.load {
            Load::Loading => {
                ui.add_space(20.0);
                ui.horizontal(|ui| {
                    ui.add_space(20.0);
                    ui.add(egui::Spinner::new());
                    ui.label("Loading diff...");
                });
                return;
            }
            Load::Failed(e) => {
                ui.add_space(20.0);
                ui.label(RichText::new(format!("Cannot load the diff: {e}")).color(theme::T.error));
                return;
            }
            Load::Ready(m) if m.diff.binary => {
                ui.add_space(20.0);
                ui.vertical_centered(|ui| ui.label(RichText::new("Binary files differ").color(theme::T.text_dim)));
                return;
            }
            Load::Ready(_) => {}
        }
        body(self, ui, env.editor_theme, body_id);
    }
}

fn toolbar(tab: &mut DiffTab, ui: &mut Ui, env: &mut TabEnv, body_id: Id) {
    let focused = ui.ctx().memory(|m| m.focused());
    let keys_ok = focused.is_none() || focused == Some(body_id);
    let (f7, shift_f7, f4) = if keys_ok {
        // Shift+F7 first: consume_key ignores an extra Shift, so a plain-F7 check would also
        // take Shift+F7 and move forward instead of back.
        ui.input_mut(|i| {
            let shift_f7 = i.consume_key(egui::Modifiers::SHIFT, Key::F7);
            (i.consume_key(egui::Modifiers::NONE, Key::F7), shift_f7, i.consume_key(egui::Modifiers::NONE, Key::F4))
        })
    } else {
        (false, false, false)
    };
    let (hunks, identical) = tab.model().map_or((0, false), |m| (m.diff.hunks.len(), m.diff.hunks.is_empty() && !m.diff.binary));
    let mut jump = f4;
    egui::Frame::NONE.fill(theme::T.island_bg).inner_margin(egui::Margin::symmetric(8, 3)).show(ui, |ui| {
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 4.0;
            if ui.add_enabled(hunks > 0, egui::Button::new("Prev").small()).on_hover_text("Previous Difference (⇧F7)").clicked() || shift_f7 {
                tab.step(false);
            }
            if ui.add_enabled(hunks > 0, egui::Button::new("Next").small()).on_hover_text("Next Difference (F7)").clicked() || f7 {
                tab.step(true);
            }
            if matches!(tab.source, Source::Worktree { .. }) && ui.add(egui::Button::new("Jump to Source").small()).on_hover_text("F4").clicked() {
                jump = true;
            }
            ui.add_space(8.0);
            let label = if tab.model().is_none() {
                String::new()
            } else if identical {
                "Contents are identical".to_string()
            } else {
                format!("{hunks} difference{}", if hunks == 1 { "" } else { "s" })
            };
            ui.label(RichText::new(label).size(theme::T.font.small).color(theme::T.text_dim));
            if tab.reloading {
                ui.add(egui::Spinner::new().size(theme::T.font.small));
            }
        });
    });
    if jump {
        if let (Source::Worktree { abs, .. }, Some(m)) = (&tab.source, tab.model()) {
            let line = match tab.current {
                Some(h) => m.diff.hunks.get(h).map_or(0, |h| h.new_lines.start),
                None => m.map(tab.t + (tab.view_lines / 3.0).floor(), false) as usize,
            };
            env.commands.push(AppCommand::OpenLocation { path: abs.clone(), pos: Some(Position::new(line.min(m.new.lines.saturating_sub(1)), 0)) });
        }
    }
}

struct Metrics {
    char_w: f32,
    font: FontId,
}

fn body(tab: &mut DiffTab, ui: &mut Ui, theme_e: &EditorTheme, body_id: Id) {
    let font = theme::T.mono_font();
    // The laid-out column step, like the editor (`ide_editor::column_advance`).
    let char_w = ui.fonts(|f| ide_editor::column_advance(f, &font));
    let metrics = Metrics { char_w, font };
    let full = ui.available_rect_before_wrap();
    let title_h = 22.0;
    let area = Rect::from_min_max(pos2(full.min.x, full.min.y + title_h), full.max);
    let resp = ui.interact(area, body_id, Sense::click_and_drag());
    if resp.clicked() || resp.drag_started() {
        resp.request_focus();
    }
    ui.allocate_rect(full, Sense::hover());

    let Load::Ready(model) = &mut tab.load else { return };
    tab.view_lines = (area.height() / LINE_H) as f64;

    // Input: wheel, keys, scrollbar.
    let pane_w = ((area.width() - RIBBON_W - SCROLLBAR_W) / 2.0).max(50.0);
    let left = Rect::from_min_size(area.min, vec2(pane_w, area.height()));
    let ribbon = Rect::from_min_size(pos2(left.max.x, area.min.y), vec2(RIBBON_W, area.height()));
    let right = Rect::from_min_size(pos2(ribbon.max.x, area.min.y), vec2(pane_w, area.height()));
    let bar = Rect::from_min_max(pos2(right.max.x, area.min.y), area.max);

    let hovered = ui.rect_contains_pointer(area);
    let mut dt = 0.0f64;
    if hovered {
        let d = ui.input(|i| i.smooth_scroll_delta);
        dt -= (d.y / LINE_H) as f64;
        tab.hscroll -= d.x;
    }
    if resp.has_focus() {
        ui.input(|i| {
            if i.key_pressed(Key::ArrowDown) {
                dt += 1.0;
            }
            if i.key_pressed(Key::ArrowUp) {
                dt -= 1.0;
            }
            if i.key_pressed(Key::PageDown) {
                dt += tab.view_lines - 2.0;
            }
            if i.key_pressed(Key::PageUp) {
                dt -= tab.view_lines - 2.0;
            }
        });
    }
    let total = model.total.max(1.0);
    let max_t = (model.total - tab.view_lines + 3.0).max(0.0);
    // Scrollbar: click jumps, drag moves the thumb.
    let bar_resp = ui.interact(bar, body_id.with("bar"), Sense::click_and_drag());
    let thumb_h = ((tab.view_lines / total) as f32 * bar.height()).clamp(24.0, bar.height());
    let thumb_range = (bar.height() - thumb_h).max(1.0);
    if let Some(p) = bar_resp.interact_pointer_pos() {
        if bar_resp.drag_started() || bar_resp.clicked() {
            let thumb_y = bar.min.y + (tab.t / max_t.max(1.0)) as f32 * thumb_range;
            let grab = if (thumb_y..thumb_y + thumb_h).contains(&p.y) { p.y - thumb_y } else { thumb_h / 2.0 };
            tab.dragging_thumb = Some(grab);
        }
        if let Some(grab) = tab.dragging_thumb {
            let frac = ((p.y - grab - bar.min.y) / thumb_range).clamp(0.0, 1.0);
            tab.t = frac as f64 * max_t;
            tab.current = None;
        }
    }
    if bar_resp.drag_stopped() || (!bar_resp.dragged() && !bar_resp.clicked()) {
        tab.dragging_thumb = None;
    }
    if bar_resp.hovered() {
        ui.ctx().set_cursor_icon(CursorIcon::Default);
    }
    if dt != 0.0 {
        tab.t += dt;
        tab.current = None;
    }
    if std::mem::take(&mut tab.goto_first) {
        tab.t = 0.0;
        if !model.diff.hunks.is_empty() {
            let v = model.hunk_v0(0);
            if v + 1.0 > tab.view_lines * 0.66 {
                tab.t = v - (tab.view_lines / 3.0).floor();
            }
        }
    }
    tab.t = tab.t.clamp(0.0, max_t);
    let max_cols = model.old.max_cols.max(model.new.max_cols) as f32;
    let gutter_w = |lines: usize| (lines.max(1).to_string().len().max(3) as f32) * char_w + 14.0;
    let text_w = pane_w - gutter_w(model.old.lines.max(model.new.lines));
    tab.hscroll = tab.hscroll.clamp(0.0, (max_cols * char_w - text_w + 3.0 * char_w).max(0.0));

    let painter = ui.painter_at(full);
    painter.rect_filled(full, 0.0, theme_e.background);

    // Titles above each pane.
    let (old_title, new_title) = side_titles(&tab.source, &model.diff);
    let title_l = Rect::from_min_size(full.min, vec2(pane_w, title_h));
    let title_r = Rect::from_min_size(pos2(right.min.x, full.min.y), vec2(pane_w + SCROLLBAR_W, title_h));
    for (r, text) in [(title_l, old_title), (title_r, new_title)] {
        painter.rect_filled(r, 0.0, theme::T.tab_bar_bg);
        painter.text(pos2(r.min.x + 8.0, r.center().y), Align2::LEFT_CENTER, text, theme::T.small_font(), theme::T.text);
    }
    painter.rect_filled(Rect::from_min_size(pos2(left.max.x, full.min.y), vec2(RIBBON_W, title_h)), 0.0, theme::T.tab_bar_bg);
    painter.hline(full.x_range(), area.min.y - 0.5, Stroke::new(1.0_f32, theme::T.border));

    let t = tab.t;
    let top_old = model.map(t, true);
    let top_new = model.map(t, false);
    let gw = gutter_w(model.old.lines.max(model.new.lines));
    draw_pane(&ui.painter_at(left), left, &mut model.old, &model.diff.hunks, top_old, tab.hscroll, gw, &metrics, theme_e, true);
    draw_pane(&ui.painter_at(right), right, &mut model.new, &model.diff.hunks, top_new, tab.hscroll, gw, &metrics, theme_e, false);
    draw_ribbons(&ui.painter_at(ribbon), ribbon, model, top_old, top_new);
    draw_scrollbar(&painter, bar, model, tab.t, max_t, thumb_h, thumb_range, bar_resp.hovered() || tab.dragging_thumb.is_some());

    // A pane may still be parsing in the background; poll until its colors arrive.
    if !model.old.doc.syntax_ready() || !model.new.doc.syntax_ready() {
        ui.ctx().request_repaint_after(std::time::Duration::from_millis(50));
    }
}

fn side_titles(source: &Source, d: &FileDiff) -> (String, String) {
    let old_path = d.old_path.as_ref().unwrap_or(&d.path).display().to_string();
    let new_path = d.path.display().to_string();
    let missing = |exists: bool| if exists { "" } else { "  (does not exist)" };
    match source {
        Source::Worktree { .. } => (format!("HEAD  {old_path}{}", missing(d.old_exists)), format!("Working tree  {new_path}{}", missing(d.new_exists))),
        Source::Commit { oid, .. } => {
            let short = &oid.to_string()[..8];
            (format!("{short}^  {old_path}{}", missing(d.old_exists)), format!("{short}  {new_path}{}", missing(d.new_exists)))
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn draw_pane(painter: &egui::Painter, rect: Rect, pane: &mut Pane, hunks: &[DiffHunk], top: f64, hscroll: f32, gutter_w: f32, m: &Metrics, th: &EditorTheme, old_side: bool) {
    let first = top.floor().max(0.0) as usize;
    let count = (rect.height() / LINE_H).ceil() as usize + 2;
    let last = (first + count).min(pane.lines);
    let y_of = |line: f64| rect.min.y + ((line - top) as f32) * LINE_H;
    let text_x = rect.min.x + gutter_w;
    painter.rect_filled(Rect::from_min_max(rect.min, pos2(text_x - 4.0, rect.max.y)), 0.0, th.gutter_background);

    if !pane.exists && pane.lines == 0 {
        painter.text(rect.center(), Align2::CENTER_CENTER, "File does not exist", theme::T.ui_font(), theme::T.text_dim);
    }

    // Empty-side hunks: a thin line at the gap the ribbon points to.
    for h in hunks {
        let range = if old_side { &h.old_lines } else { &h.new_lines };
        if range.is_empty() {
            let y = y_of(range.start as f64);
            if y >= rect.min.y - 2.0 && y <= rect.max.y + 2.0 {
                painter.hline(rect.x_range(), y, Stroke::new(1.0_f32, HunkKind::of(h).edge()));
            }
        }
    }
    if first >= last {
        return;
    }
    pane.ensure_spans(first..last);
    let text_clip = Rect::from_min_max(pos2(text_x, rect.min.y), rect.max);
    let text_painter = painter.with_clip_rect(text_clip.intersect(painter.clip_rect()));
    for line in first..last {
        let y = y_of(line as f64);
        let row = Rect::from_min_size(pos2(rect.min.x, y), vec2(rect.width(), LINE_H));
        let hunk = pane.hunk_of[line];
        let kind = (hunk != u32::MAX).then(|| HunkKind::of(&hunks[hunk as usize]));
        if let Some(k) = kind {
            painter.rect_filled(row, 0.0, k.bg());
            // Edges at the hunk boundaries, like IDEA's thin outline.
            let h = &hunks[hunk as usize];
            let range = if old_side { &h.old_lines } else { &h.new_lines };
            if line == range.start {
                painter.hline(rect.x_range(), y, Stroke::new(1.0_f32, k.edge()));
            }
            if line + 1 == range.end {
                painter.hline(rect.x_range(), y + LINE_H, Stroke::new(1.0_f32, k.edge()));
            }
        }
        painter.text(pos2(text_x - 10.0, y + LINE_H / 2.0), Align2::RIGHT_CENTER, (line + 1).to_string(), theme::T.mono_small_font(), th.line_number);

        let text = pane.doc.line(line);
        let x0 = text_x - hscroll;
        let spans = pane.spans[line].as_deref().unwrap_or(&[]);
        let job = line_job(&text, spans, m, th);
        let galley = text_painter.layout_job(job);
        if let (Some(k), Some(ranges)) = (kind, pane.inline.get(&line)) {
            // X from the galley itself: glyph advances are rounded to pixels, so a constant
            // char width drifts by a column over a long line.
            let x_at = |col: usize| -> f32 {
                let c = display_col(&text, col);
                galley.pos_from_ccursor(egui::text::CCursor::new(c)).min.x
            };
            for r in ranges {
                let a = x_at(r.start);
                let b = x_at(r.end).max(a + m.char_w * 0.5);
                let wr = Rect::from_min_max(pos2(x0 + a, y + 1.0), pos2(x0 + b, y + LINE_H - 1.0));
                text_painter.rect_filled(wr, 2.0, k.word());
            }
        }
        text_painter.galley(pos2(x0, y + (LINE_H - galley.size().y) / 2.0), galley, th.foreground);
    }
}

/// Display column of char column `col`: tabs are shown as 4 spaces.
fn display_col(text: &str, col: usize) -> usize {
    text.chars().take(col).map(|c| if c == '\t' { 4 } else { 1 }).sum()
}

fn line_job(text: &str, spans: &[Span], m: &Metrics, th: &EditorTheme) -> LayoutJob {
    let mut job = LayoutJob { break_on_newline: false, ..Default::default() };
    let cut = text.char_indices().nth(MAX_COLS).map_or(text.len(), |(i, _)| i);
    let text = &text[..cut];
    let push = |job: &mut LayoutJob, s: &str, kind: HlKind| {
        if s.is_empty() {
            return;
        }
        let fmt = TextFormat { font_id: m.font.clone(), color: th.color(kind), ..Default::default() };
        if s.contains('\t') {
            job.append(&s.replace('\t', "    "), 0.0, fmt);
        } else {
            job.append(s, 0.0, fmt);
        }
    };
    let mut at = 0usize;
    for sp in spans {
        let (s, e) = (sp.start as usize, (sp.end as usize).min(text.len()));
        if s < at || s >= e || !text.is_char_boundary(s) || !text.is_char_boundary(e) {
            continue;
        }
        push(&mut job, &text[at..s], HlKind::None);
        push(&mut job, &text[s..e], sp.kind);
        at = e;
    }
    push(&mut job, &text[at..], HlKind::None);
    job
}

fn draw_ribbons(painter: &egui::Painter, rect: Rect, m: &Model, top_old: f64, top_new: f64) {
    let y_old = |l: usize| rect.min.y + ((l as f64 - top_old) as f32) * LINE_H;
    let y_new = |l: usize| rect.min.y + ((l as f64 - top_new) as f32) * LINE_H;
    let (x0, x1) = (rect.min.x, rect.max.x);
    for h in &m.diff.hunks {
        let (a0, a1) = (y_old(h.old_lines.start), y_old(h.old_lines.end));
        let (b0, b1) = (y_new(h.new_lines.start), y_new(h.new_lines.end));
        if a1.max(b1) < rect.min.y - 2.0 || a0.min(b0) > rect.max.y + 2.0 {
            continue;
        }
        let kind = HunkKind::of(h);
        // Smoothstep curves between the sides; a mesh because the band is not convex.
        let steps = 16;
        let mut mesh = Mesh::default();
        let mut top_pts = Vec::with_capacity(steps + 1);
        let mut bot_pts = Vec::with_capacity(steps + 1);
        for i in 0..=steps {
            let f = i as f32 / steps as f32;
            let s = f * f * (3.0 - 2.0 * f);
            let x = x0 + (x1 - x0) * f;
            let yt = a0 + (b0 - a0) * s;
            let yb = (a1 + (b1 - a1) * s).max(yt + 0.01);
            top_pts.push(pos2(x, yt));
            bot_pts.push(pos2(x, yb));
            mesh.colored_vertex(pos2(x, yt), kind.bg());
            mesh.colored_vertex(pos2(x, yb), kind.bg());
            if i > 0 {
                let k = (i as u32) * 2;
                mesh.add_triangle(k - 2, k - 1, k);
                mesh.add_triangle(k - 1, k, k + 1);
            }
        }
        painter.add(Shape::mesh(mesh));
        painter.add(Shape::line(top_pts, Stroke::new(1.0_f32, kind.edge())));
        painter.add(Shape::line(bot_pts, Stroke::new(1.0_f32, kind.edge())));
    }
}

#[allow(clippy::too_many_arguments)]
fn draw_scrollbar(painter: &egui::Painter, bar: Rect, m: &Model, t: f64, max_t: f64, thumb_h: f32, thumb_range: f32, active: bool) {
    painter.rect_filled(bar, 0.0, theme::T.scrollbar_track);
    let total = m.total.max(1.0);
    // Change markers along the track, like IDEA's error stripe.
    for (hi, h) in m.diff.hunks.iter().enumerate() {
        let v = m.hunk_v0(hi);
        let len = h.old_lines.len().max(h.new_lines.len()).max(1) as f64;
        let y0 = bar.min.y + (v / total) as f32 * bar.height();
        let y1 = (bar.min.y + ((v + len) / total) as f32 * bar.height()).max(y0 + 2.0);
        painter.rect_filled(Rect::from_min_max(pos2(bar.min.x + 3.0, y0), pos2(bar.max.x - 3.0, y1)), 0.0, HunkKind::of(h).edge());
    }
    let thumb_y = bar.min.y + (t / max_t.max(1.0)) as f32 * thumb_range;
    let thumb = Rect::from_min_size(pos2(bar.min.x + 1.0, thumb_y), vec2(bar.width() - 2.0, thumb_h));
    let c = if active { theme::T.scrollbar_thumb_active } else { theme::T.scrollbar_thumb };
    painter.rect_filled(thumb, 3.0, c);
}


// ---------------------------------------------------------------------------------------------
// Opening and loading.

fn rel_and_abs(repo: &Repo, path: &Path) -> (PathBuf, PathBuf) {
    let workdir = repo.workdir();
    if path.is_absolute() {
        // Callers pass canonical paths (editor tabs, the change list, the workdir join), so
        // no canonicalize here: it would touch the disk on the UI thread.
        let rel = path.strip_prefix(workdir).map(Path::to_path_buf).unwrap_or_else(|_| path.to_path_buf());
        (rel, path.to_path_buf())
    } else {
        (path.to_path_buf(), workdir.join(path))
    }
}

/// Opens (or focuses) a diff tab: HEAD vs the working tree for `path`.
pub fn open_worktree_diff(state: &mut AppState, path: &Path) {
    let Some(repo) = state.git.repo.clone() else { return };
    let (rel, abs) = rel_and_abs(&repo, path);
    open(state, Source::Worktree { abs, rel });
}

/// Opens (or focuses) a diff tab for `path` as changed by commit `oid` (parent vs commit).
pub fn open_commit_diff(state: &mut AppState, oid: ide_git::Oid, path: &Path) {
    let Some(repo) = state.git.repo.clone() else { return };
    let (rel, abs) = rel_and_abs(&repo, path);
    open(state, Source::Commit { oid, rel, abs });
}

fn open(state: &mut AppState, source: Source) {
    let tab = DiffTab::new(source.clone());
    let key = tab.key.clone();
    if state.tabs.custom_by_key(&key).is_some() {
        state.tabs.open_custom(Box::new(tab));
        reload(state, &key);
        return;
    }
    state.tabs.open_custom(Box::new(tab));
    reload(state, &key);
}

/// The unsaved editor buffer for a worktree diff, so the diff shows what the user sees.
fn buffer_text(state: &AppState, source: &Source) -> Option<String> {
    let Source::Worktree { abs, .. } = source else { return None };
    state.tabs.editors().find(|e| &e.path == abs && e.doc.is_dirty()).map(|e| e.doc.text())
}

fn reload(state: &mut AppState, key: &str) {
    let Some(repo) = state.git.repo.clone() else { return };
    let Some(tab) = state.tabs.custom_mut::<DiffTab>(key) else { return };
    if tab.reloading {
        tab.reload_pending = true;
        return;
    }
    tab.reloading = true;
    let source = tab.source.clone();
    let prev_texts = tab.model().map(|m| (m.diff.old_text.clone(), m.new_text.clone()));
    let buffer = buffer_text(state, &source);
    let key = key.to_string();
    let label = format!("Loading diff of {}", name_of(match &source {
        Source::Worktree { rel, .. } | Source::Commit { rel, .. } => rel,
    }));
    state.jobs.spawn(
        label,
        move || {
            let diff = match &source {
                Source::Worktree { rel, .. } => repo.diff_file(rel, DiffSide::HeadVsWorktree),
                Source::Commit { oid, rel, .. } => repo.diff_commit_file(oid, rel),
            };
            match diff {
                Ok(d) => {
                    let new_text = buffer.as_ref().unwrap_or(&d.new_text);
                    if prev_texts.as_ref().is_some_and(|(o, n)| *o == d.old_text && n == new_text) {
                        return Ok(None);
                    }
                    Ok(Some(Model::build(d, buffer)))
                }
                Err(e) => Err(e.to_string()),
            }
        },
        move |state, res: Result<Option<Model>, String>| {
            let Some(tab) = state.tabs.custom_mut::<DiffTab>(&key) else { return };
            tab.reloading = false;
            match res {
                Ok(Some(m)) => tab.set_model(m),
                Ok(None) => {}
                Err(e) => {
                    if !matches!(tab.load, Load::Ready(_)) {
                        tab.load = Load::Failed(e);
                    }
                }
            }
            if std::mem::take(&mut tab.reload_pending) {
                reload(state, &key);
            }
        },
    );
}

/// Worktree diffs follow the file: every status refresh (after saves and external edits)
/// re-reads them. Unchanged texts are detected on the worker and cost no UI work.
pub fn on_git_refreshed(state: &mut AppState) {
    let keys: Vec<String> = state
        .tabs
        .list
        .iter_mut()
        .filter_map(|t| match &mut t.content {
            crate::tabs::TabContent::Custom(c) => c.as_any_mut().downcast_mut::<DiffTab>().filter(|d| matches!(d.source, Source::Worktree { .. })).map(|d| d.key.clone()),
            _ => None,
        })
        .collect();
    for key in keys {
        reload(state, &key);
    }
}

/// Test hook: presses F7 `n` times on the active diff tab and logs where it landed.
pub fn test_next(state: &mut AppState, n: usize) {
    let Some(id) = state.tabs.active else { return };
    let Some(crate::tabs::TabContent::Custom(c)) = state.tabs.get_mut(id).map(|t| &mut t.content) else { return };
    let Some(tab) = c.as_any_mut().downcast_mut::<DiffTab>() else { return };
    for _ in 0..n {
        tab.step(true);
    }
    match &tab.load {
        Load::Ready(_) => {}
        _ => eprintln!("[test] diff {}: not loaded", tab.rel().display()),
    }
    if let Some(m) = tab.model() {
        eprintln!("[test] diff {}: {} hunks, {} / {} lines, current {:?}, t {:.1}, view {:.1}, hunk starts {:?}", tab.rel().display(), m.diff.hunks.len(), m.old.lines, m.new.lines, tab.current, tab.t, tab.view_lines, (0..m.diff.hunks.len()).map(|h| m.hunk_v0(h)).collect::<Vec<_>>());
    }
}
