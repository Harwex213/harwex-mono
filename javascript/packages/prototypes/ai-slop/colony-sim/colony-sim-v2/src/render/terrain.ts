import { BufferImageSource, Texture } from "pixi.js";
import { createNoise2D, type NoiseFunction2D } from "simplex-noise";
import { createRng } from "../sim/rng";
import { type Grid, Terrain, TILE_SIZE, tileIndex } from "../sim/grid";
import type { World } from "../sim/world";
import { fills, type Fills, GRASS_VARIANTS } from "./textures";
import { tileHash } from "./tile-hash";
import { touches, waterDepthMap, type WaterField } from "./water";

// The terrain is baked into one full-map bitmap rather than one texture per tile.
// That is the whole point: as long as a tile is the unit of painting, every seam
// between two terrains has to run along a tile edge, and the map reads as a
// quilt. Here the tile only decides *what* a point is made of; the boundary
// itself is drawn per art pixel and can wander anywhere.
//
// The bitmap is one GPU texture, so the map cannot outgrow the platform's texture
// limit. 64×64 tiles = 1024², far inside it; past this the answer is chunking, not
// a bigger bitmap.
const MAX_BAKE_PX = 4096;
const HALF_TILE = TILE_SIZE / 2;

// Materials are a *total order*, and that order is the paint order: where two of
// them meet, the higher id spills over the lower one. The ramp runs from the
// bottom of the world to the top — open water, shore, beach, grass, dry high
// ground — so a beach always eats into the water and grass into the beach, never
// the reverse. The two shades of one ground are separate materials for the same
// reason: it makes the shade blotches organic instead of square.
//
// The water ids are also the depth ramp, deepest first: `Shallow - (depth - 1)`.
const enum Material {
  DeepWater = 0,
  MidWater = 1,
  Shallow = 2,
  Sand = 3,
  GrassLight = 4,
  GrassDark = 5,
  DryLight = 6,
  DryDark = 7,
}

// "Light"/"dark" name the sheet row, not a measured luminance: DeadGrass's two
// rows barely differ. Which row wins is the shade field's call.
const SHADE_SCALE = 7; // tiles per noise unit
const SHADE_THRESHOLD = 0.2; // above it the second shade wins
const SHADE_SALT = 0x9e3779b1;
const TUFT_PERCENT = 28; // ground tiles carrying a tuft decal

// The boundary between two materials. A material's coverage of a point is
// bilinear over the four surrounding tile centres, thresholded at 0.5 — that
// alone gives smooth diagonal corners (marching squares on the dual grid) but
// perfectly regular arcs. The noise bends the contour by up to ±AMPLITUDE of
// coverage, which on a straight edge is a few art pixels of wobble.
//
// Two octaves: the coarse one makes the shoreline meander, the fine one keeps the
// edge ragged at pixel scale instead of smoothly curved.
const EDGE_SALT = 0x7f4a7c15;
const EDGE_COARSE_PX = 7; // art px per noise unit
const EDGE_FINE_PX = 2.5;
const EDGE_FINE_WEIGHT = 0.25;
const EDGE_AMPLITUDE = 0.3;
const COVERAGE_THRESHOLD = 0.5;

// How far out from the shore the surface shader can still tell where the shore is.
// Foam has to hug the waterline, and the waterline is now a per-pixel thing: a
// tile-resolution depth tier could only ever put foam in a tile-wide ring, so the
// mask carries a real distance in art pixels instead. Everything past the reach is
// just "open water" and clamps.
const SHORE_REACH_PX = 10;
// Chamfer weights: 5 orthogonal, 7 diagonal approximates 1 : √2 closely enough for
// a foam line and keeps the whole transform in integers.
const CHAMFER_ORTHO = 5;
const CHAMFER_DIAG = 7;

// Beach meeting water is the harshest colour step on the map (#e7d593 → #77c0b4),
// and pixel art does not soften a step by blending it: an alpha ramp lands on
// off-palette mush and reads as blur at ×8 zoom. What softens it is another
// *palette step*, and the pack ships exactly one for this — Shore.png's wet sand —
// laid as a narrow band on the land side of the waterline. The width wanders, or
// the band's own outer edge becomes the second hard outline.
const WET_SALT = 0x1b56c4e9;
const WET_BAND_PX = 4.0;
const WET_SWING_PX = 2.2; // how much the width breathes, over WET_SCALE
const WET_SCALE = 6; // art px per noise unit
// A second octave at pixel scale. Without it the band has a clean edge of its own,
// which is the same hard step one pixel further inland; ragged, it dithers into the
// dry sand instead.
const WET_RAGGED_PX = 1.0;
const WET_RAGGED_SCALE = 2.1;

