//! Builds `assets/hall/hall.bin` from the Blender export `assets/casino.glb`.
//!
//! 1. Every glTF primitive of every node moves into world space. A mirrored node gets its
//!    triangle winding flipped and its tangent sign negated, so the merged mesh needs no
//!    negative scale.
//! 2. xatlas cuts the triangles into charts and packs the charts into square pages. Every
//!    object instance gets its own charts, so no two surfaces share lightmap texels. The texel
//!    density starts at `Options::density`. It drops in steps of 7 % until the charts fit into
//!    `Options::max_pages` pages.
//! 3. The pages sit side by side in one lightmap texture. One texture for the whole hall
//!    matters: Bevy 0.20's deferred prepass batches meshes without looking at their lightmap
//!    image, so meshes with different lightmaps read each other's texels.
//! 4. All primitives of one material merge into one mesh. The hall then takes one draw per
//!    material and pass. 4500 small draws cost Metal about 25 ms.

use std::collections::BTreeMap;
use std::path::Path;
use std::time::Instant;

use bevy::asset::RenderAssetUsages;
use bevy::math::{Mat3, Mat4, Vec3, Vec4};
use bevy::mesh::{Indices, Mesh, PrimitiveTopology, VertexAttributeValues};
use xatlas_rs_v2::{ChartOptions, IndexData, MeshData, MeshDecl, PackOptions, Xatlas};

use crate::hall_file::{Hall, MeshHeader};

pub struct Options {
    /// The highest lightmap density, in texels per metre.
    pub density: f32,
    pub page_size: u32,
    pub max_pages: u32,
    /// Empty texels around every chart, on top of xatlas' ring for bilinear filtering. The
    /// baker dilates the lightmap into them.
    pub padding: u32,
}

/// One glTF primitive of one node, in world space.
struct Part {
    material: String,
    positions: Vec<[f32; 3]>,
    normals: Vec<[f32; 3]>,
    tangents: Vec<[f32; 4]>,
    uv0: Vec<[f32; 2]>,
    indices: Vec<u32>,
}

pub fn build(glb: &Path, options: &Options) -> Hall {
    let t = Instant::now();
    let parts = load_parts(glb);
    let triangles: usize = parts.iter().map(|p| p.indices.len() / 3).sum();
    println!("hall: {} primitives, {} triangles from {} ({:.1} s)", parts.len(), triangles, glb.display(), t.elapsed().as_secs_f32());

    let t = Instant::now();
    let decls: Vec<MeshDecl> = parts
        .iter()
        .map(|p| MeshDecl {
            vertex_position_data: MeshData::Contiguous(bytemuck::cast_slice(&p.positions)),
            vertex_normal_data: Some(MeshData::Contiguous(bytemuck::cast_slice(&p.normals))),
            index_data: Some(IndexData::U32(&p.indices)),
            face_count: (p.indices.len() / 3) as u32,
            ..Default::default()
        })
        .collect();
    let mut atlas = Xatlas::new();
    for (d, p) in decls.iter().zip(&parts) {
        atlas.add_mesh(d).unwrap_or_else(|e| panic!("xatlas rejects a {} mesh: {e:?}", p.material));
    }
    atlas.compute_charts(&ChartOptions::default());
    println!("hall: charts in {:.1} s", t.elapsed().as_secs_f32());
    let t = Instant::now();
    let mut density = options.density;
    loop {
        atlas.pack_charts(&PackOptions {
            resolution: options.page_size,
            texels_per_unit: density,
            padding: options.padding,
            bilinear: true,
            block_align: true,
            ..Default::default()
        });
        if atlas.atlas_count() <= options.max_pages {
            break;
        }
        println!("hall: {} pages at {density:.2} texels/m", atlas.atlas_count());
        density *= 0.93;
    }
    let pages = atlas.atlas_count();
    let used: Vec<String> = atlas.utilization().unwrap_or_default().iter().map(|u| format!("{:.0} %", u * 100.0)).collect();
    println!(
        "hall: {} charts in {pages} pages of {}² at {density:.2} texels/m, utilization {} ({:.1} s)",
        atlas.chart_count(),
        options.page_size,
        used.join(", "),
        t.elapsed().as_secs_f32()
    );

    let page = options.page_size as f32;
    let (width, height) = (pages as f32 * page, page);

    // Merge per material, in name order.
    let mut merged: BTreeMap<&str, Hall> = BTreeMap::new();
    for (part, out) in parts.iter().zip(atlas.meshes()) {
        let m = merged.entry(part.material.as_str()).or_default();
        let base = m.positions.len() as u32;
        for v in &out.vertex_array {
            let i = v.xref as usize;
            m.positions.push(part.positions[i]);
            m.normals.push(part.normals[i]);
            m.tangents.push(part.tangents[i]);
            m.uv0.push(part.uv0[i]);
            // A vertex of a degenerate face lies in no chart; it keeps the corner texel.
            let ox = v.atlas_index.max(0) as f32 * page;
            m.uv1.push([(ox + v.uv[0]) / width, v.uv[1] / height]);
        }
        m.indices.extend(out.index_array.iter().map(|&i| base + i));
    }
    let mut hall = Hall {
        lightmap_width: width as u32,
        lightmap_height: height as u32,
        page_size: options.page_size,
        ..Default::default()
    };
    for (material, m) in merged {
        hall.meshes.push(MeshHeader {
            material: material.to_string(),
            vertex_count: m.positions.len() as u32,
            index_count: m.indices.len() as u32,
        });
        hall.positions.extend(m.positions);
        hall.normals.extend(m.normals);
        hall.tangents.extend(m.tangents);
        hall.uv0.extend(m.uv0);
        hall.uv1.extend(m.uv1);
        hall.indices.extend(m.indices);
    }
    println!(
        "hall: {} meshes, {} vertices, lightmap {}x{}",
        hall.meshes.len(),
        hall.positions.len(),
        hall.lightmap_width,
        hall.lightmap_height
    );
    hall
}

