use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::ops::Range;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use egui::text::{LayoutJob, LayoutSection};
use egui::{
    Align, Align2, Button, Color32, CursorIcon, Event, EventFilter, FontId, Galley, Id, Key,
    Layout, Modifiers, Pos2, Rect, ScrollArea, Sense, Stroke, TextFormat, Ui, UiBuilder, Vec2,
    ViewportCommand,
};

use crate::document::{Document, EditKind, Position, Selection};
use crate::editing::{self, col_from_display, display_col};
use crate::highlight::{HlKind, Span};

/// Extra per-line marks drawn in the gutter (git change bars).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum GutterMark {
    Added,
    Modified,
    /// Lines were deleted just above this line.
    Deleted,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EditorAction {
    /// Context menu, Cmd+B, Cmd+click.
    GoToDeclaration(Position),
    /// Context menu "Go to Source Definition" (real .js in node_modules).
    GoToSourceDefinition(Position),
    /// Context menu, Cmd+Shift+B.
    GoToTypeDefinition(Position),
    /// Context menu, Alt+F7.
    FindUsages(Position),
    /// Context menu "Git > Annotate with Git Blame".
    GitAnnotate,
    /// Context menu "Git > Show History".
    GitShowHistory,
    /// Context menu "Git > Rollback Lines" (only if lines changed).
    GitRollbackLines,
}

pub struct EditorResponse {
    pub changed: bool,
    /// Set when the user picked an item in the editor context menu or used its shortcut.
    pub action: Option<EditorAction>,
    /// The document position under the mouse, for hover info.
    pub hover: Option<Position>,
    /// A click on the line number / change bar column, with the line it hit.
    pub gutter_clicked: Option<usize>,
    /// A click on the annotation (blame) column, with the line it hit.
    pub annotation_clicked: Option<usize>,
    /// Caret position after this frame, for the status bar.
    pub cursor: Position,
    pub has_focus: bool,
    /// The text area's response; lets the app attach tooltips or its own popups.
    pub response: egui::Response,
}

/// Colors. Defaults are Darcula-like to match IDEA.
#[derive(Clone, Debug, PartialEq)]
pub struct EditorTheme {
    pub background: Color32,
    pub foreground: Color32,
    pub gutter_background: Color32,
    pub gutter_separator: Color32,
    pub line_number: Color32,
    pub line_number_current: Color32,
    pub current_line: Color32,
    pub selection: Color32,
    pub caret: Color32,
    pub link: Color32,
    pub annotation: Color32,
    pub mark_added: Color32,
    pub mark_modified: Color32,
    pub mark_deleted: Color32,
    /// Indexed by `HlKind as usize`.
    pub kinds: [Color32; HlKind::COUNT],
}

impl Default for EditorTheme {
    fn default() -> Self {
        EditorTheme::darcula()
    }
}

impl EditorTheme {
    pub fn darcula() -> EditorTheme {
        let hex = |v: u32| Color32::from_rgb((v >> 16) as u8, (v >> 8) as u8, v as u8);
        let fg = hex(0xA9B7C6);
        let mut kinds = [fg; HlKind::COUNT];
        let mut set = |k: HlKind, c: u32| kinds[k as usize] = hex(c);
        set(HlKind::Keyword, 0xCC7832);
        set(HlKind::String, 0x6A8759);
        set(HlKind::Escape, 0xCC7832);
        set(HlKind::Number, 0x6897BB);
        set(HlKind::Comment, 0x808080);
        set(HlKind::DocComment, 0x629755);
        set(HlKind::Function, 0xFFC66D);
        set(HlKind::Macro, 0x4EADE5);
        set(HlKind::Type, 0x4EC9B0);
        set(HlKind::Property, 0x9876AA);
        set(HlKind::Constant, 0x9876AA);
        set(HlKind::Builtin, 0xCC7832);
        set(HlKind::Variable, 0xA9B7C6);
        set(HlKind::Parameter, 0xA9B7C6);
        set(HlKind::Operator, 0xA9B7C6);
        set(HlKind::Punctuation, 0xA9B7C6);
        set(HlKind::Tag, 0xE8BF6A);
        set(HlKind::Attribute, 0xBABABA);
        set(HlKind::Title, 0xFFC66D);
        set(HlKind::Link, 0x287BDE);
        EditorTheme {
            background: hex(0x2B2B2B),
            foreground: fg,
            gutter_background: hex(0x313335),
            gutter_separator: hex(0x3C3F41),
            line_number: hex(0x606366),
            line_number_current: hex(0xA4A3A3),
            current_line: hex(0x323232),
            selection: hex(0x214283),
            caret: hex(0xBBBBBB),
            link: hex(0x589DF6),
            annotation: hex(0x8C8C8C),
            mark_added: hex(0x384C38),
            mark_modified: hex(0x374752),
            mark_deleted: hex(0x656E76),
            kinds,
        }
    }

    pub fn color(&self, kind: HlKind) -> Color32 {
        self.kinds[kind as usize]
    }

    fn fingerprint(&self) -> u64 {
        let mut h = DefaultHasher::new();
        self.foreground.hash(&mut h);
        self.kinds.hash(&mut h);
        h.finish()
    }
}

