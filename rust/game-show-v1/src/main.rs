//! `wheel_stage` in Rust and three-d.
//!
//! Owner: agent F, then G, then L. Nobody else edits this file.
//!
//! Two modes, per the CLI contract in `docs/agent_plan.md`:
//!
//! ```text
//! game-show-v1                                    # interactive viewer, hero view, spinning wheel
//! game-show-v1 --shot renders/x.png               # one deterministic offscreen frame, then exit
//! game-show-v1 --shot renders/x.png --crops DIR   # ... and the six crop regions
//! ```
//!
//! # The frame, in order
//!
//! Both modes drive the same [`World`] and the same [`postfx::PostFx`], so the viewer and
//! `--shot` cannot drift apart:
//!
//! 1. **Animate.** `src/spin.rs` turns the 57 parts under `Wheel_Root` and swings
//!    `Pointer_Flapper`, and `src/screen.rs` gets the frame's time.
//! 2. **Shadow.** `src/lighting.rs` re-renders the key light's shadow map, throttled to 20 Hz,
//!    so the moving wheel's shadow follows it. After the animation, never before.
//! 3. **Scene.** `src/postfx.rs` draws every object with every light of the rig, plus its own
//!    additive beam cones, into an `[f16; 4]` target. One `render` call, so the transparent
//!    materials sort against the opaque ones.
//! 4. **Chain.** Bright pass, two blurs, then the composite: exposure, bloom, vignette, tone
//!    map, sRGB.
//! 5. **Present.** The composite writes straight into the frame buffer, or into the offscreen
//!    texture `--shot` reads back.
//!
//! # Paths
//!
//! Every asset and output path in this crate is written relative to the crate root, and every
//! one of them goes through [`asset_path`]. It resolves, in order: the path as given relative
//! to the working directory, then against `CARGO_MANIFEST_DIR` recorded at compile time, then
//! against the executable's own directory and its parents. So `cargo run` from the crate root,
//! `cargo run` from anywhere in the workspace and `./target/release/game-show-v1` all find
//! `assets/`. No absolute path appears in the source.

mod lighting;
mod manifest;
mod postfx;
mod scene;
mod screen;
mod shot;
mod spin;

use std::path::{Path, PathBuf};
use three_d::*;

/// Error type used across the crate. Everything in three-d, three-d-asset, serde_json and
/// std::io implements `std::error::Error`, so `?` works throughout.
pub type Error = Box<dyn std::error::Error>;
/// Crate result alias.
pub type Result<T> = std::result::Result<T, Error>;

/// Render width, matching `docs/wheel_stage.png` and the Blender render settings.
pub const RENDER_WIDTH: u32 = 1672;
/// Render height, matching `docs/wheel_stage.png` and the Blender render settings.
pub const RENDER_HEIGHT: u32 = 941;

const USAGE: &str = "\
usage: game-show-v1 [--shot <out.png> [--crops <dir>]]

  (no arguments)         interactive viewer: hero view, orbit and zoom, spinning wheel,
                         space to kick it (full control list printed on start-up)
  --shot <out.png>       render one deterministic frame offscreen at 1672x941 and exit
  --crops <dir>          with --shot, also write the six crop regions to <dir>/<name>.png
  -h, --help             this message

Run from the crate root; asset and output paths are relative to it.";

/// Parsed command line.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Args {
    /// `--shot <path>`: render one frame to this PNG and exit.
    pub shot: Option<PathBuf>,
    /// `--crops <dir>`: also write the six crops there. Only valid with `--shot`.
    pub crops: Option<PathBuf>,
    /// `-h` or `--help`.
    pub help: bool,
}

impl Args {
    /// Parses the argument list, excluding argv[0].
    pub fn parse<I: IntoIterator<Item = String>>(args: I) -> Result<Args> {
        let mut out = Args::default();
        let mut it = args.into_iter();
        while let Some(arg) = it.next() {
            match arg.as_str() {
                "--shot" => {
                    let value = it
                        .next()
                        .ok_or_else(|| Error::from("--shot needs a path to a .png"))?;
                    out.shot = Some(PathBuf::from(value));
                }
                "--crops" => {
                    let value = it
                        .next()
                        .ok_or_else(|| Error::from("--crops needs a directory"))?;
                    out.crops = Some(PathBuf::from(value));
                }
                "-h" | "--help" => out.help = true,
                other => return Err(format!("unknown argument {other:?}").into()),
            }
        }
        if out.crops.is_some() && out.shot.is_none() {
            return Err(Error::from("--crops only makes sense together with --shot"));
        }
        Ok(out)
    }
}

