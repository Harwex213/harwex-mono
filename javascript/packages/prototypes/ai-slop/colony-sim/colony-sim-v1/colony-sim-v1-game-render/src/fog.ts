import { Container, Geometry, GlProgram, Mesh, Shader, type Texture, UniformGroup } from "pixi.js";
import { createNoise2D, type NoiseFunction2D } from "simplex-noise";
import {
  createRng,
  dist2,
  type Grid,
  inBounds,
  isDeadLands,
  type PlayerId,
  Region,
  TILE_SIZE,
  type World,
} from "@hw/colony-sim-v1-core";
import { bitmapTexture, CHAMFER_ORTHO, chamferDistance } from "./terrain";

// EXPERIMENT (`experiments.fogOfWar`): a shroud over the dead lands that only the
// viewer's own crew opens. It is a view, not a rule — the sim is not told about it,
// nothing here writes to the world, and pathfinding, picking and the HUD go on
// seeing the whole map. So the fog answers "what does this client draw", never
// "what does this colony know", and two clients with the flag set differently still
// run the same game.
//
// Which half is shrouded comes off `grid.region`, the only field that can say it:
// the barren side and the stony rises of the green side are the same terrain (see
// core's CLAUDE.md), so the fog would be blotches all over the map if it read the
// ground instead.

const HALF_TILE = TILE_SIZE / 2;

// How far a colonist opens the shroud, in tiles. Roughly a screen's worth at the
// default zoom: enough that walking a scout into the far side reads as scouting
// rather than as poking a hole a body wide.
const VISION_TILES = 7;
// Eyes the shader is given at once. Only crew already standing in the dead lands
// are sent (see visionSources), so on a normal run this is one or two and the cap
// never binds; marching more than sixteen bodies across the ridge lights the first
// sixteen of them, in world order.
const MAX_VISION = 16;

// How deep into the dead lands the shroud takes to reach full density, in art px.
// The region border is a tile edge and the fog must not be: a hard line along it
// would read as a wall of smoke someone built, not as weather.
const FOG_EDGE_PX = 20;

// The border itself, in the terms terrain.ts bakes its coastlines in: coverage of
// the four surrounding tile centres, thresholded at half, with two octaves of noise
// bending the contour. Coarser and swingier than a shoreline — a fog bank has no
// crisp edge to lose, and the same numbers as the coast would read as a tide line.
const EDGE_SALT = 0x51a3f70b;
const EDGE_COARSE_PX = 11;
const EDGE_FINE_PX = 3;
const EDGE_FINE_WEIGHT = 0.3;
const EDGE_AMPLITUDE = 0.45;
const COVERAGE_THRESHOLD = 0.5;

// What the shader needs to draw the shroud: alpha says the pixel is dead lands, red
// says how far into them it lies, normalised over FOG_EDGE_PX. Per pixel, because
// the boundary is — a tile-resolution signal would hand back the tile edges the
// noise-bent contour just took away.
interface FogField {
  mask: Texture;
  width: number; // mask size, in art px
  height: number;
  left: number; // bounds of the shrouded pixels, in art px, inclusive
  top: number;
  right: number;
  bottom: number;
}

// An eye on the map, in world art px — the same space the mesh is drawn in.
interface VisionSource {
  x: number;
  y: number;
}

// Static geometry, three animated uniforms: the clock, the eyes, and how many of
// them there are. Nothing is rebuilt per frame.
interface FogOfWar {
  view: Container;

  setPhase(ticks: number): void;
  setVision(sources: readonly VisionSource[]): void;
}

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

