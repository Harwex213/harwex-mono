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

export {
  IMAGE_WIDTH,
  IMAGE_HEIGHT,
  SCREEN_CORNERS,
  SCREEN_PIXEL_WIDTH,
  SCREEN_PIXEL_HEIGHT,
  MIRROR_Y,
  FLOOR_Y,
};