struct HighlightCache {
    version: (u64, u64),
    lines: Range<usize>,
    spans: Vec<Vec<Span>>,
}

static NEXT_STATE_ID: AtomicU64 = AtomicU64::new(1);

/// Per-tab view state: caret, selection, scroll and render caches.
pub struct EditorState {
    id: u64,
    sel: Selection,
    /// Display column that Up/Down try to keep, so moving through a short line does not lose it.
    preferred_col: Option<usize>,
    scroll: Vec2,
    viewport: Vec2,
    pending_reveal: Option<Position>,
    pending_selection: Option<(Position, Position)>,
    pending_focus: bool,
    dragging: bool,
    menu_pos: Position,
    cursor_pos: Position,
    highlight: Option<HighlightCache>,
    /// Line galleys keyed by a hash of their text, spans and style. Keying by content instead of
    /// line number keeps entries valid when lines above are inserted or deleted.
    galleys: HashMap<u64, (Arc<Galley>, u64)>,
    frame: u64,
    geometry: Option<EditorGeometry>,
}

/// Where the last frame put things on screen. Tests aim pointer events with it; a popup can
/// anchor at a character.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EditorGeometry {
    pub text_rect: Rect,
    pub gutter_rect: Rect,
    /// Screen position of line 0, display column 0 (scroll applied).
    pub origin: Pos2,
    pub char_w: f32,
    pub line_h: f32,
    /// Width of the annotation (blame) column at the left of the gutter; 0 when hidden.
    pub annotation_w: f32,
    /// Left edge of the change-mark bars.
    pub mark_x: f32,
}

impl EditorGeometry {
    /// Center of the character cell at `pos` (tabs expanded like the renderer does).
    pub fn char_center(&self, doc: &Document, pos: Position) -> Pos2 {
        let col = display_col(&doc.line(pos.line), pos.column) as f32;
        Pos2::new(self.origin.x + (col + 0.5) * self.char_w, self.origin.y + (pos.line as f32 + 0.5) * self.line_h)
    }

    /// A point on the change-mark bar of `line`.
    pub fn mark_center(&self, line: usize) -> Pos2 {
        Pos2::new(self.mark_x + MARK_W / 2.0, self.origin.y + (line as f32 + 0.5) * self.line_h)
    }

    /// A point inside the annotation column of `line`.
    pub fn annotation_center(&self, line: usize) -> Pos2 {
        Pos2::new(self.gutter_rect.min.x + self.annotation_w / 2.0, self.origin.y + (line as f32 + 0.5) * self.line_h)
    }
}

impl Default for EditorState {
    fn default() -> Self {
        EditorState::new()
    }
}

impl EditorState {
    pub fn new() -> EditorState {
        EditorState {
            id: NEXT_STATE_ID.fetch_add(1, Ordering::Relaxed),
            sel: Selection::default(),
            preferred_col: None,
            scroll: Vec2::ZERO,
            viewport: Vec2::new(800.0, 600.0),
            pending_reveal: None,
            pending_selection: None,
            pending_focus: false,
            dragging: false,
            menu_pos: Position::default(),
            cursor_pos: Position::default(),
            highlight: None,
            galleys: HashMap::new(),
            frame: 0,
            geometry: None,
        }
    }

    /// Screen geometry of the last frame; `None` before the first frame.
    pub fn geometry(&self) -> Option<EditorGeometry> {
        self.geometry
    }

    /// Move the cursor and scroll it to the center.
    pub fn reveal(&mut self, pos: Position) {
        self.pending_reveal = Some(pos);
        self.pending_selection = None;
    }

    /// Caret position as of the last frame.
    pub fn cursor(&self) -> Position {
        self.cursor_pos
    }

    /// Raw selection in char indices, as of the last frame.
    pub fn selection(&self) -> Selection {
        self.sel
    }

    /// Selects from `anchor` to `head` on the next frame, without scrolling.
    pub fn set_selection(&mut self, anchor: Position, head: Position) {
        self.pending_selection = Some((anchor, head));
    }

    /// Gives the editor keyboard focus on the next frame (e.g. after opening a tab).
    pub fn request_focus(&mut self) {
        self.pending_focus = true;
    }

    pub fn scroll_offset(&self) -> Vec2 {
        self.scroll
    }

    /// Drops render caches, e.g. after changing fonts.
    pub fn clear_caches(&mut self) {
        self.highlight = None;
        self.galleys.clear();
    }

    fn set_head(&mut self, idx: usize, extend: bool) {
        self.sel.head = idx;
        if !extend {
            self.sel.anchor = idx;
        }
    }
}

pub struct EditorView<'a> {
    doc: &'a mut Document,
    state: &'a mut EditorState,
    marks: &'a [(usize, GutterMark)],
    annotations: &'a [String],
    theme: Option<&'a EditorTheme>,
    font_size: f32,
    read_only: bool,
}

const MARK_W: f32 = 5.0;
const TEXT_PAD: f32 = 6.0;
/// Lines longer than this (in display columns) are laid out in windows around the visible part.
const LONG_LINE: usize = 2000;
const LONG_LINE_WINDOW: usize = 1024;

