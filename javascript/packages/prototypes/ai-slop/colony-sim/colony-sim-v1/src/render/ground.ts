import { Container, Graphics, type Texture } from "pixi.js";
import { CompositeTilemap } from "@pixi/tilemap";
import { createNoise2D } from "simplex-noise";
import { createRng } from "../sim/rng";
import { type Grid, inBounds, Terrain, TILE_SIZE, tileIndex } from "../sim/grid";
import type { World } from "../sim/world";
import { sheets } from "./textures";

// Tiles away from the nearest shore at which water reaches its darkest shade.
const MAX_DEPTH = 3;

// The two grass shades split along their own simplex field: per-tile picks look
// like static and square patches like a quilt, whereas a noise field at a finer
// scale than the terrain's gives organic blotches.
const SHADE_SCALE = 7; // tiles per noise unit
const SHADE_THRESHOLD = 0.2; // above it the darker shade wins
const SHADE_SALT = 0x9e3779b1;
const TUFT_PERCENT = 28; // ground tiles carrying a tuft decal

const STOCKPILE_COLOR = 0xcaa24a;

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

// The ground never changes, so it is painted once into a CompositeTilemap: 64×64
// tiles plus decor collapse into a single draw call, where a Sprite (or a
// Graphics rect) per tile would cost 4096 display objects.
function buildGround(world: World): Container {
  const layer = new Container();
  const tilemap = new CompositeTilemap();
  paintTerrain(tilemap, world);
  layer.addChild(tilemap, stockpileMarker(world));
  return layer;
}

function paintTerrain(tilemap: CompositeTilemap, world: World): void {
  const { grid } = world;
  const depth = waterDepthMap(grid);
  const shade = shadeMap(grid, world.seed);
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      tilemap.tile(terrainTile(world, depth, shade, x, y), x * TILE_SIZE, y * TILE_SIZE);
    }
  }
}

function terrainTile(world: World, depth: Uint8Array, shade: Uint8Array, x: number, y: number): Texture {
  const { grid, seed } = world;
  const index = tileIndex(grid, x, y);
  const terrain = grid.terrain[index];
  const tiles = sheets();
  const hash = tileHash(seed, x, y);

  if (terrain === Terrain.Water) {
    return tiles.water[depth[index] - 1];
  }
  // Land bordering water becomes beach, so the seam reads as a shore instead of a
  // hard colour edge.
  if (touches(grid, x, y, Terrain.Water)) {
    return tiles.sand[hash % tiles.sand.length];
  }
  // High ground is dry and sparse; the boulders scattered densely over it carry
  // the rest of the read. Its sheet shares the grass layout, so the same shade
  // and tuft picks apply.
  const ground = terrain === Terrain.Rock ? tiles.dryGrass : tiles.grass;
  const variant = hash % 100 < TUFT_PERCENT ? 1 + ((hash >>> 8) % 2) : 0;
  return ground[shade[index]][variant];
}

function shadeMap(grid: Grid, seed: number): Uint8Array {
  const noise = createNoise2D(createRng(seed ^ SHADE_SALT));
  const shade = new Uint8Array(grid.width * grid.height);
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const dark = noise(x / SHADE_SCALE, y / SHADE_SCALE) > SHADE_THRESHOLD;
      shade[tileIndex(grid, x, y)] = dark ? 1 : 0;
    }
  }
  return shade;
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

function stockpileMarker(world: World): Graphics {
  const marker = new Graphics();
  marker.rect(world.stockpile.x * TILE_SIZE, world.stockpile.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  marker.fill(STOCKPILE_COLOR);
  return marker;
}

// Stable per-tile randomness (mulberry-style mixing): the same seed and tile
// always pick the same variant, so terrain detail and decor survive a reload
// without being written to the save.
function tileHash(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

export { buildGround };
