//! Colors. Every color the terminal widget paints comes from here. The default theme follows
//! IDEA's Islands Dark terminal so the tool window matches the rest of the IDE.

use alacritty_terminal::term::color::Colors;
use alacritty_terminal::vte::ansi::{Color, NamedColor, Rgb};
use egui::Color32;

#[derive(Clone, Debug, PartialEq)]
pub struct TerminalTheme {
    pub foreground: Color32,
    pub background: Color32,
    pub cursor: Color32,
    pub selection: Color32,
    /// Underline color of a hovered `path:line:col` link.
    pub link: Color32,
    /// ANSI 0-15: black, red, green, yellow, blue, magenta, cyan, white, then the bright set.
    pub ansi: [Color32; 16],
}

impl Default for TerminalTheme {
    fn default() -> Self {
        Self::islands_dark()
    }
}

/// "No color set" in the widget's cell buffer; never painted.
pub(crate) const NO_COLOR: Color32 = Color32::TRANSPARENT;

pub(crate) fn from_rgb(c: Rgb) -> Color32 {
    Color32::from_rgb(c.r, c.g, c.b)
}

impl TerminalTheme {
    /// IDEA 2025 Islands Dark: the terminal sits on the island fill.
    pub const fn islands_dark() -> Self {
        const fn c(r: u8, g: u8, b: u8) -> Color32 {
            Color32::from_rgb(r, g, b)
        }
        TerminalTheme {
            foreground: c(0xbc, 0xbe, 0xc4),
            background: c(0x1e, 0x1f, 0x22),
            cursor: c(0xce, 0xd0, 0xd6),
            selection: c(0x21, 0x42, 0x83),
            link: c(0x54, 0x8a, 0xf7),
            ansi: [
                c(0x1e, 0x1f, 0x22),
                c(0xf0, 0x52, 0x4f),
                c(0x5f, 0xb8, 0x65),
                c(0xd6, 0xa1, 0x3b),
                c(0x3d, 0x8b, 0xf5),
                c(0xc2, 0x7f, 0xd8),
                c(0x24, 0xb6, 0xc2),
                c(0xbc, 0xbe, 0xc4),
                c(0x6f, 0x73, 0x7a),
                c(0xff, 0x6b, 0x68),
                c(0x7e, 0xd3, 0x83),
                c(0xf2, 0xc5, 0x5c),
                c(0x6c, 0xa6, 0xff),
                c(0xe0, 0x9e, 0xf2),
                c(0x4f, 0xd6, 0xe0),
                c(0xff, 0xff, 0xff),
            ],
        }
    }

    pub fn darcula() -> Self {
        let c = Color32::from_rgb;
        TerminalTheme {
            foreground: c(0xbb, 0xbb, 0xbb),
            background: c(0x2b, 0x2b, 0x2b),
            cursor: c(0xbb, 0xbb, 0xbb),
            selection: c(0x21, 0x42, 0x83),
            link: c(0x58, 0x9d, 0xf6),
            ansi: [
                c(0x00, 0x00, 0x00),
                c(0xf0, 0x52, 0x4f),
                c(0x5c, 0x96, 0x2c),
                c(0xa6, 0x8a, 0x0d),
                c(0x31, 0x84, 0xe5),
                c(0xa9, 0x6e, 0xc4),
                c(0x00, 0xa3, 0xa3),
                c(0x80, 0x80, 0x80),
                c(0x59, 0x59, 0x59),
                c(0xff, 0x40, 0x50),
                c(0x4f, 0xc4, 0x14),
                c(0xe5, 0xbf, 0x00),
                c(0x1f, 0xb0, 0xff),
                c(0xed, 0x7e, 0xed),
                c(0x00, 0xe5, 0xe5),
                c(0xff, 0xff, 0xff),
            ],
        }
    }

