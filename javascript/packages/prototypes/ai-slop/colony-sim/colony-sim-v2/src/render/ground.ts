import { Container, Graphics, type Texture } from "pixi.js";
import { CompositeTilemap } from "@pixi/tilemap";
import { createNoise2D } from "simplex-noise";
import { createRng } from "../sim/rng";
import { type Grid, Terrain, TILE_SIZE, tileIndex } from "../sim/grid";
import type { World } from "../sim/world";
import { sheets } from "./textures";
import { buildWaterSurface, touches, waterDepthMap, type WaterSurface } from "./water";

// The two grass shades split along their own simplex field: per-tile picks look
// like static and square patches like a quilt, whereas a noise field at a finer
// scale than the terrain's gives organic blotches.
const SHADE_SCALE = 7; // tiles per noise unit
const SHADE_THRESHOLD = 0.2; // above it the darker shade wins
const SHADE_SALT = 0x9e3779b1;
const TUFT_PERCENT = 28; // ground tiles carrying a tuft decal

// Rock decor density, in percent of eligible tiles.
const STONE_ROCK_PERCENT = 22;
const GRASS_ROCK_PERCENT = 3;
// Decorrelates the rock scatter from the terrain variant picks, which hash the
// same tile coordinates.
const ROCK_SALT = 0x5f3759df;
const ROCK_TINT_BARE = 0;
const ROCK_TINT_MOSSY = 1; // the sheet's yellow-green moss row, matching the grass

const STOCKPILE_COLOR = 0xcaa24a;

// The ground is baked; the water surface on top of it is the one live piece, so
// the renderer gets a handle on it alongside the finished layer.
interface Ground {
  layer: Container;
  water: WaterSurface;
}

// The ground never changes, so it is painted once into a CompositeTilemap: 64×64
// tiles plus decor collapse into a single draw call, where a Sprite (or a
// Graphics rect) per tile would cost 4096 display objects.
function buildGround(world: World): Ground {
  const layer = new Container();
  const tilemap = new CompositeTilemap();
  const depth = waterDepthMap(world.grid);
  paintTerrain(tilemap, world, depth);
  scatterRocks(tilemap, world);
  // Shader pass over the baked depth tiles, so it goes above the tilemap.
  const water = buildWaterSurface(world.grid, depth);
  layer.addChild(tilemap, water.view, stockpileMarker(world));
  return { layer, water };
}

function paintTerrain(tilemap: CompositeTilemap, world: World, depth: Uint8Array): void {
  const { grid } = world;
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

// Rocks are pure decor: no entities, no persistence. They are re-derived from the
// world seed on every boot and baked into the ground tilemap, so they are stable
// across reloads yet cost nothing per frame. The price is that they do not y-sort
// against colonists — acceptable for tile-sized ground clutter.
function scatterRocks(tilemap: CompositeTilemap, world: World): void {
  const { grid, seed } = world;
  const tiles = sheets();
  const taken = occupiedTiles(world);
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const index = tileIndex(grid, x, y);
      const terrain = grid.terrain[index];
      if (terrain === Terrain.Water || taken.has(index)) {
        continue;
      }
      const hash = tileHash(seed ^ ROCK_SALT, x, y);
      const density = terrain === Terrain.Rock ? STONE_ROCK_PERCENT : GRASS_ROCK_PERCENT;
      if (hash % 100 >= density) {
        continue;
      }
      // Bare stone on rocky ground; on grass, half the boulders grow moss.
      const mossy = terrain !== Terrain.Rock && (hash >>> 8) % 2 === 0;
      const tint = mossy ? ROCK_TINT_MOSSY : ROCK_TINT_BARE;
      const size = (hash >>> 16) % tiles.rocks[tint].length;
      tilemap.tile(tiles.rocks[tint][size], x * TILE_SIZE, y * TILE_SIZE);
    }
  }
}

// Tiles decor must leave clear, so a boulder never sits under a tree or hides the
// stockpile marker.
function occupiedTiles(world: World): Set<number> {
  const taken = new Set<number>([tileIndex(world.grid, world.stockpile.x, world.stockpile.y)]);
  for (const id of world.trees) {
    const pos = world.positions.get(id);
    if (pos) {
      taken.add(tileIndex(world.grid, Math.round(pos.x), Math.round(pos.y)));
    }
  }
  return taken;
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

export type { Ground };
export { buildGround };
