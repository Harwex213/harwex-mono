//! Rasterizes the triangles of one lightmap page through the lightmap UVs.
//!
//! The texel coordinates here are local to the page: x and y run from 0 to the page size.
//! A triangle belongs to the page that holds its UV centroid; xatlas never lets a chart cross
//! a page edge.
//!
//! Two passes per page:
//! 1. A texel whose center lies inside a triangle belongs to that triangle.
//! 2. A texel that pass 1 left empty, but that a triangle touches, belongs to the nearest
//!    such triangle. Its sample point is the point of the triangle nearest to the texel
//!    center. Bilinear filtering reads these edge texels, so they must hold real light.
//!
//! Each covered texel becomes one `GpuTexel`: world position, shading normal, geometric
//! normal, its size in metres, and its triangle with the barycentric coordinates of the
//! sample point and their change per lightmap texel. The shader jitters every sample over the
//! texel through these, like Cycles' bake does.

use bevy::math::{Vec2, Vec3};

use crate::geometry::Geometry;

/// One texel to bake, 80 bytes. Matches `Texel` in trace.wgsl and filter.wgsl.
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct GpuTexel {
    pub pos: [f32; 3],
    /// Index into the page, row-major from the top-left texel.
    pub texel: u32,
    pub ns: [f32; 3],
    /// Edge length of the texel in metres.
    pub size: f32,
    pub ng: [f32; 3],
    pub material: u32,
    /// The primitive (TLAS instance) and its triangle.
    pub prim: u32,
    pub tri: u32,
    /// Barycentric weights of the second and third vertex at the sample point.
    pub bary: [f32; 2],
    /// Change of `bary` per lightmap texel along x and along y.
    pub dbary_dx: [f32; 2],
    pub dbary_dy: [f32; 2],
}

const NONE: u32 = u32::MAX;

/// Barycentric weights of `p` in the 2D triangle, or None for a degenerate triangle.
fn barycentric(a: Vec2, b: Vec2, c: Vec2, p: Vec2) -> Option<[f32; 3]> {
    let area = (b - a).perp_dot(c - a);
    if area.abs() < 1e-12 {
        return None;
    }
    let w1 = (p - a).perp_dot(c - a) / area;
    let w2 = (b - a).perp_dot(p - a) / area;
    Some([1.0 - w1 - w2, w1, w2])
}

/// The point of the triangle nearest to `p`, as barycentric weights, and its distance.
fn nearest(a: Vec2, b: Vec2, c: Vec2, p: Vec2) -> Option<([f32; 3], f32)> {
    let w = barycentric(a, b, c, p)?;
    if w.iter().all(|&x| x >= 0.0) {
        return Some((w, 0.0));
    }
    let mut best = ([0.0; 3], f32::INFINITY);
    for (i, j) in [(0usize, 1usize), (1, 2), (2, 0)] {
        let (pi, pj) = ([a, b, c][i], [a, b, c][j]);
        let e = pj - pi;
        let t = ((p - pi).dot(e) / e.length_squared().max(1e-20)).clamp(0.0, 1.0);
        let d = (pi + e * t).distance(p);
        if d < best.1 {
            let mut w = [0.0; 3];
            w[i] = 1.0 - t;
            w[j] = t;
            best = (w, d);
        }
    }
    Some(best)
}

pub struct PageTexels {
    pub texels: Vec<GpuTexel>,
    /// Page texel → index into `texels`, or u32::MAX.
    pub map: Vec<u32>,
}

