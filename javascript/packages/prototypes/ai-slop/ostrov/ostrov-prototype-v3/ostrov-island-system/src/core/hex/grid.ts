import type { TAxial } from "./coords";

/**
 * Board size the generator falls back to. A board of radius `n` is a hexagon
 * of hexes: every side is `n + 1` cells long and the widest row holds
 * `2n + 1`. Radius 5 gives 91 cells.
 */
const DEFAULT_BOARD_RADIUS = 5;

/** Number of cells on a board of the given radius. */
const boardCellCount = (radius: number) => 3 * radius * (radius + 1) + 1;

/** Every cell within `radius` steps of the origin. */
const createGrid = (radius: number = DEFAULT_BOARD_RADIUS): TAxial[] => {
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

/** Generation grows the island around the middle of the board. */
const gridCentre = (): TAxial => ({ q: 0, r: 0 });

export { DEFAULT_BOARD_RADIUS, boardCellCount, createGrid, gridCentre };