fn main() {
    if let Err(e) = run() {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let args = Args::parse(std::env::args().skip(1))?;
    if args.help {
        println!("{USAGE}");
        return Ok(());
    }
    match &args.shot {
        Some(path) => shot::run(path, args.crops.as_deref()),
        None => viewer(),
    }
}

/// Whether `src/screen.rs` draws the LED wall.
///
/// `true`: [`screen::SkyScreen`] replaces every primitive that uses `MAT_LED_Screen` and the
/// imported originals are hidden. It does **not** decide which art is used — that is
/// [`screen::FORCE_PROCEDURAL_SKY`], which agent J owns and leaves `false`, so the wall shows
/// the author's own `T_LEDWall_Sky` out of the GLB. What `screen.rs` adds on that path is the
/// emissive strength of 1.5 that the glTF declares: `three-d-asset` 0.10 never reads
/// `KHR_materials_emissive_strength`, and `PhysicalMaterial::emissive` is four `u8`s and
/// cannot hold a value above 1.0 at all (`docs/api/screen.md`).
///
/// Set to `false` to hand the wall back to the imported `PhysicalMaterial`, which draws the
/// same texture clamped to strength 1.0.
///
/// This constant was called `PROCEDURAL_SKY` while the procedural sky was the primary path.
/// Corrections 2 and 3 in `docs/agent_plan.md` reversed that: the export embeds the author's
/// texture, so the procedural sky became the fallback and the name became a lie.
const SCREEN_DRAWN_BY_SCREEN_RS: bool = true;

/// Everything drawn, in one place, so that the shot mode and the viewer render the same
/// frame from the same state.
pub struct World {
    pub manifest: manifest::Manifest,
    pub stage: scene::Stage,
    pub camera: Camera,
    pub rig: lighting::Rig,
    /// The LED wall, rebuilt by `src/screen.rs` so the emissive strength of 1.5 the glTF
    /// declares survives. One entry per primitive using `MAT_LED_Screen`; the matching parts
    /// in `stage` are hidden. Empty when [`SCREEN_DRAWN_BY_SCREEN_RS`] is `false`.
    pub skies: Vec<screen::SkyScreen>,
    pub wheel: spin::Wheel,
}

impl World {
    /// Loads the manifest and the model, builds the lights and takes the first shadow map.
    pub fn build(context: &Context, viewport: Viewport) -> Result<World> {
        let manifest = manifest::Manifest::load_from_assets()?;
        let camera = scene::hero_camera(&manifest, viewport);
        let mut stage = scene::Stage::load(context, &manifest)?;

        // Hand the LED wall to `src/screen.rs` and hide the imported part, which would
        // otherwise draw over it.
        //
        // Which parts: the author puts `MAT_LED_Screen` on `Wall_Screen` and on slot 0 of
        // `Podium_Riser`, so the *author's texture* belongs on both — that is what Blender
        // does. The *procedural* sky belongs on the cyclorama alone; painting the riser front
        // with drifting clouds and stars is wrong. So the filter follows the art choice
        // (`docs/api/screen.md`).
        //
        // Both values come off the manifest, which `docs/agent_plan.md` makes the single source
        // of truth: the flat base colour of `MAT_LED_Screen`, and the name of the node the
        // procedural sky is allowed on. No literal copy of either lives here, so neither can
        // drift away from `assets/scene.json`.
        let screen_material = manifest.screen.material.as_str();
        let base = manifest
            .material(screen_material)
            .ok_or_else(|| {
                Error::from(format!(
                    "assets/scene.json has no material {screen_material:?}"
                ))
            })?
            .base_color;
        let sky_node = manifest.screen.node.as_str();
        let mut skies = Vec::new();
        if SCREEN_DRAWN_BY_SCREEN_RS {
            for i in stage.indices_with_material(screen_material) {
                if screen::FORCE_PROCEDURAL_SKY && stage.parts[i].name != sky_node {
                    continue;
                }
                skies.push(screen::SkyScreen::new(
                    context,
                    &stage.parts[i],
                    base,
                    manifest.screen.emission_strength,
                )?);
                stage.parts[i].visible = false;
            }
        }

        let wheel = spin::Wheel::new(&stage, &manifest);
        let mut rig = lighting::Rig::build(context, &manifest)?;
        {
            let mut casters = stage.objects();
            casters.extend(skies.iter().map(|s| s.object()));
            rig.generate_shadow_maps(&casters)?;
        }

        Ok(World {
            manifest,
            stage,
            camera,
            rig,
            skies,
            wheel,
        })
    }

    /// Advances every animated part to time `seconds`, on the constant-rate drive.
    ///
    /// Pure in `seconds`: `update(0.0)` is the deterministic frame `--shot` writes. It does
    /// not touch the shadow map, so it stays free of `Result`; call [`World::refresh_shadows`]
    /// afterwards in a loop that wants the wheel's shadow to move.
    ///
    /// Do not mix with [`World::advance`] in one frame. This one re-derives the angle from
    /// absolute time and would undo a kick (`docs/api/spin.md`).
    pub fn update(&mut self, seconds: f32) {
        self.wheel.update(&mut self.stage, seconds);
        for sky in &mut self.skies {
            sky.set_time(seconds);
        }
    }

    /// Advances the wheel by `dt` seconds on the free-running drive, so it coasts down under
    /// friction after a [`spin::Wheel::kick`]. `seconds` stays absolute, for the sky shader.
    pub fn advance(&mut self, dt: f32, seconds: f32) -> Result<()> {
        self.wheel.advance(dt);
        self.wheel.apply(&mut self.stage);
        for sky in &mut self.skies {
            sky.set_time(seconds);
        }
        self.refresh_shadows(seconds)
    }

    /// Re-renders the key light's shadow map so the spinning wheel's shadow follows it.
    ///
    /// Call after the wheel has been moved, or the shadow lags the frame by one. `Rig::update`
    /// throttles itself to `lighting::SHADOW_REFRESH_INTERVAL`, and always refreshes at
    /// `seconds == 0.0` and whenever `seconds` moves backwards, so the deterministic shot gets
    /// the shadow for rotation zero.
    pub fn refresh_shadows(&mut self, seconds: f32) -> Result<()> {
        let World {
            stage, skies, rig, ..
        } = self;
        let mut casters = stage.objects();
        casters.extend(skies.iter().map(|s| s.object()));
        rig.update(seconds, &casters)?;
        Ok(())
    }

    /// The three arguments a render pass needs, borrowed from disjoint fields so the
    /// camera can still be mutated for tone mapping while the objects are borrowed.
    ///
    /// All objects come back in one `Vec` on purpose. They must go into a single `render`
    /// call, or `cmp_render_order` will not sort the transparent ones against the rest.
    pub fn frame(&mut self) -> (Vec<&dyn Object>, Vec<&dyn Light>, &mut Camera) {
        let World {
            stage,
            skies,
            rig,
            camera,
            ..
        } = self;
        let mut objects = stage.objects();
        objects.extend(skies.iter().map(|s| s.object()));
        (objects, rig.lights(), camera)
    }
}

/// What the viewer window responds to. Printed on start-up, because a window has nowhere
/// to put it.
const CONTROLS: &str = "\
controls
  drag              orbit the camera around the wheel
  scroll or pinch   zoom, 1 m to 60 m from the target
  space             kick the wheel: it spins up and coasts down under friction
  R or Home         back to the hero view, Cam_Hero from the manifest
  Esc               quit";

/// Closest and farthest the orbit control may pull the camera, in metres. The hero view sits
/// at 7.99 m, the stage is about 24 m across, so this brackets it generously.
const ORBIT_DISTANCE: (f32, f32) = (1.0, 60.0);

/// The interactive viewer: hero view by default, orbit and zoom, wheel spinning.
fn viewer() -> Result<()> {
    let window = Window::new(WindowSettings {
        title: "wheel_stage".to_string(),
        max_size: Some((RENDER_WIDTH, RENDER_HEIGHT)),
        ..Default::default()
    })?;
    let context = window.gl();
    let viewport = window.viewport();

    let mut world = World::build(&context, viewport)?;
    // `new_with_stage`, not `new`: the twelve `MH_nn_Lens` transforms the beam cones are built
    // from come off the Stage that `World::build` just loaded, instead of parsing the 10 MiB
    // GLB a second time.
    let mut effects = postfx::PostFx::new_with_stage(
        &context,
        &world.manifest,
        &world.stage,
        viewport.width,
        viewport.height,
    )?;
    let mut control = OrbitControl::new(world.camera.target(), ORBIT_DISTANCE.0, ORBIT_DISTANCE.1);
    println!("{CONTROLS}");

    // Which of the wheel's two drives is running. It starts on the constant-rate one, so the
    // viewer opens with the wheel turning at the manifest's idle rate, as the CLI contract in
    // `docs/agent_plan.md` says. Space switches to the free-running drive for good: that drive
    // integrates a velocity, so it is the only one a kick survives, and mixing the two in one
    // frame would let absolute time overwrite the kick (`docs/api/spin.md`).
    let mut free_running = false;

    window.render_loop(move |mut frame_input| {
        if world.camera.set_viewport(frame_input.viewport) {
            // `set_viewport` keeps the vertical field of view. Blender's sensor fit is
            // HORIZONTAL, so re-derive the projection to hold the horizontal framing instead.
            scene::fit_projection(&mut world.camera, &world.manifest);
        }

        let mut exit = false;
        for event in &mut frame_input.events {
            match event {
                Event::KeyPress {
                    kind: Key::R | Key::Home,
                    handled,
                    ..
                } if !*handled => {
                    scene::reset_to_hero(&mut world.camera, &world.manifest);
                    control.target = world.camera.target();
                    *handled = true;
                }
                Event::KeyPress {
                    kind: Key::Space,
                    handled,
                    ..
                } if !*handled => {
                    world.wheel.kick();
                    free_running = true;
                    *handled = true;
                }
                Event::KeyPress {
                    kind: Key::Escape,
                    handled,
                    ..
                } if !*handled => {
                    exit = true;
                    *handled = true;
                }
                _ => {}
            }
        }
        control.handle_events(&mut world.camera, &mut frame_input.events);
        if exit {
            return FrameOutput {
                exit: true,
                ..Default::default()
            };
        }

        if effects.size() != (frame_input.viewport.width, frame_input.viewport.height) {
            effects.resize(
                &context,
                frame_input.viewport.width,
                frame_input.viewport.height,
            );
        }

        // Frame times in three-d are f64 MILLISECONDS.
        let seconds = (frame_input.accumulated_time * 0.001) as f32;
        let dt = (frame_input.elapsed_time * 0.001) as f32;

        // Animate, then refresh the key light's shadow map, then draw. The shadow has to be
        // taken after the wheel has moved or it lags the frame it belongs to.
        let stepped = if free_running {
            world.advance(dt, seconds)
        } else {
            world.update(seconds);
            world.refresh_shadows(seconds)
        };

        // The scene with its lights and its beam cones into the HDR target, then the bloom,
        // vignette and tone-map chain, then the frame buffer. One call: `PostFx::render` owns
        // all three stages, and every object goes into its single `render` so the transparent
        // ones sort against the rest.
        let frame = frame_input.screen();
        let drawn = stepped.and_then(|()| {
            let (objects, lights, camera) = world.frame();
            effects.render(&context, &frame, camera, &objects, &lights)
        });
        if let Err(e) = drawn {
            eprintln!("error: {e}");
            return FrameOutput {
                exit: true,
                ..Default::default()
            };
        }
        FrameOutput::default()
    });
    Ok(())
}

/// Resolves a crate-relative asset or output path.
///
/// Tried in order: as given relative to the working directory, then against the crate root
/// recorded at compile time, then against the executable's own directory and its parents so
/// that a binary copied out of `target/` still finds `assets/`. Falls back to the path as
/// given, which lets the caller report a useful "not found" naming what it looked for.
pub fn asset_path(relative: impl AsRef<Path>) -> PathBuf {
    let relative = relative.as_ref();
    if relative.is_absolute() {
        return relative.to_path_buf();
    }
    if relative.exists() {
        return relative.to_path_buf();
    }
    let from_crate = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative);
    if from_crate.exists() {
        return from_crate;
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent();
        while let Some(d) = dir {
            let candidate = d.join(relative);
            if candidate.exists() {
                return candidate;
            }
            dir = d.parent();
        }
    }
    relative.to_path_buf()
}

/// Makes sure the directory a file is about to be written into exists.
pub fn ensure_parent_dir(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    Ok(())
}
