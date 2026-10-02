//! Darcula-like colors shared by every panel. Editor colors live in `ide_editor::EditorTheme`.

use egui::{Color32, Context, CornerRadius, FontFamily, FontId, Stroke, TextStyle, Visuals};

const fn hex(v: u32) -> Color32 {
    Color32::from_rgb((v >> 16) as u8, (v >> 8) as u8, v as u8)
}

pub const PANEL_BG: Color32 = hex(0x3C3F41);
pub const EDITOR_BG: Color32 = hex(0x2B2B2B);
pub const STRIP_BG: Color32 = hex(0x3C3F41);
pub const TAB_BAR_BG: Color32 = hex(0x3C3F41);
pub const TAB_ACTIVE_BG: Color32 = hex(0x4E5254);
pub const TAB_ACTIVE_LINE: Color32 = hex(0x4A88C7);
pub const POPUP_BG: Color32 = hex(0x3C3F41);
pub const BORDER: Color32 = hex(0x323232);
pub const SELECTION: Color32 = hex(0x2F65CA);
pub const SELECTION_INACTIVE: Color32 = hex(0x0D293E);
pub const HOVER: Color32 = hex(0x4B4E50);
pub const TEXT: Color32 = hex(0xBBBBBB);
pub const TEXT_DIM: Color32 = hex(0x8C8C8C);
pub const TEXT_BRIGHT: Color32 = hex(0xDFDFDF);
pub const MATCH: Color32 = hex(0xFFC66D);
pub const WARNING: Color32 = hex(0xE0A84E);
pub const ERROR: Color32 = hex(0xE06C6C);

// Git status colors on file names, like IDEA's defaults on Darcula.
pub const GIT_MODIFIED: Color32 = hex(0x6897BB);
pub const GIT_ADDED: Color32 = hex(0x629755);
pub const GIT_UNTRACKED: Color32 = hex(0xD1675A);
pub const GIT_DELETED: Color32 = hex(0x6C6C6C);
pub const GIT_CONFLICT: Color32 = hex(0xD5756C);
pub const GIT_RENAMED: Color32 = hex(0x3A8484);

pub fn apply(ctx: &Context) {
    let mut v = Visuals::dark();
    v.panel_fill = PANEL_BG;
    v.window_fill = POPUP_BG;
    v.extreme_bg_color = EDITOR_BG;
    v.faint_bg_color = hex(0x414446);
    v.code_bg_color = EDITOR_BG;
    v.window_stroke = Stroke::new(1.0_f32, hex(0x515658));
    v.window_corner_radius = CornerRadius::same(4);
    v.menu_corner_radius = CornerRadius::same(4);
    v.selection.bg_fill = SELECTION;
    v.selection.stroke = Stroke::new(1.0_f32, TEXT_BRIGHT);
    v.hyperlink_color = hex(0x589DF6);
    v.override_text_color = None;
    v.widgets.noninteractive.bg_fill = PANEL_BG;
    v.widgets.noninteractive.bg_stroke = Stroke::new(1.0_f32, BORDER);
    v.widgets.noninteractive.fg_stroke = Stroke::new(1.0_f32, TEXT);
    v.widgets.inactive.bg_fill = hex(0x4C5052);
    v.widgets.inactive.weak_bg_fill = hex(0x4C5052);
    v.widgets.inactive.fg_stroke = Stroke::new(1.0_f32, TEXT);
    v.widgets.inactive.bg_stroke = Stroke::new(1.0_f32, hex(0x5E6060));
    v.widgets.hovered.bg_fill = hex(0x5A5D5F);
    v.widgets.hovered.weak_bg_fill = hex(0x5A5D5F);
    v.widgets.hovered.fg_stroke = Stroke::new(1.0_f32, TEXT_BRIGHT);
    v.widgets.active.bg_fill = hex(0x2F65CA);
    v.widgets.active.weak_bg_fill = hex(0x2F65CA);
    v.widgets.open.bg_fill = hex(0x4C5052);
    for w in [&mut v.widgets.inactive, &mut v.widgets.hovered, &mut v.widgets.active, &mut v.widgets.open] {
        w.corner_radius = CornerRadius::same(3);
    }
    ctx.set_visuals(v);

    ctx.style_mut(|s| {
        s.text_styles.insert(TextStyle::Body, FontId::new(13.0, FontFamily::Proportional));
        s.text_styles.insert(TextStyle::Button, FontId::new(13.0, FontFamily::Proportional));
        s.text_styles.insert(TextStyle::Small, FontId::new(11.0, FontFamily::Proportional));
        s.text_styles.insert(TextStyle::Monospace, FontId::new(12.5, FontFamily::Monospace));
        s.spacing.item_spacing = egui::vec2(6.0, 3.0);
        s.spacing.button_padding = egui::vec2(8.0, 3.0);
        s.interaction.tooltip_delay = 0.3;
    });
}
