//! Light sources and the light tree that picks one per sample.
//!
//! Sources:
//! - The point and area lights of scene/lighting.json.
//! - Every emissive triangle, as in Cycles.
//!
//! Units follow Cycles. A point light of P watts has an intensity of P / 4π W/sr. An area
//! light of P watts and area A has a radiance of P / (π A). An emission strength S is a
//! radiance of S. A narrow `spread` reshapes the area light's radiance with Cycles' softbox
//! model: L(θ) ∝ max(tan(spread/2) − tan θ, 0) / (tan(spread/2) − spread/2).
//!
//! The tree is a bounding volume hierarchy over all sources with an orientation cone and a
//! power per node, after PBRT-v4's BVHLightSampler. The shader walks it once per sample and
//! picks a child in proportion to an importance bound for the shading point.

use std::f32::consts::PI;

use bevy::math::{Quat, Vec2, Vec3};

use crate::geometry::Geometry;
use crate::materials::Materials;
use crate::scene_file::Light;

/// GPU analytic light, 80 bytes. Matches `Light` in trace.wgsl.
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct GpuLight {
    pub pos: [f32; 3],
    /// Bit 0: 0 = sphere (point light), 1 = rectangle (area light). Bit 1: visible to glossy
    /// rays (Blender's `visible_glossy`); only the probe bake reads it.
    pub kind: u32,
    /// Sphere: intensity in W/sr. Rectangle: radiance at normal incidence, before the spread.
    pub value: [f32; 3],
    pub radius: f32,
    /// Rectangle edge vectors (full width and height).
    pub ax: [f32; 3],
    /// tan(spread / 2), or a negative number for a plain Lambertian panel.
    pub tan_half: f32,
    pub ay: [f32; 3],
    pub spread_norm: f32,
    /// Emission direction of the rectangle.
    pub normal: [f32; 3],
    pub area: f32,
}

/// GPU emissive triangle, 80 bytes. Matches `Emitter` in trace.wgsl.
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct GpuEmitter {
    pub p0: [f32; 3],
    pub material: u32,
    pub p1: [f32; 3],
    pub area: f32,
    pub p2: [f32; 3],
    pub _pad: f32,
    pub uv0: [f32; 2],
    pub uv1: [f32; 2],
    pub uv2: [f32; 2],
    pub _pad2: [f32; 2],
}

/// GPU light tree node, 64 bytes. Matches `Node` in trace.wgsl.
///
/// An inner node's left child follows it directly; `child` holds the right child. A leaf's
/// `child` holds its source: an analytic light below the light count, an emitter above.
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct GpuNode {
    pub min: [f32; 3],
    pub phi: f32,
    pub max: [f32; 3],
    pub cos_o: f32,
    pub w: [f32; 3],
    pub cos_e: f32,
    pub child: u32,
    /// Bit 0: leaf. Bit 1: two-sided emitter.
    pub flags: u32,
    pub _pad: [u32; 2],
}

/// Bounds of one source or of a subtree.
#[derive(Clone, Copy)]
struct Bounds {
    min: Vec3,
    max: Vec3,
    /// Peak radiant intensity times luminance: the power measure of the importance.
    phi: f32,
    /// Orientation cone: axis, cos of the spread of normals, cos of the emission angle.
    w: Vec3,
    cos_o: f32,
    cos_e: f32,
    two_sided: bool,
}

impl Bounds {
    fn centroid(&self) -> Vec3 {
        (self.min + self.max) * 0.5
    }

    fn union(&self, b: &Bounds) -> Bounds {
        if self.phi == 0.0 {
            return *b;
        }
        if b.phi == 0.0 {
            return *self;
        }
        let (w, cos_o) = cone_union(self.w, self.cos_o, b.w, b.cos_o);
        Bounds {
            min: self.min.min(b.min),
            max: self.max.max(b.max),
            phi: self.phi + b.phi,
            w,
            cos_o,
            cos_e: self.cos_e.min(b.cos_e),
            two_sided: self.two_sided || b.two_sided,
        }
    }
}

