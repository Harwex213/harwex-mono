//! The look of the IDE: IntelliJ IDEA 2025 "Islands Dark". Every color, corner radius, spacing
//! and font size that a widget paints comes from `T`. Widgets never write their own color
//! literals; a new color gets a field here.

use std::sync::Arc;

use egui::{Color32, Context, CornerRadius, FontData, FontDefinitions, FontFamily, FontId, Shadow, Stroke, TextStyle, Visuals};
use ide_editor::EditorTheme;
use ide_term::TerminalTheme;

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

/// The active theme.
pub static T: Theme = Theme::islands_dark();

/// Font family of Inter SemiBold (badge initials, the project name).
pub const SEMIBOLD: &str = "Inter SemiBold";

/// Font data name of the Noto Sans Symbols 2 subset: spinner glyphs that programs put into
/// terminal titles (◐ ◑ ◒ ◓ ◴ ◵ ◶ ◷, the dingbat stars U+2722–U+274B, Braille U+2800–U+28FF).
const SYMBOLS: &str = "Noto Sans Symbols 2";

pub struct Theme {
    // Surfaces.
    /// The window behind the islands, the title bar, the strips and the status bar.
    pub window_bg: Color32,
    /// Tool windows and the editor.
    pub island_bg: Color32,
    pub popup_bg: Color32,
    pub popup_border: Color32,
    /// Lines inside an island (table headers, splitters).
    pub border: Color32,
    pub tab_bar_bg: Color32,
    pub tab_active_bg: Color32,
    pub hover: Color32,
    /// Hover on the window background (strip buttons, title bar widgets, status bar).
    pub hover_on_window: Color32,
    /// The filled rounded highlight of the active strip button.
    pub strip_active_bg: Color32,
    pub selection: Color32,
    pub selection_inactive: Color32,
    /// Project tree rows: the selected row while the tree has keyboard focus (IDEA's blue).
    pub tree_selection: Color32,
    /// The selected row while another window (editor, terminal) has the focus.
    pub tree_selection_inactive: Color32,
    /// A row under the pointer that is not selected.
    pub tree_hover: Color32,
    /// The thin expand chevron in front of a folder row.
    pub tree_chevron: Color32,
    /// Names of excluded folders and their content, IDEA's dimmed orange.
    pub tree_excluded: Color32,
    /// The name of a Cut item waiting for Paste.
    pub tree_cut: Color32,
    pub input_bg: Color32,
    pub input_border: Color32,
    pub button_bg: Color32,
    pub button_hover: Color32,
    pub button_border: Color32,
    pub code_bg: Color32,
    pub banner_bg: Color32,
    pub shadow: Color32,
    pub clear: Color32,

    // Text and icons.
    pub text: Color32,
    pub text_dim: Color32,
    pub text_bright: Color32,
    pub icon: Color32,
    pub icon_active: Color32,
    pub accent: Color32,
    /// Text and marks on an accent fill.
    pub on_accent: Color32,
    pub match_text: Color32,
    pub warning: Color32,
    pub error: Color32,
    pub link: Color32,

    // Git file status colors.
    pub git_modified: Color32,
    pub git_added: Color32,
    pub git_untracked: Color32,
    pub git_deleted: Color32,
    pub git_conflict: Color32,
    pub git_renamed: Color32,

    // File type icons.
    pub folder: Color32,
    pub file_default: Color32,
    pub file_ts: Color32,
    pub file_js: Color32,
    pub file_rs: Color32,
    pub file_json: Color32,
    pub file_css: Color32,
    pub file_md: Color32,
    /// The folded corner and the lines on a file icon.
    pub file_fold: Color32,

    /// Project badge fills, picked by a hash of the project name.
    pub badges: [Color32; 6],
    pub badge_text: Color32,
    /// Alpha of the badge color tint across the title bar, at its strongest.
    pub title_tint_alpha: u8,
    /// Count badges (`badge.rs`): the pill and its number.
    pub count_badge_bg: Color32,
    pub count_badge_text: Color32,

    // Git log.
    pub lanes: [Color32; 8],
    /// (fill, text) of ref labels.
    pub ref_head: (Color32, Color32),
    pub ref_current: (Color32, Color32),
    pub ref_local: (Color32, Color32),
    pub ref_remote: (Color32, Color32),
    pub ref_tag: (Color32, Color32),

