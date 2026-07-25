import { Container, Geometry, GlProgram, Mesh, Shader, type Texture, UniformGroup } from "pixi.js";
import { type Grid, inBounds, Terrain, tileIndex } from "../sim/grid";

// Tiles away from the nearest shore at which water reaches its darkest shade.
const MAX_DEPTH = 3;

const NEIGHBOURS4 = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
] as const;

const NEIGHBOURS8 = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

// After the bake the waterline no longer follows tile edges, so the surface cannot
// be a mesh of water tiles any more: where the water reaches, and how far a point
// is from the shore, are per-pixel facts, and the mask is how the shader learns
// them. Alpha carries "this pixel is water", red carries distance to the nearest
// dry pixel, normalised over the bake's shore reach (0 = at the waterline).
interface WaterField {
  mask: Texture;
  width: number; // mask size, in art px
  height: number;
  left: number; // bounds of the water pixels, in art px, inclusive
  top: number;
  right: number;
  bottom: number;
}

// Geometry is in world px, and so is the shading: the surface is a function of
// world position and the sim clock only, so it is independent of camera pan and
// zoom — the root container's transform moves the mesh, never the water.
const VERTEX = /* glsl */ `#version 300 es

in vec2 aPosition;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

out vec2 vPixel;

void main(void) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vPixel = aPosition;
}
`;

