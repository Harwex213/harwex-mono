/**
 * Model layer — unit actions (GDD §7, §5, §11.1).
 *
 * The pure logic behind a unit's turn: **Attack**, **Move**, **Turn** (§7) and
 * the category specials wired in phase 4 — the lateral shuffle and charge
 * reflection of Close Formation (§5.1), the cavalry charge run, Maneuverability
 * and Dismount/Mount (§5.3), shock-infantry **Breakthrough** (§5.2) and the
 * three ranged firing modes (§5.4). Kept free of MobX and the API layer so the
 * rules stay unit-testable in isolation; {@link BattleStore} is a thin wrapper
 * that calls these against its observable {@link UnitState}s and {@link Board}.
 *
 * Ability modifiers are assembled into the {@link AttackContext} by
 * {@link attackContext} and resolved by the pure §9 pipeline, so each rule
 * composes without the pipeline branching on it.
 */

import type { Board } from './board.ts';
import { canBreakthrough, planBreakthrough } from './breakthrough.ts';
import { chargeModifiers, isCharging } from './charge.ts';
import { resolveAttack, type AppliedModifier, type AttackContext, type AttackResult } from './combat.ts';
import { closeFormationDefenseModifiers, hasFormationBonus } from './formation.ts';
import { distance, hexEquals } from './hex.ts';
import { canFireAt, rangedModeModifiers, type RangedMode } from './ranged.ts';
import { moveCost, terrainPhysicalModifiers } from './terrain-effects.ts';
import type { UnitState } from './unit-state.ts';
import { flankHexes, frontHexes, isInFront, rearHexes, zoneOf } from './zones.ts';
import type { Axial, Facing } from './types.ts';

/** A lateral shuffle costs ×2 the normal movement (§5.1.2). */
export const SHUFFLE_COST_MULTIPLIER = 2;

/** A unit can still act this turn — it fights, is alive and has not routed (§11.1). */
export function isActive(unit: UnitState): boolean {
  return unit.def.fights && unit.isAlive && !unit.isRouted;
}

/** The unit occupying `hex`, if any (one unit per hex, §2.1). */
function unitAt(hex: Axial, units: readonly UnitState[]): UnitState | undefined {
  return units.find((unit) => hexEquals(unit.hex, hex));
}

/** Cavalry Maneuverability lets a unit move **after** attacking (§5.3). */
function canMoveAfterAttack(unit: UnitState): boolean {
  return unit.def.abilities.includes('maneuverability');
}

/**
 * Whether `attacker` may make a basic melee attack on `defender` this turn:
 * both active enemies, the attacker has not attacked yet, and the defender
 * stands in one of the attacker's two front hexes (§7.1).
 */
export function canAttack(attacker: UnitState, defender: UnitState): boolean {
  return (
    isActive(attacker) &&
    defender.isAlive &&
    attacker.side !== defender.side &&
    !attacker.hasAttacked &&
    distance(attacker.hex, defender.hex) === 1 &&
    isInFront(attacker, defender.hex)
  );
}

/** Enemies `attacker` could legally attack right now — for the UI to offer. */
export function targetableEnemies(attacker: UnitState, units: UnitState[]): UnitState[] {
  return units.filter((unit) => canAttack(attacker, unit));
}

/** Optional inputs to building an {@link AttackContext} — the board, the units and a ranged mode. */
export interface AttackOptions {
  board?: Board;
  units?: readonly UnitState[];
  /** Ranged firing mode (§5.4); set for ranged attacks so the mode multiplier applies. */
  mode?: RangedMode;
}

/**
 * The §9 context for an attack: the zone the attacker falls in vs the defender's
 * facing (§2.2), plus every applicable ability/terrain modifier collected per
 * channel — terrain & elevation (§10), the cavalry charge (§5.3), Close-Formation
 * defense on a spearmen target (§5.1) and, for ranged attacks, the mode
 * multiplier (§5.4). They flow into the pipeline and surface in the damage preview.
 */
export function attackContext(attacker: UnitState, defender: UnitState, opts: AttackOptions = {}): AttackContext {
  const zone = zoneOf(attacker.hex, defender);
  const physicalModifiers: AppliedModifier[] = [];
  const moraleModifiers: AppliedModifier[] = [];

  if (opts.board) {
    physicalModifiers.push(...terrainPhysicalModifiers(attacker, defender, opts.board));
  }

  // Cavalry charge — physical multiplier + anti-charge + rear-deal, and the ≥3-hex morale bonus (§5.3).
  const charge = chargeModifiers(attacker, defender, zone);
  physicalModifiers.push(...charge.physical);
  moraleModifiers.push(...charge.morale);

  // Close-Formation shielding / rear vulnerability on a spearmen defender (§5.1).
  if (opts.board && opts.units) {
    const formation = closeFormationDefenseModifiers(defender, zone, opts.board, opts.units);
    physicalModifiers.push(...formation.physical);
    moraleModifiers.push(...formation.morale);
  }

  // Ranged firing mode multiplier (§5.4).
  if (opts.mode) {
    physicalModifiers.push(...rangedModeModifiers(attacker, opts.mode));
  }

  return { zone, physicalModifiers, moraleModifiers };
}

