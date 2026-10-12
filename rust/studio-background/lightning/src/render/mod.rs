//! wgpu renderer of the Lightning Roulette studio: the video wall (clouds, roulette tiles, bolt
//! sprites) renders into a mip-mapped target, then a full-screen pass composites it into the
//! studio plate with the room lighting.

mod gpu;
mod renderer;
mod shaders;

pub use renderer::StudioRenderer;
