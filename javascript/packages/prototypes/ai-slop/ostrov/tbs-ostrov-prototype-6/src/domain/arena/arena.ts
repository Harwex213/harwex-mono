import { ARENA_CENTER_Y, BOARD_RADIUS, HEX_SIZE, SQRT3, pixelToAxial } from "./hex";
import type { TPoint } from "./hex";

type TZone = "player" | "enemy";

/**
 * The playable area is the hexagon inscribed in the board: the three axial axes
 * are each capped at this value. Units are not snapped to tiles — the grid is
 * only drawn — so the bound is a set of half-planes, not a set of cells.
 */
const ARENA_LIMIT = BOARD_RADIUS + 0.5;

/** Neutral strip in the middle that neither side may deploy into. */
const ZONE_GAP = 30;

/**
 * The three axial axes, with the unit normal of each one in world pixels.
 * Every axis has the same gradient length, so one pixel step changes its value
 * by `1 / (1.5 * HEX_SIZE)` regardless of direction.
 */
const AXES = [
  { value: (q: number, _r: number) => q, nx: SQRT3 / 2, ny: -0.5 },
  { value: (_q: number, r: number) => r, nx: 0, ny: 1 },
  { value: (q: number, r: number) => q + r, nx: SQRT3 / 2, ny: 0.5 },
];

/** Distance from the point to the nearest arena wall, in world pixels. */
const arenaDepth = (x: number, y: number): number => {
  const axial = pixelToAxial(x, y);
  let depth = Number.POSITIVE_INFINITY;

  for (const axis of AXES) {
    const slack = (ARENA_LIMIT - Math.abs(axis.value(axial.q, axial.r))) * 1.5 * HEX_SIZE;
    if (slack < depth) {
      depth = slack;
    }
  }

  return depth;
};

/** True when a body of `margin` radius fits inside the arena at this point. */
const isInsideArena = (x: number, y: number, margin: number): boolean => {
  return arenaDepth(x, y) >= margin;
};

/**
 * Pushes the point back inside the arena, keeping `margin` clearance. The axes
 * are not orthogonal, so a fix on one can break another: three passes settle it.
 */
const clampToArena = (x: number, y: number, margin: number): TPoint => {
  const limit = ARENA_LIMIT - margin / (1.5 * HEX_SIZE);
  let px = x;
  let py = y;

  for (let pass = 0; pass < 3; pass += 1) {
    let corrected = false;

    for (const axis of AXES) {
      const axial = pixelToAxial(px, py);
      const value = axis.value(axial.q, axial.r);
      if (Math.abs(value) <= limit) {
        continue;
      }

      const excess = value - Math.sign(value) * limit;
      const shift = -excess * 1.5 * HEX_SIZE;
      px += axis.nx * shift;
      py += axis.ny * shift;
      corrected = true;
    }

    if (!corrected) {
      break;
    }
  }

  return { x: px, y: py };
};

/** Deployment half the point belongs to, or `null` for the neutral strip. */
const zoneAt = (y: number): TZone | null => {
  if (y >= ARENA_CENTER_Y + ZONE_GAP) {
    return "player";
  }

  if (y <= ARENA_CENTER_Y - ZONE_GAP) {
    return "enemy";
  }

  return null;
};

/** True when a unit of `radius` may be dropped here before the battle. */
const isDeployable = (x: number, y: number, radius: number, zone: TZone): boolean => {
  if (!isInsideArena(x, y, radius)) {
    return false;
  }

  return zoneAt(y) === zone;
};

const zoneBand = (zone: TZone): { top: number; bottom: number } => {
  if (zone === "player") {
    return { top: ARENA_CENTER_Y + ZONE_GAP, bottom: ARENA_CENTER_Y * 2 };
  }

  return { top: 0, bottom: ARENA_CENTER_Y - ZONE_GAP };
};

export type { TZone };
export { ARENA_LIMIT, ZONE_GAP, arenaDepth, clampToArena, isDeployable, isInsideArena, zoneAt, zoneBand };
