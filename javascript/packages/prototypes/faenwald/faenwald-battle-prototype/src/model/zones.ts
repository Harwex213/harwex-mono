/**
 * Model layer — facing and the three zones (GDD §2.2).
 *
 * A unit's facing points at the shared vertex between two adjacent neighbour
 * hexes, so the six surrounding directions split cleanly into three zones of
 * two hexes each:
 *
 * ```
 *             FRONT   FRONT
 *                  \ /
 *         L-FLANK --U-- R-FLANK
 *                  / \
 *              REAR   REAR
 * ```
 *
 * - **Front** — the 2 hexes the unit points between (baseline ×1.0).
 * - **Flank** — 1 hex each side (×1.25 morale).
 * - **Rear** — the 2 hexes behind (×1.5 morale).
 *
 * The zone of an attack is decided by **which of the defender's zones the
 * attacking hex falls in** — the attacker's own facing is irrelevant (§2.2).
 */

import {
  HEX_DIRECTION_COUNT,
  axialToPixel,
  hexEquals,
  hexSubtract,
  neighbor,
} from './hex.ts';
import type { Axial, Facing, Zone } from './types.ts';

/** A unit's location and facing — the minimum a defender needs to classify a hit. */
export interface Facer {
  hex: Axial;
  facing: Facing;
}

/**
 * The two hexes a unit may attack into and step toward — its **front** (§2.2,
 * §7.1–7.2). A facing `f` points at the vertex between directions `f` and
 * `f + 1`, so the front is exactly those two neighbours.
 */
export function frontHexes(facer: Facer): [Axial, Axial] {
  return [neighbor(facer.hex, facer.facing), neighbor(facer.hex, facer.facing + 1)];
}

/** True when `target` is one of the facer's two front hexes (§7.1). */
export function isInFront(facer: Facer, target: Axial): boolean {
  return frontHexes(facer).some((hex) => hexEquals(hex, target));
}

/**
 * The two **flank** hexes (one each side) of a unit (§2.2) — the offset-2 and
 * offset-5 neighbours relative to its facing (see {@link zoneOf}). Used by
 * Close Formation flank-coverage (§5.1) and the lateral shuffle (§5.1.2).
 */
export function flankHexes(facer: Facer): [Axial, Axial] {
  return [neighbor(facer.hex, facer.facing + 2), neighbor(facer.hex, facer.facing + 5)];
}

/** The two **rear** hexes of a unit (§2.2) — the offset-3 and offset-4 neighbours. */
export function rearHexes(facer: Facer): [Axial, Axial] {
  return [neighbor(facer.hex, facer.facing + 3), neighbor(facer.hex, facer.facing + 4)];
}

/**
 * Bearings (radians) of the six {@link HEX_DIRECTIONS} on the pointy-top
 * layout, precomputed once so zone lookup needs no trig at call time.
 */
const DIRECTION_ANGLES: readonly number[] = (() => {
  const directions: Axial[] = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
  ];
  return directions.map((d) => {
    const { x, y } = axialToPixel(d);
    return Math.atan2(y, x);
  });
})();

/**
 * The direction index (0..5) from `from` toward `to` — the nearest of the six
 * hex bearings. Works for any separation (adjacent melee or distant ranged):
 * the result is the dominant of the six directions the target lies along.
 * Returns `-1` when the two hexes coincide (no direction).
 */
export function directionOf(from: Axial, to: Axial): number {
  if (hexEquals(from, to)) return -1;

  const { x, y } = axialToPixel(hexSubtract(to, from));
  const bearing = Math.atan2(y, x);

  let best = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < HEX_DIRECTION_COUNT; i++) {
    // Wrap the difference into [-π, π] and take its magnitude.
    let delta = Math.abs(bearing - DIRECTION_ANGLES[i]) % (2 * Math.PI);
    if (delta > Math.PI) delta = 2 * Math.PI - delta;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }
  return best;
}

/**
 * The zone an attacker standing on `attackerHex` falls into relative to a
 * defender's facing. Maps the direction-from-defender to one of front/flank/
 * rear via the offset table:
 *
 * | offset (dir − facing, mod 6) | zone |
 * | --- | --- |
 * | 0, 1 | front |
 * | 2, 5 | flank |
 * | 3, 4 | rear |
 *
 * A coincident hex (attacker on the defender) defaults to `front`.
 */
export function zoneOf(attackerHex: Axial, defender: Facer): Zone {
  const dir = directionOf(defender.hex, attackerHex);
  if (dir < 0) return 'front';

  const offset = (dir - defender.facing + HEX_DIRECTION_COUNT) % HEX_DIRECTION_COUNT;
  switch (offset) {
    case 0:
    case 1:
      return 'front';
    case 2:
    case 5:
      return 'flank';
    default:
      return 'rear';
  }
}
