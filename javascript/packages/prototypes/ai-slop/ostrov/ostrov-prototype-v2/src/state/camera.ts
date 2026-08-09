import { config } from "@hw/ostrov-prototype-v2-config";
import type { Point } from "../hex/layout";
import type { Rect } from "../map/world";

type Camera = {
  /** World point parked at the centre of the viewport. */
  x: number;
  y: number;
  scale: number;
};

/** Size of the map canvas in CSS pixels. Everything screen-space is measured in it. */
type Viewport = {
  width: number;
  height: number;
};

const MIN_SCALE = config.camera.minScale;
const MAX_SCALE = config.camera.maxScale;

/** How much empty space past the world edge the camera is still allowed to show. */
const BOUND_MARGIN = config.camera.boundMargin;

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

function clampAxis(value: number, low: number, high: number, half: number): number {
  // Once the viewport is wider than the world plus its margin there is no room
  // to pan at all, so the camera parks in the middle instead of snapping to an
  // edge and leaving the world lopsided.
  if (high - low <= half * 2) {
    return (low + high) / 2;
  }
  return Math.min(high - half, Math.max(low + half, value));
}

/**
 * Keeps the viewport over the world.
 *
 * The clamp is written on the camera centre rather than on the pan step, so it
 * gives the same answer whoever moved the camera — a drag, a glide, a pinch or
 * an eased wheel zoom — and applying it twice changes nothing. The scale is left
 * alone: zooming out never has to be refused, it only pulls the centre in.
 */
function clampCamera(camera: Camera, bounds: Rect, viewport: Viewport): Camera {
  if (viewport.width <= 0 || viewport.height <= 0 || !Number.isFinite(bounds.minX)) {
    return camera;
  }
  const halfWidth = viewport.width / (2 * camera.scale);
  const halfHeight = viewport.height / (2 * camera.scale);
  const x = clampAxis(camera.x, bounds.minX - BOUND_MARGIN, bounds.maxX + BOUND_MARGIN, halfWidth);
  const y = clampAxis(camera.y, bounds.minY - BOUND_MARGIN, bounds.maxY + BOUND_MARGIN, halfHeight);
  if (x === camera.x && y === camera.y) {
    return camera;
  }
  return { x, y, scale: camera.scale };
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

export type { Camera, Viewport };
export { BOUND_MARGIN, MAX_SCALE, MIN_SCALE, clampCamera, clampScale, screenToWorld, worldToScreen, zoomAt };
