import type { TAxial } from "./coords";

/**
 * The board is a hexagon of hexes: every side is `BOARD_RADIUS + 1` cells long
 * and the widest row holds `2 * BOARD_RADIUS + 1`. Radius 5 gives 91 cells.
 */
const BOARD_RADIUS = 5;

/** Every cell within `BOARD_RADIUS` steps of the origin. */
const createGrid = (): TAxial[] => {
  const cells: TAxial[] = [];

  // Row by row, top to bottom. The board is drawn in this order, so a peak that
  // sticks out above its own tile is covered by the row in front of it.
  for (let r = -BOARD_RADIUS; r <= BOARD_RADIUS; r += 1) {
    const from = Math.max(-BOARD_RADIUS, -r - BOARD_RADIUS);
    const to = Math.min(BOARD_RADIUS, -r + BOARD_RADIUS);

    for (let q = from; q <= to; q += 1) {
      cells.push({ q, r });
    }
  }

  return cells;
};

/** Generation grows the island around the middle of the board. */
const gridCentre = (): TAxial => ({ q: 0, r: 0 });

export { BOARD_RADIUS, createGrid, gridCentre };
