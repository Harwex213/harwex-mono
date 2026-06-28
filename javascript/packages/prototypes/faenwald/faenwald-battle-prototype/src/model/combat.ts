/**
 * Model layer — the damage resolution pipeline (GDD §9).
 *
 * `resolveAttack` is the heart of the engine and the single most test-worthy
 * unit (§15.2): a **pure, deterministic** function turning an attacker, a
 * defender and a tactical context into the two parallel damage results every
 * attack produces — **physical** (→ health) and **morale** (→ morale, §3.1).
 *
 * The shape is normative (§9): both channels start from the same **natural**
 * damage (the attacker's current effective attack, post rank/count/degradation,
 * §9.2), every applicable multiplier multiplies together (§9.3–9.4), the result
 * is clamped to **×3 of natural** (§9.5, cavalry morale exempt) and **rounded
 * once** at the end with round-half-up (§9.6).
 *
 * This phase wires the modifiers determinable from `(attacker, defender, zone)`
 * alone — the zone morale multipliers (§2.2) and the catalog's ranged matchup
 * perks (§4). Terrain/elevation, charge and formation modifiers (§5, §10) are
 * supplied by later phases through {@link AttackContext.physicalModifiers} /
 * {@link AttackContext.moraleModifiers}, so the pipeline composes without
 * branching on each new rule.
 */

import type { Category, UnitPerks } from './catalog.ts';
import { roundHalfUp } from './stats.ts';
import type { Zone } from './types.ts';

/** A unit cannot deal more than this multiple of its natural damage (§9.5). */
export const DAMAGE_CAP_MULTIPLIER = 3;

/** Morale multiplier for a hit landing from a flank hex (§2.2). */
export const FLANK_MORALE_MULTIPLIER = 1.25;

/** Morale multiplier for a hit landing from a rear hex (§2.2). */
export const REAR_MORALE_MULTIPLIER = 1.5;

/** The attacker facts the pipeline needs — satisfied by a `UnitState`. */
export interface Attacker {
  category: Category;
  /** Current effective attack — already includes rank/count/degradation (§9.2). */
  attack: number;
  perks: UnitPerks;
}

/** The defender facts the pipeline needs — satisfied by a `UnitState`. */
export interface Defender {
  category: Category;
  perks: UnitPerks;
}

/** Tactical inputs to one attack beyond the two units themselves. */
export interface AttackContext {
  /** Which of the defender's zones the attacking hex falls in (§2.2). */
  zone: Zone;
  /**
   * Extra physical-channel multipliers from terrain/elevation/charge/formation
   * (§5, §10) — supplied by later phases. Each is shown in the damage preview.
   */
  physicalModifiers?: AppliedModifier[];
  /** Extra morale-channel multipliers (§5, §10) — supplied by later phases. */
  moraleModifiers?: AppliedModifier[];
}

/** A single named multiplier applied in the pipeline; drives the damage preview. */
export interface AppliedModifier {
  /** Human-readable source, e.g. `"Rear hit (morale)"`. */
  label: string;
  /** Multiplicative factor, e.g. `1.5`. */
  value: number;
}

/** The resolved damage on one channel, with the full multiplier breakdown. */
export interface ChannelResult {
  /** Natural damage the channel started from (§9.2). */
  natural: number;
  /** Every multiplier applied, in collection order (for the preview, item 13). */
  modifiers: AppliedModifier[];
  /** `natural × Π(modifiers)`, before cap and rounding. */
  raw: number;
  /** Whether the ×3 cap clamped this channel (§9.5). */
  capped: boolean;
  /** Final integer damage, rounded once at the end (§9.6). */
  damage: number;
}

/** The two parallel results of one attack (§9). */
export interface AttackResult {
  physical: ChannelResult;
  morale: ChannelResult;
  /**
   * Charge damage reflected back onto a charging cavalry attacker by a spearmen
   * unit in close formation (§5.1.4, §9.8). Set by the action layer (it needs
   * the board to know formation coverage); absent for ordinary attacks.
   */
  reflected?: number;
}