    // Diff and merge.
    pub diff_inserted_bg: Color32,
    pub diff_inserted_word: Color32,
    pub diff_inserted_edge: Color32,
    pub diff_deleted_bg: Color32,
    pub diff_deleted_word: Color32,
    pub diff_deleted_edge: Color32,
    pub diff_modified_bg: Color32,
    pub diff_modified_word: Color32,
    pub diff_modified_edge: Color32,
    pub merge_changed: Color32,
    pub merge_conflict: Color32,
    pub merge_resolved: Color32,
    pub scrollbar_track: Color32,
    pub scrollbar_thumb: Color32,
    pub scrollbar_thumb_active: Color32,

    // Checkboxes drawn by hand (commit tree).
    pub checkbox_bg: Color32,
    pub checkbox_border: Color32,
    pub checkbox_border_hover: Color32,
    /// A checked box under the pointer.
    pub checkbox_fill_hover: Color32,
    // Drag and drop in the commit tree: the target group's fill and outline.
    pub drop_target_bg: Color32,
    pub drop_target_border: Color32,
    /// The memory indicator: the bar's track and the share of RAM in use.
    pub memory_track: Color32,
    pub memory_fill: Color32,

    pub radius: Radii,
    pub space: Spacing,
    pub font: FontSizes,

    pub editor: EditorTheme,
    pub terminal: TerminalTheme,
}

pub struct Radii {
    pub island: f32,
    pub popup: f32,
    pub button: f32,
    /// List rows, tabs, strip buttons.
    pub row: f32,
    pub small: f32,
    pub badge: f32,
}

/// The side of IDEA's checkbox square (its corners use `Radii::small`).
pub const CHECKBOX_SIZE: f32 = 14.0;

pub struct Spacing {
    /// Between islands, and between an island and the window edge.
    pub gap: f32,
    /// Inside an island, around its content.
    pub island_pad: f32,
    pub title_h: f32,
    /// The macOS window buttons (`chrome::title_bar_layout`): the close button's left inset,
    /// the distance between two button origins, and the gap from the zoom button to the content.
    pub lights_inset: f32,
    pub lights_pitch: f32,
    pub lights_gap: f32,
    /// Left inset of the title bar content when no window buttons sit there (full screen, Linux).
    pub title_pad: f32,
    pub strip_w: f32,
    pub strip_button: f32,
    pub icon: f32,
    pub status_h: f32,
    pub tab_h: f32,
    pub header_h: f32,
    pub row_h: f32,
    pub indent: f32,
    /// Width of the tree's expand chevron, and its stroke.
    pub chevron_w: f32,
    pub chevron_stroke: f32,
    /// Inset of the editor inside its island, so square editor corners stay inside the round ones.
    pub editor_pad: f32,
    /// Count badges: the pill's height, the padding beside the number, the ring around it
    /// and the number's vertical nudge.
    pub count_badge_h: f32,
    pub count_badge_pad: f32,
    pub count_badge_ring: f32,
    pub count_badge_text_dy: f32,
}

pub struct FontSizes {
    pub ui: f32,
    pub small: f32,
    pub tiny: f32,
    pub mono: f32,
    pub mono_small: f32,
    pub hint: f32,
    pub big: f32,
    pub welcome: f32,
    pub badge: f32,
    pub count_badge: f32,
}

