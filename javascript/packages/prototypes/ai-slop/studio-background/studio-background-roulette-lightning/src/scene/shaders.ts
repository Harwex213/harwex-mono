import { LAMPS } from "./calibration";

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

// Video wall background: a night storm sky, lit from inside by the bolts.
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
  clouds = pow(clouds, vec3(1.3)) * vec3(0.72, 0.78, 1.0) * 1.05;
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
    vec3 tint = mix(vec3(0.75, 0.85, 1.25), vec3(1.25, 0.95, 0.55), b.w);
    vec2 d = vec2((s.x - b.x) * uAspect, (s.y - 0.02) * 0.7);
    float g = b.y * exp(-dot(d, d) * 6.0);
    float channel = exp(-abs((s.x - b.x) * uAspect) * 14.0) * smoothstep(b.z + 0.05, b.z - 0.1, s.y);
    g += b.y * channel * 0.3;
    glow += g * tint;
  }
  vec2 sd = vec2((s.x - uSheet.x) * uAspect, s.y - uSheet.y);
  glow += vec3(0.7, 0.8, 1.2) * uSheet.z * exp(-dot(sd, sd) * 4.0) * 0.7;

  // Dense cloud catches the light, the gaps stay dark: the flash reveals the shapes.
  vec3 col = clouds * (1.0 + glow * 2.8 * (0.3 + density * 3.0));
  col += glow * vec3(0.02, 0.025, 0.06);

  // A deep indigo floor so the screen never reads as pure black while it is lit.
  col += vec3(0.006, 0.008, 0.02);

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
  vec3 core = mix(vec3(2.6, 2.7, 3.0), vec3(3.0, 2.6, 1.8), vGold);
  vec3 tight = mix(vec3(0.6, 0.78, 1.7), vec3(1.7, 1.05, 0.35), vGold);
  vec3 halo = mix(vec3(0.3, 0.32, 1.2), vec3(1.1, 0.5, 0.12), vGold);
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

// Art Deco plaque: a rectangle with its corners cut at 45 degrees.
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

