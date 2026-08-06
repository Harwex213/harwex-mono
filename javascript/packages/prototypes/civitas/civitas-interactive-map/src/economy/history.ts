import { ECONOMY_CONSTANTS } from "./constants";
import { finiteOr, roundTo } from "./num";
import type { DerivedEconomy, EconomyState, TurnRecord, TurnStepRecord } from "./types";

// Turn history, spec section 16.4.
//
// A record carries the closing headline numbers, the per-step deltas and the
// warnings — never a full state snapshot. The whole document shares a 4 MB
// storage budget with flags and province images, so 12 flat records of a few
// kilobytes each is the budget.
//
// Depth matters as much as size. `sanitizeRecord` allows 8 levels of containers
// counting the slot's own `data` as level 1, and it silently DROPS anything
// deeper. The path here is data -> history[] -> record -> steps[] -> step ->
// deltas[] -> delta, which is level 7. A record must therefore stay flat: no
// nested record inside a delta.

// The stored precision of each unit, spec section 3. A rounded value is a view
// and is never read back into arithmetic.
const UNIT_DECIMALS: Readonly<Record<string, number>> = {
  obor: 0,
  fr: ECONOMY_CONSTANTS.POINT_DECIMALS,
  mic: ECONOMY_CONSTANTS.POINT_DECIMALS,
  pp: ECONOMY_CONSTANTS.PCT_STORE_DECIMALS,
  pct: ECONOMY_CONSTANTS.PCT_STORE_DECIMALS,
  units: 0,
  rating: 0,
  turns: 0,
  count: 0,
  factor: ECONOMY_CONSTANTS.PCT_STORE_DECIMALS,
};

function delta(label: string, value: number, unit: string): {
  label: string;
  value: number;
  unit: string;
} {
  const decimals = UNIT_DECIMALS[unit] ?? ECONOMY_CONSTANTS.POINT_DECIMALS;
  return { label, value: roundTo(finiteOr(value, 0), decimals), unit };
}

function buildTurnRecord(
  state: EconomyState,
  derived: DerivedEconomy,
  steps: readonly TurnStepRecord[],
): TurnRecord {
  const points = ECONOMY_CONSTANTS.POINT_DECIMALS;
  return {
    turn: finiteOr(state.turn, 1),
    gdpTotalObor: roundTo(finiteOr(derived.gdpTotalObor, 0), 0),
    gdpNextTotalObor: roundTo(finiteOr(derived.gdpNextTotalObor, 0), 0),
    overallGrowthPct: roundTo(
      finiteOr(derived.overallGrowthPct, 0),
      ECONOMY_CONSTANTS.PCT_STORE_DECIMALS,
    ),
    frGenerated: roundTo(finiteOr(derived.frGenerated, 0), points),
    frRemainder: roundTo(finiteOr(derived.frRemainder, 0), points),
    micGenerated: roundTo(finiteOr(derived.micGenerated, 0), points),
    micRemainder: roundTo(finiteOr(derived.micRemainder, 0), points),
    ratingScore: finiteOr(state.ratingScore, 0),
    ratingNext: finiteOr(derived.ratingNext, 0),
    controlPosition: finiteOr(state.controlPosition, 0),
    controlNext: finiteOr(derived.controlNext, 0),
    steps: steps.map((step) => {
      return { step: step.step, deltas: [...step.deltas], notes: [...step.notes] };
    }),
    warnings: [...derived.warnings],
  };
}

// Newest last, capped at TURN_HISTORY_MAX (guard G25).
function pushTurnRecord(
  history: readonly TurnRecord[],
  record: TurnRecord,
): TurnRecord[] {
  const next = [...history, record];
  if (next.length <= ECONOMY_CONSTANTS.TURN_HISTORY_MAX) {
    return next;
  }
  return next.slice(next.length - ECONOMY_CONSTANTS.TURN_HISTORY_MAX);
}

export { UNIT_DECIMALS, buildTurnRecord, delta, pushTurnRecord };
