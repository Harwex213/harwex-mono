// Where things sit in the studio plate (src/assets/studio.jpg, from art/references/reference-2.png, 2688x1520).
// All values are image UV: x and y in 0..1, y grows downward.
// Measured on the pixels: the glass is dark blue marble, axis-aligned, inside a gold frame whose
// inner line steps into each corner. The screen replaces the glass pixels; the steps stay.

import type { Vec2 } from "./homography";

const IMAGE_WIDTH = 2688;
const IMAGE_HEIGHT = 1520;

function px(x: number, y: number): Vec2 {
  return [x / IMAGE_WIDTH, y / IMAGE_HEIGHT];
}

// Corners of the black glass: top-left, top-right, bottom-right, bottom-left.
// Pixel edges, inside the dark groove that runs along the gold line.
const GLASS_LEFT = 757;
const GLASS_RIGHT = 1903;
const GLASS_TOP = 361;
const GLASS_BOTTOM = 1015;

const SCREEN_CORNERS: [Vec2, Vec2, Vec2, Vec2] = [
  px(GLASS_LEFT, GLASS_TOP),
  px(GLASS_RIGHT, GLASS_TOP),
  px(GLASS_RIGHT, GLASS_BOTTOM),
  px(GLASS_LEFT, GLASS_BOTTOM),
];

const SCREEN_PIXEL_WIDTH = GLASS_RIGHT - GLASS_LEFT;
const SCREEN_PIXEL_HEIGHT = GLASS_BOTTOM - GLASS_TOP;

// The gold step in every corner of the glass, in screen UV: width and height.
const CORNER_NOTCH: Vec2 = [9 / SCREEN_PIXEL_WIDTH, 12 / SCREEN_PIXEL_HEIGHT];

// The seam between the back wall and the marble floor. The back wall faces the camera, so
// its reflection in the floor is the wall flipped about this line.
const MIRROR_Y = 1116 / IMAGE_HEIGHT;
// First row of visible floor.
const FLOOR_Y = 1118 / IMAGE_HEIGHT;

// Vanishing point of the floor lines, fitted to the gold inlay lines and the skirting LEDs.
const FLOOR_VANISH: Vec2 = px(1332, 928);

// Eye-level line of the one-point perspective, through the vanishing point.
const HORIZON_Y = 928 / IMAGE_HEIGHT;

// The four tall frosted lamps on the columns: the glass (x0, y0, x1, y1) and the row where the
// column stands on the floor. The lamp's reflection in the marble is the lamp flipped about that row.
type Lamp = {
  box: [number, number, number, number];
  base: number;
};

function lamp(x0: number, y0: number, x1: number, y1: number, base: number): Lamp {
  return { box: [x0 / IMAGE_WIDTH, y0 / IMAGE_HEIGHT, x1 / IMAGE_WIDTH, y1 / IMAGE_HEIGHT], base: base / IMAGE_HEIGHT };
}

const LAMPS: Lamp[] = [
  lamp(108, 280, 162, 910, 1044),
  lamp(612, 455, 680, 950, 1046),
  lamp(1984, 455, 2052, 950, 1046),
  lamp(2500, 280, 2554, 910, 1044),
];

// LED strips run along the base of the walls and the back step (this band of rows), and along
// the ceiling coves (above CEILING_Y). Rows in plate pixels.
const LED_BAND: [number, number] = [1035, 1330];
const CEILING_Y = 330;

export type { Lamp };

export {
  CEILING_Y,
  CORNER_NOTCH,
  FLOOR_VANISH,
  LAMPS,
  LED_BAND,
  FLOOR_Y,
  HORIZON_Y,
  IMAGE_HEIGHT,
  IMAGE_WIDTH,
  MIRROR_Y,
  SCREEN_CORNERS,
  SCREEN_PIXEL_HEIGHT,
  SCREEN_PIXEL_WIDTH,
};
