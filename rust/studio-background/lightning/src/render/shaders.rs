// WGSL sources. The shared noise and helpers are prepended to every module.

use crate::scene::calibration::{DOWNLIGHTS, FRAME_LED, PILLARS};

const NOISE: &str = include_str!("../../shaders/noise.wgsl");

fn with_noise(source: &str) -> String {
    format!("{NOISE}\n{source}")
}

pub fn content() -> String {
    with_noise(include_str!("../../shaders/content.wgsl"))
}

pub fn sprite() -> String {
    with_noise(include_str!("../../shaders/sprite.wgsl"))
}

pub fn tile() -> String {
    with_noise(include_str!("../../shaders/tile.wgsl"))
}

pub fn mip() -> String {
    with_noise(include_str!("../../shaders/mip.wgsl"))
}

pub fn composite() -> String {
    with_noise(include_str!("../../shaders/composite.wgsl"))
        .replace("{{PILLAR_COUNT}}", &PILLARS.len().to_string())
        .replace("{{DOWNLIGHT_COUNT}}", &DOWNLIGHTS.len().to_string())
        .replace("{{FRAME_CENTRE_X}}", &format!("{:.1}", FRAME_LED.centre[0]))
        .replace("{{FRAME_CENTRE_Y}}", &format!("{:.1}", FRAME_LED.centre[1]))
        .replace("{{FRAME_HALF_X}}", &format!("{:.1}", FRAME_LED.half_size[0]))
        .replace("{{FRAME_HALF_Y}}", &format!("{:.1}", FRAME_LED.half_size[1]))
        .replace("{{FRAME_INSET}}", &format!("{:.1}", FRAME_LED.hairline_inset))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn validate(name: &str, source: &str) {
        let module = naga::front::wgsl::parse_str(source).unwrap_or_else(|e| panic!("{name}: {}", e.emit_to_string(source)));
        naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
            .validate(&module)
            .unwrap_or_else(|e| panic!("{name}: {e:?}"));
    }

    #[test]
    fn shaders_validate() {
        validate("content", &content());
        validate("sprite", &sprite());
        validate("tile", &tile());
        validate("mip", &mip());
        let composite = composite();
        assert!(!composite.contains("{{"));
        validate("composite", &composite);
    }
}
