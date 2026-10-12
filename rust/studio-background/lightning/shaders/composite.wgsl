// Final frame: the studio plate, the video wall inside the glass, and the wall's light in the room.
// Double-brace placeholders are filled from crate::scene::calibration at start-up.

struct CompositeUniforms {
  to_screen: mat3x3f,
  cover: vec4f,
  rect: vec4f,
  flash: vec4f,
  res: vec2f,
  time: f32,
  levels: f32,
  vanish: vec2f,
  horizon: f32,
  mirror_y: f32,
  floor_y: f32,
  image_aspect: f32,
  screen_aspect: f32,
  debug: f32,
  energy: f32,
  // Seconds since the current strike sequence started; large when none has played yet.
  sweep: f32,
  _pad0: f32,
  _pad1: f32,
  pillar_shaft: array<vec4f, {{PILLAR_COUNT}}>,
  pillar_column: array<vec4f, {{PILLAR_COUNT}}>,
  // One float per pillar, packed four to a vector.
  pillar_base: vec4f,
  pillars: vec4f,
  // xy per downlight.
  downlights: array<vec4f, {{DOWNLIGHT_COUNT}}>,
}

@group(0) @binding(0) var<uniform> u: CompositeUniforms;
@group(0) @binding(1) var image_tex: texture_2d<f32>;
@group(0) @binding(2) var image_samp: sampler;
@group(0) @binding(3) var content_tex: texture_2d<f32>;
@group(0) @binding(4) var content_samp: sampler;
@group(0) @binding(5) var masks_tex: texture_2d<f32>;
@group(0) @binding(6) var masks_samp: sampler;

@vertex
fn vs(@builtin(vertex_index) id: u32) -> @builtin(position) vec4f {
  return fullscreen(id);
}

fn to_screen(p: vec2f) -> vec2f {
  let h = u.to_screen * vec3f(p, 1.0);
  return h.xy / h.z;
}

fn to_linear(c: vec3f) -> vec3f {
  return pow(max(c, vec3f(0.0)), vec3f(2.2));
}

fn to_display(c: vec3f) -> vec3f {
  return pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.2));
}

fn wall(s: vec2f, lod: f32) -> vec3f {
  return to_linear(textureSampleLevel(content_tex, content_samp, s, lod).rgb);
}

// LED panels clip softly instead of hard.
fn led_tone(c: vec3f) -> vec3f {
  let k = 0.8 + 0.2 * (1.0 - exp(-(c - 0.8) / 0.2));
  return select(c, k, c >= vec3f(0.8));
}

// ---- Arcs on the room's columns. ----

const PLATE_PX = vec2f(2000.0, 1131.0);

// Arc light of one column at plate pixel P: x = hot core, y = glow. Arcs are re-drawn every
// 1/24 s, like a real discharge that keeps jumping to a new path. y is the height along the
// shaft; the floor reflection passes a mirrored height.
fn column_arcs(i: i32, P: vec2f, intensity: f32) -> vec2f {
  let shaft = u.pillar_shaft[i] * PLATE_PX.xyxy;
  let width = shaft.z - shaft.x;
  if (P.x < shaft.x - width * 0.6 || P.x > shaft.z + width * 0.6) {
    return vec2f(0.0);
  }
  let v = (P.y - shaft.y) / (shaft.w - shaft.y);
  let fi = f32(i);
  let frame = floor(u.time * 24.0);
  var total = vec2f(0.0);
  for (var k = 0; k < 3; k++) {
    let fk = f32(k);
    let seed = frame * 1.31 + fk * 7.7 + fi * 13.1;
    // Secondary strands only show up on some frames.
    let weight = select(step(0.45, hash(vec2f(seed, 3.1))) * 0.6, 1.0, k == 0);
    if (weight <= 0.0) {
      continue;
    }
    // Every strand covers its own stretch of the shaft.
    let a = hash(vec2f(seed, 1.7)) * 0.35 - 0.05;
    let b = a + 0.45 + hash(vec2f(seed, 2.9)) * 0.6;
    let span = smoothstep(a, a + 0.04, v) * (1.0 - smoothstep(b - 0.04, b, v));
    if (span <= 0.0) {
      continue;
    }
    let cx = mix(shaft.x, shaft.z, 0.2 + 0.6 * hash(vec2f(seed, 5.3)));
    let jag = (noise(vec2f(v * 7.0, seed)) - 0.5) * width * 0.45
            + (noise(vec2f(v * 26.0, seed + 4.0)) - 0.5) * width * 0.16
            + (noise(vec2f(v * 90.0, seed + 9.0)) - 0.5) * width * 0.05;
    let x = clamp(cx + jag, shaft.x + 2.0, shaft.z - 2.0);
    let dx = abs(P.x - x);
    // The shaft is round: an arc near its silhouette is seen at a grazing angle and dims.
    let facing = 1.0 - pow(abs((x - (shaft.x + shaft.z) * 0.5) / (width * 0.5)), 3.0);
    let core = exp(-dx * dx / 1.4);
    let glow = exp(-dx / 8.0) * 0.6 + exp(-dx / 30.0) * 0.18;
    total += vec2f(core, glow) * span * weight * (0.5 + 0.5 * facing);
  }
  return total * intensity;
}

