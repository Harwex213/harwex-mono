//! Line icons in the style of IDEA's New UI, drawn as vector shapes on a 16x16 grid.
//!
//! Every icon is built only from shapes that egui stores inline (line segments, circles, rects
//! and cubic Béziers), so drawing an icon allocates nothing per frame. No textures, no SVG
//! parsing, no glyphs that a font might lack.

use egui::epaint::{CircleShape, CubicBezierShape, RectShape};
use egui::{pos2, vec2, Color32, CornerRadius, Painter, Pos2, Rect, Shape, Stroke, StrokeKind};

use crate::theme::T;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Icon {
    /// Project tool window: a folder outline.
    Project,
    /// Commit tool window: a commit node on a line.
    Commit,
    /// Git log tool window and the branch widget: a branch graph.
    Branch,
    Terminal,
    /// Find in Files results.
    Find,
    /// Find Usages results.
    Usages,
    Notifications,
    Search,
    Settings,
    /// Update Project: an arrow down onto a line.
    Update,
    /// Commit…: a check mark.
    Check,
    /// Push…: an arrow up from a line.
    Push,
    Close,
    Minus,
    Plus,
    ChevronDown,
    ChevronRight,
    More,
    Lock,
    Refresh,
    /// Rollback: an arrow turning back.
    Rollback,
    /// Show Diff: two panes with a change between them.
    Diff,
    ExpandAll,
    CollapseAll,
}

