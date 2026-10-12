// Light masks derived from the studio plate, so the shader can light the room with the wall.
//   R: the lit gold coves and hot highlights, i.e. the light sources of the plate
//   G: polished gold metal (pillar rings, wall inlays, floor lines, frame); it mirrors light
//   B: the ceiling LED strips alone, the part of R that really emits light
//   A: unused

use crate::scene::calibration::{DOWNLIGHTS, LED_ZONES};
use crate::scene::random::smoothstep;

use crate::art::Rgba;

// `plate` is straight RGBA8 of width x height.
pub fn build_plate_masks(plate: &[u8], width: u32, height: u32) -> Rgba {
    let w = width as f64;
    let h = height as f64;
    let count = (width * height) as usize;
    let mut data = vec![0u8; count * 4];
    let zones = LED_ZONES.map(|[x0, y0, x1, y1]| [x0 * w, y0 * h, x1 * w, y1 * h]);
    // The downlights get their own treatment in the shader; keep them out of the strip mask.
    let lamps = DOWNLIGHTS.map(|[x, y]| [x * w, y * h]);
    let is_led = |x: f64, y: f64| -> bool {
        let in_zone = zones.iter().any(|&[x0, y0, x1, y1]| x >= x0 && x <= x1 && y >= y0 && y <= y1);
        let near_lamp = lamps.iter().any(|&[lx, ly]| (x - lx).hypot(y - ly) < 12.0);
        in_zone && !near_lamp
    };
    for i in 0..count {
        let r = plate[i * 4] as f64;
        let g = plate[i * 4 + 1] as f64;
        let b = plate[i * 4 + 2] as f64;
        let lum = 0.3 * r + 0.59 * g + 0.11 * b;
        let source = smoothstep(170.0, 235.0, lum);
        let gold = smoothstep(15.0, 60.0, r - b) * smoothstep(35.0, 110.0, lum) * (1.0 - source);
        // A Uint8Array store truncates.
        data[i * 4] = (source * 255.0) as u8;
        data[i * 4 + 1] = (gold * 255.0) as u8;
        if source > 0.0 {
            let x = (i % width as usize) as f64;
            let y = (i / width as usize) as f64;
            data[i * 4 + 2] = if is_led(x, y) { (source * 255.0) as u8 } else { 0 };
        }
        data[i * 4 + 3] = 255;
    }
    Rgba { data, width, height }
}
