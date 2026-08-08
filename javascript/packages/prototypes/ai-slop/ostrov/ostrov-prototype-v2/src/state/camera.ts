import type { Point } from "../hex/layout";

type Camera = {
  /** World point parked at the centre of the viewport. */
  x: number;
  y: number;
  scale: number;
};

const MIN_SCALE = 0.4;
const MAX_SCALE = 4;

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function screenToWorld(camera: Camera, width: number, height: number, px: number, py: number): Point {
  return {
    x: (px - width / 2) / camera.scale + camera.x,
    y: (py - height / 2) / camera.scale + camera.y,
  };
}

function worldToScreen(camera: Camera, width: number, height: number, wx: number, wy: number): Point {
  return {
    x: (wx - camera.x) * camera.scale + width / 2,
    y: (wy - camera.y) * camera.scale + height / 2,
  };
}

/** Zooms so that the world point under (`px`, `py`) stays under (`px`, `py`). */
function zoomAt(camera: Camera, width: number, height: number, px: number, py: number, factor: number): Camera {
  const scale = clampScale(camera.scale * factor);
  if (scale === camera.scale) {
    return camera;
  }
  const anchor = screenToWorld(camera, width, height, px, py);
  return {
    x: anchor.x - (px - width / 2) / scale,
    y: anchor.y - (py - height / 2) / scale,
    scale,
  };
}

export type { Camera };
export { MAX_SCALE, MIN_SCALE, clampScale, screenToWorld, worldToScreen, zoomAt };