/// Paints `icon` centered in `rect` (any size; the grid scales to the shorter side).
pub fn paint(painter: &Painter, rect: Rect, icon: Icon, color: Color32) {
    let s = rect.width().min(rect.height()) / 16.0;
    let o = rect.center() - vec2(8.0 * s, 8.0 * s);
    let p = |x: f32, y: f32| -> Pos2 { o + vec2(x * s, y * s) };
    let stroke = Stroke::new((1.25 * s).clamp(1.0, 2.0), color);
    let line = |a: Pos2, b: Pos2| painter.line_segment([a, b], stroke);
    let ring = |c: Pos2, r: f32| painter.add(CircleShape::stroke(c, r * s, stroke));
    let dot = |c: Pos2, r: f32| painter.add(CircleShape::filled(c, r * s, color));
    let frame = |min: Pos2, max: Pos2, r: f32| {
        painter.add(RectShape::stroke(Rect::from_min_max(min, max), CornerRadius::same((r * s) as u8), stroke, StrokeKind::Middle));
    };
    let curve = |a: Pos2, b: Pos2, c: Pos2, d: Pos2| {
        painter.add(Shape::CubicBezier(CubicBezierShape::from_points_stroke([a, b, c, d], false, T.clear, stroke)));
    };
    match icon {
        Icon::Project => {
            frame(p(1.5, 4.5), p(14.5, 13.5), 1.5);
            line(p(1.5, 4.5), p(1.5, 3.3));
            line(p(1.5, 2.8), p(6.0, 2.8));
            line(p(6.0, 2.8), p(7.6, 4.5));
        }
        Icon::Commit => {
            ring(p(8.0, 8.0), 3.0);
            line(p(1.0, 8.0), p(5.0, 8.0));
            line(p(11.0, 8.0), p(15.0, 8.0));
        }
        Icon::Branch => {
            ring(p(4.5, 3.5), 1.8);
            ring(p(4.5, 12.5), 1.8);
            ring(p(11.5, 4.5), 1.8);
            line(p(4.5, 5.3), p(4.5, 10.7));
            curve(p(11.5, 6.3), p(11.5, 9.5), p(4.5, 8.0), p(4.5, 10.7));
        }
        Icon::Terminal => {
            frame(p(1.5, 2.5), p(14.5, 13.5), 2.0);
            line(p(4.5, 6.0), p(7.0, 8.2));
            line(p(7.0, 8.2), p(4.5, 10.4));
            line(p(8.5, 10.5), p(11.5, 10.5));
        }
        Icon::Find | Icon::Search => {
            ring(p(7.0, 7.0), 4.6);
            line(p(10.4, 10.4), p(14.2, 14.2));
        }
        Icon::Usages => {
            ring(p(6.0, 6.0), 3.8);
            line(p(8.8, 8.8), p(11.0, 11.0));
            line(p(10.5, 3.5), p(15.0, 3.5));
            line(p(12.0, 7.0), p(15.0, 7.0));
            line(p(12.5, 14.0), p(15.0, 14.0));
        }
        Icon::Notifications => {
            curve(p(3.5, 11.0), p(4.5, 9.0), p(3.0, 2.5), p(8.0, 2.5));
            curve(p(12.5, 11.0), p(11.5, 9.0), p(13.0, 2.5), p(8.0, 2.5));
            line(p(2.5, 11.5), p(13.5, 11.5));
            line(p(6.5, 13.8), p(9.5, 13.8));
        }
        Icon::Settings => {
            ring(p(8.0, 8.0), 2.2);
            ring(p(8.0, 8.0), 5.0);
            let teeth = Stroke::new(stroke.width * 1.6, color);
            for i in 0..8 {
                let a = i as f32 * std::f32::consts::FRAC_PI_4;
                let (sin, cos) = a.sin_cos();
                painter.line_segment([p(8.0 + 5.0 * cos, 8.0 + 5.0 * sin), p(8.0 + 6.8 * cos, 8.0 + 6.8 * sin)], teeth);
            }
        }
        Icon::Update => {
            line(p(8.0, 1.5), p(8.0, 10.5));
            line(p(4.5, 7.0), p(8.0, 10.5));
            line(p(11.5, 7.0), p(8.0, 10.5));
            line(p(2.5, 14.0), p(13.5, 14.0));
        }
        Icon::Push => {
            line(p(8.0, 11.5), p(8.0, 2.5));
            line(p(4.5, 6.0), p(8.0, 2.5));
            line(p(11.5, 6.0), p(8.0, 2.5));
            line(p(2.5, 14.0), p(13.5, 14.0));
        }
        Icon::Check => {
            line(p(2.5, 8.5), p(6.3, 12.3));
            line(p(6.3, 12.3), p(13.5, 4.0));
        }
        Icon::Close => {
            line(p(4.0, 4.0), p(12.0, 12.0));
            line(p(12.0, 4.0), p(4.0, 12.0));
        }
        Icon::Minus => {
            line(p(3.5, 8.0), p(12.5, 8.0));
        }
        Icon::Plus => {
            line(p(3.5, 8.0), p(12.5, 8.0));
            line(p(8.0, 3.5), p(8.0, 12.5));
        }
        Icon::ChevronDown => {
            line(p(4.0, 6.0), p(8.0, 10.0));
            line(p(8.0, 10.0), p(12.0, 6.0));
        }
        Icon::ChevronRight => {
            line(p(6.0, 4.0), p(10.0, 8.0));
            line(p(10.0, 8.0), p(6.0, 12.0));
        }
        Icon::More => {
            for x in [3.5, 8.0, 12.5] {
                dot(p(x, 8.0), 1.3);
            }
        }
        Icon::Refresh => {
            curve(p(13.0, 8.0), p(13.0, 11.5), p(10.5, 13.5), p(8.0, 13.5));
            curve(p(8.0, 13.5), p(4.5, 13.5), p(3.0, 10.5), p(3.0, 8.0));
            curve(p(3.0, 8.0), p(3.0, 4.5), p(5.5, 2.5), p(8.0, 2.5));
            curve(p(8.0, 2.5), p(10.0, 2.5), p(11.5, 3.5), p(12.5, 5.0));
            line(p(12.5, 5.0), p(12.8, 2.0));
            line(p(12.5, 5.0), p(9.6, 4.6));
        }
        Icon::Rollback => {
            curve(p(4.0, 6.0), p(8.0, 6.0), p(13.5, 5.5), p(13.5, 9.5));
            curve(p(13.5, 9.5), p(13.5, 12.5), p(10.5, 13.5), p(8.0, 13.5));
            line(p(4.0, 6.0), p(7.0, 3.0));
            line(p(4.0, 6.0), p(7.0, 9.0));
        }
        Icon::Diff => {
            frame(p(1.5, 2.5), p(6.5, 13.5), 1.0);
            frame(p(9.5, 2.5), p(14.5, 13.5), 1.0);
            line(p(6.5, 6.0), p(9.5, 9.0));
        }
        Icon::ExpandAll => {
            line(p(4.0, 6.5), p(8.0, 2.5));
            line(p(8.0, 2.5), p(12.0, 6.5));
            line(p(4.0, 9.5), p(8.0, 13.5));
            line(p(8.0, 13.5), p(12.0, 9.5));
        }
        Icon::CollapseAll => {
            line(p(4.0, 2.5), p(8.0, 6.5));
            line(p(8.0, 6.5), p(12.0, 2.5));
            line(p(4.0, 13.5), p(8.0, 9.5));
            line(p(8.0, 9.5), p(12.0, 13.5));
        }
        Icon::Lock => {
            painter.rect_filled(Rect::from_min_max(p(3.5, 7.5), p(12.5, 14.0)), CornerRadius::same((1.5 * s) as u8), color);
            curve(p(5.5, 7.5), p(5.0, 1.8), p(11.0, 1.8), p(10.5, 7.5));
        }
    }
}

