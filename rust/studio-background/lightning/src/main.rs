//! Lightning Roulette studio background in a native window.
//!
//!   lightning                                 the window: D toggles the calibration overlay,
//!                                             Space or a click fires a strike
//!   lightning         --shot out.png [--time 3.0] [--size 1920x1080] [--strike-at 0.5] [--debug]
//!                                             one offscreen frame at a frozen time, no window

mod art;
mod render;
mod scene;

use std::sync::Arc;

use render::StudioRenderer;
use winit::application::ApplicationHandler;
use winit::dpi::LogicalSize;
use winit::event::{ElementState, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::{Window, WindowId};

// The canvas renders at most at 2x device pixel ratio.
const MAX_SCALE: f64 = 2.0;

struct Gpu {
    window: Arc<Window>,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    renderer: StudioRenderer,
}

impl Gpu {
    fn new(window: Arc<Window>) -> Self {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
        let surface = instance.create_surface(window.clone()).expect("surface");
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            force_fallback_adapter: false,
        }))
        .expect("no GPU adapter");
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default(), None)).expect("device");
        let caps = surface.get_capabilities(&adapter);
        // The composite writes display values itself, as WebGL does, so the surface must not encode sRGB.
        let format = caps.formats.iter().copied().find(|f| !f.is_srgb()).unwrap_or(caps.formats[0]);
        let (width, height) = canvas_size(&window);
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width,
            height,
            present_mode: wgpu::PresentMode::Fifo,
            desired_maximum_frame_latency: 2,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
        };
        surface.configure(&device, &config);
        let renderer = StudioRenderer::new(&device, &queue, format);
        Self { window, surface, device, queue, config, renderer }
    }

    fn render(&mut self) {
        let (width, height) = canvas_size(&self.window);
        if width == 0 || height == 0 {
            return;
        }
        if width != self.config.width || height != self.config.height {
            self.config.width = width;
            self.config.height = height;
            self.surface.configure(&self.device, &self.config);
        }
        let frame = match self.surface.get_current_texture() {
            Ok(frame) => frame,
            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                self.surface.configure(&self.device, &self.config);
                return;
            }
            Err(error) => {
                eprintln!("surface: {error}");
                return;
            }
        };
        let view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
        self.renderer.frame(&self.device, &self.queue, &view, width, height);
        self.window.pre_present_notify();
        frame.present();
    }
}

fn canvas_size(window: &Window) -> (u32, u32) {
    let scale = window.scale_factor();
    let logical = window.inner_size().to_logical::<f64>(scale);
    let dpr = scale.min(MAX_SCALE);
    ((logical.width * dpr).round() as u32, (logical.height * dpr).round() as u32)
}

#[derive(Default)]
struct App {
    gpu: Option<Gpu>,
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.gpu.is_some() {
            return;
        }
        let attributes = Window::default_attributes()
            .with_title("Lightning Roulette Studio")
            .with_inner_size(LogicalSize::new(1600.0, 905.0));
        let window = Arc::new(event_loop.create_window(attributes).expect("window"));
        self.gpu = Some(Gpu::new(window.clone()));
        window.request_redraw();
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        let Some(gpu) = &mut self.gpu else {
            return;
        };
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::RedrawRequested => {
                gpu.render();
                gpu.window.request_redraw();
            }
            WindowEvent::KeyboardInput { event, .. } if event.state == ElementState::Pressed => match event.physical_key {
                PhysicalKey::Code(KeyCode::KeyD) => gpu.renderer.toggle_debug(),
                PhysicalKey::Code(KeyCode::Space) => gpu.renderer.strike(),
                _ => {}
            },
            WindowEvent::MouseInput { state: ElementState::Pressed, .. } => gpu.renderer.strike(),
            _ => {}
        }
    }
}

struct ShotArgs {
    path: String,
    time: f64,
    width: u32,
    height: u32,
    strike_at: Option<f64>,
    debug: bool,
}

fn parse_shot(args: &[String]) -> Option<ShotArgs> {
    let mut shot = ShotArgs { path: String::new(), time: 3.0, width: 1920, height: 1080, strike_at: None, debug: false };
    let mut found = false;
    let mut i = 0;
    while i < args.len() {
        let value = args.get(i + 1);
        match args[i].as_str() {
            "--shot" => {
                shot.path = value.expect("--shot <path.png>").clone();
                found = true;
                i += 1;
            }
            "--time" => {
                shot.time = value.and_then(|v| v.parse().ok()).expect("--time <seconds>");
                i += 1;
            }
            "--strike-at" => {
                shot.strike_at = Some(value.and_then(|v| v.parse().ok()).expect("--strike-at <seconds>"));
                i += 1;
            }
            "--size" => {
                let (w, h) = value.and_then(|v| v.split_once('x')).expect("--size <W>x<H>");
                shot.width = w.parse().expect("width");
                shot.height = h.parse().expect("height");
                i += 1;
            }
            "--debug" => shot.debug = true,
            other => panic!("unknown argument {other}"),
        }
        i += 1;
    }
    found.then_some(shot)
}

fn shot(args: ShotArgs) {
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        compatible_surface: None,
        force_fallback_adapter: false,
    }))
    .expect("no GPU adapter");
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default(), None)).expect("device");
    let format = wgpu::TextureFormat::Rgba8Unorm;
    let mut renderer = StudioRenderer::new(&device, &queue, format);
    renderer.set_debug(args.debug);
    match args.strike_at {
        Some(at) => {
            renderer.simulate(at, 1.0 / 60.0);
            renderer.seek(Some(at));
            renderer.strike();
            renderer.simulate_from(at, args.time, 1.0 / 60.0);
        }
        None => renderer.simulate(args.time, 1.0 / 60.0),
    }
    renderer.seek(Some(args.time));

    let size = wgpu::Extent3d { width: args.width, height: args.height, depth_or_array_layers: 1 };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("shot"),
        size,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    renderer.frame(&device, &queue, &view, args.width, args.height);

    let row = (args.width * 4).div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT) * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("readback"),
        size: (row * args.height) as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("readback") });
    encoder.copy_texture_to_buffer(
        texture.as_image_copy(),
        wgpu::TexelCopyBufferInfo {
            buffer: &buffer,
            layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(args.height) },
        },
        size,
    );
    queue.submit([encoder.finish()]);
    buffer.slice(..).map_async(wgpu::MapMode::Read, |result| result.expect("map readback"));
    device.poll(wgpu::Maintain::Wait);
    let mapped = buffer.slice(..).get_mapped_range();
    let mut pixels = Vec::with_capacity((args.width * args.height * 4) as usize);
    for y in 0..args.height {
        let start = (y * row) as usize;
        pixels.extend_from_slice(&mapped[start..start + (args.width * 4) as usize]);
    }
    image::save_buffer(&args.path, &pixels, args.width, args.height, image::ExtendedColorType::Rgba8).expect("write PNG");
    println!("{}", args.path);
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(args) = parse_shot(&args) {
        shot(args);
        return;
    }
    let event_loop = EventLoop::new().expect("event loop");
    event_loop.run_app(&mut App::default()).expect("event loop");
}