impl Theme {
    pub const fn islands_dark() -> Theme {
        Theme {
            window_bg: hex(0x141517),
            island_bg: hex(0x1E1F22),
            popup_bg: hex(0x2B2D30),
            popup_border: hex(0x43454A),
            border: hex(0x2E3034),
            tab_bar_bg: hex(0x1E1F22),
            tab_active_bg: hex(0x2E3036),
            hover: hex(0x2A2C30),
            hover_on_window: hex(0x222327),
            strip_active_bg: hex(0x2E3035),
            selection: hex(0x2E436E),
            selection_inactive: hex(0x2C2E33),
            tree_selection: hex(0x2E436E),
            tree_selection_inactive: hex(0x43454A),
            tree_hover: hex(0x26282B),
            tree_chevron: hex(0x8C8F96),
            tree_excluded: hex(0xA2794F),
            tree_cut: hex(0x6F737A),
            input_bg: hex(0x191A1C),
            input_border: hex(0x43454A),
            button_bg: hex(0x2B2D30),
            button_hover: hex(0x393B40),
            button_border: hex(0x4E5157),
            code_bg: hex(0x393B40),
            banner_bg: hex(0x3D3223),
            shadow: hexa(0x000000, 110),
            clear: Color32::TRANSPARENT,

            text: hex(0xDFE1E5),
            text_dim: hex(0x6F737A),
            text_bright: hex(0xF0F1F2),
            icon: hex(0xCED0D6),
            icon_active: hex(0xFFFFFF),
            accent: hex(0x3574F0),
            on_accent: hex(0xFFFFFF),
            match_text: hex(0xE8A33E),
            warning: hex(0xE5A84B),
            error: hex(0xF0524F),
            link: hex(0x548AF7),

            git_modified: hex(0x70AEFF),
            git_added: hex(0x73BD79),
            git_untracked: hex(0xD5756C),
            git_deleted: hex(0x6F737A),
            git_conflict: hex(0xF0524F),
            git_renamed: hex(0x3BB8B1),

            folder: hex(0x9DA0A8),
            file_default: hex(0x8C8F96),
            file_ts: hex(0x3D8BF5),
            file_js: hex(0xE5BF4B),
            file_rs: hex(0xD8814C),
            file_json: hex(0xC2A04E),
            file_css: hex(0x9D7BE0),
            file_md: hex(0x5FB0C9),
            file_fold: hexa(0x000000, 90),

            badges: [hex(0x3574F0), hex(0xB4572C), hex(0x4C9A5F), hex(0x8C55C9), hex(0x2F8F9D), hex(0xB8443F)],
            badge_text: hex(0xFFFFFF),
            title_tint_alpha: 46,
            count_badge_bg: hex(0x3574F0),
            count_badge_text: hex(0xFFFFFF),

            lanes: [
                hex(0x5F9EE6),
                hex(0x8DBF5A),
                hex(0xE08E45),
                hex(0xC078D8),
                hex(0x4EC2B8),
                hex(0xE06C8A),
                hex(0xD6C04E),
                hex(0x9A9AE8),
            ],
            ref_head: (hex(0x5A3F1E), hex(0xF2C55C)),
            ref_current: (hex(0x4D4220), hex(0xF5D47A)),
            ref_local: (hex(0x253D2A), hex(0x8ED596)),
            ref_remote: (hex(0x3A2F4D), hex(0xC9A8F0)),
            ref_tag: (hex(0x3D3A26), hex(0xE0D890)),

            diff_inserted_bg: hex(0x253D2C),
            diff_inserted_word: hex(0x33603D),
            diff_inserted_edge: hex(0x447F50),
            diff_deleted_bg: hex(0x36383D),
            diff_deleted_word: hex(0x52555C),
            diff_deleted_edge: hex(0x5B5E64),
            diff_modified_bg: hex(0x253857),
            diff_modified_word: hex(0x325285),
            diff_modified_edge: hex(0x4673BD),
            merge_changed: hex(0x253857),
            merge_conflict: hex(0x4A2B2B),
            merge_resolved: hex(0x283B2C),
            scrollbar_track: hex(0x1E1F22),
            scrollbar_thumb: hexa(0xFFFFFF, 40),
            scrollbar_thumb_active: hexa(0xFFFFFF, 70),

            checkbox_bg: hex(0x2B2D30),
            checkbox_border: hex(0x6F737A),
            checkbox_border_hover: hex(0xA8ADB5),
            checkbox_fill_hover: hex(0x4682FA),
            drop_target_bg: hexa(0x3574F0, 40),
            drop_target_border: hex(0x3574F0),
            memory_track: hex(0x1E1F22),
            memory_fill: hex(0x2E436E),

            radius: Radii { island: 10.0, popup: 8.0, button: 6.0, row: 4.0, small: 3.0, badge: 5.0 },
            space: Spacing {
                gap: 6.0,
                island_pad: 8.0,
                title_h: 40.0,
                lights_inset: 12.0,
                lights_pitch: 20.0,
                lights_gap: 12.0,
                title_pad: 10.0,
                strip_w: 40.0,
                strip_button: 30.0,
                icon: 16.0,
                status_h: 28.0,
                tab_h: 34.0,
                header_h: 32.0,
                row_h: 22.0,
                indent: 18.0,
                chevron_w: 8.0,
                chevron_stroke: 1.3,
                editor_pad: 4.0,
                count_badge_h: 13.0,
                count_badge_pad: 3.5,
                count_badge_ring: 1.5,
                count_badge_text_dy: 0.0,
            },
            font: FontSizes { ui: 13.0, small: 12.0, tiny: 11.0, mono: 13.0, mono_small: 12.0, hint: 13.0, big: 15.0, welcome: 24.0, badge: 10.5, count_badge: 9.0 },

            editor: EditorTheme::islands_dark(),
            terminal: TerminalTheme::islands_dark(),
        }
    }