// Light a burst throws onto the column itself and the walls and floor around it.
fn column_spill(i: i32, P: vec2f, intensity: f32) -> f32 {
  let column = u.pillar_column[i] * PLATE_PX.xyxy;
  let cx = (column.x + column.z) * 0.5;
  let half_width = (column.z - column.x) * 0.5;
  let dx = max(abs(P.x - cx) - half_width, 0.0);
  let dy = max(max(column.y - P.y, P.y - column.w), 0.0);
  return intensity / (1.0 + (dx * dx + dy * dy) / (half_width * half_width * 4.0));
}

// ---- Ceiling lights. ----

const FRAME_CENTRE = vec2f({{FRAME_CENTRE_X}}, {{FRAME_CENTRE_Y}});
const FRAME_HALF = vec2f({{FRAME_HALF_X}}, {{FRAME_HALF_Y}});
const FRAME_INSET: f32 = {{FRAME_INSET}};

fn frame_sdf(P: vec2f, half_size: vec2f) -> f32 {
  let d = abs(P - FRAME_CENTRE) - half_size;
  return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);
}

// A comet running round the frame; gap is how far behind its head a point is (0..1).
// The tail fades in over the first steps behind the head, so the head has no hard edge
// that the wide glow would throw onto the wall as a line.
fn comet(gap: f32) -> f32 {
  let tail = exp(-gap / 0.05) * smoothstep(0.0, 0.015, gap);
  let head = exp(-sq(min(gap, 1.0 - gap) / 0.008));
  return tail + head * 0.8;
}

// Light of the LED line around the TV at plate pixel P: x = hot core, y = glow.
// Two comets chase each other round the frame; the rest follows the ceiling strips.
fn frame_led(P: vec2f, level: f32) -> vec2f {
  let d = frame_sdf(P, FRAME_HALF);
  let hairline = frame_sdf(P, FRAME_HALF - FRAME_INSET);
  let q = (P - FRAME_CENTRE) / FRAME_HALF;
  let around = atan2(q.y, q.x) / 6.28318 + 0.5;
  let comet_a = fract(u.time * 0.11);
  let comet_b = fract(-u.time * 0.11 + 0.5);
  let gap_a = fract(comet_a - around);
  let gap_b = fract(around - comet_b);
  let chase = comet(gap_a) + comet(gap_b);
  let bright = level * (0.85 + 0.3 * chase);
  let core = exp(-d * d / 1.6) + exp(-hairline * hairline / 0.8) * 0.25;
  let glow = exp(-abs(d) / 5.0) * 0.5 + exp(-abs(d) / 22.0) * 0.12;
  return vec2f(core, glow) * bright;
}

