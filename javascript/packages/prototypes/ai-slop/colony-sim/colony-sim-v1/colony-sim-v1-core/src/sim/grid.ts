// Finite orthogonal tile grid. Logical tile = 16px; sim works in tile coords.

const TILE_SIZE = 16;
const GRID_W = 64;
const GRID_H = 64;

const enum Terrain {
  Grass = 0,
  Water = 1,
  Rock = 2,
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
  return grid.terrain[tileIndex(grid, x, y)] !== Terrain.Water;
}

function tileToPx(tile: number): number {
  return tile * TILE_SIZE;
}

export type { Grid };
export { TILE_SIZE, GRID_W, GRID_H, Terrain, createGrid, tileIndex, inBounds, isWalkable, tileToPx };
