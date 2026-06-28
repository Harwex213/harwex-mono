/**
 * Model layer — Breakthrough (GDD §5.2), the shock-infantry ability.
 *
 * After a shock unit attacks, if the **combined damage your forces deal** to the
 * target this turn is **≥ the target's attack stat**, the attacker may **push**
 * the enemy one hex into its rear and **occupy the vacated hex** (even after
 * spending its movement). A unit standing directly behind the pushed one is
 * **also** pushed — a chain. If the straight-rear hex is unavailable, a lone
 * target is shoved to **any available hex — flank first, then front** (§5.2).
 *
 * This module is pure: {@link planBreakthrough} turns the board layout into a
 * concrete relocation plan (or `null`), which `actions.ts` validates and
 * applies onto the observable units. Breakthrough cannot be used in an
 * opportunity attack (§5.2.2) — that gate lives with the reactive layer.
 */

import type { Board } from './board.ts';
import type { Category } from './catalog.ts';
import { hexEquals, neighbor } from './hex.ts';
import { directionOf, flankHexes, frontHexes } from './zones.ts';
import type { Axial, Facing } from './types.ts';

/** The attacker facts Breakthrough needs (its category gates the ability). */
export interface BreakthroughActor {
  category: Category;
  hex: Axial;
}

/** The target facts Breakthrough needs — position, facing and current attack stat. */
export interface BreakthroughTarget {
  id: string;
  hex: Axial;
  facing: Facing;
  /** The target's current effective attack — the push threshold (§5.2). */
  attack: number;
}

/** Anything occupying a hex that a push has to account for (§2.1). */
export interface Occupant {
  id: string;
  hex: Axial;
}

/** A concrete Breakthrough relocation: who moves where, plus the attacker's step-in. */
export interface BreakthroughPlan {
  /** Units to relocate, ordered **far-to-near** so applying them never collides. */
  pushes: { id: string; to: Axial }[];
  /** The hex the attacker steps into — the target's vacated hex (§5.2). */
  attackerTo: Axial;
}

/**
 * Whether the push threshold is met (§5.2): the attacker is shock infantry and
 * the `combinedDamage` dealt to the target this turn is at least its attack stat.
 */
export function canBreakthrough(attacker: BreakthroughActor, target: BreakthroughTarget, combinedDamage: number): boolean {
  return attacker.category === 'shock' && combinedDamage >= target.attack;
}

/** A hex is a valid push destination if it is on the board, passable and unoccupied. */
function isFree(hex: Axial, board: Board, units: readonly Occupant[], ignore: ReadonlySet<string>): boolean {
  const tile = board.get(hex);
  if (!tile || !tile.isPassable) return false;
  return !units.some((unit) => !ignore.has(unit.id) && hexEquals(unit.hex, hex));
}

/**
 * Plan the relocation for a Breakthrough push (§5.2), or `null` if it cannot
 * resolve. The straight push is along the line from attacker through target
 * (into the target's rear); units stacked directly behind are chained. When a
 * lone target cannot go straight back, it is shoved to a flank, else a front hex.
 */
export function planBreakthrough(
  attacker: BreakthroughActor,
  target: BreakthroughTarget,
  board: Board,
  units: readonly Occupant[],
): BreakthroughPlan | null {
  const pushDir = directionOf(attacker.hex, target.hex);
  if (pushDir < 0) return null;

  // Walk the straight line behind the target, collecting the chain of stacked units.
  const chain: Occupant[] = [];
  let cursor: Axial = target.hex;
  while (true) {
    const occ = units.find((unit) => hexEquals(unit.hex, cursor));
    if (!occ) break;
    chain.push(occ);
    cursor = neighbor(cursor, pushDir);
  }

  // `cursor` now points at the first empty hex beyond the chain — the destination
  // of the last (rearmost) chain member if the straight push is possible.
  const chainIds = new Set(chain.map((unit) => unit.id));
  if (isFree(cursor, board, units, chainIds)) {
    const pushes = [...chain]
      .reverse() // far-to-near so each vacates before the next fills it
      .map((unit) => ({ id: unit.id, to: neighbor(unit.hex, pushDir) }));
    return { pushes, attackerTo: target.hex };
  }

  // Straight push blocked. A chain cannot be redirected; a lone target may be
  // shoved sideways — flank first, then front (§5.2).
  if (chain.length > 1) return null;

  for (const hex of [...flankHexes(target), ...frontHexes(target)]) {
    if (hexEquals(hex, attacker.hex)) continue;
    if (isFree(hex, board, units, chainIds)) {
      return { pushes: [{ id: target.id, to: hex }], attackerTo: target.hex };
    }
  }

  return null;
}
