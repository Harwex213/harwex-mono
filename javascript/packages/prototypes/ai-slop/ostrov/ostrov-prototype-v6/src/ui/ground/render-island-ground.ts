import badlandsTexture from "../../assets/biomes/badlands.webp";
import cliffsTexture from "../../assets/biomes/cliffs.webp";
import craterTexture from "../../assets/biomes/crater.webp";
import desertTexture from "../../assets/biomes/desert.webp";
import forrestTexture from "../../assets/biomes/forrest.webp";
import grasslandTexture from "../../assets/biomes/grassland.webp";
import hillsTexture from "../../assets/biomes/hills.webp";
import mountainsTexture from "../../assets/biomes/mountains.webp";
import plainsTexture from "../../assets/biomes/plains.webp";
import polarDesertTexture from "../../assets/biomes/polar_desert.webp";
import rainforestTexture from "../../assets/biomes/rainforest.webp";
import savannaTexture from "../../assets/biomes/savanna.webp";
import swampTexture from "../../assets/biomes/swamp.webp";
import taigaTexture from "../../assets/biomes/taiga.webp";
import tundraTexture from "../../assets/biomes/tundra.webp";
import volcanoTexture from "../../assets/biomes/volcano.webp";
import { BIOMES } from "../../core/biomes";
import { HEX_SIZE, hexToPixel } from "../../core/hex";
import type { TBiomeId } from "../../core/types";

/**
 * The island ground as one painted terrain image.
 *
 * Every pixel picks its biome from the hex centres around it, but the sample
 * position is first warped by seeded fbm noise. So the biome borders wander
 * off the hex edges and read as organic shapes. The two or three nearest
 * biomes then blend by a soft-max score. The score adds the local height of
 * each texture (its luminance) and a small noise, so one biome shows through
 * the other in clumps instead of a smooth gradient. The warp is well below
 * the hex inradius, so the centre of each hex always shows its own biome.
 * The textures are inked map glyphs, and ink counts as high ground: tree
 * crowns and peaks of one biome spill over the border into its neighbour.
 *
 * The look follows the parchment globe: a slow ink wash and paper grain over
 * the land, a burnt brown edge along the coast, an ink outline and short
 * hatching strokes on the water side.
 *
 * The coastline uses the same warp. It may bite at most about 0.2 hex sizes
 * into a rim hex, so the hit area of a hex is still almost all land.
 *
 * All of this runs in one WebGL2 fragment pass, then the result is copied to
 * a plain 2D canvas. The WebGL context is shared by every call.
 *
 * Coordinates are the island canvas world space: `hexToPixel(q, r, HEX_SIZE)`.
 */

type TGroundHex = {
  readonly q: number;
  readonly r: number;
  readonly biome: TBiomeId;
};

type TIslandGroundOptions = {
  /** Varies the noise between islands. The same seed gives the same image. */
  readonly seed?: number;
  /** Image pixels per world unit. The island canvas zooms up to 2.6. */
  readonly density?: number;
  /** Ink of the coastline outline and hatching, or null for none. */
  readonly rimColor?: string | null;
};

type TIslandGround = {
  /** A 2D canvas that the caller owns. Set its width to 0 to free it. */
  readonly canvas: HTMLCanvasElement;
  /** World rectangle that the canvas covers. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** GPU pass plus the copy to 2D, in milliseconds. */
  readonly renderMs: number;
};

/** One texture tile covers this many world units for every biome. */
const GROUND_TILE_SIZE = HEX_SIZE * 6;
const TEXTURE_SIZE = 1024;
const ATLAS_COLUMNS = 4;
const ATLAS_SIZE = TEXTURE_SIZE * ATLAS_COLUMNS;
/** The axial lookup grid: q and r from -GRID_OFFSET to GRID_OFFSET - 1. */
const GRID_SIZE = 64;
const GRID_OFFSET = GRID_SIZE / 2;
const DEFAULT_DENSITY = 2.6;
const MAX_IMAGE_SIDE = 4096;
/** The coast grows out by the warp plus the rim stroke. */
const MARGIN = HEX_SIZE * 0.8;
/** Width of the ink coastline in world units. */
const RIM_WIDTH = 2.2;
/** The ink of the antique map, as on the globe. */
const DEFAULT_INK = "#2b2015";
const MAX_BIOMES = 16;