/// A filled folder for the project tree, breadcrumbs and popups (`size` is the icon's width).
pub fn folder(painter: &Painter, center: Pos2, size: f32) {
    let s = size / 16.0;
    let body = Rect::from_center_size(center + vec2(0.0, 1.0 * s), vec2(15.0 * s, 10.5 * s));
    let tab = Rect::from_min_size(body.min - vec2(0.0, 2.0 * s), vec2(6.5 * s, 3.5 * s));
    let r = CornerRadius::same((1.5 * s).round() as u8);
    painter.rect_filled(tab, r, T.folder);
    painter.rect_filled(body, r, T.folder);
    painter.line_segment([pos2(body.min.x + 1.0, body.min.y + 2.0 * s), pos2(body.max.x - 1.0, body.min.y + 2.0 * s)], Stroke::new(1.0_f32, T.file_fold));
}

/// A page with a folded corner, colored by the file extension.
pub fn file(painter: &Painter, center: Pos2, size: f32, name: &str) {
    let s = size / 16.0;
    let color = file_color(name);
    let page = Rect::from_center_size(center, vec2(11.0 * s, 14.0 * s));
    painter.rect_filled(page, CornerRadius::same((1.5 * s).round() as u8), color);
    let fold = 4.0 * s;
    let corner = Rect::from_min_size(pos2(page.max.x - fold, page.min.y), vec2(fold, fold));
    painter.rect_filled(corner, CornerRadius { ne: (1.5 * s).round() as u8, sw: (1.0 * s).round() as u8, ..CornerRadius::ZERO }, T.file_fold);
    let stroke = Stroke::new(1.0_f32, T.file_fold);
    for dy in [1.5, 4.0] {
        painter.line_segment([pos2(page.min.x + 2.5 * s, page.center().y + dy * s), pos2(page.max.x - 2.5 * s, page.center().y + dy * s)], stroke);
    }
}

pub fn file_color(name: &str) -> Color32 {
    let ext = name.rsplit_once('.').map_or("", |(_, e)| e);
    match ext {
        "ts" | "tsx" | "mts" | "cts" => T.file_ts,
        "js" | "jsx" | "mjs" | "cjs" => T.file_js,
        "rs" => T.file_rs,
        "json" | "toml" | "yaml" | "yml" => T.file_json,
        "css" | "scss" => T.file_css,
        "md" => T.file_md,
        _ => T.file_default,
    }
}
