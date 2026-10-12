// The bolt sprite atlas. Sprite channels are layers, not colours: R is the white-hot core,
// G the tight glow, B the wide halo. The shader tints each layer.
//
// The web version stroked every bolt three times on a 2D canvas with `lighter` compositing and
// a canvas shadow under each stroke. Both are additive, so here each layer sums its strokes and
// their shadow sources, blurs the shadow sum once, and clamps at the end.

use crate::scene::lightning::{build_bolt, Point, ATLAS_COLS, ATLAS_ROWS, SPRITE_COUNT, SPRITE_H, SPRITE_W};
use tiny_skia::{FillRule, LineCap, LineJoin, Mask, PathBuilder, Stroke, Transform};

use crate::art::Rgba;

// Room around a sprite so strokes that leave the cell still cast their shadow into it.
const PAD: u32 = 64;

struct Layer {
    channel: usize,
    shadow_alpha: f64,
    stroke_alpha: f64,
    width: f64,
}

fn layers(w: f64) -> [Layer; 3] {
    [
        // Wide halo.
        Layer { channel: 2, shadow_alpha: 0.9 * w, stroke_alpha: 0.22 * w, width: 26.0 * w + 6.0 },
        // Tight glow.
        Layer { channel: 1, shadow_alpha: w, stroke_alpha: 0.55 * w, width: 7.0 * w + 2.0 },
        // Core.
        Layer { channel: 0, shadow_alpha: 1.0, stroke_alpha: (0.4 + w).min(1.0), width: 2.6 * w + 0.8 },
    ]
}

// canvas shadowBlur of each layer, by channel: core, tight glow, wide halo.
const BLURS: [f64; 3] = [2.0, 12.0, 38.0];

fn stroke_coverage(points: &[Point], width: f64, mask_w: u32, mask_h: u32) -> Option<Mask> {
    let mut builder = PathBuilder::new();
    for (i, p) in points.iter().enumerate() {
        let x = p[0] as f32 + PAD as f32;
        let y = p[1] as f32 + PAD as f32;
        if i == 0 {
            builder.move_to(x, y);
        } else {
            builder.line_to(x, y);
        }
    }
    let path = builder.finish()?;
    let stroke = Stroke { width: width as f32, line_cap: LineCap::Round, line_join: LineJoin::Round, ..Stroke::default() };
    let outline = path.stroke(&stroke, 1.0)?;
    let mut mask = Mask::new(mask_w, mask_h)?;
    mask.fill_path(&outline, FillRule::Winding, true, Transform::identity());
    Some(mask)
}

// Gaussian blur as three box blurs, the way Skia blurs canvas shadows.
fn boxes_for_gauss(sigma: f64) -> [usize; 3] {
    let n = 3.0;
    let ideal = (12.0 * sigma * sigma / n + 1.0).sqrt();
    let mut wl = ideal.floor() as i64;
    if wl % 2 == 0 {
        wl -= 1;
    }
    let wu = wl + 2;
    let m_ideal = (12.0 * sigma * sigma - n * (wl * wl) as f64 - 4.0 * n * wl as f64 - 3.0 * n) / (-4.0 * wl as f64 - 4.0);
    let m = m_ideal.round() as i64;
    let mut sizes = [0usize; 3];
    for (i, size) in sizes.iter_mut().enumerate() {
        *size = if (i as i64) < m { wl } else { wu }.max(1) as usize;
    }
    sizes
}

fn box_blur_h(src: &[f32], dst: &mut [f32], w: usize, h: usize, r: usize) {
    let scale = 1.0 / (2 * r + 1) as f32;
    for y in 0..h {
        let row = &src[y * w..(y + 1) * w];
        let out = &mut dst[y * w..(y + 1) * w];
        let mut sum: f32 = row[..=r.min(w - 1)].iter().sum();
        for (x, out) in out.iter_mut().enumerate() {
            *out = sum * scale;
            if x + r + 1 < w {
                sum += row[x + r + 1];
            }
            if x >= r {
                sum -= row[x - r];
            }
        }
    }
}

