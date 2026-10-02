//! The egui widget. It draws only the visible rows, straight from the emulator's grid.
//!
//! The emulator lock is held only while cells are copied into a reusable buffer. Text layout
//! and painting happen after the lock is released, so the parser thread keeps running while
//! egui tessellates.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::Ordering;

use alacritty_terminal::grid::{Dimensions, Scroll};
use alacritty_terminal::index::{Column, Line, Point, Side};
use alacritty_terminal::selection::{Selection, SelectionType};
use alacritty_terminal::term::cell::Flags;
use alacritty_terminal::term::TermMode;
use alacritty_terminal::vte::ansi::{Color, CursorShape, NamedColor};
use egui::text::{LayoutJob, TextFormat};
use egui::{
    pos2, vec2, Color32, CursorIcon, Event, EventFilter, FontId, Id, ImeEvent, Key, MouseWheelUnit,
    Pos2, Rect, Sense, Stroke, StrokeKind, Ui,
};

use crate::keys::{key_to_bytes, paste_bytes, KeyMode};
use crate::links::{path_at, resolve};
use crate::theme::{dim, TerminalTheme};
use crate::{Emulator, Terminal};

/// Two clicks closer than this on the same cell count as a double click.
const MULTI_CLICK_SECONDS: f64 = 0.4;
/// How far a logical (wrapped) line is followed when looking for a path.
const MAX_WRAPPED_ROWS: i32 = 16;

#[derive(Clone, Copy)]
struct CellView {
    c: char,
    fg: Color32,
    bg: Color32,
    flags: Flags,
}

const BLANK: CellView = CellView {
    c: ' ',
    fg: Color32::TRANSPARENT,
    bg: Color32::TRANSPARENT,
    flags: Flags::empty(),
};

#[derive(Clone, Copy, PartialEq)]
struct TextStyle {
    fg: Color32,
    bold: bool,
    italic: bool,
    underline: bool,
    strike: bool,
}

/// Per-terminal UI state that must survive between frames. `TerminalView` is rebuilt every
/// frame, so this lives inside `Terminal`.
#[derive(Default)]
pub(crate) struct ViewState {
    cells: Vec<CellView>,
    zerowidth: HashMap<usize, String>,
    scroll_accum: f32,
    last_click: Option<(f64, Point, u8)>,
    selecting: bool,
    /// Button code and last reported cell while a mouse-reporting program sees a press.
    mouse_down: Option<(u8, usize, usize)>,
    /// Last link lookup: (token, bases) -> resolved path. Saves a stat per frame while hovering.
    link_cache: Option<(String, Option<PathBuf>)>,
}

pub struct TerminalView<'a> {
    term: &'a mut Terminal,
    font_size: f32,
    theme: Option<TerminalTheme>,
    alt_is_meta: bool,
    id: Option<Id>,
}

pub struct TerminalResponse {
    /// A clicked `path:line:col`. The path exists on disk; line and column are 1-based as
    /// printed in the output.
    pub open_path: Option<(PathBuf, Option<usize>, Option<usize>)>,
    /// The widget's egui response (focus, hover, context menu).
    pub response: egui::Response,
}

impl<'a> TerminalView<'a> {
    pub fn new(term: &'a mut Terminal) -> Self {
        TerminalView {
            term,
            font_size: 13.0,
            theme: None,
            alt_is_meta: true,
            id: None,
        }
    }

    pub fn font_size(mut self, size: f32) -> Self {
        self.font_size = size.max(4.0);
        self
    }

    pub fn theme(mut self, theme: TerminalTheme) -> Self {
        self.theme = Some(theme);
        self
    }

    /// Option/Alt sends ESC-prefixed keys (default). Turn off for layouts that type
    /// characters with Option.
    pub fn alt_is_meta(mut self, on: bool) -> Self {
        self.alt_is_meta = on;
        self
    }

    /// Overrides the widget id. By default it is unique per `Terminal`, which keeps keyboard
    /// focus stable when tabs are reordered.
    pub fn id(mut self, id: Id) -> Self {
        self.id = Some(id);
        self
    }

