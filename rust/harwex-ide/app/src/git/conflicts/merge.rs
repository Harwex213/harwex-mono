//! Three-pane merge tab (IDEA's Merge Revisions): the left side, the result and the right side,
//! each one a real editor (`EditorView`), with ribbons and the >> / << buttons between them.
//!
//! The file is cut into chunks with a diff3-style sweep over base->ours and base->theirs
//! hunks. The result pane edits the file's own editor tab (`CustomTab::shared_editor`), so it
//! gets the same highlighting, language server sync and diagnostics as a normal tab. The
//! result starts as the base text plus the identical changes (`Document::reset_text`, no undo
//! back to git's markers); the non-conflicting changes are then applied as one undo step, so
//! Cmd+Z takes them back and their buttons return. Every chunk keeps its range in the result
//! as chars and follows each edit (`Document::changes_since`, `map_range`), so free edits
//! anywhere never break the markers. Unchanged runs fold in all three panes.

use std::any::Any;
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::time::Instant;

use egui::{pos2, vec2, Align, Align2, Color32, Layout, Rect, RichText, Sense, Shape, Stroke, Ui, UiBuilder};
use ide_editor::{Document, EditKind, EditorState, EditorView, Fold, Language, LineBand, Selection, TextChange, ViewState};
use ide_git::ConflictSides;

use crate::icons::{self, Icon};
use crate::state::{AppCommand, TabEnv};
use crate::tabs::{CustomTab, EditorTab};
use crate::theme;

/// Unchanged runs longer than this fold, keeping `CONTEXT` lines on each side.
const FOLD_OVER: usize = 12;
const CONTEXT: usize = 3;
/// The strip between two panes: ribbons and the >> / << buttons.
const DIVIDER_W: f32 = 40.0;
const LEFT: usize = 0;
const RIGHT: usize = 1;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    Same,
    /// Only the left side changed this region.
    Ours,
    /// Only the right side changed this region.
    Theirs,
    /// Both sides made the same change; the result has it from the start.
    Both,
    Conflict,
}

impl Kind {
    fn changes(self, side: usize) -> bool {
        match self {
            Kind::Same => false,
            Kind::Ours => side == LEFT,
            Kind::Theirs => side == RIGHT,
            Kind::Both | Kind::Conflict => true,
        }
    }
}

/// A block of the diff3 sweep, before it becomes a chunk or an unchanged run.
struct Block {
    kind: Kind,
    ours: String,
    theirs: String,
    base: String,
}

struct Chunk {
    kind: Kind,
    /// The chunk's lines in the left and the right document.
    lines: [Range<usize>; 2],
    texts: [String; 2],
    base: String,
    /// The chunk in the result document, in chars. It follows every edit.
    res: Range<usize>,
    /// The result texts right after a side was applied, newest last. The side counts as
    /// applied while the chunk holds one of them, so an undo brings its button back and an
    /// undo of a second side keeps the first one applied.
    applied: [Vec<String>; 2],
    /// Derived from the text at `MergeTab::version`.
    shown: [bool; 2],
    resolved: bool,
}

/// A read-only side pane.
struct SidePane {
    doc: Document,
    view: EditorState,
}

pub struct MergeTab {
    /// Relative to the workdir; the key and the path git resolves.
    rel: PathBuf,
    /// Canonical; the editor tab the result edits.
    abs: PathBuf,
    labels: [&'static str; 2],
    sides: [SidePane; 2],
    result_view: EditorState,
    chunks: Vec<Chunk>,
    /// Per unchanged run (chunks + 1 of them): the user opened its fold.
    expanded: Vec<bool>,
    /// The result version the chunk ranges follow.
    version: u64,
    /// The result version right after the merge set it up; a later one is a user edit.
    init_version: u64,
    initial: String,
    /// The file as git left it (with the conflict markers), for Cancel.
    original: Vec<u8>,
    /// The merge opened the editor tab, so it closes it again.
    opened_editor: bool,
    /// Saved and resolved, or cancelled: closing does nothing more.
    done: bool,
    saving: bool,
    confirm_unresolved: bool,
    save_requested: bool,
    /// The scroll state of each pane (left, result, right) at the end of the last frame.
    last_views: [Option<ViewState>; 3],
    /// Problem underlines the result pane drew last frame (tests).
    result_problems: usize,
}

impl MergeTab {
    pub fn new(sides: ConflictSides, labels: (&'static str, &'static str), abs: PathBuf, original: Vec<u8>, opened_editor: bool) -> MergeTab {
        // The editor keeps `\n` only; CRLF comes back on save.
        let norm = |s: Option<String>| s.unwrap_or_default().replace("\r\n", "\n");
        let (base, ours, theirs) = (norm(sides.base), norm(sides.ours), norm(sides.theirs));
        let blocks = build_blocks(&base, &ours, &theirs);
        let lang = Language::from_path(&abs);
        let side = |text: &str| SidePane { doc: Document::from_text(text, lang), view: EditorState::new() };
        let mut chunks = Vec::new();
        let mut initial = String::new();
        let (mut lo, mut lt, mut chars) = (0usize, 0usize, 0usize);
        for b in blocks {
            let (no, nt) = (b.ours.split_inclusive('\n').count(), b.theirs.split_inclusive('\n').count());
            let start_text = match b.kind {
                Kind::Same | Kind::Both => b.ours.clone(),
                _ => b.base.clone(),
            };
            let n = start_text.chars().count();
            if b.kind != Kind::Same {
                chunks.push(Chunk {
                    kind: b.kind,
                    lines: [lo..lo + no, lt..lt + nt],
                    texts: [b.ours, b.theirs],
                    base: b.base,
                    res: chars..chars + n,
                    applied: [Vec::new(), Vec::new()],
                    shown: [false, false],
                    resolved: b.kind != Kind::Conflict,
                });
            }
            initial.push_str(&start_text);
            chars += n;
            lo += no;
            lt += nt;
        }
        let expanded = vec![false; chunks.len() + 1];
        MergeTab {
            rel: sides.path,
            abs,
            labels: [labels.0, labels.1],
            sides: [side(&ours), side(&theirs)],
            result_view: EditorState::new(),
            chunks,
            expanded,
            version: 0,
            init_version: 0,
            initial,
            original,
            opened_editor,
            done: false,
            saving: false,
            confirm_unresolved: false,
            save_requested: false,
            last_views: [None; 3],
            result_problems: 0,
        }
    }

