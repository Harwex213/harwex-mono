//! Gutter dilation and the Rgb9e5 encoding of the lightmap.

use bevy::math::Vec3;

/// Packs linear RGB into Rgb9e5Ufloat (the wgpu and Vulkan shared-exponent layout).
pub fn encode_rgb9e5(rgb: Vec3) -> u32 {
    let c = rgb.to_array().map(|v| if v.is_finite() { (v as f64).clamp(0.0, 65408.0) } else { 0.0 });
    let maxc = c[0].max(c[1]).max(c[2]);
    let mut exp_shared = (-16f64).max(maxc.max(1e-30).log2().floor()) + 1.0 + 15.0;
    let mut denom = (exp_shared - 15.0 - 9.0).exp2();
    let maxm = (maxc / denom + 0.5).floor();
    if maxm == 512.0 {
        exp_shared += 1.0;
        denom = (exp_shared - 15.0 - 9.0).exp2();
    }
    let m = c.map(|v| ((v / denom + 0.5).floor() as u32).min(511));
    m[0] | (m[1] << 9) | (m[2] << 18) | ((exp_shared as u32) << 27)
}

/// Fills empty texels next to filled ones with the mean of their filled neighbours, `passes`
/// times. Bilinear filtering and mipmaps then never pull black from the gutter.
pub fn dilate(color: &mut [Vec3], filled: &mut [bool], size: usize, passes: u32) {
    for _ in 0..passes {
        let mut updates = Vec::new();
        for y in 0..size {
            for x in 0..size {
                let i = y * size + x;
                if filled[i] {
                    continue;
                }
                let mut sum = Vec3::ZERO;
                let mut n = 0;
                for dy in -1i32..=1 {
                    for dx in -1i32..=1 {
                        let (qx, qy) = (x as i32 + dx, y as i32 + dy);
                        if qx < 0 || qy < 0 || qx >= size as i32 || qy >= size as i32 {
                            continue;
                        }
                        let j = qy as usize * size + qx as usize;
                        if filled[j] {
                            sum += color[j];
                            n += 1;
                        }
                    }
                }
                if n > 0 {
                    updates.push((i, sum / n as f32));
                }
            }
        }
        for (i, c) in updates {
            color[i] = c;
            filled[i] = true;
        }
    }
}
