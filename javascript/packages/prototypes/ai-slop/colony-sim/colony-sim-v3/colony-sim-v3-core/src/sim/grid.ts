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

interface Grid {
  width: number;
  height: number;
  terrain: Uint8Array;
}

function createGrid(width: number, height: number): Grid {
  return {
    width,
    height,
    terrain: new Uint8Array(width * height),
  };
}

function tileIndex(grid: Grid, x: number, y: number): number {
  return y * grid.width + x;
}

function inBounds(grid: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

function isWalkable(grid: Grid, x: number, y: number): boolean {
  if (!inBounds(grid, x, y)) {
    return false;
  }
  const terrain = grid.terrain[tileIndex(grid, x, y)];
  return terrain !== Terrain.Water && terrain !== Terrain.Mountain;
}

function tileToPx(tile: number): number {
  return tile * TILE_SIZE;
}

export type { Grid };
export { TILE_SIZE, GRID_W, GRID_H, Terrain, createGrid, tileIndex, inBounds, isWalkable, tileToPx };
