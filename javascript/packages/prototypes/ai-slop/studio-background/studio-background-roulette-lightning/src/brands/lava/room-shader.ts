// The lava hall's room: the plate, the TV set into its glass, the TV's light on black stone, LED
// lines with beams running along them, living neon, and lava that flows through the cracks.
// Two passes: the room's own light into a mip-mapped target, then the final frame, which draws the
// room sharp and takes the glow of its lights from the target's mips.

import { NOISE } from "../../core/glsl";
import { LENGTH_UNIT } from "./lines";
import { calibration } from "./plate";

const LAMP_COUNT = calibration.lamps.length;

// Uniforms that both passes read to light the plate.
const SHARED_UNIFORMS = /* glsl */ `
uniform sampler2D uImage;
uniform sampler2D uMasks;
// Traced LED segments, read texel by texel: id, position along the segment, length / ${LENGTH_UNIT}.
uniform highp sampler2D uLines;
uniform float uTime;
uniform vec2 uVanish;
uniform float uCeilingY;
uniform vec4 uLamps[${LAMP_COUNT}];
uniform float uLampBases[${LAMP_COUNT}];
// Seconds since the lightning sequence started, -1 outside the power surge that opens it.
uniform float uSurge;
// Mains power: 1 at rest, lower while the bolts draw it down.
uniform float uPower;
uniform vec4 uFlash;
uniform float uImageAspect;
`;

