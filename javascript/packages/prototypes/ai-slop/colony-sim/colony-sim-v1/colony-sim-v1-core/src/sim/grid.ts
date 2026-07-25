// Finite orthogonal tile grid. Logical tile = 16px; sim works in tile coords.

// Wider than tall on purpose: the maps that split the world do it with a
// vertical line, and the buildable side of such a split needs the room more than
// a square grid can give it without also growing the side nobody settles.
const TILE_SIZE = 16;
const GRID_W = 96;
const GRID_H = 64;

const enum Terrain {
  Grass = 0,
  Water = 1,
  Rock = 2, // high ground: passable, just barren
  Mountain = 3, // cliff face: the second thing on the map you cannot walk through
}

// Which land a tile belongs to, on a map that has more than one. Terrain cannot
// answer this: the barren side of a divided map and the stony rises of the green
// side are both `Rock`, so "would a colonist go here" is a second field the
// generator writes — not something the sim can read off the ground.
const enum Region {
  Peace = 0,
  Dead = 1,
}

interface Grid {
  width: number;
  height: number;
  terrain: Uint8Array;
  // Parallel to `terrain`, same indexing. Zero-filled, so a generator that draws
  // no regions hands out a map that is peace lands end to end.
  region: Uint8Array;
  // Also parallel to `terrain`: 1 where a building stands. Buildings are entities,
  // but "can a colonist step here" has to be answerable from the grid alone — A*
  // walks tiles and must not learn to read component Maps. Derived, not owned: only
  // placing and despawning a building may write it (see world.ts).
  blocked: Uint8Array;
}

function createGrid(width: number, height: number): Grid {
  return {
    width,
    height,
    terrain: new Uint8Array(width * height),
    region: new Uint8Array(width * height),
    blocked: new Uint8Array(width * height),
  };
}

function tileIndex(grid: Grid, x: number, y: number): number {
  return y * grid.width + x;
}

function inBounds(grid: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

// What can be stood on, terrain and buildings together: a hut is as solid as a
// cliff face to anything that walks, and asking the two questions separately means
// every caller has to remember the second one.
function isWalkable(grid: Grid, x: number, y: number): boolean {
  if (!inBounds(grid, x, y)) {
    return false;
  }
  const index = tileIndex(grid, x, y);
  const terrain = grid.terrain[index];
  return terrain !== Terrain.Water && terrain !== Terrain.Mountain && grid.blocked[index] === 0;
}

// Walkable is not the same question as wanted: the dead lands are crossable, they
// are just no place for a colonist to stroll to. Out of bounds counts as dead so a
// caller only has to ask one of the two.
function isDeadLands(grid: Grid, x: number, y: number): boolean {
  if (!inBounds(grid, x, y)) {
    return true;
  }
  return grid.region[tileIndex(grid, x, y)] === Region.Dead;
}

function tileToPx(tile: number): number {
  return tile * TILE_SIZE;
}

export type { Grid };
export {
  TILE_SIZE,
  GRID_W,
  GRID_H,
  Region,
  Terrain,
  createGrid,
  tileIndex,
  inBounds,
  isWalkable,
  isDeadLands,
  tileToPx,
};