// Everything the ground layer needs out of the bake: the map as one texture, plus
// the water mask the surface shader reads. `water` is null on a map with no water.
interface BakedTerrain {
  texture: Texture;
  water: WaterField | null;
}

function bakeTerrain(world: World): BakedTerrain {
  const { grid, seed } = world;
  const width = grid.width * TILE_SIZE;
  const height = grid.height * TILE_SIZE;
  if (width > MAX_BAKE_PX || height > MAX_BAKE_PX) {
    throw new Error(`terrain bitmap ${width}×${height}px exceeds one texture — the map needs chunking`);
  }

  const material = materialMap(world);
  const tuft = tuftMap(grid, seed);
  const paint = fills();
  const noise = createNoise2D(createRng(seed ^ EDGE_SALT));

  const color = new Uint8Array(width * height * 4);
  const wet = new Uint8Array(width * height);
  const sand = new Uint8Array(width * height);
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let py = 0; py < height; py += 1) {
    // The dual grid: a point is surrounded by four tile *centres*, half a tile up
    // and left of the tile it sits in. Out-of-map corners clamp to the edge tile,
    // which extends the border material rather than inventing one.
    const fy = (py + 0.5 - HALF_TILE) / TILE_SIZE;
    const cy = Math.floor(fy);
    const v = fy - cy;
    const rowUp = clamp(cy, grid.height - 1) * grid.width;
    const rowDown = clamp(cy + 1, grid.height - 1) * grid.width;
    const tuftRow = Math.floor(py / TILE_SIZE) * grid.width;
    const fillRow = (py % TILE_SIZE) * TILE_SIZE * 4;

    for (let px = 0; px < width; px += 1) {
      const fx = (px + 0.5 - HALF_TILE) / TILE_SIZE;
      const cx = Math.floor(fx);
      const u = fx - cx;
      const colLeft = clamp(cx, grid.width - 1);
      const colRight = clamp(cx + 1, grid.width - 1);

      const upLeft = material[rowUp + colLeft];
      const upRight = material[rowUp + colRight];
      const downLeft = material[rowDown + colLeft];
      const downRight = material[rowDown + colRight];

      let winner = upLeft;
      if (upRight !== upLeft || downLeft !== upLeft || downRight !== upLeft) {
        winner = dominant(upLeft, upRight, downLeft, downRight, u, v, edgeNoise(noise, px, py));
      }

      const point = py * width + px;
      const fill = fillFor(paint, winner, tuft[tuftRow + Math.floor(px / TILE_SIZE)]);
      const src = fillRow + (px % TILE_SIZE) * 4;
      const dst = point * 4;
      color[dst] = fill[src];
      color[dst + 1] = fill[src + 1];
      color[dst + 2] = fill[src + 2];
      color[dst + 3] = 255;

      if (winner <= Material.Shallow) {
        wet[point] = 1;
        left = Math.min(left, px);
        top = Math.min(top, py);
        right = Math.max(right, px);
        bottom = Math.max(bottom, py);
      } else if (winner === Material.Sand) {
        sand[point] = 1;
      }
    }
  }

  wetSandBand(color, sand, wet, width, height, seed, paint);
  const texture = bitmapTexture(color, width, height);
  if (right < 0) {
    return { texture, water: null };
  }
  return {
    texture,
    water: { mask: waterMask(wet, width, height), width, height, left, top, right, bottom },
  };
}

// The surface shader's view of the water: alpha says whether a pixel is wet, red
// says how far it is from the nearest dry pixel. Both are per pixel, because after
// the bake the waterline is too — a tile-resolution signal here would hand the
// foam back the tile edges the bake just got rid of.
function waterMask(wet: Uint8Array, width: number, height: number): Texture {
  const cap = SHORE_REACH_PX * CHAMFER_ORTHO;
  const distance = chamferDistance(wet, 0, width, height);
  const mask = new Uint8Array(width * height * 4);
  for (let point = 0; point < wet.length; point += 1) {
    if (wet[point] === 0) {
      continue;
    }
    // 0 at the waterline, 255 out at sea.
    mask[point * 4] = Math.round((distance[point] / cap) * 255);
    mask[point * 4 + 3] = 255;
  }
  return bitmapTexture(mask, width, height);
}

