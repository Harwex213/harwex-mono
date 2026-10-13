//! `assets/hall/hall.bin`: the static hall, merged by the baker into one mesh per material.
//!
//! The baker (`cargo run --release --bin bake`) writes it from `assets/casino.glb`. The app draws
//! it, and the lightmap and probe bakes trace it. All vertices are in world space (Bevy's Y-up),
//! so the meshes need no transform.
//!
//! Layout, little-endian:
//! - the 4 bytes `HALL`, then a u32 with the byte length of the JSON header;
//! - the JSON header (`Header`), padded with spaces to a multiple of 4 bytes;
//! - the vertex arrays of all meshes, one array after the other: positions, normals, tangents,
//!   material UVs, lightmap UVs;
//! - the indices of all meshes. They count from the first vertex of their mesh.

use std::path::Path;

use serde::{Deserialize, Serialize};

const MAGIC: &[u8; 4] = b"HALL";

#[derive(Serialize, Deserialize, Clone)]
pub struct Header {
    /// Size of `lightmap.rgb9e5` in texels. Every lightmap UV points into this one texture.
    pub lightmap_width: u32,
    pub lightmap_height: u32,
    /// The lightmap is laid out in square pages of this size. No UV chart crosses a page edge,
    /// so the baker can bake one page at a time.
    pub page_size: u32,
    pub meshes: Vec<MeshHeader>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MeshHeader {
    /// The material name, a key in `assets/materials.json`.
    pub material: String,
    pub vertex_count: u32,
    pub index_count: u32,
}

#[derive(Default)]
pub struct Hall {
    pub meshes: Vec<MeshHeader>,
    pub lightmap_width: u32,
    pub lightmap_height: u32,
    pub page_size: u32,
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    /// glTF tangents: xyz along material U, w the sign of the bitangent.
    pub tangents: Vec<[f32; 4]>,
    pub uv0: Vec<[f32; 2]>,
    /// Lightmap UVs, v running down the lightmap.
    pub uv1: Vec<[f32; 2]>,
    pub indices: Vec<u32>,
}

/// Where one mesh lives in the shared arrays.
#[derive(Clone, Copy)]
pub struct Range {
    pub first_vertex: usize,
    pub vertex_count: usize,
    pub first_index: usize,
    pub index_count: usize,
}

impl Hall {
    pub fn ranges(&self) -> Vec<Range> {
        let (mut v, mut i) = (0, 0);
        self.meshes
            .iter()
            .map(|m| {
                let r = Range {
                    first_vertex: v,
                    vertex_count: m.vertex_count as usize,
                    first_index: i,
                    index_count: m.index_count as usize,
                };
                v += r.vertex_count;
                i += r.index_count;
                r
            })
            .collect()
    }

    pub fn write(&self, path: &Path) {
        let header = Header {
            lightmap_width: self.lightmap_width,
            lightmap_height: self.lightmap_height,
            page_size: self.page_size,
            meshes: self.meshes.clone(),
        };
        let mut json = serde_json::to_vec(&header).expect("hall header");
        while !json.len().is_multiple_of(4) {
            json.push(b' ');
        }
        let mut out = Vec::new();
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&(json.len() as u32).to_le_bytes());
        out.extend_from_slice(&json);
        out.extend_from_slice(bytemuck::cast_slice(&self.positions));
        out.extend_from_slice(bytemuck::cast_slice(&self.normals));
        out.extend_from_slice(bytemuck::cast_slice(&self.tangents));
        out.extend_from_slice(bytemuck::cast_slice(&self.uv0));
        out.extend_from_slice(bytemuck::cast_slice(&self.uv1));
        out.extend_from_slice(bytemuck::cast_slice(&self.indices));
        std::fs::write(path, out).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    }

    pub fn read(path: &Path) -> Hall {
        let bytes = std::fs::read(path)
            .unwrap_or_else(|e| panic!("{}: {e}. Run `cargo run --release --bin bake` first.", path.display()));
        assert_eq!(&bytes[..4], MAGIC, "{} is not a hall file", path.display());
        let len = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
        let header: Header = serde_json::from_slice(&bytes[8..8 + len]).expect("hall header");
        let vertices: usize = header.meshes.iter().map(|m| m.vertex_count as usize).sum();
        let indices: usize = header.meshes.iter().map(|m| m.index_count as usize).sum();
        let mut at = 8 + len;
        // The data is only 4-byte aligned inside the Vec<u8>, so it is copied element-wise.
        fn take<T: bytemuck::Pod>(bytes: &[u8], at: &mut usize, count: usize) -> Vec<T> {
            let size = count * std::mem::size_of::<T>();
            let v = bytemuck::pod_collect_to_vec(&bytes[*at..*at + size]);
            *at += size;
            v
        }
        let hall = Hall {
            positions: take(&bytes, &mut at, vertices),
            normals: take(&bytes, &mut at, vertices),
            tangents: take(&bytes, &mut at, vertices),
            uv0: take(&bytes, &mut at, vertices),
            uv1: take(&bytes, &mut at, vertices),
            indices: take(&bytes, &mut at, indices),
            meshes: header.meshes,
            lightmap_width: header.lightmap_width,
            lightmap_height: header.lightmap_height,
            page_size: header.page_size,
        };
        assert_eq!(at, bytes.len(), "{}: trailing bytes", path.display());
        hall
    }
}
