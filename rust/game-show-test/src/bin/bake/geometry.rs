//! The hall as the GPU baker needs it: `hall.bin` with vec4 positions (the BLAS reads the
//! first three floats of each) and one primitive per merged mesh.

use std::collections::HashMap;

use crate::hall_file::Hall;

pub struct Prim {
    pub material: u32,
    pub first_vertex: u32,
    pub vertex_count: u32,
    pub first_index: u32,
    pub index_count: u32,
}

#[derive(Default)]
pub struct Geometry {
    /// World positions; w is unused.
    pub pos: Vec<[f32; 4]>,
    pub normal: Vec<[f32; 4]>,
    pub uv0: Vec<[f32; 2]>,
    pub uv1: Vec<[f32; 2]>,
    /// Indices relative to the primitive's first vertex.
    pub indices: Vec<u32>,
    pub prims: Vec<Prim>,
    pub lightmap_width: u32,
    pub lightmap_height: u32,
    pub page_size: u32,
}

impl Geometry {
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }

    /// The three global vertex indices of a primitive's triangle.
    pub fn triangle(&self, prim: &Prim, tri: usize) -> [usize; 3] {
        let i = prim.first_index as usize + tri * 3;
        let v = prim.first_vertex as usize;
        [v + self.indices[i] as usize, v + self.indices[i + 1] as usize, v + self.indices[i + 2] as usize]
    }

    /// The lightmap pages sit side by side in one row (see hall.rs).
    pub fn pages(&self) -> u32 {
        self.lightmap_width / self.page_size
    }

    /// The top-left texel of a page in the lightmap.
    pub fn page_origin(&self, page: u32) -> (u32, u32) {
        (page * self.page_size, 0)
    }
}

pub fn from_hall(hall: &Hall, material_index: &HashMap<String, u32>) -> Geometry {
    let prims = hall
        .meshes
        .iter()
        .zip(hall.ranges())
        .map(|(m, r)| Prim {
            material: *material_index
                .get(&m.material)
                .unwrap_or_else(|| panic!("material {} is not in materials.json", m.material)),
            first_vertex: r.first_vertex as u32,
            vertex_count: r.vertex_count as u32,
            first_index: r.first_index as u32,
            index_count: r.index_count as u32,
        })
        .collect();
    Geometry {
        pos: hall.positions.iter().map(|p| [p[0], p[1], p[2], 1.0]).collect(),
        normal: hall.normals.iter().map(|n| [n[0], n[1], n[2], 0.0]).collect(),
        uv0: hall.uv0.clone(),
        uv1: hall.uv1.clone(),
        indices: hall.indices.clone(),
        prims,
        lightmap_width: hall.lightmap_width,
        lightmap_height: hall.lightmap_height,
        page_size: hall.page_size,
    }
}