// Level of the LED strips at plate x. The strips run left to right (the diagonals of the cove
// are close to 45 degrees), so x alone is a good coordinate along them.
//   Idle: soft waves of light flow out from the centre, and a comet runs out now and then.
//   Strike: a bright wave runs left to right with the bolts.
//   Charged board: the strips pulse faster.
fn led_level(x: f32) -> f32 {
  let from_centre = abs(x - 999.0) / 520.0;
  var level = 0.74 + 0.32 * sin(from_centre * 9.0 - u.time * 1.7) + 0.08 * sin(from_centre * 23.0 + u.time * 0.9);
  let comet_head = fract(u.time / 6.5) * 1.8 - 0.3;
  let behind = comet_head - from_centre;
  level += select(exp(-sq(behind / 0.03)) * 0.55, exp(-behind / 0.18) * 0.55, behind > 0.0);
  // The strike wave takes as long as the bolts take to cross the board.
  let along = (x - 480.0) / 1040.0;
  let head = u.sweep / 1.3;
  if (head > -0.1 && head < 1.6) {
    let gap = head - along;
    let wave = select(exp(-sq(gap / 0.035)) * 2.2, exp(-gap / 0.12) * 1.4, gap > 0.0);
    level += wave * (1.0 - smoothstep(1.2, 1.6, head));
  }
  level += u.energy * (0.2 + 0.3 * sin(u.time * 7.0 - from_centre * 6.0));
  return clamp(level, 0.3, 3.5);
}

// A recessed downlight seen from below and a little to the side: a white-hot lens, a warm
// halo in the air around it, a faint horizontal streak in the camera lens.
fn downlight(P: vec2f, lamp: vec2f) -> vec3f {
  let d = P - lamp;
  // The lens is round, seen at an angle, so it is wider than tall.
  let lens = length(d * vec2f(1.0, 1.6));
  let core = exp(-lens * lens / 7.0) * 2.2;
  let halo = exp(-lens / 7.0) * 0.35 + exp(-lens / 28.0) * 0.07 + exp(-lens / 90.0) * 0.015;
  let streak = exp(-abs(d.y) / 1.3) * exp(-abs(d.x) / 70.0) * 0.1;
  return vec3f(1.0, 0.93, 0.8) * core + vec3f(1.0, 0.72, 0.4) * (halo + streak);
}

// The beam of a downlight in the haze: a narrow cone falling straight down, fading with depth.
fn downlight_beam(P: vec2f, lamp: vec2f) -> f32 {
  let below = P.y - lamp.y;
  if (below <= 4.0) {
    return 0.0;
  }
  let width = 5.0 + below * 0.32;
  let across = (P.x - lamp.x) / width;
  return exp(-across * across * 2.0) * exp(-below / 320.0) * smoothstep(4.0, 30.0, below);
}

// Gold dust hanging in the air. At rest it barely shows. When the board charges, the motes
// light up in the wall's light, and sparks near a firing column flare.
fn air_particles(p: vec2f, glow_near: f32, flash_light: f32) -> vec3f {
  let q = p * vec2f(u.image_aspect, 1.0);
  var total = vec3f(0.0);
  for (var layer = 0; layer < 3; layer++) {
    let fl = f32(layer);
    // Near layers are bigger, faster and out of focus.
    let scale = 34.0 - fl * 11.0;
    let drift = vec2f(u.time * (0.006 + fl * 0.004), -u.time * (0.012 + fl * 0.01));
    let g = q * scale + drift * scale + vec2f(fl * 17.3, fl * 5.1);
    let cell = floor(g);
    let f = fract(g) - 0.5;
    let h = hash(cell + fl * 41.7);
    if (h < 0.84) {
      continue;
    }
    // The mote and its blur stay inside the cell, or the cell edge would cut it off.
    let radius = 0.025 + fl * 0.025;
    let room = 0.5 - radius * 3.0 - 0.05;
    var off = (vec2f(hash(cell + 3.7), hash(cell + 8.1)) - 0.5) * 2.0 * room * 0.8;
    off += 0.05 * vec2f(sin(u.time * (0.6 + h) + h * 40.0), cos(u.time * (0.5 + h * 0.7) + h * 23.0));
    let dist = length(f - off);
    let mote = exp(-dist * dist / (radius * radius));
    let twinkle = 0.55 + 0.45 * sin(u.time * (1.5 + h * 4.0) + h * 60.0);
    let brightness = 0.02 + u.energy * (0.2 + 0.45 * twinkle) + flash_light * 0.9 + glow_near * 1.5;
    // Out-of-focus motes spread the same light over a bigger disc, so each one is dimmer.
    total += vec3f(1.0, 0.7, 0.34) * mote * brightness * (0.6 - fl * 0.2);
  }
  return total;
}

