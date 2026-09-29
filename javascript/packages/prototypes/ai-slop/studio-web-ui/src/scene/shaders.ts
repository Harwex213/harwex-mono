import { NEON_BLADES } from "./calibration";

// GLSL sources. Conventions: every UV is y-down (0 at the top), matching the images.
// Render targets are y-up, so content samples flip v.

const NOISE = /* glsl */ `
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amp * noise(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    amp *= 0.5;
  }
  return value;
}
`;

const FULLSCREEN_VERT = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

// Video wall background: night clouds lit by the bolts.
const CONTENT_FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform float uAspect;
uniform sampler2D uClouds;
uniform vec4 uBolts[16];
uniform int uBoltCount;
uniform vec3 uSheet;

out vec4 outColor;

${NOISE}

void main() {
  vec2 s = vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y);
  vec2 q = vec2(s.x * uAspect, s.y);

  // Two drifting cloud layers, domain-warped so the billows slowly roll.
  vec2 warp = vec2(fbm(q * 2.1 + vec2(uTime * 0.021, 0.0)), fbm(q * 2.1 + vec2(5.2, uTime * 0.017))) - 0.5;
  vec3 far = texture(uClouds, q * 0.36 + vec2(uTime * 0.0032, 0.22) + warp * 0.045).rgb;
  vec3 near = texture(uClouds, q * 0.62 + vec2(uTime * 0.0078 + 0.37, 0.08) + warp.yx * 0.075).rgb;
  vec3 clouds = mix(far, near, 0.4);
  clouds = pow(clouds, vec3(1.2)) * 0.78;
  float density = dot(clouds, vec3(0.3, 0.5, 0.2));

  // Light from the bolts inside the cloud deck and along each channel.
  float glow = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= uBoltCount) {
      break;
    }
    vec4 b = uBolts[i];
    vec2 d = vec2((s.x - b.x) * uAspect, (s.y - 0.05) * 0.75);
    glow += b.y * exp(-dot(d, d) * 7.0);
    float channel = exp(-abs((s.x - b.x) * uAspect) * 18.0) * step(s.y, b.z);
    glow += b.y * channel * 0.35;
  }
  vec2 sd = vec2((s.x - uSheet.x) * uAspect, s.y - uSheet.y);
  glow += uSheet.z * exp(-dot(sd, sd) * 5.0) * 0.7;

  vec3 col = clouds * (1.0 + glow * vec3(2.4, 2.7, 3.8) * (0.35 + density * 2.6));
  col += glow * vec3(0.03, 0.04, 0.1);

  // Screen-space vignette so the layout reads first.
  vec2 v = s - 0.5;
  col *= 1.0 - dot(v * vec2(0.9, 1.2), v * vec2(0.9, 1.2)) * 0.9;

  outColor = vec4(col, 1.0);
}
`;

const SPRITE_VERT = /* glsl */ `#version 300 es
layout(location = 0) in vec4 aRect;
layout(location = 1) in vec3 aData;

uniform vec2 uAtlasGrid;

out vec2 vUv;
out vec2 vLocal;
out float vIntensity;

void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 s = aRect.xy + corner * aRect.zw;
  gl_Position = vec4(s.x * 2.0 - 1.0, 1.0 - s.y * 2.0, 0.0, 1.0);
  float u = aData.y > 0.5 ? 1.0 - corner.x : corner.x;
  float cell = aData.x;
  vec2 origin = vec2(mod(cell, uAtlasGrid.x), floor(cell / uAtlasGrid.x));
  vUv = (origin + vec2(u, corner.y)) / uAtlasGrid;
  vLocal = corner;
  vIntensity = aData.z;
}
`;

const SPRITE_FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uAtlas;

in vec2 vUv;
in vec2 vLocal;
in float vIntensity;

out vec4 outColor;

void main() {
  vec3 layers = texture(uAtlas, vUv).rgb;
  float fade = smoothstep(0.0, 0.12, vLocal.y) * (1.0 - smoothstep(0.94, 1.0, vLocal.y));
  // The halo is wider than the sprite; fade it out before the quad edge leaves a seam.
  fade *= smoothstep(0.0, 0.2, vLocal.x) * (1.0 - smoothstep(0.8, 1.0, vLocal.x));
  vec3 col = layers.r * vec3(2.6, 2.6, 2.9)
           + layers.g * vec3(0.55, 0.72, 1.7)
           + layers.b * vec3(0.32, 0.28, 1.25) * 0.9;
  outColor = vec4(col * vIntensity * fade, 1.0);
}
`;

