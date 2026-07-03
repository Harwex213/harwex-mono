/**
 * Model layer — opportunity attacks (GDD §8), the reactive free strike.
 *
 * When a unit **moves into the attack zone of an enemy** — a cavalry rides into
 * an archer's range, or steps adjacent to a waiting spear — that enemy may make
 * a **free reactive attack, immediately and out of initiative order** (§8). This
 * module decides *who* may react to a mover arriving on a hex and resolves the
 * strike through the same §9 pipeline as any other attack.
 *
 * The four §8 restrictions are enforced here:
 * - a threat that has **already attacked this turn** cannot react;
 * - **Breakthrough (§5.2) is never used** in an opportunity attack — this path
 *   simply does not offer it;
 * - **light cavalry cannot be the target of a *ranged* opportunity attack**
 *   (§4.3) — a melee reaction against it is still allowed;
 * - a unit that performs **no action** cannot be opportunity-attacked — the
 *   caller only consults this module when the mover actually moves (§8).
 *
 * After reacting, a threat is **considered to have acted** and may then *only
 * turn* (§8); the {@link UnitState.madeOpportunityAttack} flag carries that into
 * the action rules. The mover, per §8, **may continue its movement**.
 */

import type { Board } from './board.ts';
import { attackContext, isActive } from './actions.ts';
import { resolveAttack, type AttackResult } from './combat.ts';
import { distance } from './hex.ts';
import { canFireAt, RANGED_MODE_MULTIPLIER, type RangedMode } from './ranged.ts';
import type { UnitState } from './unit-state.ts';
import { isInFront } from './zones.ts';
import type { Axial } from './types.ts';

/** How a threat would react: a standing melee blow, or a ranged shot in some mode (§8). */
export type OpportunityKind = 'melee' | RangedMode;

/** An available opportunity reaction — a threatening unit and the strike it would make. */
export interface OpportunityOffer {
  threat: UnitState;
  kind: OpportunityKind;
}

/** The result of a resolved opportunity attack — the damage and how it was delivered. */
export interface OpportunityOutcome {
  kind: OpportunityKind;
  result: AttackResult;
}

/** Whether `unit` is light cavalry — immune to *ranged* opportunity attacks (§4.3, §8). */
function isLightCavalry(unit: UnitState): boolean {
  return unit.category === 'cavalry' && unit.subtype === 'light';
}

/** Ranged firing modes ordered by raw damage, strongest first — direct ×2, arcing ×1, close ×0.5. */
const MODES_BY_STRENGTH: readonly RangedMode[] = (['direct', 'arcing', 'close'] as RangedMode[]).sort(
  (a, b) => RANGED_MODE_MULTIPLIER[b] - RANGED_MODE_MULTIPLIER[a],
);

/**
 * The strongest legal ranged shot `threat` could take at a unit on `hex` right
 * now (§5.4) — or `null` if none reaches in arc with ammo and line of fire.
 */
function bestRangedMode(
  threat: UnitState,
  hex: Axial,
  board: Board,
  units: readonly UnitState[],
  currentTurn: number,
): RangedMode | null {
  return MODES_BY_STRENGTH.find((mode) => canFireAt(threat, hex, mode, board, units, currentTurn)) ?? null;
}

/**
 * The reaction `threat` may make against `mover` arriving on `hex`, or `null` if
 * it cannot react (§8). A ranged unit takes its strongest available shot; any
 * other fighting unit makes a melee blow when the hex sits in its front at
 * range 1 (§7.1). Honours the threat's eligibility (active enemy that has not
 * attacked) and the light-cavalry ranged immunity (§4.3).
 */
export function opportunityKind(
  threat: UnitState,
  mover: UnitState,
  hex: Axial,
  board: Board,
  units: readonly UnitState[],
  currentTurn: number,
): OpportunityKind | null {
  if (threat.side === mover.side || !isActive(threat) || threat.hasAttacked) return null;

  if (threat.category === 'ranged') {
    if (isLightCavalry(mover)) return null; // light cavalry dodges ranged opportunity fire (§4.3)
    return bestRangedMode(threat, hex, board, units, currentTurn);
  }

  // Any other fighting unit threatens the two hexes in its front at range 1 (§7.1).
  return distance(threat.hex, hex) === 1 && isInFront(threat, hex) ? 'melee' : null;
}

/**
 * Every enemy that may make an opportunity attack on `mover` now that it stands
 * on `hex` (§8) — the reactions the store resolves after a move lands the mover
 * in a contested hex.
 */
export function opportunityAttackers(
  mover: UnitState,
  hex: Axial,
  board: Board,
  units: readonly UnitState[],
  currentTurn: number,
): OpportunityOffer[] {
  const offers: OpportunityOffer[] = [];
  for (const threat of units) {
    const kind = opportunityKind(threat, mover, hex, board, units, currentTurn);
    if (kind) offers.push({ threat, kind });
  }
  return offers;
}

/**
 * Resolve `threat`'s opportunity attack on `mover` (§8, §9): run the damage
 * through the standard pipeline (with the ranged mode multiplier when firing),
 * apply both channels, and mark the threat as having acted — leaving it able
 * only to turn (§8). A ranged reaction spends a shot and stamps the firing turn
 * (§4.4). **No charge run and no Breakthrough** apply to a standing reactive
 * strike. Returns the outcome, or `null` if the threat cannot react.
 */
export function performOpportunityAttack(
  threat: UnitState,
  mover: UnitState,
  board: Board,
  units: readonly UnitState[],
  currentTurn: number,
): OpportunityOutcome | null {
  const kind = opportunityKind(threat, mover, mover.hex, board, units, currentTurn);
  if (!kind) return null;

  const mode = kind === 'melee' ? undefined : kind;
  const result = resolveAttack(threat, mover, attackContext(threat, mover, { board, units, mode }));

  // A standing reactive strike never charges, so the simple physical-then-morale order applies (§9.7).
  mover.hp = Math.max(0, mover.hp - result.physical.damage);
  mover.morale = Math.max(0, mover.morale - result.morale.damage);

  if (mode) {
    threat.shotsLeft -= 1;
    threat.lastFiredTurn = currentTurn;
  }
  threat.hasAttacked = true;
  threat.hasActed = true;
  threat.madeOpportunityAttack = true;

  return { kind, result };
}
