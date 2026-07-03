/**
 * Model layer — cascade morale, the ruler aura and the ruler fate table
 * (GDD §11.2–11.3).
 *
 * Three pure rules of the reactive layer, kept free of MobX so they stay
 * unit-testable; {@link BattleStore} wires them into its observable units and
 * its {@link SeededRng}:
 *
 * - **Cascade morale (§11.2)** — when a unit is destroyed or routs, nearby
 *   allies waver: −10 morale if **adjacent**, −5 **one hex away**, both
 *   **doubled** when the lost unit carried the ruler.
 * - **Ruler aura (§11.3)** — while a ruler's unit stands on the field, every
 *   unit on its side gains **+10 morale**; losing the ruler removes it.
 * - **Ruler fate (§11.3)** — a destroyed ruler rolls a **d3** (1 killed, 2
 *   captured, 3 fled); a ruler whose unit merely routs escapes by default.
 */

import { distance } from './hex.ts';
import type { SeededRng } from './rng.ts';
import type { Axial, Side } from './types.ts';

/** Morale the ruler aura grants each allied unit while the ruler is on the field (§11.3). */
export const RULER_AURA_MORALE = 10;

/** Morale an **adjacent** ally loses when a unit is destroyed or routs (§11.2). */
export const CASCADE_ADJACENT_PENALTY = 10;

/** Morale an ally **one hex away** loses when a unit is destroyed or routs (§11.2). */
export const CASCADE_NEAR_PENALTY = 5;

/** The minimum a unit must expose for the morale rules — satisfied by a `UnitState`. */
export interface MoraleSubject {
  id: string;
  side: Side;
  hex: Axial;
  isAlive: boolean;
  isRouted: boolean;
  isRuler: boolean;
}

/** A morale loss the cascade inflicts on one allied unit (§11.2). */
export interface MoralePenalty {
  unitId: string;
  amount: number;
}

/**
 * The cascade morale penalties radiating from `lost` — a unit just destroyed or
 * routed (§11.2). Only **active allies** (same side, still alive and un-routed)
 * within two hexes are affected: −10 adjacent, −5 one hex away. If `lost`
 * carried the **ruler**, every penalty is **doubled** (−20 / −10). The lost unit
 * itself is excluded.
 */
export function cascadePenalties(lost: MoraleSubject, units: readonly MoraleSubject[]): MoralePenalty[] {
  const factor = lost.isRuler ? 2 : 1;
  const penalties: MoralePenalty[] = [];

  for (const unit of units) {
    if (unit.id === lost.id || unit.side !== lost.side) continue;
    if (!unit.isAlive || unit.isRouted) continue;

    const d = distance(lost.hex, unit.hex);
    if (d === 1) penalties.push({ unitId: unit.id, amount: CASCADE_ADJACENT_PENALTY * factor });
    else if (d === 2) penalties.push({ unitId: unit.id, amount: CASCADE_NEAR_PENALTY * factor });
  }

  return penalties;
}

/** Whether `side` still has a ruler present on the field — an active ruler unit (§11.3). */
export function rulerPresent(side: Side, units: readonly MoraleSubject[]): boolean {
  return units.some((unit) => unit.side === side && unit.isRuler && unit.isAlive && !unit.isRouted);
}

/** The fate of a ruler whose unit has left the field (§11.3). */
export type RulerFate = 'killed' | 'captured' | 'fled';

/** d3 outcomes for a **destroyed** ruler, indexed by roll (§11.3): 1 killed, 2 captured, 3 fled. */
const FATE_BY_ROLL: Record<number, RulerFate> = { 1: 'killed', 2: 'captured', 3: 'fled' };

/**
 * The fate of a ruler whose unit was **destroyed** — a seeded d3 so the outcome
 * replays (§11.3, §15.3). A ruler whose unit merely *routs* is not rolled: it
 * escapes by default (handled by the caller).
 */
export function rollRulerFate(rng: SeededRng): RulerFate {
  return FATE_BY_ROLL[rng.roll(3)];
}
