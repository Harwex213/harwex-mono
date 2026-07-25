import { Container, Graphics, Sprite } from "pixi.js";
import { CompositeTilemap } from "@pixi/tilemap";
import { Terrain, TILE_SIZE, tileIndex } from "../sim/grid";
import type { World } from "../sim/world";
import { bakeTerrain } from "./terrain";
import { sheets } from "./textures";
import { tileHash } from "./tile-hash";
import { buildWaterSurface, type WaterSurface } from "./water";

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

// The ground never changes, so it is built once: the terrain as a single baked
// bitmap (one sprite, one draw call — see terrain.ts for why it is not a tilemap),
// and the decor on top of it in a CompositeTilemap, where a Sprite per rock would
// cost thousands of display objects.
function buildGround(world: World): Ground {
  const layer = new Container();
  const baked = bakeTerrain(world);
  // Shader pass over the baked water, so it goes above the terrain but below the
  // decor: a boulder on the shore should not be tinted by the swell.
  const water = buildWaterSurface(baked.water);
  const decor = new CompositeTilemap();
  scatterRocks(decor, world);
  layer.addChild(new Sprite(baked.texture), water.view, decor, stockpileMarker(world));
  return { layer, water };
}

// Rocks are pure decor: no entities, no persistence. They are re-derived from the
// world seed on every boot, so they are stable across reloads yet cost nothing per
// frame. The price is that they do not y-sort against colonists — acceptable for
// tile-sized ground clutter.
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

export type { Ground };
export { buildGround };