    pub fn show(self, ui: &mut Ui) -> TerminalResponse {
        let TerminalView {
            term,
            font_size,
            theme,
            alt_is_meta,
            id,
        } = self;
        if let Some(theme) = theme {
            term.set_theme(theme);
        }
        let theme = term.theme.clone();
        let ctx = ui.ctx().clone();
        let ppp = ctx.pixels_per_point();
        let font = FontId::monospace(font_size);
        let (cell_w, row_h) = ui.fonts(|f| (f.glyph_width(&font, 'M'), f.row_height(&font)));
        let cell_h = ((row_h * ppp).round() / ppp).max(1.0);

        let (rect, _) = ui.allocate_exact_size(ui.available_size(), Sense::hover());
        let id =
            id.unwrap_or_else(|| Id::new(("ide-term", term.events.as_ref() as *const _ as usize)));
        let response = ui.interact(rect, id, Sense::click_and_drag());
        // Accessibility name; UI tests also find the grid by it.
        response.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Other, true, "Terminal output"));

        let cols = ((rect.width() / cell_w).floor() as usize).max(2);
        let rows = ((rect.height() / cell_h).floor() as usize).max(1);
        term.resize(
            cols as u16,
            rows as u16,
            (cell_w * ppp).round() as u16,
            (cell_h * ppp).round() as u16,
        );
        // Cleared before reading the grid: output that lands during this frame asks for another.
        term.io.dirty.store(false, Ordering::Release);

        if response.is_pointer_button_down_on() {
            response.request_focus();
        }
        let has_focus = response.has_focus();
        if has_focus {
            ctx.memory_mut(|m| {
                m.set_focus_lock_filter(
                    id,
                    EventFilter {
                        tab: true,
                        horizontal_arrows: true,
                        vertical_arrows: true,
                        escape: true,
                    },
                )
            });
        }

        let (events, modifiers, now, latest_pos) = ui.input(|i| {
            (
                i.events.clone(),
                i.modifiers,
                i.time,
                i.pointer.latest_pos(),
            )
        });
        let (mode, mut display_offset) = {
            let t = term.emulator.lock();
            (*t.mode(), t.grid().display_offset())
        };
        let mouse_mode = mode.intersects(TermMode::MOUSE_MODE) && !modifiers.shift;
        let sgr = mode.contains(TermMode::SGR_MOUSE);
        let hovered = ui.rect_contains_pointer(rect);

        let cell_at = |pos: Pos2| -> (usize, usize, Side) {
            let x = ((pos.x - rect.left()) / cell_w).max(0.0);
            let col = (x.floor() as usize).min(cols - 1);
            let side = if x - col as f32 >= 0.5 || x >= cols as f32 {
                Side::Right
            } else {
                Side::Left
            };
            let row = (((pos.y - rect.top()) / cell_h).max(0.0).floor() as usize).min(rows - 1);
            (row, col, side)
        };
        let grid_point = |row: usize, col: usize, offset: usize| {
            Point::new(Line(row as i32 - offset as i32), Column(col))
        };

        let mut out: Vec<u8> = Vec::new();
        let mut typed = false;

        // Keyboard.
        if has_focus {
            let key_mode = KeyMode {
                app_cursor: mode.contains(TermMode::APP_CURSOR),
                alt_is_meta,
            };
            // macOS sends a composed character ("∫") right after Option+B; with Alt as Meta the
            // key event already produced ESC b, so that text must be dropped.
            let mut suppress_text = false;
            for event in &events {
                match event {
                    Event::Key {
                        key,
                        pressed: true,
                        modifiers: m,
                        ..
                    } => {
                        suppress_text = false;
                        let clear_shortcut = if cfg!(target_os = "macos") {
                            m.mac_cmd && !m.shift
                        } else {
                            m.ctrl && m.shift
                        };
                        if clear_shortcut && *key == Key::K {
                            term.clear();
                            continue;
                        }
                        if m.shift && !m.ctrl && !m.alt && !mode.contains(TermMode::ALT_SCREEN) {
                            let scroll = match key {
                                Key::PageUp => Some(Scroll::PageUp),
                                Key::PageDown => Some(Scroll::PageDown),
                                Key::Home => Some(Scroll::Top),
                                Key::End => Some(Scroll::Bottom),
                                _ => None,
                            };
                            if let Some(scroll) = scroll {
                                term.emulator.lock().scroll_display(scroll);
                                continue;
                            }
                        }
                        if let Some(bytes) = key_to_bytes(*key, *m, key_mode) {
                            out.extend_from_slice(&bytes);
                            typed = true;
                            suppress_text = m.alt && alt_is_meta;
                        }
                    }
                    Event::Text(text) | Event::Ime(ImeEvent::Commit(text)) => {
                        if std::mem::take(&mut suppress_text) {
                            continue;
                        }
                        out.extend_from_slice(text.as_bytes());
                        typed = true;
                    }
                    Event::Paste(text) => {
                        out.extend_from_slice(&paste_bytes(
                            text,
                            mode.contains(TermMode::BRACKETED_PASTE),
                        ));
                        typed = true;
                    }
                    Event::Copy | Event::Cut => {
                        let selected = term
                            .emulator
                            .lock()
                            .selection_to_string()
                            .filter(|s| !s.is_empty());
                        match selected {
                            Some(text) => ctx.copy_text(text),
                            // Off macOS, Ctrl+C/Ctrl+X arrive as Copy/Cut; without a selection
                            // they must still reach the program.
                            None if !cfg!(target_os = "macos") => {
                                out.push(if matches!(event, Event::Copy) {
                                    0x03
                                } else {
                                    0x18
                                });
                                typed = true;
                            }
                            None => {}
                        }
                    }
                    _ => {}
                }
            }
        }

        // Mouse wheel: scrollback, or the program's own scrolling when it asked for mouse
        // events or runs on the alternate screen (less, vim).
        if hovered {
            for event in &events {
                if let Event::MouseWheel { unit, delta, .. } = event {
                    term.view.scroll_accum += match unit {
                        MouseWheelUnit::Point => delta.y / cell_h,
                        MouseWheelUnit::Line => delta.y,
                        MouseWheelUnit::Page => delta.y * rows as f32,
                    };
                }
            }
            let lines = term.view.scroll_accum.trunc() as i32;
            term.view.scroll_accum -= lines as f32;
            if lines != 0 {
                if mouse_mode {
                    let (row, col, _) = cell_at(latest_pos.unwrap_or(rect.min));
                    let code = if lines > 0 { 64 } else { 65 };
                    for _ in 0..lines.unsigned_abs() {
                        out.extend_from_slice(&mouse_report(code, col, row, true, sgr));
                    }
                } else if mode.contains(TermMode::ALT_SCREEN | TermMode::ALTERNATE_SCROLL) {
                    let key = if lines > 0 {
                        Key::ArrowUp
                    } else {
                        Key::ArrowDown
                    };
                    let key_mode = KeyMode {
                        app_cursor: mode.contains(TermMode::APP_CURSOR),
                        alt_is_meta,
                    };
                    let bytes =
                        key_to_bytes(key, egui::Modifiers::NONE, key_mode).unwrap_or_default();
                    for _ in 0..lines.unsigned_abs() {
                        out.extend_from_slice(&bytes);
                    }
                } else {
                    let mut t = term.emulator.lock();
                    t.scroll_display(Scroll::Delta(lines));
                    display_offset = t.grid().display_offset();
                }
            }
        }

        // Mouse buttons: reported to the program in mouse mode, otherwise selection.
        for event in &events {
            let Event::PointerButton {
                pos,
                button,
                pressed,
                ..
            } = event
            else {
                continue;
            };
            let inside = rect.contains(*pos) && hovered;
            let (row, col, side) = cell_at(*pos);
            if mouse_mode {
                let code = match button {
                    egui::PointerButton::Primary => 0,
                    egui::PointerButton::Middle => 1,
                    egui::PointerButton::Secondary => 2,
                    _ => continue,
                };
                if *pressed && inside {
                    out.extend_from_slice(&mouse_report(code, col, row, true, sgr));
                    term.view.mouse_down = Some((code, row, col));
                } else if !*pressed && term.view.mouse_down.is_some_and(|(c, ..)| c == code) {
                    out.extend_from_slice(&mouse_report(code, col, row, false, sgr));
                    term.view.mouse_down = None;
                }
                continue;
            }
            if *button != egui::PointerButton::Primary {
                continue;
            }
            if *pressed && inside {
                let point = grid_point(row, col, display_offset);
                let count = match term.view.last_click {
                    Some((t, p, n)) if now - t < MULTI_CLICK_SECONDS && p == point => n % 3 + 1,
                    _ => 1,
                };
                term.view.last_click = Some((now, point, count));
                let ty = match count {
                    1 => SelectionType::Simple,
                    2 => SelectionType::Semantic,
                    _ => SelectionType::Lines,
                };
                term.emulator.lock().selection = Some(Selection::new(ty, point, side));
                term.view.selecting = true;
            } else if !*pressed {
                term.view.selecting = false;
            }
        }
        if mouse_mode && mode.intersects(TermMode::MOUSE_DRAG | TermMode::MOUSE_MOTION) {
            if let (Some((code, last_row, last_col)), Some(pos)) =
                (term.view.mouse_down, latest_pos)
            {
                let (row, col, _) = cell_at(pos);
                if (row, col) != (last_row, last_col) {
                    out.extend_from_slice(&mouse_report(code + 32, col, row, true, sgr));
                    term.view.mouse_down = Some((code, row, col));
                }
            }
        }
        if term.view.selecting {
            if let Some(pos) = latest_pos {
                let mut t = term.emulator.lock();
                // Dragging past the top or bottom edge scrolls, so long selections are possible.
                if pos.y < rect.top() {
                    t.scroll_display(Scroll::Delta(1));
                    ctx.request_repaint();
                } else if pos.y > rect.bottom() {
                    t.scroll_display(Scroll::Delta(-1));
                    ctx.request_repaint();
                }
                display_offset = t.grid().display_offset();
                let (row, col, side) = cell_at(pos);
                let point = grid_point(row, col, display_offset);
                if let Some(selection) = t.selection.as_mut() {
                    selection.update(point, side);
                }
            }
        }

        if typed {
            if display_offset != 0 {
                let mut t = term.emulator.lock();
                t.scroll_display(Scroll::Bottom);
                display_offset = 0;
            }
            term.write(out);
        } else if !out.is_empty() {
            term.write(out);
        }

        if let Some(text) = term.take_osc52_clipboard() {
            ctx.copy_text(text);
        }

        // Link under the pointer.
        let mut link: Option<(PathBuf, Option<usize>, Option<usize>)> = None;
        let mut link_cells: Vec<(usize, usize, usize)> = Vec::new();
        if hovered && !mouse_mode && !term.view.selecting {
            if let Some(pos) = latest_pos {
                let (row, col, _) = cell_at(pos);
                let found = {
                    let t = term.emulator.lock();
                    let (chars, index, start) =
                        logical_line(&t, grid_point(row, col, display_offset));
                    path_at(&chars, index).map(|hit| (hit, start))
                };
                if let Some((hit, start)) = found {
                    let cached = match &term.view.link_cache {
                        Some((token, resolved)) if *token == hit.path => resolved.clone(),
                        _ => {
                            let current = term.current_dir();
                            let mut bases = Vec::new();
                            if let Some(dir) = current.as_deref() {
                                bases.push(dir);
                            }
                            bases.push(term.cwd());
                            let resolved = resolve(&hit.path, &bases);
                            term.view.link_cache = Some((hit.path.clone(), resolved.clone()));
                            resolved
                        }
                    };
                    if let Some(path) = cached {
                        link = Some((path, hit.line, hit.column));
                        link_cells = spans(start, hit.start, hit.end, cols, display_offset, rows);
                    }
                }
            }
        }
        let mut open_path = None;
        if link.is_some() {
            ctx.set_cursor_icon(CursorIcon::PointingHand);
            if response.clicked() {
                open_path = link.take();
            }
        } else if hovered && !mouse_mode {
            ctx.set_cursor_icon(CursorIcon::Text);
        }

        // Copy the visible cells out of the emulator.
        let view = &mut term.view;
        view.cells.clear();
        view.cells.resize(cols * rows, BLANK);
        view.zerowidth.clear();
        let mut cursor: Option<(usize, usize, CursorShape, bool)> = None;
        {
            let mut t = term.emulator.lock();
            t.is_focused = has_focus;
            let content = t.renderable_content();
            let colors = content.colors;
            let offset = content.display_offset as i32;
            let cursor_point = content.cursor.point;
            let cursor_shape = content.cursor.shape;
            let cursor_color = colors[NamedColor::Cursor]
                .map(|c| Color32::from_rgb(c.r, c.g, c.b))
                .unwrap_or(theme.cursor);
            let selection = content.selection;
            for indexed in content.display_iter {
                let row = indexed.point.line.0 + offset;
                let col = indexed.point.column.0;
                if row < 0 || row as usize >= rows || col >= cols {
                    continue;
                }
                let row = row as usize;
                let cell = indexed.cell;
                let flags = cell.flags;
                let bold = flags.contains(Flags::BOLD);
                // Bold text in one of the first eight colors uses its bright variant, as xterm does.
                let fg_color = match cell.fg {
                    Color::Named(n) if bold && (n as usize) < 8 => Color::Named(n.to_bright()),
                    Color::Indexed(i) if bold && i < 8 => Color::Indexed(i + 8),
                    c => c,
                };
                let mut fg = theme.resolve(fg_color, colors);
                if flags.contains(Flags::DIM) {
                    fg = dim(fg);
                }
                let mut bg = theme.resolve(cell.bg, colors);
                if flags.contains(Flags::INVERSE) {
                    std::mem::swap(&mut fg, &mut bg);
                }
                if flags.contains(Flags::HIDDEN) {
                    fg = bg;
                }
                if selection.is_some_and(|s| s.contains_cell(&indexed, cursor_point, cursor_shape))
                {
                    bg = theme.selection;
                }
                if indexed.point == cursor_point && cursor_shape != CursorShape::Hidden {
                    let wide = flags.contains(Flags::WIDE_CHAR);
                    cursor = Some((row, col, cursor_shape, wide));
                    if has_focus && cursor_shape == CursorShape::Block {
                        fg = bg;
                        bg = cursor_color;
                    }
                }
                let index = row * cols + col;
                if let Some(extra) = cell.zerowidth() {
                    let mut s = String::with_capacity(8);
                    s.push(cell.c);
                    s.extend(extra.iter());
                    view.zerowidth.insert(index, s);
                }
                // alacritty keeps the '\t' in the first cell of a tab so copies preserve it; on
                // screen it is blank.
                let c = if cell.c == '\t' { ' ' } else { cell.c };
                view.cells[index] = CellView { c, fg, bg, flags };
            }
        }

        // Paint.
        let painter = ui.painter_at(rect);
        painter.rect_filled(rect, 0.0, theme.background);
        let x_of = |col: usize| rect.left() + col as f32 * cell_w;
        let y_of = |row: usize| rect.top() + row as f32 * cell_h;
        let mut jobs: Vec<(Pos2, LayoutJob, bool)> = Vec::with_capacity(rows * 4);
        let text_job = |text: String, style: TextStyle| {
            let line = |on: bool| {
                if on {
                    Stroke::new(1.0_f32, style.fg)
                } else {
                    Stroke::NONE
                }
            };
            LayoutJob::single_section(
                text,
                TextFormat {
                    font_id: font.clone(),
                    color: style.fg,
                    italics: style.italic,
                    underline: line(style.underline),
                    strikethrough: line(style.strike),
                    ..Default::default()
                },
            )
        };
        for row in 0..rows {
            let cells = &view.cells[row * cols..(row + 1) * cols];
            let y = y_of(row);

            let mut c0 = 0;
            while c0 < cols {
                let bg = cells[c0].bg;
                let mut c1 = c0 + 1;
                while c1 < cols && cells[c1].bg == bg {
                    c1 += 1;
                }
                if bg != theme.background && bg != Color32::TRANSPARENT {
                    let r = Rect::from_min_size(
                        pos2(x_of(c0), y),
                        vec2((c1 - c0) as f32 * cell_w, cell_h),
                    );
                    painter.rect_filled(r, 0.0, bg);
                }
                c0 = c1;
            }

            // Runs of ASCII with one style become one galley. Anything else gets its own galley
            // at its own cell, so fallback-font glyphs of other widths cannot shift the row.
            let mut run = String::new();
            let mut run_start = 0;
            let mut run_style: Option<TextStyle> = None;
            let flush = |run: &mut String,
                         run_start: usize,
                         style: Option<TextStyle>,
                         jobs: &mut Vec<_>| {
                let trimmed = run.trim_end_matches(' ').len();
                run.truncate(trimmed);
                if let Some(style) = style {
                    if !run.is_empty() {
                        jobs.push((
                            pos2(x_of(run_start), y),
                            text_job(std::mem::take(run), style),
                            style.bold,
                        ));
                    }
                }
                run.clear();
            };
            for (col, cell) in cells.iter().enumerate() {
                let flags = cell.flags;
                if flags.intersects(Flags::WIDE_CHAR_SPACER | Flags::LEADING_WIDE_CHAR_SPACER) {
                    flush(&mut run, run_start, run_style.take(), &mut jobs);
                    continue;
                }
                let style = TextStyle {
                    fg: cell.fg,
                    bold: flags.contains(Flags::BOLD),
                    italic: flags.contains(Flags::ITALIC),
                    underline: flags.intersects(Flags::ALL_UNDERLINES),
                    strike: flags.contains(Flags::STRIKEOUT),
                };
                let index = row * cols + col;
                if cell.c == ' '
                    && !style.underline
                    && !style.strike
                    && !view.zerowidth.contains_key(&index)
                {
                    // Blank cells need no glyph; they only keep an existing run aligned.
                    if run_style.is_some() {
                        run.push(' ');
                    }
                    continue;
                }
                let simple = cell.c.is_ascii()
                    && !flags.contains(Flags::WIDE_CHAR)
                    && !view.zerowidth.contains_key(&index);
                if !simple {
                    flush(&mut run, run_start, run_style.take(), &mut jobs);
                    let text = view
                        .zerowidth
                        .get(&index)
                        .cloned()
                        .unwrap_or_else(|| cell.c.to_string());
                    jobs.push((pos2(x_of(col), y), text_job(text, style), style.bold));
                    continue;
                }
                if run_style != Some(style) {
                    flush(&mut run, run_start, run_style.take(), &mut jobs);
                    run_style = Some(style);
                    run_start = col;
                }
                run.push(cell.c);
            }
            flush(&mut run, run_start, run_style.take(), &mut jobs);
        }
        let galleys: Vec<_> = ui.fonts(|f| {
            jobs.into_iter()
                .map(|(pos, job, bold)| (pos, f.layout_job(job), bold))
                .collect()
        });
        // egui has no bold monospace face; a second pass one physical pixel to the right is the
        // classic terminal fallback.
        let bold_offset = vec2(1.0 / ppp, 0.0);
        for (pos, galley, bold) in galleys {
            if bold {
                painter.galley(pos + bold_offset, galley.clone(), theme.foreground);
            }
            painter.galley(pos, galley, theme.foreground);
        }

        if let Some((row, col, shape, wide)) = cursor {
            let w = if wide { 2.0 * cell_w } else { cell_w };
            let r = Rect::from_min_size(pos2(x_of(col), y_of(row)), vec2(w, cell_h));
            let color = theme.cursor;
            match (has_focus, shape) {
                (true, CursorShape::Block) => {}
                (true, CursorShape::Beam) => {
                    painter.rect_filled(
                        Rect::from_min_size(r.min, vec2(2.0 / ppp * 1.5, cell_h)),
                        0.0,
                        color,
                    );
                }
                (true, CursorShape::Underline) => {
                    let h = 2.0 / ppp * 1.5;
                    painter.rect_filled(
                        Rect::from_min_size(pos2(r.left(), r.bottom() - h), vec2(w, h)),
                        0.0,
                        color,
                    );
                }
                _ => {
                    painter.rect_stroke(r, 0.0, Stroke::new(1.0_f32, color), StrokeKind::Inside);
                }
            }
        }

        for (row, start, end) in link_cells {
            let y = y_of(row) + cell_h - 1.0;
            painter.line_segment(
                [pos2(x_of(start), y), pos2(x_of(end), y)],
                Stroke::new(1.0_f32, theme.link),
            );
        }

        TerminalResponse {
            open_path,
            response,
        }
    }
}

