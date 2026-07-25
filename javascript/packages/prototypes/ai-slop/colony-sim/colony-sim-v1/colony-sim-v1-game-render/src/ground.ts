import { Container, Graphics, Sprite } from "pixi.js";
import { CompositeTilemap } from "@pixi/tilemap";
import { type Grid, inBounds, Terrain, TILE_SIZE, tileIndex, type World } from "@hw/colony-sim-v1-core";
import { bakeTerrain } from "./terrain";
import { type Cliff, CLIFF_HALF, CLIFF_INSET, sheets } from "./textures";
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
function buildGround(world: World): Ground {
  const layer = new Container();
  const baked = bakeTerrain(world);
  // Shader pass over the baked water, so it goes above the terrain but below the
  // cliffs: a rock face on the shore should not be tinted by the swell.
  const water = buildWaterSurface(baked.water);
  const cliffs = new CompositeTilemap();
  paintCliffs(cliffs, world);
  layer.addChild(new Sprite(baked.texture), water.view, cliffs, stockpileMarker(world));
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
      paintCliff(tilemap, grid, seed, x, y);
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
//
// The other case it cannot state is a concave joint: a corner where two arms of
// the mass meet and the diagonal tile between them is open ground. The tile is
// enclosed on all four sides, so the nine-slice calls it plateau — and the wall
// that should turn around the joint is simply missing, which is the hole a
// diagonal edge shows at every step. There the tile is laid half at a time and
// the joint counts as an open side for the half it touches, which turns the wall
// where the sheet already turns it: at the halfway line.
function paintCliff(tilemap: CompositeTilemap, grid: Grid, seed: number, x: number, y: number): void {
  const { cliff, crag } = sheets();
  const left = x * TILE_SIZE;
  const top = y * TILE_SIZE;
  const north = isMountain(grid, x, y - 1);
  const south = isMountain(grid, x, y + 1);
  const west = isMountain(grid, x - 1, y);
  const east = isMountain(grid, x + 1, y);
  if ((!north && !south) || (!west && !east)) {
    tilemap.tile(crag[tileHash(seed, x, y) % crag.length], left, top);
    return;
  }
  const row = north ? (south ? 1 : 2) : 0;
  const upper = [
    !west || (north && !isMountain(grid, x - 1, y - 1)),
    !east || (north && !isMountain(grid, x + 1, y - 1)),
  ];
  const lower = [
    !west || (south && !isMountain(grid, x - 1, y + 1)),
    !east || (south && !isMountain(grid, x + 1, y + 1)),
  ];
  if (upper[0] === !west && upper[1] === !east && lower[0] === !west && lower[1] === !east) {
    tilemap.tile(cliff.face[row][west ? (east ? 1 : 2) : 0], left, top);
    return;
  }
  paintCliffHalf(tilemap, cliff, row, 0, upper, left, top);
  paintCliffHalf(tilemap, cliff, row, 1, lower, left, top + CLIFF_HALF);
}

// One half-tile of a cliff, by which side the mass ends on within that half. Ends
// on both — the mass is one tile wide as far as this half is concerned — and the
// two side walls are laid instead, each trimmed so it stops short of the strip the
// other one leaves open for the ground.
function paintCliffHalf(
  tilemap: CompositeTilemap,
  cliff: Cliff,
  row: number,
  half: number,
  [openWest, openEast]: boolean[],
  left: number,
  top: number,
): void {
  if (openWest && openEast) {
    tilemap.tile(cliff.joint[half][row][0], left, top);
    tilemap.tile(cliff.joint[half][row][1], left + CLIFF_INSET, top);
    return;
  }
  tilemap.tile(cliff.half[half][row][openWest ? 0 : openEast ? 2 : 1], left, top);
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
