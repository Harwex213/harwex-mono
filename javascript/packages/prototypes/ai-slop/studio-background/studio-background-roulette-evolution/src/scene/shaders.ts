import { DOWNLIGHTS, PILLARS } from "./calibration";

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
  // The deck is near-black with gold-lit seams; lift it so the billows read between flashes.
  clouds = pow(clouds, vec3(1.08)) * 1.45;
  float density = dot(clouds, vec3(0.3, 0.5, 0.2));

  // A low moon behind the deck: cloud rags drift across it, and it lights the billows around it.
  vec2 md = vec2((s.x - 0.84) * uAspect, s.y - 0.15);
  float moonR = 0.05;
  float r = length(md);
  float rags = fbm(q * vec2(3.2, 5.5) + vec2(uTime * 0.035, 0.0) + warp * 0.6);
  float veil = smoothstep(0.38, 0.68, rags);
  float disc = 1.0 - smoothstep(moonR - 0.002, moonR + 0.002, r);
  float limb = sqrt(max(0.0, 1.0 - pow(r / moonR, 2.0)));
  vec3 moonTint = vec3(1.0, 0.86, 0.62);
  float maria = 0.8 + 0.2 * fbm(md * 55.0 + 3.0);
  vec3 moon = moonTint * disc * (0.2 + 0.25 * limb) * maria * (1.0 - veil * 0.8);
  moon += moonTint * (exp(-r * 14.0) * 0.07 + exp(-r * 4.0) * 0.02) * (1.0 - veil * 0.5);
  clouds += moon + clouds * moonTint * exp(-r * 6.0) * 1.2;

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

  vec3 col = clouds * (1.0 + glow * vec3(3.6, 3.0, 2.2) * (0.35 + density * 2.6));
  col += glow * vec3(0.08, 0.055, 0.025);

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
  // White-hot core, a gold glow and an amber halo: the bolts belong to the gold hall.
  vec3 col = layers.r * vec3(2.9, 2.8, 2.55)
           + layers.g * vec3(1.75, 1.2, 0.5)
           + layers.b * vec3(1.15, 0.58, 0.16) * 0.9;
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

  // Champagne numerals, lacquer red and jade green; the charge burns gold like the hall.
  vec3 cream = vec3(0.98, 0.9, 0.72);
  vec3 ink = vInfo.y < 0.5 ? cream : (vInfo.y < 1.5 ? vec3(0.9, 0.16, 0.12) : vec3(0.22, 0.62, 0.42));
  vec3 electric = vec3(1.0, 0.8, 0.42);
  vec3 goldRim = vec3(0.86, 0.63, 0.3);
  float flicker = 0.82 + 0.18 * noise(vec2(uTime * 32.0, seed * 91.0));

  // Smoked glass body: a lit top edge, an inner shadow, a faint underglow in the numeral colour.
  float gy = clamp(p.y / h.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 fill = mix(vec3(0.09, 0.075, 0.06), vec3(0.02, 0.016, 0.013), gy);
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
  vec3 rimColor = mix(goldRim * (0.55 + 0.6 * cornerAccent), electric * 0.8, charge);
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
  vec3 inkColor = ink * (1.0 + charge * flicker * 0.5) + electric * charge * 0.03;

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
    rgb += vec3(1.1, 1.0, 0.85) * flash * (body * 0.9 + rim);
    float ring = exp(-pow((d - age * 0.4) / 0.016, 2.0)) * smoothstep(0.4, 0.0, age) * step(0.0, d);
    rgb += electric * ring * 1.6;
  }
  // The glass catches the light as it turns.
  rgb += vec3(1.0, 0.82, 0.55) * pow(abs(sin(vState.x)), 3.0) * body * 0.3;
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
uniform float uSag;
uniform float uImageAspect;
uniform float uScreenAspect;
uniform float uDebug;
uniform sampler2D uMasks;
uniform float uHorizon;
uniform vec2 uVanish;
uniform vec4 uPillars[${PILLARS.length}];
uniform float uPillarFloor[${PILLARS.length}];
uniform vec4 uPillarArcs[${PILLARS.length}];
uniform vec2 uDownlights[${DOWNLIGHTS.length}];
// Strike sweep across the ceiling: image x of the front, strength.
uniform vec2 uSweep;
// Outer edge of the warm halo around the glass: x0, y0, x1, y1.
uniform vec4 uHalo;

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
  return vec2((p.x - 0.5) * uImageAspect * z, z);
}

