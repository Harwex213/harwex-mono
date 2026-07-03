/**
 * Model layer — battle end & post-battle losses (GDD §11.4, §12, §13 outputs).
 *
 * Two pure rules that turn an in-battle field into the **strategic outputs** a
 * campaign layer consumes, kept free of MobX so they stay unit-testable;
 * {@link BattleStore} wires them onto its observable units:
 *
 * - **`checkBattleEnd` (§11.4)** — a battle is over once one side has **no
 *   standing fighting units** left (all destroyed or routed). The other side
 *   wins; if both are wiped at once it is a draw. Retreat / capitulation /
 *   mutual agreement are strategic-layer triggers (§13) exposed as a flag, not
 *   decided here.
 * - **`postBattleLosses` (§12)** — convert each unit's in-battle HP loss into
 *   **permanent soldier losses**: a unit that **escaped** (left the field with
 *   HP > 0, whether it fought on or merely routed) loses **50% of the health it
 *   lost**; a **destroyed** unit is **lost in full**, with **~half taken
 *   prisoner** (§12.2). **Medics** then reduce an escaped unit's losses by
 *   **10% per rank from II**, capped at **70%** (§12.3) — they cannot heal a
 *   unit that did not escape. Survivors also earn **rank chevrons** (§13).
 */

import type { Rank, Subtype } from './catalog.ts';
import { roundHalfUp } from './stats.ts';
import type { Side } from './types.ts';

/** Permanent losses are 50% of the health lost, for a unit that retreated (§12.1). */
export const RETREAT_LOSS_SHARE = 0.5;

/** Of a unit lost in full, ~half its soldiers are taken prisoner (§12.2). */
export const PRISONER_SHARE = 0.5;

/** A medic reduces losses by 10% per rank from II (§12.3) — rank II is the first step. */
export const MEDIC_REDUCTION_PER_RANK = 0.1;

/** A medic's loss reduction is capped at 70% of the original loss value (§12.3). */
export const MEDIC_REDUCTION_CAP = 0.7;

/** Rank chevrons a surviving unit earns on the winning side (§13). */
export const WIN_CHEVRONS = 2;

/** Rank chevrons a surviving unit earns on the losing side or in a draw (§13). */
export const LOSS_CHEVRONS = 1;

/**
 * The minimum a unit must expose for the end-of-battle rules — satisfied by a
 * `UnitState`. Mirrors the `MoraleSubject` pattern so the engine stays testable
 * without MobX or the full unit model.
 */
export interface BattleSubject {
  id: string;
  name: string;
  side: Side;
  /** Soldiers entering the battle, 0..100 (§3.2). */
  count: number;
  rank: Rank;
  subtype: Subtype;
  /** Entering max HP (post rank/count/strategy, §3.2–3.5). */
  maxHp: number;
  /** Current HP — 0 means destroyed (§11.1). */
  hp: number;
  isAlive: boolean;
  isRouted: boolean;
  /** Whether the unit takes part in combat (special units do not, §4.5). */
  fights: boolean;
}

/** Whether the battle is over and, if so, who won (§11.4). */
export type BattleOutcome = 'ongoing' | 'decisive' | 'draw';

export interface BattleEndResult {
  isOver: boolean;
  /** The victor, or `null` for an ongoing battle or a mutual-destruction draw. */
  winner: Side | null;
  loser: Side | null;
  outcome: BattleOutcome;
}

/** A side still has the field while ≥1 fighting unit stands — alive and un-routed (§11.1, §11.4). */
function standingCount(side: Side, units: readonly BattleSubject[]): number {
  return units.filter((u) => u.side === side && u.fights && u.isAlive && !u.isRouted).length;
}

/**
 * Decide whether the battle has ended (§11.4): it is over once a side has **no
 * standing fighting units** (every combatant destroyed or routed). The side
 * still standing wins; both wiped at once is a draw. Strategic-layer endings
 * (retreat by initiative, capitulation, mutual agreement — §11.4/§13) are not
 * modelled here; pass an explicit override through {@link BattleStore} if needed.
 */
export function checkBattleEnd(units: readonly BattleSubject[]): BattleEndResult {
  const blue = standingCount('blue', units);
  const red = standingCount('red', units);

  if (blue > 0 && red > 0) {
    return { isOver: false, winner: null, loser: null, outcome: 'ongoing' };
  }
  if (blue === 0 && red === 0) {
    return { isOver: true, winner: null, loser: null, outcome: 'draw' };
  }

  const winner: Side = blue > 0 ? 'blue' : 'red';
  const loser: Side = winner === 'blue' ? 'red' : 'blue';
  return { isOver: true, winner, loser, outcome: 'decisive' };
}

/** The loss reduction a medic of `rank` grants (§12.3): 10% per rank from II, capped at 70%. */
export function medicReduction(rank: Rank): number {
  return Math.min(MEDIC_REDUCTION_CAP, MEDIC_REDUCTION_PER_RANK * (rank - 1));
}

