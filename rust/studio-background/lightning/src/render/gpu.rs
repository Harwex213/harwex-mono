// Thin wgpu helpers: textures with mip chains, render targets, samplers.
// wgpu has no glGenerateMipmap, so `MipGenerator` builds each level from the one above with a
// render pass.

use std::collections::HashMap;

use crate::art::Rgba;

pub const TARGET_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
const IMAGE_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

pub fn mip_levels(width: u32, height: u32) -> u32 {
    32 - width.max(height).leading_zeros()
}

pub struct Texture {
    pub view: wgpu::TextureView,
}

pub struct MipGenerator {
    pipelines: HashMap<wgpu::TextureFormat, wgpu::RenderPipeline>,
    sampler: wgpu::Sampler,
}

impl MipGenerator {
    pub fn new(device: &wgpu::Device) -> Self {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("mip"),
            source: wgpu::ShaderSource::Wgsl(crate::render::shaders::mip().into()),
        });
        let mut pipelines = HashMap::new();
        for format in [IMAGE_FORMAT, TARGET_FORMAT] {
            let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("mip"),
                layout: None,
                vertex: wgpu::VertexState {
                    module: &module,
                    entry_point: Some("vs"),
                    compilation_options: Default::default(),
                    buffers: &[],
                },
                fragment: Some(wgpu::FragmentState {
                    module: &module,
                    entry_point: Some("fs"),
                    compilation_options: Default::default(),
                    targets: &[Some(format.into())],
                }),
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                multiview: None,
                cache: None,
            });
            pipelines.insert(format, pipeline);
        }
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("mip"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        Self { pipelines, sampler }
    }

    pub fn generate(&self, device: &wgpu::Device, encoder: &mut wgpu::CommandEncoder, texture: &wgpu::Texture) {
        let pipeline = &self.pipelines[&texture.format()];
        let layout = pipeline.get_bind_group_layout(0);
        for level in 1..texture.mip_level_count() {
            let src = texture.create_view(&wgpu::TextureViewDescriptor {
                base_mip_level: level - 1,
                mip_level_count: Some(1),
                ..Default::default()
            });
            let dst = texture.create_view(&wgpu::TextureViewDescriptor {
                base_mip_level: level,
                mip_level_count: Some(1),
                ..Default::default()
            });
            let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("mip"),
                layout: &layout,
                entries: &[
                    wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&src) },
                    wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&self.sampler) },
                ],
            });
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("mip"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &dst,
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            pass.set_pipeline(pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            pass.draw(0..3, 0..1);
        }
    }
}

// Uploads straight RGBA8 bytes; `mipmaps` builds the full chain on the GPU.
pub fn create_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    encoder: &mut wgpu::CommandEncoder,
    mips: &MipGenerator,
    image: &Rgba,
    mipmaps: bool,
) -> Texture {
    let levels = if mipmaps { mip_levels(image.width, image.height) } else { 1 };
    let size = wgpu::Extent3d { width: image.width, height: image.height, depth_or_array_layers: 1 };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: None,
        size,
        mip_level_count: levels,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: IMAGE_FORMAT,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    queue.write_texture(
        wgpu::TexelCopyTextureInfo { texture: &texture, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
        &image.data,
        wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(image.width * 4), rows_per_image: Some(image.height) },
        size,
    );
    if mipmaps {
        mips.generate(device, encoder, &texture);
    }
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    Texture { view }
}

// A mip-mapped colour target. Mips double as a cheap blur pyramid for glow and reflections.
pub struct RenderTarget {
    pub texture: wgpu::Texture,
    pub view: wgpu::TextureView,
    pub level0: wgpu::TextureView,
    pub width: u32,
    pub height: u32,
    pub levels: u32,
}

pub fn create_render_target(device: &wgpu::Device, width: u32, height: u32) -> RenderTarget {
    let levels = mip_levels(width, height);
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("wall"),
        size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        mip_level_count: levels,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: TARGET_FORMAT,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let level0 = texture.create_view(&wgpu::TextureViewDescriptor { mip_level_count: Some(1), ..Default::default() });
    RenderTarget { texture, view, level0, width, height, levels }
}

pub fn sampler(device: &wgpu::Device, address: wgpu::AddressMode, anisotropy: u16) -> wgpu::Sampler {
    device.create_sampler(&wgpu::SamplerDescriptor {
        label: None,
        address_mode_u: address,
        address_mode_v: address,
        address_mode_w: address,
        mag_filter: wgpu::FilterMode::Linear,
        min_filter: wgpu::FilterMode::Linear,
        mipmap_filter: wgpu::FilterMode::Linear,
        anisotropy_clamp: anisotropy,
        ..Default::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_match_webgl() {
        // Math.floor(Math.log2(Math.max(width, height))) + 1
        assert_eq!(mip_levels(1, 1), 1);
        assert_eq!(mip_levels(2000, 1131), 11);
        assert_eq!(mip_levels(2048, 10), 12);
        assert_eq!(mip_levels(1131, 2047), 11);
    }
}
