// White numerals 0..36 on a transparent atlas; the shader colours them.
// The web version drew them with `600 158.72px Inter` on a 2D canvas, centred, with the baseline
// half the height of "0" below the slot centre.

use ab_glyph::{point, Font, FontRef, PxScale, ScaleFont};
use crate::scene::board::{GLYPH_COLS, GLYPH_ROWS, GLYPH_SLOT};

use crate::art::Rgba;

const INTER_SEMIBOLD: &[u8] = include_bytes!("../../assets/Inter-SemiBold.ttf");

pub fn draw_glyph_atlas() -> Rgba {
    let width = GLYPH_SLOT * GLYPH_COLS;
    let height = GLYPH_SLOT * GLYPH_ROWS;
    let mut data = vec![0u8; (width * height * 4) as usize];
    // RGB stays white under zero alpha, as the canvas hands it to WebGL unpremultiplied.
    for px in data.chunks_exact_mut(4) {
        px[0] = 255;
        px[1] = 255;
        px[2] = 255;
    }
    let font = FontRef::try_from_slice(INTER_SEMIBOLD).expect("Inter-SemiBold.ttf is a valid font");
    // A CSS font size is the em size; ab_glyph scales by ascent - descent.
    let em = GLYPH_SLOT as f32 * 0.62;
    let units_per_em = font.units_per_em().expect("font has units per em");
    let scale = PxScale::from(em * font.height_unscaled() / units_per_em);
    let scaled = font.as_scaled(scale);
    // actualBoundingBoxAscent of "0": the top of its ink above the baseline.
    let zero = font.glyph_id('0');
    // ab_glyph keeps the outline bounds y-up with min.y holding the top edge.
    let cap_height = font.outline(zero).map_or(0.0, |o| o.bounds.min.y.max(o.bounds.max.y) * scaled.v_scale_factor());

    for n in 0..=36u32 {
        let cx = (n % GLYPH_COLS) as f32 * GLYPH_SLOT as f32 + GLYPH_SLOT as f32 / 2.0;
        let cy = (n / GLYPH_COLS) as f32 * GLYPH_SLOT as f32 + GLYPH_SLOT as f32 / 2.0;
        let text = n.to_string();
        let ids: Vec<_> = text.chars().map(|c| font.glyph_id(c)).collect();
        let mut advance = 0.0;
        for (i, &id) in ids.iter().enumerate() {
            if i > 0 {
                advance += scaled.kern(ids[i - 1], id);
            }
            advance += scaled.h_advance(id);
        }
        let baseline = cy + cap_height / 2.0;
        let mut x = cx - advance / 2.0;
        for (i, &id) in ids.iter().enumerate() {
            if i > 0 {
                x += scaled.kern(ids[i - 1], id);
            }
            let glyph = id.with_scale_and_position(scale, point(x, baseline));
            if let Some(outlined) = font.outline_glyph(glyph) {
                let bounds = outlined.px_bounds();
                outlined.draw(|gx, gy, coverage| {
                    let px = bounds.min.x as i32 + gx as i32;
                    let py = bounds.min.y as i32 + gy as i32;
                    if px < 0 || py < 0 || px >= width as i32 || py >= height as i32 {
                        return;
                    }
                    let index = ((py as u32 * width + px as u32) * 4 + 3) as usize;
                    let source = coverage.clamp(0.0, 1.0);
                    let under = data[index] as f32 / 255.0;
                    data[index] = ((source + under * (1.0 - source)) * 255.0).round() as u8;
                });
            }
            x += scaled.h_advance(id);
        }
    }
    Rgba { data, width, height }
}

