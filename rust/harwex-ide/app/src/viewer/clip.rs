//! Copy Image (task 109): the image viewer, each side of the image diff and the Project tree
//! put a picture on the clipboard through `Platform::copy_image`.
//!
//! The file is read, decoded and encoded as PNG on a worker, at its full size (a raster image is
//! never cut to the texture size). A PNG file goes as its own bytes. An SVG goes as a bitmap
//! rendered at the asked scale, plus its source as text. Only a failure shows a toast.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::fileops::ClipImage;
use crate::state::AppState;

/// Encodes an image file's bytes for the clipboard. `svg_scale` is the SVG's bitmap pixels per
/// SVG unit. Call it on a worker.
pub fn encode(bytes: &[u8], svg: bool, svg_scale: f32) -> Result<ClipImage, String> {
    if svg {
        return encode_svg(bytes, svg_scale);
    }
    let reader = || ::image::ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format().map_err(|e| e.to_string());
    if reader()?.format() == Some(::image::ImageFormat::Png) {
        let (width, height) = reader()?.into_dimensions().map_err(|e| e.to_string())?;
        return Ok(ClipImage { png: bytes.to_vec(), width, height, text: None });
    }
    let img = reader()?.decode().map_err(|e| e.to_string())?.to_rgba8();
    png_of(img)
}

fn png_of(img: ::image::RgbaImage) -> Result<ClipImage, String> {
    let (width, height) = img.dimensions();
    let mut png = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut png), ::image::ImageFormat::Png).map_err(|e| e.to_string())?;
    Ok(ClipImage { png, width, height, text: None })
}

fn encode_svg(bytes: &[u8], scale: f32) -> Result<ClipImage, String> {
    let tree = resvg::usvg::Tree::from_data(bytes, &resvg::usvg::Options::default()).map_err(|e| e.to_string())?;
    let size = tree.size();
    let long = size.width().max(size.height()).max(1.0);
    // The same cap as the viewer's texture, so a zoomed-in SVG cannot ask for a huge bitmap.
    let scale = scale.max(0.01).min(super::MAX_TEXTURE_SIDE as f32 / long);
    let w = ((size.width() * scale).round() as u32).max(1);
    let h = ((size.height() * scale).round() as u32).max(1);
    let mut pixmap = resvg::tiny_skia::Pixmap::new(w, h).ok_or("the SVG has no area")?;
    resvg::render(&tree, resvg::tiny_skia::Transform::from_scale(scale, scale), &mut pixmap.as_mut());
    // tiny-skia keeps premultiplied alpha; PNG wants it straight.
    let raw: Vec<u8> = pixmap
        .pixels()
        .iter()
        .flat_map(|p| {
            let c = p.demultiply();
            [c.red(), c.green(), c.blue(), c.alpha()]
        })
        .collect();
    let img = ::image::RgbaImage::from_raw(w, h, raw).ok_or("bad SVG bitmap size")?;
    let mut clip = png_of(img)?;
    clip.text = std::str::from_utf8(bytes).ok().map(str::to_string);
    Ok(clip)
}

fn is_svg(path: &Path) -> bool {
    path.extension().is_some_and(|e| e.eq_ignore_ascii_case("svg"))
}

/// Copies the image file at `path`. `svg_scale` as in [`encode`].
pub fn copy_file(state: &mut AppState, path: PathBuf, svg_scale: f32) {
    let name = crate::fileops::file_name(&path);
    spawn(state, name, move || {
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        encode(&bytes, is_svg(&path), svg_scale)
    });
}

/// Copies a raster image held in memory (a side of the image diff).
pub fn copy_bytes(state: &mut AppState, name: String, bytes: Arc<[u8]>) {
    spawn(state, name, move || encode(&bytes, false, 1.0));
}

