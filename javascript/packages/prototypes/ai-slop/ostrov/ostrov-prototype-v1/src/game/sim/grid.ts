import type { Actor } from "../types";

const CELL = 64;

type Grid = {
  cols: number;
  rows: number;
  minX: number;
  minY: number;
  buckets: number[][];
};

/**
 * Uniform hash grid over the live actors, rebuilt once per tick. Targeting and
 * separation both scan it instead of walking the whole actor list.
 */
function buildGrid(actors: Actor[]): Grid {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const actor of actors) {
    if (actor.dead) {
      continue;
    }
    minX = Math.min(minX, actor.x);
    minY = Math.min(minY, actor.y);
    maxX = Math.max(maxX, actor.x);
    maxY = Math.max(maxY, actor.y);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }
  const cols = Math.max(1, Math.ceil((maxX - minX) / CELL) + 1);
  const rows = Math.max(1, Math.ceil((maxY - minY) / CELL) + 1);
  const buckets: number[][] = new Array(cols * rows);
  for (let i = 0; i < buckets.length; i += 1) {
    buckets[i] = [];
  }
  const grid: Grid = { cols, rows, minX, minY, buckets };
  for (let i = 0; i < actors.length; i += 1) {
    const actor = actors[i];
    if (actor.dead) {
      continue;
    }
    buckets[bucketOf(grid, actor.x, actor.y)].push(i);
  }
  return grid;
}

function bucketOf(grid: Grid, x: number, y: number): number {
  const col = clamp(Math.floor((x - grid.minX) / CELL), 0, grid.cols - 1);
  const row = clamp(Math.floor((y - grid.minY) / CELL), 0, grid.rows - 1);
  return row * grid.cols + col;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Collects actor indices whose bucket overlaps the query circle. */
function queryGrid(grid: Grid, x: number, y: number, radius: number, out: number[]): number[] {
  out.length = 0;
  const minCol = clamp(Math.floor((x - radius - grid.minX) / CELL), 0, grid.cols - 1);
  const maxCol = clamp(Math.floor((x + radius - grid.minX) / CELL), 0, grid.cols - 1);
  const minRow = clamp(Math.floor((y - radius - grid.minY) / CELL), 0, grid.rows - 1);
  const maxRow = clamp(Math.floor((y + radius - grid.minY) / CELL), 0, grid.rows - 1);
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      const bucket = grid.buckets[row * grid.cols + col];
      for (let i = 0; i < bucket.length; i += 1) {
        out.push(bucket[i]);
      }
    }
  }
  return out;
}

export type { Grid };
export { buildGrid, queryGrid };