// Repaints the beach pixels nearest the water. Runs over the finished bitmap rather
// than inside the paint loop because the band is a *distance*, and distance is only
// known once the whole waterline is: at that point each sand pixel is one lookup.
function wetSandBand(
  color: Uint8Array,
  sand: Uint8Array,
  wet: Uint8Array,
  width: number,
  height: number,
  seed: number,
  paint: Fills,
): void {
  const distance = chamferDistance(wet, 1, width, height);
  const reach = createNoise2D(createRng(seed ^ WET_SALT));
  const widest = (WET_BAND_PX + WET_SWING_PX + WET_RAGGED_PX) * CHAMFER_ORTHO;
  for (let py = 0; py < height; py += 1) {
    const fillRow = (py % TILE_SIZE) * TILE_SIZE * 4;
    for (let px = 0; px < width; px += 1) {
      const point = py * width + px;
      // The cheap tests first: most of the map is neither sand nor near water, and
      // the noise below is the only expensive part of this pass.
      if (sand[point] === 0 || distance[point] > widest) {
        continue;
      }
      const band = (WET_BAND_PX
        + reach(px / WET_SCALE, py / WET_SCALE) * WET_SWING_PX
        + reach(px / WET_RAGGED_SCALE, py / WET_RAGGED_SCALE) * WET_RAGGED_PX) * CHAMFER_ORTHO;
      if (distance[point] > band) {
        continue;
      }
      const src = fillRow + (px % TILE_SIZE) * 4;
      color[point * 4] = paint.wetSand[src];
      color[point * 4 + 1] = paint.wetSand[src + 1];
      color[point * 4 + 2] = paint.wetSand[src + 2];
    }
  }
}

// Distance from every pixel to the nearest one flagged `seed`, in two chamfer passes
// (forward, then backward) rather than a queue: a full-map BFS over a million pixels
// is the slower half of the bake, and nothing here needs more than the first ten.
// Distances saturate at the cap, in chamfer units — CHAMFER_ORTHO per art pixel.
function chamferDistance(flags: Uint8Array, seed: number, width: number, height: number): Uint16Array {
  const cap = SHORE_REACH_PX * CHAMFER_ORTHO;
  const distance = new Uint16Array(width * height);
  for (let point = 0; point < flags.length; point += 1) {
    distance[point] = flags[point] === seed ? 0 : cap;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const point = y * width + x;
      let best = distance[point];
      if (best === 0) {
        continue;
      }
      if (y > 0) {
        best = Math.min(best, distance[point - width] + CHAMFER_ORTHO);
        if (x > 0) {
          best = Math.min(best, distance[point - width - 1] + CHAMFER_DIAG);
        }
        if (x < width - 1) {
          best = Math.min(best, distance[point - width + 1] + CHAMFER_DIAG);
        }
      }
      if (x > 0) {
        best = Math.min(best, distance[point - 1] + CHAMFER_ORTHO);
      }
      distance[point] = best;
    }
  }

  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const point = y * width + x;
      let best = distance[point];
      if (best === 0) {
        continue;
      }
      if (y < height - 1) {
        best = Math.min(best, distance[point + width] + CHAMFER_ORTHO);
        if (x > 0) {
          best = Math.min(best, distance[point + width - 1] + CHAMFER_DIAG);
        }
        if (x < width - 1) {
          best = Math.min(best, distance[point + width + 1] + CHAMFER_DIAG);
        }
      }
      if (x < width - 1) {
        best = Math.min(best, distance[point + 1] + CHAMFER_ORTHO);
      }
      distance[point] = best;
    }
  }

  return distance;
}

// Which material owns a point, given the four tiles around it. Candidates are
// tried from the top of the order down, and each one is tested against the
// coverage of *every* corner at or above it — so the sets are nested and the same
// noise value decides all of them. That is what keeps the result watertight: there
// is no threshold at which two materials both claim a pixel or neither does.
function dominant(
  upLeft: number,
  upRight: number,
  downLeft: number,
  downRight: number,
  u: number,
  v: number,
  noise: number,
): number {
  const lowest = Math.min(Math.min(upLeft, upRight), Math.min(downLeft, downRight));
  const highest = Math.max(Math.max(upLeft, upRight), Math.max(downLeft, downRight));
  const wUpLeft = (1 - u) * (1 - v);
  const wUpRight = u * (1 - v);
  const wDownLeft = (1 - u) * v;
  const wDownRight = u * v;

  for (let candidate = highest; candidate > lowest; candidate -= 1) {
    let coverage = 0;
    if (upLeft >= candidate) {
      coverage += wUpLeft;
    }
    if (upRight >= candidate) {
      coverage += wUpRight;
    }
    if (downLeft >= candidate) {
      coverage += wDownLeft;
    }
    if (downRight >= candidate) {
      coverage += wDownRight;
    }
    if (coverage + noise > COVERAGE_THRESHOLD) {
      return candidate;
    }
  }
  // The lowest material covers the whole point by construction, so it is the
  // fallback and never needs a test of its own.
  return lowest;
}

