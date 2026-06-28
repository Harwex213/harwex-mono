/**
 * Model layer — cavalry Ram Strike & charge modifiers (GDD §5.3, §9.3).
 *
 * Pure helpers for the offensive/defensive multipliers a **cavalry charge**
 * contributes to the §9 pipeline, plus the reflected-charge figure spearmen
 * bounce back (§5.1.4 / §9.8). The per-hex **accumulation** of a charge run is
 * transient state tracked on the {@link UnitState} (its `chargeHexes`), updated
 * by the movement actions; this module only turns a `(ramMod, hexes)` pair into
 * the modifiers an attack made after the run picks up.
 *
 * Ram Strike (§5.3):
 * - Each consecutive hex moved **straight forward** adds **+ramMod%** to charge
 *   damage; the physical multiplier is `1 + ramMod·hexes/100` (§9.3).
 * - A run of **≥3 hexes** also deals **×1.25 morale**.
 * - Cavalry morale is never capped (handled in `combat.ts`), and morale is
 *   applied **before** physical (§9.7, ordering enforced in `actions.ts`).
 */

import type { Category, UnitPerks } from './catalog.ts';
import type { AppliedModifier } from './combat.ts';
import type { Zone } from './types.ts';

/** A run of at least this many hexes adds the charge morale multiplier (§5.3). */
export const CHARGE_MORALE_MIN_HEXES = 3;
/** Morale multiplier for a charge run of {@link CHARGE_MORALE_MIN_HEXES}+ hexes (§5.3). */
export const CHARGE_MORALE_MULTIPLIER = 1.25;

/** The attacker facts the charge helpers need — satisfied by a {@link UnitState}. */
export interface ChargeAttacker {
  category: Category;
  /** Charge accumulation per consecutive hex, % (cavalry only, §4.3). */
  ramMod?: number;
  /** Consecutive hexes moved straight forward this turn (§5.3). */
  chargeHexes: number;
  perks: UnitPerks;
}

/** The defender facts the charge helpers need. */
export interface ChargeDefender {
  perks: UnitPerks;
}

/** Whether `attacker` strikes with an active cavalry charge this exchange (§5.3). */
export function isCharging(attacker: ChargeAttacker): boolean {
  return attacker.category === 'cavalry' && (attacker.ramMod ?? 0) > 0 && attacker.chargeHexes > 0;
}

/**
 * The charge **physical** multiplier `1 + ramMod·hexes/100` (§9.3) for the run
 * built this turn. Returns `null` when there is no active charge.
 */
export function chargePhysicalModifier(attacker: ChargeAttacker): AppliedModifier | null {
  if (!isCharging(attacker)) return null;
  const value = 1 + (attacker.ramMod! * attacker.chargeHexes) / 100;
  return { label: `Charge ${attacker.chargeHexes} hex (×${round2(value)})`, value };
}

/** The charge **morale** ×1.25 for a run of ≥3 hexes (§5.3); `null` otherwise. */
export function chargeMoraleModifier(attacker: ChargeAttacker): AppliedModifier | null {
  if (!isCharging(attacker) || attacker.chargeHexes < CHARGE_MORALE_MIN_HEXES) return null;
  return { label: 'Charge ≥3 hexes', value: CHARGE_MORALE_MULTIPLIER };
}

/**
 * The defender's anti-charge **physical** reduction (×0.75/×0.5, §4.1–4.3),
 * applied only when actually struck by a charging cavalry attacker.
 */
export function antiChargeModifier(attacker: ChargeAttacker, defender: ChargeDefender): AppliedModifier | null {
  if (!isCharging(attacker) || defender.perks.takesFromCharge === undefined) return null;
  return { label: `Takes ×${defender.perks.takesFromCharge} from charge`, value: defender.perks.takesFromCharge };
}

/**
 * A unit's bonus **physical** damage into a defender's rear (§4.3) — light
 * cavalry ×1.5, medium +×0.25, horse archer ×1.5. Applies only on rear hits.
 */
export function rearDealModifier(attackerPerks: UnitPerks, zone: Zone): AppliedModifier | null {
  if (zone !== 'rear' || attackerPerks.dealsToRear === undefined) return null;
  return { label: `Deals ×${attackerPerks.dealsToRear} to rear`, value: attackerPerks.dealsToRear };
}

/**
 * All charge-derived modifiers for an attack, split per channel (§5.3, §9.3):
 * the charge physical multiplier and anti-charge reduction and the rear-deal
 * bonus on the physical side, the ≥3-hex charge bonus on the morale side.
 */
export function chargeModifiers(
  attacker: ChargeAttacker,
  defender: ChargeDefender,
  zone: Zone,
): { physical: AppliedModifier[]; morale: AppliedModifier[] } {
  const physical: AppliedModifier[] = [];
  const morale: AppliedModifier[] = [];

  const chargePhysical = chargePhysicalModifier(attacker);
  if (chargePhysical) physical.push(chargePhysical);

  const antiCharge = antiChargeModifier(attacker, defender);
  if (antiCharge) physical.push(antiCharge);

  const rearDeal = rearDealModifier(attacker.perks, zone);
  if (rearDeal) physical.push(rearDeal);

  const chargeMorale = chargeMoraleModifier(attacker);
  if (chargeMorale) morale.push(chargeMorale);

  return { physical, morale };
}

/** Round to 2 decimals for the modifier label (display only; the math keeps full precision). */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
