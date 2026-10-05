//! The IDEA-style find bar drawn at the top of the editor: the search row (Cmd+F) and the
//! replace row (Cmd+R). It edits `FindState` directly and returns the actions that need the
//! document; `view.rs` applies them.

use egui::epaint::{CircleShape, RectShape};
use egui::text::{CCursor, CCursorRange};
use egui::{
    pos2, vec2, Align, Button, Color32, CornerRadius, EventFilter, FontId, Id, Key, Layout, Modifiers, Painter,
    PopupCloseBehavior, Pos2, Rect, Response, Sense, Shape, Stroke, StrokeKind, TextEdit, Ui, UiBuilder, Vec2,
    WidgetInfo, WidgetType,
};

use crate::find::{FindState, MAX_MATCHES};
use crate::search::SearchFilter;
use crate::theme::EditorTheme;

/// Height of one bar row, and of an input field inside it.
const ROW_H: f32 = 34.0;
const FIELD_H: f32 = 26.0;
/// Extra field height per additional line in multiline mode, and the most lines shown.
const FIELD_LINE_H: f32 = 17.0;
const MAX_FIELD_LINES: usize = 4;
/// Square icon and toggle buttons.
const BTN: f32 = 22.0;
const ICON: f32 = 16.0;
/// Replacement history entries kept for the session.
pub(crate) const HISTORY_LEN: usize = 20;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BarCmd {
    Next,
    Prev,
    Replace,
    ReplaceAll,
    Exclude,
    Close,
    SelectAll,
}

/// Widget ids of the bar, derived from the editor's id.
pub(crate) struct BarIds {
    pub query: Id,
    pub replace: Id,
    pub base: Id,
}

impl BarIds {
    pub fn new(editor: Id) -> BarIds {
        BarIds { query: editor.with("find-query"), replace: editor.with("find-replace"), base: editor.with("find-bar") }
    }
}

fn field_lines(text: &str, multiline: bool) -> usize {
    if multiline {
        (text.matches('\n').count() + 1).min(MAX_FIELD_LINES)
    } else {
        1
    }
}

fn row_h(text: &str, multiline: bool) -> f32 {
    ROW_H + (field_lines(text, multiline) - 1) as f32 * FIELD_LINE_H
}

/// The bar's height for the current state.
pub(crate) fn height(find: &FindState, read_only: bool) -> f32 {
    let mut h = row_h(find.query(), find.options().multiline);
    if find.replace_open && !read_only {
        h += row_h(find.replacement(), find.replace_multiline);
    }
    h
}

/// Everything the bar shows that lives outside `FindState`.
pub(crate) struct BarEnv<'a> {
    pub theme: &'a EditorTheme,
    pub read_only: bool,
    /// The matches belong to the current text and query.
    pub fresh: bool,
    pub history: &'a [String],
}

