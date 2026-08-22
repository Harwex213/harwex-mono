import { config } from "@hw/ostrov-prototype-v2-config";
import { signal } from "@preact/signals-react";
import { walkTo } from "../economy/paths";
import type { Axial } from "../hex/coords";
import { hexKey } from "../hex/coords";
import type { Point } from "../hex/layout";
import { HEX_HALF_HEIGHT, HEX_SIZE, SQUASH, hexToWorld } from "../hex/layout";
import type { WorldMap } from "../map/world";
import { UNIT_ARRIVAL_BEAT_SEC } from "../tuning";
import type { UnitId } from "../units/catalog";
import { unitArmyCost, unitSpeed } from "../units/catalog";
import { world } from "./signals";

/**
 * The soldiers standing on the island.
 *
 * A unit is a walk and a position, nothing more: it leaves the barracks, follows
 * a chain of land hexes to its post at the rally point, and stands there. The
 * chain comes from `economy/paths.ts`, which is the hauling search read
 * backwards, so a unit can no more cross open sky than a crate can.
 *
 * The list is a plain array the renderer reads during the frame, exactly as it
 * reads the crates in flight. Only the two numbers React cares about — how many
 * places the army takes up, and a counter that changes when the list does — are
 * signals, so a hundred units walking do not re-render a single component.
 */

type Unit = {
  /** Ascending, never reused. Also the tie-break of the deterministic spread. */
  id: number;
  unitId: UnitId;
  /** Hex key of the barracks that trained it. Its rally point is the one it follows. */
  home: string;
  /** Which post of the rally formation it holds. Deterministic per barracks. */
  slot: number;
  x: number;
  y: number;
  /** Hex it is over, so the painter draws it in the tile's own order. */
  hex: string;
  /** -1 when it is walking left. The figure is mirrored on it. */
  facing: number;
  /** Hex centres of the rest of the walk, the last one being the post itself. */
  path: readonly Point[];
  /** Hex key of each point of `path`. Same length. */
  hexes: readonly string[];
  /** Segment of `path` the unit is on. `path.length - 1` means it has arrived. */
  leg: number;
  /** World units per second. Read once at spawn, from the unit's own `moveSpeed`. */
  speed: number;
  bornAt: number;
  /** `performance.now()` of the arrival, or null while it is still walking. */
  arrivedAt: number | null;
};

/** Distance between two neighbouring hex centres along the q axis, in world units. */
const HEX_STEP = HEX_SIZE * 1.5;

const units: Unit[] = [];

let nextUnitId = 1;

let source: WorldMap | null = null;

/** Places the live units take up. A signal, because the top bar shows it. */
const armyUsed = signal(0);

/** Bumped whenever the list itself changes, so the map loop repaints. */
const unitsVersion = signal(0);

function recount(): void {
  let total = 0;
  for (const unit of units) {
    total += unitArmyCost(unit.unitId);
  }
  armyUsed.value = total;
  unitsVersion.value = unitsVersion.peek() + 1;
}

/**
 * Where the unit holding post `slot` stands, relative to the rally point.
 *
 * Rings of six, twelve, eighteen around the centre, squashed the way every
 * horizontal plane on this map is. It is a pure function of the slot number, so
 * the same barracks always lays its soldiers out the same way, and no two slots
 * ever land on the same spot.
 */
function slotOffset(slot: number): Point {
  if (slot <= 0) {
    return { x: 0, y: 0 };
  }
  const spacing = config.army.rallySpacing;
  // Ring `k` holds `6k` posts, so the ring of a slot is the first `k` whose
  // running total has passed it.
  let ring = 1;
  let first = 1;
  while (slot >= first + ring * 6) {
    first += ring * 6;
    ring += 1;
  }
  const index = slot - first;
  const angle = (Math.PI * 2 * index) / (ring * 6) + (ring % 2 === 0 ? Math.PI / (ring * 6) : 0);
  // Capped against the tile, on both axes separately, because the tile is a
  // squashed hexagon and is far shorter than it is wide. One round cap let the
  // posts at the top and the bottom of a ring hang over the cliff — and over
  // open sky, when the rally hex sits on the rim of the island. Rings past the
  // cap crowd onto the same ellipse instead, which is what a formation too big
  // for one hex should look like.
  return {
    x: Math.cos(angle) * Math.min(spacing * ring, HEX_SIZE * 0.72),
    y: Math.sin(angle) * Math.min(spacing * ring * SQUASH, HEX_HALF_HEIGHT * 0.72),
  };
}

/** The units of one barracks, oldest first. The order is what fixes the slots. */
function unitsOfHome(home: string): Unit[] {
  return units.filter((unit) => unit.home === home).sort((left, right) => left.id - right.id);
}

