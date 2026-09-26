import { HEX_SIZE_PX, hexToPixel } from "../../core/exports";
import type { TIsland } from "../../core/exports";
import type { TCamera, TScreenPoint } from "../../store/ui-state";

/**
 * The screen↔world contract of the island canvas (plan §4.4, the
 * `fantasy-map-light` recipe). `camera.x` and `camera.y` are the world point
 * sitting at the centre of the canvas, `camera.scale` is screen pixels per
 * world pixel.
 *
 * Every function here is pure and touches the camera only. The hexes never
 * move: zooming is display, not data.
 */

type TViewport = {
  readonly width: number;
  readonly height: number;
};

type TWorldPoint = {
  readonly x: number;
  readonly y: number;
};

/** The world-space box the island occupies, already padded by one hex. */
type TWorldBounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

const MIN_SCALE = 0.4;
const MAX_SCALE = 3;

/** Empty space left around the island by `fitIsland`, in screen pixels. */
const FIT_PADDING_PX = 96;

/**
 * The bottom band the resources panel, the buildings panel and the end-turn
 * medallion occupy. `fitIsland` keeps the island out of it.
 */
const FIT_BOTTOM_RESERVE_PX = 168;

/**
 * How far the camera centre may travel past the island, as a share of the
 * half-screen. At `0.5` a quarter of the screen still shows island.
 */
const CAMERA_SLACK_RATIO = 0.5;

const HALF = 2;
const EMPTY_BOUNDS: TWorldBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

const clampScale = (scale: number): number => {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
};

const clampNumber = (value: number, low: number, high: number): number => {
  if (low > high) {
    return (low + high) / HALF;
  }

  return Math.min(high, Math.max(low, value));
};

const worldToScreen = (world: TWorldPoint, camera: TCamera, viewport: TViewport): TScreenPoint => {
  return {
    x: (world.x - camera.x) * camera.scale + viewport.width / HALF,
    y: (world.y - camera.y) * camera.scale + viewport.height / HALF,
  };
};

const screenToWorld = (screen: TScreenPoint, camera: TCamera, viewport: TViewport): TWorldPoint => {
  return {
    x: (screen.x - viewport.width / HALF) / camera.scale + camera.x,
    y: (screen.y - viewport.height / HALF) / camera.scale + camera.y,
  };
};

/** The island box in world pixels, grown by one hex so the border glow fits. */
const islandBounds = (island: TIsland): TWorldBounds => {
  const hexes = Object.values(island.hexes);
  if (hexes.length === 0) {
    return EMPTY_BOUNDS;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const hex of hexes) {
    const centre = hexToPixel(hex.q, hex.r, HEX_SIZE_PX);
    minX = Math.min(minX, centre.x);
    minY = Math.min(minY, centre.y);
    maxX = Math.max(maxX, centre.x);
    maxY = Math.max(maxY, centre.y);
  }

  return {
    minX: minX - HEX_SIZE_PX,
    minY: minY - HEX_SIZE_PX,
    maxX: maxX + HEX_SIZE_PX,
    maxY: maxY + HEX_SIZE_PX,
  };
};

/** Holds the scale in range and keeps the island from flying off the screen. */
const clampCamera = (camera: TCamera, bounds: TWorldBounds, viewport: TViewport): TCamera => {
  const scale = clampScale(camera.scale);
  const slackX = (viewport.width / (HALF * scale)) * CAMERA_SLACK_RATIO;
  const slackY = (viewport.height / (HALF * scale)) * CAMERA_SLACK_RATIO;

  return {
    x: clampNumber(camera.x, bounds.minX - slackX, bounds.maxX + slackX),
    y: clampNumber(camera.y, bounds.minY - slackY, bounds.maxY + slackY),
    scale,
  };
};

/**
 * Zoom around a point on the screen: the world point under the cursor stays
 * exactly where it was.
 */
const zoomAt = (
  camera: TCamera,
  screenPoint: TScreenPoint,
  factor: number,
  viewport: TViewport,
  bounds: TWorldBounds,
): TCamera => {
  const anchor = screenToWorld(screenPoint, camera, viewport);
  const scale = clampScale(camera.scale * factor);
  const zoomed: TCamera = {
    x: anchor.x - (screenPoint.x - viewport.width / HALF) / scale,
    y: anchor.y - (screenPoint.y - viewport.height / HALF) / scale,
    scale,
  };

  return clampCamera(zoomed, bounds, viewport);
};

/** Contain-centring: the whole island, plus padding, inside the viewport. */
const fitIsland = (island: TIsland, viewport: TViewport): TCamera => {
  const bounds = islandBounds(island);
  const worldWidth = Math.max(1, bounds.maxX - bounds.minX);
  const worldHeight = Math.max(1, bounds.maxY - bounds.minY);
  const usableWidth = Math.max(1, viewport.width - FIT_PADDING_PX);
  const usableHeight = Math.max(1, viewport.height - FIT_PADDING_PX - FIT_BOTTOM_RESERVE_PX);
  const scale = clampScale(Math.min(usableWidth / worldWidth, usableHeight / worldHeight));

  // The island is centred in the free area, which sits above the HUD band.
  return {
    x: (bounds.minX + bounds.maxX) / HALF,
    y: (bounds.minY + bounds.maxY) / HALF + FIT_BOTTOM_RESERVE_PX / (HALF * scale),
    scale,
  };
};

export type { TViewport, TWorldBounds, TWorldPoint };

export {
  MAX_SCALE,
  MIN_SCALE,
  clampCamera,
  fitIsland,
  islandBounds,
  screenToWorld,
  worldToScreen,
  zoomAt,
};
