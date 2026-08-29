import { hexWidth, mapPixelSize, offsetToPixel, pixelToOffset } from "./layout";
import type { TOffset } from "./coords";
import type { TPoint } from "./layout";

/**
 * The camera looks at a point in *unit world space* — the pixel layout of the map
 * at a hex size of one — and `zoom` is how many screen pixels one of those units
 * is worth. Keeping the camera in unit space means changing the zoom never moves
 * the point the viewer is looking at.
 */
type TCamera = {
  x: number;
  y: number;
  zoom: number;
};

type TViewport = {
  width: number;
  height: number;
};

/** Range of cells that can touch the viewport, with a ring of slack for partial hexes. */
type TVisibleRange = {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
};

/**
 * Smallest and largest hex size the viewer can zoom to, in screen pixels. The
 * floor has to sit under the fit zoom of the biggest map the size control
 * offers, or that map could never be seen whole.
 */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 40;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const screenToWorld = (screenX: number, screenY: number, camera: TCamera, viewport: TViewport): TPoint => ({
  x: (screenX - viewport.width / 2) / camera.zoom + camera.x,
  y: (screenY - viewport.height / 2) / camera.zoom + camera.y,
});

/** Cell under a screen point, or `null` when that point is off the map. */
const cellAtScreen = (
  screenX: number,
  screenY: number,
  camera: TCamera,
  viewport: TViewport,
  width: number,
  height: number
): TOffset | null => {
  const world = screenToWorld(screenX, screenY, camera, viewport);
  const offset = pixelToOffset(world.x, world.y, 1);

  if (offset.col < 0 || offset.col >= width) {
    return null;
  }
  if (offset.row < 0 || offset.row >= height) {
    return null;
  }

  return offset;
};

const cellCentre = (col: number, row: number): TPoint => offsetToPixel(col, row, 1);

/** Zoom at which the whole map just fits the viewport. */
const fitZoom = (width: number, height: number, viewport: TViewport): number => {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return MIN_ZOOM;
  }

  const size = mapPixelSize(width, height, 1);

  return clamp(Math.min(viewport.width / size.x, viewport.height / size.y), MIN_ZOOM, MAX_ZOOM);
};

const mapCentre = (width: number, height: number): TPoint => {
  const size = mapPixelSize(width, height, 1);

  return { x: size.x / 2, y: size.y / 2 };
};

/** Keeps the camera over the map, so the viewer cannot drag the whole thing away. */
const clampCamera = (camera: TCamera, width: number, height: number): TCamera => {
  const size = mapPixelSize(width, height, 1);

  return {
    x: clamp(camera.x, 0, size.x),
    y: clamp(camera.y, 0, size.y),
    zoom: clamp(camera.zoom, MIN_ZOOM, MAX_ZOOM),
  };
};

const visibleRange = (camera: TCamera, viewport: TViewport, width: number, height: number): TVisibleRange => {
  const topLeft = screenToWorld(0, 0, camera, viewport);
  const bottomRight = screenToWorld(viewport.width, viewport.height, camera, viewport);
  const columnWidth = hexWidth(1);

  return {
    minCol: Math.max(0, Math.floor(topLeft.x / columnWidth) - 2),
    maxCol: Math.min(width - 1, Math.ceil(bottomRight.x / columnWidth) + 1),
    minRow: Math.max(0, Math.floor((topLeft.y - 1) / 1.5) - 2),
    maxRow: Math.min(height - 1, Math.ceil((bottomRight.y - 1) / 1.5) + 1),
  };
};

export type { TCamera, TViewport, TVisibleRange };
export {
  MAX_ZOOM,
  MIN_ZOOM,
  cellAtScreen,
  cellCentre,
  clampCamera,
  fitZoom,
  mapCentre,
  screenToWorld,
  visibleRange,
};