pub fn rasterize(geo: &Geometry, page: u32) -> PageTexels {
    let size = geo.page_size;
    let n = size as usize;
    let fsize = size as f32;
    // Owner triangle per texel: (prim, triangle), and the distance of its sample point.
    let mut owner: Vec<(u32, u32)> = vec![(NONE, NONE); n * n];
    let mut dist: Vec<f32> = vec![f32::INFINITY; n * n];

    let (ox, oy) = geo.page_origin(page);
    let scale = Vec2::new(geo.lightmap_width as f32, geo.lightmap_height as f32);
    let origin = Vec2::new(ox as f32, oy as f32);
    let uv = |i: usize| Vec2::from(geo.uv1[i]) * scale - origin;
    // The triangles of this page, as (prim, triangle).
    let mut tris: Vec<(usize, usize)> = Vec::new();
    for (pi, prim) in geo.prims.iter().enumerate() {
        for tri in 0..(prim.index_count / 3) as usize {
            let [ia, ib, ic] = geo.triangle(prim, tri);
            let c = (uv(ia) + uv(ib) + uv(ic)) / 3.0;
            if c.x >= 0.0 && c.y >= 0.0 && c.x < fsize && c.y < fsize {
                tris.push((pi, tri));
            }
        }
    }

    // Pass 1: texel centers inside triangles.
    for &(pi, tri) in &tris {
        let [ia, ib, ic] = geo.triangle(&geo.prims[pi], tri);
        let (a, b, c) = (uv(ia), uv(ib), uv(ic));
        let lo = a.min(b).min(c);
        let hi = a.max(b).max(c);
        let x0 = ((lo.x - 0.5).ceil().max(0.0)) as usize;
        let y0 = ((lo.y - 0.5).ceil().max(0.0)) as usize;
        let x1 = ((hi.x - 0.5).floor().min(fsize - 1.0)) as isize;
        let y1 = ((hi.y - 0.5).floor().min(fsize - 1.0)) as isize;
        for y in y0 as isize..=y1 {
            for x in x0 as isize..=x1 {
                let p = Vec2::new(x as f32 + 0.5, y as f32 + 0.5);
                if let Some(w) = barycentric(a, b, c, p)
                    && w.iter().all(|&v| v >= 0.0)
                {
                    let t = y as usize * n + x as usize;
                    owner[t] = (pi as u32, tri as u32);
                    dist[t] = 0.0;
                }
            }
        }
    }

    // Pass 2: texels that a triangle touches without covering the center.
    for &(pi, tri) in &tris {
        let [ia, ib, ic] = geo.triangle(&geo.prims[pi], tri);
        let (a, b, c) = (uv(ia), uv(ib), uv(ic));
        let lo = a.min(b).min(c);
        let hi = a.max(b).max(c);
        let x0 = (lo.x - 1.0).floor().max(0.0) as usize;
        let y0 = (lo.y - 1.0).floor().max(0.0) as usize;
        let x1 = ((hi.x + 1.0).floor().min(fsize - 1.0)) as isize;
        let y1 = ((hi.y + 1.0).floor().min(fsize - 1.0)) as isize;
        for y in y0 as isize..=y1 {
            for x in x0 as isize..=x1 {
                let t = y as usize * n + x as usize;
                if dist[t] == 0.0 {
                    continue;
                }
                let p = Vec2::new(x as f32 + 0.5, y as f32 + 0.5);
                // The texel square reaches 0.71 texels from its center.
                if let Some((_, d)) = nearest(a, b, c, p)
                    && d < 0.71
                    && d < dist[t]
                {
                    owner[t] = (pi as u32, tri as u32);
                    dist[t] = d;
                }
            }
        }
    }

    let mut texels = Vec::new();
    let mut map = vec![NONE; n * n];
    for t in 0..n * n {
        let (pi, tri) = owner[t];
        if pi == NONE {
            continue;
        }
        let prim = &geo.prims[pi as usize];
        let idx = geo.triangle(prim, tri as usize);
        let (a, b, c) = (uv(idx[0]), uv(idx[1]), uv(idx[2]));
        let p = Vec2::new((t % n) as f32 + 0.5, (t / n) as f32 + 0.5);
        let Some((w, _)) = nearest(a, b, c, p) else { continue };
        let wp = idx.map(|i| Vec3::from_slice(&geo.pos[i][..3]));
        let wn = idx.map(|i| Vec3::from_slice(&geo.normal[i][..3]));
        let pos = wp[0] * w[0] + wp[1] * w[1] + wp[2] * w[2];
        let mut ns = (wn[0] * w[0] + wn[1] * w[1] + wn[2] * w[2]).normalize_or_zero();
        let cross = (wp[1] - wp[0]).cross(wp[2] - wp[0]);
        let mut ng = cross.normalize_or_zero();
        if ns == Vec3::ZERO {
            ns = ng;
        }
        if ng.dot(ns) < 0.0 {
            ng = -ng;
        }
        if ng == Vec3::ZERO {
            continue;
        }
        let uv_area = (b - a).perp_dot(c - a).abs();
        let world_area = cross.length();
        let size = (world_area / uv_area.max(1e-12)).sqrt();
        // The weights are affine in the lightmap position, so one texel step gives the derivative.
        let center = barycentric(a, b, c, p);
        let step = |d: Vec2| match (center, barycentric(a, b, c, p + d)) {
            (Some(c0), Some(c1)) => [c1[1] - c0[1], c1[2] - c0[2]],
            _ => [0.0; 2],
        };
        map[t] = texels.len() as u32;
        texels.push(GpuTexel {
            pos: pos.to_array(),
            texel: t as u32,
            ns: ns.to_array(),
            size,
            ng: ng.to_array(),
            material: prim.material,
            prim: pi,
            tri,
            bary: [w[1], w[2]],
            dbary_dx: step(Vec2::X),
            dbary_dy: step(Vec2::Y),
        });
    }
    PageTexels { texels, map }
}
