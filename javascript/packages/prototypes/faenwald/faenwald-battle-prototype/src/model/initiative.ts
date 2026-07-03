/**
 * Model layer — initiative ordering (GDD §6.1).
 *
 * `initiativeOrder` is a pure, deterministic function turning the units on the
 * field into the sequence in which they act during a battle turn. The ordering
 * is normative (§6.1, Appendix B):
 *
 * 1. **Current movement speed, fastest first.**
 * 2. **Ties broken by category:** cavalry → ranged → melee, and within melee
 *    **shock infantry before spearmen** (special units do not fight, §3.6).
 * 3. **Within the same speed+category bracket, sides alternate** Blue, Red —
 *    e.g. `Blue archers → Red archers → Blue spearmen → Red spearmen`.
 *
 * It is generic over any {@link Combatant}, so the {@link UnitState} model can be
 * ordered directly while the rule stays unit-testable against plain objects.
 */

import type { Category } from './catalog.ts';
import type { Side } from './types.ts';

/**
 * Category precedence for the initiative tie-break (§6.1): cavalry, then ranged,
 * then melee (shock before spearmen). `special` never fights so it sorts last,
 * but {@link isActiveCombatant} filters it out before ordering anyway.
 */
export const CATEGORY_INITIATIVE_RANK: Record<Category, number> = {
  cavalry: 0,
  ranged: 1,
  shock: 2,
  spear: 3,
  special: 4,
};

/** The minimum a unit must expose to be placed in the initiative order. */
export interface Combatant {
  side: Side;
  category: Category;
  /** Current movement speed at the start of the turn (§6.1). */
  speed: number;
  /** Whether the unit takes part in combat (special units do not, §4.5). */
  fights: boolean;
  isAlive: boolean;
  isRouted: boolean;
}

/** A unit eligible to act this turn — it fights, is alive and has not routed (§11.1). */
export function isActiveCombatant(unit: Combatant): boolean {
  return unit.fights && unit.isAlive && !unit.isRouted;
}

/** Bracket key grouping units that share a speed and a category rank (§6.1). */
function bracketKey(unit: Combatant): string {
  return `${unit.speed}|${CATEGORY_INITIATIVE_RANK[unit.category]}`;
}

/**
 * Interleave a single speed+category bracket Blue, Red, Blue, Red … (§6.1).
 * Each side keeps its incoming relative order; when the sides are uneven the
 * longer one's remainder trails at the end.
 */
function interleaveSides<T extends Combatant>(bracket: T[]): T[] {
  const blue = bracket.filter((unit) => unit.side === 'blue');
  const red = bracket.filter((unit) => unit.side === 'red');
  const ordered: T[] = [];
  const rounds = Math.max(blue.length, red.length);
  for (let i = 0; i < rounds; i++) {
    if (i < blue.length) ordered.push(blue[i]);
    if (i < red.length) ordered.push(red[i]);
  }
  return ordered;
}

/**
 * The order in which the active units act this battle turn (§6.1). Only
 * fighting, alive, un-routed units appear; the rest are dropped. Generic so the
 * caller gets its own element type back (e.g. `UnitState[]`).
 */
export function initiativeOrder<T extends Combatant>(units: readonly T[]): T[] {
  const active = units.filter(isActiveCombatant);

  // Group into speed+category brackets, preserving first-seen order per bracket.
  const buckets = new Map<string, T[]>();
  for (const unit of active) {
    const key = bracketKey(unit);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(unit);
    else buckets.set(key, [unit]);
  }

  // Order brackets: speed descending, then category rank ascending (§6.1).
  const orderedKeys = [...buckets.keys()].sort((a, b) => {
    const [speedA, rankA] = a.split('|').map(Number);
    const [speedB, rankB] = b.split('|').map(Number);
    return speedB - speedA || rankA - rankB;
  });

  return orderedKeys.flatMap((key) => interleaveSides(buckets.get(key)!));
}