enum MenuCmd {
    Action(EditorAction),
    Cut,
    Copy,
    Paste,
    Comment,
}

impl<'a> EditorView<'a> {
    pub fn new(doc: &'a mut Document, state: &'a mut EditorState) -> Self {
        EditorView { doc, state, marks: &[], annotations: &[], theme: None, font_size: 13.0, read_only: false }
    }

    pub fn gutter_marks(mut self, marks: &'a [(usize, GutterMark)]) -> Self {
        self.marks = marks;
        self
    }

    /// Per-line text for an annotation column (git blame), indexed by line. Empty hides it.
    pub fn annotations(mut self, annotations: &'a [String]) -> Self {
        self.annotations = annotations;
        self
    }

    pub fn theme(mut self, theme: &'a EditorTheme) -> Self {
        self.theme = Some(theme);
        self
    }

    pub fn font_size(mut self, size: f32) -> Self {
        self.font_size = size;
        self
    }

    /// Ignores every edit (typing, paste, cut, undo, Git rollback stays the app's business).
    /// Navigation, selection, copy and the context-menu actions keep working.
    pub fn read_only(mut self, read_only: bool) -> Self {
        self.read_only = read_only;
        self
    }

    pub fn show(self, ui: &mut Ui) -> EditorResponse {
        let EditorView { doc, state, marks, annotations, theme, font_size, read_only } = self;
        let default_theme;
        let theme = match theme {
            Some(t) => t,
            None => {
                default_theme = EditorTheme::darcula();
                &default_theme
            }
        };
        state.frame += 1;

        let font = FontId::monospace(font_size);
        let (char_w, row_h) = ui.fonts(|f| (f.glyph_width(&font, 'M'), f.row_height(&font)));
        let line_h = (row_h * 1.25).round();

        // External edits (rollback, reload) can shrink the text under a stale selection.
        let len = doc.len_chars();
        state.sel.anchor = state.sel.anchor.min(len);
        state.sel.head = state.sel.head.min(len);
        if let Some((a, h)) = state.pending_selection.take() {
            state.sel = Selection::new(doc.position_to_char(a), doc.position_to_char(h));
        }

        let rect = ui.available_rect_before_wrap();
        ui.allocate_rect(rect, Sense::hover());
        ui.painter().rect_filled(rect, 0.0, theme.background);

        let line_count = doc.line_count();
        let digits = line_count.to_string().len().max(2) as f32;
        let ann_chars = annotations.iter().map(|a| a.chars().count()).max().unwrap_or(0).min(40);
        let ann_w = if ann_chars > 0 { (ann_chars as f32 + 2.0) * char_w } else { 0.0 };
        let numbers_w = (digits + 2.0) * char_w;
        let gutter_w = ann_w + numbers_w + MARK_W + 6.0;
        let gutter_rect = Rect::from_min_size(rect.min, Vec2::new(gutter_w, rect.height()));
        let text_rect = Rect::from_min_max(Pos2::new(rect.min.x + gutter_w, rect.min.y), rect.max);

        let id = Id::new(("ide-editor", state.id));
        let resp = ui.interact(text_rect, id, Sense::click_and_drag());
        let gutter_resp = ui.interact(gutter_rect, id.with("gutter"), Sense::click());
        // Accessibility names, which UI tests also use to find the editor.
        let name = doc.path().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        resp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Other, true, format!("Editor {name}")));
        gutter_resp.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Other, true, format!("Gutter {name}")));

        let mut out_action = None;
        let mut gutter_clicked = None;
        let mut annotation_clicked = None;
        let mut caret_moved = false;
        let version_before = doc.version();

        if std::mem::take(&mut state.pending_focus) {
            resp.request_focus();
        }

        let modifiers = ui.input(|i| i.modifiers);
        let origin = text_rect.min + Vec2::new(TEXT_PAD, 0.0) - state.scroll;
        let hit = |doc: &Document, p: Pos2| -> usize {
            let line = (((p.y - origin.y) / line_h).floor().max(0.0) as usize).min(line_count.saturating_sub(1));
            let text = doc.line(line);
            doc.line_start(line) + col_from_display(&text, (p.x - origin.x) / char_w)
        };

        // Mouse. The caret moves on press, not on release, so drag-select starts where the
        // button went down.
        let (pressed, down, pointer) = ui.input(|i| (i.pointer.primary_pressed(), i.pointer.primary_down(), i.pointer.interact_pos()));
        if pressed && resp.hovered() {
            if let Some(p) = pointer {
                resp.request_focus();
                let idx = hit(doc, p);
                state.set_head(idx, modifiers.shift);
                state.dragging = !modifiers.command;
                state.preferred_col = None;
                doc.seal_undo_group();
            }
        }
        if state.dragging {
            if down {
                if let Some(p) = pointer {
                    let idx = hit(doc, p);
                    if idx != state.sel.head {
                        state.sel.head = idx;
                    }
                    if !text_rect.contains(p) {
                        caret_moved = true;
                        ui.ctx().request_repaint();
                    }
                }
            } else {
                state.dragging = false;
            }
        }
        if resp.triple_clicked() {
            let line = doc.char_to_position(state.sel.head).line;
            let end = if line + 1 < line_count { doc.line_start(line + 1) } else { doc.len_chars() };
            state.sel = Selection::new(doc.line_start(line), end);
        } else if resp.double_clicked() {
            let r = editing::word_range(doc, state.sel.head);
            state.sel = Selection::new(r.start, r.end);
        }
        if resp.clicked() && modifiers.command {
            if let Some(p) = resp.interact_pointer_pos() {
                let idx = hit(doc, p);
                state.sel = Selection::caret(idx);
                out_action = Some(EditorAction::GoToDeclaration(doc.char_to_position(idx)));
            }
        }
        if resp.secondary_clicked() {
            if let Some(p) = resp.interact_pointer_pos() {
                resp.request_focus();
                let idx = hit(doc, p);
                // Like IDEA: keep the selection when right-clicking inside it, so "Copy" works.
                if !(state.sel.start() <= idx && idx <= state.sel.end() && !state.sel.is_empty()) {
                    state.sel = Selection::caret(idx);
                }
                state.menu_pos = doc.char_to_position(idx);
                state.preferred_col = None;
            }
        }
        if gutter_resp.clicked() {
            if let Some(p) = gutter_resp.interact_pointer_pos() {
                let line = ((p.y - origin.y) / line_h).floor().max(0.0) as usize;
                if line < line_count {
                    if p.x < gutter_rect.min.x + ann_w {
                        annotation_clicked = Some(line);
                    } else {
                        gutter_clicked = Some(line);
                    }
                }
            }
        }

        // Keyboard.
        let has_focus = resp.has_focus();
        if has_focus {
            ui.memory_mut(|m| {
                m.set_focus_lock_filter(
                    id,
                    EventFilter { tab: true, horizontal_arrows: true, vertical_arrows: true, escape: true },
                )
            });
            let page = ((state.viewport.y / line_h) as usize).saturating_sub(1).max(1);
            let events = ui.input(|i| i.events.clone());
            for ev in events {
                match ev {
                    Event::Text(t) => {
                        if read_only || modifiers.command || modifiers.ctrl || t.is_empty() {
                            continue;
                        }
                        if t.chars().count() == 1 {
                            editing::type_char(doc, &mut state.sel, &t);
                        } else {
                            insert_other(doc, &mut state.sel, &t);
                        }
                        state.preferred_col = None;
                        caret_moved = true;
                    }
                    Event::Copy => {
                        ui.ctx().copy_text(copy_text(doc, &state.sel));
                    }
                    Event::Cut if read_only => {
                        ui.ctx().copy_text(copy_text(doc, &state.sel));
                    }
                    Event::Cut => {
                        cut(ui, doc, &mut state.sel);
                        caret_moved = true;
                    }
                    Event::Paste(_) if read_only => {}
                    Event::Paste(t) => {
                        insert_other(doc, &mut state.sel, &t);
                        caret_moved = true;
                    }
                    Event::Key { key, pressed: true, modifiers: m, .. } => {
                        if read_only && is_edit_key(key, m) {
                            continue;
                        }
                        if let Some(action) = on_key(doc, state, key, m, page) {
                            out_action = Some(action);
                        }
                        caret_moved = true;
                    }
                    _ => {}
                }
            }
        }

        // Context menu. Commands are collected first and applied after the closure, which keeps
        // the borrow of `doc` simple.
        let mut menu_cmd = None;
        let menu_pos = state.menu_pos;
        let sel_lines = editing::selected_lines(doc, &state.sel);
        let lines_changed = marks.iter().any(|(l, _)| sel_lines.contains(l));
        let has_comment = doc.language().comment_tokens().is_some();
        resp.context_menu(|ui| {
            ui.set_min_width(220.0);
            let mut item = |ui: &mut Ui, label: &str, shortcut: &str, enabled: bool, cmd: MenuCmd| {
                let b = Button::new(label).shortcut_text(shortcut);
                if ui.add_enabled(enabled, b).clicked() {
                    menu_cmd = Some(cmd);
                    ui.close_menu();
                }
            };
            item(ui, "Go to Declaration", "⌘B", true, MenuCmd::Action(EditorAction::GoToDeclaration(menu_pos)));
            item(ui, "Go to Source Definition", "", true, MenuCmd::Action(EditorAction::GoToSourceDefinition(menu_pos)));
            // egui's default fonts have ⌘ but no ⇧ or ⌥ glyph; those would draw as boxes.
            item(ui, "Go to Type Definition", "Shift+⌘B", true, MenuCmd::Action(EditorAction::GoToTypeDefinition(menu_pos)));
            item(ui, "Find Usages", "Alt+F7", true, MenuCmd::Action(EditorAction::FindUsages(menu_pos)));
            ui.separator();
            item(ui, "Cut", "⌘X", !read_only, MenuCmd::Cut);
            item(ui, "Copy", "⌘C", true, MenuCmd::Copy);
            item(ui, "Paste", "⌘V", !read_only, MenuCmd::Paste);
            ui.separator();
            item(ui, "Comment with Line Comment", "⌘/", has_comment && !read_only, MenuCmd::Comment);
            ui.separator();
            ui.menu_button("Git", |ui| {
                ui.set_min_width(200.0);
                let mut git = |ui: &mut Ui, label: &str, enabled: bool, a: EditorAction| {
                    if ui.add_enabled(enabled, Button::new(label)).clicked() {
                        menu_cmd = Some(MenuCmd::Action(a));
                        ui.close_menu();
                    }
                };
                git(ui, "Annotate with Git Blame", true, EditorAction::GitAnnotate);
                git(ui, "Show History", true, EditorAction::GitShowHistory);
                git(ui, "Rollback Lines", lines_changed && !read_only, EditorAction::GitRollbackLines);
            });
        });
        match menu_cmd {
            Some(MenuCmd::Action(a)) => out_action = Some(a),
            Some(MenuCmd::Cut) => {
                cut(ui, doc, &mut state.sel);
                caret_moved = true;
            }
            Some(MenuCmd::Copy) => ui.ctx().copy_text(copy_text(doc, &state.sel)),
            // egui cannot read the clipboard directly; this makes the integration send a Paste
            // event next frame, which the keyboard path above handles. Focus makes sure of that.
            Some(MenuCmd::Paste) => {
                resp.request_focus();
                ui.ctx().send_viewport_cmd(ViewportCommand::RequestPaste);
            }
            Some(MenuCmd::Comment) => {
                editing::toggle_comment(doc, &mut state.sel);
                caret_moved = true;
            }
            None => {}
        }

        let changed = doc.version() != version_before;
        let line_count = doc.line_count();

        // Scrolling target for this frame.
        let view = text_rect.size();
        state.viewport = view;
        let content = Vec2::new(
            (doc.max_line_chars() as f32 + 8.0) * char_w + TEXT_PAD * 2.0,
            line_count as f32 * line_h + (view.y - 3.0 * line_h).max(0.0),
        );
        let mut new_scroll = None;
        if let Some(pos) = state.pending_reveal.take() {
            let idx = doc.position_to_char(pos);
            state.sel = Selection::caret(idx);
            state.preferred_col = None;
            let p = doc.char_to_position(idx);
            let x = display_col(&doc.line(p.line), p.column) as f32 * char_w;
            let y = p.line as f32 * line_h - view.y / 2.0 + line_h / 2.0;
            let sx = if x > view.x - 4.0 * char_w { x - view.x / 2.0 } else { 0.0 };
            new_scroll = Some(Vec2::new(sx.max(0.0), y.max(0.0)));
            doc.seal_undo_group();
        } else if caret_moved {
            let p = doc.char_to_position(state.sel.head);
            let x = display_col(&doc.line(p.line), p.column) as f32 * char_w + TEXT_PAD;
            let y = p.line as f32 * line_h;
            let mut s = state.scroll;
            let margin_y = line_h;
            if y < s.y + margin_y * 0.0 {
                s.y = y;
            } else if y + line_h > s.y + view.y - margin_y {
                s.y = y + line_h - view.y + margin_y;
            }
            let margin_x = 4.0 * char_w;
            if x < s.x + margin_x {
                s.x = (x - margin_x * 4.0).max(0.0);
            } else if x > s.x + view.x - margin_x {
                s.x = x - view.x + margin_x * 4.0;
            }
            s.y = s.y.clamp(0.0, (content.y - view.y).max(0.0));
            s.x = s.x.clamp(0.0, (content.x - view.x).max(0.0));
            if s != state.scroll {
                new_scroll = Some(s);
            }
        }

        let caret_pos = doc.char_to_position(state.sel.head);
        state.cursor_pos = caret_pos;

        // Text area.
        let theme_fp = theme.fingerprint();
        let mut child = ui.new_child(UiBuilder::new().max_rect(text_rect).layout(Layout::top_down(Align::Min)));
        let mut area = ScrollArea::both()
            .id_salt(id.with("scroll"))
            .auto_shrink([false, false])
            .drag_to_scroll(false);
        if let Some(s) = new_scroll {
            area = area.scroll_offset(s);
        }
        let hover_word = if modifiers.command && resp.hovered() {
            resp.hover_pos().map(|p| hit(doc, p)).and_then(|i| doc.word_at(doc.char_to_position(i)))
        } else {
            None
        };

        let output = area.show_viewport(&mut child, |ui, viewport| {
            ui.set_min_size(content);
            let origin = ui.max_rect().min + Vec2::new(TEXT_PAD, 0.0);
            let first = ((viewport.min.y / line_h).floor().max(0.0) as usize).min(line_count);
            let last = ((viewport.max.y / line_h).ceil().max(0.0) as usize + 1).min(line_count);
            let visible = first..last;

            let version = doc.highlight_version();
            let cached = state
                .highlight
                .as_ref()
                .is_some_and(|c| c.version == version && c.lines.start <= first && c.lines.end >= last);
            if !cached {
                let margin = visible.len().max(60);
                let lines = first.saturating_sub(margin)..(last + margin).min(line_count);
                let spans = doc.highlight(lines.clone());
                state.highlight = Some(HighlightCache { version: doc.highlight_version(), lines, spans });
            }
            let hl = state.highlight.as_ref().expect("filled above");

            let painter = ui.painter().clone();
            let ppp = ui.ctx().pixels_per_point();
            let round = |v: f32| (v * ppp).round() / ppp;
            let full_left = ui.clip_rect().left();
            let full_right = ui.clip_rect().right();
            let text_y = ((line_h - row_h) / 2.0).round();
            let first_col = ((viewport.min.x - TEXT_PAD) / char_w).floor().max(0.0) as usize;
            let visible_cols = (viewport.width() / char_w).ceil() as usize + 2;
            let sel = state.sel;
            let sel_range = sel.range();

            for line in visible {
                let y = round(origin.y + line as f32 * line_h);
                let text = doc.line(line);
                let line_start = doc.line_start(line);
                let line_chars = text.chars().count();

                if line == caret_pos.line && sel.is_empty() {
                    painter.rect_filled(
                        Rect::from_min_max(Pos2::new(full_left, y), Pos2::new(full_right, y + line_h)),
                        0.0,
                        theme.current_line,
                    );
                }

                if !sel.is_empty() {
                    let ls = line_start;
                    let le = line_start + line_chars;
                    let a = sel_range.start.max(ls);
                    let b = sel_range.end.min(le);
                    let covers_newline = sel_range.start <= le && sel_range.end > le;
                    if a < b || covers_newline && a <= le {
                        let x0 = display_col(&text, a - ls) as f32 * char_w;
                        let mut x1 = display_col(&text, b.max(a) - ls) as f32 * char_w;
                        if covers_newline {
                            x1 += char_w;
                        }
                        painter.rect_filled(
                            Rect::from_min_max(Pos2::new(origin.x + x0, y), Pos2::new(origin.x + x1, y + line_h)),
                            0.0,
                            theme.selection,
                        );
                    }
                }

                let spans: &[Span] = line
                    .checked_sub(hl.lines.start)
                    .and_then(|i| hl.spans.get(i))
                    .map_or(&[], |v| v.as_slice());
                let width_cols = if line_chars > LONG_LINE / 4 { display_col(&text, line_chars) } else { line_chars };
                let window = if width_cols > LONG_LINE {
                    let s = first_col.saturating_sub(LONG_LINE_WINDOW / 2) / LONG_LINE_WINDOW * LONG_LINE_WINDOW;
                    s..s + visible_cols + LONG_LINE_WINDOW * 2
                } else {
                    0..usize::MAX
                };
                if !text.is_empty() && window.start < width_cols {
                    let key = {
                        let mut h = DefaultHasher::new();
                        text.hash(&mut h);
                        spans.hash(&mut h);
                        window.start.hash(&mut h);
                        font_size.to_bits().hash(&mut h);
                        theme_fp.hash(&mut h);
                        h.finish()
                    };
                    let frame = state.frame;
                    let galley = match state.galleys.get_mut(&key) {
                        Some((g, used)) => {
                            *used = frame;
                            g.clone()
                        }
                        None => {
                            let job = line_job(&text, spans, window.clone(), &font, theme);
                            let g = ui.fonts(|f| f.layout_job(job));
                            state.galleys.insert(key, (g.clone(), frame));
                            g
                        }
                    };
                    let x = origin.x + window.start as f32 * char_w;
                    painter.galley(Pos2::new(round(x), y + text_y), galley, theme.foreground);
                }

                if let Some(w) = &hover_word {
                    if w.start.line == line {
                        let x0 = origin.x + display_col(&text, w.start.column) as f32 * char_w;
                        let x1 = origin.x + display_col(&text, w.end.column) as f32 * char_w;
                        let uy = y + text_y + row_h;
                        painter.line_segment([Pos2::new(x0, uy), Pos2::new(x1, uy)], Stroke::new(1.0_f32, theme.link));
                    }
                }

                if line == caret_pos.line {
                    let x = round(origin.x + display_col(&text, caret_pos.column) as f32 * char_w);
                    let color = if has_focus { theme.caret } else { theme.caret.gamma_multiply(0.4) };
                    painter.rect_filled(
                        Rect::from_min_size(Pos2::new(x - 1.0, y), Vec2::new(2.0, line_h)),
                        0.0,
                        color,
                    );
                }
            }
        });
        state.scroll = output.state.offset;

        // Evict galleys not drawn recently, but only once the cache is clearly larger than a
        // screenful, so normal scrolling never pays for it.
        if state.galleys.len() > 3000 {
            let keep_after = state.frame.saturating_sub(30);
            state.galleys.retain(|_, (_, used)| *used >= keep_after);
        }

        // Gutter, painted after the scroll area so it uses this frame's offset.
        let painter = ui.painter_at(gutter_rect);
        painter.rect_filled(gutter_rect, 0.0, theme.gutter_background);
        painter.line_segment(
            [Pos2::new(gutter_rect.right() - 0.5, gutter_rect.top()), Pos2::new(gutter_rect.right() - 0.5, gutter_rect.bottom())],
            Stroke::new(1.0_f32, theme.gutter_separator),
        );
        let top = text_rect.top() - state.scroll.y;
        let first = ((state.scroll.y / line_h).floor().max(0.0) as usize).min(line_count);
        let last = (((state.scroll.y + view.y) / line_h).ceil() as usize + 1).min(line_count);
        let numbers_right = gutter_rect.min.x + ann_w + numbers_w;
        let text_y = ((line_h - row_h) / 2.0).round();
        for line in first..last {
            let y = top + line as f32 * line_h;
            let color = if line == caret_pos.line { theme.line_number_current } else { theme.line_number };
            painter.text(
                Pos2::new(numbers_right - char_w, y + text_y),
                Align2::RIGHT_TOP,
                (line + 1).to_string(),
                font.clone(),
                color,
            );
            if let Some(a) = annotations.get(line) {
                if !a.is_empty() {
                    let a: String = a.chars().take(40).collect();
                    painter.text(Pos2::new(gutter_rect.min.x + char_w * 0.5, y + text_y), Align2::LEFT_TOP, a, font.clone(), theme.annotation);
                }
            }
        }
        let mark_x = numbers_right + 1.0;
        state.geometry = Some(EditorGeometry {
            text_rect,
            gutter_rect,
            origin: Pos2::new(text_rect.min.x + TEXT_PAD - state.scroll.x, top),
            char_w,
            line_h,
            annotation_w: ann_w,
            mark_x,
        });
        for &(line, mark) in marks {
            if line < first || line > last {
                continue;
            }
            let y = top + line as f32 * line_h;
            match mark {
                GutterMark::Added | GutterMark::Modified => {
                    let color = if mark == GutterMark::Added { theme.mark_added } else { theme.mark_modified };
                    painter.rect_filled(
                        Rect::from_min_size(Pos2::new(mark_x, y), Vec2::new(MARK_W, line_h)),
                        0.0,
                        color.gamma_multiply(1.6),
                    );
                }
                GutterMark::Deleted => {
                    let tip = Pos2::new(mark_x + MARK_W + 2.0, y);
                    painter.add(egui::Shape::convex_polygon(
                        vec![Pos2::new(mark_x, y - 4.0), tip, Pos2::new(mark_x, y + 4.0)],
                        theme.mark_deleted,
                        Stroke::NONE,
                    ));
                }
            }
        }

        let hover = if resp.hovered() {
            resp.hover_pos().and_then(|p| {
                let line = ((p.y - origin.y) / line_h).floor();
                if line < 0.0 || line as usize >= line_count {
                    return None;
                }
                let line = line as usize;
                let text = doc.line(line);
                let col = col_from_display(&text, (p.x - origin.x) / char_w - 0.5);
                (col < text.chars().count()).then_some(Position::new(line, col))
            })
        } else {
            None
        };
        if resp.hovered() {
            let icon = if hover_word.is_some() { CursorIcon::PointingHand } else { CursorIcon::Text };
            ui.ctx().set_cursor_icon(icon);
        }
        if !doc.syntax_ready() {
            // A background parse finishes without any input event, so poll until it lands.
            ui.ctx().request_repaint_after(Duration::from_millis(16));
        }

        EditorResponse {
            changed,
            action: out_action,
            hover,
            gutter_clicked,
            annotation_clicked,
            cursor: caret_pos,
            has_focus,
            response: resp,
        }
    }
}