/// The smallest cone holding two cones (PBRT-v4 DirectionCone::Union).
fn cone_union(wa: Vec3, cos_a: f32, wb: Vec3, cos_b: f32) -> (Vec3, f32) {
    let theta_a = cos_a.clamp(-1.0, 1.0).acos();
    let theta_b = cos_b.clamp(-1.0, 1.0).acos();
    let theta_d = wa.dot(wb).clamp(-1.0, 1.0).acos();
    if (theta_d + theta_b).min(PI) <= theta_a {
        return (wa, cos_a);
    }
    if (theta_d + theta_a).min(PI) <= theta_b {
        return (wb, cos_b);
    }
    let theta_o = (theta_a + theta_d + theta_b) * 0.5;
    if theta_o >= PI {
        return (wa, -1.0);
    }
    let theta_r = theta_o - theta_a;
    let axis = wa.cross(wb);
    if axis.length_squared() < 1e-12 {
        return (wa, -1.0);
    }
    let w = Quat::from_axis_angle(axis.normalize(), theta_r) * wa;
    (w.normalize(), theta_o.cos())
}

fn luminance(c: Vec3) -> f32 {
    c.dot(Vec3::new(0.2126, 0.7152, 0.0722))
}

pub struct LightSet {
    pub lights: Vec<GpuLight>,
    pub emitters: Vec<GpuEmitter>,
    /// The tree over all sources, root at node 0.
    pub nodes: Vec<GpuNode>,
}

