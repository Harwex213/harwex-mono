/**
 * Model layer — Ranged Attack (GDD §5.4, §4.4), the archer ability.
 *
 * Pure helpers for the three firing modes, the cone-shaped firing arc, line of
 * fire, ammo and resupply, plus the crossbow and horse-archer special rules.
 * Targeting and damage flow through the same §9 pipeline as melee: the **mode
 * multiplier** (and the crossbow close penalty) are physical modifiers fed into
 * the {@link AttackContext}; cover (§10) and the `takesFromRanged` matchup (§4)
 * are already collected by `terrain-effects.ts` / `combat.ts`.
 *
 * Modes (§5.4):
 * - **Arcing** ×1 — fires over units; blocked by mountains and onto forest /
 *   settlement targets.
 * - **Direct** ×2 — "hex-through-hex"; cannot fire over units unless they sit a
 *   level below the firer, nor through forest.
 * - **Close** ×0.5 — adjacent only; the firer takes ×1.5 morale (§5.4),
 *   surfaced as {@link CLOSE_COMBAT_SELF_MORALE} for the reactive layer.
 *
 * Range scales with the firer's elevation (+1 on foothill, +2 on hill, §5.4) —
 * except the horse archer, which gets no hill bonuses (§4.4).
 */

import type { Board } from './board.ts';
import type { Category, Subtype, UnitDef } from './catalog.ts';
import type { AppliedModifier } from './combat.ts';
import { distance, hexEquals, lineDraw } from './hex.ts';
import { lineOfFireBlocked } from './terrain-effects.ts';
import type { Elevation } from './terrain.ts';
import { zoneOf } from './zones.ts';
import type { Axial, Facing } from './types.ts';

/** The three firing modes (§5.4). */
export type RangedMode = 'arcing' | 'direct' | 'close';

/** Physical-damage multiplier per mode (§5.4, Appendix A). */
export const RANGED_MODE_MULTIPLIER: Record<RangedMode, number> = {
  arcing: 1,
  direct: 2,
  close: 0.5,
};

/** Crossbow close-combat physical penalty (§4.4), stacking with the ×0.5 close mode. */
export const CROSSBOW_CLOSE_PENALTY = 0.75;

/** Morale the firer takes when firing in close combat (§5.4) — applied by the reactive layer. */
export const CLOSE_COMBAT_SELF_MORALE = 1.5;

/** Turns a crossbow must wait between shots — it fires once per 2 turns (§4.4). */
export const CROSSBOW_RELOAD_TURNS = 2;

/** A carrier can resupply at most this many archer units (§4.4). */
export const RESUPPLY_CARRIER_LIMIT = 3;

/** The firer facts the ranged helpers need — satisfied by a {@link UnitState}. */
export interface RangedFirer {
  def: UnitDef;
  category: Category;
  hex: Axial;
  facing: Facing;
  /** Remaining shots this battle (§4.4). */
  shotsLeft: number;
  /** Battle turn this unit last fired, for the crossbow cadence (§4.4); `null` if never. */
  lastFiredTurn: number | null;
}

/** Anything occupying a hex the line of fire must account for (§2.1). */
export interface Occupant {
  hex: Axial;
}

/** Base range for a subtype in a mode, before the elevation bonus; `null` if unavailable. */
function baseRange(subtype: Subtype, mode: RangedMode): number | null {
  if (mode === 'close') return 1; // every ranged unit can fight an adjacent enemy
  if (mode === 'arcing') {
    if (subtype === 'crossbow') return null; // crossbows have no arc (§4.4)
    if (subtype === 'horseArcher') return 2; // arcing 2 hexes (§4.4)
    return 4; // archer, longbow (§5.4)
  }
  // direct
  if (subtype === 'horseArcher') return 1; // adjacent hex only (§4.4)
  if (subtype === 'crossbow') return 3; // +1 hex over the archer's 2 (§4.4)
  return 2; // archer, longbow — "hex-through-hex" reaches the 2nd hex (🟡 §14.2)
}

/** Range a firer's elevation adds to its ranged/direct shots (§5.4); horse archers get none (§4.4). */
export function elevationRangeBonus(subtype: Subtype, firerElevation: Elevation): number {
  return subtype === 'horseArcher' ? 0 : firerElevation;
}

/** Effective range of `def` in `mode` from a hex at `firerElevation` (§5.4); `null` if unavailable. */
export function modeRange(def: UnitDef, mode: RangedMode, firerElevation: Elevation): number | null {
  const base = baseRange(def.subtype, mode);
  if (base === null) return null;
  return mode === 'close' ? base : base + elevationRangeBonus(def.subtype, firerElevation);
}

/** The firing modes available to `def` (§5.4) — crossbows drop arcing. */
export function availableModes(def: UnitDef): RangedMode[] {
  return (['arcing', 'direct', 'close'] as RangedMode[]).filter((mode) => baseRange(def.subtype, mode) !== null);
}