    pub fn ui_font(&self) -> FontId {
        FontId::proportional(self.font.ui)
    }

    pub fn small_font(&self) -> FontId {
        FontId::proportional(self.font.small)
    }

    pub fn tiny_font(&self) -> FontId {
        FontId::proportional(self.font.tiny)
    }

    pub fn mono_font(&self) -> FontId {
        FontId::monospace(self.font.mono)
    }

    pub fn mono_small_font(&self) -> FontId {
        FontId::monospace(self.font.mono_small)
    }

    pub fn semibold(&self, size: f32) -> FontId {
        FontId::new(size, FontFamily::Name(SEMIBOLD.into()))
    }

    pub fn island_radius(&self) -> CornerRadius {
        CornerRadius::same(self.radius.island as u8)
    }

    pub fn popup_shadow(&self) -> Shadow {
        Shadow { offset: [0, 4], blur: 16, spread: 0, color: self.shadow }
    }

    /// The badge fill for a project, stable across runs.
    pub fn badge_color(&self, name: &str) -> Color32 {
        let h = name.bytes().fold(5381u32, |h, b| h.wrapping_mul(33) ^ b as u32);
        self.badges[h as usize % self.badges.len()]
    }
}

/// Inter for the UI, JetBrains Mono for code and the terminal. egui's own fonts stay behind them
/// as fallbacks (emoji and rare symbols).
pub fn install_fonts(ctx: &Context) {
    let mut fonts = FontDefinitions::default();
    let add = |fonts: &mut FontDefinitions, name: &str, bytes: &'static [u8]| {
        fonts.font_data.insert(name.to_string(), Arc::new(FontData::from_static(bytes)));
    };
    add(&mut fonts, "Inter", include_bytes!("../assets/fonts/Inter-Regular.ttf"));
    add(&mut fonts, SEMIBOLD, include_bytes!("../assets/fonts/Inter-SemiBold.ttf"));
    add(&mut fonts, "JetBrains Mono", include_bytes!("../assets/fonts/JetBrainsMono-Regular.ttf"));
    add(&mut fonts, SYMBOLS, include_bytes!("../assets/fonts/NotoSansSymbols2-Subset.ttf"));
    let fallbacks = fonts.families.get(&FontFamily::Proportional).cloned().unwrap_or_default();
    // The symbols subset comes before egui's fonts: they draw ◐ as a box and ◑ from an icon font.
    let proportional = fonts.families.entry(FontFamily::Proportional).or_default();
    proportional.insert(0, "Inter".into());
    proportional.insert(1, SYMBOLS.into());
    // Code falls back to Inter before egui's fonts: Inter covers more UI symbols.
    let mono = fonts.families.entry(FontFamily::Monospace).or_default();
    mono.insert(0, "JetBrains Mono".into());
    mono.insert(1, "Inter".into());
    mono.insert(2, SYMBOLS.into());
    let mut semibold = vec![SEMIBOLD.to_string(), "Inter".to_string(), SYMBOLS.to_string()];
    semibold.extend(fallbacks);
    fonts.families.insert(FontFamily::Name(SEMIBOLD.into()), semibold);
    ctx.set_fonts(fonts);
}

