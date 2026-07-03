/**
 * Model layer — terrain & elevation combat/movement effects (GDD §10, §2.3).
 *
 * Pure helpers that turn the board's terrain, elevation and transient state into
 * the tactical numbers the rest of the engine consumes:
 *
 * - {@link terrainPhysicalModifiers} — the physical-channel multipliers a
 *   §9 attack picks up from the ground (elevation deltas, mud, ranged cover).
 *   They are fed into the {@link AttackContext} so they multiply in alongside
 *   the zone/matchup factors and show up in the damage preview (item 13).
 * - {@link lineOfFireBlocked} — whether a mountain (or other blocker) sits
 *   between a firer and its target (§2.3, §10); the gate ranged attacks (phase
 *   4) check before they may fire.
 * - {@link moveCost} — the movement a unit spends to enter a hex (§10): climbing,
 *   roads, bog, mud and the cavalry brush/forest penalties.
 *
 * Everything here is data-driven and side-effect free, so it stays unit-testable
 * without React or MobX (GDD §15).
 */

import type { Board, Hex } from './board.ts';
import type { Category, Subtype } from './catalog.ts';
import type { AppliedModifier } from './combat.ts';
import { lineDraw } from './hex.ts';
import type { Elevation, TerrainType } from './terrain.ts';
import type { Axial } from './types.ts';

/** The unit facts the terrain helpers need — satisfied by a {@link UnitState}. */
export interface TerrainCombatant {
  category: Category;
  subtype: Subtype;
  hex: Axial;
}

/**
 * The physical multiplier for attacking across an elevation delta (§10.4–10.5,
 * Appendix A). Derived from `attackerElevation − defenderElevation` for an
 * adjacent melee exchange:
 *
 * | delta | meaning | multiplier |
 * | --- | --- | --- |
 * | +2 | hill striking a low (two levels down) hex | ×1.5 |
 * | +1 | one level above the target | ×1.25 |
 * | −1 | one level below the target | ×0.75 |
 * | −2 | striking a hill from two levels down | ×0.5 |
 *
 * Returns `null` on level ground (no modifier).
 */
export function elevationAttackModifier(
  attackerElevation: Elevation,
  defenderElevation: Elevation,
): AppliedModifier | null {
  switch (attackerElevation - defenderElevation) {
    case 2:
      return { label: 'High ground vs low (×1.5)', value: 1.5 };
    case 1:
      return { label: 'Higher ground (×1.25)', value: 1.25 };
    case -1:
      return { label: 'Lower ground (×0.75)', value: 0.75 };
    case -2:
      return { label: 'Attacking uphill (×0.5)', value: 0.5 };
    default:
      return null;
  }
}

/** Cover a defender's hex grants against **ranged** fire: brush ×0.75, forest ×0.5 (§10). */
function rangedCoverModifier(terrain: TerrainType): AppliedModifier | null {
  if (terrain === 'brush') return { label: 'Brush cover vs ranged (×0.75)', value: 0.75 };
  if (terrain === 'forest') return { label: 'Forest cover vs ranged (×0.5)', value: 0.5 };
  return null;
}

/**
 * The physical-channel terrain multipliers for an attack (§10). Collects:
 *
 * - **Elevation** delta between the two hexes — skipped for ranged attackers,
 *   which get no hill attack bonus/debuff (§5.4).
 * - **Mud** — a light unit deals ×2 to a heavy defender that is standing in mud
 *   (the "light ↔ heavy in mud" rule, §10).
 * - **Ranged cover** — brush/forest on the defender's hex, when the attacker is
 *   ranged.
 *
 * Morale-channel terrain factors are not defined by §10, so this returns the
 * physical list only.
 */
export function terrainPhysicalModifiers(
  attacker: TerrainCombatant,
  defender: TerrainCombatant,
  board: Board,
): AppliedModifier[] {
  const modifiers: AppliedModifier[] = [];

  const attackerTile = board.get(attacker.hex);
  const defenderTile = board.get(defender.hex);
  if (!attackerTile || !defenderTile) return modifiers;

  // Elevation — melee only; ranged units get no hill attack bonus/debuff (§5.4).
  if (attacker.category !== 'ranged') {
    const elevation = elevationAttackModifier(attackerTile.elevation, defenderTile.elevation);
    if (elevation) modifiers.push(elevation);
  }

  // Mud: a light unit deals ×2 to a heavy defender standing in mud (§10).
  if (attacker.subtype === 'light' && defender.subtype === 'heavy' && defenderTile.state === 'mud') {
    modifiers.push({ label: 'Mud: light vs heavy (×2)', value: 2 });
  }

  // Cover vs ranged fire on the defender's hex (§10).
  if (attacker.category === 'ranged') {
    const cover = rangedCoverModifier(defenderTile.terrain);
    if (cover) modifiers.push(cover);
  }

  return modifiers;
}

/**
 * Whether ranged line of fire from `from` to `to` is blocked by an intervening
 * tile — mountains block all fire (§2.3, §10). Endpoints are excluded: a blocker
 * on the firer's or target's own hex does not count. Used as the gate for ranged
 * attacks (phase 4).
 */
export function lineOfFireBlocked(from: Axial, to: Axial, board: Board): boolean {
  const line = lineDraw(from, to);
  for (let i = 1; i < line.length - 1; i++) {
    if (board.get(line[i])?.blocksLineOfFire === true) return true;
  }
  return false;
}

/** The unit facts {@link moveCost} needs — satisfied by a {@link UnitState}. */
export interface MovingUnit {
  category: Category;
  /** Base movement speed; used to bound cavalry forest movement (§10). */
  speed: number;
}

/**
 * The movement a unit spends to step from `from` into `to` (§10). Starts at 1
 * hex and applies the terrain costs:
 *
 * - **Climbing** to a higher elevation costs ×2 (foothill/hill, §10.4–10.5).
 * - **Road** halves the cost (×0.5); **bog** triples it (×3); **mud** doubles it.
 * - **Brush** costs cavalry 2 hexes to enter; **forest** lets cavalry move only
 *   1 hex per turn (modelled as consuming the unit's whole speed).
 *
 * The figure is compared against the unit's remaining movement by the action
 * layer; sub-1 costs (road) let faster units cover more ground.
 */
export function moveCost(unit: MovingUnit, from: Hex, to: Hex): number {
  // Cavalry forest entry consumes the turn — they move only 1 hex (§10).
  if (to.terrain === 'forest' && unit.category === 'cavalry') return unit.speed;
  // Cavalry brush entry costs a flat 2 hexes of speed (§10).
  if (to.terrain === 'brush' && unit.category === 'cavalry') return 2;

  let cost = 1;
  if (to.elevation > from.elevation) cost *= 2; // climbing onto higher ground (§10)
  if (to.terrain === 'road') cost *= 0.5;
  if (to.terrain === 'bog') cost *= 3;
  if (to.state === 'mud') cost *= 2;
  return cost;
}
