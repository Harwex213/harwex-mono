// Video wall background: night clouds lit by the bolts.

struct ContentUniforms {
  res: vec2f,
  time: f32,
  aspect: f32,
  sheet: vec4f,
  bolt_count: i32,
  _pad0: i32,
  _pad1: i32,
  _pad2: i32,
  bolts: array<vec4f, 16>,
}

@group(0) @binding(0) var<uniform> u: ContentUniforms;
@group(0) @binding(1) var clouds_tex: texture_2d<f32>;
@group(0) @binding(2) var clouds_samp: sampler;

@vertex
fn vs(@builtin(vertex_index) id: u32) -> @builtin(position) vec4f {
  return fullscreen(id);
}

@fragment
fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let s = frag.xy / u.res;
  let q = vec2f(s.x * u.aspect, s.y);

  // Two drifting cloud layers, domain-warped so the billows slowly roll.
  let warp = vec2f(fbm(q * 2.1 + vec2f(u.time * 0.021, 0.0)), fbm(q * 2.1 + vec2f(5.2, u.time * 0.017))) - 0.5;
  let far = textureSample(clouds_tex, clouds_samp, q * 0.36 + vec2f(u.time * 0.0032, 0.22) + warp * 0.045).rgb;
  let near = textureSample(clouds_tex, clouds_samp, q * 0.62 + vec2f(u.time * 0.0078 + 0.37, 0.08) + warp.yx * 0.075).rgb;
  var clouds = mix(far, near, vec3f(0.4));
  clouds = pow(clouds, vec3f(1.15)) * 1.0;
  let density = dot(clouds, vec3f(0.3, 0.5, 0.2));

  // Light from the bolts inside the cloud deck and along each channel.
  var glow = 0.0;
  for (var i = 0; i < 16; i++) {
    if (i >= u.bolt_count) {
      break;
    }
    let b = u.bolts[i];
    let d = vec2f((s.x - b.x) * u.aspect, (s.y - 0.05) * 0.75);
    glow += b.y * exp(-dot(d, d) * 7.0);
    let channel = exp(-abs((s.x - b.x) * u.aspect) * 18.0) * step(s.y, b.z);
    glow += b.y * channel * 0.35;
  }
  let sd = vec2f((s.x - u.sheet.x) * u.aspect, s.y - u.sheet.y);
  glow += u.sheet.z * exp(-dot(sd, sd) * 5.0) * 0.7;

  // Bolts light the cloud deck from inside with a warm gold-white.
  var col = clouds * (1.0 + glow * vec3f(3.8, 3.0, 2.1) * (0.35 + density * 2.6));
  col += glow * vec3f(0.1, 0.065, 0.025);

  // Screen-space vignette so the layout reads first.
  let v = s - 0.5;
  col *= 1.0 - dot(v * vec2f(0.9, 1.2), v * vec2f(0.9, 1.2)) * 0.9;

  return vec4f(col, 1.0);
}
