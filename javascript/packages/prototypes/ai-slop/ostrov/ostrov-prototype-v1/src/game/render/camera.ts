import { OCEAN, WORLD_H, WORLD_W } from "../config";

type Camera = {
  /** World point at the centre of the viewport. */
  x: number;
  y: number;
  zoom: number;
};

const MIN_ZOOM = 0.45;
const MAX_ZOOM = 2.2;

function createCamera(x: number, y: number): Camera {
  return { x, y, zoom: 1 };
}

function clampCamera(camera: Camera): void {
  camera.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom));
  camera.x = Math.min(WORLD_W + OCEAN, Math.max(-OCEAN, camera.x));
  camera.y = Math.min(WORLD_H + OCEAN, Math.max(-OCEAN, camera.y));
}

function screenToWorld(camera: Camera, viewW: number, viewH: number, sx: number, sy: number): { x: number; y: number } {
  return {
    x: (sx - viewW / 2) / camera.zoom + camera.x,
    y: (sy - viewH / 2) / camera.zoom + camera.y,
  };
}

function zoomAt(camera: Camera, viewW: number, viewH: number, sx: number, sy: number, factor: number): void {
  const before = screenToWorld(camera, viewW, viewH, sx, sy);
  camera.zoom *= factor;
  clampCamera(camera);
  const after = screenToWorld(camera, viewW, viewH, sx, sy);
  camera.x += before.x - after.x;
  camera.y += before.y - after.y;
  clampCamera(camera);
}

export type { Camera };
export { clampCamera, createCamera, screenToWorld, zoomAt };
