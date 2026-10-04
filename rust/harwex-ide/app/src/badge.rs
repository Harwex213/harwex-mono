//! Count badges: the small pill with a number at an icon's top-right corner (open terminal tabs
//! on the strip, changed files on the Commit button, open projects on the title-bar project
//! widget). One look everywhere, all sizes and colors from `theme::T`.

use egui::emath::GuiRounding;
use egui::{pos2, vec2, Color32, Painter, Rect, Sense, Stroke, Ui};

use crate::theme::T;

/// The text of a count: `99+` above 99.
pub fn text(count: usize) -> String {
    if count > 99 {
        "99+".into()
    } else {
        count.to_string()
    }
}

/// The pill's rect for `count` and the text inside it. A one-digit pill is a circle centered on
/// `corner` (the icon's top-right corner); a wider one grows to the left, so "99+" stays inside
/// the narrow strip.
fn layout(painter: &Painter, corner: egui::Pos2, count: usize) -> (Rect, std::sync::Arc<egui::Galley>) {
    let t = &T;
    let galley = painter.layout_no_wrap(text(count), t.semibold(t.font.count_badge), t.count_badge_text);
    let h = t.space.count_badge_h;
    let w = (galley.size().x + 2.0 * t.space.count_badge_pad).max(h);
    let max = pos2(corner.x + h / 2.0, corner.y + h / 2.0);
    (Rect::from_min_max(max - vec2(w, h), max).round_to_pixels(painter.pixels_per_point()), galley)
}

/// Paints a badge with `count` centered on `corner`. `ring` is the color under the badge: a
/// ring of it separates the pill from the icon. Returns the pill's rect.
pub fn paint(painter: &Painter, corner: egui::Pos2, count: usize, ring: Color32) -> Rect {
    let t = &T;
    let (rect, galley) = layout(painter, corner, count);
    let r = rect.height() / 2.0;
    painter.rect(rect.expand(t.space.count_badge_ring), r + t.space.count_badge_ring, ring, Stroke::NONE, egui::StrokeKind::Inside);
    painter.rect_filled(rect, r, t.count_badge_bg);
    // Center the digits' ink, not the line box: Inter's line box sits a little high.
    let pos = pos2(rect.center().x - galley.size().x / 2.0, rect.center().y - galley.size().y / 2.0 + t.space.count_badge_text_dy);
    painter.galley(pos, galley, t.count_badge_text);
    rect
}

/// `paint` plus a hover-only accessibility node over the pill, labelled `label` (for example
/// "Terminal, 3 tabs"), so tests and screen readers can read the count. Draws nothing at 0.
pub fn show(ui: &Ui, id: egui::Id, corner: egui::Pos2, count: usize, ring: Color32, label: String) {
    if count == 0 {
        return;
    }
    let rect = paint(ui.painter(), corner, count, ring);
    let resp = ui.interact(rect, id, Sense::hover());
    crate::util::label_widget(&resp, egui::WidgetType::Label, label);
}

/// "1 tab", "3 tabs".
pub fn plural(count: usize, one: &str, many: &str) -> String {
    format!("{count} {}", if count == 1 { one } else { many })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caps_at_99() {
        assert_eq!(text(7), "7");
        assert_eq!(text(99), "99");
        assert_eq!(text(100), "99+");
    }

    #[test]
    fn plurals() {
        assert_eq!(plural(1, "tab", "tabs"), "1 tab");
        assert_eq!(plural(3, "tab", "tabs"), "3 tabs");
    }
}
