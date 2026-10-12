//! CPU-drawn images the renderer uploads once: the numeral atlas, the bolt sprite atlas and the
//! light masks of the studio plate. In the web version these were 2D-canvas drawings.

pub mod bolt_atlas;
pub mod glyph_atlas;
pub mod plate_masks;

// Straight (not premultiplied) RGBA8, rows top to bottom.
pub struct Rgba {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
}