    /// The color for xterm palette index `i` (0-255) before any OSC 4 override.
    pub fn indexed(&self, i: u8) -> Color32 {
        match i {
            0..=15 => self.ansi[i as usize],
            16..=231 => {
                // 6x6x6 cube with the xterm channel levels 0, 95, 135, 175, 215, 255.
                let i = i - 16;
                let level = |v: u8| if v == 0 { 0 } else { 55 + v * 40 };
                Color32::from_rgb(level(i / 36), level((i / 6) % 6), level(i % 6))
            }
            232..=255 => {
                let v = 8 + (i - 232) * 10;
                Color32::from_rgb(v, v, v)
            }
        }
    }

    /// The color a program sees for palette slot `index` (0-268, alacritty's layout), used to
    /// answer OSC 4/10/11 queries.
    pub fn slot_rgb(&self, index: usize) -> Rgb {
        let c = match index {
            0..=255 => self.indexed(index as u8),
            256 | 267 => self.foreground,
            257 => self.background,
            258 => self.cursor,
            259..=266 => dim(self.ansi[index - 259]),
            268 => dim(self.foreground),
            _ => self.foreground,
        };
        Rgb {
            r: c.r(),
            g: c.g(),
            b: c.b(),
        }
    }

    fn named(&self, n: NamedColor) -> Color32 {
        let i = n as usize;
        match n {
            NamedColor::Foreground | NamedColor::BrightForeground => self.foreground,
            NamedColor::Background => self.background,
            NamedColor::Cursor => self.cursor,
            NamedColor::DimForeground => dim(self.foreground),
            _ if i < 16 => self.ansi[i],
            // Dim black..dim white sit at 259..267 in alacritty's numbering.
            _ => dim(self.ansi[(i - NamedColor::DimBlack as usize).min(7)]),
        }
    }

    /// Resolves a cell color, preferring the program's OSC overrides in `overrides`.
    pub fn resolve(&self, color: Color, overrides: &Colors) -> Color32 {
        match color {
            Color::Spec(rgb) => Color32::from_rgb(rgb.r, rgb.g, rgb.b),
            Color::Indexed(i) => match overrides[i as usize] {
                Some(rgb) => Color32::from_rgb(rgb.r, rgb.g, rgb.b),
                None => self.indexed(i),
            },
            Color::Named(n) => match overrides[n] {
                Some(rgb) => Color32::from_rgb(rgb.r, rgb.g, rgb.b),
                None => self.named(n),
            },
        }
    }
}

/// Faint (SGR 2) text: two thirds of the brightness, like xterm.
pub fn dim(c: Color32) -> Color32 {
    let f = |v: u8| ((v as u16 * 2) / 3) as u8;
    Color32::from_rgb(f(c.r()), f(c.g()), f(c.b()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xterm_256_palette() {
        let t = TerminalTheme::default();
        assert_eq!(t.indexed(16), Color32::from_rgb(0, 0, 0));
        assert_eq!(t.indexed(196), Color32::from_rgb(255, 0, 0));
        assert_eq!(t.indexed(231), Color32::from_rgb(255, 255, 255));
        assert_eq!(t.indexed(232), Color32::from_rgb(8, 8, 8));
        assert_eq!(t.indexed(255), Color32::from_rgb(238, 238, 238));
    }

    #[test]
    fn overrides_win() {
        let t = TerminalTheme::default();
        let mut colors = Colors::default();
        assert_eq!(t.resolve(Color::Named(NamedColor::Red), &colors), t.ansi[1]);
        colors[NamedColor::Red] = Some(Rgb { r: 1, g: 2, b: 3 });
        assert_eq!(
            t.resolve(Color::Named(NamedColor::Red), &colors),
            Color32::from_rgb(1, 2, 3)
        );
        assert_eq!(
            t.resolve(Color::Indexed(1), &colors),
            Color32::from_rgb(1, 2, 3)
        );
        let spec = Color::Spec(Rgb {
            r: 255,
            g: 100,
            b: 0,
        });
        assert_eq!(t.resolve(spec, &colors), Color32::from_rgb(255, 100, 0));
    }
}