// The plate brought to life: lamps, LED lines and lava. Both passes shade the plate with it.
const EMITTERS = /* glsl */ `
vec3 toLinear(vec3 c) {
  return pow(max(c, 0.0), vec3(2.2));
}

// Brightness of the neon lamps and the downlights at p. Every lamp breathes at its own pace, a soft
// band of light climbs through its glass, and now and then a tube stutters like old neon. A lamp's
// reflection is read at the mirrored height, so the band climbs down the reflection in step.
float lampGain(vec2 p) {
  // The downlights twinkle a little, each on its own.
  float gain = 1.0 + 0.1 * sin(uTime * 1.3 + p.x * 90.0) * sin(uTime * 0.7 + p.x * 41.0);
  for (int i = 0; i < ${LAMP_COUNT}; i++) {
    vec4 box = uLamps[i];
    float margin = 0.005;
    float column = smoothstep(box.x - margin, box.x, p.x) * (1.0 - smoothstep(box.z, box.z + margin, p.x));
    if (column <= 0.0) {
      continue;
    }
    float base = uLampBases[i];
    float y = p.y > base ? 2.0 * base - p.y : p.y;
    float v = clamp((box.w - y) / (box.w - box.y), 0.0, 1.0);
    float fi = float(i);
    float breath = 0.9 + 0.12 * sin(uTime * (0.55 + 0.13 * fi) + fi * 2.1);
    float head = fract(uTime * (0.07 + 0.02 * hash(vec2(fi, 3.0))) + fi * 0.27) * 1.7 - 0.35;
    float band = exp(-pow((v - head) / 0.13, 2.0));
    float hum = 0.96 + 0.04 * noise(vec2(uTime * 38.0, fi * 7.0));
    // A stutter: in a random second out of every few, the tube flickers.
    float window = floor(uTime * 0.6 + fi * 0.37);
    float stutter = hash(vec2(window, fi)) > 0.88 ? 0.55 + 0.45 * step(0.35, noise(vec2(uTime * 24.0, fi * 5.0))) : 1.0;
    gain = mix(gain, breath * hum * stutter * (1.0 + 0.35 * band), column);
  }
  // The bolts draw the mains down: the lamps sag and stutter while they strike.
  float sag = mix(1.0, 0.75 + 0.25 * noise(vec2(uTime * 60.0, 3.0)), 1.0 - uPower);
  return gain * uPower * sag;
}

// Beams of light running along one LED segment. Each segment has two beam lanes with their own
// period, and every cycle rolls again: whether a beam fires, how fast it runs and which way.
// Nothing is in step, so the floor never pulses as one. d and len are in plate pixels.
float segmentBeams(float id, float d, float len, float pace) {
  float total = 0.0;
  for (int k = 0; k < 2; k++) {
    float seed = id * 17.13 + float(k) * 5.71;
    float period = mix(2.2, 6.5, hash(vec2(seed, 1.0))) * pace;
    float clock = uTime + hash(vec2(seed, 2.0)) * period;
    float cycle = floor(clock / period);
    float local = clock - cycle * period;
    float roll = hash(vec2(seed + 0.5, cycle));
    if (roll < 0.2) {
      continue;
    }
    float speed = mix(300.0, 900.0, hash(vec2(seed + 3.0, cycle))) / pace;
    float dir = hash(vec2(seed + 9.0, cycle)) < 0.5 ? 1.0 : -1.0;
    float travel = local * speed - 120.0;
    if (travel > len + 600.0) {
      continue;
    }
    float head = dir > 0.0 ? travel : len - travel;
    float behind = (head - d) * dir;
    float beam = exp(-pow((d - head) / 28.0, 2.0)) + (behind > 0.0 ? exp(-behind / 240.0) * 0.55 : 0.0);
    total += beam * mix(0.8, 1.3, roll);
  }
  return total;
}

// Brightness of the LED lines at p. Every traced segment glows at its own level and breathes slowly;
// beam is the light of the random beams running along it, added on top. The ceiling runs slower and
// softer than the floor. The lightning sequence opens with a surge: one hot front races from the
// edges of the room into the screen.
float ledGain(vec2 p, out float beam, out float surge) {
  ivec2 size = textureSize(uLines, 0);
  vec4 texel = texelFetch(uLines, clamp(ivec2(p * vec2(size)), ivec2(0), size - 1), 0);
  float id = floor(texel.r * 255.0 + 0.5);
  bool ceiling = p.y < uCeilingY;
  float gain;
  beam = 0.0;
  if (id > 0.0) {
    float len = texel.b * 255.0 * ${LENGTH_UNIT}.0;
    float d = texel.g * len;
    float h = hash(vec2(id, 11.0));
    float breath = 0.5 + 0.5 * sin(uTime * mix(0.25, 0.7, h) + h * 40.0);
    float pace = ceiling ? 1.9 : 1.0;
    float level = ceiling ? 0.75 + 0.3 * breath : 0.5 + 0.2 * breath;
    gain = level;
    beam = segmentBeams(id, d, len, pace) * (ceiling ? 0.7 : 1.0);
  } else {
    gain = 0.85 + 0.15 * sin(uTime * 0.5 + p.x * 20.0);
  }
  surge = 0.0;
  if (uSurge >= 0.0) {
    float dv = length((p - uVanish) * vec2(uImageAspect, 1.0));
    float front = 1.15 - uSurge * 1.7;
    float ahead = dv - front;
    float trail = ahead > 0.0 ? exp(-ahead / 0.18) * 0.55 : 0.0;
    surge = (exp(-pow(ahead / 0.022, 2.0)) + trail) * smoothstep(0.2, 0.36, front + 0.02);
  }
  return gain * mix(1.0, uPower, 0.6) + surge * 2.6;
}

// Colour of lava by its heat: black crust, deep red, orange, yellow, and white where it is hottest.
vec3 lavaRamp(float heat) {
  vec3 c = mix(vec3(0.02, 0.002, 0.0), vec3(0.5, 0.025, 0.004), smoothstep(0.0, 0.3, heat));
  c = mix(c, vec3(1.0, 0.2, 0.015), smoothstep(0.25, 0.6, heat));
  c = mix(c, vec3(1.0, 0.55, 0.1), smoothstep(0.55, 0.95, heat));
  c = mix(c, vec3(1.0, 0.9, 0.55), smoothstep(0.95, 1.5, heat));
  return c;
}

// Heat of the lava in a crack. core is how hot the plate paints the crack. Molten light rolls up
// through the cracks in slow, warped streams, the seams swell and cool in patches, and the surface
// shimmers. The bolts make the lava flare.
float lavaHeat(vec2 p, float core) {
  vec2 q = p * vec2(uImageAspect, 1.0) * 24.0;
  vec2 warp = vec2(fbm(q * 0.3 + vec2(0.0, uTime * 0.1)), fbm(q * 0.3 + vec2(4.1, uTime * 0.08)));
  float flow = fbm(q * 0.7 + warp * 2.4 - vec2(uTime * 0.04, uTime * 0.32));
  float swell = 0.7 + 0.45 * sin(uTime * 0.6 + fbm(q * 0.08 + uTime * 0.02) * 14.0);
  float shimmer = 0.92 + 0.08 * noise(vec2(uTime * 9.0, q.x * 0.6 + q.y * 0.4));
  float flare = dot(uFlash.rgb, vec3(0.33)) * 0.5;
  float heat = core * (0.3 + 1.3 * smoothstep(0.3, 0.78, flow)) * swell * shimmer;
  return heat * mix(1.0, uPower, 0.4) + flare * core;
}

// One pixel of the plate brought to life: its colour, and the part of it that emits light.
struct Shade {
  vec3 color;
  vec3 glow;
};

Shade shadePlate(vec2 p) {
  vec4 masks = texture(uMasks, p);
  float lamp = masks.g;
  float strip = masks.b;
  float magma = masks.a;
  vec3 srgb = texture(uImage, p).rgb;
  vec3 base = toLinear(srgb);
  float beam;
  float surge;
  float ledLight = ledGain(p, beam, surge);
  vec3 color = base * mix(1.0, lampGain(p), lamp) * mix(1.0, ledLight, strip);
  // A beam burns hot orange with a yellow-white core; a surge runs whiter still.
  color += strip * (vec3(1.0, 0.42, 0.1) * min(beam, 1.0) * 2.4 + vec3(1.0, 0.8, 0.45) * max(beam - 0.6, 0.0) * 1.6);
  color += vec3(1.0, 0.85, 0.6) * strip * surge * 0.35;
  vec3 glow = color * max(lamp, strip);
  if (magma > 0.01) {
    float core = smoothstep(0.12, 0.9, srgb.r) * (0.55 + 0.8 * srgb.g);
    vec3 lava = lavaRamp(lavaHeat(p, core));
    float k = magma * smoothstep(0.02, 0.2, core);
    color = mix(color, lava, k);
    glow += lava * k;
  }
  return Shade(color, glow);
}
`;