const BIOME_TEXTURES: Readonly<Record<TBiomeId, string>> = {
  grassland: grasslandTexture,
  plains: plainsTexture,
  forrest: forrestTexture,
  savanna: savannaTexture,
  rainforest: rainforestTexture,
  taiga: taigaTexture,
  tundra: tundraTexture,
  desert: desertTexture,
  polar_desert: polarDesertTexture,
  swamp: swampTexture,
  badlands: badlandsTexture,
  crater: craterTexture,
  volcano: volcanoTexture,
  hills: hillsTexture,
  mountains: mountainsTexture,
  cliffs: cliffsTexture,
};

const BIOME_INDEX = new Map(BIOMES.map((biome, index) => [biome.id, index]));

const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

in vec2 vUv;
out vec4 outColor;

uniform vec2 uOrigin;
uniform vec2 uSize;
uniform float uHexSize;
uniform float uTile;
uniform float uSeed;
uniform float uMeanLum[${MAX_BIOMES}];
uniform vec4 uRim;
uniform float uRimWidth;
uniform float uPixel;
uniform sampler2D uAtlas;
uniform highp usampler2D uGrid;

const int GRID_SIZE = ${GRID_SIZE};
const int GRID_OFFSET = ${GRID_OFFSET};
const float ATLAS_COLUMNS = ${ATLAS_COLUMNS}.0;
const float HALF_TEXEL = 0.5 / ${TEXTURE_SIZE}.0;
const float SQRT3 = 1.7320508;
/** Warp amplitude and scale, in hex sizes. */
const float WARP_AMP = 0.8;
const float WARP_SCALE = 1.1;
/** Soft-max sharpness of the biome score. Higher is a narrower blend. */
const float SHARPNESS = 16.0;
const float HEIGHT_WEIGHT = 0.2;
const float CLUMP_WEIGHT = 0.16;
const float COAST_GROW = 0.1;
const float COAST_NIBBLE = 0.12;
/** Coast hatching: stroke spacing in world units and reach in hex sizes. */
const float HATCH_PERIOD = 2.6;
const float HATCH_REACH = 0.22;

const ivec2 NEIGHBOURS[7] = ivec2[7](
  ivec2(0, 0), ivec2(1, 0), ivec2(1, -1), ivec2(0, -1),
  ivec2(-1, 0), ivec2(-1, 1), ivec2(0, 1)
);

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031 + uSeed * 0.0137);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amp * valueNoise(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    amp *= 0.5;
  }
  return sum / 0.9375;
}

ivec2 axialRound(vec2 axial) {
  vec3 cube = vec3(axial.x, -axial.x - axial.y, axial.y);
  vec3 rounded = floor(cube + 0.5);
  vec3 diff = abs(rounded - cube);
  if (diff.x > diff.y && diff.x > diff.z) {
    rounded.x = -rounded.y - rounded.z;
  } else if (diff.y > diff.z) {
    rounded.y = -rounded.x - rounded.z;
  } else {
    rounded.z = -rounded.x - rounded.y;
  }
  return ivec2(rounded.xz);
}

vec2 toAxial(vec2 p) {
  return vec2((SQRT3 / 3.0 * p.x - p.y / 3.0) / uHexSize, (2.0 / 3.0 * p.y) / uHexSize);
}

vec2 hexCenter(ivec2 qr) {
  return uHexSize * vec2(SQRT3 * (float(qr.x) + float(qr.y) * 0.5), 1.5 * float(qr.y));
}

/** Biome index + 1 of a hex, 0 when the island has no hex there. */
int biomeAt(ivec2 qr) {
  ivec2 cell = qr + GRID_OFFSET;
  if (cell.x < 0 || cell.y < 0 || cell.x >= GRID_SIZE || cell.y >= GRID_SIZE) {
    return 0;
  }
  return int(texelFetch(uGrid, cell, 0).r);
}

/** Signed distance to a pointy-top hex edge, in hex sizes. Negative inside. */
float hexSdf(vec2 p) {
  p = abs(p);
  return (max(p.x, dot(p, vec2(0.5, 0.8660254))) - uHexSize * 0.8660254) / uHexSize;
}

