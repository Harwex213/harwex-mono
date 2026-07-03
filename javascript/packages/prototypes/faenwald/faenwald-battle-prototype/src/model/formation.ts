/**
 * Model layer — Close Formation (GDD §5.1), the spearmen ability.
 *
 * Pure, side-effect-free helpers that turn the board layout into the §9
 * modifiers and the §7 movement options Close Formation grants. Four rules:
 *
 * 1. **Shielding** (§5.1.1) — a flank "covered" by an allied spearmen unit
 *    facing the **same direction**, by impassable terrain, or by the map edge
 *    reduces **incoming front** damage to ×0.8; **both** flanks covered → ×0.6.
 * 2. **Lateral shuffle** (§5.1.2) — the unit may step into a rear/flank hex
 *    **without turning** at **×2** the normal movement cost.
 * 3. **Rear vulnerability** (§5.1.3) — an extra **×1.5 physical** in the rear
 *    (the morale rear multiplier is unchanged).
 * 4. **Charge reflection** (§5.1.4) — handled in `actions.ts`; this module just
 *    exposes {@link hasFormationBonus} (≥1 flank covered) as the trigger.
 *
 * Like the rest of the engine these are data-only and feed the {@link AttackContext}
 * so the modifiers compose in the §9 pipeline and surface in the damage preview.
 */

import type { Board } from './board.ts';
import type { Category } from './catalog.ts';
import type { AppliedModifier } from './combat.ts';
import { hexEquals } from './hex.ts';
import { flankHexes } from './zones.ts';
import type { Axial, Facing, Side, Zone } from './types.ts';

/** Incoming-front multiplier with **one** flank covered (§5.1.1). */
export const CLOSE_FORMATION_ONE_FLANK = 0.8;
/** Incoming-front multiplier with **both** flanks covered (§5.1.1). */
export const CLOSE_FORMATION_BOTH_FLANKS = 0.6;
/** Extra physical a spearmen unit takes in its rear (§5.1.3). */
export const SPEARMAN_REAR_PHYSICAL = 1.5;

/** The minimum a unit must expose to take part in formation reasoning. */
export interface Formant {
  side: Side;
  category: Category;
  facing: Facing;
  hex: Axial;
}

/** The unit occupying `hex`, if any (one unit per hex, §2.1). */
function occupantAt(hex: Axial, units: readonly Formant[]): Formant | undefined {
  return units.find((unit) => hexEquals(unit.hex, hex));
}

/**
 * Whether a single flank hex is **covered** (§5.1.1): off the board or onto
 * impassable terrain (edge / mountain / water), or held by an **allied spearmen
 * unit facing the same direction** as `unit`.
 */
function flankCovered(unit: Formant, flank: Axial, board: Board, units: readonly Formant[]): boolean {
  const tile = board.get(flank);
  if (!tile || !tile.isPassable) return true; // map edge or impassable terrain shields the flank

  const occupant = occupantAt(flank, units);
  return (
    occupant !== undefined &&
    occupant.side === unit.side &&
    occupant.category === 'spear' &&
    occupant.facing === unit.facing
  );
}

/**
 * How many of a spearmen unit's two flanks are covered (§5.1.1): 0, 1 or 2.
 * Non-spearmen never form up, so they always return 0.
 */
export function coveredFlanks(unit: Formant, board: Board, units: readonly Formant[]): number {
  if (unit.category !== 'spear') return 0;
  return flankHexes(unit).reduce((count, flank) => count + (flankCovered(unit, flank, board, units) ? 1 : 0), 0);
}

/**
 * The Close-Formation shielding multiplier for a given flank count (§5.1.1):
 * one flank → ×0.8, both → ×0.6, none → no modifier.
 */
export function shieldingModifier(covered: number): AppliedModifier | null {
  if (covered >= 2) return { label: 'Close formation, both flanks (×0.6)', value: CLOSE_FORMATION_BOTH_FLANKS };
  if (covered === 1) return { label: 'Close formation, one flank (×0.8)', value: CLOSE_FORMATION_ONE_FLANK };
  return null;
}

/**
 * Whether a spearmen unit currently holds a Close-Formation bonus — i.e. at
 * least one flank is covered (§5.1.1). This is the trigger for charge
 * reflection (§5.1.4), resolved in `actions.ts`.
 */
export function hasFormationBonus(unit: Formant, board: Board, units: readonly Formant[]): boolean {
  return coveredFlanks(unit, board, units) >= 1;
}

/**
 * The Close-Formation defensive modifiers an attack on a spearmen `defender`
 * picks up, split per channel (§5.1):
 *
 * - **Front** hits are reduced ×0.8/×0.6 by shielding on **both** channels
 *   ("any incoming damage from the front", §5.1.1).
 * - **Rear** hits take an extra ×1.5 **physical** (§5.1.3); morale already
 *   carries the standard rear multiplier from the §9 zone factor.
 *
 * Non-spearmen defenders get nothing here.
 */
export function closeFormationDefenseModifiers(
  defender: Formant,
  zone: Zone,
  board: Board,
  units: readonly Formant[],
): { physical: AppliedModifier[]; morale: AppliedModifier[] } {
  const physical: AppliedModifier[] = [];
  const morale: AppliedModifier[] = [];
  if (defender.category !== 'spear') return { physical, morale };

  if (zone === 'front') {
    const shielding = shieldingModifier(coveredFlanks(defender, board, units));
    if (shielding) {
      physical.push(shielding);
      morale.push(shielding);
    }
  } else if (zone === 'rear') {
    physical.push({ label: 'Spearman rear (×1.5 physical)', value: SPEARMAN_REAR_PHYSICAL });
  }

  return { physical, morale };
}
