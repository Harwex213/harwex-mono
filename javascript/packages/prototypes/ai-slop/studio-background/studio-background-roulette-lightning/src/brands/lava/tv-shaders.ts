// The lava hall's TV: a sky of volcanic smoke with rising embers, orange bolts, and tiles framed
// in black stone with an orange neon edge, like the walls around the screen.

import { NOISE } from "../../core/glsl";

// Video wall background: volcanic smoke lit from below by the lava and from inside by the bolts.
const CONTENT_FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform float uAspect;
uniform sampler2D uClouds;
uniform vec4 uBolts[24];
uniform int uBoltCount;
uniform vec3 uSheet;

out vec4 outColor;

${NOISE}

void main() {
  vec2 s = vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y);
  vec2 q = vec2(s.x * uAspect, s.y);

  // Two drifting cloud layers at different depths, domain-warped so the billows slowly roll.
  vec2 warp = vec2(fbm(q * 1.8 + vec2(uTime * 0.02, 0.0)), fbm(q * 1.8 + vec2(5.2, uTime * 0.016))) - 0.5;
  vec3 far = texture(uClouds, q * 0.3 + vec2(uTime * 0.0035, 0.21) + warp * 0.04, 1.2).rgb;
  vec3 near = texture(uClouds, q * 0.55 + vec2(uTime * 0.009 + 0.37, 0.05) + warp.yx * 0.07, 0.6).rgb;
  float nearMask = smoothstep(0.25, 0.65, dot(near, vec3(0.3, 0.5, 0.2)) + 0.12 * (fbm(q * 3.0 - uTime * 0.03) - 0.5));
  vec3 clouds = mix(far * 0.7, near, nearMask * 0.75);
  clouds = pow(clouds, vec3(1.3)) * vec3(1.0, 0.5, 0.34) * 0.95;
  // Large slow holes in the deck, so the sky has depth instead of an even layer of smoke.
  float deck = smoothstep(0.3, 0.7, fbm(q * 0.9 + vec2(uTime * 0.006, 1.7)));
  clouds *= 0.7 + 0.6 * deck;
  float density = dot(clouds, vec3(0.3, 0.5, 0.2));

  // Light from the bolts: inside the cloud deck above, and along each channel.
  vec3 glow = vec3(0.0);
  for (int i = 0; i < 24; i++) {
    if (i >= uBoltCount) {
      break;
    }
    vec4 b = uBolts[i];
    vec3 tint = mix(vec3(1.3, 0.62, 0.28), vec3(1.3, 1.1, 0.7), b.w);
    vec2 d = vec2((s.x - b.x) * uAspect, (s.y - 0.02) * 0.7);
    float g = b.y * exp(-dot(d, d) * 6.0);
    float channel = exp(-abs((s.x - b.x) * uAspect) * 14.0) * smoothstep(b.z + 0.05, b.z - 0.1, s.y);
    g += b.y * channel * 0.3;
    glow += g * tint;
  }
  vec2 sd = vec2((s.x - uSheet.x) * uAspect, s.y - uSheet.y);
  glow += vec3(1.2, 0.55, 0.25) * uSheet.z * exp(-dot(sd, sd) * 4.0) * 0.7;

  // Dense cloud catches the light, the gaps stay dark: the flash reveals the shapes.
  vec3 col = clouds * (1.0 + glow * 2.8 * (0.3 + density * 3.0));
  col += glow * vec3(0.06, 0.02, 0.005);

  // The lava below lights the smoke from underneath.
  col *= 1.0 + vec3(0.9, 0.3, 0.08) * smoothstep(0.45, 1.0, s.y);
  col += vec3(0.05, 0.008, 0.002) * smoothstep(0.55, 1.0, s.y);

  // Embers rising through the smoke, swaying and fading as they cool.
  for (int layer = 0; layer < 3; layer++) {
    float fl = float(layer);
    float scale = 14.0 + fl * 9.0;
    vec2 g = q * scale + vec2(0.0, uTime * (0.9 + fl * 0.35));
    vec2 cell = floor(g);
    float h = hash(cell + fl * 5.3);
    if (h < 0.86) {
      continue;
    }
    vec2 f = fract(g) - 0.5;
    f.x += 0.25 * sin(uTime * (1.3 + h * 2.0) + h * 30.0);
    float r = length(f * vec2(1.0, 0.6));
    float heat = 0.5 + 0.5 * sin(uTime * (3.0 + h * 5.0) + h * 70.0);
    float cool = smoothstep(0.0, 0.9, s.y);
    col += vec3(1.0, 0.42, 0.1) * exp(-r * r * (500.0 - fl * 120.0)) * heat * cool * (0.9 - fl * 0.25);
  }

  // A deep ember floor so the screen never reads as pure black while it is lit.
  col += vec3(0.02, 0.006, 0.003);

  // Screen-space vignette so the layout reads first.
  vec2 v = s - 0.5;
  col *= 1.0 - dot(v * vec2(0.8, 1.25), v * vec2(0.8, 1.25)) * 0.95;

  outColor = vec4(col, 1.0);
}
`;

const SPRITE_VERT = /* glsl */ `#version 300 es
layout(location = 0) in vec4 aRect;
layout(location = 1) in vec4 aData;

