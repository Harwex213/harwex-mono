// Where things sit in the art-deco studio plate (src/assets/plate.png, 2000x1131).
// All values are image UV: x and y in 0..1, y grows downward.
// Measured on the pixels: the video wall is a dark panel inside two gold lines.
// The outer line is the frame; the inner hairline is the bezel of the glass.

import type { Vec2 } from "./homography";

const IMAGE_WIDTH = 2000;
const IMAGE_HEIGHT = 1131;

function px(x: number, y: number): Vec2 {
  return [x / IMAGE_WIDTH, y / IMAGE_HEIGHT];
}

// Corners of the glass inside the inner hairline: top-left, top-right, bottom-right, bottom-left.
// The hairline centres are at x 505.5 / 1492.5 and y 237.5 / 740.5.
const SCREEN_CORNERS: [Vec2, Vec2, Vec2, Vec2] = [
  px(507.5, 239.5),
  px(1491, 239.5),
  px(1491, 739),
  px(507.5, 739),
];

const SCREEN_PIXEL_WIDTH = 1491 - 507.5;
const SCREEN_PIXEL_HEIGHT = 739 - 239.5;

// The floor mirrors the TV wall about the line where that wall meets the floor. The plinth steps
// stand in front of the wall and hide that line; it sits above their foot at y 803.
const MIRROR_Y = 778 / IMAGE_HEIGHT;
// First row of visible floor in front of the plinth.
const FLOOR_Y = 806 / IMAGE_HEIGHT;

// Vanishing point of the one-point perspective, where the two gold ceiling coves meet.
const FLOOR_VANISH: Vec2 = px(999, 532);

// Eye-level line of the perspective; lays haze onto the floor plane.
const HORIZON_Y = 532 / IMAGE_HEIGHT;

// Fluted gold-and-black columns, left to right. The shaft is the fluted part between the capital
// and the base, where the arcs crawl; the column box also covers the capital and the base rings,
// which catch the light. baseY is the foot of the column, where the floor mirrors it.
type Pillar = {
  shaft: [number, number, number, number];
  column: [number, number, number, number];
  baseY: number;
};

function pillar(sx0: number, sy0: number, sx1: number, sy1: number, cx0: number, cy0: number, cx1: number, cy1: number, baseY: number): Pillar {
  return {
    shaft: [sx0 / IMAGE_WIDTH, sy0 / IMAGE_HEIGHT, sx1 / IMAGE_WIDTH, sy1 / IMAGE_HEIGHT],
    column: [cx0 / IMAGE_WIDTH, cy0 / IMAGE_HEIGHT, cx1 / IMAGE_WIDTH, cy1 / IMAGE_HEIGHT],
    baseY: baseY / IMAGE_HEIGHT,
  };
}

const PILLARS: Pillar[] = [
  pillar(8, 80, 124, 800, 0, 0, 132, 945, 945),
  pillar(332, 205, 400, 715, 322, 130, 415, 840, 840),
  pillar(1597, 205, 1668, 715, 1585, 130, 1676, 840, 840),
  pillar(1874, 80, 1994, 800, 1862, 0, 2000, 945, 945),
];

// Recessed ceiling downlights, measured as the centroid of their white-hot pixels.
const DOWNLIGHTS: Vec2[] = [px(454.3, 45.7), px(556.1, 137.2), px(1441.4, 137.4), px(1542.2, 45.7)];

// The ceiling cove LED strips (the gold V over the room and the line above the TV) sit inside
// these boxes (x0, y0, x1, y1). Only lit pixels inside them count as LEDs: bright gold
// elsewhere is a reflection, not a light.
const LED_ZONES: [number, number, number, number][] = [
  [470 / IMAGE_WIDTH, 0, 1530 / IMAGE_WIDTH, 160 / IMAGE_HEIGHT],
  [520 / IMAGE_WIDTH, 219 / IMAGE_HEIGHT, 1480 / IMAGE_WIDTH, 234 / IMAGE_HEIGHT],
];

// LED line of the TV frame: the outer gold line, centre and half size in plate pixels.
// The inner hairline of the bezel runs 8 px inside it.
const FRAME_LED = { centre: [999, 488.5] as Vec2, halfSize: [502, 259.5] as Vec2, hairlineInset: 8 };

export type { Pillar };

export {
  DOWNLIGHTS,
  FRAME_LED,
  LED_ZONES,
  PILLARS,
  FLOOR_VANISH,
  HORIZON_Y,
  IMAGE_WIDTH,
  IMAGE_HEIGHT,
  SCREEN_CORNERS,
  SCREEN_PIXEL_WIDTH,
  SCREEN_PIXEL_HEIGHT,
  MIRROR_Y,
  FLOOR_Y,
};
