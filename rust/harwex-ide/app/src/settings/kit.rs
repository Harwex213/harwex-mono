//! The building blocks of the Settings pages: section cards with a header, rows with the label
//! on the left and the control in a right-aligned column, switches, segmented controls, scope
//! badges and info lines. Rows are laid out by hand (fixed control widths, wrapped labels), so
//! a narrow window wraps the label instead of pushing the control out of the card.

use std::sync::Arc;

use egui::text::LayoutJob;
use egui::{pos2, vec2, Align, Align2, Color32, FontId, Galley, Id, Layout, Rect, Response, RichText, Sense, Stroke, StrokeKind, TextEdit, Ui, UiBuilder, WidgetInfo, WidgetType};

use super::{global, Detected, Scope};
use crate::icons::{self, Icon};
use crate::theme;

/// The space between two cards.
pub const CARD_GAP: f32 = 12.0;
/// The height of a control (switch row, field, segmented control).
const CTRL_H: f32 = 24.0;
/// The space above and below a row's text.
const ROW_PAD: f32 = 7.0;
/// The gap between the label column and the control column.
const COL_GAP: f32 = 16.0;
const SWITCH_W: f32 = 30.0;
const SWITCH_H: f32 = 17.0;
/// The inner margin of a card, also used by the Keymap group cards.
pub const CARD_MARGIN: egui::Margin = egui::Margin { left: 14, right: 14, top: 12, bottom: 8 };

/// A section card: a rounded box with a subtle fill. `add` draws the header and the rows.
pub fn card<R>(ui: &mut Ui, add: impl FnOnce(&mut Ui) -> R) -> R {
    let t = &theme::T;
    let frame = egui::Frame::new().fill(t.card_bg).stroke(Stroke::new(1.0_f32, t.card_border)).corner_radius(t.radius.popup).inner_margin(CARD_MARGIN);
    let r = frame.show(ui, |ui| {
        ui.set_width(ui.available_width());
        ui.spacing_mut().item_spacing.y = 0.0;
        add(ui)
    });
    ui.add_space(CARD_GAP);
    r.inner
}

fn wrapped(ui: &Ui, text: &str, font: FontId, color: Color32, width: f32, max_rows: usize) -> Arc<Galley> {
    let mut job = LayoutJob::simple(text.to_owned(), font, color, width.max(1.0));
    job.wrap.max_rows = max_rows;
    job.wrap.overflow_character = Some('…');
    ui.fonts(|f| f.layout_job(job))
}

/// A hover-only a11y node with `label` over `rect`.
fn text_node(ui: &Ui, id: Id, rect: Rect, label: &str) {
    let r = ui.interact(rect, id, Sense::hover());
    crate::util::label_widget(&r, WidgetType::Label, label);
}

/// A section header: an accent icon tile, the bold title over a one-line description, and
/// `right` (the scope badge or switch) at the right edge. A thin line closes it.
pub fn header(ui: &mut Ui, icon: Icon, title: &str, desc: &str, right: impl FnOnce(&mut Ui)) {
    let t = &theme::T;
    let w = ui.available_width();
    let (rect, _) = ui.allocate_exact_size(vec2(w, 34.0), Sense::hover());
    // The right part first: the texts get the room it leaves.
    let mut right_ui = ui.new_child(UiBuilder::new().max_rect(rect).layout(Layout::right_to_left(Align::Center)));
    right(&mut right_ui);
    let right_w = right_ui.min_rect().width();
    let p = ui.painter();
    let tile = Rect::from_min_size(pos2(rect.left(), rect.center().y - 14.0), vec2(28.0, 28.0));
    p.rect_filled(tile, t.radius.button, t.section_icon_bg);
    icons::paint(p, tile.shrink(6.0), icon, t.section_icon);
    let x = tile.right() + 10.0;
    let text_w = rect.right() - right_w - 12.0 - x;
    let title_g = wrapped(ui, title, t.semibold(t.font.ui + 0.5), t.text_bright, text_w, 1);
    let desc_g = wrapped(ui, desc, t.small_font(), t.text_dim, text_w, 1);
    let top = rect.center().y - (title_g.size().y + desc_g.size().y + 1.0) / 2.0;
    let title_rect = Rect::from_min_size(pos2(x, top), title_g.size());
    let desc_rect = Rect::from_min_size(pos2(x, title_rect.bottom() + 1.0), desc_g.size());
    p.galley(title_rect.min, title_g, t.text_bright);
    p.galley(desc_rect.min, desc_g, t.text_dim);
    text_node(ui, ui.id().with(("section", title)), title_rect, title);
    text_node(ui, ui.id().with(("section-desc", title)), desc_rect, desc);
    ui.add_space(8.0);
    divider(ui);
}