fn insert_other(doc: &mut Document, sel: &mut Selection, text: &str) {
    let r = sel.range();
    let after = Selection::caret(r.start + text.chars().count());
    doc.edit(r, text, *sel, after, EditKind::Other);
    *sel = after;
}

/// Without a selection, copy and cut act on the whole line, like IDEA.
fn copy_text(doc: &Document, sel: &Selection) -> String {
    if sel.is_empty() {
        let line = doc.char_to_position(sel.head).line;
        let mut s = doc.line(line);
        s.push('\n');
        s
    } else {
        doc.slice(sel.range())
    }
}

fn cut(ui: &Ui, doc: &mut Document, sel: &mut Selection) {
    ui.ctx().copy_text(copy_text(doc, sel));
    if sel.is_empty() {
        editing::delete_line(doc, sel);
    } else {
        let r = sel.range();
        let after = Selection::caret(r.start);
        doc.edit(r, "", *sel, after, EditKind::Other);
        *sel = after;
    }
}

/// Keys that change the text. A read-only view drops them before `on_key`.
fn is_edit_key(key: Key, m: Modifiers) -> bool {
    match key {
        Key::Backspace | Key::Delete | Key::Enter | Key::Tab => true,
        Key::Z | Key::D | Key::Slash => m.command,
        Key::Y => m.ctrl && !m.mac_cmd,
        _ => false,
    }
}