// Like the water surface, this shades in world px off the sim clock, so the bank
// does not slide when the camera pans and does not run when the game is paused.
// Everything it draws is quantised: flat tones out of a four-colour ramp, a density
// stepped into bands and dithered against a static per-pixel hash. A smooth alpha
// gradient over pixel art reads as a blurred photo laid on top of it, and that is
// true of a reveal circle's edge just as much as of a coastline.
const FRAGMENT = /* glsl */ `#version 300 es

in vec2 vPixel;

out vec4 finalColor;

uniform sampler2D uMask;
uniform vec2 uMaskSize;
uniform float uPhase; // the sim clock, in ticks — see setPhase()
uniform vec3 uVision[${MAX_VISION}]; // xy = eye in world art px, z = its radius
uniform int uVisionCount;

const float PIXELS_PER_TILE = 16.0;

// The bank drifts across the dead lands rather than along them: the ridge runs
// north to south, so a current parallel to it would look like a river of smoke.
const vec2 DRIFT = vec2(1.0, -0.35);
const float DRIFT_TILES_PER_TICK = 0.012; // ≈ 2 art px/s at 1× — weather, not wind

// Near round and large: clouds, not the water's stretched streaks. The far octave
// is coarser and lags behind, which is what gives the bank depth without a second
// direction of travel.
const vec2 CLOUD_NEAR = vec2(0.34, 0.30);
const vec2 CLOUD_FAR = vec2(0.12, 0.10);
const float FAR_WEIGHT = 0.45;
const float FAR_LAG = 0.4;
const float CONTRAST = 1.25;

// Three flat tones. The lightest is sparse on purpose — wisps read as movement,
// while a lit half of the surface reads as the fog being thin everywhere.
const float LIGHT_LEVEL = 0.66;
const float MID_LEVEL = 0.42;
const vec3 FOG_DEEP = vec3(0.10, 0.11, 0.14);
const vec3 FOG_MID = vec3(0.17, 0.18, 0.22);
const vec3 FOG_LIGHT = vec3(0.30, 0.31, 0.36);
const float FOG_DEEP_ALPHA = 0.97;
const float FOG_MID_ALPHA = 0.94;
const float FOG_LIGHT_ALPHA = 0.90;

// Density is quantised into this many bands and dithered between them. Static hash,
// like the shoreline's: animate the dither and the whole shroud boils.
const float DENSITY_STEPS = 5.0;
const float DENSITY_GRAIN = 3.71;

// Fraction of an eye's radius that is fully clear; past it the shroud closes back
// over the same few bands. A hard circle reads as a spotlight.
const float VISION_CORE = 0.55;

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

  // Eyes lift the shroud, the deepest one at this pixel wins: two colonists side by
  // side clear one wide patch instead of stacking into a brighter one.
  float lit = 0.0;
  vec2 at = pixel + 0.5;
  for (int i = 0; i < ${MAX_VISION}; i += 1) {
    if (i >= uVisionCount) {
      break;
    }
    vec3 eye = uVision[i];
    lit = max(lit, 1.0 - smoothstep(eye.z * VISION_CORE, eye.z, distance(at, eye.xy)));
  }

  float density = field.r * (1.0 - lit);
  float stepped = min(floor(density * DENSITY_STEPS + hash21(pixel + DENSITY_GRAIN)), DENSITY_STEPS)
    / DENSITY_STEPS;
  if (stepped <= 0.0) {
    discard;
  }

  vec2 p = pixel / PIXELS_PER_TILE;
  vec2 drift = DRIFT * (uPhase * DRIFT_TILES_PER_TICK);
  float cloud = valueNoise((p - drift) * CLOUD_NEAR) * (1.0 - FAR_WEIGHT)
    + valueNoise((p - drift * FAR_LAG) * CLOUD_FAR) * FAR_WEIGHT;
  cloud = clamp((cloud - 0.5) * CONTRAST + 0.5, 0.0, 1.0);

  vec3 color = FOG_DEEP;
  float alpha = FOG_DEEP_ALPHA;
  if (cloud > LIGHT_LEVEL) {
    color = FOG_LIGHT;
    alpha = FOG_LIGHT_ALPHA;
  } else if (cloud > MID_LEVEL) {
    color = FOG_MID;
    alpha = FOG_MID_ALPHA;
  }

  finalColor = vec4(color * alpha * stepped, alpha * stepped); // pixi blends premultiplied
}
`;

