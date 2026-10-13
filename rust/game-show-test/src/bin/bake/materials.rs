//! The material data the path tracer needs: diffuse albedo, emission and specular color.
//!
//! The bake only needs the surface colors that bounce light, so every textured material is
//! reduced to 512² layers of a texture array:
//! - albedo layer: base color × (1 − metallic) × (1 − transmission), alpha = base alpha;
//! - emission layer: the emissive texture, linear;
//! - specular layer: the reflectance at normal incidence (F0) and the roughness in alpha. Only
//!   the probe bake reads it; the lightmap bake is diffuse only.
//!
//! The probe bake also reads the glass weight, IOR and tint, and the clear coat. The crystal
//! refracts only in the bake (`bake_transmission`); the app draws it opaque.
//!
//! Normal maps keep their full 2048² resolution in a second texture array, as 8-bit OpenGL
//! tangent-space normals. Cycles bakes the lightmaps with the normal-mapped shading normal,
//! so the baker applies them too.
//!
//! Cycles renders this scene with reflective and refractive caustics off. A path that has
//! left the baked surface therefore only scatters diffusely, and metal and glass act as black
//! diffuse surfaces. The (1 − metallic) and (1 − transmission) factors model exactly that.

use std::path::Path;

use bevy::math::{Vec2, Vec3, Vec4};

use crate::scene_file::MaterialDef;

pub const LAYER_SIZE: u32 = 512;
pub const NORMAL_SIZE: u32 = 2048;

/// GPU material, 112 bytes. Matches `Material` in trace.wgsl.
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct GpuMaterial {
    pub albedo: [f32; 3],
    pub albedo_layer: i32,
    /// Emission color × strength, Blender radiance units.
    pub emission: [f32; 3],
    pub emission_layer: i32,
    pub uv_scale: [f32; 2],
    pub uv_offset: [f32; 2],
    /// Alpha below this lets rays through; 0 for opaque materials.
    pub alpha_cutoff: f32,
    pub flags: u32,
    /// Layer in the normal map array, or −1.
    pub normal_layer: i32,
    /// Specular layer (F0 and roughness), or −1 for the constants below.
    pub specular_layer: i32,
    /// F0 of an untextured material.
    pub specular: [f32; 3],
    /// Perceptual roughness of an untextured material.
    pub roughness: f32,
    /// Glass weight: the rest of the light refracts through the surface.
    pub transmission: f32,
    pub ior: f32,
    /// Clear coat weight (F0 0.04) and its perceptual roughness.
    pub coat: f32,
    pub coat_roughness: f32,
    /// Color of the refracted light: the base color of a glass.
    pub tint: [f32; 3],
    pub _pad: f32,
}

pub struct Materials {
    pub gpu: Vec<GpuMaterial>,
    /// Linear RGBA layers, LAYER_SIZE² each.
    pub layers: Vec<Vec<Vec4>>,
    /// RGBA8 normal maps, NORMAL_SIZE² each.
    pub normal_maps: Vec<Vec<u8>>,
}

impl Materials {
    /// Emission at a material UV (before the uv transform), as the shader computes it.
    pub fn emission_at(&self, material: usize, uv: Vec2) -> Vec3 {
        let m = &self.gpu[material];
        let e = Vec3::from(m.emission);
        if m.emission_layer < 0 {
            return e;
        }
        let uv = uv * Vec2::from(m.uv_scale) + Vec2::from(m.uv_offset);
        let layer = &self.layers[m.emission_layer as usize];
        let n = LAYER_SIZE as f32;
        let x = ((uv.x.rem_euclid(1.0) * n) as u32).min(LAYER_SIZE - 1);
        let y = ((uv.y.rem_euclid(1.0) * n) as u32).min(LAYER_SIZE - 1);
        e * layer[(y * LAYER_SIZE + x) as usize].truncate()
    }

    pub fn is_emissive(&self, material: usize) -> bool {
        Vec3::from(self.gpu[material].emission).max_element() > 0.0
    }
}