fn on_key(doc: &mut Document, state: &mut EditorState, key: Key, m: Modifiers, page: usize) -> Option<EditorAction> {
    let shift = m.shift;
    let sel = state.sel;
    let head = sel.head;
    let mut keep_col = false;
    let cursor_pos = doc.char_to_position(head);
    let want_col = || state.preferred_col.unwrap_or_else(|| display_col(&doc.line(cursor_pos.line), cursor_pos.column));
    let mut action = None;
    match key {
        Key::ArrowLeft => {
            let to = if m.command {
                editing::smart_home(doc, head)
            } else if m.alt {
                editing::word_left(doc, head)
            } else if !sel.is_empty() && !shift {
                sel.start()
            } else {
                head.saturating_sub(1)
            };
            state.set_head(to, shift);
        }
        Key::ArrowRight => {
            let to = if m.command {
                editing::line_end_of(doc, head)
            } else if m.alt {
                editing::word_right(doc, head)
            } else if !sel.is_empty() && !shift {
                sel.end()
            } else {
                (head + 1).min(doc.len_chars())
            };
            state.set_head(to, shift);
        }
        Key::ArrowUp | Key::ArrowDown | Key::PageUp | Key::PageDown => {
            let up = matches!(key, Key::ArrowUp | Key::PageUp);
            if m.command && matches!(key, Key::ArrowUp | Key::ArrowDown) {
                let to = if up { 0 } else { doc.len_chars() };
                state.set_head(to, shift);
            } else {
                let want = want_col();
                let n = if matches!(key, Key::PageUp | Key::PageDown) { page } else { 1 } as isize;
                let to = editing::vertical(doc, head, if up { -n } else { n }, want);
                state.set_head(to, shift);
                state.preferred_col = Some(want);
                keep_col = true;
            }
        }
        Key::Home => state.set_head(editing::smart_home(doc, head), shift),
        Key::End => state.set_head(editing::line_end_of(doc, head), shift),
        Key::Backspace => {
            if m.command {
                editing::delete_line(doc, &mut state.sel);
            } else {
                editing::backspace(doc, &mut state.sel, m.alt);
            }
        }
        Key::Delete => editing::delete_forward(doc, &mut state.sel, m.alt),
        Key::Enter => {
            if shift {
                let end = editing::line_end_of(doc, head);
                state.sel = Selection::caret(end);
            }
            editing::newline(doc, &mut state.sel);
        }
        Key::Tab => {
            if shift {
                editing::dedent(doc, &mut state.sel);
            } else {
                editing::tab(doc, &mut state.sel);
            }
        }
        Key::Escape => {
            state.sel = Selection::caret(head);
        }
        Key::A if m.command => state.sel = Selection::new(0, doc.len_chars()),
        Key::Z if m.command => {
            let restored = if shift { doc.redo() } else { doc.undo() };
            if let Some(s) = restored {
                let len = doc.len_chars();
                state.sel = Selection::new(s.anchor.min(len), s.head.min(len));
            }
        }
        Key::Y if m.ctrl && !m.mac_cmd => {
            if let Some(s) = doc.redo() {
                state.sel = s;
            }
        }
        Key::D if m.command => editing::duplicate(doc, &mut state.sel),
        Key::Slash if m.command => editing::toggle_comment(doc, &mut state.sel),
        Key::B if m.command => {
            let p = doc.char_to_position(head);
            action = Some(if shift { EditorAction::GoToTypeDefinition(p) } else { EditorAction::GoToDeclaration(p) });
        }
        Key::F7 if m.alt => action = Some(EditorAction::FindUsages(doc.char_to_position(head))),
        _ => {}
    }
    if !keep_col {
        state.preferred_col = None;
    }
    if state.sel.head != head || state.sel.anchor != sel.anchor {
        doc.seal_undo_group();
    }
    action
}