/** Product of a modifier list (1 when empty). */
function product(modifiers: AppliedModifier[]): number {
  return modifiers.reduce((acc, m) => acc * m.value, 1);
}

/**
 * Resolve one channel: multiply the factors onto `natural`, clamp to the ×3 cap
 * unless exempt (§9.5), then round once (§9.6). Full precision is kept through
 * the multiply; only the final value is rounded.
 */
function resolveChannel(natural: number, modifiers: AppliedModifier[], capped: boolean): ChannelResult {
  const raw = natural * product(modifiers);
  const cap = DAMAGE_CAP_MULTIPLIER * natural;
  const wasCapped = capped && raw > cap;
  const clamped = wasCapped ? cap : raw;
  return { natural, modifiers, raw, capped: wasCapped, damage: roundHalfUp(clamped) };
}

/**
 * The morale multiplier for a hit landing from `zone` (§2.2). Front is the
 * ×1.0 baseline (no modifier); shock infantry treat their rear as a flank for
 * morale (§4.2), so a rear hit on them is ×1.25 rather than ×1.5.
 */
function zoneMoraleModifier(zone: Zone, defender: Defender): AppliedModifier | null {
  if (zone === 'flank') {
    return { label: 'Flank hit', value: FLANK_MORALE_MULTIPLIER };
  }
  if (zone === 'rear') {
    if (defender.perks.rearActsAsFlank) {
      return { label: 'Rear hit (counts as flank)', value: FLANK_MORALE_MULTIPLIER };
    }
    return { label: 'Rear hit', value: REAR_MORALE_MULTIPLIER };
  }
  return null;
}

/**
 * Collect the matchup multipliers determinable from the two units' catalog
 * perks (§4, §9.3). Currently the **ranged** matchups: a defender's
 * `takesFromRanged` when struck by a ranged attacker, and an attacker's
 * `dealsToRanged` when striking a ranged defender (light cavalry ×1.5, §4.3).
 */
function matchupPhysicalModifiers(attacker: Attacker, defender: Defender): AppliedModifier[] {
  const modifiers: AppliedModifier[] = [];

  if (attacker.category === 'ranged' && defender.perks.takesFromRanged !== undefined) {
    // Crossbow "full damage to heavy" (§4.4): skip the defender's anti-ranged
    // reduction (a factor below 1); vulnerabilities (≥1) still apply.
    const reductionExempt = attacker.perks.ignoresAntiRangedReduction && defender.perks.takesFromRanged < 1;
    if (!reductionExempt) {
      modifiers.push({ label: `Takes ×${defender.perks.takesFromRanged} from ranged`, value: defender.perks.takesFromRanged });
    }
  }
  if (defender.category === 'ranged' && attacker.perks.dealsToRanged !== undefined) {
    modifiers.push({ label: `Deals ×${attacker.perks.dealsToRanged} to ranged`, value: attacker.perks.dealsToRanged });
  }

  return modifiers;
}

/**
 * `resolveAttack(attacker, defender, context)` (§9) — the pure pipeline.
 * Returns the physical and morale channels with their full multiplier
 * breakdowns. The ×3 cap applies to both channels **except** cavalry morale,
 * which is never capped (§9.5).
 */
export function resolveAttack(attacker: Attacker, defender: Defender, context: AttackContext): AttackResult {
  const natural = attacker.attack;

  // Physical: matchup perks + any terrain/charge/formation factors from later phases.
  const physicalModifiers = [
    ...matchupPhysicalModifiers(attacker, defender),
    ...(context.physicalModifiers ?? []),
  ];

  // Morale: the zone multiplier (front = baseline) + later-phase factors.
  const moraleModifiers: AppliedModifier[] = [];
  const zoneModifier = zoneMoraleModifier(context.zone, defender);
  if (zoneModifier) moraleModifiers.push(zoneModifier);
  moraleModifiers.push(...(context.moraleModifiers ?? []));

  const cavalryMoraleExempt = attacker.category === 'cavalry';

  return {
    physical: resolveChannel(natural, physicalModifiers, true),
    morale: resolveChannel(natural, moraleModifiers, !cavalryMoraleExempt),
  };
}