vec3 sampleBiome(int index, vec2 p) {
  vec2 uv = clamp(fract(p / uTile), HALF_TEXEL, 1.0 - HALF_TEXEL);
  vec2 cell = vec2(float(index % 4), float(index / 4));
  return texture(uAtlas, (cell + uv) / ATLAS_COLUMNS).rgb;
}

/** Signed distance to the island edge around a point, in hex sizes. */
float landDistance(vec2 p) {
  ivec2 base = axialRound(toAxial(p));
  float best = 1e3;
  for (int i = 0; i < 7; i++) {
    ivec2 qr = base + NEIGHBOURS[i];
    if (biomeAt(qr) > 0) {
      best = min(best, hexSdf(p - hexCenter(qr)));
    }
  }
  return best;
}

vec4 blendAround(vec2 pw, vec2 p) {
  ivec2 base = axialRound(toAxial(pw));
  vec3 color = vec3(0.0);
  float total = 0.0;
  float top = -1e3;
  float scores[7];
  vec3 colors[7];
  for (int i = 0; i < 7; i++) {
    ivec2 qr = base + NEIGHBOURS[i];
    int biome = biomeAt(qr);
    scores[i] = -1e3;
    if (biome == 0) {
      continue;
    }
    int index = biome - 1;
    vec3 tex = sampleBiome(index, p);
    // Ink is high ground: dark glyphs (tree crowns, peaks) push over the border.
    float height = (uMeanLum[index] - dot(tex, vec3(0.299, 0.587, 0.114))) / 0.08;
    float clump = valueNoise(p / 7.0 + vec2(qr) * 13.7) - 0.5;
    float score = -hexSdf(pw - hexCenter(qr)) + HEIGHT_WEIGHT * clamp(height, -2.0, 2.0) + CLUMP_WEIGHT * clump;
    scores[i] = score;
    colors[i] = tex;
    top = max(top, score);
  }
  for (int i = 0; i < 7; i++) {
    if (scores[i] > -1e2) {
      float weight = exp((scores[i] - top) * SHARPNESS);
      color += colors[i] * weight;
      total += weight;
    }
  }
  return vec4(color, total);
}

