import { deriveActionStage, deriveConcessionStage } from "./actions";
import { deriveBorrowStage, deriveDebtServiceStage } from "./debt";
import { deriveGdpStage } from "./gdp";
import { deriveGenerationStage } from "./generation";
import { deriveGrowthStage } from "./growth";
import { deriveRatingStage } from "./rating";
import { deriveResourceStage } from "./resources";
import { autoInvestGrowthPp, deriveSavingsStage, deriveUpkeepStage, investedOborOf } from "./savings";
import { clamp, finiteOr } from "./num";
import { collectValidationErrors, type DerivedCore } from "./validate";
import type { DerivedEconomy, EconomyContext, EconomyState, LedgerLine } from "./types";

// `deriveEconomy` — the read-only form of pipeline steps 2 through 13, spec
// section 16.3.
//
// It is TOTAL: it computes through step 13 even on invalid input, using the
// guards of section 20, and it never throws. That is what lets step 1 report the
// complete error list instead of stopping at the first, and what lets T12 show
// live [A] values while a field is momentarily out of range.
//
// `resolveTurn` calls this exactly once, as step 1, and steps 2 through 15 then
// consume its output. So every formula in the spec is evaluated exactly once per
// turn, in one place, and T12's live values cannot drift from what End Turn
// books.

const DEFAULT_CONTEXT: EconomyContext = { provinceCount: 0 };

function sumLines(lines: readonly LedgerLine[] | undefined): number {
  if (lines === undefined) {
    return 0;
  }
  let total = 0;
  for (const line of lines) {
    total += Math.max(0, finiteOr(line.points, 0));
  }
  return total;
}

