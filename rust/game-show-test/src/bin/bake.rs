//! Turns the Blender export into everything the app loads, on the GPU with wgpu ray queries.
//!
//!   cargo run --release --bin bake -- [--steps hall,lightmap,probes] [--density 12] [--pages 2]
//!       [--samples 1024] [--bounces 4] [--filter 4] [--clamp 6] [--fixup]
//!       [--probe-samples 512] [--probe-size 512] [--probe-bounces 4]
//!
//! Steps, all three by default:
//! - `hall`: reads assets/casino.glb, unwraps lightmap UVs with xatlas, packs them into one
//!   lightmap of at most `--pages` 4096² pages and merges the meshes per material into
//!   assets/hall/hall.bin (hall.rs).
//! - `lightmap`: path-traces assets/hall/lightmap.rgb9e5. Each texel holds what Cycles' DIFFUSE
//!   bake holds with direct and indirect light and without color: irradiance / π in Blender
//!   units. Bevy multiplies it by the diffuse color and `lightmap_exposure` = 683. Per page:
//!   rasterize the triangles into texels on the CPU (raster.rs), path-trace the texels in
//!   short GPU dispatches (`trace_texels`), denoise with an edge-aware à-trous filter
//!   (filter.wgsl), dilate into the gutter and encode (post.rs).
//! - `probes`: renders one cubemap per probe box of scene/lighting.json into assets/probes/
//!   (`trace_probe`). It reads the lightmap, so it runs after the lightmap step.
//!
//! Lights and probe boxes come from scene/lighting.json, materials from assets/materials.json
//! and assets/textures/.

#[allow(dead_code)]
#[path = "../hall_file.rs"]
mod hall_file;
#[allow(dead_code)]
#[path = "../scene_file.rs"]
mod scene_file;

#[path = "bake/geometry.rs"]
mod geometry;
#[path = "bake/gpu.rs"]
mod gpu;
#[path = "bake/hall.rs"]
mod hall;
#[path = "bake/lights.rs"]
mod lights;
#[path = "bake/materials.rs"]
mod materials;
#[path = "bake/post.rs"]
mod post;
#[path = "bake/raster.rs"]
mod raster;

use std::collections::HashMap;
use std::path::Path;
use std::time::Instant;

use bevy::math::Vec3;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let flag = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
    let number = |name: &str, default: f32| flag(name).map_or(default, |s| s.parse().unwrap_or_else(|_| panic!("{name} N")));
    let steps = flag("--steps").unwrap_or("hall,lightmap,probes".into());
    let step = |name: &str| steps.split(',').any(|s| s == name);

    let total = Instant::now();
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("assets");
    let hall_dir = root.join("hall");
    std::fs::create_dir_all(&hall_dir).expect("assets/hall");
    let hall_path = hall_dir.join("hall.bin");
    let lightmap_path = hall_dir.join("lightmap.rgb9e5");

    if step("hall") {
        let t = Instant::now();
        let options = hall::Options {
            density: number("--density", 12.0),
            page_size: 4096,
            max_pages: number("--pages", 2.0) as u32,
            padding: 1,
        };
        hall::build(&root.join("casino.glb"), &options).write(&hall_path);
        println!("hall: {:.1} s", t.elapsed().as_secs_f32());
    }
    if !step("lightmap") && !step("probes") {
        return;
    }

    let t = Instant::now();
    let lighting = scene_file::load_lighting();
    let defs = scene_file::load_materials();
    let names: Vec<String> = defs.iter().map(|m| m.name.clone()).collect();
    let index: HashMap<String, u32> = names.iter().enumerate().map(|(i, n)| (n.clone(), i as u32)).collect();
    let mats = materials::build(&defs, &root);
    let geo = geometry::from_hall(&hall_file::Hall::read(&hall_path), &index);
    let light_set = lights::build(&lighting.lights, &geo, &mats);
    println!(
        "scene: {} meshes, {} vertices, {} triangles, {} lights, {} emissive triangles, {} tree nodes ({:.1} s)",
        geo.prims.len(),
        geo.pos.len(),
        geo.triangle_count(),
        light_set.lights.len(),
        light_set.emitters.len(),
        light_set.nodes.len(),
        t.elapsed().as_secs_f32()
    );
    // The world color reaches the hall only through windows. Cycles' lightmaps were black on
    // outward-facing walls, so the lightmap bake leaves it out unless BACKGROUND=1.
    let w = &lighting.world;
    let background = (Vec3::from(w.background) * w.background_strength).to_array();
    let settings = gpu::Settings {
        samples: number("--samples", 1024.0) as u32,
        max_bounces: number("--bounces", 4.0) as u32,
        // Cycles' sample_clamp_indirect of the presentation renders. The shader applies it
        // like Cycles: to the radiance with the baked surface's color.
        clamp_indirect: number("--clamp", 6.0),
        background: if std::env::var("BACKGROUND").is_ok() { background } else { [0.0; 3] },
        filter_passes: number("--filter", 4.0) as u32,
        fixup: args.iter().any(|a| a == "--fixup"),
        haze_scatter: [0.0; 3],
        haze_g: 0.0,
        haze_extinction: 0.0,
    };
    let mut gpu = gpu::Gpu::new(&geo, &mats, &light_set);

    if step("lightmap") {
        bake_lightmap(&gpu, &geo, &settings, &lightmap_path);
    }
    if step("probes") {
        let t = Instant::now();
        let data = std::fs::read(&lightmap_path).expect("lightmap.rgb9e5: run the lightmap step first");
        assert_eq!(data.len(), (geo.lightmap_width * geo.lightmap_height * 4) as usize, "lightmap size");
        gpu.set_lightmap(&data, geo.lightmap_width, geo.lightmap_height);
        let probe_settings = gpu::Settings {
            samples: number("--probe-samples", 512.0) as u32,
            max_bounces: number("--probe-bounces", 4.0) as u32,

            // Camera rays that leave the hall see the world color, as in a Cycles render.
            background,
            // Cycles' principled volume: scattering = color × density. Its absorption is
            // (1 − color) × density, so the extinction is the density.
            haze_scatter: (Vec3::from(w.haze_color) * w.haze_density).to_array(),
            haze_g: w.haze_anisotropy,
            haze_extinction: if std::env::var("NO_HAZE").is_ok() { 0.0 } else { w.haze_density },
            ..settings
        };
        let face = number("--probe-size", 512.0) as u32;
        bake_probes(&gpu, &lighting.probes, face, &probe_settings, &root);
        println!("probes: {} at {face}² in {:.1} s", lighting.probes.len(), t.elapsed().as_secs_f32());
    }
    println!("bake: total {:.1} s", total.elapsed().as_secs_f32());
}