pub(crate) fn show(ui: &mut Ui, rect: Rect, find: &mut FindState, ids: &BarIds, env: &BarEnv) -> Vec<BarCmd> {
    let theme = env.theme;
    let mut cmds = Vec::new();
    ui.painter().rect_filled(rect, 0.0, theme.find_bar);
    ui.painter().hline(rect.x_range(), rect.bottom() - 0.5, Stroke::new(1.0_f32, theme.find_bar_border));
    // The bar is its own click target, so a press on its background never reaches the text.
    let _ = ui.interact(rect, ids.base.with("bg"), Sense::click());

    let field_w = (rect.width() * 0.4).clamp(200.0, 420.0).min((rect.width() - 60.0).max(80.0));
    let search_h = row_h(find.query(), find.options().multiline);
    let search_rect = Rect::from_min_size(rect.min, vec2(rect.width(), search_h));
    let mut row = ui.new_child(UiBuilder::new().max_rect(search_rect.shrink2(vec2(6.0, 0.0))).layout(Layout::left_to_right(Align::Center)));
    row.set_clip_rect(search_rect.intersect(ui.clip_rect()));
    row.spacing_mut().item_spacing.x = 2.0;
    search_row(&mut row, find, ids, env, field_w, &mut cmds);

    if find.replace_open && !env.read_only {
        let h = row_h(find.replacement(), find.replace_multiline);
        let replace_rect = Rect::from_min_size(pos2(rect.min.x, search_rect.bottom()), vec2(rect.width(), h));
        let mut row = ui.new_child(UiBuilder::new().max_rect(replace_rect.shrink2(vec2(6.0, 0.0))).layout(Layout::left_to_right(Align::Center)));
        row.set_clip_rect(replace_rect.intersect(ui.clip_rect()));
        row.spacing_mut().item_spacing.x = 2.0;
        replace_row(&mut row, find, ids, env, field_w, &mut cmds);
    }

    // A click on a bar button takes egui's focus off the field. IDEA keeps typing in the field,
    // so the field that had the keyboard gets it back.
    let focused = ui.memory(|m| m.focused());
    if focused == Some(ids.query) || focused == Some(ids.replace) {
        find.last_field = focused;
    } else if !cmds.contains(&BarCmd::Close) && !cmds.contains(&BarCmd::SelectAll) {
        let pressed_here = ui.input(|i| {
            (i.pointer.any_pressed() || i.pointer.any_released()) && i.pointer.interact_pos().is_some_and(|p| rect.contains(p))
        });
        if pressed_here || std::mem::take(&mut find.popup_clicked) {
            let field = find.last_field.filter(|f| *f != ids.replace || (find.replace_open && !env.read_only)).unwrap_or(ids.query);
            ui.memory_mut(|m| m.request_focus(field));
        }
    }
    cmds
}