// House lights: the cove and the halo sag and stutter for a moment when the lightning hits,
// as if the strike pulled on the studio power.
float lampGain() {
  float stutter = 0.65 + 0.35 * noise(vec2(uTime * 38.0, 3.7));
  return 1.0 - uSag * 0.42 * stutter;
}

// Low haze over the floor: denser towards the wall, where it also rises a little.
float groundFog(vec2 p) {
  float lift = uFloorY - p.y;
  vec2 fp = floorPlane(vec2(p.x, max(p.y, uFloorY + 0.002)));
  float depth = clamp((fp.y - 1.6) / 3.3, 0.0, 1.0);
  vec2 f = vec2(fp.x * 0.5, fp.y * 1.1);
  float n1 = fbm(f * 1.2 + vec2(uTime * 0.035, uTime * 0.012));
  float n2 = fbm(f * 2.6 + n1 * 1.5 - vec2(uTime * 0.06, -uTime * 0.025));
  float density = smoothstep(0.42, 0.95, n1 * 0.55 + n2 * 0.55);
  density *= 0.25 + 0.75 * depth;
  density *= 1.0 - smoothstep(0.0, 0.03 + 0.05 * depth, lift);
  return density;
}

// Dust hanging in the air. Motes are only visible where light passes through them.
float motes(vec2 q) {
  float total = 0.0;
  for (int layer = 0; layer < 3; layer++) {
    float fl = float(layer);
    float scale = 22.0 + fl * 14.0;
    vec2 g = q * scale + vec2(fl * 7.3 + uTime * (0.05 + fl * 0.02), -uTime * (0.07 + fl * 0.03));
    vec2 cell = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash(cell + fl * 13.1);
    if (h < 0.86) {
      continue;
    }
    vec2 off = (vec2(hash(cell + 2.1), hash(cell + 5.7)) - 0.5) * 0.6;
    off += 0.12 * vec2(sin(uTime * 0.4 + h * 30.0), cos(uTime * 0.33 + h * 17.0));
    float d = length(f - off);
    float twinkle = 0.55 + 0.45 * sin(uTime * (0.8 + h * 1.7) + h * 50.0);
    total += (exp(-d * d * 1400.0) + exp(-d * d * 120.0) * 0.12) * twinkle * (1.0 - fl * 0.3);
  }
  return total;
}

// Show lighting on the ceiling. The LED runs are addressable: light waves travel along them,
// every row breathes on its own phase, and the strike sweep drags a bright front across them.
float ledAnimation(vec2 p) {
  vec2 q = p * vec2(uImageAspect, 1.0);
  float fromCentre = abs(p.x - 0.5) * uImageAspect + p.y * 0.6;
  // Symmetric waves from the centre towards the corners, every few seconds.
  float phase = fract(uTime * 0.16);
  float wave = exp(-pow((fromCentre - phase * 1.9 + 0.1) / 0.07, 2.0));
  float echo = exp(-pow((fromCentre - fract(uTime * 0.16 + 0.5) * 1.9 + 0.1) / 0.12, 2.0)) * 0.35;
  // Rows breathe out of step with each other.
  float breath = 0.5 + 0.5 * sin(uTime * 0.9 - p.y * 38.0);
  // Fine chase inside the strip, like pixels of an LED tape.
  float chase = pow(0.5 + 0.5 * sin(q.x * 90.0 + q.y * 60.0 - uTime * 5.0), 6.0);
  // The strike front: a hot band that follows the lightning from left to right.
  float front = exp(-pow((p.x - uSweep.x) / 0.05, 2.0)) * uSweep.y;
  float trail = exp(-max(uSweep.x - p.x, 0.0) / 0.18) * step(p.x, uSweep.x) * uSweep.y * 0.35;
  return 0.62 + 0.22 * breath + 0.9 * wave + echo + 0.12 * chase + 1.6 * front + trail;
}

// The LED tape behind the TV frame: how much a pixel belongs to the halo ring around the glass.
float haloZone(vec2 p) {
  vec2 lo = smoothstep(uHalo.xy - 0.004, uHalo.xy + 0.004, p);
  vec2 hi = 1.0 - smoothstep(uHalo.zw - 0.004, uHalo.zw + 0.004, p);
  return lo.x * lo.y * hi.x * hi.y;
}

