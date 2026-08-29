import { axialToOffset, roundAxial } from "./coords";
import type { TOffset } from "./coords";

const SQRT3 = Math.sqrt(3);

type TPoint = {
  x: number;
  y: number;
};

/** Corner `i` of a pointy-top hex sits at `60 * i - 30` degrees. */
const HEX_CORNER_ANGLES: readonly number[] = [0, 1, 2, 3, 4, 5].map((index) => (Math.PI / 180) * (60 * index - 30));

/** Full width of one hex, given its circumradius `size`. */
const hexWidth = (size: number): number => SQRT3 * size;

/** Full height of one hex, given its circumradius `size`. */
const hexHeight = (size: number): number => 2 * size;

/** Pixel size of the whole `width` by `height` rectangle of hexes. */
const mapPixelSize = (width: number, height: number, size: number): TPoint => ({
  x: hexWidth(size) * (width + 0.5),
  y: 1.5 * size * (height - 1) + hexHeight(size),
});

/** Centre of an offset tile in pixel space. */
const offsetToPixel = (col: number, row: number, size: number): TPoint => ({
  x: hexWidth(size) * (col + 0.5 * (row & 1) + 0.5),
  y: 1.5 * size * row + size,
});

/** Inverse of `offsetToPixel`, rounded to the containing tile. */
const pixelToOffset = (x: number, y: number, size: number): TOffset => {
  const localX = x - hexWidth(size) * 0.5;
  const localY = y - size;
  const q = ((SQRT3 / 3) * localX - (1 / 3) * localY) / size;
  const r = ((2 / 3) * localY) / size;
  const axial = roundAxial(q, r);

  return axialToOffset(axial.q, axial.r);
};

export type { TPoint };
export { HEX_CORNER_ANGLES, hexHeight, hexWidth, mapPixelSize, offsetToPixel, pixelToOffset };
