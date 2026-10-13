//! The Luxury Casino hall from LuxuryCasino_V6.blend, rendered in real time with Bevy.
//!
//!   game-show-test                      a window: keys 1-8 jump to the presentation cameras,
//!                                       the free camera flies with WASD + right mouse drag
//!   game-show-test --shot out.png [--camera PC_01_Hero] [--size 2560x1440] [--frames 90]
//!                                       one frame without a window, written to a PNG
//!   game-show-test --shot out.png --camera PC_02_AisleEye --path 0,0,-60 --steps 60
//!                                       out_000.png .. out_060.png along a straight move
//!
//! The hall's diffuse light comes from one lightmap, and its reflections from probes. Both
//! are baked by `cargo run --release --bin bake`. Only the lights that show up in reflections
//! stay live, and they add highlights only.

mod hall;
// Shared with the baker, which uses the parts the app does not.
#[allow(dead_code)]
mod hall_file;
mod materials;
mod probes;
#[allow(dead_code)]
mod scene_file;
mod units;

use std::f32::consts::PI;
use std::time::Duration;

use bevy::anti_alias::taa::TemporalAntiAliasing;
use bevy::app::ScheduleRunnerPlugin;
use bevy::asset::RenderAssetUsages;
use bevy::camera::{Exposure, RenderTarget, SubCameraView};
use bevy::camera_controller::free_camera::{FreeCamera, FreeCameraPlugin};
use bevy::core_pipeline::prepass::{DeferredPrepass, DepthPrepass, NormalPrepass};
use bevy::core_pipeline::tonemapping::Tonemapping;
use bevy::light::cluster::GlobalClusterSettings;
use bevy::pbr::{DefaultOpaqueRendererMethod, ScreenSpaceAmbientOcclusion, ScreenSpaceReflections};
use bevy::post_process::bloom::Bloom;
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat, TextureUsages};
use bevy::camera::Hdr;
use bevy::render::view::screenshot::{Screenshot, save_to_disk};
use bevy::window::ExitCondition;
use bevy::winit::WinitPlugin;

use scene_file::{CameraShot, Lighting};
use units::{ev100, lumens};

/// The display threshold for light ranges: below this illuminance (lux) a light no longer
/// changes a pixel at the presentation exposure.
const MIN_LUX: f32 = 4.0;

#[derive(Resource)]
struct Cameras(Vec<CameraShot>);

#[derive(Resource)]
struct Shot {
    path: String,
    camera: String,
    size: UVec2,
    frames: u32,
    target: Option<Handle<Image>>,
    /// Frames counted since the hall finished spawning.
    elapsed: Option<u32>,
    /// `--path dx,dy,dz --steps N`: after `frames`, the camera moves by this world offset
    /// and writes one PNG per step.
    route: Option<CameraPath>,
}

/// A straight camera move for finding light that pops in. The camera advances every frame,
/// as in the window. A PNG is written every `every` frames (`--every`, default 4).
struct CameraPath {
    offset: Vec3,
    steps: u32,
    every: u32,
}

#[derive(Component)]
struct MainCamera;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let arg = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();

    let assets = AssetPlugin { file_path: concat!(env!("CARGO_MANIFEST_DIR"), "/assets").into(), ..default() };
    let mut app = App::new();
    if let Some(path) = arg("--shot") {
        let size = arg("--size").unwrap_or("2560x1440".into());
        let (w, h) = size.split_once('x').expect("--size WxH");
        app.insert_resource(Shot {
            path,
            camera: arg("--camera").unwrap_or("PC_01_Hero".into()),
            size: UVec2::new(w.parse().unwrap(), h.parse().unwrap()),
            frames: arg("--frames").map_or(90, |f| f.parse().unwrap()),
            target: None,
            elapsed: None,
            route: arg("--path").map(|v| {
                let c: Vec<f32> = v.split(',').map(|x| x.parse().expect("--path dx,dy,dz")).collect();
                CameraPath {
                    offset: Vec3::new(c[0], c[1], c[2]),
                    steps: arg("--steps").map_or(50, |n| n.parse().unwrap()),
                    every: arg("--every").map_or(4, |n| n.parse().unwrap()),
                }
            }),
        })
        .add_plugins((
            DefaultPlugins
                .set(assets)
                .set(WindowPlugin { primary_window: None, exit_condition: ExitCondition::DontExit, ..default() })
                .disable::<WinitPlugin>(),
            // No frame pacing: the shot also reports how fast frames render.
            ScheduleRunnerPlugin::run_loop(Duration::ZERO),
        ))
        .add_systems(Update, take_shot);
    } else {
        app.add_plugins((
            DefaultPlugins.set(assets).set(WindowPlugin {
                primary_window: Some(Window {
                    title: "Luxury Casino".into(),
                    resolution: (1600, 900).into(),
                    ..default()
                }),
                ..default()
            }),
            FreeCameraPlugin,
        ))
        .add_systems(Update, switch_camera);
    }
    // GPU_PROFILE=1 logs GPU time per render pass.
    if std::env::var("GPU_PROFILE").is_ok() {
        app.add_plugins((
            bevy::render::diagnostic::RenderDiagnosticsPlugin,
            bevy::diagnostic::LogDiagnosticsPlugin::default(),
        ));
    }
    if std::env::var("FORWARD").is_err() {
        app.insert_resource(DefaultOpaqueRendererMethod::deferred());
    }
    app
        .insert_resource(GlobalAmbientLight::NONE)
        .add_systems(Startup, (setup, grow_cluster_lists))
        .add_systems(Update, probes::freeze)
        .run();
}

