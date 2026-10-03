import { HEX_DIRECTIONS, hexKey } from "@hw/ostrov-utils";
import type { TAxial } from "@hw/ostrov-utils";

/** Distance from a hex centre to a corner, in SVG units. */
const HEX_SIZE = 18;

const SQRT3 = Math.sqrt(3);

type TPoint = {
  x: number;
  y: number;
};

/** Corner `i` of a pointy-top hex sits at `60 * i - 30` degrees. */
const HEX_CORNERS: readonly TPoint[] = [0, 1, 2, 3, 4, 5].map((index) => {
  const angle = (Math.PI / 180) * (60 * index - 30);

  return { x: HEX_SIZE * Math.cos(angle), y: HEX_SIZE * Math.sin(angle) };
});

/** Centre of a hex in SVG space. */
const hexToPoint = (hex: TAxial): TPoint => ({
  x: HEX_SIZE * SQRT3 * (hex.q + hex.r / 2),
  y: HEX_SIZE * 1.5 * hex.r,
});

/** Corner list as an SVG `points` attribute, relative to the hex centre. */
const hexPolygonPoints = (scale = 1) => {
  return HEX_CORNERS.map((corner) => `${(corner.x * scale).toFixed(2)},${(corner.y * scale).toFixed(2)}`).join(" ");
};

/**
 * `y & 1` is 1 for an odd row and 0 for an even one, and it stays 1 for a negative
 * odd row, so the shift is correct on both sides of the origin.
 */
const rowShift = (row: number) => (row - (row & 1)) / 2;

/** Axial to odd-r offset column. The world rectangle is described in offset space. */
const axialToOffsetX = (hex: TAxial) => hex.q + rowShift(hex.r);

const offsetToAxial = (x: number, y: number): TAxial => ({ q: x - rowShift(y), r: y });

/**
 * Outline of a landmass. Every hex edge with water on the far side becomes one
 * segment. Corner `i` and corner `i + 1` bound the edge towards neighbour `i`.
 */
const coastlinePath = (cells: readonly TAxial[], isLand: (q: number, r: number) => boolean) => {
  const parts: string[] = [];

  for (const cell of cells) {
    const centre = hexToPoint(cell);

    HEX_DIRECTIONS.forEach((offset, edge) => {
      if (isLand(cell.q + offset.q, cell.r + offset.r)) {
        return;
      }

      const from = HEX_CORNERS[edge]!;
      const to = HEX_CORNERS[(edge + 1) % 6]!;

      parts.push(
        `M${(centre.x + from.x).toFixed(2)} ${(centre.y + from.y).toFixed(2)}` +
          `L${(centre.x + to.x).toFixed(2)} ${(centre.y + to.y).toFixed(2)}`
      );
    });
  }

  return parts.join("");
};

const keyOf = (hex: TAxial) => hexKey(hex.q, hex.r);

/** Direction labels for the island engine, clockwise from "east". */
const DIRECTION_LABELS: readonly string[] = ["В", "ЮВ", "ЮЗ", "З", "СЗ", "СВ"];

export type { TPoint };
export { DIRECTION_LABELS, HEX_CORNERS, HEX_SIZE, axialToOffsetX, coastlinePath, hexPolygonPoints, hexToPoint, keyOf, offsetToAxial };
