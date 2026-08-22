import { config } from "@hw/ostrov-prototype-v2-config";
import type { Point } from "../hex/layout";
import { OWNER_ENEMY, OWNER_PLAYER } from "../map/island";
import type { Island, WorldMap } from "../map/world";
import type { Camera, Viewport } from "../state/camera";
import type { FogDisc, FogSnapshot } from "../state/fog";
import { BOSS_MARKER, MINIMAP_ENEMY, MINIMAP_NEUTRAL, MINIMAP_PLAYER, withAlpha } from "./palette";

/**
 * The whole world on one small canvas.
 *
 * The projection is uniform and square: the extent it fits is the outer zone
 * radius, taken in both axes, so the zone boundaries stay circles instead of
 * turning into ellipses. World y is already squashed by the hex layout, which is
 * why nothing squashes it again here.
 *
 * The fog reaches the overview too: an island nobody has seen leaves no mark at
 * all, and one seen but not watched right now sits dimmer than one in sight.
 * That empties most of the canvas in the opening minutes on purpose. What keeps
 * it reading as a map rather than as a broken widget is everything that is not
 * an island — the three zone rings, the viewport rectangle, and a pale wash over
 * the ground the player has actually walked, which is the shape their own
 * territory cuts out of the weather.
 *
 * Mark sizes are a legend, not decoration. Four sizes carry four meanings, and
 * they are deliberately far apart: the player's own island is the largest and
 * the only one wearing a white ring, so it is found at a glance rather than
 * read; the boss comes next, then the enemy, and the neutral crowd is smallest,
 * because eighty of them share one canvas and any two must stay countable.
 */

const TAU = Math.PI * 2;

/** Blank ring between the outer zone boundary and the canvas edge, in pixels. */
const EDGE_PAD = 8;

/**
 * The ground of the overview. Opaque: the map underneath is the same blues and
 * greens as the marks, and a translucent panel let it read through them.
 */
const BACKDROP = "#0a1a2c";
const ZONE_LINE = "rgba(214, 234, 250, 0.55)";
const ZONE_FILL_WILD = "rgba(120, 170, 210, 0.1)";
const ZONE_FILL_BOSS = "rgba(220, 110, 96, 0.16)";
const VIEWPORT_LINE = "rgba(255, 255, 255, 0.92)";
const VIEWPORT_FILL = "rgba(255, 255, 255, 0.1)";
/** Ring around the rare landmark-sized islands. */
const LANDMARK_RING = "rgba(255, 226, 158, 0.85)";

/** The ring only the player's own island wears, which is what makes it findable. */
const HOME_RING = "rgba(255, 255, 255, 0.95)";

/** Dark cushion under every mark, so a pale island keeps its edge over the wash. */
const MARK_HALO = "rgba(6, 18, 30, 0.8)";

/** Radius of the player's own mark, in pixels. The designer's number. */
const HOME_RADIUS = config.ui.minimapPlayerMark;

/** Radius of the boss mark. Second largest: one island, and the point of the map. */
const BOSS_RADIUS = 4;

/** Radius of an enemy mark. Third: there are few of them and they matter. */
const ENEMY_RADIUS = 3.2;

/** Smallest neutral mark, before island size is added. */
const NEUTRAL_RADIUS_MIN = 1;

/** How much a neutral mark may grow with the island under it. */
const NEUTRAL_RADIUS_RANGE = 1.5;

/** How fast a neutral mark grows per hex of its island. */
const NEUTRAL_RADIUS_PER_TILE = 0.09;

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

/**
 * How big this island's mark is drawn.
 *
 * Owner comes first and island size second: what the player needs off this
 * canvas is whose island it is, and only the anonymous neutral crowd is left to
 * say anything about its size.
 */
function radiusOf(island: Island): number {
  if (island.owner === OWNER_PLAYER) {
    return HOME_RADIUS;
  }
  if (island.boss) {
    return BOSS_RADIUS;
  }
  if (island.owner === OWNER_ENEMY) {
    return ENEMY_RADIUS;
  }
  return (
    NEUTRAL_RADIUS_MIN + Math.min(NEUTRAL_RADIUS_RANGE, island.tiles.length * NEUTRAL_RADIUS_PER_TILE)
  );
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

/** Pale halo over the ground the player has seen. */
const KNOWN_CORE = "rgba(178, 214, 240, 0.22)";
const KNOWN_EDGE = "rgba(178, 214, 240, 0)";

type MinimapFrame = {
  world: WorldMap;
  camera: Camera;
  viewport: Viewport;
  fog: FogSnapshot;
  /** The explored discs, drawn as the wash that tells the player where they are. */
  known: readonly FogDisc[];
};

/**
 * The wash over the known world. A soft radial per disc rather than a hard
 * circle: a crisp edge would claim the fog stops exactly there, and it does not.
 */
function drawKnown(ctx: CanvasRenderingContext2D, projection: Projection, discs: readonly FogDisc[]): void {
  for (const disc of discs) {
    const spot = toCanvas(projection, disc.x, disc.y);
    const radius = Math.max(3, disc.radius * projection.scale);
    const wash = ctx.createRadialGradient(spot.x, spot.y, 0, spot.x, spot.y, radius);
    wash.addColorStop(0, KNOWN_CORE);
    wash.addColorStop(0.62, KNOWN_CORE);
    wash.addColorStop(1, KNOWN_EDGE);
    ctx.fillStyle = wash;
    ctx.beginPath();
    ctx.arc(spot.x, spot.y, radius, 0, TAU);
    ctx.fill();
  }
}

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

  // The known world goes under the boundaries, so the rings stay readable
  // through it and the player never loses their bearings to the fog.
  drawKnown(ctx, projection, frame.known);

  // Three boundaries: the edge of the world, the dashed wild-lands line and the
  // solid boss-lands line.
  strokeCircle(ctx, projection, world.zoneRadii.peripheral, false);
  strokeCircle(ctx, projection, world.zoneRadii.wild, true);
  strokeCircle(ctx, projection, world.zoneRadii.boss, false);

  for (const island of world.islands) {
    const level = frame.fog.island[island.id] ?? 1;
    // Never seen is never drawn: a mark here would hand over the position of an
    // island the player has not found.
    if (level <= 0) {
      continue;
    }
    ctx.globalAlpha = 0.34 + 0.66 * level;
    const spot = toCanvas(projection, island.centre.x, island.centre.y);
    const radius = radiusOf(island);
    const colour = colourOf(island);
    const home = island.owner === OWNER_PLAYER;
    ctx.beginPath();
    ctx.arc(spot.x, spot.y, radius + 1, 0, TAU);
    ctx.fillStyle = MARK_HALO;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(spot.x, spot.y, radius, 0, TAU);
    ctx.fillStyle = colour;
    ctx.fill();
    // A landmark is worth a trip, so the overview says which marks are the big
    // ones instead of leaving the player to find them by sailing over.
    if (island.large) {
      ctx.beginPath();
      ctx.arc(spot.x, spot.y, radius + 2.6, 0, TAU);
      ctx.strokeStyle = LANDMARK_RING;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (home) {
      // Home wears a white ring nothing else wears. Size alone would leave the
      // player comparing marks; a colour that appears once is found without one.
      ctx.beginPath();
      ctx.arc(spot.x, spot.y, radius + 2.6, 0, TAU);
      ctx.strokeStyle = HOME_RING;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    } else if (island.owner === OWNER_ENEMY || island.boss) {
      ctx.beginPath();
      ctx.arc(spot.x, spot.y, radius + 2.8, 0, TAU);
      ctx.strokeStyle = withAlpha(colour, 0.7);
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

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