// Drawn over the baked water, not instead of it: the bake keeps owning the base
// colour and the waterline, the shader only adds movement on top of it. It covers
// the wet part of the map as a single quad and discards the dry pixels inside it,
// so the swell stops exactly where the baked water does — down to the pixel.
const FRAGMENT = /* glsl */ `#version 300 es

in vec2 vPixel;

out vec4 finalColor;

uniform sampler2D uMask;
uniform vec2 uMaskSize;
uniform float uPhase; // the sim clock, in ticks — see setPhase()

// One art pixel of a 16px tile. Every sample is snapped to this grid, so the
// surface stays blocky pixel art at ×8 zoom instead of a smooth gradient: the
// pattern slides continuously, but a pixel only ever flips whole.
const float PIXELS_PER_TILE = 16.0;

// The current. Sampling at (p - FLOW * t) is what makes the pattern travel
// *towards* +y: offset the sample point against the flow and the features move
// with it. Sampling at (p + FLOW * t) runs the river backwards, which is exactly
// how water ends up flowing up the screen.
const vec2 FLOW = vec2(0.18, 1.0); // down, with a lean so streaks are not axis-aligned
const float FLOW_TILES_PER_TICK = 0.04; // ≈ 6 art px/s at 1× — a drift, not a rapid

// Stretched along x, squeezed along y: anisotropy is what makes plain noise read as
// a water surface instead of clouds. Scales are in noise units per tile, so these
// are streaks of roughly 10×3 art px — wider features turn into soft smudges and
// stop reading as pixel art. The far layer is finer and slower, same direction, so
// nothing ever appears to move against the current.
const vec2 STREAK_NEAR = vec2(1.5, 4.6);
const vec2 STREAK_FAR = vec2(3.1, 8.2);
const float FAR_WEIGHT = 0.35;
const float FAR_LAG = 0.5;
const float CONTRAST = 1.5; // two summed octaves cluster around the middle

// Hard cuts at fixed heights rather than an even ladder of bands: the top and
// bottom slices are meant to be *sparse*: highlights that cover a third of the
// surface read as fog over the water, not as light on it.
const float CREST_LEVEL = 0.80;
const float SHEEN_LEVEL = 0.64;
const float TROUGH_LEVEL = 0.34;
const float DEEP_LEVEL = 0.18;

const vec3 TROUGH = vec3(0.05, 0.20, 0.36);
const vec3 SHEEN = vec3(0.70, 0.93, 0.95);
const vec3 CREST = vec3(0.90, 0.99, 1.00);
const vec3 FOAM = vec3(0.96, 1.00, 1.00);
const vec3 SURF_EDGE = vec3(0.66, 0.88, 0.89); // the thin wash at the seaward edge

const float DEEP_ALPHA = 0.18;
const float TROUGH_ALPHA = 0.08;
const float SHEEN_ALPHA = 0.10;
const float CREST_ALPHA = 0.22;
const float FOAM_ALPHA = 0.72;
const float SURF_EDGE_ALPHA = 0.20;
const float SPARKLE_ALPHA = 0.55;

// The mask measures the shore in fractions of its reach, so one art pixel is
// SHORE_PX. Foam is one to four pixels of it, and the swing dips below zero on
// purpose: without gaps the foam is a cartoon outline traced around every pool.
const float SHORE_PX = 0.1;
const float FOAM_REACH = 1.4 * SHORE_PX;
const float FOAM_SWING = 2.8 * SHORE_PX;
const vec2 FOAM_SCALE = vec2(2.6, 2.6); // ≈ 6 px of shoreline per gap
const float FOAM_LAG = 0.6; // the gaps travel with the current, slower than the swell
// Tones across the surf. One flat strip of foam reads as a drawn outline; a ramp
// reads as water thinning out. The steps are dithered against a *static* per-pixel
// hash — quantise a ramp without dither and the steps come back as three concentric
// outlines, animate the dither and the whole shoreline boils.
const float SURF_STEPS = 4.0;
const float SURF_GRAIN = 7.77;

// Glints blink in place instead of sliding, so they get a discrete rate of their
// own: continuous motion would just smear them along the flow.
const float TICKS_PER_BLINK = 2.0;
const float SPARKLE_ODDS = 0.97; // per art pixel, per blink — only crests qualify
const vec2 SPARKLE_STRIDE = vec2(13.0, 29.0); // coprime-ish: a blink reshuffles, not shifts

float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  f *= f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(cell), hash21(cell + vec2(1.0, 0.0)), f.x),
    mix(hash21(cell + vec2(0.0, 1.0)), hash21(cell + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

void main(void) {
  vec2 pixel = floor(vPixel);
  vec4 field = texture(uMask, (pixel + 0.5) / uMaskSize);
  if (field.a < 0.5) {
    discard;
  }
  float shoreDistance = field.r;

  vec2 p = pixel / PIXELS_PER_TILE;
  vec2 drift = FLOW * (uPhase * FLOW_TILES_PER_TICK);

  float swell = valueNoise((p - drift) * STREAK_NEAR) * (1.0 - FAR_WEIGHT)
    + valueNoise((p - drift * FAR_LAG) * STREAK_FAR) * FAR_WEIGHT;
  swell = clamp((swell - 0.5) * CONTRAST + 0.5, 0.0, 1.0);

  // One flat tone per slice over the baked colour; the middle is the water's own
  // colour, untouched.
  vec3 color = vec3(0.0);
  float alpha = 0.0;
  if (swell > CREST_LEVEL) {
    color = CREST;
    alpha = CREST_ALPHA;
  } else if (swell > SHEEN_LEVEL) {
    color = SHEEN;
    alpha = SHEEN_ALPHA;
  } else if (swell < DEEP_LEVEL) {
    color = TROUGH;
    alpha = DEEP_ALPHA;
  } else if (swell < TROUGH_LEVEL) {
    color = TROUGH;
    alpha = TROUGH_ALPHA;
  }

  // The waterline breaks into foam wherever the swell's own field lets it reach.
  float reach = FOAM_REACH + (valueNoise((p - drift * FOAM_LAG) * FOAM_SCALE) - 0.5) * 2.0 * FOAM_SWING;
  if (shoreDistance < reach) {
    float surf = clamp(1.0 - shoreDistance / max(reach, SHORE_PX), 0.0, 1.0);
    float stepped = min(floor(surf * SURF_STEPS + hash21(pixel + SURF_GRAIN)), SURF_STEPS - 1.0)
      / (SURF_STEPS - 1.0);
    color = mix(SURF_EDGE, FOAM, stepped);
    alpha = mix(SURF_EDGE_ALPHA, FOAM_ALPHA, stepped);
  }

  // Single-pixel glints on the swell tops, reshuffled every blink.
  float blink = floor(uPhase / TICKS_PER_BLINK);
  float sparkle = step(SPARKLE_ODDS, hash21(pixel + blink * SPARKLE_STRIDE)) * step(CREST_LEVEL, swell);
  color = mix(color, CREST, sparkle);
  alpha = mix(alpha, SPARKLE_ALPHA, sparkle);

  finalColor = vec4(color * alpha, alpha); // pixi blends premultiplied
}
`;

