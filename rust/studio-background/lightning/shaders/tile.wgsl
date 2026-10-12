// One roulette tile per instance. Local space: x spans the tile width (-0.5..0.5), y down, same scale.

struct TileUniforms {
  aspect: f32,
  time: f32,
  glyph_grid: vec2f,
}

@group(0) @binding(0) var<uniform> u: TileUniforms;
@group(0) @binding(1) var glyph_tex: texture_2d<f32>;
@group(0) @binding(2) var glyph_samp: sampler;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) half_size: vec2f,
  @location(2) @interpolate(flat) info: vec4f,
  @location(3) @interpolate(flat) state: vec4f,
  @location(4) @interpolate(flat) discharge: f32,
  @location(5) @interpolate(flat) facing: f32,
  @location(6) @interpolate(flat) center_x: f32,
}

// Room around the tile for its glow and shock rings, in tile widths.
const MARGIN: f32 = 0.34;

@vertex
fn vs(
  @builtin(vertex_index) id: u32,
  @location(0) rect: vec4f,
  @location(1) info: vec4f,
  @location(2) state: vec4f,
  @location(3) discharge: f32,
) -> VOut {
  let corner = vec2f(f32(id & 1u), f32((id >> 1u) & 1u));
  let half_size = vec2f(0.5, 0.5 * rect.w / (rect.z * u.aspect));
  let local = mix(-half_size - MARGIN, half_size + MARGIN, corner);

  // Punch on impact, a small dip when the charge leaves.
  let age = state.w;
  var scale = 1.0;
  if (age >= 0.0) {
    scale += 0.1 * exp(-age * 6.0) * sin(min(age, 1.0) * 9.0);
  }
  if (discharge >= 0.0) {
    scale -= 0.035 * exp(-discharge * 5.0) * sin(min(discharge, 1.0) * 7.0);
  }

  // Card flip around the horizontal axis, with real perspective.
  let theta = state.x;
  let p = vec3f(local.x, local.y * cos(theta), local.y * sin(theta)) * scale;
  let distance = 3.5 + half_size.y * 2.0;
  let w = (distance + p.z) / distance;
  let centre = rect.xy + rect.zw * 0.5;
  let uv = centre + vec2f(p.x * rect.z, p.y * rect.z * u.aspect) / w;

  var out: VOut;
  out.pos = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0) * w;
  out.local = local;
  out.half_size = half_size;
  out.info = info;
  out.state = state;
  out.discharge = discharge;
  out.facing = cos(theta);
  out.center_x = centre.x;
  return out;
}

fn sd_box(p: vec2f, b: vec2f) -> f32 {
  let d = abs(p) - b;
  return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);
}