pub fn build(scene_lights: &[Light], geo: &Geometry, materials: &Materials) -> LightSet {
    let mut lights = Vec::new();
    let mut bounds = Vec::new();

    // ONLY_LIGHTS=PL_Vault,EM_ keeps the Blender lights whose names start with one of the
    // prefixes, like the app's switch. The emissive triangles stay only with `EM_` in the list.
    let only: Option<Vec<String>> =
        std::env::var("ONLY_LIGHTS").ok().map(|v| v.split(',').map(str::to_string).collect());
    let kept = |name: &str| only.as_ref().is_none_or(|o| o.iter().any(|p| name.starts_with(p.as_str())));
    for l in scene_lights {
        if !kept(&l.name) {
            continue;
        }
        let color = Vec3::from(l.color);
        let p = Vec3::from(l.position);
        let rot = l.rotation();
        match l.kind.as_str() {
            "point" => {
                let r = l.radius;
                let intensity = color * l.watts / (4.0 * PI);
                lights.push(GpuLight {
                    pos: p.to_array(),
                    kind: (l.glossy as u32) << 1,
                    value: intensity.to_array(),
                    radius: r,
                    ax: [0.0; 3],
                    tan_half: -1.0,
                    ay: [0.0; 3],
                    spread_norm: 0.0,
                    normal: [0.0, 1.0, 0.0],
                    area: 0.0,
                });
                bounds.push(Bounds {
                    min: p - Vec3::splat(r),
                    max: p + Vec3::splat(r),
                    phi: luminance(intensity),
                    w: Vec3::Y,
                    cos_o: -1.0,
                    cos_e: 0.0,
                    two_sided: false,
                });
            }
            "area" => {
                let (w, h) = (l.width, l.height);
                let ax = rot * Vec3::X * w;
                let ay = rot * Vec3::Y * h;
                // Blender area lights emit along local −Z.
                let normal = (rot * Vec3::NEG_Z).normalize();
                let area = w * h;
                let radiance = color * l.watts / (PI * area);
                let spread = l.spread;
                let half = spread * 0.5;
                let (tan_half, spread_norm, gain) = if spread >= PI - 1e-4 {
                    (-1.0, 0.0, 1.0)
                } else {
                    let t = half.tan();
                    // Cycles light.cpp: the softbox profile is normalized to keep the power.
                    let norm = if half > 0.05 { 1.0 / (t - half) } else { 3.0 / (half * half) };
                    (t, norm, t * norm)
                };
                lights.push(GpuLight {
                    pos: p.to_array(),
                    kind: 1 | ((l.glossy as u32) << 1),
                    value: radiance.to_array(),
                    radius: 0.0,
                    ax: ax.to_array(),
                    tan_half,
                    ay: ay.to_array(),
                    spread_norm,
                    normal: normal.to_array(),
                    area,
                });
                let corners = [p - 0.5 * ax - 0.5 * ay, p + 0.5 * ax - 0.5 * ay, p - 0.5 * ax + 0.5 * ay, p + 0.5 * ax + 0.5 * ay];
                let min = corners.iter().fold(Vec3::INFINITY, |a, c| a.min(*c));
                let max = corners.iter().fold(Vec3::NEG_INFINITY, |a, c| a.max(*c));
                bounds.push(Bounds {
                    min,
                    max,
                    phi: luminance(radiance) * area * gain,
                    w: normal,
                    cos_o: 1.0,
                    cos_e: half.min(PI * 0.5).cos(),
                    two_sided: false,
                });
            }
            other => panic!("light {} of kind {other}", l.name),
        }
    }
    // Emissive triangles. Cycles emits from both sides of a mesh light.
    let mut emitters = Vec::new();
    for prim in &geo.prims {
        let mat = prim.material as usize;
        if !materials.is_emissive(mat) || !kept("EM_") {
            continue;
        }
        for tri in 0..(prim.index_count / 3) as usize {
            let [a, b, c] = geo.triangle(prim, tri);
            let p = [a, b, c].map(|i| Vec3::from_slice(&geo.pos[i][..3]));
            let uv = [a, b, c].map(|i| Vec2::from(geo.uv0[i]));
            let cross = (p[1] - p[0]).cross(p[2] - p[0]);
            let area = cross.length() * 0.5;
            if area < 1e-10 {
                continue;
            }
            // Mean emission over seven points of the triangle.
            let pts = [
                (1.0 / 3.0, 1.0 / 3.0),
                (1.0, 0.0),
                (0.0, 1.0),
                (0.0, 0.0),
                (0.5, 0.5),
                (0.5, 0.0),
                (0.0, 0.5),
            ];
            let mut e = Vec3::ZERO;
            for (u, v) in pts {
                let t = uv[0] * (1.0 - u - v) + uv[1] * u + uv[2] * v;
                e += materials.emission_at(mat, t);
            }
            e /= pts.len() as f32;
            // A floor keeps texture detail between the probe points reachable.
            let lum = luminance(e).max(1e-3 * luminance(Vec3::from(materials.gpu[mat].emission)));
            if lum <= 0.0 {
                continue;
            }
            let n = cross / (2.0 * area);
            emitters.push(GpuEmitter {
                p0: p[0].to_array(),
                material: prim.material,
                p1: p[1].to_array(),
                area,
                p2: p[2].to_array(),
                _pad: 0.0,
                uv0: uv[0].to_array(),
                uv1: uv[1].to_array(),
                uv2: uv[2].to_array(),
                _pad2: [0.0; 2],
            });
            bounds.push(Bounds {
                min: p[0].min(p[1]).min(p[2]),
                max: p[0].max(p[1]).max(p[2]),
                phi: lum * area,
                w: n,
                cos_o: 1.0,
                cos_e: 0.0,
                two_sided: true,
            });
        }
    }

    let mut items: Vec<u32> = (0..bounds.len() as u32).collect();
    let mut nodes = Vec::with_capacity(bounds.len() * 2);
    build_node(&bounds, &mut items, &mut nodes);
    LightSet { lights, emitters, nodes }
}

fn gpu_node(b: &Bounds, child: u32, leaf: bool) -> GpuNode {
    GpuNode {
        min: b.min.to_array(),
        phi: b.phi,
        max: b.max.to_array(),
        cos_o: b.cos_o,
        w: b.w.to_array(),
        cos_e: b.cos_e,
        child,
        flags: leaf as u32 | ((b.two_sided as u32) << 1),
        _pad: [0; 2],
    }
}