uniform vec2 uAtlasGrid;

out vec2 vUv;
out vec2 vLocal;
out float vIntensity;
out float vGold;

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
  vGold = aData.w;
}
`;

const SPRITE_FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uAtlas;

in vec2 vUv;
in vec2 vLocal;
in float vIntensity;
in float vGold;

out vec4 outColor;

void main() {
  vec3 layers = texture(uAtlas, vUv).rgb;
  float fade = smoothstep(0.0, 0.12, vLocal.y) * (1.0 - smoothstep(0.94, 1.0, vLocal.y));
  // The halo is wider than the sprite; fade it out before the quad edge leaves a seam.
  fade *= smoothstep(0.0, 0.2, vLocal.x) * (1.0 - smoothstep(0.8, 1.0, vLocal.x));
  vec3 core = mix(vec3(3.0, 2.5, 1.9), vec3(3.0, 2.9, 2.4), vGold);
  vec3 tight = mix(vec3(1.8, 0.75, 0.22), vec3(1.8, 1.4, 0.6), vGold);
  vec3 halo = mix(vec3(1.2, 0.22, 0.04), vec3(1.1, 0.7, 0.2), vGold);
  vec3 col = layers.r * core + layers.g * tight + layers.b * halo * 0.9;
  outColor = vec4(col * vIntensity * fade, 1.0);
}
`;

