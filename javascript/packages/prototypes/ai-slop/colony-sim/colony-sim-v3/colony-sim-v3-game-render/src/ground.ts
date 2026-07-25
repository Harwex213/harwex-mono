import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { CompositeTilemap } from "@pixi/tilemap";
import { type Grid, inBounds, Terrain, TILE_SIZE, tileIndex, type World } from "@hw/colony-sim-v3-core";
import type { RenderFlags } from "./flags";
import { castShadow } from "./shadows";
import { bakeTerrain } from "./terrain";
import { sheets } from "./textures";
import { tileHash } from "./tile-hash";
import { buildWaterSurface, type WaterSurface } from "./water";

const STOCKPILE_COLOR = 0xcaa24a;

// The ground is baked; the water surface on top of it is the one live piece, so
// the renderer gets a handle on it alongside the finished layer.
interface Ground {
  layer: Container;
  water: WaterSurface;
}

// The ground never changes, so it is built once: the terrain as a single baked
// bitmap (one sprite, one draw call — see terrain.ts for why it is not a tilemap),
// and the cliffs on top of it in a CompositeTilemap, where a Sprite per mountain
// tile would cost thousands of display objects.
function buildGround(world: World, flags: RenderFlags): Ground {
  const layer = new Container();
  const baked = bakeTerrain(world);
  // Shader pass over the baked water, so it goes above the terrain but below the
  // cliffs: a rock face on the shore should not be tinted by the swell.
  const water = buildWaterSurface(baked.water);
  const cliffs = new CompositeTilemap();
  paintCliffs(cliffs, world);
  layer.addChild(new Sprite(baked.texture));
  // The cliffs again, offset along the light and flattened to black — and placed
  // *under* the water rather than over it. A cliff on the shore does throw its
  // shadow onto the water, but the swell is a shader pass over the bake: a shadow
  // above it would stand still on moving water. Below it, the surface washes the
  // shadow away and it ends exactly at the waterline.
  if (flags.shadows) {
    const shadow = new CompositeTilemap();
    paintCliffs(shadow, world);
    layer.addChild(castShadow(shadow));
  }
  layer.addChild(water.view, cliffs, stockpileMarker(world));
  return { layer, water };
}

// A cliff is laid over the ground, not instead of it: its frames are cut round,
// and the bare ground has to show through the corners for the mass to read as a
// rock rising out of the terrain rather than a square patch. That is also why the
// mountain never becomes its own material in the bake — the terrain under it is
// the barren ground it rises from.
function paintCliffs(tilemap: CompositeTilemap, world: World): void {
  const { grid, seed } = world;
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      if (grid.terrain[tileIndex(grid, x, y)] !== Terrain.Mountain) {
        continue;
      }
      tilemap.tile(cliffTile(grid, seed, x, y), x * TILE_SIZE, y * TILE_SIZE);
    }
  }
}

// Which of the nine cliff frames a mountain tile wears. A wall is drawn on every
// side the mountain ends on, so the frame follows from the four neighbours alone
// and an enclosed tile gets the middle one — the plateau top. Off-map counts as
// open ground, which walls a mountain running into the map edge. A mass one tile
// wide is the case the nine-slice cannot state: every frame it could offer is a
// wall along one side and plateau along the other, and there is no plateau. Such
// a spur is drawn as crags — a chain of boulders, which is what it is.
function cliffTile(grid: Grid, seed: number, x: number, y: number): Texture {
  const { cliff, crag } = sheets();
  const north = isMountain(grid, x, y - 1);
  const south = isMountain(grid, x, y + 1);
  const west = isMountain(grid, x - 1, y);
  const east = isMountain(grid, x + 1, y);
  if ((!north && !south) || (!west && !east)) {
    return crag[tileHash(seed, x, y) % crag.length];
  }
  return cliff[north ? (south ? 1 : 2) : 0][west ? (east ? 1 : 2) : 0];
}

function isMountain(grid: Grid, x: number, y: number): boolean {
  return inBounds(grid, x, y) && grid.terrain[tileIndex(grid, x, y)] === Terrain.Mountain;
}

function stockpileMarker(world: World): Graphics {
  const marker = new Graphics();
  marker.rect(world.stockpile.x * TILE_SIZE, world.stockpile.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  marker.fill(STOCKPILE_COLOR);
  return marker;
}

export type { Ground };
export { buildGround };