    /// Sets up the result in the file's document: the base text plus identical changes as the
    /// new undo start, then every non-conflicting change as one undo step.
    pub fn init(&mut self, doc: &mut Document) {
        doc.reset_text(&self.initial);
        self.version = doc.version();
        self.refresh(doc);
        let picks: Vec<(usize, usize)> = self
            .chunks
            .iter()
            .enumerate()
            .filter_map(|(i, c)| match c.kind {
                Kind::Ours => Some((i, LEFT)),
                Kind::Theirs => Some((i, RIGHT)),
                _ => None,
            })
            .collect();
        self.apply(doc, &picks, true);
        self.init_version = doc.version();
    }

    pub fn path(&self) -> &Path {
        &self.rel
    }

    /// The next frame saves, as if the button was pressed (the save needs the lent editor).
    pub fn request_save(&mut self) {
        self.save_requested = true;
    }

    fn unresolved(&self) -> usize {
        self.chunks.iter().filter(|c| c.kind == Kind::Conflict && !c.resolved).count()
    }

    /// Follows the edits since the last frame and recomputes the chunk states.
    fn follow(&mut self, doc: &Document) {
        if self.version == doc.version() {
            return;
        }
        match doc.changes_since(self.version) {
            Some(changes) => {
                for ch in &changes {
                    for c in &mut self.chunks {
                        c.res = map_range(c.res.clone(), ch);
                    }
                }
            }
            None => {
                let len = doc.len_chars();
                for c in &mut self.chunks {
                    c.res = c.res.start.min(len)..c.res.end.min(len);
                }
            }
        }
        self.version = doc.version();
        self.refresh(doc);
    }

    fn refresh(&mut self, doc: &Document) {
        for c in &mut self.chunks {
            let cur = doc.slice(c.res.clone());
            for s in [LEFT, RIGHT] {
                let explicit = c.applied[s].contains(&cur);
                // A conflict side counts only when applied; another chunk shows its side's text.
                c.shown[s] = c.kind.changes(s) && (explicit || (c.kind != Kind::Conflict && cur == c.texts[s]));
            }
            c.resolved = match c.kind {
                Kind::Same | Kind::Both => true,
                Kind::Ours => c.shown[LEFT],
                Kind::Theirs => c.shown[RIGHT],
                Kind::Conflict => c.shown[LEFT] || c.shown[RIGHT] || cur != c.base,
            };
        }
    }

    /// Applies chunk sides to the result as one undo step. `append` keeps an applied other
    /// side of a conflict and adds this one after it (IDEA's arrows); without it the side
    /// replaces the chunk (Accept Left / Right).
    fn apply(&mut self, doc: &mut Document, picks: &[(usize, usize)], append: bool) {
        self.follow(doc);
        let mut picks = picks.to_vec();
        // Bottom-up: each range still refers to the text the previous edit produced.
        picks.sort_by_key(|&(i, _)| std::cmp::Reverse(self.chunks[i].res.start));
        let mut edits = Vec::new();
        let mut marks = Vec::new();
        for &(i, side) in &picks {
            let c = &self.chunks[i];
            let both = append && c.kind == Kind::Conflict && c.shown[1 - side];
            let text = if both {
                let mut s = doc.slice(c.res.clone());
                if !s.is_empty() && !s.ends_with('\n') {
                    s.push('\n');
                }
                s.push_str(&c.texts[side]);
                s
            } else {
                c.texts[side].clone()
            };
            edits.push((c.res.clone(), text.clone()));
            marks.push((i, side, text, both));
        }
        let Some(first) = edits.last().map(|e| e.0.start) else { return };
        doc.seal_undo_group();
        doc.transact(edits, Selection::caret(first), Selection::caret(first), EditKind::Other);
        doc.seal_undo_group();
        self.follow(doc);
        for (i, side, text, both) in marks {
            let c = &mut self.chunks[i];
            if both {
                remember(&mut c.applied[1 - side], text.clone());
            }
            remember(&mut c.applied[side], text);
        }
        self.refresh(doc);
    }

    /// Test hook: Accept Left or Accept Right.
    pub(crate) fn test_take_all(&mut self, doc: &mut Document, theirs: bool) {
        self.take_all(doc, usize::from(theirs));
    }

    /// Accept Left / Accept Right: every changed chunk takes that side.
    fn take_all(&mut self, doc: &mut Document, side: usize) {
        let picks: Vec<(usize, usize)> = (0..self.chunks.len()).filter(|&i| self.chunks[i].kind != Kind::Both).map(|i| (i, side)).collect();
        self.apply(doc, &picks, false);
    }

    /// Applies every non-conflicting change that is not in the result yet.
    fn apply_non_conflicting(&mut self, doc: &mut Document) {
        self.follow(doc);
        let picks: Vec<(usize, usize)> = self
            .chunks
            .iter()
            .enumerate()
            .filter_map(|(i, c)| match c.kind {
                Kind::Ours if !c.shown[LEFT] => Some((i, LEFT)),
                Kind::Theirs if !c.shown[RIGHT] => Some((i, RIGHT)),
                _ => None,
            })
            .collect();
        self.apply(doc, &picks, true);
    }

