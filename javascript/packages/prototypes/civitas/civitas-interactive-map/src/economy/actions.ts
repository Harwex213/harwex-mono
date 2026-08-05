import { CONCESSION_REGIONS, ECONOMY_CONSTANTS } from "./constants";
import { finiteOr, isIntegerInRange } from "./num";
import type { ActionStage, ConcessionStage, EconomyState, RatingDelta } from "./types";

// Pipeline step 4, spec section 15.2 (nationalization and privatization) and
// 15.3 (the concession grant).
//
// The dice roll is an INPUT, never generated here. That is what keeps the whole
// engine deterministic and what matches the rulebook, where the roll is thrown
// in a chat.

function nationalizationAvailableOf(state: EconomyState, controlBandIndex: number): boolean {
  const since = finiteOr(state.turnsSinceNationalization, 0);
  return since >= ECONOMY_CONSTANTS.ACTION_COOLDOWN_TURNS
    && controlBandIndex !== ECONOMY_CONSTANTS.NAT_LOCK_BAND_INDEX;
}

function privatizationAvailableOf(state: EconomyState, controlBandIndex: number): boolean {
  const since = finiteOr(state.turnsSincePrivatization, 0);
  return since >= ECONOMY_CONSTANTS.ACTION_COOLDOWN_TURNS
    && controlBandIndex !== ECONOMY_CONSTANTS.PRIV_LOCK_BAND_INDEX;
}

function emptyStage(
  nationalizationAvailable: boolean,
  privatizationAvailable: boolean,
): ActionStage {
  return {
    kind: null,
    enterprise: null,
    roll: 0,
    resolved: false,
    success: false,
    natFrPayout: 0,
    natMicPayout: 0,
    ratingDeltas: [],
    controlShift: 0,
    timedModifier: null,
    privatizationFrDragTurns: 0,
    privatizationMicDragTurns: 0,
    nationalizationAvailable,
    privatizationAvailable,
    notes: [],
  };
}

function deriveActionStage(
  state: EconomyState,
  controlBandIndex: number,
  frGenerated: number,
  micGenerated: number,
): ActionStage {
  const nationalizationAvailable = nationalizationAvailableOf(state, controlBandIndex);
  const privatizationAvailable = privatizationAvailableOf(state, controlBandIndex);
  const stage = emptyStage(nationalizationAvailable, privatizationAvailable);

  const pending = state.pendingAction;
  if (pending === null || pending === undefined) {
    return stage;
  }

  stage.kind = pending.kind;
  stage.enterprise = pending.enterprise;
  stage.roll = finiteOr(pending.roll, 0);

  // An unavailable action or a malformed roll resolves NOTHING. V8 and V9 abort
  // the turn on exactly these inputs, so the unavailable branch can never write;
  // resolving nothing here is what keeps the derive pass total for T12's live
  // preview without ever producing an effect a validated turn would not.
  if (!isIntegerInRange(pending.roll, ECONOMY_CONSTANTS.ROLL_MIN, ECONOMY_CONSTANTS.ROLL_MAX)) {
    return stage;
  }
  if (pending.kind === "nationalization" && !nationalizationAvailable) {
    return stage;
  }
  if (pending.kind === "privatization" && !privatizationAvailable) {
    return stage;
  }

  const roll = pending.roll;
  const ratingDeltas: RatingDelta[] = [];

  if (pending.kind === "nationalization") {
    // Always structurally succeeds — the state takes the asset. The roll scales
    // only the money, and it is paid in the currency the enterprise trades in.
    const payoutFraction = ECONOMY_CONSTANTS.NAT_INCOME_MAX_PCT / 100 * roll
      / ECONOMY_CONSTANTS.ROLL_MAX;
    stage.resolved = true;
    stage.success = true;
    stage.natFrPayout = pending.enterprise === "civilian" ? payoutFraction * frGenerated : 0;
    stage.natMicPayout = pending.enterprise === "military" ? payoutFraction * micGenerated : 0;
    ratingDeltas.push({ reason: "Nationalization", points: ECONOMY_CONSTANTS.NAT_RATING });
    stage.controlShift = ECONOMY_CONSTANTS.NAT_CONTROL_SHIFT;
    stage.timedModifier = {
      reason: "Nationalization",
      growthPp: ECONOMY_CONSTANTS.NAT_GROWTH_PP,
      turnsRemaining: ECONOMY_CONSTANTS.ACTION_EFFECT_TURNS,
    };
    stage.notes.push("nationalization of a " + pending.enterprise + " enterprise, roll " + roll);
  } else {
    const success = roll >= ECONOMY_CONSTANTS.PRIV_SUCCESS_MIN_ROLL;
    stage.resolved = true;
    stage.success = success;
    if (success) {
      stage.controlShift = ECONOMY_CONSTANTS.PRIV_CONTROL_SHIFT;
      stage.timedModifier = {
        reason: "Privatization",
        growthPp: ECONOMY_CONSTANTS.PRIV_GROWTH_MAX_PP * roll / ECONOMY_CONSTANTS.ROLL_MAX,
        turnsRemaining: ECONOMY_CONSTANTS.ACTION_EFFECT_TURNS,
      };
      // The sourced "privatization temporarily sacrifices future FR growth
      // (civilian) or MIC growth (military)". It starts NEXT turn.
      if (pending.enterprise === "civilian") {
        stage.privatizationFrDragTurns = ECONOMY_CONSTANTS.PRIV_DRAG_TURNS;
      } else {
        stage.privatizationMicDragTurns = ECONOMY_CONSTANTS.PRIV_DRAG_TURNS;
      }
      stage.notes.push("privatization succeeded on a roll of " + roll);
    } else {
      stage.timedModifier = {
        reason: "Failed privatization",
        growthPp: ECONOMY_CONSTANTS.PRIV_FAIL_GROWTH_PP,
        turnsRemaining: ECONOMY_CONSTANTS.ACTION_EFFECT_TURNS,
      };
      ratingDeltas.push({
        reason: "Failed privatization",
        points: ECONOMY_CONSTANTS.PRIV_FAIL_RATING,
      });
      stage.notes.push("privatization failed on a roll of " + roll);
    }
  }

  stage.ratingDeltas = ratingDeltas;
  return stage;
}

// Spec 15.3. The +1,50 pp does NOT stack: it is `any`, never a sum (guard G20).
// It applies from the grant turn onward, including the grant turn, because the
// grant resolves at step 4 and growth resolves at step 11.
function deriveConcessionStage(state: EconomyState): ConcessionStage {
  const pending = state.pendingConcession;
  const regionAllows = CONCESSION_REGIONS.includes(state.region);
  const sectorExists = pending !== null && pending !== undefined
    && state.sectors.some((sector) => {
      return sector.key === pending.sectorKey;
    });
  const granted = pending !== null && pending !== undefined && regionAllows && sectorExists;

  let anyActive = granted;
  if (!anyActive) {
    for (const concession of state.concessions) {
      if (concession.active === true) {
        anyActive = true;
        break;
      }
    }
  }

  return {
    granted,
    sectorKey: granted && pending !== null ? pending.sectorKey : null,
    concessionGrowthPp: anyActive ? ECONOMY_CONSTANTS.CONCESSION_GROWTH_PP : 0,
  };
}

export {
  deriveActionStage,
  deriveConcessionStage,
  nationalizationAvailableOf,
  privatizationAvailableOf,
};
