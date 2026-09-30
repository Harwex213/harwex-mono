// A background plate on the GPU: the photo, its light masks, and where the glass sits in it.

import type { Calibration } from "./calibration";
import { createDataTexture, createTexture, loadImage } from "./gl";
import { invert, squareToQuad, toColumnMajor } from "./homography";
import type { PlateMasks } from "./masks";

type Plate = {
  calibration: Calibration;
  image: WebGLTexture;
  masks: WebGLTexture;
  // Image UV to screen UV.
  toScreen: Float32Array;
  // Lamp boxes, 4 floats each, and the row each lamp stands on.
  lamps: Float32Array;
  lampBases: Float32Array;
};

type MaskBuilder = (plate: HTMLImageElement, calibration: Calibration) => PlateMasks;

async function loadPlate(gl: WebGL2RenderingContext, url: string, calibration: Calibration, buildMasks: MaskBuilder): Promise<Plate> {
  const image = await loadImage(url);
  return createPlate(gl, image, calibration, buildMasks(image, calibration));
}

// For a brand that derives more than the masks from the photo: it loads the image itself.
function createPlate(gl: WebGL2RenderingContext, image: HTMLImageElement, calibration: Calibration, masks: PlateMasks): Plate {
  return {
    calibration,
    image: createTexture(gl, image),
    masks: createDataTexture(gl, masks.data, masks.width, masks.height),
    toScreen: toColumnMajor(invert(squareToQuad(...calibration.screenCorners))),
    lamps: new Float32Array(calibration.lamps.flatMap((entry) => entry.box)),
    lampBases: new Float32Array(calibration.lamps.map((entry) => entry.base)),
  };
}

// Cover-fit the plate into the canvas: offset and scale from canvas UV to image UV.
function cover(calibration: Calibration, width: number, height: number): [number, number, number, number] {
  const canvasAspect = width / height;
  if (canvasAspect > calibration.imageAspect) {
    const sy = calibration.imageAspect / canvasAspect;
    return [0, (1 - sy) / 2, 1, sy];
  }
  const sx = canvasAspect / calibration.imageAspect;
  return [(1 - sx) / 2, 0, sx, 1];
}

// Width in canvas pixels that the glass covers.
function glassWidth(calibration: Calibration, width: number, height: number): number {
  const [, , sx] = cover(calibration, width, height);
  return (calibration.screenPixelWidth / calibration.imageWidth / sx) * width;
}

export type { MaskBuilder, Plate };

export { cover, createPlate, glassWidth, loadPlate };