/** Resolve a prospective attack **without** mutating — drives the damage preview (item 13). */
export function previewAttack(
  attacker: UnitState,
  defender: UnitState,
  board?: Board,
  units?: readonly UnitState[],
): AttackResult {
  return resolveAttack(attacker, defender, attackContext(attacker, defender, { board, units }));
}

/**
 * Apply a resolved attack's two channels onto the defender (§9, §11.1). For a
 * cavalry charge, **morale is applied before physical** (§9.7) and, if the
 * defender is a spearmen unit hit in its front while holding a Close-Formation
 * bonus, the charge is **reflected** back onto the attacker (§5.1.4) — recorded
 * on the result but **not** counted as an action.
 */
function applyDamage(
  attacker: UnitState,
  defender: UnitState,
  result: AttackResult,
  board?: Board,
  units?: readonly UnitState[],
): void {
  const charging = isCharging(attacker);

  if (charging) {
    defender.morale = Math.max(0, defender.morale - result.morale.damage);
    defender.hp = Math.max(0, defender.hp - result.physical.damage);
  } else {
    defender.hp = Math.max(0, defender.hp - result.physical.damage);
    defender.morale = Math.max(0, defender.morale - result.morale.damage);
  }

  if (
    charging &&
    board &&
    units &&
    defender.category === 'spear' &&
    zoneOf(attacker.hex, defender) === 'front' &&
    hasFormationBonus(defender, board, units)
  ) {
    // Reflect the charge's physical hit back onto the cavalry (🟡 §14.6).
    const reflected = result.physical.damage;
    attacker.hp = Math.max(0, attacker.hp - reflected);
    result.reflected = reflected;
  }
}

/**
 * Apply a basic melee Attack (§7.1, §9): resolve the dual-channel damage, apply
 * it in the correct order with any charge reflection, and mark the attacker as
 * having acted. Returns the resolved result, or `null` when the attack is illegal.
 */
export function performAttack(
  attacker: UnitState,
  defender: UnitState,
  board?: Board,
  units?: readonly UnitState[],
): AttackResult | null {
  if (!canAttack(attacker, defender)) return null;

  const result = resolveAttack(attacker, defender, attackContext(attacker, defender, { board, units }));
  applyDamage(attacker, defender, result, board, units);

  attacker.hasAttacked = true;
  attacker.hasActed = true;
  return result;
}

/** A hex is enterable — on the board, passable and unoccupied (§2.1, §7.2). */
function canEnter(hex: Axial, board: Board, units: readonly UnitState[]): boolean {
  const tile = board.get(hex);
  return tile !== undefined && tile.isPassable && unitAt(hex, units) === undefined;
}

/**
 * The hexes a unit may move into this turn (§7.2, §5.1.2): the two **front**
 * hexes for any unit, plus — for spearmen — the **flank/rear** hexes reachable
 * by a lateral shuffle at ×2 cost. Each is filtered by passability, occupancy
 * and the unit's remaining movement after the terrain cost. A unit that has
 * attacked may still move only if it has Maneuverability (§5.3).
 */
export function moveTargets(unit: UnitState, board: Board, units: readonly UnitState[]): Axial[] {
  if (!isActive(unit)) return [];
  if (unit.madeOpportunityAttack) return []; // after an opportunity attack a unit may only turn (§8)
  if (unit.hasAttacked && !canMoveAfterAttack(unit)) return [];
  const from = board.get(unit.hex);
  if (!from) return [];

  const targets: Axial[] = [];

  for (const hex of frontHexes(unit)) {
    const tile = board.get(hex);
    if (tile && canEnter(hex, board, units) && moveCost(unit, from, tile) <= unit.movementLeft) {
      targets.push(hex);
    }
  }

  // Lateral shuffle — spearmen step sideways/back without turning at ×2 cost (§5.1.2).
  if (unit.category === 'spear') {
    for (const hex of [...flankHexes(unit), ...rearHexes(unit)]) {
      const tile = board.get(hex);
      if (tile && canEnter(hex, board, units) && SHUFFLE_COST_MULTIPLIER * moveCost(unit, from, tile) <= unit.movementLeft) {
        targets.push(hex);
      }
    }
  }

  return targets;
}

/**
 * Move a unit one hex (§7.2). A **front** step spends the hex's terrain cost and,
 * for cavalry, extends the charge run (§5.3); a **lateral shuffle** (spearmen
 * into a flank/rear hex) costs ×2 and leaves facing unchanged (§5.1.2). Returns
 * whether the move happened.
 */
