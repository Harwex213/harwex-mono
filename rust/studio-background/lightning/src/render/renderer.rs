use std::time::Instant;

use bytemuck::{Pod, Zeroable};
use crate::art::bolt_atlas::draw_bolt_atlas;
use crate::art::glyph_atlas::draw_glyph_atlas;
use crate::art::plate_masks::build_plate_masks;
use crate::art::Rgba;
use crate::scene::board::{build_tiles, Tile, GLYPH_COLS, GLYPH_ROWS, SCREEN_ASPECT};
use crate::scene::calibration::{
    DOWNLIGHTS, FLOOR_VANISH, FLOOR_Y, HORIZON_Y, IMAGE_HEIGHT, IMAGE_WIDTH, MIRROR_Y, PILLARS, SCREEN_CORNERS,
    SCREEN_PIXEL_WIDTH,
};
use crate::scene::homography::{invert, square_to_quad, to_column_major};
use crate::scene::lightning::{LightningDirector, ATLAS_COLS, ATLAS_ROWS};

use crate::render::gpu::{self, MipGenerator, RenderTarget, Texture, TARGET_FORMAT};
use crate::render::shaders;

const PLATE_PNG: &[u8] = include_bytes!("../../assets/plate.png");
const CLOUDS_PNG: &[u8] = include_bytes!("../../assets/night-clouds.png");

const MAX_BOLTS: usize = 16;
const IMAGE_ASPECT: f64 = IMAGE_WIDTH / IMAGE_HEIGHT;
// Per tile instance: rect (4), info (4), state (4), discharge (1).
const TILE_FLOATS: usize = 13;
// Per bolt instance: rect (4), sprite, flip, intensity.
const SPRITE_FLOATS: usize = 7;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct ContentUniforms {
    res: [f32; 2],
    time: f32,
    aspect: f32,
    sheet: [f32; 4],
    bolt_count: i32,
    pad: [i32; 3],
    bolts: [[f32; 4]; MAX_BOLTS],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct SpriteUniforms {
    atlas_grid: [f32; 2],
    pad: [f32; 2],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct TileUniforms {
    aspect: f32,
    time: f32,
    glyph_grid: [f32; 2],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct CompositeUniforms {
    to_screen: [[f32; 4]; 3],
    cover: [f32; 4],
    rect: [f32; 4],
    flash: [f32; 4],
    res: [f32; 2],
    time: f32,
    levels: f32,
    vanish: [f32; 2],
    horizon: f32,
    mirror_y: f32,
    floor_y: f32,
    image_aspect: f32,
    screen_aspect: f32,
    debug: f32,
    energy: f32,
    sweep: f32,
    pad: [f32; 2],
    pillar_shaft: [[f32; 4]; 4],
    pillar_column: [[f32; 4]; 4],
    pillar_base: [f32; 4],
    pillars: [f32; 4],
    downlights: [[f32; 4]; 4],
}

fn decode_png(bytes: &[u8]) -> Rgba {
    let image = image::load_from_memory(bytes).expect("bundled PNG decodes").to_rgba8();
    let (width, height) = image.dimensions();
    Rgba { data: image.into_raw(), width, height }
}

fn uniform_buffer(device: &wgpu::Device, label: &str, size: usize) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor {
        label: Some(label),
        size: size as u64,
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    })
}

struct PipelineSpec<'a> {
    label: &'a str,
    source: String,
    format: wgpu::TextureFormat,
    blend: Option<wgpu::BlendState>,
    buffers: &'a [wgpu::VertexBufferLayout<'a>],
    topology: wgpu::PrimitiveTopology,
}

fn pipeline(device: &wgpu::Device, spec: PipelineSpec) -> wgpu::RenderPipeline {
    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some(spec.label),
        source: wgpu::ShaderSource::Wgsl(spec.source.into()),
    });
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(spec.label),
        layout: None,
        vertex: wgpu::VertexState {
            module: &module,
            entry_point: Some("vs"),
            compilation_options: Default::default(),
            buffers: spec.buffers,
        },
        fragment: Some(wgpu::FragmentState {
            module: &module,
            entry_point: Some("fs"),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format: spec.format,
                blend: spec.blend,
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        primitive: wgpu::PrimitiveState { topology: spec.topology, ..Default::default() },
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        multiview: None,
        cache: None,
    })
}