/** The best loss reduction available to `side` — its highest-rank medic (§12.3); 0 if none. */
function sideMedicReduction(side: Side, units: readonly BattleSubject[]): number {
  const ranks = units.filter((u) => u.side === side && u.subtype === 'medic').map((u) => u.rank);
  return ranks.length === 0 ? 0 : medicReduction(Math.max(...ranks) as Rank);
}

/** Per-unit permanent losses — the strategic output for one combatant (§12, §13). */
export interface UnitLosses {
  unitId: string;
  unitName: string;
  side: Side;
  /** Soldiers entering the battle. */
  count: number;
  /** Left the field with HP > 0 (survived or routed) — eligible for the 50% rule and medics (§12.1). */
  escaped: boolean;
  /** Destroyed on the field (HP = 0) — lost in full (§12.1). */
  destroyed: boolean;
  /** Routed (morale 0) but not destroyed — counts as an escape (§11.1, §11.3). */
  routed: boolean;
  /** Health lost during the battle (entering max − current). */
  hpLost: number;
  /** Soldiers permanently killed. */
  killed: number;
  /** Soldiers taken prisoner (only for a unit lost in full, §12.2). */
  prisoners: number;
  /** Soldiers returning to the strategic layer. */
  survivors: number;
  /** Fraction by which a medic reduced this unit's losses (0 when none applied). */
  medicReduction: number;
  /** Rank chevrons earned (§13): +2 on the winning side, +1 otherwise; 0 if it did not escape. */
  chevrons: number;
}

/** Compute one unit's permanent losses (§12) given the outcome and its side's medic reduction. */
function lossesFor(
  unit: BattleSubject,
  winner: Side | null,
  reduction: number,
): UnitLosses {
  const escaped = unit.isAlive;
  const destroyed = !unit.isAlive;
  const hpLost = Math.max(0, unit.maxHp - unit.hp);
  const won = winner !== null && unit.side === winner;

  let killed: number;
  let prisoners: number;
  let medicReductionApplied = 0;

  if (destroyed) {
    // Did not retreat → lost in full, ~half taken prisoner (§12.1–12.2). Medics
    // cannot heal a unit that did not escape (§12.3).
    prisoners = roundHalfUp(unit.count * PRISONER_SHARE);
    killed = unit.count - prisoners;
  } else {
    // Retreated → permanent losses are 50% of the HP lost, then reduced by the
    // side's best medic (§12.1, §12.3).
    const fraction = unit.maxHp > 0 ? hpLost / unit.maxHp : 0;
    const rawLoss = unit.count * RETREAT_LOSS_SHARE * fraction;
    medicReductionApplied = reduction;
    killed = roundHalfUp(rawLoss * (1 - reduction));
    prisoners = 0;
  }

  const soldiersLost = killed + prisoners;
  const survivors = Math.max(0, unit.count - soldiersLost);
  const chevrons = escaped ? (won ? WIN_CHEVRONS : LOSS_CHEVRONS) : 0;

  return {
    unitId: unit.id,
    unitName: unit.name,
    side: unit.side,
    count: unit.count,
    escaped,
    destroyed,
    routed: unit.isAlive && unit.isRouted,
    hpLost,
    killed,
    prisoners,
    survivors,
    medicReduction: medicReductionApplied,
    chevrons,
  };
}

/** Aggregated losses for one side (§12, §13). */
export interface SideLossSummary {
  side: Side;
  units: UnitLosses[];
  totalEntering: number;
  totalKilled: number;
  totalPrisoners: number;
  totalSurvivors: number;
}

/** The full battle output: the end result plus each side's per-unit and aggregate losses. */
export interface PostBattleReport {
  end: BattleEndResult;
  blue: SideLossSummary;
  red: SideLossSummary;
}

/** Roll the per-unit losses for one side up into its aggregate totals. */
function summariseSide(side: Side, units: UnitLosses[]): SideLossSummary {
  return {
    side,
    units,
    totalEntering: units.reduce((sum, u) => sum + u.count, 0),
    totalKilled: units.reduce((sum, u) => sum + u.killed, 0),
    totalPrisoners: units.reduce((sum, u) => sum + u.prisoners, 0),
    totalSurvivors: units.reduce((sum, u) => sum + u.survivors, 0),
  };
}

/**
 * Compute the post-battle losses for every **combatant** on the field (§12) and
 * bundle them with the battle-end result (§11.4) as the strategic output (§13).
 * Special units (which do not fight) are excluded — they take no HP damage and
 * are not battlefield casualties; a present **medic** still heals its side's
 * escaped units (§12.3). Pass an explicit `end` to honour a strategic-layer
 * ending (retreat/capitulation, §11.4); otherwise it is derived from the field.
 */
export function postBattleLosses(
  units: readonly BattleSubject[],
  end: BattleEndResult = checkBattleEnd(units),
): PostBattleReport {
  const combatants = units.filter((u) => u.fights);
  const reductions: Record<Side, number> = {
    blue: sideMedicReduction('blue', units),
    red: sideMedicReduction('red', units),
  };

  const losses = combatants.map((u) => lossesFor(u, end.winner, reductions[u.side]));

  return {
    end,
    blue: summariseSide('blue', losses.filter((u) => u.side === 'blue')),
    red: summariseSide('red', losses.filter((u) => u.side === 'red')),
  };
}