// Position along the frame perimeter, 0..1 clockwise from the top-left corner.
float perimeter(vec2 p) {
  vec2 a = vec2(uImageAspect, 1.0);
  vec2 lo = uRect.xy * a;
  vec2 hi = uRect.zw * a;
  vec2 q = clamp(p * a, lo, hi);
  vec2 size = hi - lo;
  float total = 2.0 * (size.x + size.y);
  vec2 d = vec2(min(q.x - lo.x, hi.x - q.x), min(q.y - lo.y, hi.y - q.y));
  float t;
  if (d.y <= d.x) {
    t = q.y - lo.y < hi.y - q.y ? q.x - lo.x : size.x + size.y + (hi.x - q.x);
  } else {
    t = hi.x - q.x < q.x - lo.x ? size.x + (q.y - lo.y) : 2.0 * size.x + size.y + (hi.y - q.y);
  }
  return t / total;
}

// The backlight runs its own show: two comets chase round the frame in opposite directions,
// the whole tape breathes, it picks up the colour of the picture next to it, and the stretch
// of frame over the struck column flares with the strike.
float haloAnimation(vec2 p, float picture) {
  float t = perimeter(p);
  float ring = fract(uTime * 0.11);
  float d1 = abs(fract(t - ring + 0.5) - 0.5);
  float d2 = abs(fract(t + ring * 1.0 + 0.25) - 0.5);
  float comets = exp(-pow(d1 / 0.09, 2.0)) + 0.7 * exp(-pow(d2 / 0.08, 2.0));
  float breath = 0.5 + 0.5 * sin(uTime * 0.7);
  float boardX = mix(uRect.x, uRect.z, 0.03 + clamp((uSweep.x + 0.05) / 1.1, 0.0, 1.0) * 0.94);
  float front = exp(-pow((p.x - boardX) / 0.09, 2.0)) * uSweep.y;
  return 0.85 + 0.08 * breath + 0.3 * comets + 0.55 * front + picture * 0.7;
}

// The ceiling lights burn: the LED cores go white-hot, above 1.0, so the bloom pass catches them.
vec3 ceilingGlow(vec2 p, float hotMask, float lamps, float anim) {
  // Only the tight falloff of the tape itself; the bloom pass spreads the light over the frame.
  vec3 core = vec3(1.0, 0.88, 0.66) * hotMask * 2.6;
  float near = textureLod(uMasks, p, 1.5).b * 0.25;
  return (core + vec3(1.0, 0.6, 0.24) * near) * anim * lamps;
}

// Downlights: a bright halo, a faint four-point glare from the lens, and a soft cone of light
// falling through the haze of the studio.
vec3 downlights(vec2 p, float lamps) {
  vec3 total = vec3(0.0);
  vec2 pixels = vec2(uImageAspect, 1.0) * 1131.0;
  for (int i = 0; i < ${DOWNLIGHTS.length}; i++) {
    vec2 d = (p - uDownlights[i]) * pixels;
    float r = length(d);
    float fi = float(i);
    float halo = exp(-r / 4.0) * 3.0;
    float glare = exp(-abs(d.y) / 0.9) * exp(-abs(d.x) / 55.0) + exp(-abs(d.x) / 0.9) * exp(-abs(d.y) / 30.0) * 0.6;
    float below = max(d.y, 0.0);
    float width = 6.0 + below * 0.33;
    float cone = exp(-pow(d.x / width, 2.0)) * smoothstep(0.0, 12.0, below) * exp(-below / 260.0);
    float drift = 0.8 + 0.2 * fbm(vec2(p.x * 30.0 + fi, p.y * 8.0 - uTime * 0.08));
    // The bulbs fire in turn around the ceiling, and flare when the strike front passes them.
    float turn = fract(uTime * 0.35 - fi / ${DOWNLIGHTS.length}.0);
    float pulse = 0.55 + 0.9 * exp(-turn * 7.0) + 0.1 * sin(uTime * 2.3 + fi * 1.7);
    pulse += 1.4 * exp(-pow((uDownlights[i].x - uSweep.x) / 0.05, 2.0)) * uSweep.y;
    total += (vec3(1.0, 0.8, 0.52) * (halo + glare * 0.2 * pulse) + vec3(1.0, 0.7, 0.4) * cone * 0.07 * drift) * pulse;
  }
  return total * lamps;
}

