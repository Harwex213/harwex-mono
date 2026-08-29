import { hexDistance } from "./coords";
import type { TAxial } from "./coords";

/**
 * A hexagon of hexes around the origin: every side is `radius + 1` cells long
 * and the widest row holds `2 * radius + 1`. Radius 2 gives 19 cells, radius 8
 * gives 217.
 */
const createGrid = (radius: number): TAxial[] => {
  const cells: TAxial[] = [];

  // Row by row, top to bottom. The board is drawn in this order, so a peak that
  // sticks out above its own tile is covered by the row in front of it.
  for (let r = -radius; r <= radius; r += 1) {
    const from = Math.max(-radius, -r - radius);
    const to = Math.min(radius, -r + radius);

    for (let q = from; q <= to; q += 1) {
      cells.push({ q, r });
    }
  }

  return cells;
};

const ORIGIN: TAxial = { q: 0, r: 0 };

const insideGrid = (cell: TAxial, radius: number) => hexDistance(cell, ORIGIN) <= radius;

export { ORIGIN, createGrid, insideGrid };