/// Orientation measure of PBRT-v4's light BVH cost.
fn m_omega(b: &Bounds) -> f32 {
    let theta_o = b.cos_o.clamp(-1.0, 1.0).acos();
    let theta_e = b.cos_e.clamp(-1.0, 1.0).acos();
    let theta_w = (theta_o + theta_e).min(PI);
    let sin_o = (1.0 - b.cos_o * b.cos_o).max(0.0).sqrt();
    2.0 * PI * (1.0 - b.cos_o)
        + PI / 2.0 * (2.0 * theta_w * sin_o - (theta_o - 2.0 * theta_w).cos() - 2.0 * theta_o * sin_o + b.cos_o)
}

fn surface_area(min: Vec3, max: Vec3) -> f32 {
    let d = (max - min).max(Vec3::splat(1e-4));
    2.0 * (d.x * d.y + d.y * d.z + d.z * d.x)
}

/// Builds the subtree over `items` and returns its node index.
fn build_node(all: &[Bounds], items: &mut [u32], nodes: &mut Vec<GpuNode>) -> u32 {
    let total = items.iter().fold(Bounds { phi: 0.0, ..all[items[0] as usize] }, |acc, &i| acc.union(&all[i as usize]));
    let index = nodes.len() as u32;
    if items.len() == 1 {
        nodes.push(gpu_node(&all[items[0] as usize], items[0], true));
        return index;
    }
    nodes.push(gpu_node(&total, 0, false));

    // Binned split with PBRT-v4's cost: power × orientation measure × surface area, scaled
    // to favour cuts across the longest axis.
    let cmin = items.iter().fold(Vec3::INFINITY, |a, &i| a.min(all[i as usize].centroid()));
    let cmax = items.iter().fold(Vec3::NEG_INFINITY, |a, &i| a.max(all[i as usize].centroid()));
    let extent = cmax - cmin;
    const BINS: usize = 12;
    let mut best: Option<(f32, usize, usize)> = None;
    for axis in 0..3 {
        if extent[axis] <= 1e-6 {
            continue;
        }
        let mut bins: [Option<Bounds>; BINS] = [None; BINS];
        for &i in items.iter() {
            let b = &all[i as usize];
            let k = (((b.centroid()[axis] - cmin[axis]) / extent[axis]) * BINS as f32) as usize;
            let k = k.min(BINS - 1);
            bins[k] = Some(bins[k].map_or(*b, |x| x.union(b)));
        }
        let diag = total.max - total.min;
        let kr = diag.max_element() / diag[axis].max(1e-6);
        for split in 1..BINS {
            let fold = |r: std::ops::Range<usize>| {
                bins[r].iter().flatten().fold(None::<Bounds>, |acc, b| Some(acc.map_or(*b, |a| a.union(b))))
            };
            let (Some(l), Some(r)) = (fold(0..split), fold(split..BINS)) else { continue };
            let cost = l.phi * m_omega(&l) * surface_area(l.min, l.max) + r.phi * m_omega(&r) * surface_area(r.min, r.max);
            let cost = cost * kr;
            if best.is_none_or(|(c, _, _)| cost < c) {
                best = Some((cost, axis, split));
            }
        }
    }

    let mid = match best {
        Some((_, axis, split)) => {
            let at = |i: u32| {
                let k = (((all[i as usize].centroid()[axis] - cmin[axis]) / extent[axis]) * BINS as f32) as usize;
                k.min(BINS - 1) < split
            };
            let mut lo = 0;
            for j in 0..items.len() {
                if at(items[j]) {
                    items.swap(lo, j);
                    lo += 1;
                }
            }
            lo
        }
        None => 0,
    };
    // Coincident centroids or a degenerate split: halve the list.
    let mid = if mid == 0 || mid == items.len() { items.len() / 2 } else { mid };
    let (left, right) = items.split_at_mut(mid);
    let l = build_node(all, left, nodes);
    debug_assert_eq!(l, index + 1);
    let r = build_node(all, right, nodes);
    nodes[index as usize].child = r;
    index
}