pub fn apply(ctx: &Context) {
    install_fonts(ctx);
    let t = &T;
    let r = |v: f32| CornerRadius::same(v as u8);
    let mut v = Visuals::dark();
    v.panel_fill = t.window_bg;
    v.window_fill = t.popup_bg;
    v.extreme_bg_color = t.input_bg;
    v.faint_bg_color = t.hover;
    v.code_bg_color = t.code_bg;
    v.window_stroke = Stroke::new(1.0_f32, t.popup_border);
    v.window_corner_radius = r(t.radius.popup);
    v.menu_corner_radius = r(t.radius.popup);
    v.window_shadow = t.popup_shadow();
    v.popup_shadow = t.popup_shadow();
    v.selection.bg_fill = t.selection;
    v.selection.stroke = Stroke::new(1.0_f32, t.accent);
    v.hyperlink_color = t.link;
    v.warn_fg_color = t.warning;
    v.error_fg_color = t.error;
    v.override_text_color = None;
    v.widgets.noninteractive.bg_fill = t.island_bg;
    v.widgets.noninteractive.weak_bg_fill = t.island_bg;
    v.widgets.noninteractive.bg_stroke = Stroke::new(1.0_f32, t.border);
    v.widgets.noninteractive.fg_stroke = Stroke::new(1.0_f32, t.text);
    v.widgets.inactive.bg_fill = t.button_bg;
    v.widgets.inactive.weak_bg_fill = t.button_bg;
    v.widgets.inactive.fg_stroke = Stroke::new(1.0_f32, t.text);
    v.widgets.inactive.bg_stroke = Stroke::new(1.0_f32, t.input_border);
    v.widgets.hovered.bg_fill = t.button_hover;
    v.widgets.hovered.weak_bg_fill = t.button_hover;
    v.widgets.hovered.fg_stroke = Stroke::new(1.0_f32, t.text_bright);
    v.widgets.hovered.bg_stroke = Stroke::new(1.0_f32, t.button_border);
    v.widgets.active.bg_fill = t.accent;
    v.widgets.active.weak_bg_fill = t.accent;
    v.widgets.active.fg_stroke = Stroke::new(1.0_f32, t.on_accent);
    v.widgets.active.bg_stroke = Stroke::new(1.0_f32, t.accent);
    v.widgets.open.bg_fill = t.button_hover;
    v.widgets.open.weak_bg_fill = t.button_hover;
    v.widgets.open.fg_stroke = Stroke::new(1.0_f32, t.text_bright);
    for w in [&mut v.widgets.noninteractive, &mut v.widgets.inactive, &mut v.widgets.hovered, &mut v.widgets.active, &mut v.widgets.open] {
        w.corner_radius = r(t.radius.row);
    }
    ctx.set_visuals(v);

    ctx.style_mut(|s| {
        s.text_styles.insert(TextStyle::Heading, FontId::proportional(t.font.big));
        s.text_styles.insert(TextStyle::Body, t.ui_font());
        s.text_styles.insert(TextStyle::Button, t.ui_font());
        s.text_styles.insert(TextStyle::Small, t.tiny_font());
        s.text_styles.insert(TextStyle::Monospace, t.mono_small_font());
        s.spacing.item_spacing = egui::vec2(6.0, 4.0);
        s.spacing.button_padding = egui::vec2(10.0, 4.0);
        s.spacing.menu_margin = egui::Margin::same(6);
        s.spacing.window_margin = egui::Margin::same(10);
        s.spacing.interact_size.y = 22.0;
        s.interaction.tooltip_delay = 0.3;
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Shortcut glyphs in menus and hints must come from a real font, not draw as boxes.
    #[test]
    fn fonts_cover_shortcut_symbols() {
        let ctx = Context::default();
        install_fonts(&ctx);
        let _ = ctx.run(Default::default(), |_| {});
        // The check can fail: a code point no bundled font has is reported missing.
        assert!(!ctx.fonts(|f| f.has_glyph(&T.ui_font(), '\u{10FFFD}')));
        for font in [T.ui_font(), T.small_font(), T.mono_font(), T.semibold(12.0)] {
            // The second half: spinner glyphs that Claude Code and other programs put into a
            // terminal title (`terminal::status_glyph`).
            for c in "⇧⌘⌥⌃⌄⏎⌫⎋→←↑↓›…•●✓×−·–◐◑◒◓◴◵◶◷✢✳✶✻✽⠋⠙⠹⣿".chars() {
                assert!(ctx.fonts(|f| f.has_glyph(&font, c)), "{c:?} is missing in {font:?}");
            }
        }
    }

    #[test]
    fn badge_color_is_stable() {
        assert_eq!(T.badge_color("harwex-mono"), T.badge_color("harwex-mono"));
    }
}