fn setup(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut images: ResMut<Assets<Image>>,
    mut standard: ResMut<Assets<StandardMaterial>>,
    shot: Option<ResMut<Shot>>,
) {
    let lighting = scene_file::load_lighting();
    let materials = materials::build(&scene_file::load_materials(), &mut images, &mut standard);
    hall::spawn(&mut commands, &mut meshes, &mut images, &materials);
    spawn_lights(&mut commands, &lighting);
    if std::env::var("NO_PROBES").is_err() {
        probes::spawn(&mut commands, &mut images);
    }

    let w = &lighting.world;
    commands.insert_resource(ClearColor(
        LinearRgba::from_vec3(Vec3::from(w.background) * w.background_strength).into(),
    ));

    let first = shot.as_ref().map_or("PC_01_Hero".to_string(), |s| s.camera.clone());
    let cam = lighting.cameras.iter().find(|c| c.name == first).unwrap_or_else(|| panic!("no camera {first}"));
    let mut camera = commands.spawn((
        Camera3d::default(),
        MainCamera,
        Hdr,
        Msaa::Off,
        Tonemapping::AgX,
        DepthPrepass,
        NormalPrepass,
    ));
    if std::env::var("NO_BLOOM").is_err() {
        camera.insert(Bloom { intensity: 0.07, ..Bloom::NATURAL });
    }
    if std::env::var("NO_TAA").is_err() {
        camera.insert(TemporalAntiAliasing::default());
    }
    if std::env::var("FORWARD").is_err() {
        camera.insert(DeferredPrepass);
    }
    if std::env::var("NO_SSAO").is_err() {
        camera.insert(ScreenSpaceAmbientOcclusion::default());
    }
    if std::env::var("NO_SSR").is_err() && std::env::var("FORWARD").is_err() {
        camera.insert(ScreenSpaceReflections::default());
    }
    camera.insert(shot_view(cam));

    if let Some(mut shot) = shot {
        let size = Extent3d { width: shot.size.x, height: shot.size.y, depth_or_array_layers: 1 };
        let mut image = Image::new_fill(
            size,
            TextureDimension::D2,
            &[0; 4],
            TextureFormat::Rgba8UnormSrgb,
            RenderAssetUsages::default(),
        );
        image.texture_descriptor.usage |=
            TextureUsages::RENDER_ATTACHMENT | TextureUsages::COPY_SRC | TextureUsages::TEXTURE_BINDING;
        let handle = images.add(image);
        camera.insert(RenderTarget::Image(handle.clone().into()));
        shot.target = Some(handle);
    } else {
        camera.insert(FreeCamera::default());
    }

    commands.insert_resource(Cameras(lighting.cameras));
    commands.insert_resource(HallReady);
}

/// Bevy's GPU light clustering starts with a 1024-entry Z-slice list and a 65536-entry index
/// list. A view with more light-cluster pairs overflows them. The overflowing clusters then
/// lose lights until the GPU readback grows the lists, which takes several frames. The lost
/// highlights pop back in all at once, so flying through the hall "adds light". The glossy
/// lights need up to 4096 slices and 262144 indices (PC_08_Gallery at 1080p). The lists here
/// start 4 times larger, at about 4 MB. `SMALL_CLUSTERS=1` keeps Bevy's defaults.
fn grow_cluster_lists(mut settings: ResMut<GlobalClusterSettings>) {
    if std::env::var("SMALL_CLUSTERS").is_ok() {
        return;
    }
    if let Some(gpu) = &mut settings.gpu_clustering {
        gpu.initial_z_slice_list_capacity = gpu.initial_z_slice_list_capacity.max(1 << 14);
        gpu.initial_index_list_capacity = gpu.initial_index_list_capacity.max(1 << 20);
    }
}

/// Camera transform, field of view, lens shift and exposure of a Blender presentation camera.
///
/// Bevy has no lens shift. The view renders a taller frustum and crops the shifted frame out
/// of it with a sub-camera view. Blender measures shift in units of the frame width.
fn shot_view(cam: &CameraShot) -> (Transform, Projection, Exposure, Camera) {
    let [w, h] = cam.resolution.map(|v| v as f32);
    let half_tan_x = cam.sensor_width * 0.5 / cam.lens;
    let shift = cam.shift[1] * w;
    let full_h = h + 2.0 * shift.abs();
    let fov = 2.0 * (half_tan_x * full_h / w).atan();
    let camera = Camera {
        sub_camera_view: Some(SubCameraView {
            full_size: UVec2::new(w as u32, full_h.round() as u32),
            offset: Vec2::new(0.0, shift.abs() - shift),
            size: UVec2::new(w as u32, h as u32),
        }),
        ..default()
    };
    (
        cam.transform(),
        Projection::Perspective(PerspectiveProjection { fov, near: 0.05, ..default() }),
        Exposure { ev100: ev100(cam.exposure) },
        camera,
    )
}