fn load_parts(path: &Path) -> Vec<Part> {
    let bytes = std::fs::read(path).unwrap_or_else(|e| panic!("{}: {e}. Run tools/export_blend.py first.", path.display()));
    let gltf = gltf::Gltf::from_slice(&bytes).expect("casino.glb");
    let blob = gltf.blob.as_deref().expect("GLB without a binary chunk");
    let scene = gltf.document.default_scene().or_else(|| gltf.document.scenes().next()).expect("a glTF scene");
    let mut parts = Vec::new();
    for node in scene.nodes() {
        visit(&node, Mat4::IDENTITY, blob, &mut parts);
    }
    parts
}

fn visit(node: &gltf::Node, parent: Mat4, blob: &[u8], parts: &mut Vec<Part>) {
    let m = parent * Mat4::from_cols_array_2d(&node.transform().matrix());
    if let Some(mesh) = node.mesh() {
        for prim in mesh.primitives() {
            parts.push(part(&prim, m, blob));
        }
    }
    for child in node.children() {
        visit(&child, m, blob, parts);
    }
}

fn part(prim: &gltf::Primitive, m: Mat4, blob: &[u8]) -> Part {
    let reader = prim.reader(|b| (b.index() == 0).then_some(blob));
    let material = prim.material().name().expect("a primitive without a material").to_string();
    let m3 = Mat3::from_mat4(m);
    let nm = m3.inverse().transpose();
    let mirrored = m3.determinant() < 0.0;

    let positions: Vec<[f32; 3]> =
        reader.read_positions().expect("POSITION").map(|p| m.transform_point3(Vec3::from(p)).to_array()).collect();
    let normals: Vec<[f32; 3]> =
        reader.read_normals().expect("NORMAL").map(|n| (nm * Vec3::from(n)).normalize_or_zero().to_array()).collect();
    let count = positions.len();
    let uv0: Option<Vec<[f32; 2]>> = reader.read_tex_coords(0).map(|uv| uv.into_f32().collect());
    let mut indices: Vec<u32> = match reader.read_indices() {
        Some(i) => i.into_u32().collect(),
        None => (0..count as u32).collect(),
    };
    if mirrored {
        for tri in indices.chunks_exact_mut(3) {
            tri.swap(1, 2);
        }
    }
    let sign = if mirrored { -1.0 } else { 1.0 };
    let tangents: Vec<[f32; 4]> = match (reader.read_tangents(), &uv0) {
        (Some(t), _) => t
            .map(|t| {
                let v = (m3 * Vec3::new(t[0], t[1], t[2])).normalize_or_zero();
                [v.x, v.y, v.z, t[3] * sign]
            })
            .collect(),
        // Blender cannot compute tangents for some n-gon meshes. Bevy's MikkTSpace fills them in.
        (None, Some(uv)) => generate_tangents(&positions, &normals, uv, &indices),
        (None, None) => vec![[1.0, 0.0, 0.0, 1.0]; count],
    };
    Part {
        material,
        uv0: uv0.unwrap_or_else(|| vec![[0.0, 0.0]; count]),
        positions,
        normals,
        tangents,
        indices,
    }
}

fn generate_tangents(positions: &[[f32; 3]], normals: &[[f32; 3]], uv: &[[f32; 2]], indices: &[u32]) -> Vec<[f32; 4]> {
    let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions.to_vec());
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals.to_vec());
    mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, uv.to_vec());
    mesh.insert_indices(Indices::U32(indices.to_vec()));
    let fallback = || vec![[1.0, 0.0, 0.0, 1.0]; positions.len()];
    if mesh.generate_tangents().is_err() {
        return fallback();
    }
    match mesh.attribute(Mesh::ATTRIBUTE_TANGENT) {
        Some(VertexAttributeValues::Float32x4(t)) => t
            .iter()
            .map(|t| {
                // MikkTSpace leaves NaN on degenerate triangles.
                if Vec4::from(*t).is_finite() { *t } else { [1.0, 0.0, 0.0, 1.0] }
            })
            .collect(),
        _ => fallback(),
    }
}