@fragment
fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let c = frag.xy / u.res;
  let p = u.cover.xy + c * u.cover.zw;
  let plate = to_linear(textureSample(image_tex, image_samp, p).rgb);
  let masks = textureSample(masks_tex, masks_samp, p);
  // The LED strips are animated; the glow they baked into the plate follows them.
  let led = masks.b;
  let led_near = textureSampleLevel(masks_tex, masks_samp, p, 2.0).b;
  let led_mid = textureSampleLevel(masks_tex, masks_samp, p, 4.0).b;
  let led_wide = textureSampleLevel(masks_tex, masks_samp, p, 6.0).b;
  let dimmer = led_level(p.x * 2000.0);
  let baked_glow = max(led, clamp(led_wide * 4.0, 0.0, 1.0) * 0.7);
  let base = plate * mix(1.0, dimmer, baked_glow);
  let s = to_screen(p);

  let fw = fwidth(s) * 1.25;
  let m = smoothstep(vec2f(0.0), fw, s) * smoothstep(vec2f(0.0), fw, 1.0 - s);
  let inside = m.x * m.y;
  let outside = 1.0 - inside;

  // Video wall emission.
  let sharp = textureSample(content_tex, content_samp, s).rgb;
  let bloom = textureSampleLevel(content_tex, content_samp, s, 3.0).rgb * 0.14
            + textureSampleLevel(content_tex, content_samp, s, 5.0).rgb * 0.1;
  var emit = to_linear(led_tone(sharp + bloom));
  // The glass sits recessed in its bevel: a soft contact shadow along the edges.
  let edge_dist = min(s, 1.0 - s) * vec2f(u.screen_aspect, 1.0);
  let recess = smoothstep(0.0, 0.03, min(edge_dist.x, edge_dist.y));
  emit *= 0.6 + 0.4 * recess;
  // The dark panel in the plate carries the wash of the ceiling downlight. Part of it stays
  // on the glass as a reflection; the lit panel outshines the rest.
  let wall_level = clamp(dot(emit, vec3f(0.3, 0.59, 0.11)) * 4.0, 0.0, 1.0);
  let on_glass = plate * mix(0.3, 0.12, wall_level);
  // Grazing reflections of the side walls and ceiling in the glass near its edges.
  let mirror_x = vec2f(select(2.0 * u.rect.z - p.x, 2.0 * u.rect.x - p.x, s.x < 0.5), p.y);
  let mirror_y = vec2f(p.x, 2.0 * u.rect.y - p.y);
  let side_refl = to_linear(textureSampleLevel(image_tex, image_samp, mirror_x, 2.5).rgb) * exp(-edge_dist.x * 9.0);
  let top_refl = to_linear(textureSampleLevel(image_tex, image_samp, mirror_y, 2.5).rgb) * exp(-edge_dist.y * 11.0);
  let glass = (side_refl * 0.06 + top_refl * 0.05) * (1.0 - 0.6 * wall_level);
  var col = base * outside + (on_glass + emit + glass + vec3f(0.0012, 0.0011, 0.001)) * inside;

  // Light the wall throws into the room.
  let aspect = vec2f(u.image_aspect, 1.0);
  let q = p * aspect;
  let dd = max(max(u.rect.xy * aspect - q, q - u.rect.zw * aspect), vec2f(0.0));
  let d = length(dd);
  let near = 1.0 / (1.0 + d * d * 120.0);
  let sc = clamp(s, vec2f(0.0), vec2f(1.0));
  let edge = wall(sc, 6.0);
  let average = wall(vec2f(0.5), u.levels);
  let flash_at = vec2f(u.flash.w, mix(u.rect.y, u.rect.w, 0.2)) * aspect;
  let fd = length(q - flash_at);
  let flash_fall = 1.0 / (1.0 + fd * fd * 4.0);
  let flash = u.flash.rgb * (0.16 + flash_fall * 1.6);
  let light = edge * near * 3.0 + average * 0.9 + flash;
  // Polished gold mirrors the light: it brightens far more than the matte black walls.
  let metal = masks.g;
  col += outside * (base * light * (2.0 + metal * 3.5) + light * near * 0.003);
  // Hot glints on the gold edges that face the bolt.
  let plate_lum = dot(plate, vec3f(0.3, 0.59, 0.11));
  col += outside * metal * u.flash.rgb * flash_fall * smoothstep(0.02, 0.25, plate_lum) * 0.5;

  // The ceiling LED strips glow: a hotter, whiter core along the strip, then light that spills
  // out of the cove over the ceiling panels around it. The mip chain of the LED mask is the blur.
  let P = p * PLATE_PX;
  let led_color = vec3f(1.0, 0.7, 0.34);
  // The strip is only a few pixels wide, so its blurred mips are faint: they are scaled back up.
  col += outside * led * vec3f(1.0, 0.85, 0.6) * 0.9 * dimmer;
  let led_bloom = led_color * (led_near * 0.9 + led_mid * 1.3 + led_wide * 1.6) * dimmer;
  // Surfaces next to the strips catch its light; the gold trim on them flares.
  col += outside * (led_bloom * 0.45 + base * led_bloom * (1.5 + metal * 4.0));

  // The LED line around the TV, in yellow gold, kept low: it should read as a lit frame,
  // not pull the eye off the wall. On the glass side its glow only grazes the edge.
  let frame = frame_led(P, dimmer);
  let frame_core = vec3f(1.0, 0.9, 0.62) * frame.x * 0.25;
  let frame_glow = vec3f(1.0, 0.76, 0.28) * frame.y * 0.3;
  col += frame_core * outside + frame_glow * (outside * 0.5 + inside * 0.25);
  col += outside * base * frame_glow * (1.0 + metal * 3.5);

  // Downlights, and their beams made visible by the studio haze.
  var haze = fbm(vec2f(p.x * 3.2 + u.time * 0.011, p.y * 5.0 - u.time * 0.005) + fbm(p * 2.0 - u.time * 0.004));
  haze = smoothstep(0.3, 0.95, haze);
  var beams = 0.0;
  for (var i = 0; i < {{DOWNLIGHT_COUNT}}; i++) {
    let lamp = u.downlights[i].xy * PLATE_PX;
    col += outside * downlight(P, lamp);
    beams += downlight_beam(P, lamp);
  }
  col += outside * vec3f(1.0, 0.76, 0.46) * beams * (0.008 + haze * 0.035);

  // Reflection of the TV in the polished marble: one blurred copy of the screen, with the same three
  // rows of tiles, and nothing outside it. The mirrored TV is taller than the visible floor, so it
  // is shortened by REFLECTION_HEIGHT until all of it fits between the plinth and the bottom of the
  // frame. At the foot of the plinth it has the TV's exact width; from there every point runs along
  // its ray from the vanishing point, so its sides are parallel to the lines of the side walls.
  let floor_mask = smoothstep(u.floor_y - 0.004, u.floor_y + 0.01, p.y);
  if (floor_mask > 0.0) {
    let REFLECTION_HEIGHT = 0.6;
    // Distance from the seam in the reflected wall; blur and fade grow with it.
    let source = max(p.y - u.mirror_y, 0.0) / REFLECTION_HEIGHT;
    let wall_y = u.mirror_y - source;
    let spread = (u.floor_y - u.vanish.y) / max(p.y - u.vanish.y, 1e-3);
    let rx = u.vanish.x + (p.x - u.vanish.x) * spread;
    // A slow wobble across, as if the stone were not perfectly flat.
    let wobble = (fbm(vec2f(p.x * 6.0, p.y * 40.0)) - 0.5) * 0.006;
    let sr = to_screen(vec2f(rx + wobble, wall_y));
    // Outside the mirrored screen there is nothing to reflect.
    let fade_edge = 0.008 + source * 0.03;
    let mr = smoothstep(vec2f(0.0), vec2f(fade_edge), sr) * smoothstep(vec2f(0.0), vec2f(fade_edge), 1.0 - sr);
    // Blurred into hues, with a short smear down the floor that stays inside the screen.
    let lod = 3.6 + source * 2.5;
    let smear = 0.02 + source * 0.08;
    var reflection = vec3f(0.0);
    var total = 0.0;
    for (var k = -3; k <= 3; k++) {
      let t = f32(k) / 3.0;
      let w = exp(-t * t * 2.0);
      reflection += wall(clamp(sr + vec2f(0.0, t * smear), vec2f(0.0), vec2f(1.0)), lod) * w;
      total += w;
    }
    reflection /= total;
    // Black marble mutes what it reflects: less light and a little less colour.
    reflection = mix(reflection, vec3f(dot(reflection, vec3f(0.3, 0.59, 0.11))), vec3f(0.2));
    let strength = 0.14 * exp(-source * 1.2) * floor_mask;
    col += reflection * mr.x * mr.y * strength;

    // The frame LED line, mirrored in the marble and softened by it.
    let frame_mirror = frame_led(vec2f(rx, wall_y) * PLATE_PX, led_level(rx * PLATE_PX.x));
    col += vec3f(1.0, 0.78, 0.3) * frame_mirror.y * 0.05 * exp(-source * 5.0) * floor_mask;
    // The bolts flash across the whole wet-look floor.
    col += u.flash.rgb * flash_fall * 0.05 * exp(-source * 2.0) * floor_mask;
  }

  // Arcs crawl over the columns while the strike plays.
  var arcs = vec3f(0.0);
  var spill = 0.0;
  for (var i = 0; i < {{PILLAR_COUNT}}; i++) {
    let intensity = u.pillars[i];
    if (intensity <= 0.001) {
      continue;
    }
    let base_y = u.pillar_base[i] * PLATE_PX.y;
    spill += column_spill(i, P, intensity);
    if (P.y < base_y) {
      let a = column_arcs(i, P, intensity);
      arcs += vec3f(1.7, 1.5, 1.2) * a.x + vec3f(1.0, 0.62, 0.22) * a.y;
    } else {
      // The polished floor mirrors the arcs under the foot of the column, blurred.
      let below = P.y - base_y;
      let a = column_arcs(i, vec2f(P.x + (fbm(P * 0.05) - 0.5) * 6.0, base_y - below * 1.1), intensity);
      arcs += vec3f(1.0, 0.62, 0.22) * (a.x * 0.2 + a.y * 0.5) * exp(-below / 90.0) * 0.5;
    }
  }
  // Gold under the arcs lights up; the room around each column catches its light too.
  let arc_light = vec3f(1.0, 0.72, 0.4) * spill;
  col += outside * (base * arc_light * (1.2 + metal * 5.0) + arcs * (0.55 + 0.45 * metal));

  // Dust and sparks in the air, lit by the wall, the bolts and the columns.
  // Motes drifting through a downlight beam or past the LED cove catch its light.
  let lamp_light = beams * 0.35 + led_mid * 0.5;
  col += air_particles(p, spill * 0.3 + lamp_light, dot(u.flash.rgb, vec3f(0.33)) * flash_fall) * (1.0 - inside * 0.5);

  // Thin studio haze, only visible where the wall light passes through it.
  col += outside * haze * (edge * near * 0.04 + u.flash.rgb * flash_fall * 0.05 + average * 0.01);

  // Lens halo around the bright wall.
  col += wall(sc, 7.0) * exp(-d * 16.0) * 0.04 * outside;

  col = to_display(col);
  // gl_FragCoord counts rows from the bottom; keep the grain pattern of the web version.
  let gl_frag = vec2f(frag.x, u.res.y - frag.y);
  let grain = hash(gl_frag + fract(u.time * 7.31) * vec2f(113.0, 71.0)) - 0.5;
  col += grain * 0.012;

  if (u.debug > 0.5) {
    let border = (1.0 - smoothstep(0.0, fw.x * 2.0, min(min(s.x, 1.0 - s.x), min(s.y, 1.0 - s.y)))) * step(abs(s.x - 0.5), 0.5 + fw.x * 2.0) * step(abs(s.y - 0.5), 0.5 + fw.y * 2.0);
    col = mix(col, vec3f(0.0, 1.0, 0.3), vec3f(border));
    let lines = step(abs(p.y - u.mirror_y), 0.0015) + step(abs(p.y - u.floor_y), 0.0015) + step(abs(p.y - u.horizon), 0.0015);
    col = mix(col, vec3f(1.0, 0.8, 0.0), vec3f(clamp(lines, 0.0, 1.0)));
  }

  return vec4f(col, 1.0);
}
