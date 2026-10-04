//! Tool window strips and islands, like IDEA's New UI. The left strip toggles the left panel
//! (top group) and the bottom panel (bottom group). There is no right strip. One tool window per
//! side is visible at a time.

use egui::{pos2, vec2, Frame, Margin, Rect, Response, RichText, Sense, Stroke, Ui, UiBuilder, Vec2};

use crate::icons::{self, Icon};
use crate::theme::T;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ToolWindow {
    // Left side.
    Project,
    /// Git changes / commit. Body drawn by `git::commit_tool_window`.
    Commit,
    Find,
    // Bottom side.
    /// Git log. Body drawn by `git::log_tool_window`.
    Git,
    Usages,
    /// Errors and warnings of the current file.
    Problems,
    Terminal,
    Notifications,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Left,
    Bottom,
}

impl ToolWindow {
    pub const LEFT: [ToolWindow; 3] = [ToolWindow::Project, ToolWindow::Commit, ToolWindow::Find];
    pub const BOTTOM: [ToolWindow; 5] = [ToolWindow::Git, ToolWindow::Usages, ToolWindow::Problems, ToolWindow::Terminal, ToolWindow::Notifications];

    pub fn title(self) -> &'static str {
        match self {
            ToolWindow::Project => "Project",
            ToolWindow::Commit => "Commit",
            ToolWindow::Find => "Find",
            ToolWindow::Git => "Git",
            ToolWindow::Usages => "Find Usages",
            ToolWindow::Problems => "Problems",
            ToolWindow::Terminal => "Terminal",
            ToolWindow::Notifications => "Notifications",
        }
    }

    pub fn side(self) -> Side {
        if ToolWindow::LEFT.contains(&self) {
            Side::Left
        } else {
            Side::Bottom
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Layout {
    pub left: Option<ToolWindow>,
    pub bottom: Option<ToolWindow>,
}

impl Default for Layout {
    fn default() -> Self {
        Layout { left: Some(ToolWindow::Project), bottom: None }
    }
}

impl Layout {
    /// "left=Project;bottom=Git" for eframe storage. Panel sizes persist through egui memory.
    pub fn to_storage(&self) -> String {
        let name = |w: Option<ToolWindow>| w.map_or("", |w| w.title());
        format!("left={};bottom={}", name(self.left), name(self.bottom))
    }

    /// Parses `to_storage` output. Unknown names close the slot; a broken string is ignored.
    pub fn from_storage(text: &str) -> Option<Layout> {
        let mut layout = Layout { left: None, bottom: None };
        let find = |name: &str, side: Side| ToolWindow::LEFT.iter().chain(ToolWindow::BOTTOM.iter()).copied().find(|w| w.title() == name && w.side() == side);
        let mut seen = false;
        for part in text.split(';') {
            let (key, value) = part.split_once('=')?;
            match key {
                "left" => layout.left = find(value, Side::Left),
                "bottom" => layout.bottom = find(value, Side::Bottom),
                _ => continue,
            }
            seen = true;
        }
        seen.then_some(layout)
    }

    pub fn toggle(&mut self, w: ToolWindow) {
        let slot = match w.side() {
            Side::Left => &mut self.left,
            Side::Bottom => &mut self.bottom,
        };
        *slot = if *slot == Some(w) { None } else { Some(w) };
    }

    pub fn show(&mut self, w: ToolWindow) {
        match w.side() {
            Side::Left => self.left = Some(w),
            Side::Bottom => self.bottom = Some(w),
        }
    }
}

impl ToolWindow {
    pub fn icon(self) -> Icon {
        match self {
            ToolWindow::Project => Icon::Project,
            ToolWindow::Commit => Icon::Commit,
            ToolWindow::Find => Icon::Find,
            ToolWindow::Git => Icon::Branch,
            ToolWindow::Usages => Icon::Usages,
            ToolWindow::Problems => Icon::Problems,
            ToolWindow::Terminal => Icon::Terminal,
            ToolWindow::Notifications => Icon::Notifications,
        }
    }

    /// The shortcut shown in the strip button's tooltip.
    fn shortcut(self) -> &'static str {
        match self {
            ToolWindow::Commit => "⌘K",
            ToolWindow::Find => "⇧⌘F",
            ToolWindow::Usages => "⌥F7",
            ToolWindow::Terminal => "⌥F12",
            _ => "",
        }
    }
}

/// The left strip, like IDEA's New UI: the left tool windows at the top, the bottom tool
/// windows at the bottom. Icons only; the active one has a filled rounded highlight.
pub fn left_strip(ui: &mut Ui, layout: &mut Layout, badge: impl Fn(ToolWindow) -> usize) {
    let full = ui.max_rect();
    let t = &T;
    let b = t.space.strip_button;
    let step = b + 4.0;
    let x = full.center().x - b / 2.0;
    for (i, w) in ToolWindow::LEFT.into_iter().enumerate() {
        let rect = Rect::from_min_size(pos2(x, full.min.y + 2.0 + i as f32 * step), vec2(b, b));
        strip_button(ui, rect, layout, w, badge(w));
    }
    for (i, w) in ToolWindow::BOTTOM.into_iter().rev().enumerate() {
        let rect = Rect::from_min_size(pos2(x, full.max.y - b - 2.0 - i as f32 * step), vec2(b, b));
        strip_button(ui, rect, layout, w, badge(w));
    }
}

fn strip_button(ui: &mut Ui, rect: Rect, layout: &mut Layout, w: ToolWindow, badge: usize) {
    let t = &T;
    let resp = ui.interact(rect, crate::workspace::wid(("strip", w.title())), Sense::click());
    let active = layout.left == Some(w) || layout.bottom == Some(w);
    crate::util::label_selectable(&resp, format!("{} tool window", w.title()), active);
    let painter = ui.painter();
    if active {
        painter.rect_filled(rect, t.radius.button, t.strip_active_bg);
    } else if resp.hovered() {
        painter.rect_filled(rect, t.radius.button, t.hover_on_window);
    }
    let color = if active { t.icon_active } else { t.icon };
    icons::paint(painter, Rect::from_center_size(rect.center(), Vec2::splat(t.space.icon)), w.icon(), color);
    if badge > 0 {
        let c = pos2(rect.max.x - 6.0, rect.min.y + 6.0);
        painter.circle(c, 3.5, t.accent, Stroke::new(1.5_f32, t.window_bg));
    }
    let tip = match w.shortcut() {
        "" => w.title().to_string(),
        k => format!("{}  {k}", w.title()),
    };
    if resp.on_hover_text(tip).clicked() {
        layout.toggle(w);
    }
}

/// A square icon button with a rounded hover fill. `label` is its accessibility name.
pub fn icon_button(ui: &mut Ui, icon: Icon, label: &str, tooltip: &str) -> Response {
    let t = &T;
    let size = Vec2::splat(t.space.strip_button - 4.0);
    let (rect, resp) = ui.allocate_exact_size(size, Sense::click());
    crate::util::label_widget(&resp, egui::WidgetType::Button, label);
    if resp.hovered() || resp.is_pointer_button_down_on() {
        ui.painter().rect_filled(rect, t.radius.button, if resp.is_pointer_button_down_on() { t.button_hover } else { t.hover });
    }
    let color = match (resp.enabled(), resp.hovered()) {
        (false, _) => t.text_dim,
        (true, true) => t.icon_active,
        (true, false) => t.icon,
    };
    icons::paint(ui.painter(), Rect::from_center_size(rect.center(), Vec2::splat(t.space.icon)), icon, color);
    if tooltip.is_empty() {
        resp
    } else {
        resp.on_hover_text(tooltip)
    }
}

/// `icon_button` that can be disabled (dimmed, never clicked).
pub fn icon_button_enabled(ui: &mut Ui, enabled: bool, icon: Icon, label: &str, tooltip: &str) -> Response {
    ui.add_enabled_ui(enabled, |ui| icon_button(ui, icon, label, tooltip)).inner
}

/// The frame of an island: the rounded, lighter surface every tool window and the editor sit
/// on. `inner` is the padding inside it.
pub fn island(inner: f32) -> Frame {
    Frame::NONE.fill(T.island_bg).corner_radius(T.island_radius()).inner_margin(Margin::same(inner as i8))
}

/// The header line of a tool window: the title on the left, `extra` (tabs, actions) after it,
/// and the hide button on the right. Returns true when the hide button was clicked.
pub fn header(ui: &mut Ui, title: &str, extra: impl FnOnce(&mut Ui)) -> bool {
    header_with_actions(ui, title, extra, |_| {})
}

/// Like `header`, with `actions` (icon buttons) drawn right to left, left of the hide button,
/// like IDEA's tool window actions.
pub fn header_with_actions(ui: &mut Ui, title: &str, extra: impl FnOnce(&mut Ui), actions: impl FnOnce(&mut Ui)) -> bool {
    let t = &T;
    let mut hide = false;
    let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), t.space.header_h), Sense::hover());
    let mut child = ui.new_child(UiBuilder::new().max_rect(rect).layout(egui::Layout::left_to_right(egui::Align::Center)));
    child.add_space(4.0);
    child.label(RichText::new(title).font(t.semibold(t.font.ui)).color(t.text));
    child.add_space(8.0);
    let mut right = child.new_child(UiBuilder::new().max_rect(rect).layout(egui::Layout::right_to_left(egui::Align::Center)));
    if icon_button(&mut right, Icon::Minus, &format!("Hide {title}"), "Hide").clicked() {
        hide = true;
    }
    actions(&mut right);
    let used_right = rect.max.x - right.min_rect().min.x;
    let rest = Rect::from_min_max(pos2(child.cursor().min.x, rect.min.y), pos2(rect.max.x - used_right - 8.0, rect.max.y));
    let mut extra_ui = child.new_child(UiBuilder::new().max_rect(rest).layout(egui::Layout::left_to_right(egui::Align::Center)));
    extra_ui.set_clip_rect(rest.intersect(extra_ui.clip_rect()));
    extra(&mut extra_ui);
    hide
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_round_trip() {
        let l = Layout { left: Some(ToolWindow::Commit), bottom: Some(ToolWindow::Terminal) };
        let back = Layout::from_storage(&l.to_storage()).unwrap();
        assert_eq!((back.left, back.bottom), (l.left, l.bottom));
        let empty = Layout::from_storage("left=;bottom=").unwrap();
        assert_eq!((empty.left, empty.bottom), (None, None));
        // A window on the wrong side is dropped.
        let wrong = Layout::from_storage("left=Git;bottom=Project").unwrap();
        assert_eq!((wrong.left, wrong.bottom), (None, None));
        assert!(Layout::from_storage("garbage").is_none());
    }
}
