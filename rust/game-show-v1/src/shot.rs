//! Deterministic offscreen render and crop writing.
//!
//! Owner: agent F.
//!
//! ## Why there is a hidden window
//!
//! `three-d` 0.19.0 has no headless context. 0.18.2 had `HeadlessContext` behind a
//! `headless` feature; both the type and the feature are gone. Rolling our own with glutin
//! does not help on macOS either: glutin's CGL backend returns
//! `NotSupported("pbuffers are not supported with CGL")` from `create_pbuffer_surface`, and
//! `make_current_surfaceless` exists only in the EGL backend. A CGL context cannot be made
//! current without a window surface.
//!
//! So `--shot` creates a `winit` window with `.with_visible(false)` purely to own the GL
//! context. Nothing appears on screen, which satisfies the CLI contract: `--shot` must not
//! require a *visible* window. Two consequences to know about:
//!
//! - [`HiddenContext`] must keep the `WindowedContext`, the `Window` and the `EventLoop`
//!   alive for as long as any GL call happens. `three_d::Context` holds only an
//!   `Arc<glow::Context>` — a table of function pointers — and does not own the GL context.
//!   Drop the `WindowedContext` and every later GL call runs against dangling state.
//! - macOS requires the event loop and the window to be created on the **main thread**, so
//!   [`run`] must be called from `main` and never from a worker thread.
//!
//! The event loop is never run. No frames, no events, no window ever shown.
//!
//! ## Determinism
//!
//! The frame depends on nothing but the manifest and the model: the camera is `Cam_Hero`
//! from the manifest, `World::update(0.0)` puts the wheel at rotation 0 and the sky at time
//! 0, and no wall-clock value is read anywhere in this file.
//!
//! ## Where the crop rectangles come from
//!
//! `assets/scene.json`: the `crops` field of [`Manifest`], an array of
//! [`CropRect`]. This file holds no copy of them. It used to hold a
//! `CROPS` table of six literals beside the manifest's own `crops` array, which is two
//! sources for one set of numbers and so a defect even while the two agreed.

use crate::manifest::{CropRect, Manifest};
use crate::{World, RENDER_HEIGHT, RENDER_WIDTH};
use std::path::Path;
use three_d::*;
use three_d_asset::io::Serialize;

/// Owns everything an offscreen render needs. Drop it only when the render is finished.
pub struct HiddenContext {
    /// The graphics context. Cheap to clone, but useless once the fields below are dropped.
    pub context: Context,
    /// Owns the `PossiblyCurrentContext` and the window surface. Never read again, and
    /// that is the point: dropping it destroys the GL context.
    #[allow(dead_code)]
    gl: WindowedContext,
    /// The surface wraps this window's view, so the window must outlive the surface.
    #[allow(dead_code)]
    window: winit::window::Window,
    /// On macOS the event loop must outlive the window. Never run.
    #[allow(dead_code)]
    event_loop: winit::event_loop::EventLoop<()>,
}

impl HiddenContext {
    /// Creates an OpenGL context with no window visible on screen.
    /// Must be called on the main thread on macOS.
    pub fn new() -> crate::Result<Self> {
        let event_loop = winit::event_loop::EventLoop::new();
        let window = winit::window::WindowBuilder::new()
            .with_title("wheel_stage (offscreen)")
            .with_visible(false)
            .with_inner_size(winit::dpi::LogicalSize::new(32.0, 32.0))
            .build(&event_loop)?;
        let gl = WindowedContext::from_winit_window(&window, SurfaceSettings::default())?;
        let context = (*gl).clone();
        Ok(HiddenContext {
            context,
            gl,
            window,
            event_loop,
        })
    }
}

/// Renders one deterministic frame to `path`, and the six crops to `crops` if given.
pub fn run(path: &Path, crops: Option<&Path>) -> crate::Result<()> {
    // Held for the whole function: dropping it destroys the GL context.
    let hidden = HiddenContext::new()?;
    let context = hidden.context.clone();

    let viewport = Viewport::new_at_origo(RENDER_WIDTH, RENDER_HEIGHT);
    let mut world = World::build(&context, viewport)?;
    // Fixed time, so the wheel is at rotation 0 and the sky shader is at phase 0.
    world.update(0.0);
    let mut effects =
        crate::postfx::PostFx::new(&context, &world.manifest, RENDER_WIDTH, RENDER_HEIGHT)?;

    let image = render_offscreen(
        &context,
        &mut world,
        &mut effects,
        RENDER_WIDTH,
        RENDER_HEIGHT,
    )?;
    save_png(&image, path)?;
    println!("wrote {} ({}x{})", path.display(), image.width, image.height);

    if let Some(dir) = crops {
        for written in write_crops(&image, dir, &world.manifest)? {
            println!("wrote {}", written.display());
        }
    }
    Ok(())
}