// Null on a map whose generator drew no dead lands (noise-bands is one): an empty
// geometry is not a valid draw, and there is nothing to shroud anyway.
function buildFogOfWar(world: World): FogOfWar | null {
  const field = bakeFogField(world);
  if (!field) {
    return null;
  }

  const left = field.left;
  const top = field.top;
  const right = field.right + 1; // bounds are inclusive, the quad's edge is not
  const bottom = field.bottom + 1;

  const eyes = new Float32Array(MAX_VISION * 3);
  const uniforms = new UniformGroup({
    uPhase: { value: 0, type: "f32" },
    uMaskSize: { value: new Float32Array([field.width, field.height]), type: "vec2<f32>" },
    uVision: { value: eyes, type: "vec3<f32>", size: MAX_VISION },
    uVisionCount: { value: 0, type: "i32" },
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
      glProgram: GlProgram.from({ name: "fog", vertex: VERTEX, fragment: FRAGMENT }),
      resources: { fogUniforms: uniforms, uMask: field.mask.source },
    }),
  });

  return {
    view,
    // `tick + alpha`, the same clock the water drifts on and the sprites lerp with:
    // whole ticks would step the bank at 10 fps under a 60 fps picture, and wall
    // clock would keep the weather running through a pause.
    setPhase: (ticks: number): void => {
      uniforms.uniforms.uPhase = ticks;
    },
    setVision: (sources: readonly VisionSource[]): void => {
      const count = Math.min(sources.length, MAX_VISION);
      for (let i = 0; i < count; i += 1) {
        eyes[i * 3] = sources[i].x;
        eyes[i * 3 + 1] = sources[i].y;
        eyes[i * 3 + 2] = VISION_TILES * TILE_SIZE;
      }
      // Slots past the count are left as they were: the loop in the shader stops at
      // uVisionCount, so stale values are never read.
      uniforms.uniforms.uVisionCount = count;
    },
  };
}

// Who opens the shroud: the viewer's own colonists and buildings — ownership is a
// component, so one pass over `owners` finds both — and only those whose circle can
// actually touch the dead lands. Everyone else would spend a slot on a light that
// falls entirely on ground the fog never covered.
//
// Positions are interpolated like the sprites', or the circle would jump ten times
// a second under a colonist gliding at 60 fps.
function visionSources(world: World, player: PlayerId, alpha: number): VisionSource[] {
  const sources: VisionSource[] = [];
  for (const [id, owner] of world.owners) {
    if (owner !== player) {
      continue;
    }
    const cur = world.positions.get(id);
    if (!cur) {
      continue;
    }
    const prev = world.prevPositions.get(id) ?? cur;
    const x = prev.x + (cur.x - prev.x) * alpha;
    const y = prev.y + (cur.y - prev.y) * alpha;
    if (!nearDeadLands(world.grid, x, y)) {
      continue;
    }
    sources.push({ x: x * TILE_SIZE, y: y * TILE_SIZE });
    if (sources.length === MAX_VISION) {
      break;
    }
  }
  return sources;
}

// Whether anything this entity lights could be shrouded: its own tile, or the four
// tiles its circle reaches. The dead lands are one contiguous half of the map, so
// four probes answer it — this only has to be right about who is worth a slot.
// Out of bounds is dead lands to `isDeadLands` (one question instead of two, for the
// sim's sake), which here would light every colonist walking the map's edge, so the
// probes are asked about the map first.
function nearDeadLands(grid: Grid, x: number, y: number): boolean {
  const tx = Math.round(x);
  const ty = Math.round(y);
  return onDeadTile(grid, tx, ty)
    || onDeadTile(grid, tx - VISION_TILES, ty)
    || onDeadTile(grid, tx + VISION_TILES, ty)
    || onDeadTile(grid, tx, ty - VISION_TILES)
    || onDeadTile(grid, tx, ty + VISION_TILES);
}

function onDeadTile(grid: Grid, x: number, y: number): boolean {
  return inBounds(grid, x, y) && isDeadLands(grid, x, y);
}

// Fog of war hides what is in it, not just the ground: a chicken drawn on top of an
// opaque shroud says exactly what the shroud is there to withhold. Positions are in
// world art px, the space the eyes are in.
function hiddenByFog(grid: Grid, sources: readonly VisionSource[], x: number, y: number): boolean {
  if (!onDeadTile(grid, Math.round(x / TILE_SIZE), Math.round(y / TILE_SIZE))) {
    return false;
  }
  const radius = VISION_TILES * TILE_SIZE;
  for (const source of sources) {
    if (dist2(x, y, source.x, source.y) < radius * radius) {
      return false;
    }
  }
  return true;
}

