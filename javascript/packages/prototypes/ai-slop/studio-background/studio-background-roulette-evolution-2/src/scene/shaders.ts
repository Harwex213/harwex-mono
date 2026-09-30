import { DOWNLIGHTS, FRAME_LED, PILLARS } from "./calibration";

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
  clouds = pow(clouds, vec3(1.15)) * 1.0;
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

  // Bolts light the cloud deck from inside with a warm gold-white.
  vec3 col = clouds * (1.0 + glow * vec3(3.8, 3.0, 2.1) * (0.35 + density * 2.6));
  col += glow * vec3(0.1, 0.065, 0.025);

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
  vec3 col = layers.r * vec3(2.9, 2.7, 2.3)
           + layers.g * vec3(1.75, 1.15, 0.4)
           + layers.b * vec3(1.15, 0.55, 0.12) * 0.9;
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

  vec3 cream = vec3(0.99, 0.95, 0.86);
  vec3 gold = vec3(0.96, 0.74, 0.38);
  vec3 ink = vInfo.y < 0.5 ? cream : (vInfo.y < 1.5 ? vec3(0.93, 0.2, 0.15) : vec3(0.3, 0.72, 0.36));
  vec3 electric = vec3(1.0, 0.74, 0.3);
  float flicker = 0.82 + 0.18 * noise(vec2(uTime * 32.0, seed * 91.0));

  // Smoked glass body: a lit top edge, an inner shadow, a faint underglow in the numeral colour.
  float gy = clamp(p.y / h.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 fill = mix(vec3(0.09, 0.082, 0.07), vec3(0.018, 0.016, 0.014), gy);
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
  vec3 rimColor = mix(gold * (0.55 + 0.45 * cornerAccent), electric * 0.85, charge);
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
  rgb += gold * 0.12 * hair * body * (1.0 - 0.5 * charge);
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
  rgb += mix(gold, cream, 0.5) * band * (rim * 0.7 + body * 0.05) * (1.0 - charge);

  // Impact: white flash, then a shock ring leaving the rim.
  if (age >= 0.0) {
    rgb += vec3(1.1, 0.98, 0.82) * flash * (body * 0.5 + rim * 0.9);
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
uniform sampler2D uMasks;
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
uniform float uHorizon;
uniform vec2 uVanish;
uniform float uDebug;
uniform vec4 uPillarShaft[${PILLARS.length}];
uniform vec4 uPillarColumn[${PILLARS.length}];
uniform float uPillarBase[${PILLARS.length}];
uniform float uPillars[${PILLARS.length}];
uniform float uEnergy;
// Seconds since the current strike sequence started; large when none has played yet.
uniform float uSweep;
uniform vec2 uDownlights[${DOWNLIGHTS.length}];

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

// ---- Arcs on the room's columns. ----

const vec2 PLATE_PX = vec2(2000.0, 1131.0);

// Arc light of one column at plate pixel P: x = hot core, y = glow. Arcs are re-drawn every
// 1/24 s, like a real discharge that keeps jumping to a new path. y is the height along the
// shaft; the floor reflection passes a mirrored height.
vec2 columnArcs(int i, vec2 P, float intensity) {
  vec4 shaft = uPillarShaft[i] * PLATE_PX.xyxy;
  float width = shaft.z - shaft.x;
  if (P.x < shaft.x - width * 0.6 || P.x > shaft.z + width * 0.6) {
    return vec2(0.0);
  }
  float v = (P.y - shaft.y) / (shaft.w - shaft.y);
  float fi = float(i);
  float frame = floor(uTime * 24.0);
  vec2 total = vec2(0.0);
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float seed = frame * 1.31 + fk * 7.7 + fi * 13.1;
    // Secondary strands only show up on some frames.
    float weight = k == 0 ? 1.0 : step(0.45, hash(vec2(seed, 3.1))) * 0.6;
    if (weight <= 0.0) {
      continue;
    }
    // Every strand covers its own stretch of the shaft.
    float a = hash(vec2(seed, 1.7)) * 0.35 - 0.05;
    float b = a + 0.45 + hash(vec2(seed, 2.9)) * 0.6;
    float span = smoothstep(a, a + 0.04, v) * (1.0 - smoothstep(b - 0.04, b, v));
    if (span <= 0.0) {
      continue;
    }
    float cx = mix(shaft.x, shaft.z, 0.2 + 0.6 * hash(vec2(seed, 5.3)));
    float jag = (noise(vec2(v * 7.0, seed)) - 0.5) * width * 0.45
              + (noise(vec2(v * 26.0, seed + 4.0)) - 0.5) * width * 0.16
              + (noise(vec2(v * 90.0, seed + 9.0)) - 0.5) * width * 0.05;
    float x = clamp(cx + jag, shaft.x + 2.0, shaft.z - 2.0);
    float dx = abs(P.x - x);
    // The shaft is round: an arc near its silhouette is seen at a grazing angle and dims.
    float facing = 1.0 - pow(abs((x - (shaft.x + shaft.z) * 0.5) / (width * 0.5)), 3.0);
    float core = exp(-dx * dx / 1.4);
    float glow = exp(-dx / 8.0) * 0.6 + exp(-dx / 30.0) * 0.18;
    total += vec2(core, glow) * span * weight * (0.5 + 0.5 * facing);
  }
  return total * intensity;
}

// Light a burst throws onto the column itself and the walls and floor around it.
float columnSpill(int i, vec2 P, float intensity) {
  vec4 column = uPillarColumn[i] * PLATE_PX.xyxy;
  float cx = (column.x + column.z) * 0.5;
  float halfWidth = (column.z - column.x) * 0.5;
  float dx = max(abs(P.x - cx) - halfWidth, 0.0);
  float dy = max(max(column.y - P.y, P.y - column.w), 0.0);
  return intensity / (1.0 + (dx * dx + dy * dy) / (halfWidth * halfWidth * 4.0));
}

// ---- Ceiling lights. ----

const vec2 FRAME_CENTRE = vec2(${FRAME_LED.centre[0].toFixed(1)}, ${FRAME_LED.centre[1].toFixed(1)});
const vec2 FRAME_HALF = vec2(${FRAME_LED.halfSize[0].toFixed(1)}, ${FRAME_LED.halfSize[1].toFixed(1)});
const float FRAME_INSET = ${FRAME_LED.hairlineInset.toFixed(1)};

float frameSdf(vec2 P, vec2 halfSize) {
  vec2 d = abs(P - FRAME_CENTRE) - halfSize;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// A comet running round the frame; gap is how far behind its head a point is (0..1).
// The tail fades in over the first steps behind the head, so the head has no hard edge
// that the wide glow would throw onto the wall as a line.
float comet(float gap) {
  float tail = exp(-gap / 0.05) * smoothstep(0.0, 0.015, gap);
  float head = exp(-pow(min(gap, 1.0 - gap) / 0.008, 2.0));
  return tail + head * 0.8;
}

// Light of the LED line around the TV at plate pixel P: x = hot core, y = glow.
// Two comets chase each other round the frame; the rest follows the ceiling strips.
vec2 frameLed(vec2 P, float level) {
  float d = frameSdf(P, FRAME_HALF);
  float hairline = frameSdf(P, FRAME_HALF - FRAME_INSET);
  vec2 q = (P - FRAME_CENTRE) / FRAME_HALF;
  float around = atan(q.y, q.x) / 6.28318 + 0.5;
  float cometA = fract(uTime * 0.11);
  float cometB = fract(-uTime * 0.11 + 0.5);
  float gapA = fract(cometA - around);
  float gapB = fract(around - cometB);
  float chase = comet(gapA) + comet(gapB);
  float bright = level * (0.85 + 0.3 * chase);
  float core = exp(-d * d / 1.6) + exp(-hairline * hairline / 0.8) * 0.25;
  float glow = exp(-abs(d) / 5.0) * 0.5 + exp(-abs(d) / 22.0) * 0.12;
  return vec2(core, glow) * bright;
}

// Level of the LED strips at plate x. The strips run left to right (the diagonals of the cove
// are close to 45 degrees), so x alone is a good coordinate along them.
//   Idle: soft waves of light flow out from the centre, and a comet runs out now and then.
//   Strike: a bright wave runs left to right with the bolts.
//   Charged board: the strips pulse faster.
float ledLevel(float x) {
  float fromCentre = abs(x - 999.0) / 520.0;
  float level = 0.74 + 0.32 * sin(fromCentre * 9.0 - uTime * 1.7) + 0.08 * sin(fromCentre * 23.0 + uTime * 0.9);
  float cometHead = fract(uTime / 6.5) * 1.8 - 0.3;
  float behind = cometHead - fromCentre;
  level += behind > 0.0 ? exp(-behind / 0.18) * 0.55 : exp(-pow(behind / 0.03, 2.0)) * 0.55;
  // The strike wave takes as long as the bolts take to cross the board.
  float along = (x - 480.0) / 1040.0;
  float head = uSweep / 1.3;
  if (head > -0.1 && head < 1.6) {
    float gap = head - along;
    float wave = gap > 0.0 ? exp(-gap / 0.12) * 1.4 : exp(-pow(gap / 0.035, 2.0)) * 2.2;
    level += wave * (1.0 - smoothstep(1.2, 1.6, head));
  }
  level += uEnergy * (0.2 + 0.3 * sin(uTime * 7.0 - fromCentre * 6.0));
  return clamp(level, 0.3, 3.5);
}

// A recessed downlight seen from below and a little to the side: a white-hot lens, a warm
// halo in the air around it, a faint horizontal streak in the camera lens.
vec3 downlight(vec2 P, vec2 lamp) {
  vec2 d = P - lamp;
  // The lens is round, seen at an angle, so it is wider than tall.
  float lens = length(d * vec2(1.0, 1.6));
  float core = exp(-lens * lens / 7.0) * 2.2;
  float halo = exp(-lens / 7.0) * 0.35 + exp(-lens / 28.0) * 0.07 + exp(-lens / 90.0) * 0.015;
  float streak = exp(-abs(d.y) / 1.3) * exp(-abs(d.x) / 70.0) * 0.1;
  return vec3(1.0, 0.93, 0.8) * core + vec3(1.0, 0.72, 0.4) * (halo + streak);
}

// The beam of a downlight in the haze: a narrow cone falling straight down, fading with depth.
float downlightBeam(vec2 P, vec2 lamp) {
  float below = P.y - lamp.y;
  if (below <= 4.0) {
    return 0.0;
  }
  float width = 5.0 + below * 0.32;
  float across = (P.x - lamp.x) / width;
  return exp(-across * across * 2.0) * exp(-below / 320.0) * smoothstep(4.0, 30.0, below);
}

// Gold dust hanging in the air. At rest it barely shows. When the board charges, the motes
// light up in the wall's light, and sparks near a firing column flare.
vec3 airParticles(vec2 p, float glowNear, float flashLight) {
  vec2 q = p * vec2(uImageAspect, 1.0);
  vec3 total = vec3(0.0);
  for (int layer = 0; layer < 3; layer++) {
    float fl = float(layer);
    // Near layers are bigger, faster and out of focus.
    float scale = 34.0 - fl * 11.0;
    vec2 drift = vec2(uTime * (0.006 + fl * 0.004), -uTime * (0.012 + fl * 0.01));
    vec2 g = q * scale + drift * scale + vec2(fl * 17.3, fl * 5.1);
    vec2 cell = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash(cell + fl * 41.7);
    if (h < 0.84) {
      continue;
    }
    // The mote and its blur stay inside the cell, or the cell edge would cut it off.
    float radius = 0.025 + fl * 0.025;
    float room = 0.5 - radius * 3.0 - 0.05;
    vec2 off = (vec2(hash(cell + 3.7), hash(cell + 8.1)) - 0.5) * 2.0 * room * 0.8;
    off += 0.05 * vec2(sin(uTime * (0.6 + h) + h * 40.0), cos(uTime * (0.5 + h * 0.7) + h * 23.0));
    float dist = length(f - off);
    float mote = exp(-dist * dist / (radius * radius));
    float twinkle = 0.55 + 0.45 * sin(uTime * (1.5 + h * 4.0) + h * 60.0);
    float brightness = 0.02 + uEnergy * (0.2 + 0.45 * twinkle) + flashLight * 0.9 + glowNear * 1.5;
    // Out-of-focus motes spread the same light over a bigger disc, so each one is dimmer.
    total += vec3(1.0, 0.7, 0.34) * mote * brightness * (0.6 - fl * 0.2);
  }
  return total;
}

void main() {
  vec2 c = vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y);
  vec2 p = uCover.xy + c * uCover.zw;
  vec3 plate = toLinear(texture(uImage, p).rgb);
  vec4 masks = texture(uMasks, p);
  // The LED strips are animated; the glow they baked into the plate follows them.
  float led = masks.b;
  float ledNear = textureLod(uMasks, p, 2.0).b;
  float ledMid = textureLod(uMasks, p, 4.0).b;
  float ledWide = textureLod(uMasks, p, 6.0).b;
  float dimmer = ledLevel(p.x * 2000.0);
  float bakedGlow = max(led, clamp(ledWide * 4.0, 0.0, 1.0) * 0.7);
  vec3 base = plate * mix(1.0, dimmer, bakedGlow);
  vec2 s = toScreen(p);

  vec2 fw = fwidth(s) * 1.25;
  vec2 m = smoothstep(vec2(0.0), fw, s) * smoothstep(vec2(0.0), fw, 1.0 - s);
  float inside = m.x * m.y;
  float outside = 1.0 - inside;

  // Video wall emission.
  vec3 sharp = texture(uContent, vec2(s.x, 1.0 - s.y)).rgb;
  vec3 bloom = textureLod(uContent, vec2(s.x, 1.0 - s.y), 3.0).rgb * 0.14
             + textureLod(uContent, vec2(s.x, 1.0 - s.y), 5.0).rgb * 0.1;
  vec3 emit = toLinear(ledTone(sharp + bloom));
  // The glass sits recessed in its bevel: a soft contact shadow along the edges.
  vec2 edgeDist = min(s, 1.0 - s) * vec2(uScreenAspect, 1.0);
  float recess = smoothstep(0.0, 0.03, min(edgeDist.x, edgeDist.y));
  emit *= 0.6 + 0.4 * recess;
  // The dark panel in the plate carries the wash of the ceiling downlight. Part of it stays
  // on the glass as a reflection; the lit panel outshines the rest.
  float wallLevel = clamp(dot(emit, vec3(0.3, 0.59, 0.11)) * 4.0, 0.0, 1.0);
  vec3 onGlass = plate * mix(0.3, 0.12, wallLevel);
  // Grazing reflections of the side walls and ceiling in the glass near its edges.
  vec2 mirrorX = vec2(s.x < 0.5 ? 2.0 * uRect.x - p.x : 2.0 * uRect.z - p.x, p.y);
  vec2 mirrorY = vec2(p.x, 2.0 * uRect.y - p.y);
  vec3 sideRefl = toLinear(textureLod(uImage, mirrorX, 2.5).rgb) * exp(-edgeDist.x * 9.0);
  vec3 topRefl = toLinear(textureLod(uImage, mirrorY, 2.5).rgb) * exp(-edgeDist.y * 11.0);
  vec3 glass = (sideRefl * 0.06 + topRefl * 0.05) * (1.0 - 0.6 * wallLevel);
  vec3 col = base * outside + (onGlass + emit + glass + vec3(0.0012, 0.0011, 0.001)) * inside;

  // Light the wall throws into the room.
  vec2 aspect = vec2(uImageAspect, 1.0);
  vec2 q = p * aspect;
  vec2 dd = max(max(uRect.xy * aspect - q, q - uRect.zw * aspect), 0.0);
  float d = length(dd);
  float near = 1.0 / (1.0 + d * d * 120.0);
  vec2 sc = clamp(s, 0.0, 1.0);
  vec3 edge = wall(sc, 6.0);
  vec3 average = wall(vec2(0.5), uLevels);
  vec2 flashAt = vec2(uFlash.w, mix(uRect.y, uRect.w, 0.2)) * aspect;
  float fd = length(q - flashAt);
  float flashFall = 1.0 / (1.0 + fd * fd * 4.0);
  vec3 flash = uFlash.rgb * (0.16 + flashFall * 1.6);
  vec3 light = edge * near * 3.0 + average * 0.9 + flash;
  // Polished gold mirrors the light: it brightens far more than the matte black walls.
  float metal = masks.g;
  col += outside * (base * light * (2.0 + metal * 3.5) + light * near * 0.003);
  // Hot glints on the gold edges that face the bolt.
  float plateLum = dot(plate, vec3(0.3, 0.59, 0.11));
  col += outside * metal * uFlash.rgb * flashFall * smoothstep(0.02, 0.25, plateLum) * 0.5;

  // The ceiling LED strips glow: a hotter, whiter core along the strip, then light that spills
  // out of the cove over the ceiling panels around it. The mip chain of the LED mask is the blur.
  vec2 P = p * PLATE_PX;
  vec3 ledColor = vec3(1.0, 0.7, 0.34);
  // The strip is only a few pixels wide, so its blurred mips are faint: they are scaled back up.
  col += outside * led * vec3(1.0, 0.85, 0.6) * 0.9 * dimmer;
  vec3 ledBloom = ledColor * (ledNear * 0.9 + ledMid * 1.3 + ledWide * 1.6) * dimmer;
  // Surfaces next to the strips catch its light; the gold trim on them flares.
  col += outside * (ledBloom * 0.45 + base * ledBloom * (1.5 + metal * 4.0));

  // The LED line around the TV, in yellow gold, kept low: it should read as a lit frame,
  // not pull the eye off the wall. On the glass side its glow only grazes the edge.
  vec2 frame = frameLed(P, dimmer);
  vec3 frameCore = vec3(1.0, 0.9, 0.62) * frame.x * 0.25;
  vec3 frameGlow = vec3(1.0, 0.76, 0.28) * frame.y * 0.3;
  col += frameCore * outside + frameGlow * (outside * 0.5 + inside * 0.25);
  col += outside * base * frameGlow * (1.0 + metal * 3.5);

  // Downlights, and their beams made visible by the studio haze.
  float haze = fbm(vec2(p.x * 3.2 + uTime * 0.011, p.y * 5.0 - uTime * 0.005) + fbm(p * 2.0 - uTime * 0.004));
  haze = smoothstep(0.3, 0.95, haze);
  float beams = 0.0;
  for (int i = 0; i < ${DOWNLIGHTS.length}; i++) {
    vec2 lamp = uDownlights[i] * PLATE_PX;
    col += outside * downlight(P, lamp);
    beams += downlightBeam(P, lamp);
  }
  col += outside * vec3(1.0, 0.76, 0.46) * beams * (0.008 + haze * 0.035);

  // Reflection of the TV in the polished marble: one blurred copy of the screen, with the same three
  // rows of tiles, and nothing outside it. The mirrored TV is taller than the visible floor, so it
  // is shortened by REFLECTION_HEIGHT until all of it fits between the plinth and the bottom of the
  // frame. At the foot of the plinth it has the TV's exact width; from there every point runs along
  // its ray from the vanishing point, so its sides are parallel to the lines of the side walls.
  float floorMask = smoothstep(uFloorY - 0.004, uFloorY + 0.01, p.y);
  if (floorMask > 0.0) {
    const float REFLECTION_HEIGHT = 0.6;
    // Distance from the seam in the reflected wall; blur and fade grow with it.
    float source = max(p.y - uMirrorY, 0.0) / REFLECTION_HEIGHT;
    float wallY = uMirrorY - source;
    float spread = (uFloorY - uVanish.y) / max(p.y - uVanish.y, 1e-3);
    float rx = uVanish.x + (p.x - uVanish.x) * spread;
    // A slow wobble across, as if the stone were not perfectly flat.
    float wobble = (fbm(vec2(p.x * 6.0, p.y * 40.0)) - 0.5) * 0.006;
    vec2 sr = toScreen(vec2(rx + wobble, wallY));
    // Outside the mirrored screen there is nothing to reflect.
    float edge = 0.008 + source * 0.03;
    vec2 mr = smoothstep(vec2(0.0), vec2(edge), sr) * smoothstep(vec2(0.0), vec2(edge), 1.0 - sr);
    // Blurred into hues, with a short smear down the floor that stays inside the screen.
    float lod = 3.6 + source * 2.5;
    float smear = 0.02 + source * 0.08;
    vec3 reflection = vec3(0.0);
    float total = 0.0;
    for (int k = -3; k <= 3; k++) {
      float t = float(k) / 3.0;
      float w = exp(-t * t * 2.0);
      reflection += wall(clamp(sr + vec2(0.0, t * smear), 0.0, 1.0), lod) * w;
      total += w;
    }
    reflection /= total;
    // Black marble mutes what it reflects: less light and a little less colour.
    reflection = mix(reflection, vec3(dot(reflection, vec3(0.3, 0.59, 0.11))), 0.2);
    float strength = 0.14 * exp(-source * 1.2) * floorMask;
    col += reflection * mr.x * mr.y * strength;

    // The frame LED line, mirrored in the marble and softened by it.
    vec2 frameMirror = frameLed(vec2(rx, wallY) * PLATE_PX, ledLevel(rx * PLATE_PX.x));
    col += vec3(1.0, 0.78, 0.3) * frameMirror.y * 0.05 * exp(-source * 5.0) * floorMask;
    // The bolts flash across the whole wet-look floor.
    col += uFlash.rgb * flashFall * 0.05 * exp(-source * 2.0) * floorMask;
  }

  // Arcs crawl over the columns while the strike plays.
  vec3 arcs = vec3(0.0);
  float spill = 0.0;
  for (int i = 0; i < ${PILLARS.length}; i++) {
    float intensity = uPillars[i];
    if (intensity <= 0.001) {
      continue;
    }
    vec4 column = uPillarColumn[i] * PLATE_PX.xyxy;
    float baseY = uPillarBase[i] * PLATE_PX.y;
    spill += columnSpill(i, P, intensity);
    if (P.y < baseY) {
      vec2 a = columnArcs(i, P, intensity);
      arcs += vec3(1.7, 1.5, 1.2) * a.x + vec3(1.0, 0.62, 0.22) * a.y;
    } else {
      // The polished floor mirrors the arcs under the foot of the column, blurred.
      float below = P.y - baseY;
      vec2 a = columnArcs(i, vec2(P.x + (fbm(P * 0.05) - 0.5) * 6.0, baseY - below * 1.1), intensity);
      arcs += vec3(1.0, 0.62, 0.22) * (a.x * 0.2 + a.y * 0.5) * exp(-below / 90.0) * 0.5;
    }
  }
  // Gold under the arcs lights up; the room around each column catches its light too.
  vec3 arcLight = vec3(1.0, 0.72, 0.4) * spill;
  col += outside * (base * arcLight * (1.2 + metal * 5.0) + arcs * (0.55 + 0.45 * metal));

  // Dust and sparks in the air, lit by the wall, the bolts and the columns.
  // Motes drifting through a downlight beam or past the LED cove catch its light.
  float lampLight = beams * 0.35 + ledMid * 0.5;
  col += airParticles(p, spill * 0.3 + lampLight, dot(uFlash.rgb, vec3(0.33)) * flashFall) * (1.0 - inside * 0.5);

  // Thin studio haze, only visible where the wall light passes through it.
  col += outside * haze * (edge * near * 0.04 + uFlash.rgb * flashFall * 0.05 + average * 0.01);

  // Lens halo around the bright wall.
  col += wall(sc, 7.0) * exp(-d * 16.0) * 0.04 * outside;

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
