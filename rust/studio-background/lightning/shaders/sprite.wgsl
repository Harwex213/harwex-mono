// Bolt sprites, one instance per active bolt, added on top of the wall.

struct SpriteUniforms {
  atlas_grid: vec2f,
  _pad: vec2f,
}

@group(0) @binding(0) var<uniform> u: SpriteUniforms;
@group(0) @binding(1) var atlas_tex: texture_2d<f32>;
@group(0) @binding(2) var atlas_samp: sampler;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) local: vec2f,
  @location(2) intensity: f32,
}

@vertex
fn vs(@builtin(vertex_index) id: u32, @location(0) rect: vec4f, @location(1) data: vec3f) -> VOut {
  let corner = vec2f(f32(id & 1u), f32((id >> 1u) & 1u));
  let s = rect.xy + corner * rect.zw;
  var out: VOut;
  out.pos = vec4f(s.x * 2.0 - 1.0, 1.0 - s.y * 2.0, 0.0, 1.0);
  let x = select(corner.x, 1.0 - corner.x, data.y > 0.5);
  let cell = data.x;
  let origin = vec2f(glsl_mod(cell, u.atlas_grid.x), floor(cell / u.atlas_grid.x));
  out.uv = (origin + vec2f(x, corner.y)) / u.atlas_grid;
  out.local = corner;
  out.intensity = data.z;
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let layers = textureSample(atlas_tex, atlas_samp, in.uv).rgb;
  var fade = smoothstep(0.0, 0.12, in.local.y) * (1.0 - smoothstep(0.94, 1.0, in.local.y));
  // The halo is wider than the sprite; fade it out before the quad edge leaves a seam.
  fade *= smoothstep(0.0, 0.2, in.local.x) * (1.0 - smoothstep(0.8, 1.0, in.local.x));
  let col = layers.r * vec3f(2.9, 2.7, 2.3)
          + layers.g * vec3f(1.75, 1.15, 0.4)
          + layers.b * vec3f(1.15, 0.55, 0.12) * 0.9;
  return vec4f(col * in.intensity * fade, 1.0);
}