// One pass over the map at art-pixel resolution, then one distance field over the
// result. Both are the terrain bake's own machinery, reused rather than reinvented:
// the shroud has to sit on the same kind of contour the ground under it does.
function bakeFogField(world: World): FogField | null {
  const { grid, seed } = world;
  const width = grid.width * TILE_SIZE;
  const height = grid.height * TILE_SIZE;
  const noise = createNoise2D(createRng(seed ^ EDGE_SALT));

  const shroud = new Uint8Array(width * height);
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let py = 0; py < height; py += 1) {
    // The dual grid, as in terrain.ts: a point sits between four tile centres, half
    // a tile up and left of the tile it is in. Off-map corners clamp to the edge
    // tile, which extends the border region rather than inventing peace beyond it.
    const fy = (py + 0.5 - HALF_TILE) / TILE_SIZE;
    const cy = Math.floor(fy);
    const v = fy - cy;
    const rowUp = clamp(cy, grid.height - 1) * grid.width;
    const rowDown = clamp(cy + 1, grid.height - 1) * grid.width;

    for (let px = 0; px < width; px += 1) {
      const fx = (px + 0.5 - HALF_TILE) / TILE_SIZE;
      const cx = Math.floor(fx);
      const u = fx - cx;
      const colLeft = clamp(cx, grid.width - 1);
      const colRight = clamp(cx + 1, grid.width - 1);

      const upLeft = deadAt(grid, rowUp + colLeft);
      const upRight = deadAt(grid, rowUp + colRight);
      const downLeft = deadAt(grid, rowDown + colLeft);
      const downRight = deadAt(grid, rowDown + colRight);

      let inside = upLeft;
      // Only the border pays for the noise, and the border is a line across a map of
      // a million pixels: everywhere else all four corners already agree.
      if (upRight !== upLeft || downLeft !== upLeft || downRight !== upLeft) {
        const coverage = upLeft * (1 - u) * (1 - v)
          + upRight * u * (1 - v)
          + downLeft * (1 - u) * v
          + downRight * u * v;
        inside = coverage + edgeNoise(noise, px, py) > COVERAGE_THRESHOLD ? 1 : 0;
      }
      if (inside === 0) {
        continue;
      }

      shroud[py * width + px] = 1;
      left = Math.min(left, px);
      top = Math.min(top, py);
      right = Math.max(right, px);
      bottom = Math.max(bottom, py);
    }
  }

  if (right < 0) {
    return null;
  }

  const cap = FOG_EDGE_PX * CHAMFER_ORTHO;
  const distance = chamferDistance(shroud, 0, width, height, cap);
  const mask = new Uint8Array(width * height * 4);
  for (let point = 0; point < shroud.length; point += 1) {
    if (shroud[point] === 0) {
      continue;
    }
    // 0 at the border with the peace lands, 255 once the bank is at full weight.
    mask[point * 4] = Math.round((distance[point] / cap) * 255);
    mask[point * 4 + 3] = 255;
  }
  return { mask: bitmapTexture(mask, width, height), width, height, left, top, right, bottom };
}

function deadAt(grid: Grid, index: number): number {
  return grid.region[index] === Region.Dead ? 1 : 0;
}

// In art-pixel space, not tile space: a per-tile pattern would break at every seam,
// which is the one thing a boundary drawn per pixel exists to avoid.
function edgeNoise(noise: NoiseFunction2D, px: number, py: number): number {
  const coarse = noise(px / EDGE_COARSE_PX, py / EDGE_COARSE_PX);
  const fine = noise(px / EDGE_FINE_PX, py / EDGE_FINE_PX);
  return (coarse * (1 - EDGE_FINE_WEIGHT) + fine * EDGE_FINE_WEIGHT) * EDGE_AMPLITUDE;
}

function clamp(value: number, max: number): number {
  if (value < 0) {
    return 0;
  }
  return value > max ? max : value;
}

export type { FogField, FogOfWar, VisionSource };
export { buildFogOfWar, hiddenByFog, visionSources };