/// Renders one frame at an explicit resolution and reads it back as a CPU image.
///
/// The camera viewport is forced to the texture size: `RenderTarget::render` uses
/// `viewer.viewport()`, so a mismatch would cover only part of the texture.
pub fn render_offscreen(
    context: &Context,
    world: &mut World,
    effects: &mut crate::postfx::PostFx,
    width: u32,
    height: u32,
) -> crate::Result<CpuTexture> {
    let color = Texture2D::new_empty::<[u8; 4]>(
        context,
        width,
        height,
        Interpolation::Linear,
        Interpolation::Linear,
        None,
        Wrapping::ClampToEdge,
        Wrapping::ClampToEdge,
    );
    let depth =
        DepthTexture2D::new::<f32>(context, width, height, Wrapping::ClampToEdge, Wrapping::ClampToEdge);
    let target = RenderTarget::new(color.as_color_target(None), depth.as_depth_target());

    world.camera.set_viewport(Viewport::new_at_origo(width, height));
    let (objects, lights, camera) = world.frame();
    effects.render(context, &target, camera, &objects, &lights)?;

    // `read_color` already flips y, and the PNG writer emits rows top-down, so the image
    // comes out the right way up. Do not flip it again.
    let pixels = target.read_color::<[u8; 4]>();
    Ok(CpuTexture {
        data: TextureData::RgbaU8(pixels),
        width,
        height,
        ..Default::default()
    })
}

/// Writes a PNG. Needs three-d-asset's `png` feature, which `Cargo.toml` enables.
pub fn save_png(image: &CpuTexture, path: &Path) -> crate::Result<()> {
    crate::ensure_parent_dir(path)?;
    let name = path
        .to_str()
        .ok_or_else(|| crate::Error::from(format!("path {path:?} is not valid UTF-8")))?;
    three_d_asset::io::save(&image.serialize(name)?)?;
    Ok(())
}

/// Writes every crop region the manifest declares into `dir` as `<name>.png`. Returns the
/// paths written.
///
/// The rectangles are the manifest's, in the manifest's order. An empty `crops` array writes
/// nothing and is not an error, but it is also not a thing `assets/scene.json` may hold: a
/// test in `src/manifest.rs` asserts the six named regions are there.
pub fn write_crops(
    image: &CpuTexture,
    dir: &Path,
    manifest: &Manifest,
) -> crate::Result<Vec<std::path::PathBuf>> {
    std::fs::create_dir_all(dir)?;
    let mut written = Vec::with_capacity(manifest.crops.len());
    for region in &manifest.crops {
        let cropped = crop(image, region)?;
        let path = dir.join(format!("{}.png", region.name));
        save_png(&cropped, &path)?;
        written.push(path);
    }
    Ok(written)
}

/// Cuts one region out of an RGBA8 CPU image. `region.y` counts from the top.
pub fn crop(image: &CpuTexture, region: &CropRect) -> crate::Result<CpuTexture> {
    let pixels = match &image.data {
        TextureData::RgbaU8(p) => p,
        _ => return Err(crate::Error::from("crop needs an RGBA8 image")),
    };
    if region.x + region.w > image.width || region.y + region.h > image.height {
        return Err(format!(
            "crop {} at {},{} {}x{} does not fit in {}x{}",
            region.name, region.x, region.y, region.w, region.h, image.width, image.height
        )
        .into());
    }
    let mut out = Vec::with_capacity((region.w * region.h) as usize);
    for row in 0..region.h {
        let start = ((region.y + row) * image.width + region.x) as usize;
        out.extend_from_slice(&pixels[start..start + region.w as usize]);
    }
    Ok(CpuTexture {
        data: TextureData::RgbaU8(out),
        width: region.w,
        height: region.h,
        ..Default::default()
    })
}