pub fn build(defs: &[MaterialDef], assets: &Path) -> Materials {
    let mut layers: Vec<Vec<Vec4>> = Vec::new();
    let load = |p: &Option<String>, srgb: bool| p.as_ref().map(|p| load_layer(&assets.join(p), srgb));
    // Decode in parallel: the PNGs are 2K and decoding dominates.
    type Decoded = ([Option<Vec<Vec4>>; 3], Option<Vec<u8>>);
    let decoded: Vec<Decoded> = std::thread::scope(|s| {
        let handles: Vec<_> = defs
            .iter()
            .map(|d| {
                s.spawn(move || {
                    let emissive_path = if d.emissive_texture { &d.base } else { &d.emissive_map };
                    // NO_NORMAL_MAPS=1 bakes with the interpolated normals, for comparison.
                    let normal = d
                        .normal
                        .as_ref()
                        .filter(|_| std::env::var("NO_NORMAL_MAPS").is_err())
                        .map(|p| load_normal_map(&assets.join(p)));
                    ([load(&d.base, true), load(&d.mr, false), load(emissive_path, true)], normal)
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap()).collect()
    });

    let mut gpu = Vec::new();
    let mut normal_maps = Vec::new();
    for (d, ([base, mr, emissive], normal)) in defs.iter().zip(decoded) {
        let color = d.color.map_or(Vec3::ONE, Vec3::from);
        let transmission = d.transmission.max(d.bake_transmission);
        let metallic = if mr.is_some() { 1.0 } else { d.metallic.unwrap_or(0.0) };
        let albedo_layer = if base.is_some() || mr.is_some() {
            let n = (LAYER_SIZE * LAYER_SIZE) as usize;
            let layer: Vec<Vec4> = (0..n)
                .map(|i| {
                    let b = base.as_ref().map_or(Vec4::ONE, |t| t[i]);
                    // glTF metallic-roughness: metalness in B.
                    let metal = mr.as_ref().map_or(metallic, |t| t[i].z * metallic);
                    let rgb = color * b.truncate() * (1.0 - metal) * (1.0 - transmission);
                    rgb.extend(b.w)
                })
                .collect();
            layers.push(layer);
            layers.len() as i32 - 1
        } else {
            -1
        };
        let albedo = if albedo_layer >= 0 { Vec3::ONE } else { color * (1.0 - metallic) * (1.0 - transmission) };
        // Bevy's dielectric F0 is 0.16 × reflectance²; metal reflects with its base color.
        let reflectance = d.reflectance.unwrap_or(0.5);
        let ior = d.ior.unwrap_or(1.5);
        // Glass reflects with the F0 of its IOR, scaled like Blender's Specular IOR Level.
        let dielectric = if transmission > 0.0 {
            let f0 = ((ior - 1.0) / (ior + 1.0)).powi(2);
            Vec3::splat(f0 * 2.0 * d.specular_ior_level.unwrap_or(0.5))
        } else {
            Vec3::splat(0.16 * reflectance * reflectance)
        };
        let roughness =
            if transmission > 0.0 { d.roughness.unwrap_or(0.05) } else { d.roughness.unwrap_or(0.5) };
        let specular_layer = if base.is_some() || mr.is_some() {
            let n = (LAYER_SIZE * LAYER_SIZE) as usize;
            let layer: Vec<Vec4> = (0..n)
                .map(|i| {
                    let b = base.as_ref().map_or(Vec3::ONE, |t| t[i].truncate()) * color;
                    let metal = mr.as_ref().map_or(metallic, |t| t[i].z * metallic);
                    // glTF metallic-roughness: roughness in G.
                    let rough = mr.as_ref().map_or(roughness, |t| t[i].y);
                    dielectric.lerp(b, metal).extend(rough)
                })
                .collect();
            layers.push(layer);
            layers.len() as i32 - 1
        } else {
            -1
        };
        let specular = dielectric.lerp(color, metallic);
        let emission_layer = match emissive {
            Some(layer) => {
                layers.push(layer);
                layers.len() as i32 - 1
            }
            None => -1,
        };
        let emission = if emission_layer >= 0 {
            Vec3::splat(d.emissive_strength)
        } else {
            d.emissive.map_or(Vec3::ZERO, Vec3::from) * d.emissive_strength
        };
        // Bevy's uv_transform: scale, then translate by (o.x, 1 − s.y − o.y).
        let (uv_scale, uv_offset) = match d.uv_scale {
            Some(s) => {
                let o = d.uv_offset.unwrap_or([0.0, 0.0]);
                (s, [o[0], 1.0 - s[1] - o[1]])
            }
            None => ([1.0, 1.0], [0.0, 0.0]),
        };
        let normal_layer = match normal {
            Some(map) => {
                normal_maps.push(map);
                normal_maps.len() as i32 - 1
            }
            None => -1,
        };
        gpu.push(GpuMaterial {
            albedo: albedo.to_array(),
            albedo_layer,
            emission: emission.to_array(),
            emission_layer,
            uv_scale,
            uv_offset,
            // HIDE_MATERIAL=BLK_Glass lets every ray pass through that material, for experiments.
            alpha_cutoff: if std::env::var("HIDE_MATERIAL").is_ok_and(|v| v == d.name) {
                2.0
            } else {
                d.alpha_mask.unwrap_or(0.0)
            },
            flags: 0,
            normal_layer,
            specular_layer,
            specular: specular.to_array(),
            roughness,
            transmission,
            ior,
            coat: d.clearcoat,
            coat_roughness: d.clearcoat_roughness,
            tint: color.to_array(),
            _pad: 0.0,
        });
    }
    Materials { gpu, layers, normal_maps }
}

/// Decodes a normal map PNG into RGBA8 at NORMAL_SIZE², without color conversion.
fn load_normal_map(path: &Path) -> Vec<u8> {
    let img = image_crate::open(path).unwrap_or_else(|e| panic!("{}: {e}", path.display())).to_rgba8();
    let img = if img.dimensions() == (NORMAL_SIZE, NORMAL_SIZE) {
        img
    } else {
        image_crate::imageops::resize(&img, NORMAL_SIZE, NORMAL_SIZE, image_crate::imageops::FilterType::Triangle)
    };
    img.into_raw()
}

/// Decodes a PNG into linear RGBA and box-filters it to LAYER_SIZE².
fn load_layer(path: &Path, srgb: bool) -> Vec<Vec4> {
    let img = image_crate::open(path).unwrap_or_else(|e| panic!("{}: {e}", path.display())).to_rgba8();
    let (w, h) = img.dimensions();
    let decode = |v: u8| -> f32 {
        let c = v as f32 / 255.0;
        if !srgb {
            c
        } else if c <= 0.04045 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    let lut: Vec<f32> = (0..=255u8).map(decode).collect();
    let alpha = |v: u8| v as f32 / 255.0;
    let src: Vec<Vec4> = img
        .pixels()
        .map(|p| Vec4::new(lut[p[0] as usize], lut[p[1] as usize], lut[p[2] as usize], alpha(p[3])))
        .collect();
    let n = LAYER_SIZE;
    let mut out = Vec::with_capacity((n * n) as usize);
    for ty in 0..n {
        let y0 = (ty * h / n).min(h - 1);
        let y1 = ((ty + 1) * h).div_ceil(n).clamp(y0 + 1, h);
        for tx in 0..n {
            let x0 = (tx * w / n).min(w - 1);
            let x1 = ((tx + 1) * w).div_ceil(n).clamp(x0 + 1, w);
            let mut acc = Vec4::ZERO;
            for y in y0..y1 {
                for x in x0..x1 {
                    acc += src[(y * w + x) as usize];
                }
            }
            out.push(acc / ((y1 - y0) * (x1 - x0)) as f32);
        }
    }
    out
}
