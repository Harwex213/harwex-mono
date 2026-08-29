import { roundAxial } from "./coords";
import type { TAxial } from "./coords";

/**
 * Pixel geometry of a pointy-top hex lattice. Lengths are world pixels at the
 * current hex size; the canvas adds only a translation on top.
 */

const SQRT3 = Math.sqrt(3);

type TPoint = {
  x: number;
  y: number;
};

type TRect = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};

/** Corner `i` of a pointy-top hex sits at `60 * i - 30` degrees. */
const HEX_CORNER_ANGLES: readonly number[] = [0, 1, 2, 3, 4, 5].map((index) => (Math.PI / 180) * (60 * index - 30));

const hexWidth = (size: number): number => SQRT3 * size;

const hexHeight = (size: number): number => 2 * size;

/** Centre of a tile, relative to the centre of tile `0,0`. */
const axialToPixel = (cell: TAxial, size: number): TPoint => ({
  x: size * SQRT3 * (cell.q + cell.r / 2),
  y: size * 1.5 * cell.r,
});

/** Inverse of `axialToPixel`, rounded to the tile that contains the point. */
const pixelToAxial = (x: number, y: number, size: number): TAxial => {
  const q = ((SQRT3 / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;

  return roundAxial(q, r);
};

/** The bounding box of a set of tiles, padded by `padding` world pixels. */
const boundsOfCells = (cells: readonly TAxial[], size: number, padding: number): TRect => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const cell of cells) {
    const centre = axialToPixel(cell, size);
    minX = Math.min(minX, centre.x - hexWidth(size) / 2);
    minY = Math.min(minY, centre.y - hexHeight(size) / 2);
    maxX = Math.max(maxX, centre.x + hexWidth(size) / 2);
    maxY = Math.max(maxY, centre.y + hexHeight(size) / 2);
  }

  return {
    minX: minX - padding,
    minY: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
};

/** Adds the corners of a hex to the current canvas path. */
const traceHex = (context: CanvasRenderingContext2D, centre: TPoint, size: number): void => {
  context.beginPath();
  for (let corner = 0; corner < HEX_CORNER_ANGLES.length; corner += 1) {
    const angle = HEX_CORNER_ANGLES[corner]!;
    const x = centre.x + size * Math.cos(angle);
    const y = centre.y + size * Math.sin(angle);
    if (corner === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }
  context.closePath();
};

/** The two endpoints of the edge shared with neighbour `direction`. */
const hexEdge = (centre: TPoint, size: number, direction: number): [TPoint, TPoint] => {
  const first = HEX_CORNER_ANGLES[direction]!;
  const second = HEX_CORNER_ANGLES[(direction + 1) % 6]!;

  return [
    { x: centre.x + size * Math.cos(first), y: centre.y + size * Math.sin(first) },
    { x: centre.x + size * Math.cos(second), y: centre.y + size * Math.sin(second) },
  ];
};

export type { TPoint, TRect };
export { HEX_CORNER_ANGLES, axialToPixel, boundsOfCells, hexEdge, hexHeight, hexWidth, pixelToAxial, traceHex };
