//! Builds a StandardMaterial for every material baked by `tools/export_blend.py`.
//!
//! Bevy does not build mipmaps for PNG files, and textures without mipmaps shimmer at a
//! distance. The textures are therefore decoded here and get a full mip chain on the CPU.
//!
//! A normal map mip holds the renormalized average normal, so the bumps of its texels vanish
//! at a distance. Their highlights would then alias into sparkles under the live point lights.
//! The roughness mips therefore take up the lost bumps (Toksvig's idea, in the vMF form of
//! Neubelt and Pettineo 2013): the average of unit normals has the length l < 1, which gives
//! a von Mises-Fisher spread κ = (3l − l³) / (1 − l²), and the GGX alpha grows to
//! √(α² + 2 / κ).

use std::collections::HashMap;
use std::path::Path;

use bevy::asset::RenderAssetUsages;
use bevy::image::{ImageAddressMode, ImageFilterMode, ImageSampler, ImageSamplerDescriptor};
use bevy::math::Affine2;
use bevy::material::OpaqueRendererMethod;
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};

use crate::scene_file::MaterialDef;
use crate::units::{LUMENS_PER_WATT, nits};

#[derive(Clone, PartialEq)]
enum Kind {
    Srgb,
    Linear,
    Normal,
    /// A metallic-roughness texture; its roughness mips take up the bumps of this normal map.
    RoughnessFor(std::path::PathBuf),
}

/// Decodes all textures in parallel, then creates one material per definition.
pub fn build(
    defs: &[MaterialDef],
    images: &mut Assets<Image>,
    materials: &mut Assets<StandardMaterial>,
) -> HashMap<String, Handle<StandardMaterial>> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("assets");
    let mut jobs: Vec<(String, Kind)> = Vec::new();
    for d in defs {
        let mr_kind = match &d.normal {
            Some(n) if std::env::var("NO_TOKSVIG").is_err() => Kind::RoughnessFor(root.join(n)),
            _ => Kind::Linear,
        };
        for (path, kind) in [
            (&d.base, Kind::Srgb),
            (&d.emissive_map, Kind::Srgb),
            (&d.mr, mr_kind),
            (&d.normal, Kind::Normal),
        ] {
            if let Some(p) = path {
                jobs.push((p.clone(), kind));
            }
        }
    }
    let decoded: Vec<Image> = std::thread::scope(|s| {
        let handles: Vec<_> = jobs
            .iter()
            .map(|(p, kind)| {
                let path = root.join(p);
                s.spawn(move || load_mipmapped(&path, kind))
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap()).collect()
    });
    let textures: HashMap<String, Handle<Image>> = jobs
        .into_iter()
        .map(|(p, _)| p)
        .zip(decoded.into_iter().map(|img| images.add(img)))
        .collect();
    let tex = |p: &Option<String>| p.as_ref().map(|p| textures[p].clone());

    defs.iter()
        .map(|d| {
            let color = d.color.map_or(LinearRgba::WHITE, |c| LinearRgba::rgb(c[0], c[1], c[2]));
            let has_mr = d.mr.is_some();
            let mut m = StandardMaterial {
                base_color: color.into(),
                base_color_texture: tex(&d.base),
                metallic_roughness_texture: tex(&d.mr),
                normal_map_texture: tex(&d.normal),
                perceptual_roughness: if has_mr { 1.0 } else { d.roughness.unwrap_or(0.5) },
                metallic: if has_mr { 1.0 } else { d.metallic.unwrap_or(0.0) },
                reflectance: d.reflectance.unwrap_or(0.5),
                clearcoat: d.clearcoat,
                clearcoat_perceptual_roughness: d.clearcoat_roughness,
                double_sided: d.double_sided,
                // Emission is in nits like the lights, so the camera exposure must apply to it.
                emissive_exposure_weight: 1.0,
                // Lightmaps hold Blender radiance like the emission; one unit is 683 nits.
                lightmap_exposure: LUMENS_PER_WATT,
                cull_mode: if d.double_sided { None } else { Some(bevy::render::render_resource::Face::Back) },
                ..default()
            };
            if let Some(cutoff) = d.alpha_mask {
                m.alpha_mode = AlphaMode::Mask(cutoff);
            }
            if d.transmission > 0.0 {
                m.specular_transmission = d.transmission;
                m.ior = d.ior.unwrap_or(1.5);
                m.thickness = 0.02;
                m.perceptual_roughness = d.roughness.unwrap_or(0.05);
            }
            if d.emissive_texture || d.emissive_map.is_some() {
                // The deferred G-buffer drops the emissive texture; draw these forward.
                m.opaque_render_method = OpaqueRendererMethod::Forward;
            }
            if d.emissive_texture {
                m.emissive_texture = tex(&d.base);
                m.emissive = LinearRgba::WHITE * nits(d.emissive_strength);
            } else if d.emissive_map.is_some() {
                m.emissive_texture = tex(&d.emissive_map);
                m.emissive = LinearRgba::WHITE * nits(d.emissive_strength);
            } else if let Some(e) = d.emissive {
                m.emissive = LinearRgba::rgb(e[0], e[1], e[2]) * nits(d.emissive_strength);
            }
            if let Some(s) = d.uv_scale {
                // Blender's Mapping node in glTF UV space, where v runs downwards.
                let o = d.uv_offset.unwrap_or([0.0, 0.0]);
                m.uv_transform = Affine2::from_scale_angle_translation(
                    Vec2::new(s[0], s[1]),
                    0.0,
                    Vec2::new(o[0], 1.0 - s[1] - o[1]),
                );
            }
            // MIRROR_MATERIAL=BLK_BlackMarble turns a material into a chrome mirror, to check
            // what the probes and SSR reflect.
            if std::env::var("MIRROR_MATERIAL").is_ok_and(|v| v == d.name) {
                m = StandardMaterial { metallic: 1.0, perceptual_roughness: 0.0, ..default() };
            }
            (d.name.clone(), materials.add(m))
        })
        .collect()
}

