//! Reflection probes baked by `cargo run --release --bin bake`: one cubemap per probe box of
//! scene/lighting.json, ray-traced from the lightmapped hall. Bevy filters each cubemap into
//! diffuse and specular maps on the GPU (GeneratedEnvironmentMapLight). The lightmap holds the
//! diffuse light, so the probes add reflections only.

use bevy::asset::RenderAssetUsages;
use bevy::light::GeneratedEnvironmentMapLight;
use bevy::prelude::*;
use bevy::render::render_resource::{
    Extent3d, TextureDimension, TextureFormat, TextureViewDescriptor, TextureViewDimension,
};
use serde::Deserialize;

use crate::units::LUMENS_PER_WATT;

/// Bevy filters a GeneratedEnvironmentMapLight again every frame. The hall is static, so
/// the generator goes away once the filtered maps exist (see `freeze`).
const FREEZE_AFTER_FRAMES: u32 = 10;

/// Probe boxes grow by this factor so that neighbours overlap and blend across the seams.
const OVERLAP: f32 = 1.15;

#[derive(Deserialize)]
struct ProbeDef {
    file: String,
    face_size: u32,
    center: [f32; 3],
    size: [f32; 3],
}

pub fn spawn(commands: &mut Commands, images: &mut Assets<Image>) {
    // PROBES=dir loads the cubemaps of another bake, to compare two bakes.
    let dir = std::env::var("PROBES")
        .map_or(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/probes"), std::path::PathBuf::from);
    let Ok(text) = std::fs::read_to_string(dir.join("probes.json")) else {
        warn!("no assets/probes/probes.json: run `cargo run --release --bin bake` for reflections");
        return;
    };
    let defs: Vec<ProbeDef> = serde_json::from_str(&text).expect("probes.json");
    for def in defs {
        let file = std::path::Path::new(&def.file).file_name().expect("probe file name");
        let data = std::fs::read(dir.join(file)).expect("probe cubemap");
        let n = def.face_size;
        let mut image = Image::new_uninit(
            Extent3d { width: n, height: n, depth_or_array_layers: 6 },
            TextureDimension::D2,
            TextureFormat::Rgba16Float,
            RenderAssetUsages::RENDER_WORLD,
        );
        assert_eq!(data.len(), (n * n * 6 * 8) as usize, "{}", def.file);
        image.data = Some(data);
        image.texture_view_descriptor =
            Some(TextureViewDescriptor { dimension: Some(TextureViewDimension::Cube), ..default() });
        commands.spawn((
            LightProbe { falloff: Vec3::splat(0.2) },
            GeneratedEnvironmentMapLight {
                environment_map: images.add(image),
                // The cubemaps hold Blender radiance; one unit is 683 nits.
                intensity: LUMENS_PER_WATT,
                affects_lightmapped_mesh_diffuse: false,
                ..default()
            },
            Transform::from_translation(Vec3::from(def.center))
                .with_scale(Vec3::from(def.size) * OVERLAP),
        ));
    }
}

/// Removes the generators once their filtered diffuse and specular maps exist; the
/// EnvironmentMapLight they produced stays and keeps lighting the hall.
pub fn freeze(
    mut commands: Commands,
    probes: Query<Entity, (With<GeneratedEnvironmentMapLight>, With<EnvironmentMapLight>)>,
    mut frames: Local<u32>,
) {
    if probes.is_empty() {
        return;
    }
    *frames += 1;
    if *frames < FREEZE_AFTER_FRAMES {
        return;
    }
    for entity in &probes {
        commands.entity(entity).remove::<GeneratedEnvironmentMapLight>();
    }
}
