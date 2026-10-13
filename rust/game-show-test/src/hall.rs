//! Spawns the baked hall: one entity per material mesh of `assets/hall/hall.bin`, all lit by the
//! one lightmap `assets/hall/lightmap.rgb9e5`.
//!
//! The lightmap holds all diffuse light, direct and indirect. Bevy multiplies it by the diffuse
//! color and `lightmap_exposure`.

use std::collections::HashMap;
use std::path::Path;

use bevy::asset::RenderAssetUsages;
use bevy::image::{ImageAddressMode, ImageFilterMode, ImageSampler, ImageSamplerDescriptor};
use bevy::mesh::{Indices, PrimitiveTopology};
use bevy::pbr::Lightmap;
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};

use crate::hall_file::Hall;

pub fn spawn(
    commands: &mut Commands,
    meshes: &mut Assets<Mesh>,
    images: &mut Assets<Image>,
    materials: &HashMap<String, Handle<StandardMaterial>>,
) {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/hall");
    let hall = Hall::read(&dir.join("hall.bin"));
    let lightmap = images.add(load_lightmap(&dir.join("lightmap.rgb9e5"), hall.lightmap_width, hall.lightmap_height));
    let hide = std::env::var("HIDE_MATERIAL").ok();

    for (header, r) in hall.meshes.iter().zip(hall.ranges()) {
        let Some(material) = materials.get(&header.material) else {
            warn!("no material {}", header.material);
            continue;
        };
        let v = r.first_vertex..r.first_vertex + r.vertex_count;
        let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
        mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, hall.positions[v.clone()].to_vec());
        mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, hall.normals[v.clone()].to_vec());
        if std::env::var("NO_NORMAL_MAPS").is_err() {
            mesh.insert_attribute(Mesh::ATTRIBUTE_TANGENT, hall.tangents[v.clone()].to_vec());
        }
        mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, hall.uv0[v.clone()].to_vec());
        mesh.insert_attribute(Mesh::ATTRIBUTE_UV_1, hall.uv1[v].to_vec());
        mesh.insert_indices(Indices::U32(hall.indices[r.first_index..r.first_index + r.index_count].to_vec()));
        let mut entity = commands.spawn((
            Name::new(header.material.clone()),
            Mesh3d(meshes.add(mesh)),
            MeshMaterial3d(material.clone()),
            Lightmap { image: lightmap.clone(), uv_rect: Rect::new(0.0, 0.0, 1.0, 1.0), bicubic_sampling: false },
        ));
        // HIDE_MATERIAL=BLK_Plant hides that material, to find what is slow.
        if hide.as_deref() == Some(header.material.as_str()) {
            entity.insert(Visibility::Hidden);
        }
    }
}

fn load_lightmap(path: &Path, width: u32, height: u32) -> Image {
    let data = std::fs::read(path)
        .unwrap_or_else(|e| panic!("{}: {e}. Run `cargo run --release --bin bake` first.", path.display()));
    assert_eq!(data.len(), (width * height * 4) as usize, "{}", path.display());
    let mut image = Image::new_uninit(
        Extent3d { width, height, depth_or_array_layers: 1 },
        TextureDimension::D2,
        TextureFormat::Rgb9e5Ufloat,
        RenderAssetUsages::RENDER_WORLD,
    );
    image.data = Some(data);
    image.sampler = ImageSampler::Descriptor(ImageSamplerDescriptor {
        address_mode_u: ImageAddressMode::ClampToEdge,
        address_mode_v: ImageAddressMode::ClampToEdge,
        mag_filter: ImageFilterMode::Linear,
        min_filter: ImageFilterMode::Linear,
        ..default()
    });
    image
}