/// Collects the logical line around `point`: rows joined by soft wraps. Returns its cells, the
/// index of `point` in them, and the grid line where it starts.
fn logical_line(term: &Emulator, point: Point) -> (Vec<char>, usize, Line) {
    let grid = term.grid();
    let cols = grid.columns();
    let last = Column(cols - 1);
    let wraps = |line: Line| grid[line][last].flags.contains(Flags::WRAPLINE);
    let mut start = point.line;
    while start > grid.topmost_line()
        && point.line.0 - start.0 < MAX_WRAPPED_ROWS
        && wraps(Line(start.0 - 1))
    {
        start = Line(start.0 - 1);
    }
    let mut end = point.line;
    while end < grid.bottommost_line() && end.0 - point.line.0 < MAX_WRAPPED_ROWS && wraps(end) {
        end = Line(end.0 + 1);
    }
    let mut chars = Vec::with_capacity(cols * (end.0 - start.0 + 1) as usize);
    for line in start.0..=end.0 {
        let row = &grid[Line(line)];
        chars.extend((0..cols).map(|c| row[Column(c)].c));
    }
    let index = (point.line.0 - start.0) as usize * cols + point.column.0;
    (chars, index, start)
}

/// Splits a cell range of a logical line into visible `(row, start_col, end_col)` pieces.
fn spans(
    start: Line,
    from: usize,
    to: usize,
    cols: usize,
    display_offset: usize,
    rows: usize,
) -> Vec<(usize, usize, usize)> {
    let mut out = Vec::new();
    let mut i = from;
    while i < to {
        let row_in_line = i / cols;
        let col = i % cols;
        let end = (to - row_in_line * cols).min(cols);
        let row = start.0 + row_in_line as i32 + display_offset as i32;
        if row >= 0 && (row as usize) < rows {
            out.push((row as usize, col, end));
        }
        i = (row_in_line + 1) * cols;
    }
    out
}