fn texture_bind_group(
    device: &wgpu::Device,
    pipeline: &wgpu::RenderPipeline,
    uniforms: &wgpu::Buffer,
    view: &wgpu::TextureView,
    sampler: &wgpu::Sampler,
) -> wgpu::BindGroup {
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: None,
        layout: &pipeline.get_bind_group_layout(0),
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: uniforms.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(view) },
            wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(sampler) },
        ],
    })
}

fn vec4(values: [f64; 4]) -> [f32; 4] {
    values.map(|v| v as f32)
}

pub struct StudioRenderer {
    content: wgpu::RenderPipeline,
    sprite: wgpu::RenderPipeline,
    tile: wgpu::RenderPipeline,
    composite: wgpu::RenderPipeline,
    mips: MipGenerator,
    studio: Texture,
    masks: Texture,
    content_uniforms: wgpu::Buffer,
    sprite_uniforms: wgpu::Buffer,
    tile_uniforms: wgpu::Buffer,
    composite_uniforms: wgpu::Buffer,
    content_group: wgpu::BindGroup,
    sprite_group: wgpu::BindGroup,
    tile_group: wgpu::BindGroup,
    composite_group: Option<wgpu::BindGroup>,
    image_sampler: wgpu::Sampler,
    content_sampler: wgpu::Sampler,
    masks_sampler: wgpu::Sampler,
    target: Option<RenderTarget>,
    sprite_buffer: wgpu::Buffer,
    tile_buffer: wgpu::Buffer,
    tiles: Vec<Tile>,
    tile_data: Vec<f32>,
    sprite_data: Vec<f32>,
    director: LightningDirector,
    to_screen: [f32; 9],
    start: Instant,
    // Dev hook: when set, the clock is frozen at this time in seconds.
    frozen_at: Option<f64>,
    debug: bool,
}

