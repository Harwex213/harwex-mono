//! Viewers for what a text editor cannot show: images (`image.rs`, also the image diff) and the
//! Markdown preview (`markdown.rs`).
//!
//! Decoding runs on workers only (`decode`). The UI thread turns the decoded pixels into a
//! texture once, on the first frame that draws them.

pub mod image;
pub mod markdown;

use std::path::Path;

/// The longest side of a texture. Bigger images are scaled down on the worker that decodes
/// them, so a 12000 px photo costs a 4096 px texture.
pub const MAX_TEXTURE_SIDE: u32 = 4096;

/// SVGs are rendered at twice their size, but at least this big, so a 16 px icon stays sharp
/// when the viewer scales it up.
const SVG_MIN_SIDE: f32 = 1024.0;

const RASTER: [&str; 7] = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"];

fn ext_of(path: &Path) -> Option<String> {
    path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase())
}

/// A file that opens in the image viewer instead of the text editor.
pub fn is_image(path: &Path) -> bool {
    ext_of(path).is_some_and(|e| e == "svg" || RASTER.contains(&e.as_str()))
}

/// An image format that git stores as binary: its diff shows the two pictures. An SVG is
/// text, so its diff stays a text diff.
pub fn is_raster(path: &Path) -> bool {
    ext_of(path).is_some_and(|e| RASTER.contains(&e.as_str()))
}

/// A decoded image, ready for a texture.
pub struct Decoded {
    /// The pixels, at most `MAX_TEXTURE_SIDE` on the longest side.
    pub pixels: egui::ColorImage,
    /// The image's own size in pixels (an SVG's size in user units).
    pub width: u32,
    pub height: u32,
    /// The file size in bytes.
    pub bytes: u64,
    /// "PNG", "JPEG", "SVG", ...
    pub format: String,
}

/// Decodes an image file's bytes. `svg` picks the SVG renderer; raster formats are recognised
/// by their content, so a misnamed file still decodes. Call it on a worker.
pub fn decode(bytes: &[u8], svg: bool) -> Result<Decoded, String> {
    if svg {
        return decode_svg(bytes);
    }
    let reader = ::image::ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format().map_err(|e| e.to_string())?;
    let format = reader.format().and_then(|f| f.extensions_str().first().copied()).unwrap_or("image");
    let format = match format {
        "jpg" => "JPEG".to_string(),
        f => f.to_ascii_uppercase(),
    };
    let img = reader.decode().map_err(|e| e.to_string())?;
    let (width, height) = (img.width(), img.height());
    let img = if width.max(height) > MAX_TEXTURE_SIDE { img.resize(MAX_TEXTURE_SIDE, MAX_TEXTURE_SIDE, ::image::imageops::FilterType::Triangle) } else { img };
    let rgba = img.to_rgba8();
    let size = [rgba.width() as usize, rgba.height() as usize];
    let pixels = egui::ColorImage::from_rgba_unmultiplied(size, rgba.as_raw());
    Ok(Decoded { pixels, width, height, bytes: bytes.len() as u64, format })
}

fn decode_svg(bytes: &[u8]) -> Result<Decoded, String> {
    let tree = resvg::usvg::Tree::from_data(bytes, &resvg::usvg::Options::default()).map_err(|e| e.to_string())?;
    let size = tree.size();
    let long = size.width().max(size.height()).max(1.0);
    let scale = ((long * 2.0).max(SVG_MIN_SIDE).min(MAX_TEXTURE_SIDE as f32)) / long;
    let w = ((size.width() * scale).ceil() as u32).max(1);
    let h = ((size.height() * scale).ceil() as u32).max(1);
    let mut pixmap = resvg::tiny_skia::Pixmap::new(w, h).ok_or("the SVG has no area")?;
    resvg::render(&tree, resvg::tiny_skia::Transform::from_scale(scale, scale), &mut pixmap.as_mut());
    let pixels = egui::ColorImage::from_rgba_premultiplied([w as usize, h as usize], pixmap.data());
    Ok(Decoded { pixels, width: size.width().round() as u32, height: size.height().round() as u32, bytes: bytes.len() as u64, format: "SVG".into() })
}

/// Reads and decodes an image file. Call it on a worker.
pub fn load(path: &Path) -> Result<Decoded, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    decode(&bytes, ext_of(path).as_deref() == Some("svg"))
}

/// "2.1 KB", like IDEA's image info.
pub fn human_size(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    let b = bytes as f64;
    if b < KB {
        format!("{bytes} B")
    } else if b < KB * KB {
        format!("{:.1} KB", b / KB)
    } else {
        format!("{:.1} MB", b / KB / KB)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_paths_by_extension() {
        assert!(is_image(Path::new("a/B.PNG")));
        assert!(is_image(Path::new("logo.svg")));
        assert!(!is_raster(Path::new("logo.svg")));
        assert!(is_raster(Path::new("x.webp")));
        assert!(!is_image(Path::new("README.md")));
        assert!(!is_image(Path::new("png")));
    }

    #[test]
    fn big_images_are_scaled_down_and_svgs_rendered() {
        let img = ::image::RgbaImage::from_pixel(MAX_TEXTURE_SIDE * 2, 10, ::image::Rgba([255, 0, 0, 255]));
        let mut png = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut png), ::image::ImageFormat::Png).expect("encode");
        let d = decode(&png, false).expect("decode");
        assert_eq!((d.width, d.height), (MAX_TEXTURE_SIDE * 2, 10));
        assert_eq!(d.pixels.size[0], MAX_TEXTURE_SIDE as usize);
        assert_eq!(d.format, "PNG");

        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="8"><rect width="16" height="8" fill="red"/></svg>"#;
        let d = decode(svg, true).expect("svg");
        assert_eq!((d.width, d.height, d.format.as_str()), (16, 8, "SVG"));
        assert_eq!(d.pixels.size, [1024, 512]);
        assert!(decode(b"not an image", false).is_err());
    }

    #[test]
    fn sizes_read_like_idea() {
        assert_eq!(human_size(900), "900 B");
        assert_eq!(human_size(2150), "2.1 KB");
        assert_eq!(human_size(3 * 1024 * 1024), "3.0 MB");
    }
}