// Rounded rectangle; the zero tile also gets its pointed left side.
fn tile_sdf(p: vec2f, h: vec2f, zero: bool) -> f32 {
  let r = 0.045;
  var d = sd_box(p, h - r) - r;
  if (zero) {
    let tip = 0.26;
    let a = vec2f(-h.x + tip, h.y);
    let n = normalize(vec2f(-h.y, tip));
    d = max(d, dot(vec2f(p.x, abs(p.y)) - a, n));
  }
  return d;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  var p = in.local;
  // Seen from the back half of the flip, keep the numeral upright.
  if (in.facing < 0.0) {
    p.y = -p.y;
  }
  let h = in.half_size;
  let zero = in.info.z > 0.5;
  let seed = in.info.w;
  let charge = in.state.y;
  let flash = in.state.z;
  let age = in.state.w;

  let d = tile_sdf(p, h, zero);
  let aa = max(fwidth(d), 1e-4);
  let body = 1.0 - smoothstep(-aa, aa, d);

  let cream = vec3f(0.99, 0.95, 0.86);
  let gold = vec3f(0.96, 0.74, 0.38);
  let ink = select(select(vec3f(0.3, 0.72, 0.36), vec3f(0.93, 0.2, 0.15), in.info.y < 1.5), cream, in.info.y < 0.5);
  let electric = vec3f(1.0, 0.74, 0.3);
  let flicker = 0.82 + 0.18 * noise(vec2f(u.time * 32.0, seed * 91.0));

  // Smoked glass body: a lit top edge, an inner shadow, a faint underglow in the numeral colour.
  let gy = clamp(p.y / h.y * 0.5 + 0.5, 0.0, 1.0);
  var fill = mix(vec3f(0.09, 0.082, 0.07), vec3f(0.018, 0.016, 0.014), gy);
  fill += vec3f(0.05) * (1.0 - smoothstep(0.0, 0.42, gy));
  fill += ink * 0.08 * smoothstep(0.35, 1.0, gy);
  fill *= 0.72 + 0.28 * smoothstep(0.0, 0.14, -d);

  // Charged: plasma drifts inside the glass and the rim glows from within.
  let plasma = fbm(p * 5.0 + vec2f(seed * 13.0 + u.time * 0.7, -u.time * 0.5));
  fill += electric * charge * flicker * (0.05 + 0.6 * pow(plasma, 3.0) + 0.3 * exp(d * 16.0));

  // Rim: a cream line with brighter corners; when charged, arcs and sparks run around it.
  let bw = 0.016;
  let rim = 1.0 - smoothstep(0.0, aa * 1.3, abs(d + bw * 0.5) - bw * 0.5);
  let hair = 1.0 - smoothstep(0.0, aa, abs(d + 0.055) - 0.003);
  let q = abs(p) / h;
  let corner_accent = smoothstep(0.62, 0.9, q.x) * smoothstep(0.45, 0.85, q.y);
  let ang = atan2(p.y / h.y, p.x / h.x) / 6.28318;
  var arcs = noise(vec2f(ang * 34.0 + seed * 50.0, u.time * 9.0)) * noise(vec2f(ang * 11.0 - u.time * 2.0, seed * 20.0));
  arcs = smoothstep(0.2, 0.65, arcs);
  let head = fract(u.time * 0.55 + seed);
  let spark = exp(-abs(fract(ang - head + 0.5) - 0.5) * 70.0)
            + 0.6 * exp(-abs(fract(ang + head * 1.3 + 0.5) - 0.5) * 90.0);
  var rim_color = mix(gold * (0.55 + 0.45 * corner_accent), electric * 0.85, charge);
  rim_color += electric * charge * flicker * (arcs * 2.2 + spark * 3.2);

  // Numeral. The atlas is sampled outside the branch: implicit-LOD sampling needs uniform control flow.
  var gp = p;
  if (zero) {
    gp.x -= 0.1;
  }
  let guv = gp / 0.96 + 0.5;
  let slot = vec2f(glsl_mod(in.info.x, u.glyph_grid.x), floor(in.info.x / u.glyph_grid.x));
  let auv = (slot + guv) / u.glyph_grid;
  let glyph_sample = textureSample(glyph_tex, glyph_samp, auv).a;
  let glyph_glow_sample = textureSampleLevel(glyph_tex, glyph_samp, auv, 3.5).a;
  let in_slot = all(guv > vec2f(0.0)) && all(guv < vec2f(1.0));
  let glyph = select(0.0, glyph_sample, in_slot);
  let glyph_glow = select(0.0, glyph_glow_sample, in_slot);
  // Charged numerals keep their colour and burn brighter.
  let ink_color = ink * (1.0 + charge * flicker * 0.9) + electric * charge * 0.04;

  // Premultiplied composite; glows add light without adding coverage.
  let fill_alpha = 0.8;
  var rgb = fill * fill_alpha * body;
  var alpha = fill_alpha * body;
  rgb = mix(rgb, rim_color, rim);
  alpha = max(alpha, rim);
  rgb += gold * 0.12 * hair * body * (1.0 - 0.5 * charge);
  rgb = mix(rgb, ink_color, glyph);
  alpha = max(alpha, glyph);
  rgb += ink * glyph_glow * 0.16 + mix(electric, ink, vec3f(0.75)) * glyph_glow * charge * flicker * 1.1;
  let outer = exp(-max(d, 0.0) * 20.0) * (1.0 - body);
  // Soft contact shadow lifts the tile off the clouds.
  alpha = max(alpha, exp(-max(d, 0.0) * 28.0) * 0.4 * (1.0 - body));
  rgb += electric * outer * charge * 0.4 * (0.8 + 0.2 * sin(u.time * 6.0 + seed * 6.28));

  // Idle glint travelling across the board.
  let sweep = fract(u.time / 7.0) * 1.6 - 0.3;
  let band = exp(-sq((in.center_x + p.x * 0.05 - p.y * 0.03 - sweep) * 20.0));
  rgb += mix(gold, cream, vec3f(0.5)) * band * (rim * 0.7 + body * 0.05) * (1.0 - charge);

  // Impact: white flash, then a shock ring leaving the rim.
  if (age >= 0.0) {
    rgb += vec3f(1.1, 0.98, 0.82) * flash * (body * 0.5 + rim * 0.9);
    let ring = exp(-sq((d - age * 0.4) / 0.016)) * (1.0 - smoothstep(0.0, 0.4, age)) * step(0.0, d);
    rgb += electric * ring * 1.6;
  }
  // The glass catches the light as it turns.
  rgb += vec3f(1.0, 0.82, 0.55) * pow(abs(sin(in.state.x)), 3.0) * body * 0.3;
  // Discharge: a last faint ring, the charge bleeding off.
  if (in.discharge >= 0.0 && in.discharge < 0.8) {
    let ring = exp(-sq((d - in.discharge * 0.3) / 0.015)) * (1.0 - in.discharge / 0.8) * step(0.0, d);
    rgb += electric * ring * 0.8;
  }

  return vec4f(rgb, alpha);
}