fn search_row(ui: &mut Ui, find: &mut FindState, ids: &BarIds, env: &BarEnv, field_w: f32, cmds: &mut Vec<BarCmd>) {
    let theme = env.theme;
    let expanded = find.replace_open && !env.read_only;
    let (icon, label) = if expanded { (FindIcon::ChevronDown, "Collapse Replace") } else { (FindIcon::ChevronRight, "Expand Replace") };
    let tip = if env.read_only { "Read-only file" } else if expanded { "Hide Replace" } else { "Replace (⌘R)" };
    if icon_button(ui, !env.read_only, icon, label, tip, theme).clicked() {
        find.replace_open = !expanded;
        if find.replace_open {
            ui.memory_mut(|m| m.request_focus(ids.replace));
        }
    }
    ui.add_space(2.0);

    // Keys of the focused query field, taken before the TextEdit sees them. Up and Down
    // cycle the matches like Shift+Enter and Enter; a multiline query keeps them for its caret.
    let multiline = find.options().multiline;
    if ui.memory(|m| m.has_focus(ids.query)) {
        let (prev, next, close) = ui.input_mut(|i| {
            let prev = i.consume_key(Modifiers::SHIFT, Key::Enter) | (!multiline && i.consume_key(Modifiers::NONE, Key::ArrowUp));
            let next = !multiline && (i.consume_key(Modifiers::NONE, Key::Enter) | i.consume_key(Modifiers::NONE, Key::ArrowDown));
            (prev, next, i.consume_key(Modifiers::NONE, Key::Escape))
        });
        if prev {
            cmds.push(BarCmd::Prev);
        }
        if next {
            cmds.push(BarCmd::Next);
        }
        if close {
            cmds.push(BarCmd::Close);
        }
    }

    let no_match = !find.query().is_empty() && env.fresh && (find.error().is_some() || find.counter().1 == 0);
    let mut query = find.query().to_string();
    let mut opts = find.options().clone();
    let focus = std::mem::take(&mut find.focus_query);
    let lines = field_lines(&query, multiline);
    let field = Field { id: ids.query, label: "Search Query", hint: "Search", multiline, lines, width: field_w, no_match, focus };
    field.show(
        ui,
        &mut query,
        theme,
        |_| {},
        |ui| {
            let regex = toggle(ui, opts.regex, ".*", "Regex", "Regex", theme);
            if regex.clicked() {
                opts.regex = !opts.regex;
            }
            if toggle(ui, opts.words, "W", "Words", "Words", theme).clicked() {
                opts.words = !opts.words;
            }
            if toggle(ui, opts.match_case, "Cc", "Match Case", "Match Case", theme).clicked() {
                opts.match_case = !opts.match_case;
            }
            if toggle(ui, opts.multiline, "⏎", "Multiline", "Multiline", theme).clicked() {
                opts.multiline = !opts.multiline;
            }
        },
    );
    if field.clear_clicked(ui) {
        query.clear();
        ui.memory_mut(|m| m.request_focus(ids.query));
    }
    find.set_query(&query);
    find.set_options(opts);

    ui.add_space(8.0);
    let (index, count) = find.counter();
    let (text, color) = if let Some(err) = find.error() {
        let _ = err;
        ("Bad pattern".to_string(), theme.find_error)
    } else if find.query().is_empty() {
        (String::new(), theme.find_text_dim)
    } else if count == 0 && env.fresh {
        ("0 results".to_string(), theme.find_error)
    } else {
        let total = if find.is_capped() { format!("{MAX_MATCHES}+") } else { count.to_string() };
        match index {
            Some(i) => (format!("{i}/{total}"), theme.find_text),
            None => (format!("{total} results"), theme.find_text_dim),
        }
    };
    let counter = ui.add(egui::Label::new(egui::RichText::new(text).color(color)).selectable(false));
    if let Some(err) = find.error() {
        counter.on_hover_text(err);
    }
    ui.add_space(6.0);
    let any = count > 0;
    if icon_button(ui, any, FindIcon::ArrowUp, "Previous Occurrence", "Previous Occurrence (⇧⏎ or ↑)", theme).clicked() {
        cmds.push(BarCmd::Prev);
    }
    if icon_button(ui, any, FindIcon::ArrowDown, "Next Occurrence", "Next Occurrence (⏎ or ↓)", theme).clicked() {
        cmds.push(BarCmd::Next);
    }
    ui.add_space(4.0);
    filter_menu(ui, find, ids, theme);
    more_menu(ui, find, ids, theme, any, cmds);

    // The close button sits at the right edge.
    let right = ui.max_rect().right();
    let close_rect = Rect::from_center_size(pos2(right - BTN / 2.0, ui.max_rect().center().y.min(ui.max_rect().top() + ROW_H / 2.0)), Vec2::splat(BTN));
    if close_rect.left() > ui.cursor().left() {
        let mut close_ui = ui.new_child(UiBuilder::new().max_rect(close_rect));
        if icon_button(&mut close_ui, true, FindIcon::Close, "Close Find Bar", "Close (Esc)", theme).clicked() {
            cmds.push(BarCmd::Close);
        }
    }
}