// The light the room emits, in plate space: lamps, LED lines and lava. Its mips are the glow around them.
const EMISSION_FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform vec2 uRes;
${SHARED_UNIFORMS}
out vec4 outColor;

${NOISE}

${EMITTERS}
void main() {
  vec2 p = vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y);
  outColor = vec4(shadePlate(p).glow, 1.0);
}
`;

// Final frame: the plate, the video wall inside the glass, and the wall's light in the room.
const COMPOSITE_FRAG = /* glsl */ `#version 300 es
precision highp float;

${SHARED_UNIFORMS}uniform sampler2D uContent;
uniform sampler2D uEmission;
uniform float uLevels;
uniform mat3 uToScreen;
uniform vec4 uCover;
uniform vec2 uRes;
uniform vec4 uRect;
uniform vec2 uNotch;
uniform float uMirrorY;
uniform float uFloorY;
uniform float uHorizon;
uniform float uScreenAspect;
uniform float uDebug;

out vec4 outColor;

${NOISE}

${EMITTERS}
vec2 toScreen(vec2 p) {
  vec3 h = uToScreen * vec3(p, 1.0);
  return h.xy / h.z;
}

vec3 toDisplay(vec3 c) {
  return pow(max(c, 0.0), vec3(1.0 / 2.2));
}

vec3 wall(vec2 s, float lod) {
  return toLinear(textureLod(uContent, vec2(s.x, 1.0 - s.y), lod).rgb);
}

// LED panels clip softly instead of hard.
vec3 ledTone(vec3 c) {
  vec3 k = 0.8 + 0.2 * (1.0 - exp(-(c - 0.8) / 0.2));
  return mix(c, k, step(0.8, c));
}

// Ground-plane coordinates of a floor pixel: x across, z depth.
vec2 floorPlane(vec2 p) {
  float z = 1.0 / max(p.y - uHorizon, 0.02);
  return vec2((p.x - uVanish.x) * uImageAspect * z, z);
}

// Dust hanging in the air, only seen where light passes through it.
float dust(vec2 q) {
  float total = 0.0;
  for (int layer = 0; layer < 3; layer++) {
    float fl = float(layer);
    float scale = 22.0 + fl * 17.0;
    vec2 g = q * scale + vec2(uTime * (0.05 + fl * 0.03), -uTime * (0.08 + fl * 0.02)) + fl * 11.7;
    vec2 cell = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash(cell + fl * 3.7);
    if (h < 0.93) {
      continue;
    }
    vec2 off = (vec2(hash(cell + 1.3), hash(cell + 7.1)) - 0.5) * 0.6;
    off += 0.12 * vec2(sin(uTime * 0.7 + h * 40.0), cos(uTime * 0.5 + h * 20.0));
    float r = length(f - off);
    float twinkle = 0.55 + 0.45 * sin(uTime * (1.5 + h * 3.0) + h * 60.0);
    total += exp(-r * r * (1400.0 - fl * 300.0)) * twinkle * (1.0 - fl * 0.3);
  }
  return total;
}