    fn save(&mut self, env: &mut TabEnv, e: &mut EditorTab) {
        let Some(repo) = env.git.repo.clone() else { return };
        self.saving = true;
        let (text, token) = e.doc.save_snapshot();
        let rel = self.rel.clone();
        let abs = self.abs.clone();
        let key = self.key();
        let opened = self.opened_editor;
        env.jobs.spawn(
            format!("Resolving {}", rel.display()),
            move || repo.resolve(&rel, &text).map(|_| None),
            move |state, res| {
                let title = "Merge conflict resolved";
                let ok = crate::git::remote::report(state, title, &format!("{} saved and staged", key.trim_start_matches("merge:")), res);
                crate::git::refresh::changed(state);
                let Some(tab) = state.ws.tabs.custom_mut::<MergeTab>(&key) else { return };
                if !ok {
                    tab.saving = false;
                    return;
                }
                tab.done = true;
                let editor = state.ws.tabs.editor_by_path(&abs);
                if let Some(e) = editor.and_then(|id| state.ws.tabs.editor_mut(id)) {
                    e.doc.mark_saved(token);
                }
                if let Some(id) = state.ws.tabs.custom_by_key(&key) {
                    state.close_tab(id, true);
                }
                if let Some(id) = editor.filter(|_| opened) {
                    state.close_tab(id, false);
                }
                super::merge_saved(state);
            },
        );
    }

    /// Cancel and closing without a save: the document and the file go back to git's
    /// conflict text, and an editor tab the merge opened closes.
    fn discard(&mut self, env: &mut TabEnv) {
        if std::mem::replace(&mut self.done, true) {
            return;
        }
        if let Some((id, e)) = env.editor.as_mut() {
            e.doc.reload_from_bytes(&self.original);
            let (_, token) = e.doc.save_snapshot();
            e.doc.mark_saved(token);
            e.last_edit = Instant::now();
            if self.opened_editor {
                env.commands.push(AppCommand::CloseTab(*id));
            }
        }
        // An idle or focus-loss save may have written the result meanwhile.
        let abs = self.abs.clone();
        let bytes = std::mem::take(&mut self.original);
        env.jobs.spawn_quiet(
            move || {
                if std::fs::read(&abs).ok().as_deref() != Some(&bytes[..]) {
                    let _ = std::fs::write(&abs, &bytes);
                }
            },
            |_, _| {},
        );
    }

    /// The result lines of each chunk, for tests: (left lines, result lines, right lines).
    pub fn chunk_lines(&self, doc: &Document) -> Vec<[Range<usize>; 3]> {
        self.chunks.iter().map(|c| [c.lines[LEFT].clone(), res_lines(doc, &c.res), c.lines[RIGHT].clone()]).collect()
    }

    /// Per chunk: is each side shown as applied, and is the chunk resolved (tests).
    pub fn chunk_states(&self) -> Vec<([bool; 2], bool)> {
        self.chunks.iter().map(|c| (c.shown, c.resolved)).collect()
    }

    pub fn result_view(&self) -> &EditorState {
        &self.result_view
    }

    pub fn side_view(&self, right: bool) -> &EditorState {
        &self.sides[usize::from(right)].view
    }

    pub fn side_doc(&self, right: bool) -> &Document {
        &self.sides[usize::from(right)].doc
    }

    pub fn result_problems(&self) -> usize {
        self.result_problems
    }

    /// Line ranges of the three panes, chunk by chunk: unchanged run 0, chunk 0, run 1, ...
    fn segments(&self, doc: &Document) -> Vec<[Range<usize>; 3]> {
        let counts = [self.sides[LEFT].doc.line_count(), doc.line_count(), self.sides[RIGHT].doc.line_count()];
        let mut out = Vec::with_capacity(self.chunks.len() * 2 + 1);
        let mut at = [0usize; 3];
        for c in &self.chunks {
            let r = [c.lines[LEFT].clone(), res_lines(doc, &c.res), c.lines[RIGHT].clone()];
            out.push(std::array::from_fn(|p| at[p]..r[p].start.max(at[p])));
            at = std::array::from_fn(|p| r[p].end.max(at[p]));
            out.push(r);
        }
        out.push(std::array::from_fn(|p| at[p]..counts[p].max(at[p])));
        out
    }

    /// The folds of pane `p`: the unchanged runs the user did not open, with their run index.
    fn folds(&self, segs: &[[Range<usize>; 3]], p: usize) -> Vec<(usize, Fold)> {
        let mut out = Vec::new();
        for (run, seg) in segs.iter().step_by(2).enumerate() {
            let r = &seg[p];
            if self.expanded[run] || r.len() <= FOLD_OVER {
                continue;
            }
            let lines = r.start + CONTEXT..r.end - CONTEXT;
            let label = format!("{} unchanged lines", lines.len());
            out.push((run, Fold { lines, label }));
        }
        out
    }
}

/// Adds an applied text; a short list is enough for undo and redo around the last applies.
fn remember(list: &mut Vec<String>, text: String) {
    list.retain(|t| *t != text);
    list.push(text);
    if list.len() > 8 {
        list.remove(0);
    }
}

/// Maps a chunk's char range through one change. A change that starts at the chunk's start
/// goes inside it (applying a side to an empty chunk grows it); one that starts at its end
/// stays outside, so typing on the next line never joins the chunk.
fn map_range(r: Range<usize>, ch: &TextChange) -> Range<usize> {
    let (cs, ce, n) = (ch.start, ch.start + ch.removed, ch.inserted);
    // Only for indices at or past the change's end.
    let shift = |x: usize| x + n - (ce - cs);
    if ce < r.start || (ce == r.start && cs < r.start) {
        return shift(r.start)..shift(r.end);
    }
    if cs > r.end || (cs == r.end && r.start < r.end) {
        return r;
    }
    let s = r.start.min(cs);
    let e = if ce >= r.end { cs + n } else { r.end + n - (ce - cs) };
    s..e.max(s)
}

/// The lines a result chunk covers. An empty chunk is an empty range at its line.
fn res_lines(doc: &Document, r: &Range<usize>) -> Range<usize> {
    let a = doc.char_to_position(r.start.min(doc.len_chars())).line;
    if r.is_empty() {
        return a..a;
    }
    let end = doc.char_to_position(r.end.min(doc.len_chars()));
    let b = if end.column == 0 { end.line } else { end.line + 1 };
    a..b.max(a)
}

/// Maps a fractional line of pane `from` to pane `to` through the segments: the same offset in
/// an unchanged run, the same share inside a chunk.
fn map_line(segs: &[[Range<usize>; 3]], from: usize, to: usize, line: f32) -> f32 {
    for seg in segs {
        let (f, t) = (&seg[from], &seg[to]);
        if f.is_empty() || line >= f.end as f32 {
            continue;
        }
        let share = ((line - f.start as f32) / f.len() as f32).clamp(0.0, 1.0);
        return t.start as f32 + share * t.len() as f32;
    }
    segs.last().map_or(0.0, |s| s[to].end as f32)
}

impl CustomTab for MergeTab {
    fn key(&self) -> String {
        format!("merge:{}", self.rel.display())
    }

