// Where things sit in the studio plate (src/assets/studio.png, 2000x1131, black-and-gold hall).
// All values are image UV: x and y in 0..1, y grows downward.
// Measured on the pixels: the glass is a dark matte panel, axis-aligned, inside two thin
// gold lines (x 494/499, 1499/1504; y 267/273, 762/768) and a warm halo.

import type { Vec2 } from "./homography";

const IMAGE_WIDTH = 2000;
const IMAGE_HEIGHT = 1131;

function px(x: number, y: number): Vec2 {
  return [x / IMAGE_WIDTH, y / IMAGE_HEIGHT];
}

// Corners of the glass: top-left, top-right, bottom-right, bottom-left.
const SCREEN_CORNERS: [Vec2, Vec2, Vec2, Vec2] = [
  px(501.5, 273.5),
  px(1496.5, 273.5),
  px(1496.5, 761.5),
  px(501.5, 761.5),
];

const SCREEN_PIXEL_WIDTH = 1496.5 - 501.5;
const SCREEN_PIXEL_HEIGHT = 761.5 - 273.5;

// The floor mirrors the screen wall about the wall-floor seam under the halo strip.
const MIRROR_Y = 804 / IMAGE_HEIGHT;
// The first gold inlay line of the floor.
const FLOOR_Y = 808 / IMAGE_HEIGHT;

// Vanishing point of the floor inlay lines, found by fitting rays to the diagonal gold lines.
const FLOOR_VANISH: Vec2 = px(997.5, 617);

// Eye-level line of the one-point perspective; lays fog onto the floor plane.
const HORIZON_Y = 617 / IMAGE_HEIGHT;

// The gold cove light along the ceiling coffers ends at this row; below it, gold is metal, not a lamp.
const COVE_BOTTOM_Y = 215 / IMAGE_HEIGHT;

// The warm halo that frames the glass: outer edge of the glow, x0, y0, x1, y1.
const HALO_RECT: [number, number, number, number] = [
  470 / IMAGE_WIDTH,
  235 / IMAGE_HEIGHT,
  1528 / IMAGE_WIDTH,
  800 / IMAGE_HEIGHT,
];

// Fluted columns: the shaft between capital and base, x0, top, x1, bottom; and the row where
// the base meets the floor, which is the mirror line of the column's floor reflection.
// Order: left front, left inner, right inner, right front.
type Pillar = {
  shaft: [number, number, number, number];
  floorY: number;
};

function pillar(x0: number, top: number, x1: number, bottom: number, floorY: number): Pillar {
  return {
    shaft: [x0 / IMAGE_WIDTH, top / IMAGE_HEIGHT, x1 / IMAGE_WIDTH, bottom / IMAGE_HEIGHT],
    floorY: floorY / IMAGE_HEIGHT,
  };
}

const PILLARS: Pillar[] = [
  pillar(198, 148, 297, 795, 873),
  pillar(420, 280, 471, 755, 852),
  pillar(1528, 280, 1582, 755, 852),
  pillar(1702, 148, 1802, 795, 873),
];

// Recessed downlights in the cove fascia, centre in plate pixels.
const DOWNLIGHTS: Vec2[] = [
  px(393, 58),
  px(1603, 58),
  px(473.5, 134),
  px(1524.5, 134),
  px(379.5, 165.5),
  px(1618.5, 166),
];

export type { Pillar };

export {
  DOWNLIGHTS,
  PILLARS,
  COVE_BOTTOM_Y,
  FLOOR_VANISH,
  HALO_RECT,
  HORIZON_Y,
  IMAGE_WIDTH,
  IMAGE_HEIGHT,
  SCREEN_CORNERS,
  SCREEN_PIXEL_WIDTH,
  SCREEN_PIXEL_HEIGHT,
  MIRROR_Y,
  FLOOR_Y,
};
