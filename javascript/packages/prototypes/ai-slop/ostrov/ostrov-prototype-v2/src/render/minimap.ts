import type { Point } from "../hex/layout";
import { OWNER_ENEMY, OWNER_PLAYER } from "../map/island";
import type { Island, WorldMap } from "../map/world";
import type { Camera, Viewport } from "../state/camera";
import { BOSS_MARKER, MINIMAP_ENEMY, MINIMAP_NEUTRAL, MINIMAP_PLAYER, withAlpha } from "./palette";

/**
 * The whole world on one small canvas.
 *
 * The projection is uniform and square: the extent it fits is the outer zone
 * radius, taken in both axes, so the zone boundaries stay circles instead of
 * turning into ellipses. World y is already squashed by the hex layout, which is
 * why nothing squashes it again here.
 */

const TAU = Math.PI * 2;

/** Blank ring between the outer zone boundary and the canvas edge, in pixels. */
const EDGE_PAD = 8;

const BACKDROP = "rgba(8, 22, 36, 0.72)";
const ZONE_LINE = "rgba(214, 234, 250, 0.55)";
const ZONE_FILL_WILD = "rgba(120, 170, 210, 0.1)";
const ZONE_FILL_BOSS = "rgba(220, 110, 96, 0.16)";
const VIEWPORT_LINE = "rgba(255, 255, 255, 0.92)";
const VIEWPORT_FILL = "rgba(255, 255, 255, 0.1)";

/** Maps world space onto the minimap canvas and back. */
type Projection = {
  scale: number;
  centreX: number;
  centreY: number;
};

function projectionFor(world: WorldMap, size: number): Projection {
  const extent = Math.max(
    world.zoneRadii.peripheral,
    world.bounds.maxX,
    -world.bounds.minX,
    world.bounds.maxY,
    -world.bounds.minY,
  );
  return {
    scale: (size / 2 - EDGE_PAD) / extent,
    centreX: size / 2,
    centreY: size / 2,
  };
}

function toCanvas(projection: Projection, x: number, y: number): Point {
  return {
    x: projection.centreX + x * projection.scale,
    y: projection.centreY + y * projection.scale,
  };
}

/** Inverse of `toCanvas`: where a click on the minimap lands in the world. */
function toWorld(projection: Projection, x: number, y: number): Point {
  return {
    x: (x - projection.centreX) / projection.scale,
    y: (y - projection.centreY) / projection.scale,
  };
}

function colourOf(island: Island): string {
  if (island.boss) {
    return BOSS_MARKER;
  }
  if (island.owner === OWNER_PLAYER) {
    return MINIMAP_PLAYER;
  }
  if (island.owner === OWNER_ENEMY) {
    return MINIMAP_ENEMY;
  }
  return MINIMAP_NEUTRAL;
}

function strokeCircle(ctx: CanvasRenderingContext2D, projection: Projection, radius: number, dashed: boolean): void {
  ctx.save();
  ctx.setLineDash(dashed ? [5, 4] : []);
  ctx.strokeStyle = ZONE_LINE;
  ctx.lineWidth = dashed ? 1 : 1.4;
  ctx.beginPath();
  ctx.arc(projection.centreX, projection.centreY, radius * projection.scale, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

type MinimapFrame = {
  world: WorldMap;
  camera: Camera;
  viewport: Viewport;
};

function drawMinimap(ctx: CanvasRenderingContext2D, size: number, frame: MinimapFrame): void {
  const { world } = frame;
  const projection = projectionFor(world, size);

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, size, size);

  // Zone washes go down first, largest to smallest, so the middle reads as the
  // hottest part of the map before a single island is drawn.
  ctx.fillStyle = ZONE_FILL_WILD;
  ctx.beginPath();
  ctx.arc(projection.centreX, projection.centreY, world.zoneRadii.wild * projection.scale, 0, TAU);
  ctx.fill();
  ctx.fillStyle = ZONE_FILL_BOSS;
  ctx.beginPath();
  ctx.arc(projection.centreX, projection.centreY, world.zoneRadii.boss * projection.scale, 0, TAU);
  ctx.fill();

  // Three boundaries: the edge of the world, the dashed wild-lands line and the
  // solid boss-lands line.
  strokeCircle(ctx, projection, world.zoneRadii.peripheral, false);
  strokeCircle(ctx, projection, world.zoneRadii.wild, true);
  strokeCircle(ctx, projection, world.zoneRadii.boss, false);

  for (const island of world.islands) {
    const spot = toCanvas(projection, island.centre.x, island.centre.y);
    // Bigger islands read bigger, but only just: the mark has to stay a mark.
    const radius = 1.8 + Math.min(2.6, island.tiles.length * 0.16);
    const colour = colourOf(island);
    ctx.beginPath();
    ctx.arc(spot.x, spot.y, radius + 1.4, 0, TAU);
    ctx.fillStyle = "rgba(6, 18, 30, 0.75)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(spot.x, spot.y, radius, 0, TAU);
    ctx.fillStyle = colour;
    ctx.fill();
    if (island.owner === OWNER_PLAYER || island.owner === OWNER_ENEMY || island.boss) {
      ctx.beginPath();
      ctx.arc(spot.x, spot.y, radius + 3, 0, TAU);
      ctx.strokeStyle = withAlpha(colour, 0.7);
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  if (frame.viewport.width > 0 && frame.viewport.height > 0) {
    const halfWidth = frame.viewport.width / (2 * frame.camera.scale);
    const halfHeight = frame.viewport.height / (2 * frame.camera.scale);
    const topLeft = toCanvas(projection, frame.camera.x - halfWidth, frame.camera.y - halfHeight);
    const bottomRight = toCanvas(projection, frame.camera.x + halfWidth, frame.camera.y + halfHeight);
    // Zoomed all the way out the viewport is larger than the whole minimap, and
    // an unclamped rectangle would leave every one of its edges off the canvas —
    // which reads as no rectangle at all. Clamped, it hugs the frame instead.
    const left = Math.max(1, topLeft.x);
    const top = Math.max(1, topLeft.y);
    const right = Math.min(size - 1, bottomRight.x);
    const bottom = Math.min(size - 1, bottomRight.y);
    if (right > left && bottom > top) {
      ctx.fillStyle = VIEWPORT_FILL;
      ctx.fillRect(left, top, right - left, bottom - top);
      ctx.strokeStyle = VIEWPORT_LINE;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(left + 0.5, top + 0.5, Math.max(2, right - left - 1), Math.max(2, bottom - top - 1));
    }
  }
}

export type { MinimapFrame, Projection };
export { drawMinimap, projectionFor, toWorld };