fn replace_row(ui: &mut Ui, find: &mut FindState, ids: &BarIds, env: &BarEnv, field_w: f32, cmds: &mut Vec<BarCmd>) {
    let theme = env.theme;
    // Aligns the field with the query field above (the chevron's width).
    ui.add_space(BTN + 2.0);
    let multiline = find.replace_multiline;
    if ui.memory(|m| m.has_focus(ids.replace)) {
        // Up and Down cycle the matches as in the query field, unless a multiline
        // replacement needs them to move the field's own caret.
        let (replace, prev, next, close) = ui.input_mut(|i| {
            (
                !multiline && i.consume_key(Modifiers::NONE, Key::Enter),
                !multiline && i.consume_key(Modifiers::NONE, Key::ArrowUp),
                !multiline && i.consume_key(Modifiers::NONE, Key::ArrowDown),
                i.consume_key(Modifiers::NONE, Key::Escape),
            )
        });
        if replace {
            cmds.push(BarCmd::Replace);
        }
        if prev {
            cmds.push(BarCmd::Prev);
        }
        if next {
            cmds.push(BarCmd::Next);
        }
        if close {
            cmds.push(BarCmd::Close);
        }
    }
    let mut text = find.replacement().to_string();
    let mut preserve = find.preserve_case();
    let mut multi = multiline;
    let popup = ids.base.with("history");
    let mut picked = None;
    let lines = field_lines(&text, multiline);
    let field = Field { id: ids.replace, label: "Replacement", hint: "Replace", multiline, lines, width: field_w, no_match: false, focus: false };
    field.show(
        ui,
        &mut text,
        theme,
        |ui| {
            let r = icon_button_sized(ui, true, FindIcon::History, "Replacement History", "Recent Replacements", theme, vec2(BTN + 6.0, BTN));
            if r.clicked() {
                ui.memory_mut(|m| m.toggle_popup(popup));
            }
            egui::popup_below_widget(ui, popup, &r, PopupCloseBehavior::CloseOnClick, |ui| {
                ui.set_min_width(220.0);
                if env.history.is_empty() {
                    ui.add_enabled(false, Button::new("No recent replacements").frame(false));
                }
                for h in env.history {
                    let shown = h.replace('\n', "⏎");
                    if ui.add(Button::new(shown).frame(false)).clicked() {
                        picked = Some(h.clone());
                    }
                }
            });
        },
        |ui| {
            if toggle(ui, preserve, "AA", "Preserve Case", "Preserve Case", theme).clicked() {
                preserve = !preserve;
            }
            if toggle(ui, multi, "⏎", "Multiline Replacement", "Multiline", theme).clicked() {
                multi = !multi;
            }
        },
    );
    if field.clear_clicked(ui) {
        text.clear();
    }
    if let Some(h) = picked {
        text = h;
        ui.memory_mut(|m| m.request_focus(ids.replace));
    }
    if !multi && multiline {
        if let Some(i) = text.find('\n') {
            text.truncate(i);
        }
    }
    find.replace_multiline = multi;
    find.set_replacement(&text);
    find.set_preserve_case(preserve);

    ui.add_space(8.0);
    let (index, count) = find.counter();
    if ui.add_enabled(count > 0, Button::new("Replace")).clicked() {
        cmds.push(BarCmd::Replace);
    }
    if ui.add_enabled(count > 0, Button::new("Replace All")).clicked() {
        cmds.push(BarCmd::ReplaceAll);
    }
    if ui.add_enabled(index.is_some(), Button::new("Exclude")).on_hover_text("Skip this match in Replace and Replace All").clicked() {
        cmds.push(BarCmd::Exclude);
    }
}

fn filter_menu(ui: &mut Ui, find: &mut FindState, ids: &BarIds, theme: &EditorTheme) {
    let popup = ids.base.with("filter");
    let filter = find.options().filter;
    let r = toggle_icon(ui, filter != SearchFilter::Anywhere, FindIcon::Filter, "Filter Search Results", "Search In", theme);
    if r.clicked() {
        ui.memory_mut(|m| m.toggle_popup(popup));
    }
    egui::popup_below_widget(ui, popup, &r, PopupCloseBehavior::CloseOnClick, |ui| {
        ui.set_min_width(240.0);
        for f in SearchFilter::ALL {
            if ui.selectable_label(filter == f, f.label()).clicked() {
                find.set_filter(f);
                find.popup_clicked = true;
            }
        }
    });
}

