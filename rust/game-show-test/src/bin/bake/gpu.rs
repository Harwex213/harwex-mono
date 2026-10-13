//! Headless wgpu: the scene buffers, one BLAS per primitive, one TLAS, and the bake passes:
//! lightmap pages (`bake`) and reflection probes (`bake_probe`).

use std::time::Instant;

use wgpu::util::DeviceExt;

use crate::geometry::Geometry;
use crate::lights::LightSet;
use crate::materials::{LAYER_SIZE, Materials, NORMAL_SIZE};
use crate::raster::PageTexels;

/// Uniforms of trace.wgsl and filter.wgsl, 96 bytes.
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Params {
    texel_count: u32,
    sample_base: u32,
    samples: u32,
    light_count: u32,
    max_bounces: u32,
    groups_x: u32,
    filter_step: u32,
    /// Lightmap page size in texels.
    atlas_size: u32,
    background: [f32; 3],
    clamp_indirect: f32,
    probe_center: [f32; 3],
    face_size: u32,
    haze_scatter: [f32; 3],
    haze_g: f32,
    haze_extinction: f32,
    _unused: u32,
    _pad: [f32; 2],
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct GpuPrim {
    first_index: u32,
    first_vertex: u32,
    material: u32,
    flags: u32,
}

pub struct Settings {
    pub samples: u32,
    pub max_bounces: u32,
    pub clamp_indirect: f32,
    pub background: [f32; 3],
    pub filter_passes: u32,
    /// The world haze for the probe bake: scattering coefficient per metre (RGB), the
    /// Henyey-Greenstein anisotropy and the extinction coefficient per metre.
    pub haze_scatter: [f32; 3],
    pub haze_g: f32,
    pub haze_extinction: f32,
    /// Moves texels out of solids before tracing (off by default, see trace.wgsl `fixup`).
    pub fixup: bool,
}

pub struct Gpu {
    device: wgpu::Device,
    queue: wgpu::Queue,
    params: wgpu::Buffer,
    scene_entries: Vec<(u32, wgpu::Buffer)>,
    tlas: wgpu::Tlas,
    _blas: Vec<wgpu::Blas>,
    layers: wgpu::TextureView,
    normal_maps: wgpu::TextureView,
    /// The baked lightmap for the probe bake; a 1 × 1 placeholder before that.
    lightmap: wgpu::TextureView,
    sampler: wgpu::Sampler,
    trace_layout: wgpu::BindGroupLayout,
    filter_layout: wgpu::BindGroupLayout,
    fixup: wgpu::ComputePipeline,
    trace: wgpu::ComputePipeline,
    probe: wgpu::ComputePipeline,
    haze: wgpu::ComputePipeline,
    resolve: wgpu::ComputePipeline,
    atrous: wgpu::ComputePipeline,
    light_count: u32,
}

fn storage_entry(binding: u32, read_only: bool) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::COMPUTE,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Storage { read_only },
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

fn uniform_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::COMPUTE,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Uniform,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

fn groups(count: u32) -> (u32, u32) {
    let total = count.div_ceil(64).max(1);
    let x = total.min(65535);
    (x, total.div_ceil(x))
}

impl Gpu {
    pub fn new(geo: &Geometry, materials: &Materials, lights: &LightSet) -> Gpu {
        let t = Instant::now();
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
        let adapter = futures_lite::future::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            ..Default::default()
        }))
        .expect("no GPU adapter");
        let features = wgpu::Features::EXPERIMENTAL_RAY_QUERY;
        assert!(adapter.features().contains(features), "the adapter has no ray queries: {:?}", adapter.get_info());
        let (device, queue) = futures_lite::future::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("bake"),
            required_features: features,
            required_limits: adapter.limits(),
            // SAFETY: ray queries are an experimental wgpu feature; the bake accepts its bugs.
            experimental_features: unsafe { wgpu::ExperimentalFeatures::enabled() },
            memory_hints: wgpu::MemoryHints::Performance,
            trace: wgpu::Trace::Off,
        }))
        .expect("request_device");
        println!("gpu: {} ({:?})", adapter.get_info().name, adapter.get_info().backend);

        let init = |label: &str, contents: &[u8], usage: wgpu::BufferUsages| {
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some(label), contents, usage })
        };
        let storage = wgpu::BufferUsages::STORAGE;
        let positions = init("positions", bytemuck::cast_slice(&geo.pos), storage | wgpu::BufferUsages::BLAS_INPUT);
        let normals = init("normals", bytemuck::cast_slice(&geo.normal), storage);
        let uvs = init("uvs", bytemuck::cast_slice(&geo.uv0), storage);
        let uvs1 = init("lightmap uvs", bytemuck::cast_slice(&geo.uv1), storage);
        let indices = init("indices", bytemuck::cast_slice(&geo.indices), storage | wgpu::BufferUsages::BLAS_INPUT);
        let prims: Vec<GpuPrim> = geo
            .prims
            .iter()
            .map(|p| GpuPrim {
                first_index: p.first_index,
                first_vertex: p.first_vertex,
                material: p.material,
                flags: 0,
            })
            .collect();
        let prims_buf = init("prims", bytemuck::cast_slice(&prims), storage);
        let materials_buf = init("materials", bytemuck::cast_slice(&materials.gpu), storage);
        // Empty arrays cannot be bound: pad with one zeroed element.
        let nonempty = |v: &[u8], size: usize| if v.is_empty() { vec![0u8; size] } else { v.to_vec() };
        let lights_buf = init("lights", &nonempty(bytemuck::cast_slice(&lights.lights), 80), storage);
        let emitters_buf = init("emitters", &nonempty(bytemuck::cast_slice(&lights.emitters), 80), storage);
        let nodes_buf = init("nodes", bytemuck::cast_slice(&lights.nodes), storage);

        // Material layers.
        let layer_count = materials.layers.len().max(1) as u32;
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("layers"),
            size: wgpu::Extent3d { width: LAYER_SIZE, height: LAYER_SIZE, depth_or_array_layers: layer_count },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba16Float,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        for (i, layer) in materials.layers.iter().enumerate() {
            let data: Vec<half::f16> =
                layer.iter().flat_map(|v| v.to_array()).map(half::f16::from_f32).collect();
            queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d { x: 0, y: 0, z: i as u32 },
                    aspect: wgpu::TextureAspect::All,
                },
                bytemuck::cast_slice(&data),
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(LAYER_SIZE * 8),
                    rows_per_image: Some(LAYER_SIZE),
                },
                wgpu::Extent3d { width: LAYER_SIZE, height: LAYER_SIZE, depth_or_array_layers: 1 },
            );
        }
        let layers = texture.create_view(&wgpu::TextureViewDescriptor {
            dimension: Some(wgpu::TextureViewDimension::D2Array),
            ..Default::default()
        });
        // Normal maps: full resolution, 8 bits, no color conversion.
        let normal_count = materials.normal_maps.len().max(1) as u32;
        let normal_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("normal maps"),
            size: wgpu::Extent3d { width: NORMAL_SIZE, height: NORMAL_SIZE, depth_or_array_layers: normal_count },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        for (i, map) in materials.normal_maps.iter().enumerate() {
            queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &normal_texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d { x: 0, y: 0, z: i as u32 },
                    aspect: wgpu::TextureAspect::All,
                },
                map,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(NORMAL_SIZE * 4),
                    rows_per_image: Some(NORMAL_SIZE),
                },
                wgpu::Extent3d { width: NORMAL_SIZE, height: NORMAL_SIZE, depth_or_array_layers: 1 },
            );
        }
        let normal_maps = normal_texture.create_view(&wgpu::TextureViewDescriptor {
            dimension: Some(wgpu::TextureViewDimension::D2Array),
            ..Default::default()
        });
        let lightmap = lightmap_texture(&device, &queue, &0u32.to_le_bytes(), 1, 1);
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            address_mode_u: wgpu::AddressMode::Repeat,
            address_mode_v: wgpu::AddressMode::Repeat,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        // One BLAS per primitive; alpha-masked ones are not opaque, so rays see candidates.
        let sizes: Vec<wgpu::BlasTriangleGeometrySizeDescriptor> = geo
            .prims
            .iter()
            .map(|p| wgpu::BlasTriangleGeometrySizeDescriptor {
                vertex_format: wgpu::VertexFormat::Float32x3,
                vertex_count: p.vertex_count,
                index_format: Some(wgpu::IndexFormat::Uint32),
                index_count: Some(p.index_count),
                flags: if materials.gpu[p.material as usize].alpha_cutoff > 0.0 {
                    wgpu::AccelerationStructureGeometryFlags::empty()
                } else {
                    wgpu::AccelerationStructureGeometryFlags::OPAQUE
                },
            })
            .collect();
        let blas: Vec<wgpu::Blas> = sizes
            .iter()
            .map(|s| {
                device.create_blas(
                    &wgpu::CreateBlasDescriptor {
                        label: None,
                        flags: wgpu::AccelerationStructureFlags::PREFER_FAST_TRACE,
                        update_mode: wgpu::AccelerationStructureUpdateMode::Build,
                    },
                    wgpu::BlasGeometrySizeDescriptors::Triangles { descriptors: vec![s.clone()] },
                )
            })
            .collect();
        let mut tlas = device.create_tlas(&wgpu::CreateTlasDescriptor {
            label: Some("tlas"),
            max_instances: blas.len() as u32,
            flags: wgpu::AccelerationStructureFlags::PREFER_FAST_TRACE,
            update_mode: wgpu::AccelerationStructureUpdateMode::Build,
        });
        const IDENTITY: [f32; 12] = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        for (i, b) in blas.iter().enumerate() {
            // The custom index is the primitive: trace.wgsl reads prims[instance_custom_data].
            tlas[i] = Some(wgpu::TlasInstance::new(b, IDENTITY, i as u32, 0xff));
        }
        let entries: Vec<wgpu::BlasBuildEntry> = geo
            .prims
            .iter()
            .zip(&blas)
            .zip(&sizes)
            .map(|((p, b), s)| wgpu::BlasBuildEntry {
                blas: b,
                geometry: wgpu::BlasGeometries::TriangleGeometries(vec![wgpu::BlasTriangleGeometry {
                    size: s,
                    vertex_buffer: &positions,
                    first_vertex: p.first_vertex,
                    vertex_stride: 16,
                    index_buffer: Some(&indices),
                    first_index: Some(p.first_index),
                    transform_buffer: None,
                    transform_buffer_offset: None,
                }]),
            })
            .collect();
        let mut encoder = device.create_command_encoder(&Default::default());
        encoder.build_acceleration_structures(&entries, [&tlas]);
        queue.submit([encoder.finish()]);
        device.poll(wgpu::PollType::wait_indefinitely()).expect("poll");
        drop(entries);
        println!("gpu: {} BLAS + TLAS built in {:.2} s", blas.len(), t.elapsed().as_secs_f32());

        let params = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("params"),
            size: std::mem::size_of::<Params>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let mut trace_entries = vec![uniform_entry(0)];
        trace_entries.push(wgpu::BindGroupLayoutEntry {
            binding: 1,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::AccelerationStructure { vertex_return: false },
            count: None,
        });
        trace_entries.push(storage_entry(2, false));
        trace_entries.push(storage_entry(3, false));
        for b in 4..=12 {
            trace_entries.push(storage_entry(b, true));
        }
        trace_entries.push(wgpu::BindGroupLayoutEntry {
            binding: 13,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: wgpu::TextureViewDimension::D2Array,
                multisampled: false,
            },
            count: None,
        });
        trace_entries.push(wgpu::BindGroupLayoutEntry {
            binding: 14,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
            count: None,
        });
        trace_entries.push(wgpu::BindGroupLayoutEntry {
            binding: 15,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: wgpu::TextureViewDimension::D2Array,
                multisampled: false,
            },
            count: None,
        });
        trace_entries.push(wgpu::BindGroupLayoutEntry {
            binding: 16,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        });
        trace_entries.push(storage_entry(17, true));
        let trace_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("trace"),
            entries: &trace_entries,
        });
        let filter_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("filter"),
            entries: &[uniform_entry(0), storage_entry(1, true), storage_entry(2, true), storage_entry(3, true), storage_entry(4, false)],
        });

        // Bounds checks and ray query tracking cost time in the inner loops; the shaders
        // index only buffers they built themselves.
        let checks = wgpu::ShaderRuntimeChecks {
            bounds_checks: false,
            force_loop_bounding: false,
            ray_query_initialization_tracking: false,
            ..wgpu::ShaderRuntimeChecks::checked()
        };
        // SAFETY: see above. The ray queries are initialized before every use.
        let trace_module = unsafe {
            device.create_shader_module_trusted(
                wgpu::ShaderModuleDescriptor {
                    label: Some("trace.wgsl"),
                    source: wgpu::ShaderSource::Wgsl(include_str!("trace.wgsl").into()),
                },
                checks,
            )
        };
        let filter_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("filter.wgsl"),
            source: wgpu::ShaderSource::Wgsl(include_str!("filter.wgsl").into()),
        });
        let pipeline = |layout: &wgpu::BindGroupLayout, module: &wgpu::ShaderModule, entry: &str| {
            let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some(entry),
                bind_group_layouts: &[Some(layout)],
                immediate_size: 0,
            });
            device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some(entry),
                layout: Some(&pl),
                module,
                entry_point: Some(entry),
                compilation_options: Default::default(),
                cache: None,
            })
        };
        let fixup = pipeline(&trace_layout, &trace_module, "fixup");
        let trace = pipeline(&trace_layout, &trace_module, "trace_texels");
        let probe = pipeline(&trace_layout, &trace_module, "trace_probe");
        let haze = pipeline(&trace_layout, &trace_module, "trace_haze");
        let resolve = pipeline(&filter_layout, &filter_module, "resolve");
        let atrous = pipeline(&filter_layout, &filter_module, "atrous");

        let scene_entries = vec![
            (4, positions),
            (5, normals),
            (6, uvs),
            (7, indices),
            (8, prims_buf),
            (9, materials_buf),
            (10, lights_buf),
            (11, emitters_buf),
            (12, nodes_buf),
            (17, uvs1),
        ];
        Gpu {
            device,
            queue,
            params,
            scene_entries,
            tlas,
            _blas: blas,
            layers,
            normal_maps,
            lightmap,
            sampler,
            trace_layout,
            filter_layout,
            fixup,
            trace,
            probe,
            haze,
            resolve,
            atrous,
            light_count: lights.lights.len() as u32,
        }
    }

    /// Binds the baked lightmap (Rgb9e5 texels, rows from the top) for the probe bake.
    pub fn set_lightmap(&mut self, data: &[u8], width: u32, height: u32) {
        self.lightmap = lightmap_texture(&self.device, &self.queue, data, width, height);
    }

    fn trace_group(&self, texels: &wgpu::Buffer, accum: &wgpu::Buffer) -> wgpu::BindGroup {
        let mut entries = vec![
            wgpu::BindGroupEntry { binding: 0, resource: self.params.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 1, resource: self.tlas.as_binding() },
            wgpu::BindGroupEntry { binding: 2, resource: texels.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 3, resource: accum.as_entire_binding() },
        ];
        for (b, buf) in &self.scene_entries {
            entries.push(wgpu::BindGroupEntry { binding: *b, resource: buf.as_entire_binding() });
        }
        entries.push(wgpu::BindGroupEntry { binding: 13, resource: wgpu::BindingResource::TextureView(&self.layers) });
        entries.push(wgpu::BindGroupEntry { binding: 14, resource: wgpu::BindingResource::Sampler(&self.sampler) });
        entries.push(wgpu::BindGroupEntry { binding: 15, resource: wgpu::BindingResource::TextureView(&self.normal_maps) });
        entries.push(wgpu::BindGroupEntry { binding: 16, resource: wgpu::BindingResource::TextureView(&self.lightmap) });
        self.device.create_bind_group(&wgpu::BindGroupDescriptor { label: Some("trace"), layout: &self.trace_layout, entries: &entries })
    }

    /// Accumulates `samples` samples per thread in short dispatches. Metal kills a command
    /// buffer that runs for seconds, so the batch size adapts to about a quarter second.
    /// Returns the number of dispatches.
    fn accumulate(&self, pipeline: &wgpu::ComputePipeline, group: &wgpu::BindGroup, base: Params, samples: u32) -> u32 {
        let mut done = 0;
        let mut batch = 1;
        let mut dispatches = 0;
        while done < samples {
            let k = batch.min(samples - done);
            let d = Instant::now();
            self.run(pipeline, group, Params { sample_base: done, samples: k, ..base });
            let ms = d.elapsed().as_secs_f32() * 1000.0;
            done += k;
            dispatches += 1;
            if ms * 2.0 < 250.0 && batch < 64 {
                batch *= 2;
            } else if ms > 600.0 && batch > 1 {
                batch /= 2;
            }
        }
        dispatches
    }

    /// Renders one probe cubemap: 6 faces of `face_size`² texels in Bevy's layout. Returns
    /// the mean radiance per texel, faces one after the other, rows from the top.
    pub fn bake_probe(&self, center: [f32; 3], face_size: u32, s: &Settings) -> Vec<[f32; 4]> {
        let mut texels = self.probe_pass(&self.probe, center, face_size, s);
        if s.haze_extinction > 0.0 {
            // The haze glow at an eighth of the resolution, with as many samples per texel.
            let small = (face_size / HAZE_SCALE).max(1);
            let haze = self.probe_pass(&self.haze, center, small, s);
            add_upsampled(&mut texels, face_size, &haze, small);
        }
        texels
    }

    fn probe_pass(&self, pipeline: &wgpu::ComputePipeline, center: [f32; 3], face_size: u32, s: &Settings) -> Vec<[f32; 4]> {
        let count = 6 * face_size * face_size;
        let size = count as u64 * 16;
        let accum = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("probe accum"),
            size,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        // The probe kernels read no texels; the binding still needs a buffer.
        let texels = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("no texels"),
            size: 80,
            usage: wgpu::BufferUsages::STORAGE,
            mapped_at_creation: false,
        });
        let group = self.trace_group(&texels, &accum);
        let base = Params {
            texel_count: count,
            sample_base: 0,
            samples: 0,
            light_count: self.light_count,
            max_bounces: s.max_bounces,
            groups_x: groups(count).0,
            filter_step: 1,
            atlas_size: 0,
            background: s.background,
            clamp_indirect: s.clamp_indirect,
            probe_center: center,
            face_size,
            haze_scatter: s.haze_scatter,
            haze_g: s.haze_g,
            haze_extinction: s.haze_extinction,
            _unused: 0,
            _pad: [0.0; 2],
        };
        self.accumulate(pipeline, &group, base, s.samples);
        let inv = 1.0 / s.samples as f32;
        self.read(&accum, size).into_iter().map(|c| [c[0] * inv, c[1] * inv, c[2] * inv, 1.0]).collect()
    }

    fn run(&self, pipeline: &wgpu::ComputePipeline, bind_group: &wgpu::BindGroup, params: Params) {
        self.queue.write_buffer(&self.params, 0, bytemuck::bytes_of(&params));
        let mut encoder = self.device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_compute_pass(&Default::default());
            pass.set_pipeline(pipeline);
            pass.set_bind_group(0, bind_group, &[]);
            pass.dispatch_workgroups(params.groups_x, groups(params.texel_count).1, 1);
        }
        self.queue.submit([encoder.finish()]);
        self.device.poll(wgpu::PollType::wait_indefinitely()).expect("GPU fault");
    }

    /// Bakes one lightmap page. Returns the filtered color per texel of `page.texels`.
    pub fn bake(&self, page: &PageTexels, size: u32, s: &Settings) -> Vec<[f32; 4]> {
        let count = page.texels.len() as u32;
        let storage = wgpu::BufferUsages::STORAGE;
        let texels = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("texels"),
            contents: bytemuck::cast_slice(&page.texels),
            usage: storage,
        });
        let map = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("texel map"),
            contents: bytemuck::cast_slice(&page.map),
            usage: storage,
        });
        let color_size = count as u64 * 16;
        let color = |label| {
            self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(label),
                size: color_size,
                usage: storage | wgpu::BufferUsages::COPY_SRC | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            })
        };
        let accum = color("accum");
        let ping = color("ping");
        let pong = color("pong");

        let trace_group = self.trace_group(&texels, &accum);
        let filter_group = |input: &wgpu::Buffer, output: &wgpu::Buffer| {
            self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("filter"),
                layout: &self.filter_layout,
                entries: &[
                    wgpu::BindGroupEntry { binding: 0, resource: self.params.as_entire_binding() },
                    wgpu::BindGroupEntry { binding: 1, resource: texels.as_entire_binding() },
                    wgpu::BindGroupEntry { binding: 2, resource: map.as_entire_binding() },
                    wgpu::BindGroupEntry { binding: 3, resource: input.as_entire_binding() },
                    wgpu::BindGroupEntry { binding: 4, resource: output.as_entire_binding() },
                ],
            })
        };

        let base = Params {
            texel_count: count,
            sample_base: 0,
            samples: 0,
            light_count: self.light_count,
            max_bounces: s.max_bounces,
            groups_x: groups(count).0,
            filter_step: if std::env::var("UNIFORM_LIGHTS").is_ok() { 7 } else { 1 },
            atlas_size: size,
            background: s.background,
            clamp_indirect: s.clamp_indirect,
            probe_center: [0.0; 3],
            face_size: 0,
            haze_scatter: [0.0; 3],
            haze_g: 0.0,
            haze_extinction: 0.0,
            _unused: 0,
            _pad: [0.0; 2],
        };

        if s.fixup {
            let t = Instant::now();
            self.run(&self.fixup, &trace_group, base);
            println!("  fixup {:.2} s", t.elapsed().as_secs_f32());
        }

        let t = Instant::now();
        let dispatches = self.accumulate(&self.trace, &trace_group, base, s.samples);
        let trace_s = t.elapsed().as_secs_f32();
        println!(
            "  trace {} spp in {:.1} s ({} dispatches, {:.1} M texel-samples/s)",
            s.samples,
            trace_s,
            dispatches,
            count as f32 * s.samples as f32 / trace_s / 1e6
        );

        let t = Instant::now();
        self.run(&self.resolve, &filter_group(&accum, &ping), Params { samples: s.samples, filter_step: 1, ..base });
        let mut src = &ping;
        let mut dst = &pong;
        for pass in 0..s.filter_passes {
            self.run(&self.atrous, &filter_group(src, dst), Params { filter_step: 1 << pass, ..base });
            std::mem::swap(&mut src, &mut dst);
        }
        println!("  filter {} passes in {:.2} s", s.filter_passes, t.elapsed().as_secs_f32());
        self.read(src, color_size)
    }

    fn read(&self, buffer: &wgpu::Buffer, size: u64) -> Vec<[f32; 4]> {
        let staging = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("readback"),
            size,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let mut encoder = self.device.create_command_encoder(&Default::default());
        encoder.copy_buffer_to_buffer(buffer, 0, &staging, 0, size);
        self.queue.submit([encoder.finish()]);
        staging.slice(..).map_async(wgpu::MapMode::Read, |r| r.expect("map"));
        self.device.poll(wgpu::PollType::wait_indefinitely()).expect("poll");
        let data = bytemuck::cast_slice::<u8, [f32; 4]>(&staging.slice(..).get_mapped_range().expect("mapped")).to_vec();
        staging.unmap();
        data
    }
}