// One roulette tile per instance. Local space: x spans the tile width (-0.5..0.5), y down, same scale.
const TILE_VERT = /* glsl */ `#version 300 es
layout(location = 0) in vec4 aRect;
layout(location = 1) in vec4 aInfo;
layout(location = 2) in vec4 aState;
layout(location = 3) in float aDischarge;

uniform float uAspect;

out vec2 vLocal;
flat out vec2 vHalf;
flat out vec4 vInfo;
flat out vec4 vState;
flat out float vDischarge;
flat out float vFacing;
flat out float vCenterX;

// Room around the tile for its glow and shock rings, in tile widths.
const float MARGIN = 0.34;

void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 halfSize = vec2(0.5, 0.5 * aRect.w / (aRect.z * uAspect));
  vec2 local = mix(-halfSize - MARGIN, halfSize + MARGIN, corner);

  // Punch on impact, a small dip when the charge leaves.
  float age = aState.w;
  float scale = 1.0;
  if (age >= 0.0) {
    scale += 0.1 * exp(-age * 6.0) * sin(min(age, 1.0) * 9.0);
  }
  if (aDischarge >= 0.0) {
    scale -= 0.035 * exp(-aDischarge * 5.0) * sin(min(aDischarge, 1.0) * 7.0);
  }

  // Card flip around the horizontal axis, with real perspective.
  float theta = aState.x;
  vec3 p = vec3(local.x, local.y * cos(theta), local.y * sin(theta)) * scale;
  float distance = 3.5 + halfSize.y * 2.0;
  float w = (distance + p.z) / distance;
  vec2 centre = aRect.xy + aRect.zw * 0.5;
  vec2 uv = centre + vec2(p.x * aRect.z, p.y * aRect.z * uAspect) / w;
  gl_Position = vec4(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0) * w;

  vLocal = local;
  vHalf = halfSize;
  vInfo = aInfo;
  vState = aState;
  vDischarge = aDischarge;
  vFacing = cos(theta);
  vCenterX = centre.x;
}
`;

const TILE_FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uGlyphs;
uniform vec2 uGlyphGrid;
uniform float uTime;

in vec2 vLocal;
flat in vec2 vHalf;
flat in vec4 vInfo;
flat in vec4 vState;
flat in float vDischarge;
flat in float vFacing;
flat in float vCenterX;

out vec4 outColor;

${NOISE}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// Rounded rectangle; the zero tile also gets its pointed left side.
float tileSdf(vec2 p, vec2 h, bool zero) {
  float r = 0.045;
  float d = sdBox(p, h - r) - r;
  if (zero) {
    float tip = 0.26;
    vec2 a = vec2(-h.x + tip, h.y);
    vec2 n = normalize(vec2(-h.y, tip));
    d = max(d, dot(vec2(p.x, abs(p.y)) - a, n));
  }
  return d;
}