/// Builds the layout job for one line (or one window of a long line), expanding tabs so the
/// monospace column math in the view matches what is drawn.
fn line_job(text: &str, spans: &[Span], window: Range<usize>, font: &FontId, theme: &EditorTheme) -> LayoutJob {
    let mut job = LayoutJob::default();
    job.wrap.max_width = f32::INFINITY;
    job.break_on_newline = false;
    let mut out = String::with_capacity(text.len().min(window.len()));
    let mut sections: Vec<LayoutSection> = Vec::new();
    let mut d = 0usize;
    let mut si = 0usize;
    let mut cur_kind = HlKind::None;
    let mut sec_start = 0usize;
    for (b, c) in text.char_indices() {
        let next = editing::advance(d, c);
        if d >= window.end {
            break;
        }
        while si < spans.len() && spans[si].end as usize <= b {
            si += 1;
        }
        let kind = match spans.get(si) {
            Some(s) if (s.start as usize) <= b => s.kind,
            _ => HlKind::None,
        };
        if next > window.start {
            if kind != cur_kind && out.len() > sec_start {
                sections.push(section(sec_start..out.len(), cur_kind, font, theme));
                sec_start = out.len();
            }
            cur_kind = kind;
            if c == '\t' {
                for _ in d.max(window.start)..next {
                    out.push(' ');
                }
            } else if c.is_control() {
                // Stray CR or other controls would otherwise draw as a missing-glyph box.
                out.push(' ');
            } else {
                out.push(c);
            }
        }
        d = next;
    }
    if out.len() > sec_start {
        sections.push(section(sec_start..out.len(), cur_kind, font, theme));
    }
    job.text = out;
    job.sections = sections;
    job
}

fn section(range: Range<usize>, kind: HlKind, font: &FontId, theme: &EditorTheme) -> LayoutSection {
    LayoutSection {
        leading_space: 0.0,
        byte_range: range,
        format: TextFormat { font_id: font.clone(), color: theme.color(kind), ..Default::default() },
    }
}