fn more_menu(ui: &mut Ui, find: &mut FindState, ids: &BarIds, theme: &EditorTheme, any: bool, cmds: &mut Vec<BarCmd>) {
    let popup = ids.base.with("more");
    let r = icon_button(ui, true, FindIcon::More, "More Options", "More", theme);
    if r.clicked() {
        ui.memory_mut(|m| m.toggle_popup(popup));
    }
    egui::popup_below_widget(ui, popup, &r, PopupCloseBehavior::CloseOnClickOutside, |ui| {
        ui.set_min_width(220.0);
        if ui.add_enabled(any, Button::new("Select All Occurrences").shortcut_text("⌃⌘G").frame(false)).clicked() {
            cmds.push(BarCmd::SelectAll);
            ui.memory_mut(|m| m.close_popup());
        }
        let has_scope = find.scope().is_some_and(|s| !s.is_empty());
        let mut on = find.in_selection();
        let r = ui.add_enabled(has_scope, egui::Checkbox::new(&mut on, "In Selection"));
        if r.changed() {
            find.set_in_selection(on);
            find.popup_clicked = true;
        }
        r.on_disabled_hover_text("Select text before ⌘F");
    });
}

/// An input field drawn like IDEA's: a rounded box with leading icons, the text and trailing
/// toggles inside it.
struct Field<'a> {
    id: Id,
    label: &'a str,
    hint: &'a str,
    multiline: bool,
    lines: usize,
    width: f32,
    no_match: bool,
    focus: bool,
}

impl Field<'_> {
    fn show(&self, ui: &mut Ui, text: &mut String, theme: &EditorTheme, leading: impl FnOnce(&mut Ui), trailing: impl FnOnce(&mut Ui)) {
        let h = FIELD_H + (self.lines - 1) as f32 * FIELD_LINE_H;
        let (rect, _) = ui.allocate_exact_size(vec2(self.width, h), Sense::hover());
        let focused = ui.memory(|m| m.has_focus(self.id));
        let fill = if self.no_match { theme.find_field_no_match } else { theme.find_field };
        let border = if focused { theme.find_field_focus } else { theme.find_field_border };
        ui.painter().add(RectShape::new(rect, CornerRadius::same(4), fill, Stroke::new(1.0_f32, border), StrokeKind::Inside));

        let inner = rect.shrink2(vec2(3.0, 2.0));
        let top_row = Rect::from_min_size(inner.min, vec2(inner.width(), FIELD_H - 4.0));
        // Trailing toggles right to left, then the clear button.
        let mut right = ui.new_child(UiBuilder::new().max_rect(top_row).layout(Layout::right_to_left(Align::Center)));
        right.spacing_mut().item_spacing.x = 1.0;
        trailing(&mut right);
        if !text.is_empty() {
            right.add_space(2.0);
            let r = icon_button(&mut right, true, FindIcon::Clear, &format!("Clear {}", self.label), "Clear", theme);
            if r.clicked() {
                ui.data_mut(|d| d.insert_temp(self.id.with("clear"), true));
            }
        }
        let used_right = top_row.right() - right.min_rect().left();
        let mut left = ui.new_child(UiBuilder::new().max_rect(top_row).layout(Layout::left_to_right(Align::Center)));
        leading(&mut left);
        let text_left = if left.min_rect().width() > 0.0 { left.min_rect().right() + 2.0 } else { inner.left() + 4.0 };
        let text_rect = Rect::from_min_max(pos2(text_left, inner.top()), pos2(inner.right() - used_right - 2.0, inner.bottom()));

        if self.focus {
            ui.memory_mut(|m| m.request_focus(self.id));
            let mut st = egui::text_edit::TextEditState::load(ui.ctx(), self.id).unwrap_or_default();
            let n = text.chars().count();
            st.cursor.set_char_range(Some(CCursorRange::two(CCursor::new(0), CCursor::new(n))));
            st.store(ui.ctx(), self.id);
        }
        let mut edit_ui = ui.new_child(UiBuilder::new().max_rect(text_rect).layout(Layout::left_to_right(Align::Center)));
        let edit = if self.multiline { TextEdit::multiline(text).desired_rows(self.lines) } else { TextEdit::singleline(text) };
        let resp = edit_ui.add(
            edit.id(self.id)
                .frame(false)
                .hint_text(egui::RichText::new(self.hint).color(theme.find_text_dim))
                .text_color(theme.find_text)
                .font(FontId::proportional(13.0))
                .margin(egui::Margin::symmetric(2, 2))
                .desired_width(text_rect.width()),
        );
        let label = self.label.to_string();
        let value = text.clone();
        resp.widget_info(|| {
            let mut info = WidgetInfo::text_edit(true, value.clone(), value.clone());
            info.typ = WidgetType::TextEdit;
            info.label = Some(label.clone());
            info
        });
        if resp.has_focus() {
            // Escape stays with the field (it closes the bar) instead of clearing egui's focus.
            // Up and Down stay too: without the lock egui moves the focus to the next widget
            // in that direction, while the bar uses them to cycle matches.
            ui.memory_mut(|m| {
                m.set_focus_lock_filter(self.id, EventFilter { tab: false, horizontal_arrows: true, vertical_arrows: true, escape: true })
            });
        }
    }

    /// True once after the field's clear button was clicked.
    fn clear_clicked(&self, ui: &Ui) -> bool {
        ui.data_mut(|d| d.remove_temp::<bool>(self.id.with("clear"))).unwrap_or(false)
    }
}