// One roulette tile per instance. Local space: x spans the tile width (-0.5..0.5), y down, same scale.
const TILE_VERT = /* glsl */ `#version 300 es
layout(location = 0) in vec4 aRect;
layout(location = 1) in vec4 aInfo;
layout(location = 2) in vec4 aState;
layout(location = 3) in vec4 aExtra;

uniform float uAspect;

out vec2 vLocal;
flat out vec2 vHalf;
flat out vec4 vInfo;
flat out vec4 vState;
flat out vec4 vExtra;
flat out float vFacing;
flat out float vCenterX;

// Room around the tile for its glow, its pendant and its shock rings, in tile widths.
const float MARGIN = 0.36;

void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 halfSize = vec2(0.5, 0.5 * aRect.w / (aRect.z * uAspect));
  vec2 local = mix(-halfSize - MARGIN, halfSize + MARGIN, corner);

  // Punch on impact, a small dip when the charge leaves.
  float age = aState.w;
  float discharge = aExtra.x;
  float scale = 1.0;
  if (age >= 0.0) {
    scale += 0.09 * exp(-age * 6.0) * sin(min(age, 1.0) * 9.0);
  }
  if (discharge >= 0.0) {
    scale -= 0.035 * exp(-discharge * 5.0) * sin(min(discharge, 1.0) * 7.0);
  }
  // A lucky tile stands a little forward.
  scale += 0.05 * aExtra.z;

  // Card flip around the vertical axis, with real perspective.
  float theta = aState.x;
  vec3 p = vec3(local.x * cos(theta), local.y, local.x * sin(theta)) * scale;
  float distance = 3.0;
  float w = (distance + p.z) / distance;
  vec2 centre = aRect.xy + aRect.zw * 0.5;
  vec2 uv = centre + vec2(p.x * aRect.z, p.y * aRect.z * uAspect) / w;
  gl_Position = vec4(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0) * w;

  vLocal = local;
  vHalf = halfSize;
  vInfo = aInfo;
  vState = aState;
  vExtra = aExtra;
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
flat in vec4 vExtra;
flat in float vFacing;
flat in float vCenterX;

out vec4 outColor;

${NOISE}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// Faceted plaque: a rectangle with its corners cut at 45 degrees.
float plaque(vec2 p, vec2 h, float cut) {
  float d = sdBox(p, h);
  vec2 a = abs(p);
  return max(d, (a.x + a.y - (h.x + h.y - cut)) * 0.70710678);
}

float glyphAt(float slot, vec2 uv, float lod) {
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
    return 0.0;
  }
  vec2 cell = vec2(mod(slot, uGlyphGrid.x), floor(slot / uGlyphGrid.x));
  vec2 auv = (cell + uv) / uGlyphGrid;
  return lod > 0.0 ? textureLod(uGlyphs, auv, lod).a : texture(uGlyphs, auv).a;
}

// Polished black stone: dark facets, a grey facet where it faces up, a hot glint of the lava.
vec3 stoneAt(float t, float shine) {
  vec3 dark = vec3(0.025, 0.022, 0.022);
  vec3 mid = vec3(0.2, 0.17, 0.16);
  vec3 hi = vec3(1.0, 0.5, 0.2);
  float band = 0.5 + 0.5 * sin(t * 9.0 + 1.2);
  return mix(mix(dark, mid, band), hi, shine * 0.8);
}

// The orange neon line that edges every facet in the hall.
const vec3 NEON = vec3(1.0, 0.36, 0.08);

void main() {
  vec2 p = vLocal;
  // Seen from the back half of the flip, keep the numeral readable.
  if (vFacing < 0.0) {
    p.x = -p.x;
  }
  vec2 h = vHalf;
  bool zero = vInfo.z > 0.5;
  float seed = vInfo.w;
  float charge = vState.y;
  float flash = vState.z;
  float age = vState.w;
  float discharge = vExtra.x;
  float row = vExtra.y;
  float lucky = vExtra.z;
  float badge = vExtra.w;

  float cut = 0.12;
  float d = plaque(p, h, cut);
  float aa = max(fwidth(d), 1e-4);
  float body = 1.0 - smoothstep(-aa, aa, d);

  vec3 electric = vec3(1.0, 0.48, 0.16);
  vec3 whiteHot = vec3(1.0, 0.86, 0.5);
  vec3 energy = mix(electric, whiteHot, lucky);
  float flicker = 0.82 + 0.18 * noise(vec2(uTime * 32.0, seed * 91.0));

  // Lacquer: red, black or green, lit from above, with a soft inner shadow under the frame.
  vec3 lacquer = vInfo.y < 0.5 ? vec3(0.03, 0.028, 0.032) : (vInfo.y < 1.5 ? vec3(0.5, 0.035, 0.04) : vec3(0.02, 0.3, 0.1));
  float gy = clamp(p.y / h.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 fill = lacquer * mix(1.35, 0.6, gy);
  fill += vec3(0.05) * exp(-gy * 9.0);
  fill *= 0.6 + 0.4 * smoothstep(0.0, 0.12, -d);
  // A slow reflection slides over the lacquer.
  float sheen = exp(-pow((p.x * 0.8 + p.y * 0.5 - 0.35 * sin(uTime * 0.35 + vCenterX * 3.0)) * 3.2, 2.0));
  fill += vec3(0.05, 0.045, 0.04) * sheen;

  // Charged: plasma drifts inside the lacquer and the frame glows from within.
  float plasma = fbm(p * 5.0 + vec2(seed * 13.0 + uTime * 0.7, -uTime * 0.5));
  fill += energy * charge * flicker * (0.04 + 0.5 * pow(plasma, 3.0) + 0.3 * exp(d * 16.0));

  // Stone frame: an outer band of polished stone and an inner neon hairline.
  float bw = 0.034;
  float frame = 1.0 - smoothstep(-aa, aa, abs(d + bw * 0.5) - bw * 0.5);
  float inner = 1.0 - smoothstep(-aa, aa, abs(d + 0.075) - 0.006);
  float ang = atan(p.y / h.y, p.x / h.x) / 6.28318;
  float shine = pow(0.5 + 0.5 * sin(p.y * 3.0 - p.x * 2.0 + uTime * 0.4 + seed * 6.0), 6.0);
  vec3 stoneFrame = stoneAt(p.y * 1.6 + p.x * 0.6, shine);
  float arcs = noise(vec2(ang * 34.0 + seed * 50.0, uTime * 9.0)) * noise(vec2(ang * 11.0 - uTime * 2.0, seed * 20.0));
  arcs = smoothstep(0.2, 0.65, arcs);
  float head = fract(uTime * 0.55 + seed);
  float spark = exp(-abs(fract(ang - head + 0.5) - 0.5) * 70.0)
              + 0.6 * exp(-abs(fract(ang + head * 1.3 + 0.5) - 0.5) * 90.0);
  vec3 frameColor = stoneFrame * (1.0 + charge * 0.6);
  frameColor += energy * charge * flicker * (arcs * 1.6 + spark * 2.6);

  // Numeral, and for a lucky tile the multiplier under it.
  float lift = lucky * 0.2 * h.y;
  float numScale = mix(1.0, 0.8, lucky);
  vec2 guv = (p + vec2(0.0, lift)) / (0.94 * numScale) + 0.5;
  float glyph = glyphAt(vInfo.x, guv, 0.0);
  float glyphGlow = glyphAt(vInfo.x, guv, 3.5);
  float shadow = glyphAt(vInfo.x, guv - vec2(0.012, 0.018), 1.5);
  vec3 ivory = vec3(0.98, 0.94, 0.84);
  vec3 ink = mix(ivory, vec3(1.0, 0.8, 0.45), lucky);
  vec3 inkColor = ink * (1.0 + charge * flicker * 0.9);

  float label = 0.0;
  float labelGlow = 0.0;
  if (badge >= 0.0) {
    float pop = 1.0 + 0.25 * exp(-lucky * 6.0) * step(lucky, 0.99);
    vec2 buv = (p - vec2(0.0, h.y * 0.5)) / (0.94 * pop) + 0.5;
    label = glyphAt(badge, buv, 0.0) * smoothstep(0.0, 0.3, lucky);
    labelGlow = glyphAt(badge, buv, 3.0) * lucky;
  }

  // Premultiplied composite; glows add light without adding coverage.
  vec3 rgb = fill * body;
  float alpha = body;
  rgb *= 1.0 - shadow * 0.6 * body;
  rgb = mix(rgb, frameColor, frame);
  rgb = mix(rgb, NEON * (1.1 + 0.2 * flicker) + energy * charge * 0.5, inner * body * 0.9);
  rgb = mix(rgb, inkColor, glyph);
  rgb += ink * glyphGlow * 0.1 + mix(energy, ink, 0.6) * glyphGlow * charge * flicker * 1.1;
  rgb = mix(rgb, mix(NEON, whiteHot, 0.6) * 1.4, label);
  rgb += whiteHot * labelGlow * 1.2 * flicker;

  // A small stone diamond with a neon core hangs under every column, below the bottom row.
  if (row > 1.5 || zero) {
    vec2 dp = p - vec2(0.0, h.y + 0.17);
    float diamond = (abs(dp.x) + abs(dp.y) * 0.8) - 0.075;
    float stem = sdBox(p - vec2(0.0, h.y + 0.05), vec2(0.006, 0.05));
    float pendant = 1.0 - smoothstep(-aa, aa, min(diamond, stem));
    float facet = step(0.0, dp.x) * 0.35 + step(0.0, dp.y) * 0.25;
    vec3 pendantColor = stoneAt(dp.y * 20.0 + 1.0, 0.3) * (1.0 - facet) + NEON * exp(-length(dp) * 30.0) * 0.8 + energy * charge * 0.8;
    rgb = mix(rgb, pendantColor, pendant * (1.0 - body));
    alpha = max(alpha, pendant);
  }

  // Soft contact shadow lifts the tile off the sky; charged tiles glow around their frame.
  float outside = (1.0 - body);
  alpha = max(alpha, exp(-max(d, 0.0) * 26.0) * 0.45 * outside);
  rgb += energy * exp(-max(d, 0.0) * 18.0) * outside * charge * (0.35 + 0.6 * lucky) * (0.8 + 0.2 * sin(uTime * 6.0 + seed * 6.28));

  // Idle glint of heat travelling across the stone frames.
  float sweep = fract(uTime / 8.0) * 1.6 - 0.3;
  float band = exp(-pow((vCenterX + p.x * 0.05 - p.y * 0.03 - sweep) * 18.0, 2.0));
  rgb += vec3(1.0, 0.5, 0.2) * band * (frame * 0.7 + inner * 0.5 + body * 0.03) * (1.0 - charge);

  // Impact: white flash, then a shock ring leaving the frame.
  if (age >= 0.0) {
    rgb += mix(vec3(1.0, 0.6, 0.3), vec3(1.0, 0.85, 0.55), lucky) * flash * (body * 0.35 + frame * 0.9);
    float ring = exp(-pow((d - age * 0.4) / 0.016, 2.0)) * smoothstep(0.4, 0.0, age) * step(0.0, d);
    rgb += energy * ring * 1.6;
  }
  // The lacquer catches the light as it turns.
  rgb += vec3(0.7, 0.45, 0.35) * pow(abs(sin(vState.x)), 3.0) * body * 0.12;
  // Discharge: a last faint ring, the charge bleeding off.
  if (discharge >= 0.0 && discharge < 0.8) {
    float ring = exp(-pow((d - discharge * 0.3) / 0.015, 2.0)) * (1.0 - discharge / 0.8) * step(0.0, d);
    rgb += energy * ring * 0.8;
  }

  outColor = vec4(rgb, alpha);
}
`;

export { CONTENT_FRAG, SPRITE_FRAG, SPRITE_VERT, TILE_FRAG, TILE_VERT };