fn box_blur_v(src: &[f32], dst: &mut [f32], w: usize, h: usize, r: usize) {
    let scale = 1.0 / (2 * r + 1) as f32;
    for x in 0..w {
        let mut sum = 0.0f32;
        for y in 0..=r.min(h - 1) {
            sum += src[y * w + x];
        }
        for y in 0..h {
            dst[y * w + x] = sum * scale;
            if y + r + 1 < h {
                sum += src[(y + r + 1) * w + x];
            }
            if y >= r {
                sum -= src[(y - r) * w + x];
            }
        }
    }
}

fn gaussian_blur(buffer: &mut [f32], w: usize, h: usize, blur: f64) {
    // A canvas shadowBlur of b is a Gaussian with sigma b / 2.
    let mut scratch = vec![0.0f32; buffer.len()];
    for size in boxes_for_gauss(blur / 2.0) {
        let r = (size - 1) / 2;
        box_blur_h(buffer, &mut scratch, w, h, r);
        box_blur_v(&scratch, buffer, w, h, r);
    }
}

fn draw_sprite() -> [Vec<f32>; 3] {
    let mask_w = SPRITE_W + PAD * 2;
    let mask_h = SPRITE_H + PAD * 2;
    let count = (mask_w * mask_h) as usize;
    let mut direct = [vec![0.0f32; count], vec![0.0f32; count], vec![0.0f32; count]];
    let mut shadow = [vec![0.0f32; count], vec![0.0f32; count], vec![0.0f32; count]];
    for stroke in build_bolt() {
        for layer in layers(stroke.weight) {
            let Some(mask) = stroke_coverage(&stroke.points, layer.width, mask_w, mask_h) else {
                continue;
            };
            let stroke_alpha = layer.stroke_alpha as f32;
            let shadow_alpha = (layer.stroke_alpha * layer.shadow_alpha) as f32;
            let direct = &mut direct[layer.channel];
            let shadow = &mut shadow[layer.channel];
            for (i, &c) in mask.data().iter().enumerate() {
                if c == 0 {
                    continue;
                }
                let coverage = c as f32 / 255.0;
                direct[i] += coverage * stroke_alpha;
                shadow[i] += coverage * shadow_alpha;
            }
        }
    }
    for (channel, shadow) in shadow.iter_mut().enumerate() {
        gaussian_blur(shadow, mask_w as usize, mask_h as usize, BLURS[channel]);
    }
    for channel in 0..3 {
        for (d, s) in direct[channel].iter_mut().zip(&shadow[channel]) {
            *d = (*d + s).min(1.0);
        }
    }
    direct
}

pub fn draw_bolt_atlas() -> Rgba {
    let width = SPRITE_W * ATLAS_COLS;
    let height = SPRITE_H * ATLAS_ROWS;
    let mut data = vec![0u8; (width * height * 4) as usize];
    for px in data.chunks_exact_mut(4) {
        px[3] = 255;
    }
    let sprites: Vec<[Vec<f32>; 3]> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..SPRITE_COUNT).map(|_| scope.spawn(draw_sprite)).collect();
        handles.into_iter().map(|h| h.join().expect("bolt sprite thread panicked")).collect()
    });
    let mask_w = SPRITE_W + PAD * 2;
    for (i, sprite) in sprites.iter().enumerate() {
        let ox = (i as u32 % ATLAS_COLS) * SPRITE_W;
        let oy = (i as u32 / ATLAS_COLS) * SPRITE_H;
        for y in 0..SPRITE_H {
            for x in 0..SPRITE_W {
                let src = ((y + PAD) * mask_w + x + PAD) as usize;
                let dst = (((oy + y) * width + ox + x) * 4) as usize;
                for channel in 0..3 {
                    data[dst + channel] = (sprite[channel][src] * 255.0).round() as u8;
                }
            }
        }
    }
    Rgba { data, width, height }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn box_sizes_cover_sigma() {
        let sizes = boxes_for_gauss(19.0);
        let variance: f64 = sizes.iter().map(|&s| ((s * s) as f64 - 1.0) / 12.0).sum();
        assert!((variance.sqrt() - 19.0).abs() < 1.0);
    }

    #[test]
    fn sprite_has_a_hot_core() {
        let sprite = draw_sprite();
        let max = sprite[0].iter().cloned().fold(0.0f32, f32::max);
        assert!(max > 0.9);
    }
}
