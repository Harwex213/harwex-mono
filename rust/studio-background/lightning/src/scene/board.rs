// Roulette number layout: 13 columns (zero, then 12 number columns) of separate tiles.
// Each tile is drawn on the GPU as its own instance; only the numerals come from a texture.

use crate::scene::calibration::{SCREEN_PIXEL_HEIGHT, SCREEN_PIXEL_WIDTH};
use crate::scene::random::random;

pub const COLUMNS: usize = 13;
const ROW_PITCH: f64 = 1.3;
const GAP: f64 = 0.11;
const BOARD_UNITS_W: f64 = COLUMNS as f64;
const BOARD_UNITS_H: f64 = ROW_PITCH * 3.0;

const RED: [u32; 18] = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

pub const SCREEN_ASPECT: f64 = SCREEN_PIXEL_WIDTH / SCREEN_PIXEL_HEIGHT;

// Board rectangle in screen UV (y down): x, y, width, height.
const BOARD_W: f64 = 0.94;
const BOARD_H: f64 = (BOARD_W * SCREEN_ASPECT * BOARD_UNITS_H) / BOARD_UNITS_W;
pub const BOARD_RECT: [f64; 4] = [(1.0 - BOARD_W) / 2.0, 0.22, BOARD_W, BOARD_H];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TileColor {
    Cream,
    Red,
    Green,
}

impl TileColor {
    pub fn index(self) -> f32 {
        match self {
            TileColor::Cream => 0.0,
            TileColor::Red => 1.0,
            TileColor::Green => 2.0,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Tile {
    pub column: usize,
    pub row: usize,
    // Screen UV rect: x, y, width, height.
    pub rect: [f64; 4],
    pub glyph: u32,
    pub color: TileColor,
    pub is_zero: bool,
    pub seed: f64,
}

fn to_screen(x: f64, y: f64, w: f64, h: f64) -> [f64; 4] {
    let sx = BOARD_RECT[2] / BOARD_UNITS_W;
    let sy = BOARD_RECT[3] / BOARD_UNITS_H;
    [BOARD_RECT[0] + x * sx, BOARD_RECT[1] + y * sy, w * sx, h * sy]
}

pub fn build_tiles() -> Vec<Tile> {
    let mut tiles = Vec::new();
    let half = GAP / 2.0;
    tiles.push(Tile {
        column: 0,
        row: 1,
        rect: to_screen(half, half, 1.0 - GAP, BOARD_UNITS_H - GAP),
        glyph: 0,
        color: TileColor::Green,
        is_zero: true,
        seed: random(),
    });
    for c in 0..12 {
        for r in 0..3 {
            let n = (c * 3 + (3 - r)) as u32;
            tiles.push(Tile {
                column: c + 1,
                row: r,
                rect: to_screen((c + 1) as f64 + half, r as f64 * ROW_PITCH + half, 1.0 - GAP, ROW_PITCH - GAP),
                glyph: n,
                color: if RED.contains(&n) { TileColor::Red } else { TileColor::Cream },
                is_zero: false,
                seed: random(),
            });
        }
    }
    tiles
}

// Screen-UV x of a column centre.
pub fn column_center_x(column: usize) -> f64 {
    BOARD_RECT[0] + ((column as f64 + 0.5) / COLUMNS as f64) * BOARD_RECT[2]
}

// Screen-UV y where a bolt striking a column ends.
pub fn column_bottom_y() -> f64 {
    BOARD_RECT[1] + BOARD_RECT[3]
}

pub const GLYPH_SLOT: u32 = 256;
pub const GLYPH_COLS: u32 = 8;
pub const GLYPH_ROWS: u32 = 5;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn board_has_zero_and_36_numbers() {
        let tiles = build_tiles();
        assert_eq!(tiles.len(), 37);
        let mut glyphs: Vec<u32> = tiles.iter().map(|t| t.glyph).collect();
        glyphs.sort();
        assert_eq!(glyphs, (0..=36).collect::<Vec<_>>());
        // Top row of the first number column is 3, bottom is 1.
        assert_eq!(tiles[1].glyph, 3);
        assert_eq!(tiles[3].glyph, 1);
        assert_eq!(tiles[3].color, TileColor::Red);
    }
}
