import { ATLAS_COLUMNS, ATLAS_ROWS } from "./globe-atlas";

/**
 * GLSL of the globe, drawn as an antique fantasy map. The sea is dark slate
 * with inked wave strokes. Each revealed cell shows its hand-drawn tile from
 * the atlas: an island, a settlement or a cloud. Unexplored cells are hatched
 * mist. Grid lines, hover, selection, reachable cells, owners and the toxic
 * stain come from the per-cell state texture. Aged paper and a burnt vignette
 * lie over everything. No lighting: it is a drawing, not a planet.
 */

/** How many player colours the shader holds. */
const MAX_OWNERS = 8;

const GLOBE_VERTEX = /* glsl */ `
attribute float aCell;
attribute float aEdge;
attribute vec2 aLocal;
attribute float aTile;

flat varying float vCell;
flat varying float vTile;
varying float vEdge;
varying vec2 vLocal;
varying vec3 vPos;

void main() {
  vCell = aCell;
  vTile = aTile;
  vEdge = aEdge;
  vLocal = aLocal;
  vPos = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GLOBE_FRAGMENT = /* glsl */ `
#define PI 3.14159265359
#define MAX_OWNERS ${MAX_OWNERS}
#define ATLAS_COLUMNS ${ATLAS_COLUMNS}.0
#define ATLAS_ROWS ${ATLAS_ROWS}.0

uniform sampler2D uAtlas;
uniform sampler2D uPaper;
uniform sampler2D uState;
uniform vec3 uCameraPos;
uniform float uTime;
uniform float uHover;
uniform float uSelected;
uniform float uGridAlpha;
uniform vec3 uOwnerColors[MAX_OWNERS];

flat varying float vCell;
flat varying float vTile;
varying float vEdge;
varying vec2 vLocal;
varying vec3 vPos;

vec3 fromSrgb(vec3 c) {
  return pow(c, vec3(2.2));
}

float lumaOf(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  return mix(
    mix(
      mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), f.x),
      mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x),
      f.y
    ),
    mix(
      mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x),
      mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x),
      f.y
    ),
    f.z
  );
}

/** A thin ink line along the zero of a field, about a pixel wide. */
float inkLine(float field, float width) {
  float fw = fwidth(field);
  return 1.0 - smoothstep(width - fw, width + fw, abs(field));
}

/**
 * Short wavy strokes over the sea, as an engraver draws water. They run in
 * the cell's own plane, so each hex is drawn like a separate map tile.
 */
float seaWaves(vec2 local, vec3 p) {
  float rows = local.y * 9.0 + valueNoise(p * 12.0) * 1.2;
  float stroke = fract(rows + sin(local.x * 22.0) * 0.12) - 0.5;
  float dash = smoothstep(0.5, 0.6, valueNoise(vec3(local * 7.0, floor(rows))));
  return inkLine(stroke, 0.06) * dash;
}

/** Diagonal ink hatching in the cell's own plane, for unexplored mist. */
float hatching(vec2 local, float density) {
  float lines = fract((local.x + local.y) * density) - 0.5;
  return inkLine(lines, 0.14);
}

vec4 tileColor(vec2 local, float tile) {
  vec2 uv = local * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    return vec4(0.0);
  }

  float column = mod(tile, ATLAS_COLUMNS);
  float row = floor(tile / ATLAS_COLUMNS);
  vec2 atlasUv = vec2((column + uv.x) / ATLAS_COLUMNS, 1.0 - (row + 1.0 - uv.y) / ATLAS_ROWS);
  return texture2D(uAtlas, atlasUv);
}

/** A band just inside the cell border. */
float edgeBand(float width) {
  float fw = fwidth(vEdge);
  return smoothstep(1.0 - width - fw, 1.0 - width + fw, vEdge);
}