// The mesh is static geometry with one animated uniform: nothing is rebuilt per
// frame, the renderer only pushes the clock in.
interface WaterSurface {
  view: Container;

  setPhase(ticks: number): void;
}

// A map can generate without a single water tile, and an empty geometry is not a
// valid draw, so that case hands back an inert surface instead.
function buildWaterSurface(field: WaterField | null): WaterSurface {
  if (!field) {
    return {
      view: new Container(),
      setPhase: (): void => {
      },
    };
  }

  const left = field.left;
  const top = field.top;
  const right = field.right + 1; // bounds are inclusive, the quad's edge is not
  const bottom = field.bottom + 1;

  const uniforms = new UniformGroup({
    uPhase: { value: 0, type: "f32" },
    uMaskSize: { value: new Float32Array([field.width, field.height]), type: "vec2<f32>" },
  });
  const view = new Mesh<Geometry, Shader>({
    geometry: new Geometry({
      attributes: {
        aPosition: {
          buffer: new Float32Array([left, top, right, top, right, bottom, left, bottom]),
          format: "float32x2",
        },
      },
      indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
    }),
    shader: new Shader({
      glProgram: GlProgram.from({ name: "water", vertex: VERTEX, fragment: FRAGMENT }),
      resources: { waterUniforms: uniforms, uMask: field.mask.source },
    }),
  });

  return {
    view,
    // The phase is the sim clock in ticks, fraction included: `tick + alpha`, the
    // same interpolation factor the sprites lerp with. Whole ticks alone would
    // step the surface at 10 fps while the rest of the frame runs at 60 — and the
    // reason the phase is not simply wall clock is that this way pause freezes the
    // water and 2×/3× speeds it up, for free and without breaking determinism.
    setPhase: (ticks: number): void => {
      uniforms.uniforms.uPhase = ticks;
    },
  };
}

// Distance in tiles from each water tile to the nearest land, capped at
// MAX_DEPTH: shallows get the pale shade, open water the dark one. Land stays 0.
function waterDepthMap(grid: Grid): Uint8Array {
  const depth = new Uint8Array(grid.width * grid.height);
  const queue: number[] = [];
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const index = tileIndex(grid, x, y);
      if (grid.terrain[index] !== Terrain.Water || !touchesLand(grid, x, y)) {
        continue;
      }
      depth[index] = 1;
      queue.push(index);
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head];
    if (depth[index] >= MAX_DEPTH) {
      continue;
    }
    const x = index % grid.width;
    const y = (index - x) / grid.width;
    for (const [dx, dy] of NEIGHBOURS4) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(grid, nx, ny)) {
        continue;
      }
      const next = tileIndex(grid, nx, ny);
      if (grid.terrain[next] !== Terrain.Water || depth[next] !== 0) {
        continue;
      }
      depth[next] = depth[index] + 1;
      queue.push(next);
    }
  }
  // Water the ramp never reached is beyond MAX_DEPTH from any shore: open water.
  for (let index = 0; index < depth.length; index += 1) {
    if (grid.terrain[index] === Terrain.Water && depth[index] === 0) {
      depth[index] = MAX_DEPTH;
    }
  }
  return depth;
}

function touchesLand(grid: Grid, x: number, y: number): boolean {
  return touches(grid, x, y, Terrain.Grass) || touches(grid, x, y, Terrain.Rock);
}

function touches(grid: Grid, x: number, y: number, terrain: Terrain): boolean {
  for (const [dx, dy] of NEIGHBOURS8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(grid, nx, ny)) {
      continue;
    }
    if (grid.terrain[tileIndex(grid, nx, ny)] === terrain) {
      return true;
    }
  }
  return false;
}

export type { WaterField, WaterSurface };
export { MAX_DEPTH, buildWaterSurface, waterDepthMap, touches };
