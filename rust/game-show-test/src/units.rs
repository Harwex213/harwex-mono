//! Blender light units to Bevy's photometric units.
//!
//! Blender's glTF exporter treats one watt as 683 lumens and an emission strength of 1 as a
//! radiance of 1 W/m²/sr. Bevy works in lumens and nits, so both scale by 683. The Cycles
//! renders show radiance times 2^exposure; Bevy shows nits / (1.2 * 2^ev100).

pub const LUMENS_PER_WATT: f32 = 683.0;

pub fn lumens(watts: f32) -> f32 {
    watts * LUMENS_PER_WATT
}

pub fn nits(strength: f32) -> f32 {
    strength * LUMENS_PER_WATT
}

/// The Bevy exposure that shows a Cycles render with the given view exposure.
pub fn ev100(blender_exposure: f32) -> f32 {
    (LUMENS_PER_WATT / 1.2).log2() - blender_exposure
}