// Lightning on the fluted columns: jagged arcs wrapped around the shaft run down from the
// capital with the TV strike. Distances are in image-height units.
// Returns x: the white-hot cores, y: their glow.
vec2 shaftArcs(float u, float v, float radius, float seed, float spread) {
  float theta = asin(clamp(u, -1.0, 1.0));
  vec2 total = vec2(0.0);
  for (int k = 0; k < 4; k++) {
    float fk = float(k);
    // Straight segments with sharp kinks, like a real channel, plus a fine crackle.
    float segments = 16.0 + fk * 6.0;
    float cell = floor(v * segments);
    float f = fract(v * segments);
    float a = hash(vec2(cell + seed * 3.7, fk * 11.3)) - 0.5;
    float b = hash(vec2(cell + 1.0 + seed * 3.7, fk * 11.3)) - 0.5;
    float drift = (noise(vec2(v * 2.5 + fk * 4.0, seed)) - 0.5) * 1.6;
    float start = (hash(vec2(seed, fk * 7.1)) - 0.5) * 1.8;
    float th = start + drift + mix(a, b, f) * 0.55 + (noise(vec2(v * 90.0, seed + fk * 5.0)) - 0.5) * 0.06;
    // Forks: every arc after the first lives only along a stretch of the shaft.
    float from = hash(vec2(seed * 1.9, fk)) * 0.7;
    float len = 0.15 + hash(vec2(seed * 2.3, fk)) * 0.35;
    float stretch = k == 0 ? 1.0 : smoothstep(from, from + 0.02, v) * (1.0 - smoothstep(from + len - 0.08, from + len, v));
    // The part of an arc that goes round the back of the column is hidden.
    float facing = 1.0 - smoothstep(1.05, 1.5, abs(th));
    float d = abs(u - sin(clamp(th, -1.5708, 1.5708))) * radius;
    float weight = (k == 0 ? 1.0 : 0.5) * facing * stretch;
    total.x += exp(-pow(d / (0.0012 * spread), 2.0)) * weight;
    total.y += exp(-d / (0.006 * spread)) * weight;
  }
  total *= 0.6 + 0.4 * cos(theta);
  return total;
}

vec3 pillarLightning(vec2 p, vec3 base, float metal) {
  vec3 total = vec3(0.0);
  vec3 hot = vec3(1.0, 0.96, 0.88);
  vec3 gold = vec3(1.0, 0.68, 0.28);
  for (int i = 0; i < ${PILLARS.length}; i++) {
    vec4 arc = uPillarArcs[i];
    if (arc.x <= 0.001) {
      continue;
    }
    vec4 sh = uPillars[i];
    float floorY = uPillarFloor[i];
    // Below the base the polished floor mirrors the column.
    float mirrored = step(floorY, p.y);
    vec2 q = vec2(p.x, mirrored > 0.5 ? 2.0 * floorY - p.y : p.y);
    float halfW = (sh.z - sh.x) * 0.5;
    float radius = halfW * uImageAspect;
    float u = (q.x - (sh.x + sh.z) * 0.5) / halfW;
    float v = (q.y - sh.y) / (sh.w - sh.y);
    float along = smoothstep(-0.01, 0.02, v) * (1.0 - smoothstep(0.98, 1.01, v));
    float head = 1.0 - smoothstep(arc.z - 0.06, arc.z, v);
    float spread = mirrored > 0.5 ? 3.0 : 1.0;
    float inShaft = 1.0 - smoothstep(0.97, 1.0, abs(u));
    vec2 a = inShaft > 0.0 ? shaftArcs(u, v, radius, arc.y, spread) * inShaft : vec2(0.0);
    // Flutes near the arc catch its light; the wall beside the column gets a soft spill.
    float outsideDist = max(abs(u) - 1.0, 0.0) * radius;
    // Capitals and bases pick up the arc too, so the spill reaches a little past the shaft.
    float reach = smoothstep(-0.12, 0.0, v) * (1.0 - smoothstep(1.0, 1.12, v));
    float wide = exp(-outsideDist / 0.03) * reach;
    float charge = arc.x * along * head;
    // The light ahead of the arc tip fades in softly; a hard line there would give the cut away.
    float lit = arc.x * reach * (1.0 - smoothstep(arc.z - 0.2, arc.z + 0.1, v));
    vec3 light = (hot * a.x * 1.5 + gold * a.y * 0.8) * charge;
    // Air glow around the column while the arc burns.
    light += gold * exp(-outsideDist / 0.012) * lit * 0.025;
    light += base * gold * (lit * along * inShaft * (0.3 + metal * 4.0) * (0.2 + a.y * 1.5)
                          + lit * wide * (1.0 - inShaft * along) * (0.6 + metal * 3.5));
    total += light * (mirrored > 0.5 ? 0.22 * exp(-(p.y - floorY) * 14.0) : 1.0);
  }
  return total;
}