/// The lightmap holds all diffuse light. A live light only adds its highlights, and only the
/// Blender lights visible to glossy rays have any. Their light bounces nowhere, so they need
/// no shadows.
fn spawn_lights(commands: &mut Commands, lighting: &Lighting) {
    // SKIP_LIGHTS=PL_Moon,PL_Vault drops lights by name prefix, to see what lights a spot.
    let skip: Vec<String> = std::env::var("SKIP_LIGHTS")
        .map(|v| v.split(',').map(str::to_owned).collect())
        .unwrap_or_default();
    // ONLY_LIGHTS=PL_Vault keeps just the lights with these prefixes.
    let only: Vec<String> = std::env::var("ONLY_LIGHTS")
        .map(|v| v.split(',').map(str::to_owned).collect())
        .unwrap_or_default();
    let min_lux: f32 = std::env::var("MIN_LUX").map_or(MIN_LUX, |v| v.parse().unwrap());
    for l in &lighting.lights {
        if skip.iter().any(|p| l.name.starts_with(p.as_str()))
            || (!only.is_empty() && !only.iter().any(|p| l.name.starts_with(p.as_str())))
            || l.kind != "point"
            || !l.glossy
        {
            continue;
        }
        let lm = lumens(l.watts);
        commands.spawn((
            Name::new(l.name.clone()),
            PointLight {
                color: LinearRgba::rgb(l.color[0], l.color[1], l.color[2]).into(),
                intensity: lm,
                radius: l.radius,
                range: (lm / (4.0 * PI) / min_lux).sqrt().min(200.0),
                shadow_maps_enabled: false,
                affects_lightmapped_mesh_diffuse: false,
                ..default()
            },
            Transform::from_translation(Vec3::from(l.position)),
        ));
    }
}

#[derive(Resource)]
struct HallReady;

fn switch_camera(
    keys: Res<ButtonInput<KeyCode>>,
    cameras: Res<Cameras>,
    mut camera: Query<(&mut Transform, &mut Projection, &mut Exposure, &mut Camera), With<MainCamera>>,
) {
    const KEYS: [KeyCode; 8] = [
        KeyCode::Digit1,
        KeyCode::Digit2,
        KeyCode::Digit3,
        KeyCode::Digit4,
        KeyCode::Digit5,
        KeyCode::Digit6,
        KeyCode::Digit7,
        KeyCode::Digit8,
    ];
    for (i, key) in KEYS.iter().enumerate() {
        if keys.just_pressed(*key)
            && let Some(cam) = cameras.0.get(i)
            && let Ok((mut t, mut p, mut e, mut c)) = camera.single_mut()
        {
            let (nt, np, ne, nc) = shot_view(cam);
            (*t, *p, *e) = (nt, np, ne);
            c.sub_camera_view = nc.sub_camera_view;
        }
    }
}

fn take_shot(
    mut commands: Commands,
    mut shot: ResMut<Shot>,
    ready: Option<Res<HallReady>>,
    mut exit: MessageWriter<AppExit>,
    mut started: Local<Option<std::time::Instant>>,
    mut camera: Query<&mut Transform, With<MainCamera>>,
    mut start: Local<Option<Vec3>>,
) {
    if ready.is_none() {
        return;
    }
    let elapsed = shot.elapsed.map_or(0, |n| n + 1);
    shot.elapsed = Some(elapsed);
    // Shaders and shadow maps settle during the first frames; time the rest.
    if elapsed == 20 {
        *started = Some(std::time::Instant::now());
    }
    if elapsed == shot.frames
        && let Some(t) = *started
    {
        let ms = t.elapsed().as_secs_f64() * 1000.0 / (shot.frames - 20) as f64;
        info!("{:.1} ms per frame at {}x{}", ms, shot.size.x, shot.size.y);
    }
    let target = shot.target.clone().unwrap();
    let mut last = shot.frames;
    if let Some(path) = &shot.route {
        last += path.steps * path.every;
        if elapsed >= shot.frames && elapsed <= last {
            let Ok(mut t) = camera.single_mut() else { return };
            let origin = *start.get_or_insert(t.translation);
            let along = (elapsed - shot.frames) as f32 / (path.steps * path.every) as f32;
            t.translation = origin + path.offset * along;
            if (elapsed - shot.frames).is_multiple_of(path.every) {
                let step = (elapsed - shot.frames) / path.every;
                let file = shot.path.replace(".png", &format!("_{step:03}.png"));
                info!("step {step} at {}", t.translation);
                commands.spawn(Screenshot::image(target.clone())).observe(save_to_disk(file));
            }
        }
    } else if elapsed == shot.frames {
        commands.spawn(Screenshot::image(target)).observe(save_to_disk(shot.path.clone()));
    }
    // Saving reads the frame back from the GPU and encodes a PNG; give it time before exiting.
    if elapsed == last + 120 {
        info!("wrote {}", shot.path);
        exit.write(AppExit::Success);
    }
}