impl StudioRenderer {
    // `output_format` is the format of the views passed to `frame`. Pick a non-sRGB format: the
    // composite writes display values itself, as WebGL does.
    pub fn new(device: &wgpu::Device, queue: &wgpu::Queue, output_format: wgpu::TextureFormat) -> Self {
        let start = Instant::now();
        let mips = MipGenerator::new(device);

        let content = pipeline(
            device,
            PipelineSpec {
                label: "content",
                source: shaders::content(),
                format: TARGET_FORMAT,
                blend: None,
                buffers: &[],
                topology: wgpu::PrimitiveTopology::TriangleList,
            },
        );
        let sprite_attributes = wgpu::vertex_attr_array![0 => Float32x4, 1 => Float32x3];
        let sprite = pipeline(
            device,
            PipelineSpec {
                label: "sprite",
                source: shaders::sprite(),
                format: TARGET_FORMAT,
                blend: Some(wgpu::BlendState {
                    color: wgpu::BlendComponent { src_factor: wgpu::BlendFactor::One, dst_factor: wgpu::BlendFactor::One, operation: wgpu::BlendOperation::Add },
                    alpha: wgpu::BlendComponent { src_factor: wgpu::BlendFactor::One, dst_factor: wgpu::BlendFactor::One, operation: wgpu::BlendOperation::Add },
                }),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: (SPRITE_FLOATS * 4) as u64,
                    step_mode: wgpu::VertexStepMode::Instance,
                    attributes: &sprite_attributes,
                }],
                topology: wgpu::PrimitiveTopology::TriangleStrip,
            },
        );
        let tile_attributes = wgpu::vertex_attr_array![0 => Float32x4, 1 => Float32x4, 2 => Float32x4, 3 => Float32];
        // Tiles are premultiplied: coverage in alpha, glows added on top.
        let tile = pipeline(
            device,
            PipelineSpec {
                label: "tile",
                source: shaders::tile(),
                format: TARGET_FORMAT,
                blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: (TILE_FLOATS * 4) as u64,
                    step_mode: wgpu::VertexStepMode::Instance,
                    attributes: &tile_attributes,
                }],
                topology: wgpu::PrimitiveTopology::TriangleStrip,
            },
        );
        let composite = pipeline(
            device,
            PipelineSpec {
                label: "composite",
                source: shaders::composite(),
                format: output_format,
                blend: None,
                buffers: &[],
                topology: wgpu::PrimitiveTopology::TriangleList,
            },
        );

        let plate = decode_png(PLATE_PNG);
        let clouds = decode_png(CLOUDS_PNG);
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("upload") });
        let studio = gpu::create_texture(device, queue, &mut encoder, &mips, &plate, true);
        let masks = gpu::create_texture(device, queue, &mut encoder, &mips, &build_plate_masks(&plate.data, plate.width, plate.height), true);
        let clouds = gpu::create_texture(device, queue, &mut encoder, &mips, &clouds, true);
        let glyphs = gpu::create_texture(device, queue, &mut encoder, &mips, &draw_glyph_atlas(), true);
        let atlas = gpu::create_texture(device, queue, &mut encoder, &mips, &draw_bolt_atlas(), true);
        queue.submit([encoder.finish()]);

        let image_sampler = gpu::sampler(device, wgpu::AddressMode::ClampToEdge, 8);
        let clouds_sampler = gpu::sampler(device, wgpu::AddressMode::MirrorRepeat, 8);
        let content_sampler = gpu::sampler(device, wgpu::AddressMode::ClampToEdge, 1);
        let masks_sampler = gpu::sampler(device, wgpu::AddressMode::ClampToEdge, 1);

        let content_uniforms = uniform_buffer(device, "content", size_of::<ContentUniforms>());
        let sprite_uniforms = uniform_buffer(device, "sprite", size_of::<SpriteUniforms>());
        let tile_uniforms = uniform_buffer(device, "tile", size_of::<TileUniforms>());
        let composite_uniforms = uniform_buffer(device, "composite", size_of::<CompositeUniforms>());
        let content_group = texture_bind_group(device, &content, &content_uniforms, &clouds.view, &clouds_sampler);
        let sprite_group = texture_bind_group(device, &sprite, &sprite_uniforms, &atlas.view, &image_sampler);
        let tile_group = texture_bind_group(device, &tile, &tile_uniforms, &glyphs.view, &image_sampler);

        let tiles = build_tiles();
        let tile_data = vec![0.0; tiles.len() * TILE_FLOATS];
        let sprite_data = vec![0.0; MAX_BOLTS * SPRITE_FLOATS];
        let vertex_buffer = |label: &str, floats: usize| {
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(label),
                size: (floats * 4) as u64,
                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            })
        };
        let sprite_buffer = vertex_buffer("sprites", sprite_data.len());
        let tile_buffer = vertex_buffer("tiles", tile_data.len());

        let [c0, c1, c2, c3] = SCREEN_CORNERS;
        let to_screen = to_column_major(invert(square_to_quad(c0, c1, c2, c3)));

        let mut renderer = Self {
            content,
            sprite,
            tile,
            composite,
            mips,
            studio,
            masks,
            content_uniforms,
            sprite_uniforms,
            tile_uniforms,
            composite_uniforms,
            content_group,
            sprite_group,
            tile_group,
            composite_group: None,
            image_sampler,
            content_sampler,
            masks_sampler,
            target: None,
            sprite_buffer,
            tile_buffer,
            tiles,
            tile_data,
            sprite_data,
            director: LightningDirector::new(0.0),
            to_screen,
            start,
            frozen_at: None,
            debug: false,
        };
        renderer.director = LightningDirector::new(renderer.now());
        renderer
    }

    pub fn strike(&mut self) {
        let now = self.now();
        self.director.trigger(now);
    }

    // Freezes the clock at t seconds; None resumes real time.
    pub fn seek(&mut self, t: Option<f64>) {
        self.frozen_at = t;
    }

    // Calibration overlay: outlines the glass and the floor mirror line.
    pub fn toggle_debug(&mut self) {
        self.debug = !self.debug;
    }

    pub fn set_debug(&mut self, debug: bool) {
        self.debug = debug;
    }

    // Steps a fresh director from 0 to `until` the way frames at `step` seconds would.
    pub fn simulate(&mut self, until: f64, step: f64) {
        self.director = LightningDirector::new(0.0);
        self.simulate_from(0.0, until, step);
    }

    // Steps the current director from `from` to `until`.
    pub fn simulate_from(&mut self, from: f64, until: f64, step: f64) {
        let mut t = from;
        while t < until {
            self.director.update(t);
            t += step;
        }
    }

    pub fn now(&self) -> f64 {
        if let Some(t) = self.frozen_at {
            return t;
        }
        self.start.elapsed().as_secs_f64()
    }

    // Cover-fit the plate into the output: offset and scale from output UV to image UV.
    fn cover(width: u32, height: u32) -> [f64; 4] {
        let canvas_aspect = width as f64 / height as f64;
        if canvas_aspect > IMAGE_ASPECT {
            let sy = IMAGE_ASPECT / canvas_aspect;
            return [0.0, (1.0 - sy) / 2.0, 1.0, sy];
        }
        let sx = canvas_aspect / IMAGE_ASPECT;
        [(1.0 - sx) / 2.0, 0.0, sx, 1.0]
    }

    fn resize(&mut self, device: &wgpu::Device, width: u32, height: u32) {
        // The wall renders at the size it covers on screen, so it is as sharp as the plate around it.
        let [_, _, sx, _] = Self::cover(width, height);
        let on_screen = (SCREEN_PIXEL_WIDTH / IMAGE_WIDTH / sx) * width as f64;
        let target_w = (on_screen * 1.15).clamp(640.0, 2048.0).round();
        let target_h = (target_w / SCREEN_ASPECT).round();
        let stale = self.target.as_ref().is_none_or(|t| (t.width as f64 - target_w).abs() > 48.0);
        if stale {
            let target = gpu::create_render_target(device, target_w as u32, target_h as u32);
            self.composite_group = Some(device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("composite"),
                layout: &self.composite.get_bind_group_layout(0),
                entries: &[
                    wgpu::BindGroupEntry { binding: 0, resource: self.composite_uniforms.as_entire_binding() },
                    wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&self.studio.view) },
                    wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(&self.image_sampler) },
                    wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::TextureView(&target.view) },
                    wgpu::BindGroupEntry { binding: 4, resource: wgpu::BindingResource::Sampler(&self.content_sampler) },
                    wgpu::BindGroupEntry { binding: 5, resource: wgpu::BindingResource::TextureView(&self.masks.view) },
                    wgpu::BindGroupEntry { binding: 6, resource: wgpu::BindingResource::Sampler(&self.masks_sampler) },
                ],
            }));
            self.target = Some(target);
        }
    }

    // One frame into `output`, a view of `width` x `height` pixels.
    pub fn frame(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, output: &wgpu::TextureView, width: u32, height: u32) {
        if width == 0 || height == 0 {
            return;
        }
        self.resize(device, width, height);
        let now = self.now();
        self.director.update(now);
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("frame") });
        self.render_content(device, queue, &mut encoder, now);
        self.render_composite(queue, &mut encoder, output, width, height, now);
        queue.submit([encoder.finish()]);
    }

    fn render_content(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, encoder: &mut wgpu::CommandEncoder, now: f64) {
        let Some(target) = &self.target else {
            return;
        };
        let mut bolts = self.director.bolts(now);
        bolts.truncate(MAX_BOLTS);

        let sheet = self.director.sheet_flash(now);
        let mut uniforms = ContentUniforms {
            res: [target.width as f32, target.height as f32],
            time: now as f32,
            aspect: SCREEN_ASPECT as f32,
            sheet: [sheet[0] as f32, sheet[1] as f32, sheet[2] as f32, 0.0],
            bolt_count: bolts.len() as i32,
            pad: [0; 3],
            bolts: [[0.0; 4]; MAX_BOLTS],
        };
        for (i, bolt) in bolts.iter().enumerate() {
            uniforms.bolts[i] = [
                (bolt.rect[0] + bolt.rect[2] / 2.0) as f32,
                bolt.intensity as f32,
                (bolt.rect[1] + bolt.rect[3]) as f32,
                0.0,
            ];
        }
        queue.write_buffer(&self.content_uniforms, 0, bytemuck::bytes_of(&uniforms));

        for (i, tile) in self.tiles.iter().enumerate() {
            let state = self.director.tile_state(tile, now);
            let values = [
                tile.rect[0],
                tile.rect[1],
                tile.rect[2],
                tile.rect[3],
                tile.glyph as f64,
                tile.color.index() as f64,
                if tile.is_zero { 1.0 } else { 0.0 },
                tile.seed,
                state.flip,
                state.charge,
                state.flash,
                state.age,
                state.discharge,
            ];
            for (k, v) in values.iter().enumerate() {
                self.tile_data[i * TILE_FLOATS + k] = *v as f32;
            }
        }
        queue.write_buffer(&self.tile_buffer, 0, bytemuck::cast_slice(&self.tile_data));
        let tile_uniforms = TileUniforms {
            aspect: SCREEN_ASPECT as f32,
            time: now as f32,
            glyph_grid: [GLYPH_COLS as f32, GLYPH_ROWS as f32],
        };
        queue.write_buffer(&self.tile_uniforms, 0, bytemuck::bytes_of(&tile_uniforms));

        for (i, bolt) in bolts.iter().enumerate() {
            let values = [
                bolt.rect[0],
                bolt.rect[1],
                bolt.rect[2],
                bolt.rect[3],
                bolt.sprite as f64,
                if bolt.flip { 1.0 } else { 0.0 },
                bolt.intensity,
            ];
            for (k, v) in values.iter().enumerate() {
                self.sprite_data[i * SPRITE_FLOATS + k] = *v as f32;
            }
        }
        if !bolts.is_empty() {
            queue.write_buffer(&self.sprite_buffer, 0, bytemuck::cast_slice(&self.sprite_data[..bolts.len() * SPRITE_FLOATS]));
            let sprite_uniforms = SpriteUniforms { atlas_grid: [ATLAS_COLS as f32, ATLAS_ROWS as f32], pad: [0.0; 2] };
            queue.write_buffer(&self.sprite_uniforms, 0, bytemuck::bytes_of(&sprite_uniforms));
        }

        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("wall"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &target.level0,
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            pass.set_pipeline(&self.content);
            pass.set_bind_group(0, &self.content_group, &[]);
            pass.draw(0..3, 0..1);

            pass.set_pipeline(&self.tile);
            pass.set_bind_group(0, &self.tile_group, &[]);
            pass.set_vertex_buffer(0, self.tile_buffer.slice(..));
            pass.draw(0..4, 0..self.tiles.len() as u32);

            if !bolts.is_empty() {
                pass.set_pipeline(&self.sprite);
                pass.set_bind_group(0, &self.sprite_group, &[]);
                pass.set_vertex_buffer(0, self.sprite_buffer.slice(..));
                pass.draw(0..4, 0..bolts.len() as u32);
            }
        }
        self.mips.generate(device, encoder, &target.texture);
    }

    fn render_composite(
        &mut self,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        output: &wgpu::TextureView,
        width: u32,
        height: u32,
        now: f64,
    ) {
        let (Some(target), Some(group)) = (&self.target, &self.composite_group) else {
            return;
        };
        let bolts = self.director.bolts(now);
        let mut flash = 0.0;
        let mut weighted = 0.0;
        for bolt in &bolts {
            flash += bolt.intensity;
            weighted += bolt.intensity * (bolt.rect[0] + bolt.rect[2] / 2.0);
        }
        let flash_x = if flash > 0.0 { weighted / flash } else { 0.5 };
        let sheet = self.director.sheet_flash(now);
        let strength = (flash * 0.28).min(1.2) + sheet[2] * 0.05;
        let [x0, y0] = SCREEN_CORNERS[0];
        let [x1, y1] = SCREEN_CORNERS[2];
        let m = self.to_screen;
        let uniforms = CompositeUniforms {
            to_screen: [[m[0], m[1], m[2], 0.0], [m[3], m[4], m[5], 0.0], [m[6], m[7], m[8], 0.0]],
            cover: vec4(Self::cover(width, height)),
            rect: vec4([x0, y0, x1, y1]),
            // Warm gold-white, the colour of the bolts.
            flash: vec4([1.0 * strength, 0.72 * strength, 0.38 * strength, x0 + flash_x * (x1 - x0)]),
            res: [width as f32, height as f32],
            time: now as f32,
            levels: (target.levels - 1) as f32,
            vanish: [FLOOR_VANISH[0] as f32, FLOOR_VANISH[1] as f32],
            horizon: HORIZON_Y as f32,
            mirror_y: MIRROR_Y as f32,
            floor_y: FLOOR_Y as f32,
            image_aspect: IMAGE_ASPECT as f32,
            screen_aspect: SCREEN_ASPECT as f32,
            debug: if self.debug { 1.0 } else { 0.0 },
            energy: self.director.energy(now) as f32,
            sweep: self.director.since_strike(now) as f32,
            pad: [0.0; 2],
            pillar_shaft: PILLARS.map(|p| vec4(p.shaft)),
            pillar_column: PILLARS.map(|p| vec4(p.column)),
            pillar_base: PILLARS.map(|p| p.base_y as f32),
            pillars: self.director.pillars(now),
            downlights: DOWNLIGHTS.map(|[x, y]| [x as f32, y as f32, 0.0, 0.0]),
        };
        queue.write_buffer(&self.composite_uniforms, 0, bytemuck::bytes_of(&uniforms));

        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("composite"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: output,
                resolve_target: None,
                ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
        });
        pass.set_pipeline(&self.composite);
        pass.set_bind_group(0, group, &[]);
        pass.draw(0..3, 0..1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uniform_sizes_match_wgsl() {
        assert_eq!(size_of::<ContentUniforms>(), 304);
        assert_eq!(size_of::<TileUniforms>(), 16);
        assert_eq!(size_of::<SpriteUniforms>(), 16);
        assert_eq!(size_of::<CompositeUniforms>(), 384);
    }
}