export function performMove(unit: UnitState, target: Axial, board: Board, units: readonly UnitState[]): boolean {
  if (!moveTargets(unit, board, units).some((hex) => hexEquals(hex, target))) return false;

  const from = board.get(unit.hex)!;
  const to = board.get(target)!;
  const isFrontStep = frontHexes(unit).some((hex) => hexEquals(hex, target));
  const cost = isFrontStep ? moveCost(unit, from, to) : SHUFFLE_COST_MULTIPLIER * moveCost(unit, from, to);

  unit.hex = target;
  unit.movementLeft -= cost;
  unit.hasActed = true;
  // A straight forward step builds the cavalry charge run; a shuffle does not (§5.3).
  if (unit.category === 'cavalry' && isFrontStep) unit.chargeHexes += 1;
  return true;
}

/**
 * Reorient a unit to a new facing (§7.2). Heavy units turn once per turn for
 * free; otherwise a turn costs 1 hex of movement. Turning **breaks the charge
 * run** (§5.3). A unit cannot turn after attacking unless it has Maneuverability.
 * Returns whether the turn happened.
 */
export function performTurn(unit: UnitState, facing: Facing): boolean {
  if (!isActive(unit) || facing === unit.facing) return false;
  // After an opportunity attack the unit is spent for offence but may still turn (§8).
  if (unit.hasAttacked && !canMoveAfterAttack(unit) && !unit.madeOpportunityAttack) return false;

  if (unit.isHeavy && !unit.freeTurnUsed) {
    unit.freeTurnUsed = true;
  } else if (unit.movementLeft >= 1) {
    unit.movementLeft -= 1;
  } else {
    return false;
  }

  unit.facing = facing;
  unit.chargeHexes = 0; // a turn ends the straight run (§5.3)
  unit.hasActed = true;
  return true;
}

/**
 * Perform a shock-infantry **Breakthrough** push after an attack (§5.2): if the
 * `combinedDamage` dealt this turn meets the threshold and a relocation plan
 * resolves, push the target (and any chain behind it) and advance the attacker
 * into the vacated hex. Returns whether the breakthrough happened. The threshold
 * is measured against the target's **entering** attack stat (un-bloodied).
 */
export function performBreakthrough(
  attacker: UnitState,
  defender: UnitState,
  combinedDamage: number,
  board: Board,
  units: readonly UnitState[],
): boolean {
  if (distance(attacker.hex, defender.hex) !== 1) return false;
  const target = { id: defender.id, hex: defender.hex, facing: defender.facing, attack: defender.enteringAttack };
  if (!canBreakthrough(attacker, target, combinedDamage)) return false;

  const plan = planBreakthrough(attacker, target, board, units);
  if (!plan) return false;

  for (const push of plan.pushes) {
    const unit = units.find((u) => u.id === push.id);
    if (unit) unit.hex = push.to;
  }
  attacker.hex = plan.attackerTo;
  return true;
}

/**
 * Whether `firer` may fire on `defender` in `mode` this turn (§5.4, §4.4):
 * an active enemy, the firer has the ranged ability and has not attacked, and
 * the shot is legal per range/arc/line-of-fire/ammo/reload.
 */
export function canRangedAttack(
  firer: UnitState,
  defender: UnitState,
  mode: RangedMode,
  board: Board,
  units: readonly UnitState[],
  currentTurn: number,
): boolean {
  return (
    isActive(firer) &&
    defender.isAlive &&
    firer.side !== defender.side &&
    !firer.hasAttacked &&
    firer.def.abilities.includes('rangedAttack') &&
    canFireAt(firer, defender.hex, mode, board, units, currentTurn)
  );
}

/** Enemies `firer` could hit in `mode` right now — for the UI to offer (§5.4). */
export function rangedTargets(
  firer: UnitState,
  mode: RangedMode,
  board: Board,
  units: readonly UnitState[],
  currentTurn: number,
): UnitState[] {
  return units.filter((unit) => canRangedAttack(firer, unit, mode, board, units, currentTurn));
}

/**
 * Fire a ranged shot (§5.4, §4.4): resolve the dual-channel damage with the mode
 * multiplier, apply it, spend a shot and stamp the firing turn (for the crossbow
 * cadence). Returns the result, or `null` when the shot is illegal.
 */
export function performRangedAttack(
  firer: UnitState,
  defender: UnitState,
  mode: RangedMode,
  board: Board,
  units: readonly UnitState[],
  currentTurn: number,
): AttackResult | null {
  if (!canRangedAttack(firer, defender, mode, board, units, currentTurn)) return null;

  const result = resolveAttack(firer, defender, attackContext(firer, defender, { board, units, mode }));
  defender.hp = Math.max(0, defender.hp - result.physical.damage);
  defender.morale = Math.max(0, defender.morale - result.morale.damage);

  firer.shotsLeft -= 1;
  firer.lastFiredTurn = currentTurn;
  firer.hasAttacked = true;
  firer.hasActed = true;
  return result;
}