/**
 * Points the unit at its post: the land path from where it stands to the rally
 * hex, with its own offset within the formation tacked on the end. Returns false
 * when no land path reaches the rally point, and leaves the unit where it is.
 */
function sendTo(unit: Unit, rally: Axial, map: WorldMap): boolean {
  const from = unit.hexes[unit.leg]!;
  const [q, r] = from.split(",");
  const walk = walkTo(map, rally, { q: Number(q), r: Number(r) });
  if (!walk) {
    return false;
  }
  const offset = slotOffset(unit.slot);
  const last = walk.points[walk.points.length - 1]!;
  // The walk starts at the centre of the hex the unit is over, and the unit is
  // somewhere inside that hex; starting the path at the unit's own position is
  // what keeps it from snapping to the centre first.
  const points: Point[] = [{ x: unit.x, y: unit.y }, ...walk.points.slice(1)];
  const hexes: string[] = [...walk.hexes];
  points.push({ x: last.x + offset.x, y: last.y + offset.y });
  hexes.push(walk.hexes[walk.hexes.length - 1]!);
  unit.path = points;
  unit.hexes = hexes;
  unit.leg = 0;
  unit.arrivedAt = null;
  return true;
}

/**
 * Puts a freshly trained unit on the map at its barracks and sends it to the
 * rally point. Returns false only when the rally point cannot be reached, which
 * the barracks refuses long before it gets here.
 */
function spawnUnit(unitId: UnitId, home: Axial, rally: Axial, now: number): boolean {
  const map = world.peek();
  const key = hexKey(home.q, home.r);
  const centre = hexToWorld(home);
  const unit: Unit = {
    id: nextUnitId,
    unitId,
    home: key,
    slot: unitsOfHome(key).length,
    x: centre.x,
    y: centre.y,
    hex: key,
    facing: 1,
    path: [centre],
    hexes: [key],
    leg: 0,
    speed: unitSpeed(unitId, HEX_STEP),
    bornAt: now,
    arrivedAt: now,
  };
  if (!sendTo(unit, rally, map)) {
    return false;
  }
  nextUnitId += 1;
  units.push(unit);
  recount();
  return true;
}

/**
 * Re-sends every unit of one barracks to a new rally point, re-cutting the
 * formation so the posts stay packed. Called when the player moves the flag.
 */
function rallyUnits(home: string, rally: Axial): void {
  const map = world.peek();
  const mine = unitsOfHome(home);
  for (let index = 0; index < mine.length; index += 1) {
    const unit = mine[index]!;
    unit.slot = index;
    sendTo(unit, rally, map);
  }
  unitsVersion.value = unitsVersion.peek() + 1;
}

/** Drops everything a previous world's units stood on. */
function resetIfWorldChanged(map: WorldMap): void {
  if (source === map) {
    return;
  }
  source = map;
  if (units.length > 0) {
    units.length = 0;
    recount();
  }
}

/**
 * One step of every walk. `seconds` is the step the caller already clamped, so a
 * tab that was in the background cannot fling a soldier across the island.
 */
function advanceUnits(now: number, seconds: number): void {
  resetIfWorldChanged(world.peek());
  for (const unit of units) {
    const last = unit.path.length - 1;
    if (unit.leg >= last) {
      continue;
    }
    let budget = unit.speed * seconds;
    while (budget > 0 && unit.leg < last) {
      const ahead = unit.path[unit.leg + 1]!;
      const dx = ahead.x - unit.x;
      const dy = ahead.y - unit.y;
      const span = Math.hypot(dx, dy);
      if (span <= budget) {
        unit.x = ahead.x;
        unit.y = ahead.y;
        unit.leg += 1;
        unit.hex = unit.hexes[Math.min(unit.leg, last)]!;
        budget -= span;
        continue;
      }
      unit.x += (dx / span) * budget;
      unit.y += (dy / span) * budget;
      if (Math.abs(dx) > 0.001) {
        unit.facing = dx < 0 ? -1 : 1;
      }
      budget = 0;
    }
    if (unit.leg >= last && unit.arrivedAt === null) {
      unit.arrivedAt = now;
    }
  }
}

/** True while a unit is still walking or still playing its arrival beat. */
function unitsAnimating(now: number): boolean {
  for (const unit of units) {
    if (unit.leg < unit.path.length - 1) {
      return true;
    }
    if (unit.arrivedAt !== null && now - unit.arrivedAt < UNIT_ARRIVAL_BEAT_SEC * 1000) {
      return true;
    }
  }
  return false;
}

/** Live data for the painter. Read it during the frame; never hold onto it. */
function unitsOnMap(): readonly Unit[] {
  return units;
}

export type { Unit };
export { HEX_STEP, advanceUnits, armyUsed, rallyUnits, slotOffset, spawnUnit, unitsAnimating, unitsOnMap, unitsVersion };