void main() {
  vec2 p = uOrigin + vec2(vUv.x, 1.0 - vUv.y) * uSize;
  // Two-level domain warp: a coarse fbm bends the input of the fine one.
  vec2 warpUv = p / (uHexSize * WARP_SCALE);
  vec2 coarse = vec2(fbm(warpUv * 0.6 + vec2(5.2, 1.3)), fbm(warpUv * 0.6 + vec2(-8.1, 4.7))) - 0.5;
  vec2 warpIn = warpUv + coarse * 1.6;
  vec2 warp = vec2(fbm(warpIn), fbm(warpIn + vec2(31.4, -12.7))) - 0.5;
  // The warp fades out near a hex centre, so the centre keeps its own biome.
  // At the hex edge it is at full strength on both sides, so it is continuous.
  ivec2 home = axialRound(toAxial(p));
  float fromCentre = length(p - hexCenter(home)) / uHexSize;
  float warpStrength = mix(0.2, 1.0, smoothstep(0.15, 0.6, fromCentre));
  vec2 pw = p + warp * 2.0 * WARP_AMP * warpStrength * uHexSize;

  // The coast follows the warped island, grown a little. It may nibble at
  // most COAST_NIBBLE into a hex, so the hex hit area stays almost all land.
  float nibble = COAST_NIBBLE * (0.4 + 1.2 * fbm(p / (uHexSize * 0.3) + vec2(3.7, 8.9)));
  float land = min(landDistance(pw) - COAST_GROW, landDistance(p) + nibble);
  float pixel = uPixel / uHexSize;
  float landAlpha = 1.0 - smoothstep(-pixel, pixel, land);
  if (land > HATCH_REACH + 0.08) {
    outColor = vec4(0.0);
    return;
  }

  vec4 ground = blendAround(pw, p);
  if (ground.a <= 0.0) {
    ground = blendAround(p, p);
  }
  vec3 color = ground.a > 0.0 ? ground.rgb / ground.a : uRim.rgb;

  // Paper: a slow ink wash and a fine grain over the whole island.
  color *= 0.9 + 0.2 * fbm(p / (uHexSize * 1.7) + vec2(11.0, 3.0));
  color *= 0.97 + 0.06 * hash(gl_FragCoord.xy);
  // Burnt edge: the land browns towards the coast, like the globe islands.
  float burn = smoothstep(-0.24, 0.0, land) * (0.75 + 0.5 * valueNoise(p / 5.0));
  color = mix(color, color * vec3(0.66, 0.53, 0.38), clamp(burn, 0.0, 1.0) * 0.75);

  vec4 result = vec4(color * landAlpha, landAlpha);

  // Hatching on the water side of the coast: short diagonal ink strokes that
  // thin out with distance, as cartographers shade a shoreline.
  float units = uHexSize;
  float stripe = abs(fract(dot(p, vec2(0.7071, 0.7071)) / HATCH_PERIOD) - 0.5) * HATCH_PERIOD;
  float stroke = 1.0 - smoothstep(0.35, 0.35 + uPixel, stripe);
  float broken = smoothstep(0.3, 0.45, valueNoise(p / 3.0 + vec2(7.0, 1.0)));
  float reach = HATCH_REACH * (0.6 + 0.6 * valueNoise(p / 9.0));
  float hatchFade = step(0.0, land) * (1.0 - smoothstep(0.0, reach, land));
  float hatchAlpha = stroke * broken * hatchFade * uRim.a * 0.55 * (1.0 - landAlpha);
  result = result * (1.0 - hatchAlpha) + vec4(uRim.rgb * hatchAlpha, hatchAlpha);

  // The ink outline itself, centred on the coast.
  float halfLine = uRimWidth * 0.5 / units;
  float lineAlpha = uRim.a * (1.0 - smoothstep(halfLine - pixel, halfLine + pixel, abs(land)));
  result = result * (1.0 - lineAlpha) + vec4(uRim.rgb * lineAlpha, lineAlpha);

  outColor = result;
}
`;

type TRenderer = {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly program: WebGLProgram;
  readonly gridTexture: WebGLTexture;
  readonly meanLum: Float32Array;
};

let rendererPromise: Promise<TRenderer | null> | null = null;

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Ground texture failed to load: ${src}`));
    image.src = src;
  });

const compile = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Ground shader could not be created");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Ground shader: ${gl.getShaderInfoLog(shader) ?? "compile failed"}`);
  }

  return shader;
};

/** Builds the 4x4 texture atlas and the mean luminance of every biome. */
const buildAtlas = async () => {
  const atlas = document.createElement("canvas");
  atlas.width = ATLAS_SIZE;
  atlas.height = ATLAS_SIZE;
  const context = atlas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Ground atlas has no 2D context");
  }

  const images = await Promise.all(BIOMES.map((biome) => loadImage(BIOME_TEXTURES[biome.id])));
  const meanLum = new Float32Array(MAX_BIOMES);

  images.forEach((image, index) => {
    const x = (index % ATLAS_COLUMNS) * TEXTURE_SIZE;
    const y = Math.floor(index / ATLAS_COLUMNS) * TEXTURE_SIZE;
    context.drawImage(image, x, y, TEXTURE_SIZE, TEXTURE_SIZE);
    const data = context.getImageData(x, y, TEXTURE_SIZE, TEXTURE_SIZE).data;
    let sum = 0;

    for (let offset = 0; offset < data.length; offset += 4) {
      sum += 0.299 * (data[offset] ?? 0) + 0.587 * (data[offset + 1] ?? 0) + 0.114 * (data[offset + 2] ?? 0);
    }

    meanLum[index] = sum / (data.length / 4) / 255;
  });

  return { atlas, meanLum };
};