/// A thin line across the card, with a little air around it.
pub fn divider(ui: &mut Ui) {
    let t = &theme::T;
    let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 9.0), Sense::hover());
    ui.painter().hline(rect.x_range(), rect.center().y, Stroke::new(1.0_f32, t.card_border));
}

pub fn scope_name(scope: Scope) -> &'static str {
    match scope {
        Scope::Global => "Global",
        Scope::Project => "Project",
    }
}

fn scope_tip(scope: Scope) -> String {
    match scope {
        Scope::Global => format!("Stored in the global {}. Applies to every project.", global::FILE_NAME),
        Scope::Project => format!("Stored in {} of this project.", crate::lang::config::CONFIG_PATH),
    }
}

fn scope_fill(scope: Scope) -> Color32 {
    let t = &theme::T;
    match scope {
        Scope::Global => t.scope_global_bg,
        Scope::Project => t.scope_project_bg,
    }
}

/// The scope badge of a section with one home; the file is on its tooltip. A11y:
/// `<section> scope <Global|Project>`.
pub fn badge(ui: &mut Ui, section: &str, scope: Scope) -> Response {
    let t = &theme::T;
    let text = scope_name(scope);
    let galley = ui.painter().layout_no_wrap(text.to_string(), t.small_font(), t.scope_text);
    let size = galley.size() + vec2(16.0, 6.0);
    let (rect, resp) = ui.allocate_exact_size(size, Sense::hover());
    ui.painter().rect_filled(rect, t.radius.badge, scope_fill(scope));
    ui.painter().galley(rect.center() - galley.size() / 2.0, galley, t.scope_text);
    crate::util::label_widget(&resp, WidgetType::Label, format!("{section} scope {text}"));
    resp.on_hover_text(scope_tip(scope))
}

/// The width of a segmented control with `items`.
pub fn segmented_width(ui: &Ui, items: &[&str]) -> f32 {
    let t = &theme::T;
    let w: f32 = items.iter().map(|s| ui.painter().layout_no_wrap(s.to_string(), t.small_font(), t.text).size().x + 20.0).sum();
    w + 4.0
}

/// A row of joined buttons, one selected. `fill` colors the selected segment, `a11y` names
/// each segment (a selectable). Returns the clicked segment.
pub fn segmented(ui: &mut Ui, id: Id, items: &[&str], selected: Option<usize>, fill: impl Fn(usize) -> Color32, a11y: impl Fn(usize) -> String, tip: &str) -> Option<usize> {
    let t = &theme::T;
    let total = segmented_width(ui, items);
    let (rect, _) = ui.allocate_exact_size(vec2(total, 24.0), Sense::hover());
    ui.painter().rect(rect, t.radius.button, t.input_bg, Stroke::new(1.0_f32, t.input_border), StrokeKind::Inside);
    let mut x = rect.left() + 2.0;
    let mut clicked = None;
    for (i, text) in items.iter().enumerate() {
        let w = ui.painter().layout_no_wrap(text.to_string(), t.small_font(), t.text).size().x + 20.0;
        let seg = Rect::from_min_size(pos2(x, rect.top() + 2.0), vec2(w, rect.height() - 4.0));
        x += w;
        let resp = ui.interact(seg, id.with(i), Sense::click());
        let on = selected == Some(i);
        let color = if on {
            ui.painter().rect_filled(seg, t.radius.small + 1.0, fill(i));
            t.on_accent
        } else if resp.hovered() {
            ui.painter().rect_filled(seg, t.radius.small + 1.0, t.hover);
            t.text
        } else {
            t.text_dim
        };
        ui.painter().text(seg.center(), Align2::CENTER_CENTER, *text, t.small_font(), color);
        crate::util::label_selectable(&resp, a11y(i), on);
        let resp = if tip.is_empty() { resp } else { resp.on_hover_text(tip) };
        if resp.clicked() {
            clicked = Some(i);
        }
    }
    clicked
}