/** Whether a crossbow's 2-turn reload has elapsed by `currentTurn` (§4.4); always true for others. */
export function reloaded(firer: RangedFirer, currentTurn: number): boolean {
  if (firer.def.subtype !== 'crossbow' || firer.lastFiredTurn === null) return true;
  return currentTurn - firer.lastFiredTurn >= CROSSBOW_RELOAD_TURNS;
}

/**
 * Whether `targetHex` lies in the firer's firing arc. Most ranged units fire
 * only into their **front** cone (§2.3); the horse archer may also fire into its
 * **flank and rear** hexes (§4.4), so any direction is in arc for it.
 */
function inFiringArc(firer: RangedFirer, targetHex: Axial): boolean {
  if (firer.def.subtype === 'horseArcher') return true;
  return zoneOf(targetHex, { hex: firer.hex, facing: firer.facing }) === 'front';
}

/**
 * Whether direct fire is obstructed between firer and target (§5.4). A unit on
 * an intervening hex blocks unless it stands a level **below** the firer; forest
 * on an intervening hex also blocks. Endpoints are excluded.
 */
function directFireObstructed(
  firer: RangedFirer,
  targetHex: Axial,
  firerElevation: Elevation,
  board: Board,
  units: readonly Occupant[],
): boolean {
  const line = lineDraw(firer.hex, targetHex);
  for (let i = 1; i < line.length - 1; i++) {
    const hex = line[i];
    const tile = board.get(hex);
    if (tile?.terrain === 'forest') return true; // forest between firer and target blocks direct fire (§10)
    const blockerElevation = tile?.elevation ?? 0;
    const occupied = units.some((unit) => hexEquals(unit.hex, hex));
    if (occupied && blockerElevation >= firerElevation) return true; // can only shoot over units a level below (§5.4)
  }
  return false;
}

/**
 * Whether `firer` may fire at `targetHex` in `mode` on `currentTurn` (§5.4,
 * §4.4): ammo and reload permitting, within range and arc, with line of fire
 * unobstructed and the mode-specific terrain restrictions respected.
 */
export function canFireAt(
  firer: RangedFirer,
  targetHex: Axial,
  mode: RangedMode,
  board: Board,
  units: readonly Occupant[],
  currentTurn: number,
): boolean {
  if (firer.category !== 'ranged' || firer.shotsLeft <= 0 || !reloaded(firer, currentTurn)) return false;

  const firerTile = board.get(firer.hex);
  const targetTile = board.get(targetHex);
  if (!firerTile || !targetTile) return false;

  const range = modeRange(firer.def, mode, firerTile.elevation);
  if (range === null) return false;

  const dist = distance(firer.hex, targetHex);
  if (dist < 1 || dist > range) return false;
  if (mode === 'close' && dist !== 1) return false;
  if (!inFiringArc(firer, targetHex)) return false;

  // Mountains block all fire (§2.3, §10).
  if (lineOfFireBlocked(firer.hex, targetHex, board)) return false;

  if (mode === 'arcing') {
    // No unit on a settlement may be targeted by arcing fire; arcing cannot land
    // on a forest hex either (§10).
    if (targetTile.terrain === 'settlement' || targetTile.terrain === 'forest') return false;
  } else if (mode === 'direct') {
    if (directFireObstructed(firer, targetHex, firerTile.elevation, board, units)) return false;
  }

  return true;
}

/**
 * The physical-channel modifiers a ranged shot contributes (§5.4): the mode
 * multiplier and, for a crossbow firing in close combat, its ×0.75 penalty. The
 * cover (§10) and `takesFromRanged` matchup (§4) factors are added elsewhere in
 * the pipeline.
 */
export function rangedModeModifiers(firer: RangedFirer, mode: RangedMode): AppliedModifier[] {
  const modifiers: AppliedModifier[] = [
    { label: `${capitalize(mode)} fire (×${RANGED_MODE_MULTIPLIER[mode]})`, value: RANGED_MODE_MULTIPLIER[mode] },
  ];
  if (mode === 'close' && firer.def.subtype === 'crossbow') {
    modifiers.push({ label: `Crossbow close combat (×${CROSSBOW_CLOSE_PENALTY})`, value: CROSSBOW_CLOSE_PENALTY });
  }
  return modifiers;
}

/**
 * Whether a hex sits on a **supply edge** of the board — the northernmost or
 * southernmost row (§4.4), where a spent unit refills its arrows.
 */
export function isSupplyEdge(hex: Axial, board: Board): boolean {
  const { minR, maxR } = board.bounds;
  return hex.r === minR || hex.r === maxR;
}

/** Capitalise a mode name for a modifier label, e.g. `"arcing"` → `"Arcing"`. */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