const createRenderer = async (): Promise<TRenderer | null> => {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
  if (!gl) {
    return null;
  }

  const { atlas, meanLum } = await buildAtlas();
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Ground program: ${gl.getProgramInfoLog(program) ?? "link failed"}`);
  }

  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const atlasTexture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  atlas.width = 0;

  const gridTexture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, gridTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  gl.uniform1i(gl.getUniformLocation(program, "uAtlas"), 0);
  gl.uniform1i(gl.getUniformLocation(program, "uGrid"), 1);
  gl.uniform1fv(gl.getUniformLocation(program, "uMeanLum"), meanLum);

  return { canvas, gl, program, gridTexture, meanLum };
};

const getRenderer = () => {
  if (!rendererPromise) {
    rendererPromise = createRenderer().catch((error: unknown) => {
      console.error(error);

      return null;
    });
  }

  return rendererPromise;
};

const parseColor = (color: string | null) => {
  if (!color) {
    return [0, 0, 0, 0] as const;
  }

  const hex = color.replace("#", "");

  return [
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
    hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 0.9,
  ] as const;
};

/**
 * Paints the ground of one island. Resolves to null when the browser has no
 * WebGL2, so the caller can fall back to flat hex colours.
 */
const renderIslandGround = async (
  hexes: readonly TGroundHex[],
  options: TIslandGroundOptions = {},
): Promise<TIslandGround | null> => {
  if (hexes.length === 0 || typeof document === "undefined") {
    return null;
  }

  const renderer = await getRenderer();
  if (!renderer) {
    return null;
  }

  const start = performance.now();
  const { canvas, gl, program, gridTexture } = renderer;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grid = new Uint8Array(GRID_SIZE * GRID_SIZE);

  for (const hex of hexes) {
    const center = hexToPixel(hex.q, hex.r, HEX_SIZE);
    minX = Math.min(minX, center.x);
    minY = Math.min(minY, center.y);
    maxX = Math.max(maxX, center.x);
    maxY = Math.max(maxY, center.y);
    const column = hex.q + GRID_OFFSET;
    const row = hex.r + GRID_OFFSET;

    if (column >= 0 && row >= 0 && column < GRID_SIZE && row < GRID_SIZE) {
      grid[row * GRID_SIZE + column] = (BIOME_INDEX.get(hex.biome) ?? 0) + 1;
    }
  }

  const x = minX - HEX_SIZE - MARGIN;
  const y = minY - HEX_SIZE - MARGIN;
  const width = maxX - minX + (HEX_SIZE + MARGIN) * 2;
  const height = maxY - minY + (HEX_SIZE + MARGIN) * 2;
  const density = Math.min(options.density ?? DEFAULT_DENSITY, MAX_IMAGE_SIDE / Math.max(width, height));
  const pixelWidth = Math.round(width * density);
  const pixelHeight = Math.round(height * density);

  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  gl.viewport(0, 0, pixelWidth, pixelHeight);
  gl.useProgram(program);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, gridTexture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, GRID_SIZE, GRID_SIZE, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, grid);

  const rim = parseColor(options.rimColor === undefined ? DEFAULT_INK : options.rimColor);
  gl.uniform2f(gl.getUniformLocation(program, "uOrigin"), x, y);
  gl.uniform2f(gl.getUniformLocation(program, "uSize"), width, height);
  gl.uniform1f(gl.getUniformLocation(program, "uHexSize"), HEX_SIZE);
  gl.uniform1f(gl.getUniformLocation(program, "uTile"), GROUND_TILE_SIZE);
  gl.uniform1f(gl.getUniformLocation(program, "uSeed"), (options.seed ?? 0) % 997);
  gl.uniform4f(gl.getUniformLocation(program, "uRim"), rim[0], rim[1], rim[2], rim[3]);
  gl.uniform1f(gl.getUniformLocation(program, "uRimWidth"), RIM_WIDTH);
  gl.uniform1f(gl.getUniformLocation(program, "uPixel"), 1 / density);

  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  const output = document.createElement("canvas");
  output.width = pixelWidth;
  output.height = pixelHeight;
  output.getContext("2d")?.drawImage(canvas, 0, 0);
  // The shared WebGL canvas keeps no copy of this island.
  canvas.width = 1;
  canvas.height = 1;

  return { canvas: output, x, y, width, height, renderMs: performance.now() - start };
};

/** A stable seed from any string, e.g. an island owner id. */
const groundSeed = (text: string) => {
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) % 997;
};

export { BIOME_TEXTURES, GROUND_TILE_SIZE, groundSeed, renderIslandGround };
export type { TGroundHex, TIslandGround, TIslandGroundOptions };
