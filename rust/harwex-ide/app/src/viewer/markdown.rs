//! The Markdown preview of a `.md` editor tab, like IDEA's: Editor, Split and Preview modes
//! picked in a small toolbar at the top right.
//!
//! `parse` turns the text into a flat list of blocks (pulldown-cmark), each with its first
//! source line, list depth and quote depth. The preview draws only the blocks in view and keeps
//! the height of each block it drew; blocks it never drew count with an estimate. Split mode
//! maps the editor's top line to a block and its y, both ways ("roughly", like IDEA).
//!
//! Images in the text load on workers (`viewer::load`); remote images show their alt text.
//! Links open through `Platform::open_url`; a relative link to a file opens it in the IDE, and
//! `#anchor` scrolls to the heading.

use std::collections::HashMap;
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use egui::text::{LayoutJob, TextFormat};
use egui::{pos2, vec2, Align2, Color32, CursorIcon, FontId, Galley, Id, Rect, Sense, Stroke, Ui, Vec2};
use pulldown_cmark::{Alignment, Event, Options, Parser, Tag, TagEnd};

use super::image::Pic;
use crate::jobs::Jobs;
use crate::tabs::EditorTab;
use crate::theme;

/// Above this size the text is parsed on a worker; below, on the UI thread (like the editor's
/// find).
const SYNC_PARSE_BYTES: usize = 256 * 1024;
const PAD: f32 = 20.0;
const GAP: f32 = 10.0;
const LIST_INDENT: f32 = 24.0;
const QUOTE_INDENT: f32 = 16.0;
const CELL_PAD: f32 = 8.0;
const SPLITTER_W: f32 = 6.0;

