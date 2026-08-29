import type { TAxial } from "@hw/ostrov-utils";

/**
 * Offset hex coordinate. `x` is the column and `y` is the row. The convention
 * is odd-r: every odd row is pushed half a hex to the right, which is what a
 * pointy-top grid needs.
 */
type TOffset = {
  x: number;
  y: number;
};

/** An inclusive range of world coordinates along one axis. */
type TRange = {
  min: number;
  max: number;
};

/** Stable string key over offset coordinates. */
const offsetKey = (x: number, y: number) => `${x}:${y}`;

/**
 * `y & 1` is 1 for an odd row and 0 for an even one, and it stays 1 for a
 * negative odd row, so the shift is correct on both sides of the origin.
 */
const rowShift = (row: number) => (row - (row & 1)) / 2;

const axialToOffset = (hex: TAxial): TOffset => ({ x: hex.q + rowShift(hex.r), y: hex.r });

const offsetToAxial = (cell: TOffset): TAxial => ({ q: cell.x - rowShift(cell.y), r: cell.y });

/** How many cells the range holds. Both ends are included. */
const rangeSize = (range: TRange) => Math.max(0, Math.round(range.max) - Math.round(range.min) + 1);

const inRange = (range: TRange, value: number) => value >= range.min && value <= range.max;

/** Every cell of the world rectangle, row by row from the top. */
const rectCells = (xRange: TRange, yRange: TRange): TOffset[] => {
  const cells: TOffset[] = [];

  for (let y = Math.round(yRange.min); y <= Math.round(yRange.max); y += 1) {
    for (let x = Math.round(xRange.min); x <= Math.round(xRange.max); x += 1) {
      cells.push({ x, y });
    }
  }

  return cells;
};

export type { TOffset, TRange };
export { axialToOffset, inRange, offsetKey, offsetToAxial, rangeSize, rectCells };