/// The haze texels of a probe cover HAZE_SCALE² probe texels.
const HAZE_SCALE: u32 = 8;

/// Adds a low-resolution cubemap to a full one, bilinearly per face.
fn add_upsampled(full: &mut [[f32; 4]], n: u32, small: &[[f32; 4]], m: u32) {
    let (n, m) = (n as usize, m as usize);
    let scale = m as f32 / n as f32;
    for face in 0..6 {
        let src = &small[face * m * m..(face + 1) * m * m];
        for y in 0..n {
            let fy = ((y as f32 + 0.5) * scale - 0.5).clamp(0.0, (m - 1) as f32);
            let (y0, ty) = (fy.floor() as usize, fy.fract());
            let y1 = (y0 + 1).min(m - 1);
            for x in 0..n {
                let fx = ((x as f32 + 0.5) * scale - 0.5).clamp(0.0, (m - 1) as f32);
                let (x0, tx) = (fx.floor() as usize, fx.fract());
                let x1 = (x0 + 1).min(m - 1);
                let dst = &mut full[face * n * n + y * n + x];
                for c in 0..3 {
                    let top = src[y0 * m + x0][c] * (1.0 - tx) + src[y0 * m + x1][c] * tx;
                    let bottom = src[y1 * m + x0][c] * (1.0 - tx) + src[y1 * m + x1][c] * tx;
                    dst[c] += top * (1.0 - ty) + bottom * ty;
                }
            }
        }
    }
}

fn lightmap_texture(device: &wgpu::Device, queue: &wgpu::Queue, data: &[u8], width: u32, height: u32) -> wgpu::TextureView {
    let size = wgpu::Extent3d { width, height, depth_or_array_layers: 1 };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("lightmap"),
        size,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgb9e5Ufloat,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    queue.write_texture(
        wgpu::TexelCopyTextureInfo { texture: &texture, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
        data,
        wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(width * 4), rows_per_image: Some(height) },
        size,
    );
    texture.create_view(&Default::default())
}