// Polished gold: bright where it faces up, a dark band where it reflects the room.
vec3 goldAt(float t, float shine) {
  vec3 dark = vec3(0.32, 0.2, 0.06);
  vec3 mid = vec3(0.86, 0.62, 0.26);
  vec3 hi = vec3(1.0, 0.9, 0.62);
  float band = 0.5 + 0.5 * sin(t * 9.0 + 1.2);
  return mix(mix(dark, mid, band), hi, shine);
}

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

  vec3 electric = vec3(0.62, 0.8, 1.0);
  vec3 goldLight = vec3(1.0, 0.72, 0.3);
  vec3 energy = mix(electric, goldLight, lucky);
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

  // Gold frame: an outer band and an inner hairline, both polished.
  float bw = 0.034;
  float frame = 1.0 - smoothstep(-aa, aa, abs(d + bw * 0.5) - bw * 0.5);
  float inner = 1.0 - smoothstep(-aa, aa, abs(d + 0.075) - 0.006);
  float ang = atan(p.y / h.y, p.x / h.x) / 6.28318;
  float shine = pow(0.5 + 0.5 * sin(p.y * 3.0 - p.x * 2.0 + uTime * 0.4 + seed * 6.0), 6.0);
  vec3 goldFrame = goldAt(p.y * 1.6 + p.x * 0.6, shine);
  float arcs = noise(vec2(ang * 34.0 + seed * 50.0, uTime * 9.0)) * noise(vec2(ang * 11.0 - uTime * 2.0, seed * 20.0));
  arcs = smoothstep(0.2, 0.65, arcs);
  float head = fract(uTime * 0.55 + seed);
  float spark = exp(-abs(fract(ang - head + 0.5) - 0.5) * 70.0)
              + 0.6 * exp(-abs(fract(ang + head * 1.3 + 0.5) - 0.5) * 90.0);
  vec3 frameColor = goldFrame * (1.0 + charge * 0.6);
  frameColor += energy * charge * flicker * (arcs * 1.6 + spark * 2.6);

  // Numeral, and for a lucky tile the multiplier under it.
  float lift = lucky * 0.2 * h.y;
  float numScale = mix(1.0, 0.8, lucky);
  vec2 guv = (p + vec2(0.0, lift)) / (0.94 * numScale) + 0.5;
  float glyph = glyphAt(vInfo.x, guv, 0.0);
  float glyphGlow = glyphAt(vInfo.x, guv, 3.5);
  float shadow = glyphAt(vInfo.x, guv - vec2(0.012, 0.018), 1.5);
  vec3 ivory = vec3(0.98, 0.94, 0.84);
  vec3 ink = mix(ivory, vec3(1.0, 0.86, 0.5), lucky);
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
  rgb = mix(rgb, goldFrame * 0.8 + energy * charge * 0.5, inner * body * 0.85);
  rgb = mix(rgb, inkColor, glyph);
  rgb += ink * glyphGlow * 0.1 + mix(energy, ink, 0.6) * glyphGlow * charge * flicker * 1.1;
  rgb = mix(rgb, goldAt(p.y * 5.0, 0.6) * 1.4, label);
  rgb += goldLight * labelGlow * 1.2 * flicker;

  // A small gold diamond hangs under every column, below the bottom row.
  if (row > 1.5 || zero) {
    vec2 dp = p - vec2(0.0, h.y + 0.17);
    float diamond = (abs(dp.x) + abs(dp.y) * 0.8) - 0.075;
    float stem = sdBox(p - vec2(0.0, h.y + 0.05), vec2(0.006, 0.05));
    float pendant = 1.0 - smoothstep(-aa, aa, min(diamond, stem));
    float facet = step(0.0, dp.x) * 0.35 + step(0.0, dp.y) * 0.25;
    vec3 pendantColor = goldAt(dp.y * 20.0 + 1.0, 0.3) * (1.0 - facet) + energy * charge * 0.8;
    rgb = mix(rgb, pendantColor, pendant * (1.0 - body));
    alpha = max(alpha, pendant);
  }

  // Soft contact shadow lifts the tile off the sky; charged tiles glow around their frame.
  float outside = (1.0 - body);
  alpha = max(alpha, exp(-max(d, 0.0) * 26.0) * 0.45 * outside);
  rgb += energy * exp(-max(d, 0.0) * 18.0) * outside * charge * (0.35 + 0.6 * lucky) * (0.8 + 0.2 * sin(uTime * 6.0 + seed * 6.28));

  // Idle glint travelling across the gold frames.
  float sweep = fract(uTime / 8.0) * 1.6 - 0.3;
  float band = exp(-pow((vCenterX + p.x * 0.05 - p.y * 0.03 - sweep) * 18.0, 2.0));
  rgb += vec3(1.0, 0.9, 0.7) * band * (frame * 0.9 + inner * 0.5 + body * 0.03) * (1.0 - charge);

  // Impact: white flash, then a shock ring leaving the frame.
  if (age >= 0.0) {
    rgb += mix(vec3(0.55, 0.7, 1.0), vec3(1.0, 0.8, 0.45), lucky) * flash * (body * 0.35 + frame * 0.9);
    float ring = exp(-pow((d - age * 0.4) / 0.016, 2.0)) * smoothstep(0.4, 0.0, age) * step(0.0, d);
    rgb += energy * ring * 1.6;
  }
  // The lacquer catches the light as it turns.
  rgb += vec3(0.5, 0.55, 0.7) * pow(abs(sin(vState.x)), 3.0) * body * 0.12;
  // Discharge: a last faint ring, the charge bleeding off.
  if (discharge >= 0.0 && discharge < 0.8) {
    float ring = exp(-pow((d - discharge * 0.3) / 0.015, 2.0)) * (1.0 - discharge / 0.8) * step(0.0, d);
    rgb += energy * ring * 0.8;
  }

  outColor = vec4(rgb, alpha);
}
`;

// Final frame: the studio plate, the video wall inside the glass, and the wall's light in the room.
const COMPOSITE_FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uImage;
uniform sampler2D uContent;
uniform sampler2D uMasks;
uniform float uLevels;
uniform mat3 uToScreen;
uniform vec4 uCover;
uniform vec2 uRes;
uniform float uTime;
uniform vec4 uRect;
uniform vec2 uNotch;
uniform float uMirrorY;
uniform float uFloorY;
uniform float uHorizon;
uniform vec2 uVanish;
uniform vec4 uLamps[${LAMPS.length}];
uniform float uLampBases[${LAMPS.length}];
// Seconds since the lightning sequence started, -1 outside the power surge that opens it.
uniform float uSurge;
// Mains power: 1 at rest, lower while the bolts draw it down.
uniform float uPower;
uniform vec4 uFlash;
uniform float uImageAspect;
uniform float uScreenAspect;
uniform float uDebug;

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

// Ground-plane coordinates of a floor pixel: x across, z depth.
vec2 floorPlane(vec2 p) {
  float z = 1.0 / max(p.y - uHorizon, 0.02);
  return vec2((p.x - uVanish.x) * uImageAspect * z, z);
}

// Brightness of the frosted lamps and the downlights at p. Every lamp breathes at its own pace, a
// soft band of light climbs through its glass, and the filament hums. A lamp's reflection is read
// at the mirrored height, so the band climbs down the reflection in step with the lamp.
float lampGain(vec2 p) {
  float gain = 0.97 + 0.03 * sin(uTime * 0.8 + p.x * 23.0);
  for (int i = 0; i < ${LAMPS.length}; i++) {
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
    float breath = 0.92 + 0.08 * sin(uTime * (0.55 + 0.13 * fi) + fi * 2.1);
    float head = fract(uTime * 0.085 + fi * 0.27) * 1.7 - 0.35;
    float band = exp(-pow((v - head) / 0.13, 2.0));
    float hum = 0.97 + 0.03 * noise(vec2(uTime * 38.0, fi * 7.0));
    gain = mix(gain, breath * hum * (1.0 + 0.28 * band), column);
  }
  // The bolts draw the mains down: the lamps sag and stutter while they strike.
  float stutter = mix(1.0, 0.75 + 0.25 * noise(vec2(uTime * 60.0, 3.0)), 1.0 - uPower);
  return gain * uPower * stutter;
}

// Brightness of the LED strips at p. Pulses of light run along every strip towards the screen,
// following the floor and ceiling lines into the vanishing point. The lightning sequence opens
// with a surge: one hot front races from the edges of the room into the screen.
float ledGain(vec2 p, out float surge) {
  float dv = length((p - uVanish) * vec2(uImageAspect, 1.0));
  float chase = pow(0.5 + 0.5 * sin(dv * 34.0 + uTime * 2.4), 8.0);
  float slow = 0.9 + 0.1 * sin(uTime * 0.5 + dv * 3.0);
  surge = 0.0;
  if (uSurge >= 0.0) {
    float front = 1.15 - uSurge * 1.7;
    float ahead = dv - front;
    float trail = ahead > 0.0 ? exp(-ahead / 0.18) * 0.55 : 0.0;
    surge = (exp(-pow(ahead / 0.022, 2.0)) + trail) * smoothstep(0.2, 0.36, front + 0.02);
  }
  return (0.78 + 0.4 * chase) * slow * mix(1.0, uPower, 0.6) + surge * 2.6;
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
  vec4 masks = texture(uMasks, p);
  float gold = masks.r;
  float lamp = masks.g;
  float strip = masks.b;
  vec3 base = toLinear(texture(uImage, p).rgb);
  float lampLight = lampGain(p);
  float surge;
  float ledLight = ledGain(p, surge);
  base *= mix(1.0, lampLight, lamp) * mix(1.0, ledLight, strip);
  // A surging strip runs hotter and whiter than it rests.
  base += vec3(1.0, 0.85, 0.6) * strip * surge * 0.35;
  // The lamps' and the strips' light spills a little further than the plate shows.
  float lampHalo = textureLod(uMasks, p, 5.0).g * 0.024 + textureLod(uMasks, p, 7.0).g * 0.014;
  float ledHalo = textureLod(uMasks, p, 4.0).b * 0.05 + textureLod(uMasks, p, 6.0).b * 0.03;
  base += vec3(1.0, 0.64, 0.3) * lampHalo * lampLight + vec3(1.0, 0.52, 0.18) * ledHalo * ledLight;

  vec2 s = toScreen(p);
  vec2 fw = fwidth(s) * 1.25;
  vec2 m = smoothstep(vec2(0.0), fw, s) * smoothstep(vec2(0.0), fw, 1.0 - s);
  // The gold steps in the corners of the frame stay in front of the screen.
  vec2 fromCorner = min(s, 1.0 - s) - uNotch;
  vec2 n = smoothstep(vec2(0.0), fw, fromCorner);
  float inside = m.x * m.y * (1.0 - (1.0 - n.x) * (1.0 - n.y));
  float outside = 1.0 - inside;

  // Video wall emission. It replaces the marble glass of the plate.
  vec3 sharp = texture(uContent, vec2(s.x, 1.0 - s.y)).rgb;
  vec3 bloom = textureLod(uContent, vec2(s.x, 1.0 - s.y), 3.0).rgb * 0.12
             + textureLod(uContent, vec2(s.x, 1.0 - s.y), 5.0).rgb * 0.08;
  vec3 emit = toLinear(ledTone(sharp + bloom));
  // The glass sits recessed in its gold frame: a soft contact shadow along the edges.
  vec2 edgeDist = min(s, 1.0 - s) * vec2(uScreenAspect, 1.0);
  float recess = smoothstep(0.0, 0.03, min(edgeDist.x, edgeDist.y));
  emit *= 0.5 + 0.5 * recess;
  // Grazing reflections of the gold frame and the columns in the glass near its edges.
  vec2 mirrorX = vec2(s.x < 0.5 ? 2.0 * uRect.x - p.x : 2.0 * uRect.z - p.x, p.y);
  vec2 mirrorY = vec2(p.x, 2.0 * uRect.y - p.y);
  vec3 sideRefl = toLinear(textureLod(uImage, mirrorX, 2.5).rgb) * exp(-edgeDist.x * 10.0);
  vec3 topRefl = toLinear(textureLod(uImage, mirrorY, 2.5).rgb) * exp(-edgeDist.y * 12.0);
  float lit = clamp(dot(emit, vec3(0.33)) * 3.0, 0.0, 1.0);
  vec3 glass = (sideRefl * 0.06 + topRefl * 0.04) * (1.0 - 0.6 * lit);
  float streak = smoothstep(0.3, 0.0, abs(s.x * 0.55 - s.y + 0.1)) * 0.002;
  vec3 col = base * outside + (emit + glass + streak) * inside;

  // Light the wall throws into the room. Polished gold throws most of it back.
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
  float response = 0.3 + gold * 1.9;
  col += outside * (base * light * response * 1.4 + light * near * 0.003);

  // Reflection in the polished marble, mirrored about the wall-floor seam. It is squeezed into a band
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
    // The gold inlays and the veins break the mirror; the dark stone keeps it.
    float veins = 0.75 + 0.25 * fbm(p * vec2(60.0, 30.0));
    float stone = (1.0 - 0.6 * gold) * veins;
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

export { FULLSCREEN_VERT, CONTENT_FRAG, SPRITE_VERT, SPRITE_FRAG, TILE_VERT, TILE_FRAG, COMPOSITE_FRAG };
