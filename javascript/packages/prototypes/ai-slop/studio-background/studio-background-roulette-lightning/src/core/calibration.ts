// Where things sit in a background plate. A plate is measured in its own pixels (y grows downward);
// calibrate() turns the measurements into image UV (x and y in 0..1), which the shaders use.

import type { Vec2 } from "./homography";

// A tall lamp on the set: its glass (x0, y0, x1, y1) and the row where it stands on the floor.
// The lamp's reflection in the floor is the lamp flipped about that row.
type LampSpec = {
  box: [number, number, number, number];
  base: number;
};

// Measurements of one plate, in plate pixels.
type PlateSpec = {
  width: number;
  height: number;
  // Pixel edges of the glass that the TV replaces. The glass is axis-aligned.
  glass: { left: number; right: number; top: number; bottom: number };
  // The frame step in every corner of the glass: width and height. [0, 0] for a plain rectangle.
  notch: Vec2;
  // The seam between the back wall and the floor. The back wall faces the camera, so its
  // reflection in the floor is the wall flipped about this row.
  mirrorY: number;
  // First row of visible floor.
  floorY: number;
  // Vanishing point of the floor lines. The horizon runs through it.
  vanish: Vec2;
  lamps: LampSpec[];
};

type Lamp = {
  box: [number, number, number, number];
  base: number;
};

// The same measurements in image UV.
type Calibration = {
  imageWidth: number;
  imageHeight: number;
  imageAspect: number;
  // Corners of the glass: top-left, top-right, bottom-right, bottom-left.
  screenCorners: [Vec2, Vec2, Vec2, Vec2];
  screenPixelWidth: number;
  // The corner step in screen UV.
  notch: Vec2;
  mirrorY: number;
  floorY: number;
  horizonY: number;
  vanish: Vec2;
  lamps: Lamp[];
};

function calibrate(spec: PlateSpec): Calibration {
  const { width, height, glass } = spec;
  const px = (x: number, y: number): Vec2 => [x / width, y / height];
  const glassWidth = glass.right - glass.left;
  const glassHeight = glass.bottom - glass.top;
  return {
    imageWidth: width,
    imageHeight: height,
    imageAspect: width / height,
    screenCorners: [
      px(glass.left, glass.top),
      px(glass.right, glass.top),
      px(glass.right, glass.bottom),
      px(glass.left, glass.bottom),
    ],
    screenPixelWidth: glassWidth,
    notch: [spec.notch[0] / glassWidth, spec.notch[1] / glassHeight],
    mirrorY: spec.mirrorY / height,
    floorY: spec.floorY / height,
    horizonY: spec.vanish[1] / height,
    vanish: px(spec.vanish[0], spec.vanish[1]),
    lamps: spec.lamps.map((entry) => ({
      box: [entry.box[0] / width, entry.box[1] / height, entry.box[2] / width, entry.box[3] / height],
      base: entry.base / height,
    })),
  };
}

export type { Calibration, Lamp, LampSpec, PlateSpec };

export { calibrate };
