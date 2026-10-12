// Shared noise. Conventions: every UV is y-down (0 at the top), matching the images and the
// wgpu framebuffer, so render targets are sampled without a flip.

fn hash(p_in: vec2f) -> f32 {
  var p = fract(p_in * vec2f(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2f(1.0, 0.0)), u.x),
             mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), u.x), u.y);
}

fn fbm(p_in: vec2f) -> f32 {
  var p = p_in;
  var value = 0.0;
  var amp = 0.5;
  for (var i = 0; i < 5; i++) {
    value += amp * noise(p);
    p = p * 2.03 + vec2f(17.1, 9.7);
    amp *= 0.5;
  }
  return value;
}

fn sq(x: f32) -> f32 {
  return x * x;
}

// GLSL mod: x - y * floor(x / y).
fn glsl_mod(x: f32, y: f32) -> f32 {
  return x - y * floor(x / y);
}

// A full-screen triangle from the vertex index.
fn fullscreen(id: u32) -> vec4f {
  let i = i32(id);
  let p = vec2f(f32((i << 1u) & 2), f32(i & 2));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
