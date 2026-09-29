// Where things sit in the generated studio plate (src/assets/studio.png, 1536x1024).
// All values are image UV: x and y in 0..1, y grows downward.
// Measured on the pixels: the glass is pure black (max RGB 2), axis-aligned,
// inside a thin gunmetal bevel and a crimson neon line.

import type { Vec2 } from "./homography";

const IMAGE_WIDTH = 1536;
const IMAGE_HEIGHT = 1024;

function px(x: number, y: number): Vec2 {
  return [x / IMAGE_WIDTH, y / IMAGE_HEIGHT];
}

// Corners of the black glass: top-left, top-right, bottom-right, bottom-left.
const SCREEN_CORNERS: [Vec2, Vec2, Vec2, Vec2] = [
  px(357.5, 136.5),
  px(1179, 136.5),
  px(1179, 526.5),
  px(357.5, 526.5),
];

const SCREEN_PIXEL_WIDTH = 1179 - 357.5;
const SCREEN_PIXEL_HEIGHT = 526.5 - 136.5;

// The floor mirrors the screen wall about the hidden wall-floor seam behind the plinth.
const MIRROR_Y = 596 / IMAGE_HEIGHT;
// First row of visible floor in front of the plinth.
const FLOOR_Y = 620 / IMAGE_HEIGHT;

// Vertical red neon LED lines on the side walls, left to right.
// top/bottom: the lit blade; reflectTop/reflectBottom: its streak in the polished floor.
type NeonBlade = {
  x: number;
  top: number;
  bottom: number;
  halfWidth: number;
  reflectTop: number;
  reflectBottom: number;
};

function blade(x: number, top: number, bottom: number, halfWidth: number, reflectTop: number, reflectBottom: number): NeonBlade {
  return {
    x: x / IMAGE_WIDTH,
    top: top / IMAGE_HEIGHT,
    bottom: bottom / IMAGE_HEIGHT,
    halfWidth: halfWidth / IMAGE_HEIGHT,
    reflectTop: reflectTop / IMAGE_HEIGHT,
    reflectBottom: reflectBottom / IMAGE_HEIGHT,
  };
}

// The outer blade on each wall is two separate LED lines 6 px apart, each with its own reflection.
const NEON_BLADES: NeonBlade[] = [
  blade(72.5, 98, 507, 2.5, 746, 999),
  blade(79, 102, 505, 2, 802, 1019),
  blade(236.5, 181, 516, 3.5, 697, 937),
  blade(1299, 181, 515, 3.5, 697, 955),
  blade(1456, 99, 504, 2, 787, 1019),
  blade(1462.5, 99, 508, 2.5, 747, 1008),
];
// Paper lanterns hanging on the side walls: body with caps (x0, y0, x1, y1) and the point
// where the cord meets the beam, which is the pivot of the sway.
type Lantern = {
  box: [number, number, number, number];
  pivot: Vec2;
};

function lantern(x0: number, y0: number, x1: number, y1: number, px0: number, py0: number): Lantern {
  return { box: [x0 / IMAGE_WIDTH, y0 / IMAGE_HEIGHT, x1 / IMAGE_WIDTH, y1 / IMAGE_HEIGHT], pivot: px(px0, py0) };
}

const LANTERNS: Lantern[] = [
  lantern(115, 65, 169, 212, 142, 30),
  lantern(242, 188, 275, 284, 258, 150),
  lantern(1260, 188, 1294, 284, 1277, 150),
  lantern(1367, 65, 1421, 212, 1394, 30),
];

// Eye-level line of the one-point perspective; lays fog and pools onto the floor plane.
const HORIZON_Y = 0.4;

export type { Lantern, NeonBlade };

export {
  LANTERNS,
  NEON_BLADES,
  HORIZON_Y,
  IMAGE_WIDTH,
  IMAGE_HEIGHT,
  SCREEN_CORNERS,
  SCREEN_PIXEL_WIDTH,
  SCREEN_PIXEL_HEIGHT,
  MIRROR_Y,
  FLOOR_Y,
};
