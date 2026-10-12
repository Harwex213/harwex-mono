# studio-background

Native studio backgrounds in Rust (wgpu 24 + winit 0.30), no webview. Each variant of the background is its own binary crate in its own folder. The root `Cargo.toml` is a workspace only to share the build cache and the profiles. To add a variant, create a new folder with a binary crate and add it to `members`. Variants do not depend on each other. Copy code between variants instead of sharing a library.

## Variants

- `lightning`: a one-to-one port of the web prototype `javascript/packages/prototypes/ai-slop/studio-background/studio-background-roulette-evolution-2`. It has the same calibration, the same director timings and the same shader math.

## Run

```sh
cargo run --release -p lightning                     # the window: D overlay, Space or click strikes
cargo run --release -p lightning -- --shot out.png --time 2.75 --strike-at 2.2 [--size 1920x1080] [--debug]
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

Check visuals with `--shot`. Do not run the window from an agent.

## lightning layout

- `src/scene`: pure logic. It holds the plate calibration, the homography, the board layout and the lightning director. It has no GPU code and no disk access.
- `src/art`: CPU-drawn images. It draws the numeral atlas (Inter SemiBold through ab_glyph), the bolt sprite atlas (tiny-skia strokes plus blurred shadows) and the plate light masks.
- `src/render`: the wgpu renderer. WGSL lives in `shaders/`. `noise.wgsl` is prepended to every module. `composite.wgsl` gets its `{{...}}` placeholders from the calibration.
- `src/main.rs`: the window and the `--shot` CLI.
- `assets/`: the plate, the clouds and the font. `include_bytes!` embeds them into the binary.

## lightning port rules

- Every UV is y-down. The wgpu framebuffer is y-down too, so the wall target is sampled without the `1.0 - y` flip of the GLSL version.
- The surface format must not be sRGB. The composite writes display values itself, as WebGL does.
- GLSL `pow(x, 2.0)` with a negative `x` became `sq(x)`. WGSL rejects `smoothstep` with constant edges in reverse order, so `smoothstep(0.4, 0.0, a)` became `1.0 - smoothstep(0.0, 0.4, a)`.
- Implicit-LOD `textureSample` must stay in uniform control flow. The tile shader samples the glyph atlas before its branch and masks the result.
- wgpu has no `generateMipmap`. `gpu::MipGenerator` builds each level with a render pass. The wall target gets a new chain every frame.
- `render::shaders::tests::shaders_validate` runs naga over every module. Keep it green after a shader edit.
- ab_glyph stores outline bounds y-up with `min.y` as the top edge. The cap height of "0" comes from `max(min.y, max.y)`.
