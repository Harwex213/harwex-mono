import { ECONOMY_CONSTANTS } from "./constants";
import { finiteOr, safeDivide } from "./num";
import type { EconomyState, SavingsStage, UpkeepStage } from "./types";

// Pipeline steps 6, 8 and 10, spec section 9.
//
// Step 6 runs before growth because the reserve PENALTY is assessed on the
// end-of-turn stock (SOURCED), so the stock has to be final before growth
// resolves. That is the one ordering constraint the sources force; every other
// step order in the pipeline is this spec's own design.

function deriveSavingsStage(
  state: EconomyState,
  frGenerated: number,
  gdpTotalObor: number,
): SavingsStage {
  const warnings: string[] = [];

  // --- MIC stockpile first, then the reserve. Spec 16.2 step 6 says so. ---
  const micStockStart = Math.max(0, finiteOr(state.micStock, 0));
  const micStockAdd = Math.max(0, finiteOr(state.micStockAdd, 0));
  const micStockWithdrawRequested = Math.max(0, finiteOr(state.micStockWithdraw, 0));
  const micStockWithdrawApplied = Math.min(micStockWithdrawRequested, micStockStart);
  if (micStockWithdrawRequested > micStockWithdrawApplied) {
    warnings.push(
      "V15: MIC stockpile withdrawal clipped from " + micStockWithdrawRequested
      + " to " + micStockWithdrawApplied + " points",
    );
  }
  const micStockEndPreUpkeep = micStockStart + micStockAdd - micStockWithdrawApplied;
  const micUpkeepDue = ECONOMY_CONSTANTS.MIC_UPKEEP_FR_PER_POINT * micStockEndPreUpkeep;

  // --- The reserve. ---
  const reserveStart = Math.max(0, finiteOr(state.reserveFr, 0));
  const reserveCap = ECONOMY_CONSTANTS.RESERVE_CAP_MULTIPLE * frGenerated;

  const withdrawRequested = Math.max(0, finiteOr(state.reserveWithdraw, 0));
  const reserveWithdrawApplied = Math.min(withdrawRequested, reserveStart);

  // An addition is blocked ENTIRELY while the stock is over the cap, and
  // otherwise clipped to the headroom. The stock itself survives a cap that
  // falls below it.
  const addRequested = Math.max(0, finiteOr(state.reserveAdd, 0));
  const reserveAddApplied = reserveStart > reserveCap
    ? 0
    : Math.min(addRequested, Math.max(0, reserveCap - reserveStart));

  if (addRequested > reserveAddApplied || withdrawRequested > reserveWithdrawApplied) {
    warnings.push(
      "V14: reserve movement clipped — added " + reserveAddApplied + " of " + addRequested
      + " FR, withdrew " + reserveWithdrawApplied + " of " + withdrawRequested + " FR",
    );
  }

  const reserveEnd = reserveStart + reserveAddApplied - reserveWithdrawApplied;
  const reserveShare = safeDivide(
    reserveEnd * ECONOMY_CONSTANTS.OBOR_PER_FR_POINT,
    gdpTotalObor,
  );
  // Each saved FR point cuts growth 1,5 times as hard as the same point would
  // have raised it through auto-investment (SOURCED ratio). That is why
  // INVEST_GROWTH_COEFF is the single tuning knob for both directions.
  const reservePenaltyPp = ECONOMY_CONSTANTS.RESERVE_PENALTY_MULTIPLE
    * ECONOMY_CONSTANTS.INVEST_GROWTH_COEFF
    * reserveShare;

  return {
    reserveCap,
    reserveAddApplied,
    reserveWithdrawApplied,
    reserveEnd,
    reservePenaltyPp,
    micStockWithdrawApplied,
    micStockEndPreUpkeep,
    micUpkeepDue,
    warnings,
  };
}

// Step 8. Paid in FR out of the balance left after debt service.
//
// You keep exactly the points you could pay for and lose the rest (ruling 4).
// `floor` is deliberate: a point is either maintained for its full 2 FR or it is
// lost. Because `micUpkeepPaid` is recomputed from the SURVIVING stock, upkeep
// can never push the balance negative (guard G28).
function deriveUpkeepStage(
  micStockEndPreUpkeep: number,
  frBalanceAfterDebt: number,
): UpkeepStage {
  const warnings: string[] = [];
  const stock = Math.max(0, finiteOr(micStockEndPreUpkeep, 0));
  // The `max(0, ...)` matters only when a manual over-allocation at step 7 left
  // the balance negative; without it the "points paid for" would go negative and
  // the loss would exceed the stock.
  const micPointsPaidFor = Math.max(
    0,
    Math.floor(finiteOr(frBalanceAfterDebt, 0) / ECONOMY_CONSTANTS.MIC_UPKEEP_FR_PER_POINT),
  );
  const micStockLost = Math.max(0, stock - micPointsPaidFor);
  const micStockEnd = stock - micStockLost;
  const micUpkeepPaid = ECONOMY_CONSTANTS.MIC_UPKEEP_FR_PER_POINT * micStockEnd;

  if (micStockLost > 0) {
    warnings.push(
      "V16: " + micStockLost + " MIC points lost to unpaid upkeep",
    );
  }

  return { micPointsPaidFor, micStockLost, micStockEnd, micUpkeepPaid, warnings };
}

// Step 10. Every point left at turn end counts as invested and raises growth a
// little; the remainders are then discarded, because points do not carry over.
function investedOborOf(frRemainder: number, micRemainder: number): number {
  return finiteOr(frRemainder, 0) * ECONOMY_CONSTANTS.OBOR_PER_FR_POINT
    + finiteOr(micRemainder, 0) * ECONOMY_CONSTANTS.OBOR_PER_MIC_POINT;
}

function autoInvestGrowthPp(
  frRemainder: number,
  micRemainder: number,
  gdpTotalObor: number,
): number {
  const invested = investedOborOf(frRemainder, micRemainder);
  return ECONOMY_CONSTANTS.INVEST_GROWTH_COEFF * safeDivide(invested, gdpTotalObor);
}

export { autoInvestGrowthPp, deriveSavingsStage, deriveUpkeepStage, investedOborOf };