pub fn is_markdown(path: &Path) -> bool {
    path.extension().is_some_and(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"))
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Mode {
    #[default]
    Editor,
    Split,
    Preview,
}

impl Mode {
    const ALL: [(Mode, &'static str, &'static str); 3] =
        [(Mode::Editor, "Editor", "Show Editor Only"), (Mode::Split, "Split", "Show Editor and Preview"), (Mode::Preview, "Preview", "Show Preview Only")];
}

// ---------------------------------------------------------------------------------------------
// The block model.

const BOLD: u8 = 1;
const ITALIC: u8 = 2;
const STRIKE: u8 = 4;
const CODE: u8 = 8;

#[derive(Clone, Debug, PartialEq)]
pub struct Run {
    pub text: String,
    pub style: u8,
    pub link: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Inline {
    pub runs: Vec<Run>,
}

impl Inline {
    fn visible(&self) -> bool {
        self.runs.iter().any(|r| !r.text.trim().is_empty())
    }

    pub fn plain(&self) -> String {
        self.runs.iter().map(|r| r.text.as_str()).collect()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Marker {
    Bullet,
    Number(u64),
    Task(bool),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Img {
    pub url: String,
    pub alt: String,
    /// The link around the image (a badge).
    pub link: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Kind {
    Heading { level: u8, text: Inline, anchor: String },
    Para(Inline),
    /// The first block of a list item, with its marker.
    Item { marker: Marker, text: Inline },
    Code(String),
    Table { aligns: Vec<Alignment>, head: Vec<Inline>, rows: Vec<Vec<Inline>> },
    Rule,
    /// Images side by side (badges, a screenshot).
    Images(Vec<Img>),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Block {
    pub kind: Kind,
    /// The 0-based source line the block starts at.
    pub line: usize,
    /// List depth: the block's text starts this many list indents in.
    pub indent: u8,
    /// Block quote depth.
    pub quote: u8,
}

enum CurKind {
    Para,
    Heading(u8),
    Item(Marker),
    Cell,
}

struct Cur {
    kind: CurKind,
    text: Inline,
    line: usize,
}

struct TableBuild {
    aligns: Vec<Alignment>,
    head: Vec<Inline>,
    rows: Vec<Vec<Inline>>,
    row: Vec<Inline>,
    line: usize,
}

struct ParseState {
    blocks: Vec<Block>,
    line_starts: Vec<usize>,
    quote: u8,
    lists: Vec<Option<u64>>,
    cur: Option<Cur>,
    /// Counters per style bit, so nested emphasis ends right.
    styles: [u16; 4],
    links: Vec<String>,
    image: Option<(String, String)>,
    row: Vec<Img>,
    row_line: usize,
    table: Option<TableBuild>,
    code: Option<(String, usize)>,
}

impl ParseState {
    fn line_of(&self, byte: usize) -> usize {
        self.line_starts.partition_point(|&s| s <= byte).saturating_sub(1)
    }

    fn indent(&self) -> u8 {
        self.lists.len().min(u8::MAX as usize) as u8
    }

    fn style(&self) -> u8 {
        let mut s = 0;
        for (i, bit) in [BOLD, ITALIC, STRIKE, CODE].into_iter().enumerate() {
            if self.styles[i] > 0 {
                s |= bit;
            }
        }
        s
    }

    fn push(&mut self, kind: Kind, line: usize) {
        self.blocks.push(Block { kind, line, indent: self.indent(), quote: self.quote });
    }

    fn flush_row(&mut self) {
        if !self.row.is_empty() {
            let row = std::mem::take(&mut self.row);
            self.push(Kind::Images(row), self.row_line);
        }
    }

    /// Ends the open text block (and an image row after it).
    fn flush(&mut self) {
        if let Some(c) = self.cur.take() {
            match c.kind {
                CurKind::Cell => self.cur = Some(c),
                _ if !c.text.visible() => {}
                CurKind::Para => self.push(Kind::Para(c.text), c.line),
                CurKind::Item(marker) => self.push(Kind::Item { marker, text: c.text }, c.line),
                CurKind::Heading(level) => {
                    let anchor = slug(&c.text.plain());
                    self.push(Kind::Heading { level, text: c.text, anchor }, c.line);
                }
            }
        }
        self.flush_row();
    }

    fn text(&mut self, text: &str, style: u8, line: usize) {
        if !self.row.is_empty() && !text.trim().is_empty() {
            self.flush_row();
        }
        let link = self.links.last().cloned();
        let cur = self.cur.get_or_insert(Cur { kind: CurKind::Para, text: Inline::default(), line });
        match cur.text.runs.last_mut() {
            Some(r) if r.style == style && r.link == link => r.text.push_str(text),
            _ => cur.text.runs.push(Run { text: text.to_string(), style, link }),
        }
    }

    fn image(&mut self, img: Img, line: usize) {
        match self.cur.as_ref().map(|c| &c.kind) {
            Some(CurKind::Cell) | Some(CurKind::Heading(_)) => {
                let alt = if img.alt.is_empty() { "image".to_string() } else { img.alt };
                self.text(&format!("[{alt}]"), self.style(), line);
            }
            _ => {
                if self.cur.as_ref().is_some_and(|c| c.text.visible()) {
                    // Text before the image ends a block; the text after it starts a new one.
                    let row = std::mem::take(&mut self.row);
                    self.flush();
                    self.row = row;
                }
                if self.row.is_empty() {
                    self.row_line = line;
                }
                self.cur = None;
                self.row.push(img);
            }
        }
    }

    fn html(&mut self, html: &str, line: usize) {
        static IMG: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
        static ATTR: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
        let img = IMG.get_or_init(|| regex::Regex::new(r"(?is)<img\b[^>]*>").expect("img regex"));
        let attr = ATTR.get_or_init(|| regex::Regex::new(r#"(?is)\b(src|alt)\s*=\s*["']([^"']*)["']"#).expect("attr regex"));
        for tag in img.find_iter(html) {
            let (mut url, mut alt) = (String::new(), String::new());
            for c in attr.captures_iter(tag.as_str()) {
                match c[1].to_ascii_lowercase().as_str() {
                    "src" => url = c[2].to_string(),
                    _ => alt = c[2].to_string(),
                }
            }
            if !url.is_empty() {
                let link = self.links.last().cloned();
                self.image(Img { url, alt, link }, line);
            }
        }
    }
}

/// GitHub's heading anchors: lower case, spaces become `-`, punctuation goes.
pub fn slug(text: &str) -> String {
    text.trim()
        .chars()
        .filter_map(|c| match c {
            ' ' => Some('-'),
            c if c.is_alphanumeric() || c == '-' || c == '_' => Some(c.to_lowercase().next().unwrap_or(c)),
            _ => None,
        })
        .collect()
}

/// Parses Markdown into blocks. Pure; runs on the UI thread for small files, else on a worker.
pub fn parse(text: &str) -> Vec<Block> {
    let mut line_starts = vec![0];
    line_starts.extend(memchr::memchr_iter(b'\n', text.as_bytes()).map(|i| i + 1));
    let mut p = ParseState {
        blocks: Vec::new(),
        line_starts,
        quote: 0,
        lists: Vec::new(),
        cur: None,
        styles: [0; 4],
        links: Vec::new(),
        image: None,
        row: Vec::new(),
        row_line: 0,
        table: None,
        code: None,
    };
    let opts = Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS;
    for (ev, range) in Parser::new_ext(text, opts).into_offset_iter() {
        let line = p.line_of(range.start);
        match ev {
            Event::Start(tag) => match tag {
                Tag::Paragraph => {
                    let keep = matches!(&p.cur, Some(Cur { kind: CurKind::Item(_), text, .. }) if !text.visible());
                    if !keep {
                        p.flush();
                        p.cur = Some(Cur { kind: CurKind::Para, text: Inline::default(), line });
                    }
                }
                Tag::Heading { level, .. } => {
                    p.flush();
                    p.cur = Some(Cur { kind: CurKind::Heading(level as u8), text: Inline::default(), line });
                }
                Tag::BlockQuote(_) => {
                    p.flush();
                    p.quote = p.quote.saturating_add(1);
                }
                Tag::CodeBlock(_) => {
                    p.flush();
                    p.code = Some((String::new(), line));
                }
                Tag::List(start) => {
                    p.flush();
                    p.lists.push(start);
                }
                Tag::Item => {
                    p.flush();
                    let marker = match p.lists.last_mut() {
                        Some(Some(n)) => {
                            *n += 1;
                            Marker::Number(*n - 1)
                        }
                        _ => Marker::Bullet,
                    };
                    p.cur = Some(Cur { kind: CurKind::Item(marker), text: Inline::default(), line });
                }
                Tag::Table(aligns) => {
                    p.flush();
                    p.table = Some(TableBuild { aligns, head: Vec::new(), rows: Vec::new(), row: Vec::new(), line });
                }
                Tag::TableHead | Tag::TableRow => {
                    if let Some(t) = p.table.as_mut() {
                        t.row.clear();
                    }
                }
                Tag::TableCell => p.cur = Some(Cur { kind: CurKind::Cell, text: Inline::default(), line }),
                Tag::Emphasis => p.styles[1] += 1,
                Tag::Strong => p.styles[0] += 1,
                Tag::Strikethrough => p.styles[2] += 1,
                Tag::Link { dest_url, .. } => p.links.push(dest_url.to_string()),
                Tag::Image { dest_url, .. } => p.image = Some((dest_url.to_string(), String::new())),
                _ => {}
            },
            Event::End(tag) => match tag {
                TagEnd::Paragraph | TagEnd::Heading(_) | TagEnd::Item => p.flush(),
                TagEnd::BlockQuote(_) => {
                    p.flush();
                    p.quote = p.quote.saturating_sub(1);
                }
                TagEnd::CodeBlock => {
                    if let Some((mut code, l)) = p.code.take() {
                        if code.ends_with('\n') {
                            code.pop();
                        }
                        p.push(Kind::Code(code), l);
                    }
                }
                TagEnd::List(_) => {
                    p.flush();
                    p.lists.pop();
                }
                TagEnd::TableCell => {
                    let text = p.cur.take().map(|c| c.text).unwrap_or_default();
                    if let Some(t) = p.table.as_mut() {
                        t.row.push(text);
                    }
                }
                TagEnd::TableHead => {
                    if let Some(t) = p.table.as_mut() {
                        t.head = std::mem::take(&mut t.row);
                    }
                }
                TagEnd::TableRow => {
                    if let Some(t) = p.table.as_mut() {
                        let row = std::mem::take(&mut t.row);
                        t.rows.push(row);
                    }
                }
                TagEnd::Table => {
                    if let Some(t) = p.table.take() {
                        p.push(Kind::Table { aligns: t.aligns, head: t.head, rows: t.rows }, t.line);
                    }
                }
                TagEnd::Emphasis => p.styles[1] = p.styles[1].saturating_sub(1),
                TagEnd::Strong => p.styles[0] = p.styles[0].saturating_sub(1),
                TagEnd::Strikethrough => p.styles[2] = p.styles[2].saturating_sub(1),
                TagEnd::Link => {
                    p.links.pop();
                }
                TagEnd::Image => {
                    if let Some((url, alt)) = p.image.take() {
                        let link = p.links.last().cloned();
                        p.image(Img { url, alt, link }, line);
                    }
                }
                _ => {}
            },
            Event::Text(t) => {
                if let Some((code, _)) = p.code.as_mut() {
                    code.push_str(&t);
                } else if let Some((_, alt)) = p.image.as_mut() {
                    alt.push_str(&t);
                } else {
                    let style = p.style();
                    p.text(&t, style, line);
                }
            }
            Event::Code(t) => {
                if let Some((_, alt)) = p.image.as_mut() {
                    alt.push_str(&t);
                } else {
                    let style = p.style() | CODE;
                    p.text(&t, style, line);
                }
            }
            Event::SoftBreak => {
                if p.image.is_none() {
                    let style = p.style();
                    p.text(" ", style, line);
                }
            }
            Event::HardBreak => {
                let style = p.style();
                p.text("\n", style, line);
            }
            Event::TaskListMarker(done) => {
                if let Some(Cur { kind: CurKind::Item(m), .. }) = p.cur.as_mut() {
                    *m = Marker::Task(done);
                }
            }
            Event::Rule => {
                p.flush();
                p.push(Kind::Rule, line);
            }
            Event::Html(h) | Event::InlineHtml(h) => p.html(&h, line),
            _ => {}
        }
    }
    p.flush();
    p.blocks
}

// ---------------------------------------------------------------------------------------------
// Preview state.

enum Slot {
    Loading,
    Pic(Pic),
}

/// One clickable link drawn last frame, for tests.
#[derive(Clone, Debug)]
pub struct LinkHit {
    pub text: String,
    pub url: String,
    pub rect: Rect,
}

/// The preview half of a Markdown tab. Lives in `EditorTab::markdown`.
pub struct Preview {
    pub mode: Mode,
    blocks: Arc<Vec<Block>>,
    parsed: Option<u64>,
    parsing: bool,
    /// Drawn block heights at `heights_w`; `NAN` for a block not drawn yet.
    heights: Vec<f32>,
    heights_w: f32,
    /// Block tops as laid out last frame (drawn or estimated), relative to the content top.
    tops: Vec<f32>,
    images: HashMap<String, Slot>,
    /// The preview's scroll offset last frame.
    offset: f32,
    /// Scroll the preview there on the next frame.
    scroll_to: Option<f32>,
    /// The editor's top line (fractional) last frame, in Split mode.
    editor_top: Option<f32>,
    /// The preview just moved the editor: take its next top line as is.
    ignore_editor: bool,
    /// The editor's share of the width in Split mode.
    split: f32,
    links: Vec<LinkHit>,
    /// The preview pane as drawn last frame.
    rect: Option<Rect>,
}

impl Default for Preview {
    fn default() -> Preview {
        Preview {
            mode: Mode::default(),
            blocks: Arc::new(Vec::new()),
            parsed: None,
            parsing: false,
            heights: Vec::new(),
            heights_w: 0.0,
            tops: Vec::new(),
            images: HashMap::new(),
            offset: 0.0,
            scroll_to: None,
            editor_top: None,
            ignore_editor: false,
            split: 0.5,
            links: Vec::new(),
            rect: None,
        }
    }
}

impl Preview {
    pub fn blocks(&self) -> &[Block] {
        &self.blocks
    }

    /// Links drawn last frame.
    pub fn links(&self) -> &[LinkHit] {
        &self.links
    }

    /// The preview's scroll offset last frame.
    pub fn offset(&self) -> f32 {
        self.offset
    }

    pub fn rect(&self) -> Option<Rect> {
        self.rect
    }

    /// True while a parse or an image load runs.
    pub fn busy(&self) -> bool {
        self.parsing || self.images.values().any(|s| matches!(s, Slot::Loading))
    }

    fn set_blocks(&mut self, blocks: Vec<Block>, version: u64) {
        self.heights = vec![f32::NAN; blocks.len()];
        self.blocks = Arc::new(blocks);
        self.parsed = Some(version);
    }

    /// Block y (content coordinates) for a fractional source line.
    fn y_of_line(&self, line: f32) -> Option<f32> {
        let b = &self.blocks;
        if b.is_empty() || self.tops.len() != b.len() {
            return None;
        }
        let i = b.partition_point(|x| x.line as f32 <= line).saturating_sub(1);
        let (start, top) = (b[i].line as f32, self.tops[i]);
        let (end, bottom) = match b.get(i + 1) {
            Some(n) => (n.line as f32, self.tops[i + 1]),
            None => (start + 1.0, top + self.height(i)),
        };
        let f = if end > start { ((line - start) / (end - start)).clamp(0.0, 1.0) } else { 0.0 };
        Some(top + f * (bottom - top))
    }

    /// The fractional source line at content y.
    fn line_of_y(&self, y: f32) -> Option<f32> {
        let b = &self.blocks;
        if b.is_empty() || self.tops.len() != b.len() {
            return None;
        }
        let i = self.tops.partition_point(|&t| t <= y).saturating_sub(1);
        let (start, top) = (b[i].line as f32, self.tops[i]);
        let (end, bottom) = match b.get(i + 1) {
            Some(n) => (n.line as f32, self.tops[i + 1]),
            None => (start + 1.0, top + self.height(i)),
        };
        let f = if bottom > top { ((y - top) / (bottom - top)).clamp(0.0, 1.0) } else { 0.0 };
        Some(start + f * (end - start))
    }

    fn height(&self, i: usize) -> f32 {
        let h = self.heights.get(i).copied().unwrap_or(f32::NAN);
        if h.is_nan() {
            estimate(&self.blocks[i], self.heights_w)
        } else {
            h
        }
    }
}

/// A guess for a block not drawn yet; it only decides the scrollbar and the sync.
fn estimate(b: &Block, width: f32) -> f32 {
    let t = &theme::T;
    let row = t.font.preview * 1.5;
    let per_row = ((width - 2.0 * PAD) / (t.font.preview * 0.5)).max(10.0);
    let rows = |n: usize| (n as f32 / per_row).ceil().max(1.0);
    GAP + match &b.kind {
        Kind::Heading { level, .. } => t.font.preview_headings[(*level as usize).clamp(1, 6) - 1] * 1.6,
        Kind::Para(i) | Kind::Item { text: i, .. } => rows(i.plain().len()) * row,
        Kind::Code(c) => (c.lines().count().max(1) as f32) * t.font.mono * 1.4 + 2.0 * CELL_PAD,
        Kind::Table { rows: r, .. } => (r.len() + 1) as f32 * (row + CELL_PAD),
        Kind::Rule => 12.0,
        Kind::Images(_) => 120.0,
    }
}

// ---------------------------------------------------------------------------------------------
// Drawing a Markdown tab.

/// The parts of a Markdown tab this frame: the editor's rect and the preview's, or `None` for
/// a part the mode hides.
pub struct Panes {
    pub editor: Option<Rect>,
    pub preview: Option<Rect>,
    splitter: Option<Rect>,
}

/// Splits the tab's area for its mode. Call before drawing the editor.
pub fn panes(ui: &Ui, p: &Preview) -> Panes {
    let full = ui.available_rect_before_wrap();
    match p.mode {
        Mode::Editor => Panes { editor: Some(full), preview: None, splitter: None },
        Mode::Preview => Panes { editor: None, preview: Some(full), splitter: None },
        Mode::Split => {
            let x = (full.min.x + full.width() * p.split).round();
            let editor = Rect::from_min_max(full.min, pos2(x, full.max.y));
            let preview = Rect::from_min_max(pos2(x + 1.0, full.min.y), full.max);
            let splitter = Rect::from_center_size(pos2(x, full.center().y), vec2(SPLITTER_W, full.height()));
            Panes { editor: Some(editor), preview: Some(preview), splitter: Some(splitter) }
        }
    }
}

/// What the preview needs from the app while it draws.
pub struct Env<'a> {
    pub jobs: &'a Jobs,
    /// The project root, for links and images that start with `/`.
    pub root: Option<&'a Path>,
}

/// Draws the preview, the splitter and the mode toolbar after the editor drew (or did not).
pub fn finish(ui: &mut Ui, e: &mut EditorTab, panes: Panes, env: &Env) {
    let path = e.path.clone();
    // Out of the tab while it draws, so the sync can read and move the editor.
    let Some(mut p) = e.markdown.take() else { return };
    // Editor mode parses nothing: typing in a big file costs no preview work.
    if panes.preview.is_some() {
        reparse(&mut p, &e.doc, env.jobs, &path);
    }
    if let Some(s) = panes.splitter {
        splitter(ui, &mut p, s, &path);
    }
    if panes.editor.is_some() && panes.preview.is_some() {
        sync_from_editor(&mut p, e);
    }
    match panes.preview {
        Some(rect) => {
            let user_scrolled = show_preview(ui, &mut p, rect, &path, env);
            if user_scrolled && panes.editor.is_some() {
                sync_to_editor(&mut p, e);
            }
        }
        None => {
            p.rect = None;
            p.links.clear();
        }
    }
    let anchor = match (panes.preview, e.view.geometry()) {
        (Some(r), _) => r,
        (None, Some(g)) => g.text_rect,
        (None, None) => panes.editor.unwrap_or(ui.max_rect()),
    };
    if let Some(mode) = toolbar(ui, &p, anchor, &path) {
        p.mode = mode;
        p.editor_top = None;
        if mode != Mode::Preview {
            e.view.request_focus();
        }
    }
    e.markdown = Some(p);
}

/// Parses again when the text changed: here for small files, on a worker for big ones.
fn reparse(p: &mut Preview, doc: &ide_editor::Document, jobs: &Jobs, path: &Path) {
    let version = doc.version();
    if p.parsed == Some(version) || p.parsing {
        return;
    }
    if doc.rope().len_bytes() <= SYNC_PARSE_BYTES {
        p.set_blocks(parse(&doc.text()), version);
        return;
    }
    p.parsing = true;
    let snap = doc.text_snapshot();
    let path = path.to_path_buf();
    jobs.spawn_quiet(
        move || parse(&snap.file_text()),
        move |state, blocks| {
            let Some(id) = state.ws.tabs.editor_by_path(&path) else { return };
            let Some(e) = state.ws.tabs.editor_mut(id) else { return };
            let Some(p) = e.markdown.as_deref_mut() else { return };
            p.parsing = false;
            p.set_blocks(blocks, version);
        },
    );
}

fn splitter(ui: &mut Ui, p: &mut Preview, rect: Rect, path: &Path) {
    let t = &theme::T;
    let resp = ui.interact(rect, crate::workspace::wid(("md-splitter", path)), Sense::drag());
    crate::util::label_widget(&resp, egui::WidgetType::Other, "Preview splitter");
    if let (true, Some(pos)) = (resp.dragged(), resp.interact_pointer_pos()) {
        let full = ui.available_rect_before_wrap();
        p.split = ((pos.x - full.min.x) / full.width().max(1.0)).clamp(0.15, 0.85);
    }
    if resp.hovered() || resp.dragged() {
        ui.ctx().set_cursor_icon(CursorIcon::ResizeHorizontal);
    }
    ui.painter().vline(rect.center().x, rect.y_range(), Stroke::new(1.0_f32, t.border));
}

/// The editor's top line, fractional: a soft-wrapped paragraph scrolls through its line.
fn editor_top(e: &EditorTab) -> Option<f32> {
    let v = e.view.view_state(&e.doc)?;
    let len = e.doc.line_len(v.line).max(1);
    Some(v.line as f32 + v.column as f32 / len as f32)
}

/// Split mode: an editor scroll moves the preview to the same block.
fn sync_from_editor(p: &mut Preview, e: &EditorTab) {
    let top = editor_top(e);
    if std::mem::take(&mut p.ignore_editor) {
        p.editor_top = top;
        return;
    }
    if top != p.editor_top {
        p.editor_top = top;
        if let Some(y) = top.and_then(|l| p.y_of_line(l)) {
            p.scroll_to = Some(y);
        }
    }
}

/// Split mode: a preview scroll moves the editor to the same source line.
fn sync_to_editor(p: &mut Preview, e: &mut EditorTab) {
    let Some(line) = p.line_of_y(p.offset) else { return };
    p.ignore_editor = true;
    let line = (line.floor() as usize).min(e.doc.line_count().saturating_sub(1));
    e.view.restore_view(ide_editor::ViewState { line, column: 0, offset: 0.0, x: 0.0 });
}

/// The mode buttons at the top right of `anchor`. Returns the mode picked this frame.
fn toolbar(ui: &Ui, p: &Preview, anchor: Rect, path: &Path) -> Option<Mode> {
    let t = &theme::T;
    let font = t.small_font();
    let galleys: Vec<(Mode, &str, Arc<Galley>)> = Mode::ALL.iter().map(|&(m, text, label)| (m, label, ui.painter().layout_no_wrap(text.to_string(), font.clone(), t.text))).collect();
    let (h, pad, gap) = (22.0, 8.0, 2.0);
    let w: f32 = galleys.iter().map(|(_, _, g)| g.size().x + 2.0 * pad).sum::<f32>() + gap * (galleys.len() as f32 + 1.0);
    let pos = pos2(anchor.max.x - w - 18.0, anchor.min.y + 6.0);
    let mut picked = None;
    egui::Area::new(crate::workspace::wid(("md-toolbar", path))).fixed_pos(pos).order(egui::Order::Middle).default_size(vec2(w, h + 2.0 * gap)).show(ui.ctx(), |ui| {
        let (bar, _) = ui.allocate_exact_size(vec2(w, h + 2.0 * gap), Sense::hover());
        ui.painter().rect(bar, t.radius.button, t.popup_bg, Stroke::new(1.0_f32, t.popup_border), egui::StrokeKind::Inside);
        let mut x = bar.min.x + gap;
        for (mode, label, g) in galleys {
            let r = Rect::from_min_size(pos2(x, bar.min.y + gap), vec2(g.size().x + 2.0 * pad, h));
            x = r.max.x + gap;
            let resp = ui.interact(r, crate::workspace::wid(("md-mode", path, label)), Sense::click());
            let on = p.mode == mode;
            crate::util::label_selectable(&resp, label, on);
            if on {
                ui.painter().rect_filled(r, t.radius.small, t.tab_active_bg);
            } else if resp.hovered() {
                ui.painter().rect_filled(r, t.radius.small, t.button_hover);
            }
            let color = if on { t.text_bright } else { t.text };
            ui.painter().galley(r.center() - g.size() / 2.0, g, color);
            if crate::clicks::pressed(&resp) {
                picked = Some(mode);
            }
        }
    });
    picked
}

// ---------------------------------------------------------------------------------------------
// The preview pane.

/// Draws the preview into `rect`. Returns true when the user scrolled it.
fn show_preview(ui: &mut Ui, p: &mut Preview, rect: Rect, path: &Path, env: &Env) -> bool {
    let t = &theme::T;
    p.rect = Some(rect);
    let width = rect.width();
    if (width - p.heights_w).abs() > 0.5 {
        p.heights.iter_mut().for_each(|h| *h = f32::NAN);
        p.heights_w = width;
    }
    let mut child = ui.new_child(egui::UiBuilder::new().max_rect(rect).layout(egui::Layout::top_down(egui::Align::Min)));
    child.set_clip_rect(rect.intersect(ui.clip_rect()));
    child.painter().rect_filled(rect, 0.0, t.island_bg);
    let pane = child.interact(rect, crate::workspace::wid(("md-preview", path)), Sense::hover());
    crate::util::label_widget(&pane, egui::WidgetType::Other, format!("Markdown preview {}", path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default()));
    let mut area = egui::ScrollArea::vertical().id_salt(("md-preview-scroll", path)).auto_shrink([false, false]);
    let jumped = p.scroll_to.take();
    if let Some(y) = jumped {
        area = area.vertical_scroll_offset(y.max(0.0));
    }
    let base_dir = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let mut want = Vec::new();
    let mut clicked: Option<String> = None;
    let mut links = Vec::new();
    let out = area.show_viewport(&mut child, |ui, viewport| {
        let origin = ui.min_rect().min;
        let blocks = p.blocks.clone();
        let mut tops = Vec::with_capacity(blocks.len());
        let mut y = PAD / 2.0;
        let mut changed = false;
        let view = viewport.expand2(vec2(0.0, 200.0));
        for (i, b) in blocks.iter().enumerate() {
            tops.push(y);
            let h = p.height(i);
            if y + h >= view.min.y && y <= view.max.y {
                let mut d = Draw { ui, origin, width, images: &mut p.images, want: &mut want, clicked: &mut clicked, links: &mut links, id: crate::workspace::wid(("md-block", path, i)) };
                let drawn = d.block(b, y);
                if (drawn - h).abs() > 0.5 {
                    changed = true;
                }
                p.heights[i] = drawn;
                y += drawn;
            } else {
                y += h;
            }
        }
        y += PAD;
        p.tops = tops;
        ui.allocate_rect(Rect::from_min_size(origin, vec2(width, y)), Sense::hover());
        if changed {
            ui.ctx().request_repaint();
        }
    });
    p.links = links;
    let user_scrolled = jumped.is_none() && (out.state.offset.y - p.offset).abs() > 0.5;
    p.offset = out.state.offset.y;
    for url in want {
        request_image(p, env, &base_dir, url, path);
    }
    if let Some(url) = clicked {
        open_link(p, env, &base_dir, &url);
    }
    user_scrolled
}

/// Where a relative link or image points: next to the Markdown file, or under the project
/// root for a leading `/`. `None` for a URL with a scheme.
fn resolve(base_dir: &Path, root: Option<&Path>, url: &str) -> Option<PathBuf> {
    if url.contains("://") || url.starts_with("mailto:") || url.starts_with("data:") {
        return None;
    }
    let path = url.split(['#', '?']).next().unwrap_or("");
    if path.is_empty() {
        return None;
    }
    let path = path.replace("%20", " ");
    Some(match path.strip_prefix('/') {
        Some(rest) => root.unwrap_or(base_dir).join(rest),
        None => base_dir.join(path),
    })
}

fn request_image(p: &mut Preview, env: &Env, base_dir: &Path, url: String, md: &Path) {
    let Some(file) = resolve(base_dir, env.root, &url) else {
        // No network: a remote image shows its alt text.
        p.images.insert(url, Slot::Pic(Pic::Failed("remote".into())));
        return;
    };
    p.images.insert(url.clone(), Slot::Loading);
    let md = md.to_path_buf();
    env.jobs.spawn_quiet(
        move || super::load(&file),
        move |state, res| {
            let Some(id) = state.ws.tabs.editor_by_path(&md) else { return };
            let Some(p) = state.ws.tabs.editor_mut(id).and_then(|e| e.markdown.as_deref_mut()) else { return };
            p.images.insert(url, Slot::Pic(Pic::from_result(res)));
        },
    );
}

fn open_link(p: &mut Preview, env: &Env, base_dir: &Path, url: &str) {
    if let Some(anchor) = url.strip_prefix('#') {
        let target = p.blocks.iter().position(|b| matches!(&b.kind, Kind::Heading { anchor: a, .. } if a == anchor));
        if let Some(y) = target.and_then(|i| p.tops.get(i)) {
            p.scroll_to = Some(*y);
        }
        return;
    }
    match resolve(base_dir, env.root, url) {
        Some(file) => env.jobs.post(move |state| state.open_location(&file, None, true)),
        None => {
            let url = url.to_string();
            env.jobs.post(move |state| {
                if let Err(e) = state.platform.open_url(&url) {
                    state.notifications.error(format!("Cannot open {url}"), e);
                }
            });
        }
    }
}

struct Draw<'a, 'u> {
    ui: &'u mut Ui,
    origin: egui::Pos2,
    width: f32,
    images: &'a mut HashMap<String, Slot>,
    want: &'a mut Vec<String>,
    clicked: &'a mut Option<String>,
    links: &'a mut Vec<LinkHit>,
    id: Id,
}

impl Draw<'_, '_> {
    /// Draws block `b` with its top at content y `y`. Returns its height, gap included.
    fn block(&mut self, b: &Block, y: f32) -> f32 {
        let t = &theme::T;
        let left = PAD + b.quote as f32 * QUOTE_INDENT + b.indent as f32 * LIST_INDENT;
        let x = self.origin.x + left;
        let w = (self.width - left - PAD).max(40.0);
        let top = self.origin.y + y;
        let color = if b.quote > 0 { t.preview_quote } else { t.text };
        let body = FontId::proportional(t.font.preview);
        let h = match &b.kind {
            Kind::Heading { level, text, .. } => {
                let size = t.font.preview_headings[(*level as usize).clamp(1, 6) - 1];
                let top = top + if *level <= 2 { 6.0 } else { 2.0 };
                let mut h = self.inline(text, x, top, w, size, t.text_bright, true) + 4.0;
                if *level <= 2 {
                    self.ui.painter().hline(x..=x + w, top + h, Stroke::new(1.0_f32, t.border));
                    h += 6.0;
                }
                h + (top - self.origin.y - y)
            }
            Kind::Para(text) => self.inline(text, x, top, w, t.font.preview, color, false),
            Kind::Item { marker, text } => {
                let galley_h = self.inline(text, x, top, w, t.font.preview, color, false);
                let row = self.ui.fonts(|f| f.row_height(&body));
                let mid = pos2(x - LIST_INDENT / 2.0, top + row / 2.0);
                let p = self.ui.painter();
                match marker {
                    Marker::Bullet if b.indent.is_multiple_of(2) => {
                        p.circle_stroke(mid, 2.5, Stroke::new(1.0_f32, color));
                    }
                    Marker::Bullet => {
                        p.circle_filled(mid, 2.5, color);
                    }
                    Marker::Number(n) => {
                        p.text(pos2(x - 6.0, top), Align2::RIGHT_TOP, format!("{n}."), body.clone(), color);
                    }
                    Marker::Task(done) => {
                        let r = Rect::from_center_size(mid, Vec2::splat(theme::CHECKBOX_SIZE - 2.0));
                        if *done {
                            p.rect_filled(r, t.radius.small, t.accent);
                            let s = Stroke::new(1.6_f32, t.on_accent);
                            p.line_segment([r.left_center() + vec2(2.5, 0.0), r.center_bottom() + vec2(-1.0, -3.0)], s);
                            p.line_segment([r.center_bottom() + vec2(-1.0, -3.0), r.right_top() + vec2(-2.5, 3.0)], s);
                        } else {
                            p.rect_stroke(r, t.radius.small, Stroke::new(1.0_f32, t.checkbox_border), egui::StrokeKind::Inside);
                        }
                    }
                }
                galley_h
            }
            Kind::Code(code) => {
                let mut job = LayoutJob::simple(code.clone(), FontId::monospace(t.font.mono), t.text, w - 2.0 * CELL_PAD);
                job.wrap.break_anywhere = true;
                let g = self.ui.fonts(|f| f.layout_job(job));
                let r = Rect::from_min_size(pos2(x, top), vec2(w, g.size().y + 2.0 * CELL_PAD));
                self.ui.painter().rect_filled(r, t.radius.small, t.input_bg);
                self.ui.painter().galley(r.min + Vec2::splat(CELL_PAD), g, t.text);
                r.height()
            }
            Kind::Rule => {
                self.ui.painter().hline(x..=x + w, top + 6.0, Stroke::new(1.0_f32, t.border));
                12.0
            }
            Kind::Table { aligns, head, rows } => self.table(aligns, head, rows, x, top, w),
            Kind::Images(imgs) => self.images_row(imgs, x, top, w, color),
        };
        if b.quote > 0 {
            for q in 0..b.quote {
                let bx = self.origin.x + PAD + q as f32 * QUOTE_INDENT + 2.0;
                self.ui.painter().vline(bx, top - GAP / 2.0..=top + h, Stroke::new(3.0_f32, t.preview_quote.gamma_multiply(0.5)));
            }
        }
        h + GAP
    }

    /// Lays out and paints inline text; links become click widgets. Returns the height.
    #[allow(clippy::too_many_arguments)]
    fn inline(&mut self, text: &Inline, x: f32, top: f32, w: f32, size: f32, color: Color32, bold: bool) -> f32 {
        let (job, ranges) = inline_job(text, size, color, w, bold);
        let g = self.ui.fonts(|f| f.layout_job(job));
        let pos = pos2(x, top);
        let h = g.size().y;
        for (k, (range, url)) in ranges.iter().enumerate() {
            let label: String = text_of(&g, range);
            for (s, r) in link_rects(&g, range).into_iter().enumerate() {
                let r = r.translate(pos.to_vec2());
                let resp = self.ui.interact(r, self.id.with(("link", k, s)), Sense::click());
                crate::util::label_widget(&resp, egui::WidgetType::Link, format!("Link {label}"));
                if resp.hovered() {
                    self.ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
                }
                if resp.clicked() {
                    *self.clicked = Some(url.clone());
                }
                if s == 0 {
                    self.links.push(LinkHit { text: label.clone(), url: url.clone(), rect: r });
                }
            }
        }
        self.ui.painter().galley(pos, g, color);
        h
    }

    #[allow(clippy::too_many_arguments)]
    fn table(&mut self, aligns: &[Alignment], head: &[Inline], rows: &[Vec<Inline>], x: f32, top: f32, w: f32) -> f32 {
        let t = &theme::T;
        let cols = head.len().max(rows.iter().map(Vec::len).max().unwrap_or(0));
        if cols == 0 {
            return 0.0;
        }
        let size = t.font.preview;
        let natural = |cell: &Inline, bold: bool, ui: &Ui| {
            let (job, _) = inline_job(cell, size, t.text, f32::INFINITY, bold);
            ui.fonts(|f| f.layout_job(job)).size().x + 2.0 * CELL_PAD
        };
        let mut col_w = vec![40.0_f32; cols];
        for (c, cell) in head.iter().enumerate() {
            col_w[c] = col_w[c].max(natural(cell, true, self.ui));
        }
        for row in rows {
            for (c, cell) in row.iter().enumerate() {
                col_w[c] = col_w[c].max(natural(cell, false, self.ui));
            }
        }
        let total: f32 = col_w.iter().sum();
        if total > w {
            let k = w / total;
            col_w.iter_mut().for_each(|c| *c = (*c * k).max(40.0));
        }
        let table_w: f32 = col_w.iter().sum();
        let mut y = top;
        let empty = Inline::default();
        let all = std::iter::once((head, true)).chain(rows.iter().map(|r| (r.as_slice(), false)));
        for (r, (cells, is_head)) in all.enumerate() {
            let galleys: Vec<_> = (0..cols)
                .map(|c| {
                    let cell = cells.get(c).unwrap_or(&empty);
                    let (job, ranges) = inline_job(cell, size, t.text, col_w[c] - 2.0 * CELL_PAD, is_head);
                    (self.ui.fonts(|f| f.layout_job(job)), ranges)
                })
                .collect();
            let row_h = galleys.iter().map(|(g, _)| g.size().y).fold(0.0, f32::max) + 2.0 * CELL_PAD;
            let row_rect = Rect::from_min_size(pos2(x, y), vec2(table_w, row_h));
            if is_head {
                self.ui.painter().rect_filled(row_rect, 0.0, t.tab_active_bg);
            }
            let mut cx = x;
            for (c, (g, ranges)) in galleys.into_iter().enumerate() {
                let cell_w = col_w[c];
                let gx = match aligns.get(c) {
                    Some(Alignment::Center) => cx + (cell_w - g.size().x) / 2.0,
                    Some(Alignment::Right) => cx + cell_w - CELL_PAD - g.size().x,
                    _ => cx + CELL_PAD,
                };
                let gpos = pos2(gx, y + CELL_PAD);
                for (k, (range, url)) in ranges.iter().enumerate() {
                    let label = text_of(&g, range);
                    if let Some(rect) = link_rects(&g, range).into_iter().next() {
                        let rect = rect.translate(gpos.to_vec2());
                        let resp = self.ui.interact(rect, self.id.with(("cell-link", r, c, k)), Sense::click());
                        crate::util::label_widget(&resp, egui::WidgetType::Link, format!("Link {label}"));
                        if resp.hovered() {
                            self.ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
                        }
                        if resp.clicked() {
                            *self.clicked = Some(url.clone());
                        }
                        self.links.push(LinkHit { text: label, url: url.clone(), rect });
                    }
                }
                self.ui.painter().galley(gpos, g, t.text);
                if c > 0 {
                    self.ui.painter().vline(cx, row_rect.y_range(), Stroke::new(1.0_f32, t.border));
                }
                cx += cell_w;
            }
            self.ui.painter().rect_stroke(row_rect, 0.0, Stroke::new(1.0_f32, t.border), egui::StrokeKind::Inside);
            y += row_h - 1.0;
        }
        y - top + 1.0
    }

    fn images_row(&mut self, imgs: &[Img], x: f32, top: f32, w: f32, color: Color32) -> f32 {
        let t = &theme::T;
        let (mut cx, mut cy, mut row_h) = (x, top, 0.0_f32);
        for (k, img) in imgs.iter().enumerate() {
            let slot = self.images.get_mut(&img.url);
            if slot.is_none() {
                self.want.push(img.url.clone());
            }
            let ctx = self.ui.ctx().clone();
            let ready = match slot {
                Some(Slot::Pic(p)) => p.ready(&ctx, &img.url),
                _ => None,
            };
            let (size, tex) = match ready {
                Some(r) => {
                    let natural = vec2(r.width.max(1) as f32, r.height.max(1) as f32);
                    let s = (w / natural.x).min(1.0);
                    (natural * s, Some(r.tex.id()))
                }
                None => {
                    let text = if img.alt.is_empty() { "[image]".to_string() } else { format!("[{}]", img.alt) };
                    let g = self.ui.painter().layout_no_wrap(text, FontId::proportional(t.font.preview), t.text_dim);
                    (g.size(), None)
                }
            };
            if cx > x && cx + size.x > x + w {
                cx = x;
                cy += row_h + 4.0;
                row_h = 0.0;
            }
            let r = Rect::from_min_size(pos2(cx, cy), size);
            match tex {
                Some(id) => {
                    self.ui.painter().image(id, r, Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)), t.image_tint);
                }
                None => {
                    let text = if img.alt.is_empty() { "[image]".to_string() } else { format!("[{}]", img.alt) };
                    let c = if img.link.is_some() { t.link } else { color };
                    self.ui.painter().text(r.min, Align2::LEFT_TOP, text, FontId::proportional(t.font.preview), c);
                }
            }
            let resp = self.ui.interact(r, self.id.with(("img", k)), if img.link.is_some() { Sense::click() } else { Sense::hover() });
            crate::util::label_widget(&resp, egui::WidgetType::Image, format!("Image {}", if img.alt.is_empty() { &img.url } else { &img.alt }));
            if let Some(url) = &img.link {
                if resp.hovered() {
                    self.ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
                }
                if resp.clicked() {
                    *self.clicked = Some(url.clone());
                }
            }
            cx = r.max.x + 4.0;
            row_h = row_h.max(size.y);
        }
        cy + row_h - top
    }
}

/// The layout job of inline text, plus the char ranges of its links.
fn inline_job(text: &Inline, size: f32, color: Color32, wrap: f32, bold: bool) -> (LayoutJob, Vec<(Range<usize>, String)>) {
    let t = &theme::T;
    let mut job = LayoutJob::default();
    job.wrap.max_width = wrap;
    let mut ranges: Vec<(Range<usize>, String)> = Vec::new();
    let mut chars = 0;
    for r in &text.runs {
        let font = if r.style & CODE != 0 {
            FontId::monospace(size * 0.9)
        } else if bold || r.style & BOLD != 0 {
            t.semibold(size)
        } else {
            FontId::proportional(size)
        };
        let c = if r.link.is_some() { t.link } else { color };
        let mut f = TextFormat { font_id: font, color: c, italics: r.style & ITALIC != 0, ..TextFormat::default() };
        if r.style & STRIKE != 0 {
            f.strikethrough = Stroke::new(1.0_f32, c);
        }
        if r.style & CODE != 0 {
            f.background = t.code_bg;
        }
        let n = r.text.chars().count();
        if let Some(url) = &r.link {
            match ranges.last_mut() {
                Some((range, u)) if u == url && range.end == chars => range.end += n,
                _ => ranges.push((chars..chars + n, url.clone())),
            }
        }
        chars += n;
        job.append(&r.text, 0.0, f);
    }
    (job, ranges)
}

fn text_of(g: &Galley, range: &Range<usize>) -> String {
    g.job.text.chars().skip(range.start).take(range.len()).collect()
}

/// The rects (galley coordinates) a char range covers, one per row.
fn link_rects(g: &Galley, range: &Range<usize>) -> Vec<Rect> {
    let mut out = Vec::new();
    let mut start = 0;
    for row in &g.rows {
        let n = row.char_count_excluding_newline();
        let (a, b) = (range.start.max(start), range.end.min(start + n));
        if a < b {
            let first = &row.glyphs[a - start];
            let last = &row.glyphs[b - 1 - start];
            out.push(Rect::from_x_y_ranges(first.pos.x..=last.pos.x + last.advance_width, row.rect.y_range()));
        }
        start += row.char_count_including_newline();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(md: &str) -> Vec<Kind> {
        parse(md).into_iter().map(|b| b.kind).collect()
    }

    #[test]
    fn headings_paragraphs_and_lines() {
        let b = parse("# Title\n\nSome *text* with `code`\nand more.\n\n## Two words\n");
        assert_eq!(b.len(), 3);
        assert!(matches!(&b[0].kind, Kind::Heading { level: 1, anchor, .. } if anchor == "title"));
        assert_eq!(b[1].line, 2);
        let Kind::Para(p) = &b[1].kind else { panic!("paragraph") };
        assert_eq!(p.plain(), "Some text with code and more.");
        assert_eq!(p.runs[1], Run { text: "text".into(), style: ITALIC, link: None });
        assert_eq!(p.runs[3].style, CODE);
        assert!(matches!(&b[2].kind, Kind::Heading { level: 2, anchor, .. } if anchor == "two-words"));
        assert_eq!(b[2].line, 5);
    }

    #[test]
    fn lists_nest_and_number() {
        let b = parse("- a\n  - b\n- [x] done\n\n3. three\n4. four\n");
        let got: Vec<(u8, Marker, String)> = b
            .iter()
            .map(|b| match &b.kind {
                Kind::Item { marker, text } => (b.indent, *marker, text.plain()),
                k => panic!("item expected, got {k:?}"),
            })
            .collect();
        assert_eq!(
            got,
            [(1, Marker::Bullet, "a".into()), (2, Marker::Bullet, "b".into()), (1, Marker::Task(true), "done".into()), (1, Marker::Number(3), "three".into()), (1, Marker::Number(4), "four".into())]
        );
    }

    #[test]
    fn code_tables_quotes_links_and_images() {
        let md = "```rust\nfn x() {}\n```\n\n| A | B |\n|:--|--:|\n| 1 | [l](http://x) |\n\n> quoted\n\n---\n\nSee [docs](docs/a.md) ![logo](img/logo.png) after\n\n<img src=\"a.png\" alt=\"html\">\n";
        let k = kinds(md);
        assert_eq!(k[0], Kind::Code("fn x() {}".into()));
        let Kind::Table { aligns, head, rows } = &k[1] else { panic!("table") };
        assert_eq!(aligns, &[Alignment::Left, Alignment::Right]);
        assert_eq!(head[1].plain(), "B");
        assert_eq!(rows[0][1].runs[0].link.as_deref(), Some("http://x"));
        let q = parse(md);
        assert_eq!(q[2].quote, 1);
        assert_eq!(k[3], Kind::Rule);
        let Kind::Para(p) = &k[4] else { panic!("text before the image") };
        assert_eq!(p.plain().trim(), "See docs");
        assert!(matches!(&k[5], Kind::Images(v) if v[0].url == "img/logo.png" && v[0].alt == "logo"));
        assert!(matches!(&k[6], Kind::Para(p) if p.plain().trim() == "after"));
        assert!(matches!(&k[7], Kind::Images(v) if v[0].url == "a.png" && v[0].alt == "html"));
    }

    #[test]
    fn badges_share_one_row() {
        let k = kinds("[![ci](ci.svg)](https://ci) [![v](v.svg)](https://v)\n");
        let Kind::Images(v) = &k[0] else { panic!("images") };
        assert_eq!(v.len(), 2);
        assert_eq!(v[1].link.as_deref(), Some("https://v"));
        assert_eq!(k.len(), 1);
    }

    #[test]
    fn links_resolve_next_to_the_file() {
        let base = Path::new("/p/docs");
        assert_eq!(resolve(base, Some(Path::new("/p")), "a.md#x"), Some(PathBuf::from("/p/docs/a.md")));
        assert_eq!(resolve(base, Some(Path::new("/p")), "/img/a%20b.png"), Some(PathBuf::from("/p/img/a b.png")));
        assert_eq!(resolve(base, None, "https://x.org/a.png"), None);
        assert_eq!(resolve(base, None, "#anchor"), None);
    }

    #[test]
    fn sync_maps_lines_to_block_tops_and_back() {
        let mut p = Preview::default();
        p.set_blocks(parse("# A\n\npara\n\n# B\n"), 1);
        p.tops = vec![0.0, 40.0, 80.0];
        assert_eq!(p.y_of_line(2.0), Some(40.0));
        assert_eq!(p.y_of_line(3.0), Some(60.0), "between two blocks");
        assert_eq!(p.line_of_y(60.0), Some(3.0));
        assert_eq!(p.line_of_y(0.0), Some(0.0));
    }
}
