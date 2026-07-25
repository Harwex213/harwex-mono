import { Container, Geometry, GlProgram, Mesh, Shader, UniformGroup } from "pixi.js";
import { type Grid, inBounds, Terrain, TILE_SIZE, tileIndex } from "../sim/grid";

// Tiles away from the nearest shore at which water reaches its darkest shade.
const MAX_DEPTH = 3;

// The swell advances in discrete steps, like a hand-drawn sheet would, and the
// step comes from the sim tick rather than the render clock: pause freezes the
// surface and 2×/3× speeds it up, same rule as sprite frames.
const TICKS_PER_STEP = 2; // 10 ticks/s ÷ 2 = 5 steps/s

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

// Geometry is in world px (aPosition) but the surface is shaded in tile space
// (aTile), so the wave field is independent of camera pan and zoom — the root
// container's transform moves the mesh, never the water.
const VERTEX = /* glsl */ `#version 300 es

in vec2 aPosition;
in vec2 aTile;
in float aShore;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

out vec2 vTile;
out float vShore;

void main(void) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vTile = aTile;
  vShore = aShore;
}
`;

// Drawn over the baked depth tiles, not instead of them: the sheet keeps owning
// the base colour, the shader only adds movement on top of it.
const FRAGMENT = /* glsl */ `#version 300 es

in vec2 vTile;
in float vShore;

out vec4 finalColor;

uniform float uStep;

// One art pixel of a 16px tile. Everything is snapped to this grid, so at ×8
// zoom the waves stay blocky pixel art instead of turning into smooth gradients.
const float PIXELS_PER_TILE = 16.0;
// Wave heights collapse to this many flat bands: hard edges, no soft ramps.
const float BANDS = 4.0;
const float STEP_RATE = 0.22; // radians of wave phase per animation step
const float DRIFT = 0.35; // tiles the sample point wanders under the slow current

const vec3 TROUGH = vec3(0.05, 0.20, 0.38);
const vec3 CREST = vec3(0.62, 0.90, 0.96);
const vec3 FOAM = vec3(0.93, 0.99, 1.00);

const float TROUGH_ALPHA = 0.22;
const float CREST_ALPHA = 0.17;
const float FOAM_ALPHA = 0.70;
const float SPARKLE_ALPHA = 0.55;

const float SPARKLE_ODDS = 0.985; // per art pixel, per animation step
const float SPARKLE_BAND = 0.60; // sparkles only near the top of the swell
// Coprime-ish offsets so a step forward reshuffles the glints instead of sliding
// them along a diagonal.
const vec2 SPARKLE_STRIDE = vec2(13.0, 29.0);
const float SHORE_FOAM_MIN = 0.75; // foam only on tiles this close to land

float hash(vec2 v) {
  return fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453);
}

void main(void) {
  vec2 pixel = floor(vTile * PIXELS_PER_TILE);
  vec2 p = pixel / PIXELS_PER_TILE;
  float t = uStep * STEP_RATE;

  // A slow drift bent into the sample point first. Without it the ripples below
  // come out as perfectly straight corduroy; warped, they wander like a current.
  vec2 q = p + vec2(sin(p.y * 0.9 + t * 0.3), cos(p.x * 1.1 - t * 0.25)) * DRIFT;

  // Three ripples at different angles and speeds. Their periods do not divide
  // each other, so the surface never visibly loops.
  float swell = sin((q.x + q.y) * 3.4 + t)
    + sin((q.x * 1.4 - q.y) * 5.9 - t * 0.7)
    + sin(q.y * 9.7 + t * 1.5) * 0.6;
  float height = clamp(swell / 2.6, -1.0, 1.0) * 0.5 + 0.5;
  float band = min(floor(height * BANDS), BANDS - 1.0) / (BANDS - 1.0);

  vec3 color = mix(TROUGH, CREST, band);
  float alpha = mix(TROUGH_ALPHA, CREST_ALPHA, band);

  // Crests breaking on the shallowest ring read as a broken, moving foam line.
  float foam = step(0.99, band) * step(SHORE_FOAM_MIN, vShore);
  color = mix(color, FOAM, foam);
  alpha = mix(alpha, FOAM_ALPHA, foam);

  // Single-pixel glints on the swell tops, reshuffled every animation step.
  float sparkle = step(SPARKLE_ODDS, hash(pixel + uStep * SPARKLE_STRIDE)) * step(SPARKLE_BAND, band);
  color = mix(color, FOAM, sparkle);
  alpha = mix(alpha, SPARKLE_ALPHA, sparkle);

  finalColor = vec4(color * alpha, alpha); // pixi blends premultiplied
}
`;

// The mesh is static geometry with one animated uniform: nothing is rebuilt per
// frame, the renderer only pushes the current tick in.
interface WaterSurface {
  view: Container;

  setTick(tick: number): void;
}

// One quad per water tile rather than a single sheet over the map: shore
// distance rides along as a flat per-quad attribute, so the foam band lands on
// tile edges exactly like the depth shades baked underneath it.
function buildWaterSurface(grid: Grid, depth: Uint8Array): WaterSurface {
  const positions: number[] = [];
  const tiles: number[] = [];
  const shores: number[] = [];
  const indices: number[] = [];

  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const index = tileIndex(grid, x, y);
      if (grid.terrain[index] !== Terrain.Water) {
        continue;
      }
      const base = positions.length / 2;
      const left = x * TILE_SIZE;
      const top = y * TILE_SIZE;
      positions.push(left, top, left + TILE_SIZE, top, left + TILE_SIZE, top + TILE_SIZE, left, top + TILE_SIZE);
      tiles.push(x, y, x + 1, y, x + 1, y + 1, x, y + 1);
      const shore = 1 - (depth[index] - 1) / (MAX_DEPTH - 1);
      shores.push(shore, shore, shore, shore);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  // A map can generate without a single water tile; an empty geometry is not a
  // valid draw, so hand back an inert surface instead.
  if (indices.length === 0) {
    return {
      view: new Container(), setTick: () => {
      }
    };
  }

  const uniforms = new UniformGroup({ uStep: { value: 0, type: "f32" } });
  const view = new Mesh<Geometry, Shader>({
    geometry: new Geometry({
      attributes: {
        aPosition: { buffer: new Float32Array(positions), format: "float32x2" },
        aTile: { buffer: new Float32Array(tiles), format: "float32x2" },
        aShore: { buffer: new Float32Array(shores), format: "float32" },
      },
      indexBuffer: new Uint32Array(indices),
    }),
    shader: new Shader({
      glProgram: GlProgram.from({ name: "water", vertex: VERTEX, fragment: FRAGMENT }),
      resources: { waterUniforms: uniforms },
    }),
  });

  return {
    view,
    setTick: (tick: number): void => {
      uniforms.uniforms.uStep = Math.floor(tick / TICKS_PER_STEP);
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

export type { WaterSurface };
export { MAX_DEPTH, buildWaterSurface, waterDepthMap, touches };