/// A text-glyph toggle (`Cc`, `W`, `.*`, `AA`, `⏎`).
fn toggle(ui: &mut Ui, on: bool, glyph: &str, label: &str, tooltip: &str, theme: &EditorTheme) -> Response {
    let (rect, resp) = ui.allocate_exact_size(Vec2::splat(BTN), Sense::click());
    resp.widget_info(|| WidgetInfo::selected(WidgetType::Button, true, on, label));
    let painter = ui.painter();
    if on {
        painter.rect_filled(rect, CornerRadius::same(4), theme.find_toggle_on);
    } else if resp.hovered() {
        painter.rect_filled(rect, CornerRadius::same(4), theme.find_hover);
    }
    let color = if on || resp.hovered() { theme.find_text } else { theme.find_icon };
    painter.text(rect.center(), egui::Align2::CENTER_CENTER, glyph, FontId::proportional(12.0), color);
    resp.on_hover_text(tooltip)
}

/// An icon button that shows an on state (the filter while it is not Anywhere).
fn toggle_icon(ui: &mut Ui, on: bool, icon: FindIcon, label: &str, tooltip: &str, theme: &EditorTheme) -> Response {
    let (rect, resp) = ui.allocate_exact_size(Vec2::splat(BTN), Sense::click());
    resp.widget_info(|| WidgetInfo::selected(WidgetType::Button, true, on, label));
    if on {
        ui.painter().rect_filled(rect, CornerRadius::same(4), theme.find_toggle_on);
    } else if resp.hovered() {
        ui.painter().rect_filled(rect, CornerRadius::same(4), theme.find_hover);
    }
    paint_icon(ui.painter(), Rect::from_center_size(rect.center(), Vec2::splat(ICON)), icon, theme.find_icon);
    resp.on_hover_text(tooltip)
}

fn icon_button(ui: &mut Ui, enabled: bool, icon: FindIcon, label: &str, tooltip: &str, theme: &EditorTheme) -> Response {
    icon_button_sized(ui, enabled, icon, label, tooltip, theme, Vec2::splat(BTN))
}

