import type { TAxial } from "@hw/ostrov-utils";

/** Distance from a hex centre to a corner, in SVG units. */
const HEX_SIZE = 46;

/** How far the rock wall drops below a top face, in SVG units. */
const HEX_DEPTH = 14;

const SQRT3 = Math.sqrt(3);

/** Corner `i` of a pointy-top hex sits at `60 * i - 30` degrees. */
const HEX_CORNER_ANGLES: readonly number[] = [0, 1, 2, 3, 4, 5].map((index) => {
  return (Math.PI / 180) * (60 * index - 30);
});

type TPoint = {
  x: number;
  y: number;
};

/** Centre of a hex in SVG space. */
const hexToPoint = (hex: TAxial): TPoint => ({
  x: HEX_SIZE * SQRT3 * (hex.q + hex.r / 2),
  y: HEX_SIZE * 1.5 * hex.r,
});

/** The six corners of a hex top face, relative to its centre. */
const HEX_CORNERS: readonly TPoint[] = HEX_CORNER_ANGLES.map((angle) => ({
  x: HEX_SIZE * Math.cos(angle),
  y: HEX_SIZE * Math.sin(angle),
}));

/** Corner list as an SVG `points` attribute, relative to the hex centre. */
const hexPolygonPoints = (scale = 1) => {
  return HEX_CORNERS.map((corner) => `${(corner.x * scale).toFixed(2)},${(corner.y * scale).toFixed(2)}`).join(" ");
};

export type { TPoint };
export { HEX_CORNERS, HEX_DEPTH, HEX_SIZE, hexPolygonPoints, hexToPoint };
