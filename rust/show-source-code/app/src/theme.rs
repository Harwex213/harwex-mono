//! The look of the canvas. Every color and size that the painter uses comes from `T`; no other
//! file writes a color literal. World sizes are in canvas units (1 unit = 1 px at 100% zoom).

use std::sync::Arc;

use egui::{Color32, Context, FontData, FontDefinitions, FontFamily, FontId};

const fn hex(v: u32) -> Color32 {
    Color32::from_rgb((v >> 16) as u8, (v >> 8) as u8, v as u8)
}

const fn hexa(v: u32, alpha: u8) -> Color32 {
    Color32::from_rgba_premultiplied(
        ((v >> 16) as u8 as u32 * alpha as u32 / 255) as u8,
        ((v >> 8) as u8 as u32 * alpha as u32 / 255) as u8,
        (v as u8 as u32 * alpha as u32 / 255) as u8,
        alpha,
    )
}

/// The font family of Inter SemiBold (package names, the HUD title).
pub const SEMIBOLD: &str = "Inter SemiBold";

pub static T: Theme = Theme::light();

pub struct Theme {
    pub canvas_bg: Color32,
    pub grid_dot: Color32,

    pub box_fill: Color32,
    pub box_border: Color32,
    pub box_border_hover: Color32,
    /// Fill of a box when it is too small on screen for its cards.
    pub box_fill_far: Color32,
    pub label: Color32,
    pub label_dim: Color32,
    /// Behind a label that is drawn bigger than its world size (zoomed out).
    pub label_halo: Color32,

    pub card_fill: Color32,
    pub card_border: Color32,
    pub card_title_bg: Color32,
    pub card_title: Color32,
    /// Card fill when it is too small on screen even for line bars.
    pub card_far: Color32,
    pub code_bar: Color32,
    pub code_more: Color32,

    pub code: Color32,
    pub code_keyword: Color32,
    pub code_string: Color32,
    pub code_comment: Color32,
    pub code_number: Color32,
    pub code_type: Color32,

    pub edge: Color32,
    pub edge_dev: Color32,
    pub edge_undeclared: Color32,
    pub file_edge: Color32,
    pub file_edge_hover: Color32,
    pub badge_out: Color32,
    pub badge_in: Color32,

    pub hud_bg: Color32,
    pub hud_border: Color32,
    pub hud_text: Color32,
    pub hud_dim: Color32,
    pub error: Color32,

    pub sizes: Sizes,
}

pub struct Sizes {
    /// Card width in world units.
    pub card_w: f32,
    pub card_title_h: f32,
    pub card_pad: f32,
    pub code_font: f32,
    pub code_line_h: f32,
    pub card_title_font: f32,
    pub label_font: f32,
    /// A package name is never drawn smaller than this on screen.
    pub label_min_px: f32,
    pub area_title_font: f32,
    pub card_radius: f32,
    pub box_radius: f32,
    /// Screen sizes (px).
    pub edge_w: f32,
    pub file_edge_w: f32,
    pub arrow_px: f32,
    pub hud_font: f32,
    pub hud_pad: f32,
    /// Code is drawn as text from this screen font size up, as bars below it.
    pub text_min_px: f32,
    /// Lines become bars from this screen line height up, plain card fills below it.
    pub bar_min_px: f32,
}

impl Theme {
    pub const fn light() -> Theme {
        Theme {
            canvas_bg: hex(0xF3F4F7),
            grid_dot: hex(0xDCE0E6),
            box_fill: hex(0xFFFFFF),
            box_border: hex(0xB9C1CC),
            box_border_hover: hex(0x5B7BB5),
            box_fill_far: hex(0xE6E9EE),
            label: hex(0x1F2733),
            label_dim: hex(0x6B7380),
            label_halo: hexa(0xF3F4F7, 220),
            card_fill: hex(0xFBFCFD),
            card_border: hex(0xD7DCE3),
            card_title_bg: hex(0xECEFF4),
            card_title: hex(0x384252),
            card_far: hex(0xD5DAE2),
            code_bar: hex(0xC9CFD8),
            code_more: hex(0x8A93A0),
            code: hex(0x24292F),
            code_keyword: hex(0xCF222E),
            code_string: hex(0x0A3069),
            code_comment: hex(0x6E7781),
            code_number: hex(0x0550AE),
            code_type: hex(0x8250DF),
            edge: hex(0x4F5D75),
            edge_dev: hex(0x98A3B3),
            edge_undeclared: hex(0xD97706),
            file_edge: hexa(0x2563EB, 110),
            file_edge_hover: hex(0x2563EB),
            badge_out: hex(0x2563EB),
            badge_in: hex(0x15803D),
            hud_bg: hexa(0xFFFFFF, 235),
            hud_border: hex(0xD0D5DD),
            hud_text: hex(0x1F2733),
            hud_dim: hex(0x6B7380),
            error: hex(0xB42318),
            sizes: Sizes {
                card_w: 480.0,
                card_title_h: 26.0,
                card_pad: 10.0,
                code_font: 10.5,
                code_line_h: 14.0,
                card_title_font: 12.0,
                label_font: 24.0,
                label_min_px: 12.0,
                area_title_font: 40.0,
                card_radius: 6.0,
                box_radius: 10.0,
                edge_w: 1.6,
                file_edge_w: 1.2,
                arrow_px: 9.0,
                hud_font: 12.5,
                hud_pad: 10.0,
                text_min_px: 5.5,
                bar_min_px: 1.4,
            },
        }
    }

    pub fn mono(&self, px: f32) -> FontId {
        FontId::monospace(px)
    }

    pub fn ui(&self, px: f32) -> FontId {
        FontId::proportional(px)
    }

    pub fn semibold(&self, px: f32) -> FontId {
        FontId::new(px, FontFamily::Name(SEMIBOLD.into()))
    }
}

/// Fonts are embedded, so text looks the same on every machine (and in snapshots).
pub fn install(ctx: &Context) {
    let mut fonts = FontDefinitions::default();
    fonts.font_data.insert("Inter".into(), Arc::new(FontData::from_static(include_bytes!("../assets/fonts/Inter-Regular.ttf"))));
    fonts.font_data.insert(SEMIBOLD.into(), Arc::new(FontData::from_static(include_bytes!("../assets/fonts/Inter-SemiBold.ttf"))));
    fonts.font_data.insert("JetBrains Mono".into(), Arc::new(FontData::from_static(include_bytes!("../assets/fonts/JetBrainsMono-Regular.ttf"))));
    let prop = fonts.families.entry(FontFamily::Proportional).or_default();
    prop.insert(0, "Inter".into());
    let mono = fonts.families.entry(FontFamily::Monospace).or_default();
    mono.insert(0, "JetBrains Mono".into());
    // Glyphs Inter lacks (arrows, symbols) fall back to egui's default fonts.
    let mut semi = vec![SEMIBOLD.to_string()];
    semi.extend(fonts.families[&FontFamily::Proportional].iter().skip(1).cloned());
    fonts.families.insert(FontFamily::Name(SEMIBOLD.into()), semi);
    ctx.set_fonts(fonts);
    ctx.style_mut(|s| {
        s.visuals = egui::Visuals::light();
        s.visuals.panel_fill = T.canvas_bg;
    });
}