void main() {
  vec2 p = vLocal;
  // Seen from the back half of the flip, keep the numeral upright.
  if (vFacing < 0.0) {
    p.y = -p.y;
  }
  vec2 h = vHalf;
  bool zero = vInfo.z > 0.5;
  float seed = vInfo.w;
  float charge = vState.y;
  float flash = vState.z;
  float age = vState.w;

  float d = tileSdf(p, h, zero);
  float aa = max(fwidth(d), 1e-4);
  float body = 1.0 - smoothstep(-aa, aa, d);

  vec3 cream = vec3(0.99, 0.96, 0.84);
  vec3 ink = vInfo.y < 0.5 ? cream : (vInfo.y < 1.5 ? vec3(0.92, 0.21, 0.16) : vec3(0.36, 0.56, 0.26));
  vec3 electric = vec3(0.55, 0.78, 1.0);
  float flicker = 0.82 + 0.18 * noise(vec2(uTime * 32.0, seed * 91.0));

  // Smoked glass body: a lit top edge, an inner shadow, a faint underglow in the numeral colour.
  float gy = clamp(p.y / h.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 fill = mix(vec3(0.085, 0.08, 0.095), vec3(0.018, 0.018, 0.026), gy);
  fill += vec3(0.05) * (1.0 - smoothstep(0.0, 0.42, gy));
  fill += ink * 0.08 * smoothstep(0.35, 1.0, gy);
  fill *= 0.72 + 0.28 * smoothstep(0.0, 0.14, -d);

  // Charged: plasma drifts inside the glass and the rim glows from within.
  float plasma = fbm(p * 5.0 + vec2(seed * 13.0 + uTime * 0.7, -uTime * 0.5));
  fill += electric * charge * flicker * (0.05 + 0.6 * pow(plasma, 3.0) + 0.3 * exp(d * 16.0));

  // Rim: a cream line with brighter corners; when charged, arcs and sparks run around it.
  float bw = 0.016;
  float rim = 1.0 - smoothstep(0.0, aa * 1.3, abs(d + bw * 0.5) - bw * 0.5);
  float hair = 1.0 - smoothstep(0.0, aa, abs(d + 0.055) - 0.003);
  vec2 q = abs(p) / h;
  float cornerAccent = smoothstep(0.62, 0.9, q.x) * smoothstep(0.45, 0.85, q.y);
  float ang = atan(p.y / h.y, p.x / h.x) / 6.28318;
  float arcs = noise(vec2(ang * 34.0 + seed * 50.0, uTime * 9.0)) * noise(vec2(ang * 11.0 - uTime * 2.0, seed * 20.0));
  arcs = smoothstep(0.2, 0.65, arcs);
  float head = fract(uTime * 0.55 + seed);
  float spark = exp(-abs(fract(ang - head + 0.5) - 0.5) * 70.0)
              + 0.6 * exp(-abs(fract(ang + head * 1.3 + 0.5) - 0.5) * 90.0);
  vec3 rimColor = mix(cream * (0.5 + 0.5 * cornerAccent), electric * 0.75, charge);
  rimColor += electric * charge * flicker * (arcs * 2.2 + spark * 3.2);

  // Numeral.
  vec2 gp = p;
  if (zero) {
    gp.x -= 0.1;
  }
  vec2 guv = gp / 0.96 + 0.5;
  float glyph = 0.0;
  float glyphGlow = 0.0;
  if (all(greaterThan(guv, vec2(0.0))) && all(lessThan(guv, vec2(1.0)))) {
    vec2 slot = vec2(mod(vInfo.x, uGlyphGrid.x), floor(vInfo.x / uGlyphGrid.x));
    vec2 auv = (slot + guv) / uGlyphGrid;
    glyph = texture(uGlyphs, auv).a;
    glyphGlow = textureLod(uGlyphs, auv, 3.5).a;
  }
  // Charged numerals keep their colour and burn brighter.
  vec3 inkColor = ink * (1.0 + charge * flicker * 0.9) + electric * charge * 0.04;

  // Premultiplied composite; glows add light without adding coverage.
  float fillAlpha = 0.8;
  vec3 rgb = fill * fillAlpha * body;
  float alpha = fillAlpha * body;
  rgb = mix(rgb, rimColor, rim);
  alpha = max(alpha, rim);
  rgb += cream * 0.12 * hair * body * (1.0 - 0.5 * charge);
  rgb = mix(rgb, inkColor, glyph);
  alpha = max(alpha, glyph);
  rgb += ink * glyphGlow * 0.16 + mix(electric, ink, 0.75) * glyphGlow * charge * flicker * 1.1;
  float outer = exp(-max(d, 0.0) * 20.0) * (1.0 - body);
  // Soft contact shadow lifts the tile off the clouds.
  alpha = max(alpha, exp(-max(d, 0.0) * 28.0) * 0.4 * (1.0 - body));
  rgb += electric * outer * charge * 0.4 * (0.8 + 0.2 * sin(uTime * 6.0 + seed * 6.28));

  // Idle glint travelling across the board.
  float sweep = fract(uTime / 7.0) * 1.6 - 0.3;
  float band = exp(-pow((vCenterX + p.x * 0.05 - p.y * 0.03 - sweep) * 20.0, 2.0));
  rgb += cream * band * (rim * 0.7 + body * 0.05) * (1.0 - charge);

  // Impact: white flash, then a shock ring leaving the rim.
  if (age >= 0.0) {
    rgb += vec3(0.85, 0.92, 1.1) * flash * (body * 0.9 + rim);
    float ring = exp(-pow((d - age * 0.4) / 0.016, 2.0)) * smoothstep(0.4, 0.0, age) * step(0.0, d);
    rgb += electric * ring * 1.6;
  }
  // The glass catches the light as it turns.
  rgb += vec3(0.6, 0.75, 1.0) * pow(abs(sin(vState.x)), 3.0) * body * 0.3;
  // Discharge: a last faint ring, the charge bleeding off.
  if (vDischarge >= 0.0 && vDischarge < 0.8) {
    float ring = exp(-pow((d - vDischarge * 0.3) / 0.015, 2.0)) * (1.0 - vDischarge / 0.8) * step(0.0, d);
    rgb += electric * ring * 0.8;
  }

  outColor = vec4(rgb, alpha);
}
`;

// Final frame: the studio plate, the video wall inside the glass, and the wall's light in the room.
const COMPOSITE_FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uImage;
uniform sampler2D uContent;
uniform float uLevels;
uniform mat3 uToScreen;
uniform vec4 uCover;
uniform vec2 uRes;
uniform float uTime;
uniform vec4 uRect;
uniform float uMirrorY;
uniform float uFloorY;
uniform vec4 uFlash;
uniform float uImageAspect;
uniform float uScreenAspect;
uniform float uDebug;
uniform sampler2D uMasks;
uniform float uHorizon;
uniform vec4 uBlades[${NEON_BLADES.length}];
uniform vec2 uBladeReflections[${NEON_BLADES.length}];
uniform vec2 uRuns[${NEON_BLADES.length}];

out vec4 outColor;

${NOISE}

vec2 toScreen(vec2 p) {
  vec3 h = uToScreen * vec3(p, 1.0);
  return h.xy / h.z;
}

vec3 toLinear(vec3 c) {
  return pow(max(c, 0.0), vec3(2.2));
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

// ---- Environment: the studio around the wall is alive too. ----

// Ground-plane coordinates of a floor pixel: x across, z depth.
vec2 floorPlane(vec2 p) {
  float z = 1.0 / max(p.y - uHorizon, 0.02);
  return vec2((p.x - 0.5) * uImageAspect * z, z);
}

// Fixtures breathe and flicker. Flicker depends on x only, so every light and its floor reflection stay in sync.
vec3 livingFixtures(vec3 base, vec2 p) {
  vec4 masks = texture(uMasks, p);
  float neon = clamp(masks.r - masks.a, 0.0, 1.0);
  float lanternGain = 0.75 + 0.5 * fbm(vec2(p.x * 11.0, uTime * 2.4));
  float warmGain = 0.85 + 0.3 * fbm(vec2(p.x * 7.0 + 3.1, uTime * 1.8));
  // Red light that belongs to no LED line (edges, stray reflections) drifts with position.
  float neonGain = 1.0 + 0.2 * sin(uTime * 1.3 + p.x * 17.0);
  vec3 runLight = vec3(0.0);
  float runBoost = 0.0;

  // Every LED line breathes, stutters and fires its runs on its own. The run goes up the line,
  // and its floor reflection runs down in step.
  for (int i = 0; i < ${NEON_BLADES.length}; i++) {
    vec4 blade = uBlades[i];
    vec2 reflection = uBladeReflections[i];
    float mirrored = 0.0;
    float v = -1.0;
    if (p.y >= blade.y - 0.01 && p.y <= blade.z + 0.01) {
      v = (blade.z - p.y) / (blade.z - blade.y);
    } else if (p.y >= reflection.x && p.y <= reflection.y) {
      v = (p.y - reflection.x) / (reflection.y - reflection.x);
      mirrored = 1.0;
    }
    if (v < -0.2) {
      continue;
    }
    float dx = abs(p.x - blade.x) * uImageAspect;
    // Only the pixels of this line: the neighbouring line of a pair is 6 px away.
    float own = exp(-pow(dx / (blade.w * 1.3), 4.0));
    float fi = float(i);
    float stutter = smoothstep(0.8, 0.95, noise(vec2(fi * 13.7, uTime * (6.0 + fi))));
    float lineGain = 1.0 + 0.2 * sin(uTime * (1.0 + 0.37 * fi) + fi * 2.4) - 0.6 * stutter;
    neonGain = mix(neonGain, lineGain, own);

    vec2 run = uRuns[i];
    if (run.y <= 0.0) {
      continue;
    }
    float ahead = v - run.x;
    float comet = ahead > 0.0 ? exp(-pow(ahead / 0.022, 2.0)) : exp(ahead / 0.07) * 0.8;
    comet *= smoothstep(-0.04, 0.02, v) * (1.0 - smoothstep(0.98, 1.04, v)) * run.y;
    float core = neon * own * comet;
    runBoost += core * (mirrored > 0.5 ? 1.8 : 4.0);
    runLight += core * vec3(1.0, 0.55, 0.45) * (mirrored > 0.5 ? 0.4 : 1.6);
    float spread = blade.w * (mirrored > 0.5 ? 9.0 : 6.0);
    runLight += vec3(1.0, 0.07, 0.04) * exp(-pow(dx / spread, 2.0)) * comet * (mirrored > 0.5 ? 0.08 : 0.3);
  }
  base *= mix(1.0, neonGain, neon) * mix(1.0, lanternGain, masks.a) * mix(1.0, warmGain, masks.g);
  base = base * (1.0 + runBoost) + runLight;
  vec4 halo = textureLod(uMasks, p, 4.5);
  vec4 wide = textureLod(uMasks, p, 6.5);
  base += vec3(1.0, 0.04, 0.03) * (max(halo.r - halo.a, 0.0) * 0.06 + wide.r * 0.03) * neonGain;
  base += vec3(1.0, 0.22, 0.06) * (halo.a * 0.09 + wide.a * 0.05) * lanternGain;
  base += vec3(1.0, 0.55, 0.25) * (halo.g * 0.04 + wide.g * 0.02) * warmGain;
  return base;
}

// Colour of the fixtures' light spilling into the air around p.
vec3 fixtureGlow(vec2 p) {
  vec4 wide = textureLod(uMasks, p, 7.0);
  return vec3(1.0, 0.05, 0.04) * wide.r * 0.6 + vec3(1.0, 0.55, 0.25) * wide.g * 0.5;
}

// Low fog rolling over the floor: denser towards the wall, where it also rises a little.
float groundFog(vec2 p) {
  float lift = uFloorY - p.y;
  vec2 fp = floorPlane(vec2(p.x, max(p.y, uFloorY + 0.002)));
  float depth = clamp((fp.y - 1.6) / 3.3, 0.0, 1.0);
  vec2 f = vec2(fp.x * 0.5, fp.y * 1.1);
  float n1 = fbm(f * 1.2 + vec2(uTime * 0.04, uTime * 0.015));
  float n2 = fbm(f * 2.6 + n1 * 1.5 - vec2(uTime * 0.07, -uTime * 0.03));
  float density = smoothstep(0.38, 0.9, n1 * 0.55 + n2 * 0.55);
  density *= 0.3 + 0.7 * depth;
  density *= 1.0 - smoothstep(0.0, 0.035 + 0.05 * depth, lift);
  return density;
}

// Embers rising along the side walls, drifting and flickering like sparks from the lanterns.
vec3 embers(vec2 p, vec2 q) {
  float zone = smoothstep(0.3, 0.14, p.x) + smoothstep(0.7, 0.86, p.x);
  zone *= smoothstep(0.02, 0.3, p.y) * smoothstep(0.98, 0.6, p.y);
  if (zone <= 0.0) {
    return vec3(0.0);
  }
  vec3 total = vec3(0.0);
  for (int layer = 0; layer < 2; layer++) {
    float fl = float(layer);
    float scale = 16.0 + fl * 9.0;
    vec2 g = q * scale + vec2(fl * 7.3, uTime * (0.45 + fl * 0.25));
    vec2 cell = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash(cell + fl * 13.1);
    if (h < 0.8) {
      continue;
    }
    vec2 off = (vec2(hash(cell + 2.1), hash(cell + 5.7)) - 0.5) * 0.5;
    off.x += 0.25 * sin(uTime * 1.3 + h * 30.0 + g.y * 0.8);
    float d = length(f - off);
    float flicker = 0.5 + 0.5 * sin(uTime * (5.0 + h * 6.0) + h * 50.0);
    float core = exp(-d * d * 900.0) * 1.6;
    float glow = exp(-d * d * 60.0) * 0.3;
    total += vec3(1.0, 0.36, 0.08) * (core + glow) * flicker * (0.6 - fl * 0.25);
  }
  return total * zone;
}

void main() {
  vec2 c = vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y);
  vec2 p = uCover.xy + c * uCover.zw;
  vec3 base = livingFixtures(toLinear(texture(uImage, p).rgb), p);
  vec2 s = toScreen(p);

  vec2 fw = fwidth(s) * 1.25;
  vec2 m = smoothstep(vec2(0.0), fw, s) * smoothstep(vec2(0.0), fw, 1.0 - s);
  float inside = m.x * m.y;
  float outside = 1.0 - inside;

  // Video wall emission. The glass in the plate is pure black, so emission simply adds.
  vec3 sharp = texture(uContent, vec2(s.x, 1.0 - s.y)).rgb;
  vec3 bloom = textureLod(uContent, vec2(s.x, 1.0 - s.y), 3.0).rgb * 0.14
             + textureLod(uContent, vec2(s.x, 1.0 - s.y), 5.0).rgb * 0.1;
  vec3 emit = toLinear(ledTone(sharp + bloom));
  // Faint glass sheen and a deep-black floor: a lit panel is never pure zero.
  float sheen = smoothstep(0.35, 0.0, abs(s.x * 0.6 - s.y + 0.15)) * 0.0025;
  // The glass sits recessed in its bevel: a soft contact shadow along the edges.
  vec2 edgeDist = min(s, 1.0 - s) * vec2(uScreenAspect, 1.0);
  float recess = smoothstep(0.0, 0.035, min(edgeDist.x, edgeDist.y));
  emit *= 0.55 + 0.45 * recess;
  // Grazing reflections of the side walls and ceiling in the glass near its edges.
  float lx = uRect.x;
  float rx = uRect.z;
  vec2 mirrorX = vec2(s.x < 0.5 ? 2.0 * lx - p.x : 2.0 * rx - p.x, p.y);
  vec2 mirrorY = vec2(p.x, 2.0 * uRect.y - p.y);
  vec3 sideRefl = toLinear(textureLod(uImage, mirrorX, 2.5).rgb) * exp(-edgeDist.x * 9.0);
  vec3 topRefl = toLinear(textureLod(uImage, mirrorY, 2.5).rgb) * exp(-edgeDist.y * 11.0);
  vec3 glass = (sideRefl * 0.07 + topRefl * 0.05) * (1.0 - 0.6 * clamp(dot(emit, vec3(0.33)) * 3.0, 0.0, 1.0));
  vec3 col = base + (emit + glass + vec3(0.0012, 0.0013, 0.0018) + sheen) * inside;

  // Light the wall throws into the room.
  vec2 aspect = vec2(uImageAspect, 1.0);
  vec2 q = p * aspect;
  vec2 dd = max(max(uRect.xy * aspect - q, q - uRect.zw * aspect), 0.0);
  float d = length(dd);
  float near = 1.0 / (1.0 + d * d * 160.0);
  vec2 sc = clamp(s, 0.0, 1.0);
  vec3 edge = wall(sc, 6.0);
  vec3 average = wall(vec2(0.5), uLevels);
  vec2 flashAt = vec2(uFlash.w, mix(uRect.y, uRect.w, 0.2)) * aspect;
  float fd = length(q - flashAt);
  float flashFall = 1.0 / (1.0 + fd * fd * 5.0);
  vec3 flash = uFlash.rgb * (0.18 + flashFall * 1.7);
  vec3 light = edge * near * 3.0 + average * 0.9 + flash;
  col += outside * (base * light * 2.4 + light * near * 0.004);

  // Planar reflection in the polished floor: mirrored about the wall-floor seam, rougher with distance.
  float floorMask = smoothstep(uFloorY - 0.004, uFloorY + 0.012, p.y);
  if (floorMask > 0.0) {
    float dist = p.y - uMirrorY;
    vec2 ripple = (vec2(fbm(p * vec2(40.0, 14.0)), fbm(p * vec2(40.0, 14.0) + 7.3)) - 0.5) * 0.006;
    vec2 sr = toScreen(vec2(p.x, 2.0 * uMirrorY - p.y) + ripple);
    float soft = 0.012 + dist * 0.25;
    vec2 mr = smoothstep(-soft, soft, sr) * smoothstep(-soft, soft, 1.0 - sr);
    float lod = 1.2 + dist * 20.0;
    vec3 reflection = wall(clamp(sr, 0.0, 1.0), lod);
    float strength = 0.55 * exp(-dist * 3.4) * floorMask;
    col += reflection * mr.x * mr.y * strength;
  }

  // Ground fog, lit by the wall, the lightning and the fixtures around it.
  float fog = groundFog(p) * outside;
  vec3 fogLight = average * 1.6 + edge * near * 2.0 + uFlash.rgb * (0.5 + flashFall * 1.5)
                + fixtureGlow(p);
  col = col * (1.0 - fog * 0.3) + fog * (fogLight * 0.45 + vec3(0.004, 0.0045, 0.007));

  // Sparks rising along the walls.
  col += embers(p, q) * outside;

  // Thin haze in the air, only visible where the wall light passes through it.
  float haze = fbm(vec2(p.x * 3.2 + uTime * 0.011, p.y * 5.0 - uTime * 0.005) + fbm(p * 2.0 - uTime * 0.004));
  haze = smoothstep(0.3, 0.95, haze);
  col += haze * (edge * near * 0.05 + uFlash.rgb * flashFall * 0.06 + average * 0.012);

  // Lens halo around the bright wall.
  col += wall(sc, 7.0) * exp(-d * 16.0) * 0.05 * outside;

  col = toDisplay(col);
  float grain = hash(gl_FragCoord.xy + fract(uTime * 7.31) * vec2(113.0, 71.0)) - 0.5;
  col += grain * 0.014;

  if (uDebug > 0.5) {
    float border = (1.0 - smoothstep(0.0, fw.x * 2.0, min(min(s.x, 1.0 - s.x), min(s.y, 1.0 - s.y)))) * step(abs(s.x - 0.5), 0.5 + fw.x * 2.0) * step(abs(s.y - 0.5), 0.5 + fw.y * 2.0);
    col = mix(col, vec3(0.0, 1.0, 0.3), border);
    float lines = step(abs(p.y - uMirrorY), 0.0015) + step(abs(p.y - uFloorY), 0.0015);
    col = mix(col, vec3(1.0, 0.8, 0.0), clamp(lines, 0.0, 1.0));
  }

  outColor = vec4(col, 1.0);
}
`;

export { FULLSCREEN_VERT, CONTENT_FRAG, SPRITE_VERT, SPRITE_FRAG, TILE_VERT, TILE_FRAG, COMPOSITE_FRAG };