// Sampled in art-pixel space, not tile space: the contour has to stay continuous
// across tile boundaries, and a per-tile pattern would break at every seam —
// exactly the artefact this whole layer exists to remove.
function edgeNoise(noise: NoiseFunction2D, px: number, py: number): number {
  const coarse = noise(px / EDGE_COARSE_PX, py / EDGE_COARSE_PX);
  const fine = noise(px / EDGE_FINE_PX, py / EDGE_FINE_PX);
  return (coarse * (1 - EDGE_FINE_WEIGHT) + fine * EDGE_FINE_WEIGHT) * EDGE_AMPLITUDE;
}

function materialMap(world: World): Uint8Array {
  const { grid, seed } = world;
  const depth = waterDepthMap(grid);
  const shade = createNoise2D(createRng(seed ^ SHADE_SALT));
  const material = new Uint8Array(grid.width * grid.height);
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const index = tileIndex(grid, x, y);
      const terrain = grid.terrain[index];
      if (terrain === Terrain.Water) {
        material[index] = Material.Shallow - (depth[index] - 1);
        continue;
      }
      // Land bordering water becomes beach, so the shore reads as a shore instead
      // of a colour edge.
      if (touches(grid, x, y, Terrain.Water)) {
        material[index] = Material.Sand;
        continue;
      }
      // The two shades split along their own simplex field: per-tile picks look
      // like static and square patches like a quilt, whereas a noise field at a
      // finer scale than the terrain's gives organic blotches.
      const second = shade(x / SHADE_SCALE, y / SHADE_SCALE) > SHADE_THRESHOLD;
      // High ground is dry and sparse; the boulders scattered densely over it
      // carry the rest of the read. Its sheet shares the grass layout, so the same
      // shade and tuft picks apply.
      if (terrain === Terrain.Rock) {
        material[index] = second ? Material.DryDark : Material.DryLight;
        continue;
      }
      material[index] = second ? Material.GrassDark : Material.GrassLight;
    }
  }
  return material;
}

// Tufts stay a per-tile pick even though the paint is per pixel: a tuft is a mark
// on a tile, and the bake simply clips it to whatever ground actually won there,
// so one never gets cut in half by a boundary.
function tuftMap(grid: Grid, seed: number): Uint8Array {
  const tuft = new Uint8Array(grid.width * grid.height);
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const hash = tileHash(seed, x, y);
      const variant = hash % 100 < TUFT_PERCENT ? 1 + ((hash >>> 8) % (GRASS_VARIANTS - 1)) : 0;
      tuft[tileIndex(grid, x, y)] = variant;
    }
  }
  return tuft;
}

function fillFor(paint: Fills, material: number, tuft: number): Uint8Array {
  switch (material) {
    case Material.DeepWater:
      return paint.water[2];
    case Material.MidWater:
      return paint.water[1];
    case Material.Shallow:
      return paint.water[0];
    case Material.Sand:
      return paint.sand;
    case Material.GrassLight:
      return paint.grass[0][tuft];
    case Material.GrassDark:
      return paint.grass[1][tuft];
    case Material.DryLight:
      return paint.dryGrass[0][tuft];
    default:
      return paint.dryGrass[1][tuft];
  }
}

// Uploaded as a raw buffer rather than through a canvas: a 2d canvas premultiplies
// what it stores, which would silently drop the mask's red channel wherever alpha
// is 0.
function bitmapTexture(data: Uint8Array, width: number, height: number): Texture {
  return new Texture({
    source: new BufferImageSource({ resource: data, width, height, scaleMode: "nearest" }),
  });
}

function clamp(value: number, max: number): number {
  if (value < 0) {
    return 0;
  }
  return value > max ? max : value;
}

export type { BakedTerrain };
export { bakeTerrain };