void main() {
  vec3 p = normalize(vPos);
  vec3 viewDir = normalize(uCameraPos - p);
  int cell = int(vCell + 0.5);

  vec4 state = texelFetch(uState, ivec2(cell, 0), 0);
  float visibility = state.r;
  float toxic = state.g;
  int owner = int(state.b * 255.0 + 0.5) - 1;
  int flags = int(state.a * 255.0 + 0.5);
  bool reachable = (flags & 1) != 0;
  bool isHome = (flags & 2) != 0;

  vec3 ink = fromSrgb(vec3(0.16, 0.12, 0.08));
  vec3 cream = fromSrgb(vec3(0.91, 0.85, 0.71));
  vec3 sea = fromSrgb(vec3(0.17, 0.21, 0.23)) * (0.9 + 0.2 * valueNoise(p * 6.0));
  sea = mix(sea, fromSrgb(vec3(0.55, 0.58, 0.55)), seaWaves(vLocal, p) * 0.5);

  vec3 color = sea;

  if (visibility > 0.75) {
    // Revealed: the hand-drawn tile over the sea. Clouds breathe a little.
    vec2 local = vLocal;
    if (vTile > 3.5) {
      local *= 1.08 + 0.04 * sin(uTime * 0.4 + vCell);
    } else {
      local *= 0.8;
    }

    vec4 tile = tileColor(local, vTile);
    color = mix(color, tile.rgb, tile.a);

    // The toxic trail: an inked green stain that soaks the cell.
    if (toxic > 0.001) {
      float blot = valueNoise(p * 28.0) * 0.6 + valueNoise(p * 70.0) * 0.4 + toxic * 0.55 - vEdge * 0.35;
      float stain = smoothstep(0.55, 0.6, blot);
      float rim = smoothstep(0.5, 0.55, blot) - stain;
      color = mix(color, color * fromSrgb(vec3(0.55, 0.78, 0.3)), stain * 0.85);
      color = mix(color, fromSrgb(vec3(0.16, 0.3, 0.08)), rim * 0.8);
    }
  } else {
    // Unexplored: mist drawn in hatching. The frontier is lighter.
    bool frontier = visibility > 0.25;
    vec3 mist = frontier ? fromSrgb(vec3(0.42, 0.42, 0.39)) : fromSrgb(vec3(0.16, 0.17, 0.18));
    mist *= 0.88 + 0.24 * valueNoise(p * 14.0 + vec3(uTime * 0.03));
    color = mix(sea * 0.6, mist, frontier ? 0.85 : 0.9);
    color = mix(color, frontier ? cream * 0.5 : sea * 0.3, hatching(vLocal, frontier ? 7.0 : 10.0) * (frontier ? 0.35 : 0.5));
  }

  // The grid: a faint sepia line on every border.
  color = mix(color, fromSrgb(vec3(0.72, 0.63, 0.45)), edgeBand(0.025) * uGridAlpha * (0.45 + 0.55 * visibility));

  float pulse = 0.5 + 0.5 * sin(uTime * 3.0);

  if (reachable) {
    float dash = step(0.5, fract(atan(vLocal.y, vLocal.x) / (2.0 * PI) * 18.0 + uTime * 0.25));
    color = mix(color, fromSrgb(vec3(0.95, 0.83, 0.5)), edgeBand(0.06) * dash * (0.6 + 0.3 * pulse));
  }

  if (owner >= 0 && owner < MAX_OWNERS) {
    vec3 ownerColor = uOwnerColors[owner];
    float band = edgeBand(isHome ? 0.1 : 0.08);
    color = mix(color, ink, edgeBand(0.025) * 0.9);
    color = mix(color, ownerColor, band * (1.0 - edgeBand(0.025)) * (isHome ? 0.75 + 0.25 * pulse : 0.85));
  }

  if (abs(vCell - uHover) < 0.5) {
    color = mix(color, cream, 0.12);
    color = mix(color, cream, edgeBand(0.035) * 0.9);
  }

  if (abs(vCell - uSelected) < 0.5) {
    color = mix(color, fromSrgb(vec3(0.62, 0.1, 0.08)), edgeBand(0.11));
    color = mix(color, cream, edgeBand(0.025) * 0.8);
  }

  // Aged paper over the whole drawing, and a burnt edge toward the limb.
  vec2 paperUv = vec2(atan(p.z, p.x) / (2.0 * PI) * 6.0, asin(clamp(p.y, -1.0, 1.0)) / PI * 3.0);
  vec3 paperTone = texture2D(uPaper, paperUv).rgb;
  color *= mix(vec3(1.0), paperTone / max(lumaOf(paperTone), 0.05) * 0.95, 0.35);

  float facing = max(dot(p, viewDir), 0.0);
  float burn = 1.0 - smoothstep(0.05, 0.75, facing);
  color = mix(color, fromSrgb(vec3(0.25, 0.16, 0.08)) * color * 2.0, burn * 0.55);
  color *= 0.45 + 0.55 * smoothstep(0.0, 0.35, facing);

  gl_FragColor = vec4(color, 1.0);

  #include <colorspace_fragment>
}
`;

const STARS_VERTEX = /* glsl */ `
attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;
uniform float uTime;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vTwinkle;

void main() {
  vColor = aColor;
  vTwinkle = 0.75 + 0.25 * sin(uTime * (0.6 + aPhase) + aPhase * 17.0);
  gl_PointSize = aSize * uPixelRatio;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const STARS_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vTwinkle;

void main() {
  vec2 offset = gl_PointCoord - 0.5;
  float falloff = 1.0 - smoothstep(0.0, 0.5, length(offset));

  gl_FragColor = vec4(vColor * vTwinkle * falloff * falloff, 1.0);

  #include <colorspace_fragment>
}
`;

export { GLOBE_FRAGMENT, GLOBE_VERTEX, MAX_OWNERS, STARS_FRAGMENT, STARS_VERTEX };
