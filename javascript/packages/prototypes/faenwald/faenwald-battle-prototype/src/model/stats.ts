/**
 * Model layer — effective stat computation (GDD §3.2–3.4, §9.6).
 *
 * A pure, side-effect-free utility. Catalog values are **per 100 soldiers at
 * rank II** (§4); this module derives a unit's actual combat stats by applying,
 * **in order**, rank (§3.3) → count (§3.2) → in-battle degradation (§3.4).
 * Pre-battle strategic modifiers (§3.5) fold into the "entering" stats via
 * `strengthMod`. Speed never scales and is therefore not handled here.
 */

import type { Rank } from './catalog.ts';

/**
 * Round half **up** (§9.6) — `round(2.5) = 3`. `Math.round` already rounds .5
 * up for non-negative inputs, but we spell the rule out so the intent is
 * explicit and the function is correct were a negative ever to appear.
 */
export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

/**
 * Scale a rank-II base stat to `rank` (§3.3). The bonus is **+25% of the base
 * value per rank step, rounded at each step** — *not* a single compounded
 * multiply. Rank I is `round(0.75 × base)`; rank II is the base itself.
 *
 * Source worked example (base 50): III = 63, IV = 76 ("76, not 78"), matching
 * `round(prev + 0.25 × base)` applied iteratively.
 */
export function scaleByRank(base: number, rank: Rank): number {
  if (rank === 1) return roundHalfUp(0.75 * base);

  let value = base; // rank II baseline
  for (let step = 3; step <= rank; step++) {
    value = roundHalfUp(value + 0.25 * base);
  }
  return value;
}

/** Inputs needed to derive a unit's entering stats. */
export interface StatInput {
  baseHp: number;
  baseAtk: number;
  baseMorale: number;
  rank: Rank;
  /** Soldier count, 0..100. Scales HP/atk/morale linearly (§3.2). */
  count: number;
  /** Pre-battle strength multiplier (§3.5), e.g. 0.8 after supply loss. */
  strengthMod?: number;
}

/** The stats a unit **enters** the battle with — after rank, count and strategy. */
export interface EnteringStats {
  maxHp: number;
  maxMorale: number;
  /** Full attack output before any in-battle degradation. */
  attack: number;
}

/** Apply rank, then count, then the strategic strength modifier to one stat. */
function scaleStat(base: number, rank: Rank, count: number, strengthMod: number): number {
  return roundHalfUp(scaleByRank(base, rank) * (count / 100) * strengthMod);
}

/**
 * Derive entering stats from a catalog base (§3.2–3.3, §3.5). Order is
 * rank → count → strength; the final value is rounded once (§9.6), the
 * intermediate rank value having already been rounded per step.
 */
export function computeEnteringStats(input: StatInput): EnteringStats {
  const strengthMod = input.strengthMod ?? 1;
  return {
    maxHp: scaleStat(input.baseHp, input.rank, input.count, strengthMod),
    maxMorale: scaleStat(input.baseMorale, input.rank, input.count, strengthMod),
    attack: scaleStat(input.baseAtk, input.rank, input.count, strengthMod),
  };
}

/** Full effective stats, including the current half-health degradation (§3.4). */
export interface EffectiveStats extends EnteringStats {
  /** True once current HP has dropped below half the entering max (§3.4). */
  bloodied: boolean;
  /** Attack actually dealt right now — halved while `bloodied`. */
  effectiveAttack: number;
}

/**
 * `computeEffectiveStats(unit)` (§15.2) — entering stats plus the half-health
 * rule (§3.4): once current HP < maxHp / 2 the unit's attack output halves for
 * the rest of the battle. Pure: degradation depends only on `currentHp`.
 */
export function computeEffectiveStats(input: StatInput & { currentHp: number }): EffectiveStats {
  const entering = computeEnteringStats(input);
  const bloodied = entering.maxHp > 0 && input.currentHp < entering.maxHp / 2;
  return {
    ...entering,
    bloodied,
    effectiveAttack: bloodied ? roundHalfUp(entering.attack * 0.5) : entering.attack,
  };
}