fn icon_button_sized(ui: &mut Ui, enabled: bool, icon: FindIcon, label: &str, tooltip: &str, theme: &EditorTheme, size: Vec2) -> Response {
    let sense = if enabled { Sense::click() } else { Sense::hover() };
    let (rect, resp) = ui.allocate_exact_size(size, sense);
    resp.widget_info(|| WidgetInfo::labeled(WidgetType::Button, enabled, label));
    if enabled && resp.hovered() {
        ui.painter().rect_filled(rect, CornerRadius::same(4), theme.find_hover);
    }
    let color = if enabled { theme.find_icon } else { theme.find_text_dim };
    let icon_rect = Rect::from_min_size(pos2(rect.left() + (BTN - ICON) / 2.0, rect.center().y - ICON / 2.0), Vec2::splat(ICON));
    paint_icon(ui.painter(), icon_rect, icon, color);
    if size.x > BTN {
        // The small arrow of a dropdown button.
        let c = pos2(rect.right() - 5.0, rect.center().y + 1.0);
        ui.painter().add(Shape::convex_polygon(vec![c + vec2(-3.0, -2.0), c + vec2(3.0, -2.0), c + vec2(0.0, 2.0)], color, Stroke::NONE));
    }
    if enabled {
        resp.on_hover_text(tooltip)
    } else {
        resp
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FindIcon {
    ChevronRight,
    ChevronDown,
    Close,
    Clear,
    ArrowUp,
    ArrowDown,
    Filter,
    More,
    History,
}

/// Line icons on a 16x16 grid, in the stroke style of the app's `icons.rs`. Only inline shapes,
/// so drawing allocates nothing.
fn paint_icon(painter: &Painter, rect: Rect, icon: FindIcon, color: Color32) {
    let s = rect.width().min(rect.height()) / 16.0;
    let o = rect.center() - vec2(8.0 * s, 8.0 * s);
    let p = |x: f32, y: f32| -> Pos2 { o + vec2(x * s, y * s) };
    let stroke = Stroke::new((1.25 * s).clamp(1.0, 2.0), color);
    let line = |a: Pos2, b: Pos2| painter.line_segment([a, b], stroke);
    match icon {
        FindIcon::ChevronRight => {
            line(p(6.0, 4.0), p(10.0, 8.0));
            line(p(10.0, 8.0), p(6.0, 12.0));
        }
        FindIcon::ChevronDown => {
            line(p(4.0, 6.0), p(8.0, 10.0));
            line(p(8.0, 10.0), p(12.0, 6.0));
        }
        FindIcon::Close => {
            line(p(4.0, 4.0), p(12.0, 12.0));
            line(p(12.0, 4.0), p(4.0, 12.0));
        }
        FindIcon::Clear => {
            painter.add(CircleShape::filled(p(8.0, 8.0), 6.0 * s, color.gamma_multiply(0.45)));
            let x = Stroke::new(stroke.width, color);
            painter.line_segment([p(5.8, 5.8), p(10.2, 10.2)], x);
            painter.line_segment([p(10.2, 5.8), p(5.8, 10.2)], x);
        }
        FindIcon::ArrowUp => {
            line(p(8.0, 13.0), p(8.0, 3.0));
            line(p(4.0, 7.0), p(8.0, 3.0));
            line(p(12.0, 7.0), p(8.0, 3.0));
        }
        FindIcon::ArrowDown => {
            line(p(8.0, 3.0), p(8.0, 13.0));
            line(p(4.0, 9.0), p(8.0, 13.0));
            line(p(12.0, 9.0), p(8.0, 13.0));
        }
        FindIcon::Filter => {
            line(p(2.5, 3.5), p(13.5, 3.5));
            line(p(2.5, 3.5), p(6.8, 8.5));
            line(p(13.5, 3.5), p(9.2, 8.5));
            line(p(6.8, 8.5), p(6.8, 13.5));
            line(p(9.2, 8.5), p(9.2, 12.0));
            line(p(9.2, 12.0), p(6.8, 13.5));
        }
        FindIcon::More => {
            for y in [3.5, 8.0, 12.5] {
                painter.add(CircleShape::filled(p(8.0, y), 1.3 * s, color));
            }
        }
        FindIcon::History => {
            painter.add(CircleShape::stroke(p(7.0, 7.0), 4.4 * s, stroke));
            line(p(10.2, 10.2), p(13.8, 13.8));
        }
    }
}