void main() {
  vec2 c = vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y);
  vec2 p = uCover.xy + c * uCover.zw;
  vec3 plate = toLinear(texture(uImage, p).rgb);
  vec4 masks = texture(uMasks, p);
  float lamps = lampGain();
  vec2 s = toScreen(p);
  float halo = haloZone(p);
  float picture = dot(wall(clamp(s, 0.0, 1.0), 5.0), vec3(0.3, 0.59, 0.11));
  float haloAnim = haloAnimation(p, picture);
  float anim = mix(ledAnimation(p), haloAnim, halo);
  vec3 base = plate * mix(1.0, lamps * anim, masks.r);
  // The tape itself sits behind the outer gold line of the frame (8 px outside the glass) and
  // throws its light onto the wall: a tight glow and a wide one.
  vec2 frameLo = (uRect.xy - vec2(8.0 / 2000.0, 8.0 / 1131.0)) * vec2(uImageAspect, 1.0);
  vec2 frameHi = (uRect.zw + vec2(8.0 / 2000.0, 8.0 / 1131.0)) * vec2(uImageAspect, 1.0);
  vec2 pa = p * vec2(uImageAspect, 1.0);
  vec2 gap = max(max(frameLo - pa, pa - frameHi), 0.0);
  float tapeDist = length(gap);
  float beyond = step(0.0, max(gap.x, gap.y) - 1e-6);
  float tapeLight = exp(-tapeDist / 0.01) * 0.03 * beyond;
  base += vec3(1.0, 0.66, 0.28) * tapeLight * lamps * haloAnim;

  vec2 fw = fwidth(s) * 1.25;
  vec2 m = smoothstep(vec2(0.0), fw, s) * smoothstep(vec2(0.0), fw, 1.0 - s);
  float inside = m.x * m.y;
  float outside = 1.0 - inside;

  // Video wall emission. The panel in the plate is a dark matte screen: the picture replaces it,
  // and only a trace of the room light on the panel stays as a reflection on the glass.
  vec3 sharp = texture(uContent, vec2(s.x, 1.0 - s.y)).rgb;
  vec3 bloom = textureLod(uContent, vec2(s.x, 1.0 - s.y), 3.0).rgb * 0.14
             + textureLod(uContent, vec2(s.x, 1.0 - s.y), 5.0).rgb * 0.1;
  vec3 emit = toLinear(ledTone(sharp + bloom));
  float sheen = smoothstep(0.35, 0.0, abs(s.x * 0.6 - s.y + 0.15)) * 0.0025;
  // The glass sits recessed in its bevel: a soft contact shadow along the edges.
  vec2 edgeDist = min(s, 1.0 - s) * vec2(uScreenAspect, 1.0);
  float recess = smoothstep(0.0, 0.03, min(edgeDist.x, edgeDist.y));
  emit *= 0.55 + 0.45 * recess;
  // Grazing reflections of the columns and the ceiling in the glass near its edges.
  vec2 mirrorX = vec2(s.x < 0.5 ? 2.0 * uRect.x - p.x : 2.0 * uRect.z - p.x, p.y);
  vec2 mirrorY = vec2(p.x, 2.0 * uRect.y - p.y);
  vec3 sideRefl = toLinear(textureLod(uImage, mirrorX, 2.5).rgb) * exp(-edgeDist.x * 9.0);
  vec3 topRefl = toLinear(textureLod(uImage, mirrorY, 2.5).rgb) * exp(-edgeDist.y * 11.0) * lamps;
  float lit = clamp(dot(emit, vec3(0.33)) * 3.0, 0.0, 1.0);
  vec3 glass = (sideRefl * 0.07 + topRefl * 0.06 + plate * 0.1) * (1.0 - 0.6 * lit);
  vec3 col = mix(base, emit + glass + vec3(0.0015, 0.0013, 0.001) + sheen, inside);

  // Light the wall throws into the room. Polished gold answers it far more than black lacquer.
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
  float metal = masks.g;
  // Gold highlights flare with the flash: a specular kick on top of the diffuse light.
  vec3 glint = uFlash.rgb * flashFall * metal * metal * 2.2;
  col += outside * (base * light * (2.2 + metal * 2.6) + base * glint);
  col += outside * pillarLightning(p, base, metal);
  // Lamps emit on their own: added after the room lighting, so the TV flash does not pump them.
  col += outside * (ceilingGlow(p, masks.b, lamps, anim) + downlights(p, lamps));

  // Reflection in the polished floor, mirrored about the wall-floor seam. It is squeezed into a band
  // right in front of the wall, and widens towards the camera along the floor lines.
  float floorMask = smoothstep(uFloorY - 0.004, uFloorY + 0.012, p.y);
  // The TV reflected in the floor is dim stone, not a light: it stays out of the bloom.
  vec3 reflected = vec3(0.0);
  if (floorMask > 0.0) {
    const float squeeze = 0.5;
    float dist = p.y - uMirrorY;
    float source = dist / squeeze;
    float trueWidthY = uMirrorY + squeeze * 0.12;
    float spread = (trueWidthY - uVanish.y) / max(p.y - uVanish.y, 1e-3);
    vec2 ripple = (vec2(fbm(p * vec2(40.0, 14.0)), fbm(p * vec2(40.0, 14.0) + 7.3)) - 0.5) * 0.003;
    vec2 sr = toScreen(vec2(uVanish.x + (p.x - uVanish.x) * spread, uMirrorY - source) + ripple);
    float soft = 0.004 + source * 0.05;
    vec2 mr = smoothstep(-soft, soft, sr) * smoothstep(-soft, soft, 1.0 - sr);
    // Polished marble smears a reflection along the view direction: blur it mostly vertically.
    float lod = 0.8 + source * 3.5;
    // Taps sit about one blurred texel apart, so they merge into a smear instead of copies.
    vec3 reflection = vec3(0.0);
    float weights = 0.0;
    for (int k = -4; k <= 4; k++) {
      float fk = float(k);
      float w = exp(-fk * fk / 8.0);
      vec2 o = vec2(0.0, fk * (0.002 + source * 0.025));
      reflection += wall(clamp(sr + o, 0.0, 1.0), lod) * w;
      weights += w;
    }
    reflection /= weights;
    // The veins and the polish vary over the stone, so the reflection breaks up with them.
    float stone = dot(texture(uImage, p).rgb, vec3(0.3, 0.59, 0.11));
    reflection *= 0.6 + 2.2 * stone;
    // Black marble mutes what it reflects: less light and less colour. Gold inlay mirrors warmer.
    reflection = mix(reflection, vec3(dot(reflection, vec3(0.3, 0.59, 0.11))), 0.3);
    float strength = (0.32 + metal * 0.45) * exp(-source * 2.6) * floorMask;
    reflected += reflection * mr.x * mr.y * strength;

    // The lit screen as a whole: a soft glow at the TV's own width that starts at the seam.
    vec2 sg = toScreen(vec2(p.x, uMirrorY - source));
    float glowEdge = 0.04 + source * 0.3;
    vec2 mg = smoothstep(-glowEdge, glowEdge, sg) * smoothstep(-glowEdge, glowEdge, 1.0 - sg);
    vec3 glow = wall(clamp(sg, 0.0, 1.0), 6.5);
    reflected += glow * mg.x * mg.y * 0.06 * exp(-source * 4.0) * floorMask;
    col += reflected;
  }

  // Ground haze, lit by the wall, the lightning and the house lights.
  float fog = groundFog(p) * outside;
  vec3 fogLight = average * 0.5 + edge * near * 0.4 + uFlash.rgb * (0.3 + flashFall * 0.8)
                + vec3(1.0, 0.6, 0.25) * textureLod(uMasks, p, 7.0).r * 0.35 * lamps;
  col = col * (1.0 - fog * 0.25) + fog * (fogLight * 0.4 + vec3(0.0045, 0.0035, 0.0025));

  // Dust in the air, caught by the wall light and the flashes.
  vec3 airLight = edge * near * 1.2 + average * 0.5 + uFlash.rgb * flashFall * 1.2;
  // The dust hangs in front of the TV too, so it covers the glass as well.
  col += motes(q) * airLight * 0.5;

  // Thin haze in the air, only visible where the wall light passes through it.
  float haze = fbm(vec2(p.x * 3.2 + uTime * 0.011, p.y * 5.0 - uTime * 0.005) + fbm(p * 2.0 - uTime * 0.004));
  haze = smoothstep(0.3, 0.95, haze);
  col += haze * (edge * near * 0.05 + uFlash.rgb * flashFall * 0.06 + average * 0.012);

  if (uDebug > 0.5) {
    float border = (1.0 - smoothstep(0.0, fw.x * 2.0, min(min(s.x, 1.0 - s.x), min(s.y, 1.0 - s.y)))) * step(abs(s.x - 0.5), 0.5 + fw.x * 2.0) * step(abs(s.y - 0.5), 0.5 + fw.y * 2.0);
    col = mix(col, vec3(0.0, 1.0, 0.3), border);
    float lines = step(abs(p.y - uMirrorY), 0.0015) + step(abs(p.y - uFloorY), 0.0015);
    col = mix(col, vec3(1.0, 0.8, 0.0), clamp(lines, 0.0, 1.0));
    col = mix(col, vec3(1.0, 0.0, 0.6), masks.r * 0.5);
    col = mix(col, vec3(0.0, 0.6, 1.0), masks.g * 0.35);
  }

  // Linear HDR: the bloom pass reads it and writes the display frame.
  // Alpha is the share of the pixel that may bloom: everything but the floor reflection.
  float total = max(col.r, max(col.g, col.b));
  float mirror = max(reflected.r, max(reflected.g, reflected.b));
  outColor = vec4(col, 1.0 - clamp(mirror / max(total, 1e-4), 0.0, 1.0));
}
`;

// Bloom, step 1: the light above the threshold, with a soft knee, at half resolution.
const BRIGHT_FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uScene;
uniform vec2 uRes;

out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 scene = texture(uScene, uv);
  vec3 c = scene.rgb * scene.a;
  float l = max(c.r, max(c.g, c.b));
  const float threshold = 0.55;
  const float knee = 0.35;
  float soft = clamp(l - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  float weight = max(soft, l - threshold) / max(l, 1e-4);
  outColor = vec4(c * weight, 1.0);
}
`;