/// One xterm mouse event. SGR (1006) is what modern programs ask for; the legacy encoding
/// only reaches column 222.
fn mouse_report(code: u8, col: usize, row: usize, pressed: bool, sgr: bool) -> Vec<u8> {
    if sgr {
        let end = if pressed { 'M' } else { 'm' };
        format!("\x1b[<{code};{};{}{end}", col + 1, row + 1).into_bytes()
    } else {
        if col > 222 || row > 222 {
            return Vec::new();
        }
        let code = if pressed { code } else { 3 };
        vec![0x1b, b'[', b'M', 32 + code, 33 + col as u8, 33 + row as u8]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mouse_reports() {
        assert_eq!(mouse_report(0, 4, 2, true, true), b"\x1b[<0;5;3M");
        assert_eq!(mouse_report(0, 4, 2, false, true), b"\x1b[<0;5;3m");
        assert_eq!(
            mouse_report(64, 0, 0, true, false),
            [0x1b, b'[', b'M', 96, 33, 33]
        );
        assert_eq!(
            mouse_report(0, 0, 0, false, false),
            [0x1b, b'[', b'M', 35, 33, 33]
        );
    }

    #[test]
    fn link_spans_wrap() {
        // A link from cell 8 to 13 of a line starting at grid line 2, 10 columns wide.
        assert_eq!(
            spans(Line(2), 8, 13, 10, 0, 24),
            vec![(2, 8, 10), (3, 0, 3)]
        );
        // Scrolled so the first row is above the screen.
        assert_eq!(spans(Line(-1), 8, 13, 10, 0, 24), vec![(0, 0, 3)]);
    }
}
