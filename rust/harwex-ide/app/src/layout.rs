//! Tool window strips, like IDEA: the left strip toggles the left panel, the bottom strip
//! toggles the bottom panel. One tool window per side is visible at a time.

use egui::{pos2, vec2, Color32, FontId, Rect, Sense, Stroke, Ui};

use crate::theme;

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
    pub const BOTTOM: [ToolWindow; 4] = [ToolWindow::Git, ToolWindow::Usages, ToolWindow::Terminal, ToolWindow::Notifications];

    pub fn title(self) -> &'static str {
        match self {
            ToolWindow::Project => "Project",
            ToolWindow::Commit => "Commit",
            ToolWindow::Find => "Find",
            ToolWindow::Git => "Git",
            ToolWindow::Usages => "Find Usages",
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

/// The vertical strip on the left. Labels are drawn rotated, like IDEA's classic UI.
pub fn left_strip(ui: &mut Ui, layout: &mut Layout, badge: impl Fn(ToolWindow) -> usize) {
    ui.add_space(4.0);
    for w in ToolWindow::LEFT {
        let font = FontId::proportional(12.0);
        let galley = ui.painter().layout_no_wrap(w.title().to_string(), font, theme::TEXT);
        let size = vec2(22.0, galley.size().x + 18.0);
        let (rect, resp) = ui.allocate_exact_size(size, Sense::click());
        let active = layout.left == Some(w);
        crate::util::label_selectable(&resp, format!("{} tool window", w.title()), active);
        paint_button_bg(ui, rect, active, resp.hovered());
        // Rotated -90°: text reads bottom to top, so start at the bottom-left of the rect.
        let pos = pos2(rect.center().x - galley.size().y / 2.0, rect.max.y - 9.0);
        let color = if active { theme::TEXT_BRIGHT } else { theme::TEXT };
        ui.painter().add(egui::epaint::TextShape::new(pos, galley, color).with_angle(-std::f32::consts::FRAC_PI_2));
        draw_badge(ui, rect, badge(w));
        if resp.clicked() {
            layout.toggle(w);
        }
    }
}

/// The horizontal strip above the status bar.
pub fn bottom_strip(ui: &mut Ui, layout: &mut Layout, badge: impl Fn(ToolWindow) -> usize) {
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = 2.0;
        for w in ToolWindow::BOTTOM {
            let font = FontId::proportional(12.0);
            let galley = ui.painter().layout_no_wrap(w.title().to_string(), font, theme::TEXT);
            let size = vec2(galley.size().x + 18.0, 20.0);
            let (rect, resp) = ui.allocate_exact_size(size, Sense::click());
            let active = layout.bottom == Some(w);
            crate::util::label_selectable(&resp, format!("{} tool window", w.title()), active);
            paint_button_bg(ui, rect, active, resp.hovered());
            let color = if active { theme::TEXT_BRIGHT } else { theme::TEXT };
            ui.painter().galley(pos2(rect.min.x + 9.0, rect.center().y - galley.size().y / 2.0), galley, color);
            draw_badge(ui, rect, badge(w));
            if resp.clicked() {
                layout.toggle(w);
            }
        }
    });
}

fn paint_button_bg(ui: &Ui, rect: Rect, active: bool, hovered: bool) {
    if active {
        ui.painter().rect_filled(rect, 3.0, Color32::from_rgb(0x2D, 0x2F, 0x30));
    } else if hovered {
        ui.painter().rect_filled(rect, 3.0, theme::HOVER);
    }
}

fn draw_badge(ui: &Ui, rect: Rect, count: usize) {
    if count == 0 {
        return;
    }
    let c = pos2(rect.max.x - 4.0, rect.min.y + 4.0);
    ui.painter().circle(c, 3.5, theme::TAB_ACTIVE_LINE, Stroke::NONE);
}

/// Header line of a tool window with a hide button.
pub fn header(ui: &mut Ui, title: &str) -> bool {
    let mut hide = false;
    ui.horizontal(|ui| {
        ui.label(egui::RichText::new(title).strong().color(theme::TEXT_BRIGHT));
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            if ui.small_button("-").on_hover_text("Hide").clicked() {
                hide = true;
            }
        });
    });
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