// Bloom, step 2: the whole frame, TV included, gets the same glow from its bright pixels.
// The mip chain of the bright pass is the blur pyramid; four taps per level hide the box shape.
const FINAL_FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uScene;
uniform sampler2D uBright;
uniform vec2 uRes;
uniform float uTime;

out vec4 outColor;

${NOISE}

vec3 level(vec2 uv, float lod) {
  vec2 texel = exp2(lod) / uRes;
  return (textureLod(uBright, uv + texel * vec2(0.5, 0.5), lod).rgb
        + textureLod(uBright, uv + texel * vec2(-0.5, 0.5), lod).rgb
        + textureLod(uBright, uv + texel * vec2(0.5, -0.5), lod).rgb
        + textureLod(uBright, uv + texel * vec2(-0.5, -0.5), lod).rgb) * 0.25;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 col = texture(uScene, uv).rgb;
  vec3 bloom = level(uv, 1.0) * 0.22 + level(uv, 2.5) * 0.2 + level(uv, 4.0) * 0.16 + level(uv, 5.5) * 0.12;
  col += bloom * 0.5;
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  float grain = hash(gl_FragCoord.xy + fract(uTime * 7.31) * vec2(113.0, 71.0)) - 0.5;
  col += grain * 0.012;
  outColor = vec4(col, 1.0);
}
`;

export {
  FULLSCREEN_VERT,
  CONTENT_FRAG,
  SPRITE_VERT,
  SPRITE_FRAG,
  TILE_VERT,
  TILE_FRAG,
  COMPOSITE_FRAG,
  BRIGHT_FRAG,
  FINAL_FRAG,
};