/// The Global | Project switch of a shared section. Returns the scope clicked.
pub fn scope_switch(ui: &mut Ui, section: &str, current: Scope) -> Option<Scope> {
    let scopes = [Scope::Global, Scope::Project];
    let selected = scopes.iter().position(|s| *s == current);
    let id = ui.id().with(("scope-switch", section));
    let tip = match current {
        Scope::Global => "All projects use these values. Project overrides them for this project only.".to_string(),
        Scope::Project => scope_tip(Scope::Project),
    };
    segmented(ui, id, &["Global", "Project"], selected, |i| scope_fill(scopes[i]), |i| format!("{section} scope {}", scope_name(scopes[i])), &tip).map(|i| scopes[i])
}

/// The frame of a row: the label (and its hint, at most two lines) on the left, a control
/// column `ctrl_w` wide on the right. Returns the row's response and the control's rect.
fn row_frame(ui: &mut Ui, label: &str, hint: Option<&str>, ctrl_w: f32, sense: Sense, dim: bool) -> (Response, Rect) {
    let t = &theme::T;
    let w = ui.available_width();
    let label_w = (w - ctrl_w - COL_GAP).max(60.0);
    let label_g = wrapped(ui, label, t.ui_font(), if dim { t.text_dim } else { t.text }, label_w, 3);
    let hint_g = hint.map(|h| wrapped(ui, h, t.small_font(), t.text_dim, label_w, 2));
    let line_h = ui.fonts(|f| f.row_height(&t.ui_font()));
    let text_h = label_g.size().y + hint_g.as_ref().map_or(0.0, |g| g.size().y + 2.0);
    let h = text_h.max(CTRL_H) + 2.0 * ROW_PAD;
    let (rect, resp) = ui.allocate_exact_size(vec2(w, h), sense);
    if resp.hovered() && sense.senses_click() {
        ui.painter().rect_filled(rect.expand2(vec2(6.0, 0.0)), t.radius.button, t.hover);
    }
    // One-line rows center everything; a taller row aligns the control with the first line.
    let top = if text_h <= CTRL_H { rect.center().y - text_h / 2.0 } else { rect.top() + ROW_PAD };
    let ctrl_cy = if text_h <= CTRL_H { rect.center().y } else { top + line_h / 2.0 };
    let label_rect = Rect::from_min_size(pos2(rect.left(), top), label_g.size());
    ui.painter().galley(label_rect.min, label_g, t.text);
    if let Some(g) = hint_g {
        let hint_rect = Rect::from_min_size(pos2(rect.left(), label_rect.bottom() + 2.0), g.size());
        ui.painter().galley(hint_rect.min, g, t.text_dim);
        text_node(ui, resp.id.with("hint"), hint_rect, hint.unwrap_or_default());
    }
    let ctrl = Rect::from_center_size(pos2(rect.right() - ctrl_w / 2.0, ctrl_cy), vec2(ctrl_w, CTRL_H));
    (resp, ctrl)
}

fn paint_switch(ui: &Ui, rect: Rect, on: bool, hovered: bool, enabled: bool) {
    let t = &theme::T;
    let track = Rect::from_center_size(pos2(rect.right() - SWITCH_W / 2.0, rect.center().y), vec2(SWITCH_W, SWITCH_H));
    let how = if on { 1.0 } else { 0.0 };
    let mut fill = if on { t.accent } else { t.switch_off };
    if hovered && enabled {
        fill = if on { t.checkbox_fill_hover } else { t.checkbox_border_hover.gamma_multiply(0.7) };
    }
    if !enabled {
        fill = fill.gamma_multiply(0.5);
    }
    let r = SWITCH_H / 2.0;
    ui.painter().rect_filled(track, r, fill);
    let x = egui::lerp(track.left() + r..=track.right() - r, how);
    let knob = if enabled { t.switch_knob } else { t.switch_knob.gamma_multiply(0.6) };
    ui.painter().circle_filled(pos2(x, track.center().y), r - 2.5, knob);
}

/// An on/off setting: the whole row toggles. A11y: a checkbox named `label`.
pub fn switch_row(ui: &mut Ui, label: &str, hint: Option<&str>, value: &mut bool) -> Response {
    switch_row_with(ui, label, hint, value, 0.0, |_, _| {})
}