fn load_mipmapped(path: &Path, kind: &Kind) -> Image {
    let src = image_crate::open(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let (w0, h0) = (src.width(), src.height());
    let (mut w, mut h) = (w0, h0);
    let kind = kind.clone();
    // Normal maps are 16-bit: a weakened normal map tilts by less than one 8-bit step in places,
    // and the steps sparkle in the highlights of the glossy marble. They keep X and Y only
    // (Rg16Unorm, as many bytes as RGBA8), and Bevy rebuilds Z.
    let wide = kind == Kind::Normal;
    let channels: usize = if wide { 2 } else { 4 };
    // The unit normals of the matching normal map, averaged down the mip chain without
    // renormalizing.
    let mut normals: Option<Vec<Vec3>> = match &kind {
        Kind::RoughnessFor(normal_path) => {
            let n = image_crate::open(normal_path)
                .unwrap_or_else(|e| panic!("{}: {e}", normal_path.display()))
                .to_rgba16();
            assert_eq!(n.dimensions(), (w, h), "{} and its normal map differ in size", path.display());
            Some(
                n.pixels()
                    .map(|p| (Vec3::new(p[0] as f32, p[1] as f32, p[2] as f32) / 65535.0 * 2.0 - 1.0).normalize_or(Vec3::Z))
                    .collect(),
            )
        }
        _ => None,
    };
    let decode = |c: f32| -> f32 {
        if kind == Kind::Srgb {
            if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
        } else {
            c
        }
    };
    let encode = |c: f32, out: &mut Vec<u8>| {
        let c = c.clamp(0.0, 1.0);
        let c = if kind == Kind::Srgb {
            if c <= 0.0031308 { c * 12.92 } else { 1.055 * c.powf(1.0 / 2.4) - 0.055 }
        } else {
            c
        };
        if wide {
            out.extend_from_slice(&((c * 65535.0 + 0.5) as u16).to_le_bytes());
        } else {
            out.push((c * 255.0 + 0.5) as u8);
        }
    };

    let (mut data, mut level): (Vec<u8>, Vec<f32>) = if wide {
        let raw = src.to_rgba16().into_raw();
        let xy = raw.chunks(4).flat_map(|p| [p[0], p[1]]).flat_map(|v| v.to_le_bytes()).collect();
        (xy, raw.iter().map(|&v| v as f32 / 65535.0).collect())
    } else {
        let raw = src.to_rgba8().into_raw();
        let level = raw.iter().map(|&v| decode(v as f32 / 255.0)).collect();
        (raw, level)
    };
    let mut levels = 1;
    while w > 1 || h > 1 {
        let (nw, nh) = ((w / 2).max(1), (h / 2).max(1));
        let mut next = vec![0.0f32; (nw * nh * 4) as usize];
        for y in 0..nh {
            for x in 0..nw {
                let mut acc = [0.0f32; 4];
                for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                    let sx = (x * 2 + dx).min(w - 1);
                    let sy = (y * 2 + dy).min(h - 1);
                    let i = ((sy * w + sx) * 4) as usize;
                    for c in 0..4 {
                        acc[c] += level[i + c];
                    }
                }
                let o = ((y * nw + x) * 4) as usize;
                for c in 0..4 {
                    next[o + c] = acc[c] * 0.25;
                }
                if kind == Kind::Normal {
                    let n = Vec3::new(next[o], next[o + 1], next[o + 2]) * 2.0 - 1.0;
                    let n = n.normalize_or(Vec3::Z) * 0.5 + 0.5;
                    next[o..o + 3].copy_from_slice(&n.to_array());
                }
            }
        }
        let mut encoded: Vec<u8> = Vec::with_capacity(next.len());
        for texel in next.chunks(4) {
            for &v in &texel[..channels] {
                encode(v, &mut encoded);
            }
        }
        if let Some(n) = &mut normals {
            let mut avg = vec![Vec3::ZERO; (nw * nh) as usize];
            for y in 0..nh {
                for x in 0..nw {
                    let mut acc = Vec3::ZERO;
                    for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                        acc += n[((y * 2 + dy).min(h - 1) * w + (x * 2 + dx).min(w - 1)) as usize];
                    }
                    let a = acc * 0.25;
                    avg[(y * nw + x) as usize] = a;
                    // glTF metallic-roughness: perceptual roughness in G.
                    let l = a.length().min(1.0);
                    if l < 0.9999 {
                        let kappa = (3.0 * l - l * l * l) / (1.0 - l * l);
                        let r = next[((y * nw + x) * 4 + 1) as usize];
                        let alpha = (r * r * r * r + 2.0 / kappa).sqrt().min(1.0);
                        let mut b = Vec::with_capacity(1);
                        encode(alpha.sqrt(), &mut b);
                        encoded[((y * nw + x) * 4 + 1) as usize] = b[0];
                    }
                }
            }
            *n = avg;
        }
        data.extend(encoded);
        level = next;
        w = nw;
        h = nh;
        levels += 1;
    }

    let format = match kind {
        Kind::Srgb => TextureFormat::Rgba8UnormSrgb,
        Kind::Normal => TextureFormat::Rg16Unorm,
        _ => TextureFormat::Rgba8Unorm,
    };
    // Image::new checks the data length against the first level only.
    let mut image = Image::new_uninit(
        Extent3d { width: w0, height: h0, depth_or_array_layers: 1 },
        TextureDimension::D2,
        format,
        RenderAssetUsages::RENDER_WORLD,
    );
    image.data = Some(data);
    image.texture_descriptor.mip_level_count = levels;
    image.sampler = ImageSampler::Descriptor(ImageSamplerDescriptor {
        address_mode_u: ImageAddressMode::Repeat,
        address_mode_v: ImageAddressMode::Repeat,
        mag_filter: ImageFilterMode::Linear,
        min_filter: ImageFilterMode::Linear,
        mipmap_filter: ImageFilterMode::Linear,
        anisotropy_clamp: 16,
        ..default()
    });
    image
}