function deriveEconomy(state: EconomyState, context?: EconomyContext): DerivedEconomy {
  const ctx = context ?? DEFAULT_CONTEXT;

  // Frozen here for the whole turn (spec 4.2a). Every quantity that divides by
  // GDP sees this one number, which is what makes the pipeline order-independent
  // for reads.
  let gdpTotalObor = 0;
  for (const sector of state.sectors) {
    gdpTotalObor += Math.max(0, finiteOr(sector.gdpObor, 0));
  }

  // ---- step 2: resources ------------------------------------------------
  const resourceStage = deriveResourceStage(state.sectors, state.resources);

  // ---- step 3: generation -----------------------------------------------
  const generation = deriveGenerationStage(state, gdpTotalObor);
  const frBalance0 = generation.frGenerated;

  // ---- step 4: actions --------------------------------------------------
  const action = deriveActionStage(
    state,
    generation.controlBandIndex,
    generation.frGenerated,
    generation.micGenerated,
  );
  const concession = deriveConcessionStage(state);
  const frBalance4 = frBalance0 + action.natFrPayout;

  // ---- step 5: borrowing ------------------------------------------------
  const borrow = deriveBorrowStage(state, generation.ratingTier, generation.frGenerated);
  const frBalance5 = frBalance4 + borrow.newLoanProceeds;

  // ---- step 6: savings --------------------------------------------------
  const savings = deriveSavingsStage(state, generation.frGenerated, gdpTotalObor);
  const frBalance6 = frBalance5 + savings.reserveWithdrawApplied - savings.reserveAddApplied;

  // ---- step 7: debt service ---------------------------------------------
  // A reserve addition is charged BEFORE debt service, so banking money can
  // starve an auto-serviced loan and cost rating points. Warnings V14 and V17
  // fire, so it is never silent (spec 8.4a).
  const debt = deriveDebtServiceStage(state, frBalance6);
  const frBalance7 = frBalance6 - debt.allocatedTotal;

  // ---- step 8: upkeep ---------------------------------------------------
  const upkeep = deriveUpkeepStage(savings.micStockEndPreUpkeep, frBalance7);
  const frBalance8 = frBalance7 - upkeep.micUpkeepPaid;

  // ---- step 9: spending -------------------------------------------------
  const frOtherIncome = sumLines(state.frIncomeLines);
  const micOtherIncome = sumLines(state.micIncomeLines);
  const frExpenses = sumLines(state.frExpenseLines);
  const micExpenses = sumLines(state.micExpenseLines);

  const frAvailable = generation.frGenerated
    + action.natFrPayout
    + borrow.newLoanProceeds
    + savings.reserveWithdrawApplied
    + frOtherIncome;
  const frSpent = savings.reserveAddApplied
    + debt.allocatedTotal
    + upkeep.micUpkeepPaid
    + frExpenses;
  const frRemainder = frAvailable - frSpent;

  const micStockAdd = Math.max(0, finiteOr(state.micStockAdd, 0));
  const micAvailable = generation.micGenerated
    + action.natMicPayout
    + savings.micStockWithdrawApplied
    + micOtherIncome;
  const micSpent = micStockAdd + micExpenses;
  const micRemainder = micAvailable - micSpent;

  // `frBalance9 = frBalanceAfterUpkeep + frOtherIncome - frExpenses` is the same
  // set of terms as `frAvailable - frSpent`, in a different order. Both forms are
  // reachable from the exposed fields and `pipeline.test.ts` asserts they agree,
  // which is the identity spec 8.4a asks T11-B to pin.

  // ---- step 10: auto-investment -----------------------------------------
  const investedObor = investedOborOf(frRemainder, micRemainder);
  const autoInvestPp = autoInvestGrowthPp(frRemainder, micRemainder, gdpTotalObor);

  // ---- step 11: growth --------------------------------------------------
  let timedModifierPp = 0;
  for (const modifier of state.timedModifiers) {
    timedModifierPp += finiteOr(modifier.growthPp, 0);
  }
  // A modifier the action created at step 4 is in force at step 11, this turn.
  if (action.timedModifier !== null) {
    timedModifierPp += action.timedModifier.growthPp;
  }

  const growth = deriveGrowthStage({
    sectors: state.sectors,
    shareByKey: generation.shareByKey,
    penaltyByKey: resourceStage.penaltyByKey,
    gdpTotalObor,
    controlGrowthPp: generation.controlGrowthPp,
    mobilizationGrowthPp: generation.mobilizationGrowthPp,
    concessionGrowthPp: concession.concessionGrowthPp,
    timedModifierPp,
    autoInvestGrowthPp: autoInvestPp,
    reservePenaltyPp: savings.reservePenaltyPp,
    inflationGrowthPp: generation.inflationGrowthPp,
    defenceGrowthPp: generation.defenceGrowthPp,
  });

  // ---- step 12: GDP -----------------------------------------------------
  const gdp = deriveGdpStage(growth.sectors, concession, gdpTotalObor, ctx.provinceCount);

  // ---- step 13: rating --------------------------------------------------
  const rating = deriveRatingStage({
    ratingScore: state.ratingScore,
    emissionPct: finiteOr(state.emissionPct, 0),
    emissionRatingPenalty: generation.emissionRatingPenalty,
    actionRatingDeltas: action.ratingDeltas,
    debtRatingPenalty: debt.ratingPenalty,
    shortfallTotal: debt.shortfallTotal,
    overallGrowthPct: growth.overallGrowthPct,
    mobilized: state.mobilized === true,
    mobilizationJustified: state.mobilizationJustified !== false,
  });

  const controlNext = clamp(
    Math.round(finiteOr(state.controlPosition, 50) + action.controlShift),
    0,
    100,
  );

  const core: DerivedCore = {
    gdpTotalObor,
    plannedGrowthPct: generation.plannedGrowthPct,
    overallGrowthPct: growth.overallGrowthPct,
    gdpNextTotalObor: gdp.gdpNextTotalObor,
    gdpChangeObor: gdp.gdpChangeObor,

    ratingTier: generation.ratingTier,
    ratingFactor: generation.ratingFactor,
    ratingNext: rating.ratingNext,
    ratingCleanTurn: rating.cleanTurn,
    ratingRecovery: rating.recovery,
    ratingDeltas: rating.deltas,

    controlBandIndex: generation.controlBandIndex,
    controlBandName: generation.controlBandName,
    controlGrowthPp: generation.controlGrowthPp,
    controlFrMultiplier: generation.controlFrMultiplier,
    emissionStepLimitPp: generation.emissionStepLimitPp,
    militaryStepLimitPp: generation.militaryStepLimitPp,
    controlNext,

    frGenerated: generation.frGenerated,
    frEmission: generation.frEmission,
    frOtherIncome,
    frAvailable,
    frSpent,
    frRemainder,
    frBalanceAfterSavings: frBalance6,
    frBalanceAfterDebt: frBalance7,
    frBalanceAfterUpkeep: frBalance8,
    frLightBonus: generation.frLightBonus,
    frDefenceDrag: generation.frDefenceDrag,
    frGrowthFactor: generation.frGrowthFactor,
    frRegimeMultiplier: generation.frRegimeMultiplier,

    micGenerated: generation.micGenerated,
    micOtherIncome,
    micAvailable,
    micSpent,
    micRemainder,
    micHeavyBonus: generation.micHeavyBonus,
    micRegimeMultiplier: generation.micRegimeMultiplier,

    reserveCap: savings.reserveCap,
    reserveAddApplied: savings.reserveAddApplied,
    reserveWithdrawApplied: savings.reserveWithdrawApplied,
    reserveEnd: savings.reserveEnd,
    reservePenaltyPp: savings.reservePenaltyPp,
    micStockWithdrawApplied: savings.micStockWithdrawApplied,
    micStockEnd: upkeep.micStockEnd,
    micUpkeepDue: savings.micUpkeepDue,
    micUpkeepPaid: upkeep.micUpkeepPaid,
    micStockLost: upkeep.micStockLost,

    inflationPct: generation.inflationPct,
    inflationGrowthPp: generation.inflationGrowthPp,
    emissionRatingPenalty: generation.emissionRatingPenalty,
    defenceGrowthPp: generation.defenceGrowthPp,
    autoInvestGrowthPp: autoInvestPp,
    mobilizationGrowthPp: generation.mobilizationGrowthPp,
    concessionGrowthPp: concession.concessionGrowthPp,
    timedModifierPp,
    modifierPp: growth.modifierPp,

    debtLimit: borrow.debtLimit,
    debtOutstanding: borrow.debtOutstanding,
    newLoanAvailable: borrow.newLoanAvailable,
    newLoanRatePct: borrow.newLoanRatePct,
    newLoanTermTurns: borrow.newLoanTermTurns,
    debtRequiredTotal: debt.requiredTotal,
    debtShortfallTotal: debt.shortfallTotal,
    debtRatingPenalty: debt.ratingPenalty,
    debtStatusNext: debt.statusNext,

    concessionCostObor: gdp.concessionCostObor,

    sectors: gdp.sectors,
    resources: resourceStage.resources,

    natFrPayout: action.natFrPayout,
    natMicPayout: action.natMicPayout,
    action,
    concessionGranted: concession.granted,
    concessionSectorKey: concession.sectorKey,
    newLoanProceeds: borrow.newLoanProceeds,
    createdLoan: borrow.createdLoan,
    loanService: debt.loanService,
    frTaxBase: generation.frTaxBase,
    nationalizationAvailable: action.nationalizationAvailable,
    privatizationAvailable: action.privatizationAvailable,
    frCore: generation.frCore,
    debtAllocatedTotal: debt.allocatedTotal,
    investedObor,
    micStockEndPreUpkeep: savings.micStockEndPreUpkeep,
    defaultLastTurnNext: debt.defaultLastTurnNext,
  };

  // Concatenated in derive order: V19, V14/V15, V17, V16, V18, V20.
  const warnings = [
    ...resourceStage.warnings,
    ...savings.warnings,
    ...debt.warnings,
    ...upkeep.warnings,
    ...growth.warnings,
    ...gdp.warnings,
  ];

  return {
    ...core,
    errors: collectValidationErrors(state, core),
    warnings,
  };
}

export { deriveEconomy, sumLines };