fn bake_lightmap(gpu: &gpu::Gpu, geo: &geometry::Geometry, settings: &gpu::Settings, path: &Path) {
    let t0 = Instant::now();
    let (width, height) = (geo.lightmap_width as usize, geo.lightmap_height as usize);
    let n = geo.page_size as usize;
    let mut lightmap = vec![0u32; width * height];
    for page in 0..geo.pages() {
        let t = Instant::now();
        let texels = raster::rasterize(geo, page);
        if texels.texels.is_empty() {
            continue;
        }
        println!(
            "lightmap page {page}: {} texels ({:.1} %), raster {:.1} s",
            texels.texels.len(),
            100.0 * texels.texels.len() as f32 / (n * n) as f32,
            t.elapsed().as_secs_f32()
        );
        let colors = gpu.bake(&texels, geo.page_size, settings);

        let t = Instant::now();
        let mut dense = vec![Vec3::ZERO; n * n];
        let mut filled = vec![false; n * n];
        for (tx, c) in texels.texels.iter().zip(&colors) {
            dense[tx.texel as usize] = Vec3::new(c[0], c[1], c[2]);
            filled[tx.texel as usize] = true;
        }
        post::dilate(&mut dense, &mut filled, n, 4);
        let (ox, oy) = geo.page_origin(page);
        for y in 0..n {
            let row = (oy as usize + y) * width + ox as usize;
            for x in 0..n {
                lightmap[row + x] = post::encode_rgb9e5(dense[y * n + x]);
            }
        }
        println!("  dilate + encode {:.1} s", t.elapsed().as_secs_f32());
    }
    std::fs::write(path, bytemuck::cast_slice::<u32, u8>(&lightmap)).expect("write lightmap");
    println!(
        "lightmap: {width}x{height}, {} spp in {:.1} s",
        settings.samples,
        t0.elapsed().as_secs_f32()
    );
}

/// Writes assets/probes/probe_NN.rgba16f (6 faces of face² RGBA float16 in Bevy's layout) and
/// assets/probes/probes.json.
fn bake_probes(gpu: &gpu::Gpu, boxes: &[scene_file::ProbeBox], face: u32, settings: &gpu::Settings, root: &Path) {
    // PROBE_OUT=dir writes the cubemaps elsewhere, and ONLY_PROBES=0,3 bakes a subset; both
    // are for experiments.
    let dir = std::env::var("PROBE_OUT").map_or(root.join("probes"), std::path::PathBuf::from);
    std::fs::create_dir_all(&dir).expect("probe directory");
    let only: Option<Vec<usize>> =
        std::env::var("ONLY_PROBES").ok().map(|v| v.split(',').map(|i| i.parse().expect("ONLY_PROBES=0,3")).collect());
    let mut index = Vec::new();
    for (i, b) in boxes.iter().enumerate() {
        if only.as_ref().is_some_and(|o| !o.contains(&i)) {
            continue;
        }
        let t = Instant::now();
        // PROBE_CENTER=x,y,z moves the capture point, to compare one view with Cycles.
        let center = std::env::var("PROBE_CENTER").map_or(b.center, |v| {
            let c: Vec<f32> = v.split(',').map(|x| x.parse().expect("PROBE_CENTER=x,y,z")).collect();
            [c[0], c[1], c[2]]
        });
        let texels = gpu.bake_probe(center, face, settings);
        let halves: Vec<half::f16> = texels.iter().flatten().map(|&v| half::f16::from_f32(v)).collect();
        let name = format!("probe_{i:02}.rgba16f");
        std::fs::write(dir.join(&name), bytemuck::cast_slice::<half::f16, u8>(&halves)).expect("write probe");
        let mean = texels.iter().fold(Vec3::ZERO, |a, c| a + Vec3::new(c[0], c[1], c[2])) / texels.len() as f32;
        println!("probe {i}: mean radiance {:.4} ({:.1} s)", mean, t.elapsed().as_secs_f32());
        index.push(serde_json::json!({
            "file": format!("probes/{name}"),
            "face_size": face,
            "center": b.center,
            "size": b.size,
        }));
    }
    if only.is_some() {
        return;
    }
    let text = serde_json::to_string_pretty(&index).unwrap();
    std::fs::write(dir.join("probes.json"), text).expect("probes.json");
}