    fn title(&self) -> String {
        let name = self.rel.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        format!("Merge: {name}")
    }

    fn tooltip(&self) -> String {
        format!("Merge conflicts in {}", self.rel.display())
    }

    fn is_dirty(&self) -> bool {
        !self.done && self.version != self.init_version
    }

    fn file_path(&self) -> Option<PathBuf> {
        Some(self.abs.clone())
    }

    fn shared_editor(&self) -> Option<PathBuf> {
        Some(self.abs.clone())
    }

    fn on_close(&mut self, env: &mut TabEnv) {
        self.discard(env);
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }

    fn ui(&mut self, ui: &mut Ui, env: &mut TabEnv) {
        let Some((eid, e)) = env.editor.take() else {
            ui.add_space(20.0);
            ui.horizontal(|ui| {
                ui.add_space(20.0);
                ui.label(RichText::new(format!("The editor tab of {} was closed, so the merge result is gone. Close this tab and open the merge again.", self.rel.display())).color(theme::T.warning));
            });
            return;
        };
        self.follow(&e.doc);
        if std::mem::take(&mut self.save_requested) && !self.saving {
            self.save(env, e);
        }
        let left_n = self.unresolved();
        let action = header(ui, self, left_n);
        match action {
            Some(Header::Accept(side)) => {
                self.take_all(&mut e.doc, side);
                e.last_edit = Instant::now();
            }
            Some(Header::NonConflicting) => {
                self.apply_non_conflicting(&mut e.doc);
                e.last_edit = Instant::now();
            }
            Some(Header::Save) if left_n > 0 => self.confirm_unresolved = true,
            Some(Header::Save) => self.save(env, e),
            Some(Header::Cancel) => {
                // `discard` reads the lent editor from `env`.
                env.editor = Some((eid, e));
                self.cancel(env);
                return;
            }
            None => {}
        }
        if self.confirm_unresolved {
            ui.horizontal(|ui| {
                ui.add_space(8.0);
                ui.label(RichText::new(format!("{left_n} conflict(s) are not resolved; the result keeps the base text there. Save anyway?")).color(theme::T.warning));
                if ui.button("Save").clicked() {
                    self.confirm_unresolved = false;
                    self.save(env, e);
                }
                if ui.button("Keep editing").clicked() {
                    self.confirm_unresolved = false;
                }
            });
        }
        body(ui, self, env, e);
    }
}

enum Header {
    Accept(usize),
    NonConflicting,
    Save,
    Cancel,
}

impl MergeTab {
    fn cancel(&mut self, env: &mut TabEnv) {
        self.discard(env);
        env.commands.push(AppCommand::CloseTab(env.tab_id));
    }
}

/// The path, the conflict count and the buttons. The buttons are laid out first from the
/// right, so they always stay; the path gets the rest and loses its middle (`cut_path`).
fn header(ui: &mut Ui, tab: &MergeTab, left_n: usize) -> Option<Header> {
    let mut out = None;
    let h = 28.0;
    ui.add_space(4.0);
    let width = ui.available_width();
    ui.allocate_ui_with_layout(vec2(width, h), Layout::right_to_left(Align::Center), |ui| {
        ui.set_min_size(vec2(width, h));
        ui.add_space(8.0);
        if tab.saving {
            ui.spinner();
        }
        ui.add_enabled_ui(!tab.saving, |ui| {
            if ui.button("Cancel").clicked() {
                out = Some(Header::Cancel);
            }
            if ui.button("Save and Mark Resolved").clicked() {
                out = Some(Header::Save);
            }
        });
        ui.separator();
        if ui.button(format!("Accept {}", tab.labels[RIGHT])).on_hover_text("Take the right side for every changed block").clicked() {
            out = Some(Header::Accept(RIGHT));
        }
        if ui.button(format!("Accept {}", tab.labels[LEFT])).on_hover_text("Take the left side for every changed block").clicked() {
            out = Some(Header::Accept(LEFT));
        }
        let pending = tab.chunks.iter().any(|c| matches!(c.kind, Kind::Ours | Kind::Theirs) && !c.resolved);
        if ui.add_enabled(pending, egui::Button::new("Apply Non-Conflicting")).on_hover_text("Apply every change that has no conflict").clicked() {
            out = Some(Header::NonConflicting);
        }
        ui.separator();
        // The rest of the row, left to right: the path, then the count right after it.
        ui.with_layout(Layout::left_to_right(Align::Center), |ui| {
            ui.add_space(8.0);
            let status = if left_n == 0 { "All conflicts resolved".to_string() } else { format!("{left_n} conflict(s) left") };
            let status_color = if left_n == 0 { theme::T.git_added } else { theme::T.warning };
            let status_w = ui.fonts(|f| f.layout_no_wrap(status.clone(), theme::T.ui_font(), status_color).size().x);
            let gap = ui.spacing().item_spacing.x;
            let room = (ui.available_width() - status_w - gap - 4.0).max(0.0);
            path_label(ui, &tab.rel.display().to_string(), room);
            ui.label(RichText::new(status).color(status_color));
        });
    });
    out
}

/// The file path, cut in the middle to `room` points with the file name kept; the whole path
/// is the a11y name and the hover text.
fn path_label(ui: &mut Ui, full: &str, room: f32) {
    let font = theme::T.ui_font();
    let color = theme::T.text_bright;
    let width = |s: &str| ui.fonts(|f| f.layout_no_wrap(s.to_string(), font.clone(), color).size().x);
    let shown = cut_path(full, |s| width(s) <= room);
    let galley = ui.fonts(|f| f.layout_no_wrap(shown.clone(), font.clone(), color));
    let (rect, resp) = ui.allocate_exact_size(vec2(galley.size().x.min(room.max(0.0)), galley.size().y), Sense::hover());
    ui.painter_at(rect).galley(rect.min, galley, color);
    crate::util::label_widget(&resp, egui::WidgetType::Label, format!("Merge path {full}"));
    if shown != full {
        resp.on_hover_text(full);
    }
}

/// `full` cut in the middle of its folder part until `fits`, the file name kept whole; a name
/// that alone does not fit loses its own middle, the extension kept.
fn cut_path(full: &str, fits: impl Fn(&str) -> bool) -> String {
    if fits(full) {
        return full.to_string();
    }
    let (dir, name) = match full.rfind('/') {
        Some(i) => full.split_at(i + 1),
        None => ("", full),
    };
    let dir: Vec<char> = dir.chars().collect();
    let with = |k: usize| -> String {
        let head = k / 2;
        let tail = k - head;
        let mut s: String = dir[..head].iter().collect();
        s.push('…');
        s.extend(&dir[dir.len() - tail..]);
        s.push_str(name);
        s
    };
    // The widest `k` (kept folder chars) that fits.
    let (mut lo, mut hi) = (0usize, dir.len().saturating_sub(1));
    if !dir.is_empty() && fits(&with(0)) {
        while lo < hi {
            let mid = (lo + hi).div_ceil(2);
            if fits(&with(mid)) {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        return with(lo);
    }
    let chars: Vec<char> = name.chars().collect();
    let ext = chars.iter().rposition(|&c| c == '.').filter(|&i| i > 0).map_or(0, |i| chars.len() - i);
    let cut = |k: usize| -> String {
        let tail = k.div_ceil(2).max(ext.min(k));
        let head = k - tail;
        let mut s: String = chars[..head].iter().collect();
        s.push('…');
        s.extend(&chars[chars.len() - tail..]);
        s
    };
    let (mut lo, mut hi) = (0usize, chars.len().saturating_sub(1));
    while lo < hi {
        let mid = (lo + hi).div_ceil(2);
        if fits(&cut(mid)) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    cut(lo)
}

/// Fill and bar colors of a chunk in one pane.
fn band_colors(c: &Chunk, pane_changes: bool) -> Option<(Color32, Color32)> {
    let t = &theme::T;
    if c.kind == Kind::Conflict && !c.resolved {
        return Some((t.merge_conflict, t.merge_conflict_edge));
    }
    if c.resolved && c.kind != Kind::Both {
        return Some((t.merge_resolved, t.merge_resolved_edge));
    }
    pane_changes.then_some((t.merge_changed, t.merge_changed_edge))
}

fn body(ui: &mut Ui, tab: &mut MergeTab, env: &mut TabEnv, e: &mut EditorTab) {
    let gap = DIVIDER_W;
    let avail = ui.available_rect_before_wrap();
    let col_w = ((avail.width() - 2.0 * gap) / 3.0).max(80.0);
    // Column titles.
    let title_h = 20.0;
    let titles = [tab.labels[LEFT], "Result", tab.labels[RIGHT]];
    for (i, t) in titles.iter().enumerate() {
        let x = avail.min.x + i as f32 * (col_w + gap) + 8.0;
        ui.painter().text(pos2(x, avail.min.y + title_h / 2.0), Align2::LEFT_CENTER, *t, theme::T.small_font(), theme::T.text_dim);
    }
    let top = avail.min.y + title_h;
    let rects: [Rect; 3] = std::array::from_fn(|i| {
        let x = avail.min.x + i as f32 * (col_w + gap);
        Rect::from_min_max(pos2(x, top), pos2(x + col_w, avail.max.y))
    });
    ui.allocate_rect(avail, Sense::hover());

    let segs = tab.segments(&e.doc);
    let folds: [Vec<(usize, Fold)>; 3] = std::array::from_fn(|p| tab.folds(&segs, p));
    // Bands per pane, sorted by line.
    let mut bands: [Vec<LineBand>; 3] = Default::default();
    for (i, c) in tab.chunks.iter().enumerate() {
        let lines = &segs[2 * i + 1];
        for (p, changes) in [(0, c.kind.changes(LEFT)), (1, true), (2, c.kind.changes(RIGHT))] {
            if let Some((fill, bar)) = band_colors(c, changes) {
                let l = lines[p].clone();
                bands[p].push(LineBand { fill: if l.is_empty() { bar } else { fill }, lines: l });
            }
        }
    }

    // The pane that scrolls this frame leads: the one under a wheel or a press, else the one
    // with the keys, else the result. It draws first; the others follow its top line.
    let (hover, scrolling) = ui.input(|i| (i.pointer.hover_pos(), i.smooth_scroll_delta != egui::Vec2::ZERO || i.pointer.any_pressed()));
    let hovered = hover.and_then(|p| rects.iter().position(|r| r.contains(p)));
    let ctx = ui.ctx().clone();
    let focused = [tab.sides[LEFT].view.owns_focus(&ctx), tab.result_view.owns_focus(&ctx), tab.sides[RIGHT].view.owns_focus(&ctx)].iter().position(|&f| f);
    let lead = match (hovered, focused) {
        (Some(h), _) if scrolling => h,
        (_, Some(f)) => f,
        (Some(h), _) => h,
        _ => 1,
    };
    let order = match lead {
        0 => [0, 1, 2],
        2 => [2, 1, 0],
        _ => [1, 0, 2],
    };
    let font_size = theme::T.font.mono;
    let names = [format!("Merge {}", tab.labels[LEFT]), "Merge Result".to_string(), format!("Merge {}", tab.labels[RIGHT])];
    let mut unfolded: Vec<(usize, Fold)> = Vec::new();
    let mut result_changed = false;
    for (k, &p) in order.iter().enumerate() {
        if k > 0 {
            sync_scroll(tab, &segs, &e.doc, lead, p);
        }
        let mut child = ui.new_child(UiBuilder::new().max_rect(rects[p]).layout(Layout::top_down(Align::Min)));
        child.set_clip_rect(rects[p].intersect(ui.clip_rect()));
        let pane_folds: Vec<Fold> = folds[p].iter().map(|(_, f)| f.clone()).collect();
        let r = if p == 1 {
            e.problems.refresh(&e.doc);
            tab.result_view.set_folds(pane_folds);
            tab.result_problems = e.problems.marks.len();
            let r = EditorView::new(&mut e.doc, &mut tab.result_view)
                .problems(&e.problems.marks)
                .theme(env.editor_theme)
                .font_size(font_size)
                .line_bands(&bands[1])
                .name(&names[1])
                .read_only(e.read_only)
                .show(&mut child);
            result_changed = r.changed;
            r
        } else {
            let side = &mut tab.sides[p / 2];
            side.view.set_folds(pane_folds);
            EditorView::new(&mut side.doc, &mut side.view).theme(env.editor_theme).font_size(font_size).line_bands(&bands[p]).name(&names[p]).read_only(true).show(&mut child)
        };
        if let Some(f) = r.unfolded {
            unfolded.push((p, f));
        }
    }
    for p in 0..3 {
        tab.last_views[p] = match p {
            1 => tab.result_view.view_state(&e.doc),
            _ => tab.sides[p / 2].view.view_state(&tab.sides[p / 2].doc),
        };
    }
    for (p, f) in unfolded {
        if let Some((run, _)) = folds[p].iter().find(|(_, g)| g.lines.start == f.lines.start) {
            tab.expanded[*run] = true;
        }
    }
    if result_changed {
        e.last_edit = Instant::now();
        e.problems.refresh(&e.doc);
        tab.follow(&e.doc);
    }

    // Ribbons and buttons between the panes.
    let mut picks = Vec::new();
    for (d, side) in [(0usize, LEFT), (1usize, RIGHT)] {
        let div = Rect::from_min_max(pos2(rects[d].max.x, top), pos2(rects[d + 1].min.x, avail.max.y));
        let painter = ui.painter_at(div);
        let (from_view, to_view) = if side == LEFT { (&tab.sides[LEFT].view, &tab.result_view) } else { (&tab.result_view, &tab.sides[RIGHT].view) };
        let (from_pane, to_pane) = if side == LEFT { (0, 1) } else { (1, 2) };
        for (i, c) in tab.chunks.iter().enumerate() {
            if !c.kind.changes(side) {
                continue;
            }
            let lines = &segs[2 * i + 1];
            let span = |v: &EditorState, l: &Range<usize>| -> Option<(f32, f32)> {
                let (a, _) = v.line_span(l.start)?;
                let b = if l.is_empty() { a } else { v.line_span(l.end - 1)?.1 };
                Some((a, b))
            };
            let (Some(a), Some(b)) = (span(from_view, &lines[from_pane]), span(to_view, &lines[to_pane])) else { continue };
            let Some((fill, _)) = band_colors(c, true) else { continue };
            if a.1.max(b.1) < div.min.y || a.0.min(b.0) > div.max.y {
                continue;
            }
            let pts = vec![pos2(div.min.x, a.0), pos2(div.max.x, b.0), pos2(div.max.x, b.1.max(b.0 + 1.0)), pos2(div.min.x, a.1.max(a.0 + 1.0))];
            painter.add(Shape::convex_polygon(pts, fill, Stroke::NONE));
            // The button sits at the top of the chunk on its side.
            let y = if side == LEFT { a.0 } else { b.0 };
            if y < div.min.y || y + 18.0 > div.max.y {
                continue;
            }
            let btn = Rect::from_min_size(pos2(div.center().x - 12.0, y + 1.0), vec2(24.0, 18.0));
            let dir = if side == LEFT { "left" } else { "right" };
            let id = crate::workspace::wid(("merge-apply", &tab.rel, i, side));
            if c.shown[side] {
                let resp = ui.interact(btn, id, Sense::hover());
                crate::util::label_widget(&resp, egui::WidgetType::Other, format!("Applied {dir} change {}", i + 1));
                icons::paint(&painter, btn.shrink(2.0), Icon::Check, theme::T.text_dim);
                resp.on_hover_text("Applied");
            } else {
                let resp = ui.interact(btn, id, Sense::click());
                crate::util::label_widget(&resp, egui::WidgetType::Button, format!("Apply {dir} change {}", i + 1));
                let bg = if resp.hovered() { theme::T.scrollbar_thumb_active } else { theme::T.tab_bar_bg };
                painter.rect_filled(btn, 3.0, bg);
                painter.text(btn.center(), Align2::CENTER_CENTER, if side == LEFT { ">>" } else { "<<" }, theme::T.mono_small_font(), theme::T.text);
                if resp.clicked() {
                    picks.push((i, side));
                }
                resp.on_hover_text("Apply this change to the result");
            }
        }
    }
    if !picks.is_empty() {
        tab.apply(&mut e.doc, &picks, true);
        e.last_edit = Instant::now();
        // Cmd+Z right after the click undoes the apply.
        tab.result_view.request_focus();
        ui.ctx().request_repaint();
    }
}

/// Before pane `p` draws: when the leading pane moved, scroll `p` to the matching line.
fn sync_scroll(tab: &mut MergeTab, segs: &[[Range<usize>; 3]], result: &Document, lead: usize, p: usize) {
    let (now, line_h) = match lead {
        1 => (tab.result_view.view_state(result), tab.result_view.geometry().map(|g| g.line_h)),
        _ => {
            let s = &tab.sides[lead / 2];
            (s.view.view_state(&s.doc), s.view.geometry().map(|g| g.line_h))
        }
    };
    let (Some(now), Some(line_h)) = (now, line_h) else { return };
    if tab.last_views[lead] == Some(now) {
        return;
    }
    let line = now.line as f32 + now.offset / line_h;
    let to = map_line(segs, lead, p, line);
    let v = ViewState { line: to.floor() as usize, column: 0, offset: to.fract() * line_h, x: now.x };
    match p {
        1 => tab.result_view.restore_view(v),
        _ => tab.sides[p / 2].view.restore_view(v),
    }
}

/// Splits keeping line terminators, so joined blocks rebuild the text byte for byte.
fn split_keep(text: &str) -> Vec<&str> {
    text.split_inclusive('\n').collect()
}

fn join(lines: &[&str]) -> String {
    lines.concat()
}

/// diff3-style block layout. Hunks of the two sides that overlap or touch in base lines form
/// one block; a block changed on both sides with different text is a conflict.
fn build_blocks(base: &str, ours: &str, theirs: &str) -> Vec<Block> {
    let bl = split_keep(base);
    let ol = split_keep(ours);
    let tl = split_keep(theirs);
    // (base range, side range, is_theirs)
    let mut changes: Vec<(Range<usize>, Range<usize>, bool)> = Vec::new();
    for h in ide_git::diff_texts(base, ours) {
        changes.push((h.old_lines.clone(), h.new_lines.clone(), false));
    }
    for h in ide_git::diff_texts(base, theirs) {
        changes.push((h.old_lines.clone(), h.new_lines.clone(), true));
    }
    changes.sort_by_key(|c| (c.0.start, c.0.end));

    let mut blocks = Vec::new();
    let (mut b_cur, mut o_cur, mut t_cur) = (0usize, 0usize, 0usize);
    let mut i = 0;
    while i < changes.len() {
        let start = changes[i].0.start;
        let mut end = changes[i].0.end;
        let mut j = i + 1;
        while j < changes.len() && changes[j].0.start <= end {
            end = end.max(changes[j].0.end);
            j += 1;
        }
        let group = &changes[i..j];
        if start > b_cur {
            let n = start - b_cur;
            push_same(&mut blocks, &ol[o_cur..o_cur + n]);
            o_cur += n;
            t_cur += n;
        }
        let side_range = |theirs: bool, cur: usize| -> Range<usize> {
            let hs: Vec<_> = group.iter().filter(|c| c.2 == theirs).collect();
            match (hs.first(), hs.last()) {
                (Some(f), Some(l)) => (f.1.start - (f.0.start - start))..(l.1.end + (end - l.0.end)),
                _ => cur..cur + (end - start),
            }
        };
        let o_r = side_range(false, o_cur);
        let t_r = side_range(true, t_cur);
        let has_o = group.iter().any(|c| !c.2);
        let has_t = group.iter().any(|c| c.2);
        let o_text = join(&ol[o_r.clone()]);
        let t_text = join(&tl[t_r.clone()]);
        let base_text = join(&bl[start..end]);
        let kind = match (has_o, has_t) {
            (true, false) => Kind::Ours,
            (false, true) => Kind::Theirs,
            _ if o_text == t_text => Kind::Both,
            _ => Kind::Conflict,
        };
        blocks.push(Block { kind, ours: o_text, theirs: t_text, base: base_text });
        o_cur = o_r.end;
        t_cur = t_r.end;
        b_cur = end;
        i = j;
    }
    if o_cur < ol.len() {
        push_same(&mut blocks, &ol[o_cur..]);
    }
    blocks
}

fn push_same(blocks: &mut Vec<Block>, lines: &[&str]) {
    let text = join(lines);
    blocks.push(Block { kind: Kind::Same, ours: text.clone(), theirs: text.clone(), base: text });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sides(base: &str, ours: &str, theirs: &str) -> ConflictSides {
        ConflictSides { path: PathBuf::from("f.txt"), base: Some(base.into()), ours: Some(ours.into()), theirs: Some(theirs.into()), binary: false }
    }

    fn tab(base: &str, ours: &str, theirs: &str) -> (MergeTab, Document) {
        let mut t = MergeTab::new(sides(base, ours, theirs), ("Yours", "Theirs"), PathBuf::from("/f.txt"), Vec::new(), false);
        let mut doc = Document::from_text("<<<<<<< markers\n", Language::Plain);
        t.init(&mut doc);
        (t, doc)
    }

    #[test]
    fn blocks_split_changes_and_conflicts() {
        let base = "a\nb\nc\nd\ne\n";
        let ours = "a\nB1\nc\nd\ne\nf\n";
        let theirs = "a\nB2\nc\nD\ne\n";
        let blocks = build_blocks(base, ours, theirs);
        let kinds: Vec<Kind> = blocks.iter().map(|b| b.kind).collect();
        assert_eq!(kinds, vec![Kind::Same, Kind::Conflict, Kind::Same, Kind::Theirs, Kind::Same, Kind::Ours]);
        assert_eq!(blocks[1].ours, "B1\n");
        assert_eq!(blocks[1].theirs, "B2\n");
        assert_eq!(blocks[1].base, "b\n");
    }

    #[test]
    fn add_add_without_base() {
        let blocks = build_blocks("", "x\n", "y\n");
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].kind, Kind::Conflict);
    }

    /// The result starts with the non-conflicting changes applied as one undo step: undo
    /// takes them back and their buttons return, redo applies them again.
    #[test]
    fn non_conflicting_changes_apply_as_one_undo_step() {
        let (mut t, mut doc) = tab("a\nb\nc\nd\ne\n", "a\nB1\nc\nd\ne\nf\n", "a\nB2\nc\nD\ne\n");
        assert_eq!(doc.text(), "a\nb\nc\nD\ne\nf\n");
        assert!(doc.is_dirty(), "the result differs from the file on disk");
        let states = t.chunk_states();
        assert_eq!(states, vec![([false, false], false), ([false, true], true), ([true, false], true)]);
        doc.undo();
        t.follow(&doc);
        assert_eq!(doc.text(), "a\nb\nc\nd\ne\n");
        assert_eq!(t.chunk_states(), vec![([false, false], false), ([false, false], false), ([false, false], false)]);
        assert!(doc.undo().is_none(), "undo stops at the base text, never git's markers");
        doc.redo();
        t.follow(&doc);
        assert_eq!(t.chunk_states()[1], ([false, true], true));
    }

    /// Free edits above, inside and below chunks move the chunks with the text.
    #[test]
    fn chunks_follow_free_edits() {
        let (mut t, mut doc) = tab("a\nb\nc\nd\ne\n", "a\nB1\nc\nd\ne\n", "a\nB2\nc\nD\ne\n");
        assert_eq!(t.chunk_lines(&doc).iter().map(|c| c[1].clone()).collect::<Vec<_>>(), vec![1..2, 3..4]);
        // Two lines typed at the top.
        doc.edit(0..0, "x\ny\n", Selection::caret(0), Selection::caret(4), EditKind::Other);
        t.follow(&doc);
        assert_eq!(t.chunk_lines(&doc).iter().map(|c| c[1].clone()).collect::<Vec<_>>(), vec![3..4, 5..6]);
        // A line typed at the start of the line after the first chunk stays outside it.
        let at = doc.line_start(4);
        doc.edit(at..at, "z\n", Selection::caret(at), Selection::caret(at + 2), EditKind::Other);
        t.follow(&doc);
        assert_eq!(t.chunk_lines(&doc).iter().map(|c| c[1].clone()).collect::<Vec<_>>(), vec![3..4, 6..7]);
        // Typing inside the conflict marks it resolved and keeps its range on the line.
        let at = doc.line_start(3);
        doc.edit(at..at, "q", Selection::caret(at), Selection::caret(at + 1), EditKind::Other);
        t.follow(&doc);
        assert_eq!(t.chunk_lines(&doc)[0][1], 3..4);
        assert!(t.chunk_states()[0].1, "an edited conflict counts as resolved");
        assert_eq!(doc.slice(t.chunks[0].res.clone()), "qb\n");
    }

    /// Applying both sides of a conflict keeps both, and both buttons show the applied mark.
    #[test]
    fn conflict_takes_both_sides_in_order() {
        let (mut t, mut doc) = tab("a\nb\nc\n", "a\nB1\nc\n", "a\nB2\nc\n");
        t.apply(&mut doc, &[(0, LEFT)], true);
        assert_eq!(doc.text(), "a\nB1\nc\n");
        assert_eq!(t.chunk_states()[0], ([true, false], true));
        t.apply(&mut doc, &[(0, RIGHT)], true);
        assert_eq!(doc.text(), "a\nB1\nB2\nc\n");
        assert_eq!(t.chunk_states()[0], ([true, true], true));
        doc.undo();
        t.follow(&doc);
        assert_eq!(doc.text(), "a\nB1\nc\n");
        assert_eq!(t.chunk_states()[0], ([true, false], true));
        // Accept Right replaces instead of adding.
        t.take_all(&mut doc, RIGHT);
        assert_eq!(doc.text(), "a\nB2\nc\n");
        assert_eq!(t.chunk_states()[0], ([false, true], true));
    }

    #[test]
    fn map_range_rules() {
        let ch = |start, removed, inserted| TextChange { start, removed, inserted };
        // Before, after, at the end, at the start of a chunk.
        assert_eq!(map_range(5..10, &ch(0, 0, 3)), 8..13);
        assert_eq!(map_range(5..10, &ch(12, 1, 0)), 5..10);
        assert_eq!(map_range(5..10, &ch(10, 0, 2)), 5..10);
        assert_eq!(map_range(5..10, &ch(5, 0, 2)), 5..12);
        // An empty chunk grows with the side applied into it.
        assert_eq!(map_range(5..5, &ch(5, 0, 4)), 5..9);
        // A replacement of the whole chunk, and a deletion that swallows it.
        assert_eq!(map_range(5..10, &ch(5, 5, 2)), 5..7);
        assert_eq!(map_range(5..10, &ch(3, 9, 0)), 3..3);
        // A deletion that ends at the chunk's start.
        assert_eq!(map_range(5..10, &ch(3, 2, 0)), 3..8);
    }

    #[test]
    fn cut_path_keeps_the_file_name() {
        let full = "javascript/packages/core/src/Containers/Selectors/PreLiveSelectors.ts";
        let fits = |n: usize| move |s: &str| s.chars().count() <= n;
        assert_eq!(cut_path(full, fits(200)), full);
        let cut = cut_path(full, fits(40));
        assert!(cut.ends_with("/PreLiveSelectors.ts") && cut.contains('…') && cut.chars().count() <= 40, "{cut}");
        assert!(cut.starts_with("javascript"), "{cut}");
        assert_eq!(cut_path(full, fits(12)), "PreLi…ors.ts");
    }

    #[test]
    fn map_line_through_chunks() {
        let segs = vec![[0..3, 0..3, 0..3], [3..5, 3..3, 3..4], [5..9, 3..7, 4..8]];
        assert_eq!(map_line(&segs, 0, 1, 1.5), 1.5);
        assert_eq!(map_line(&segs, 0, 2, 4.0), 3.5);
        assert_eq!(map_line(&segs, 0, 1, 6.0), 4.0);
        assert_eq!(map_line(&segs, 1, 0, 3.0), 5.0);
    }
}