/// A switch row with more controls left of the switch (`extra_w` wide), which get the
/// switch's value: a field that only counts while the switch is on.
pub fn switch_row_with(ui: &mut Ui, label: &str, hint: Option<&str>, value: &mut bool, extra_w: f32, extra: impl FnOnce(&mut Ui, bool)) -> Response {
    let ctrl_w = SWITCH_W + if extra_w > 0.0 { extra_w + 12.0 } else { 0.0 };
    let (mut resp, ctrl) = row_frame(ui, label, hint, ctrl_w, Sense::click(), false);
    if resp.clicked() {
        *value = !*value;
        resp.mark_changed();
    }
    paint_switch(ui, ctrl, *value, resp.hovered(), true);
    if extra_w > 0.0 {
        let rect = Rect::from_min_max(ctrl.min, pos2(ctrl.right() - SWITCH_W - 12.0, ctrl.bottom()));
        let mut child = ui.new_child(UiBuilder::new().max_rect(rect).layout(Layout::right_to_left(Align::Center)));
        extra(&mut child, *value);
    }
    let on = *value;
    let label = label.to_string();
    resp.widget_info(|| WidgetInfo::selected(WidgetType::Checkbox, true, on, label.clone()));
    resp
}

/// A row with any control in a right column `ctrl_w` wide (laid out right to left).
pub fn control_row(ui: &mut Ui, label: &str, hint: Option<&str>, ctrl_w: f32, add: impl FnOnce(&mut Ui)) {
    let (resp, ctrl) = row_frame(ui, label, hint, ctrl_w, Sense::hover(), false);
    crate::util::label_widget(&resp, WidgetType::Label, label);
    let mut child = ui.new_child(UiBuilder::new().max_rect(ctrl).layout(Layout::right_to_left(Align::Center)));
    add(&mut child);
}

/// Auto / On / Off for a setting whose default depends on the project (`None` is Auto).
/// A11y: `<label>: Auto|On|Off`.
pub fn tri_row(ui: &mut Ui, label: &str, value: &mut Option<bool>) {
    const ITEMS: [&str; 3] = ["Auto", "On", "Off"];
    const VALUES: [Option<bool>; 3] = [None, Some(true), Some(false)];
    let w = segmented_width(ui, &ITEMS);
    let id = ui.id().with(("tri", label));
    control_row(ui, label, None, w, |ui| {
        let t = &theme::T;
        let selected = VALUES.iter().position(|v| v == value);
        if let Some(i) = segmented(ui, id, &ITEMS, selected, |_| t.accent, |i| format!("{label}: {}", ITEMS[i]), "") {
            *value = VALUES[i];
        }
    });
}

/// The width a unit label (`seconds`, `pt`) needs beside its field.
pub fn unit_width(ui: &Ui, unit: &str) -> f32 {
    let t = &theme::T;
    ui.painter().layout_no_wrap(unit.to_string(), t.ui_font(), t.text).size().x
}

/// A number field with its unit after it, for a right-to-left control column.
pub fn number(ui: &mut Ui, enabled: bool, unit: &str, field: egui::DragValue, a11y: &str) {
    let t = &theme::T;
    ui.spacing_mut().item_spacing.x = 6.0;
    ui.label(RichText::new(unit).color(if enabled { t.text } else { t.text_dim }));
    let r = ui.add_enabled_ui(enabled, |ui| ui.add_sized(vec2(52.0, 22.0), field)).inner;
    crate::util::label_widget(&r, WidgetType::DragValue, a11y);
}

/// A path setting: the label on the left, the field filling the rest; `found` shows what is in
/// use under the field. An empty field means the default lookup, shown as the hint text. The
/// field's a11y label is `<label> path`. `indent` moves the row right under its parent row.
pub fn path_row(ui: &mut Ui, label: &str, text: &mut String, default: &str, found: Option<&Detected<String>>, indent: f32) {
    let t = &theme::T;
    let w = ui.available_width();
    let label_w = ((w - indent) * 0.3).clamp(90.0, 170.0);
    let found_h = if found.is_some() { 18.0 } else { 0.0 };
    let (rect, _) = ui.allocate_exact_size(vec2(w, CTRL_H + found_h + 2.0 * ROW_PAD - 2.0), Sense::hover());
    let left = rect.left() + indent;
    let field = Rect::from_min_max(pos2(left + label_w + 12.0, rect.top() + ROW_PAD - 1.0), pos2(rect.right(), rect.top() + ROW_PAD - 1.0 + CTRL_H));
    let label_g = wrapped(ui, label, t.ui_font(), t.text, label_w, 1);
    let label_rect = Rect::from_min_size(pos2(left, field.center().y - label_g.size().y / 2.0), label_g.size());
    ui.painter().galley(label_rect.min, label_g, t.text);
    text_node(ui, ui.id().with(("path-label", label)), label_rect, label);
    let mut child = ui.new_child(UiBuilder::new().max_rect(field).layout(Layout::left_to_right(Align::Center)));
    let edit = child.add(TextEdit::singleline(text).hint_text(default).desired_width(f32::INFINITY).margin(vec2(6.0, 4.0)));
    crate::util::label_widget(&edit, WidgetType::TextEdit, format!("{label} path"));
    if let Some(found) = found {
        let line = Rect::from_min_max(pos2(field.left() + 2.0, field.bottom() + 2.0), pos2(field.right(), field.bottom() + 2.0 + found_h - 2.0));
        let mut child = ui.new_child(UiBuilder::new().max_rect(line).layout(Layout::left_to_right(Align::Center)));
        found_line(&mut child, "In use", found);
    }
}