fn spawn(state: &mut AppState, name: String, encode: impl FnOnce() -> Result<ClipImage, String> + Send + 'static) {
    let platform = state.platform.clone();
    state.jobs.spawn(
        format!("Copying {name}"),
        move || encode().and_then(|img| platform.copy_image(&img)),
        move |state, res| {
            if let Err(e) = res {
                state.notifications.error("Cannot copy image", format!("{name}: {e}"));
            }
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn png_goes_as_is_and_others_are_encoded_at_full_size() {
        let img = ::image::RgbaImage::from_pixel(super::super::MAX_TEXTURE_SIDE + 10, 3, ::image::Rgba([1, 2, 3, 255]));
        let mut png = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut png), ::image::ImageFormat::Png).expect("png");
        let c = encode(&png, false, 1.0).expect("encode");
        assert_eq!((c.width, c.height, c.png == png), (super::super::MAX_TEXTURE_SIDE + 10, 3, true));

        let mut bmp = Vec::new();
        ::image::RgbaImage::from_pixel(5, 4, ::image::Rgba([9, 8, 7, 255])).write_to(&mut std::io::Cursor::new(&mut bmp), ::image::ImageFormat::Bmp).expect("bmp");
        let c = encode(&bmp, false, 1.0).expect("encode");
        let back = ::image::load_from_memory(&c.png).expect("decode").to_rgba8();
        assert_eq!((back.dimensions(), back.get_pixel(0, 0).0), ((5, 4), [9, 8, 7, 255]));
        assert!(encode(b"nope", false, 1.0).is_err());
    }

    #[test]
    fn svg_renders_at_the_scale_with_straight_alpha_and_its_text() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="8"><rect width="16" height="8" fill="red" fill-opacity="0.5"/></svg>"#;
        let c = encode(svg.as_bytes(), true, 2.5).expect("svg");
        assert_eq!((c.width, c.height, c.text.as_deref()), (40, 20, Some(svg)));
        let back = ::image::load_from_memory(&c.png).expect("decode").to_rgba8();
        let px = back.get_pixel(5, 5).0;
        assert!(px[0] >= 254 && px[1] == 0 && (127..=128).contains(&px[3]), "{px:?}");
        let huge = encode(svg.as_bytes(), true, 1000.0).expect("capped");
        assert_eq!(huge.width, super::super::MAX_TEXTURE_SIDE);
    }

    /// The real pasteboard check of task 109. It overwrites the clipboard, so it runs only with
    /// `HARWEX_TEST_PASTEBOARD=1 cargo test -p harwex-ide --lib viewer::clip::tests::real_pasteboard
    /// -- --ignored --nocapture`; save the clipboard text before (`pbpaste`) and restore it after.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn real_pasteboard() {
        use crate::fileops::{Platform, SystemPlatform};
        if std::env::var_os("HARWEX_TEST_PASTEBOARD").is_none() {
            eprintln!("HARWEX_TEST_PASTEBOARD is not set: the clipboard stays untouched");
            return;
        }
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="8"><rect width="16" height="8" fill="red"/></svg>"#;
        let info = |img: &ClipImage| {
            SystemPlatform.copy_image(img).expect("copy");
            let out = std::process::Command::new("osascript").args(["-e", "clipboard info"]).output().expect("osascript");
            String::from_utf8_lossy(&out.stdout).into_owned()
        };
        let mut png = Vec::new();
        ::image::RgbaImage::from_pixel(7, 5, ::image::Rgba([0, 128, 255, 255])).write_to(&mut std::io::Cursor::new(&mut png), ::image::ImageFormat::Png).expect("png");
        let raster = info(&encode(&png, false, 1.0).expect("encode"));
        eprintln!("raster: {raster}");
        assert!(raster.contains("PNGf") && raster.contains("TIFF"), "{raster}");
        let vector = info(&encode(svg.as_bytes(), true, 2.0).expect("svg"));
        eprintln!("svg: {vector}");
        assert!(vector.contains("PNGf") && vector.contains("TIFF") && vector.contains("string"), "{vector}");
        let text = std::process::Command::new("pbpaste").output().expect("pbpaste");
        assert_eq!(String::from_utf8_lossy(&text.stdout), svg);
        // Read the PNG back from the pasteboard and decode it.
        let script = "set f to (POSIX file (system attribute \"HARWEX_PB_OUT\"))\nset h to open for access f with write permission\nset eof h to 0\nwrite (the clipboard as «class PNGf») to h\nclose access h";
        let out = std::env::temp_dir().join(format!("harwex-ide-pb-{}.png", std::process::id()));
        let st = std::process::Command::new("osascript").args(["-e", script]).env("HARWEX_PB_OUT", &out).status().expect("osascript");
        assert!(st.success());
        let back = ::image::open(&out).expect("pasteboard PNG").to_rgba8();
        let _ = std::fs::remove_file(&out);
        assert_eq!(back.dimensions(), (32, 16));
        assert_eq!(back.get_pixel(3, 3).0, [255, 0, 0, 255]);
    }
}