void main() {
  vec2 c = vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y);
  vec2 p = uCover.xy + c * uCover.zw;
  Shade shade = shadePlate(p);
  vec3 base = shade.color;
  float sheen = texture(uMasks, p).r;

  vec2 s = toScreen(p);
  vec2 fw = fwidth(s) * 1.25;
  vec2 m = smoothstep(vec2(0.0), fw, s) * smoothstep(vec2(0.0), fw, 1.0 - s);
  // The corner steps of a frame stay in front of the screen (this frame has none).
  vec2 fromCorner = min(s, 1.0 - s) - uNotch;
  vec2 n = smoothstep(vec2(0.0), fw, fromCorner);
  float inside = m.x * m.y * (1.0 - (1.0 - n.x) * (1.0 - n.y));
  float outside = 1.0 - inside;

  // Video wall emission. It replaces the marble glass of the plate.
  vec3 sharp = texture(uContent, vec2(s.x, 1.0 - s.y)).rgb;
  vec3 bloom = textureLod(uContent, vec2(s.x, 1.0 - s.y), 3.0).rgb * 0.12
             + textureLod(uContent, vec2(s.x, 1.0 - s.y), 5.0).rgb * 0.08;
  vec3 emit = toLinear(ledTone(sharp + bloom));
  // The glass sits recessed in its bezel: a soft contact shadow along the edges.
  vec2 edgeDist = min(s, 1.0 - s) * vec2(uScreenAspect, 1.0);
  float recess = smoothstep(0.0, 0.03, min(edgeDist.x, edgeDist.y));
  emit *= 0.5 + 0.5 * recess;
  // Grazing reflections of the frame and the columns in the glass near its edges.
  vec2 mirrorX = vec2(s.x < 0.5 ? 2.0 * uRect.x - p.x : 2.0 * uRect.z - p.x, p.y);
  vec2 mirrorY = vec2(p.x, 2.0 * uRect.y - p.y);
  vec3 sideRefl = toLinear(textureLod(uImage, mirrorX, 2.5).rgb) * exp(-edgeDist.x * 10.0);
  vec3 topRefl = toLinear(textureLod(uImage, mirrorY, 2.5).rgb) * exp(-edgeDist.y * 12.0);
  float lit = clamp(dot(emit, vec3(0.33)) * 3.0, 0.0, 1.0);
  vec3 glass = (sideRefl * 0.06 + topRefl * 0.04) * (1.0 - 0.6 * lit);
  float streak = smoothstep(0.3, 0.0, abs(s.x * 0.55 - s.y + 0.1)) * 0.002;
  vec3 col = base * outside + (emit + glass + streak) * inside;

  // The lamps, the LED lines and the lava emit light: their glow spreads over the stone around them,
  // and a little of it over the glass.
  vec2 ep = vec2(p.x, 1.0 - p.y);
  vec3 roomGlow = textureLod(uEmission, ep, 1.0).rgb * 0.14
                + textureLod(uEmission, ep, 2.5).rgb * 0.16
                + textureLod(uEmission, ep, 4.0).rgb * 0.16
                + textureLod(uEmission, ep, 5.5).rgb * 0.12;
  col += roomGlow * (outside + inside * 0.25);

  // Light the wall throws into the room. The lit facets of the stone throw most of it back.
  vec2 aspect = vec2(uImageAspect, 1.0);
  vec2 q = p * aspect;
  vec2 dd = max(max(uRect.xy * aspect - q, q - uRect.zw * aspect), 0.0);
  float d = length(dd);
  float near = 1.0 / (1.0 + d * d * 140.0);
  vec2 sc = clamp(s, 0.0, 1.0);
  vec3 edge = wall(sc, 6.0);
  vec3 average = wall(vec2(0.5), uLevels);
  vec2 flashAt = vec2(uFlash.w, mix(uRect.y, uRect.w, 0.3)) * aspect;
  float fd = length(q - flashAt);
  float flashFall = 1.0 / (1.0 + fd * fd * 4.0);
  vec3 flash = uFlash.rgb * (0.15 + flashFall * 1.6);
  vec3 light = edge * near * 3.0 + average * 0.8 + flash;
  float response = 0.3 + sheen * 1.9;
  col += outside * (base * light * response * 1.4 + light * near * 0.003);

  // Reflection in the polished stone, mirrored about the wall-floor seam. It is squeezed into a band
  // right in front of the wall, and widens towards the camera along the floor lines.
  float floorMask = smoothstep(uFloorY - 0.003, uFloorY + 0.01, p.y);
  if (floorMask > 0.0) {
    const float squeeze = 0.45;
    float dist = p.y - uMirrorY;
    // Height of the reflected point above the seam; blur and fade follow it, not the squeezed floor.
    float source = dist / squeeze;
    // Follow the floor lines exactly: every point stays on its ray to the vanishing point.
    // The reflection keeps its true width at the reflected bottom edge of the screen, so the
    // reflected board sits right under the real one.
    float trueWidthY = uMirrorY + squeeze * (uMirrorY - uRect.w);
    float spread = (trueWidthY - uVanish.y) / max(p.y - uVanish.y, 1e-3);
    vec2 ripple = (vec2(fbm(p * vec2(40.0, 14.0)), fbm(p * vec2(40.0, 14.0) + 7.3)) - 0.5) * 0.006;
    vec2 sr = toScreen(vec2(uVanish.x + (p.x - uVanish.x) * spread, uMirrorY - source) + ripple);
    float soft = 0.012 + source * 0.25;
    vec2 mr = smoothstep(-soft, soft, sr) * smoothstep(-soft, soft, 1.0 - sr);
    float lod = 0.9 + source * 9.5;
    vec3 reflection = wall(clamp(sr, 0.0, 1.0), lod);
    // Dark stone mutes what it reflects: much less light and less colour.
    reflection = mix(reflection, vec3(dot(reflection, vec3(0.3, 0.59, 0.11))), 0.35);
    // The inlay lines and the cracks break the mirror; the black stone keeps it.
    float veins = 0.75 + 0.25 * fbm(p * vec2(60.0, 30.0));
    float stone = (1.0 - 0.6 * sheen) * veins;
    float strength = 0.3 * exp(-source * 2.9) * floorMask * stone;
    col += reflection * mr.x * mr.y * strength;

    // The lit screen as a whole: a soft glow at the screen's own width that starts at the seam,
    // so the reflection reads as coming from the screen. It widens along the floor lines too.
    vec2 sg = toScreen(vec2(uVanish.x + (p.x - uVanish.x) * spread, uMirrorY - source));
    float glowEdge = 0.04 + source * 0.3;
    vec2 mg = smoothstep(-glowEdge, glowEdge, sg) * smoothstep(-glowEdge, glowEdge, 1.0 - sg);
    vec3 glow = wall(clamp(sg, 0.0, 1.0), 6.5);
    col += glow * mg.x * mg.y * 0.5 * exp(-source * 3.5) * floorMask * stone;

    // The lit screen as an area light: a soft pool on the marble in front of the wall.
    vec2 fp = floorPlane(p);
    float pool = exp(-pow(fp.x / 4.0, 2.0)) * smoothstep(1.2, 3.8, fp.y);
    col += (average * 1.4 + flash * 0.25) * pool * 0.05 * floorMask;
  }

  // Dust in the air, lit by the wall and the bolts; strongest in the light cone in front of the screen.
  vec2 fromScreen = (p - vec2(0.5 * (uRect.x + uRect.z), uRect.w)) * aspect;
  float cone = exp(-pow(fromScreen.x / 0.9, 2.0)) * smoothstep(0.7, 0.1, abs(fromScreen.y));
  vec3 airLight = average * 3.0 + flash * 1.4 + edge * near;
  col += dust(q) * outside * airLight * cone * 0.22;

  // Thin haze: a veil of the wall's light hanging in the air.
  float haze = fbm(vec2(p.x * 3.0 + uTime * 0.01, p.y * 4.5 - uTime * 0.006) + fbm(p * 2.0 - uTime * 0.004));
  haze = smoothstep(0.3, 0.95, haze);
  col += outside * haze * (edge * near * 0.05 + flash * flashFall * 0.05 + average * 0.02);

  // Lens halo around the bright wall.
  col += wall(sc, 7.0) * exp(-d * 14.0) * 0.05 * outside;

  // Lens: a soft vignette.
  vec2 vc = c - 0.5;
  col *= 1.0 - dot(vc, vc) * 0.35;

  col = toDisplay(col);
  float grain = hash(gl_FragCoord.xy + fract(uTime * 7.31) * vec2(113.0, 71.0)) - 0.5;
  col += grain * 0.012;

  if (uDebug > 0.5) {
    float border = (1.0 - smoothstep(0.0, fw.x * 2.0, min(min(s.x, 1.0 - s.x), min(s.y, 1.0 - s.y)))) * step(abs(s.x - 0.5), 0.5 + fw.x * 2.0) * step(abs(s.y - 0.5), 0.5 + fw.y * 2.0);
    col = mix(col, vec3(0.0, 1.0, 0.3), border);
    float lines = step(abs(p.y - uMirrorY), 0.0015) + step(abs(p.y - uFloorY), 0.0015) + step(abs(p.y - uHorizon), 0.0015);
    col = mix(col, vec3(1.0, 0.8, 0.0), clamp(lines, 0.0, 1.0));
  }

  outColor = vec4(col, 1.0);
}
`;

export { COMPOSITE_FRAG, EMISSION_FRAG };