/// `<what>: <path>`, or why nothing was found, in one cut line.
pub fn found_line(ui: &mut Ui, what: &str, d: &Detected<String>) {
    let t = &theme::T;
    let (text, color) = match d {
        Detected::Looking => (format!("{what}: looking…"), t.text_dim),
        Detected::Found(p) => (format!("{what}: {p}"), t.text_dim),
        Detected::Missing(e) => (format!("{what}: not found. {e}"), t.warning),
    };
    ui.add(egui::Label::new(RichText::new(text).color(color).size(t.font.small)).truncate().selectable(false));
}

/// A note in a tinted box with an icon: what a setting cannot do, where a value comes from.
pub fn info(ui: &mut Ui, icon: Icon, icon_color: Color32, text_color: Color32, text: &str) {
    let t = &theme::T;
    let w = ui.available_width();
    let galley = wrapped(ui, text, t.small_font(), text_color, w - 38.0, 4);
    let h = galley.size().y.max(16.0) + 12.0;
    ui.add_space(4.0);
    let (rect, resp) = ui.allocate_exact_size(vec2(w, h), Sense::hover());
    ui.painter().rect_filled(rect, t.radius.button, t.info_bg);
    let line_h = ui.fonts(|f| f.row_height(&t.small_font()));
    let icon_rect = Rect::from_center_size(pos2(rect.left() + 17.0, rect.top() + 6.0 + line_h / 2.0), vec2(14.0, 14.0));
    icons::paint(ui.painter(), icon_rect, icon, icon_color);
    ui.painter().galley(pos2(rect.left() + 30.0, rect.top() + 6.0), galley, text_color);
    crate::util::label_widget(&resp, WidgetType::Label, text);
    ui.add_space(4.0);
}

/// A plain info note in the dim text color.
pub fn note(ui: &mut Ui, text: &str) {
    let t = &theme::T;
    info(ui, Icon::Info, t.text_dim, t.text_dim, text);
}

/// The strip under a shared section's header in Project scope, with Reset to Global. Returns
/// whether Reset was pressed. A11y: `Reset <section> to Global`.
pub fn override_strip(ui: &mut Ui, section: &str) -> bool {
    let t = &theme::T;
    let w = ui.available_width();
    let text = "This project overrides the global values.";
    ui.add_space(2.0);
    let (rect, resp) = ui.allocate_exact_size(vec2(w, 30.0), Sense::hover());
    ui.painter().rect_filled(rect, t.radius.button, t.override_bg);
    icons::paint(ui.painter(), Rect::from_center_size(pos2(rect.left() + 17.0, rect.center().y), vec2(14.0, 14.0)), Icon::Info, t.text);
    let galley = wrapped(ui, text, t.small_font(), t.text, w - 170.0, 1);
    ui.painter().galley(pos2(rect.left() + 30.0, rect.center().y - galley.size().y / 2.0), galley, t.text);
    crate::util::label_widget(&resp, WidgetType::Label, text);
    let mut child = ui.new_child(UiBuilder::new().max_rect(rect.shrink2(vec2(4.0, 3.0))).layout(Layout::right_to_left(Align::Center)));
    let r = child.add(egui::Button::new(RichText::new("Reset to Global").size(t.font.small)).small());
    crate::util::label_widget(&r, WidgetType::Button, format!("Reset {section} to Global"));
    ui.add_space(4.0);
    r.clicked()
}

/// A small heading inside a card (an Unreal project).
pub fn subheading(ui: &mut Ui, text: &str) {
    let t = &theme::T;
    ui.add_space(6.0);
    ui.label(RichText::new(text).font(t.semibold(t.font.small)).color(t.text_bright));
    ui.add_space(2.0);
}
