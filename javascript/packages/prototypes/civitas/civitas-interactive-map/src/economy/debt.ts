import { ECONOMY_CONSTANTS } from "./constants";
import { debtTermsOf } from "./rating";
import { finiteOr, safeDivide } from "./num";
import type {
  BorrowStage,
  DebtStage,
  DebtStatus,
  EconomyState,
  LoanServiceDerived,
  RatingTier,
} from "./types";

// Pipeline steps 5 and 7, spec section 14.
//
// The limit is a MULTIPLE of annual FR income, not a flat number (ruling 2). A
// flat cap would be the same ceiling for a village and an empire; debt to
// revenue self-corrects as an economy grows or collapses, which is what makes
// the debt spiral of guard G21 bounded rather than arbitrary.

function deriveBorrowStage(
  state: EconomyState,
  tier: RatingTier,
  frGenerated: number,
): BorrowStage {
  const terms = debtTermsOf(tier);
  const debtLimit = terms.limitMultiple * frGenerated;

  // The start-of-turn loans only, so `newLoanAvailable` cannot be affected by
  // the loan this same turn creates.
  let debtOutstanding = 0;
  for (const loan of state.loans) {
    debtOutstanding += Math.max(0, finiteOr(loan.principal, 0));
  }
  const newLoanAvailable = Math.max(0, debtLimit - debtOutstanding);

  const request = finiteOr(state.borrowRequest, 0);
  const allowed = request > 0
    && request <= newLoanAvailable
    && tier !== "F"
    && state.debtStatus !== "default";

  const createdLoan = allowed
    ? {
      id: finiteOr(state.nextLoanId, 1),
      principal: request,
      // Locked at borrowing time. It never floats afterwards.
      ratePct: terms.ratePct,
      termTurns: terms.termTurns,
      turnsRemaining: terms.termTurns,
      createdTurn: finiteOr(state.turn, 1),
      allocatedFr: 0,
    }
    : null;

  return {
    debtLimit,
    debtOutstanding,
    newLoanAvailable,
    newLoanRatePct: terms.ratePct,
    newLoanTermTurns: terms.termTurns,
    createdLoan,
    newLoanProceeds: createdLoan === null ? 0 : createdLoan.principal,
  };
}

function nextStatusOf(shortfallTotal: number, defaultLastTurn: boolean): DebtStatus {
  if (shortfallTotal === 0) {
    return "normal";
  }
  return defaultLastTurn ? "default" : "arrears";
}

function deriveDebtServiceStage(
  state: EconomyState,
  frBalanceAfterSavings: number,
): DebtStage {
  const warnings: string[] = [];
  const loanService: LoanServiceDerived[] = [];
  const autoService = state.debtAutoService !== false;

  let allocatedTotal = 0;
  let requiredTotal = 0;
  let shortfallTotal = 0;

  for (const loan of state.loans) {
    const principal = Math.max(0, finiteOr(loan.principal, 0));
    const turnsRemaining = Math.max(0, finiteOr(loan.turnsRemaining, 0));

    // A loan created THIS turn is not serviced this turn: the proceeds arrive
    // mid-year and the annual close that books them is the same close that would
    // demand the first payment. It also makes `termTurns` mean what it says — a
    // 6-turn loan makes 6 payments, not 5.
    const serviced = finiteOr(loan.createdTurn, 0) < finiteOr(state.turn, 1);
    if (!serviced) {
      loanService.push({
        loanId: loan.id,
        serviced: false,
        requiredFr: 0,
        allocatedFr: 0,
        shortfall: 0,
        interestDue: 0,
        interestPaid: 0,
        principalPaid: 0,
        principalNext: principal,
        turnsRemainingNext: turnsRemaining,
      });
      continue;
    }

    const interestDue = principal * finiteOr(loan.ratePct, 0) / 100;
    // Straight-line amortisation over the REMAINING term. It self-corrects: the
    // last turn's principalDue is the whole remaining principal, so a loan
    // always closes at exactly 0. `max(1, ...)` is guard G4.
    const principalDue = principal / Math.max(1, turnsRemaining);
    const requiredFr = interestDue + principalDue;

    // Loans are serviced in `loans[]` order, so a balance too small to cover
    // everything starves the NEWEST loan rather than short-paying all of them.
    const frStillAvailable = frBalanceAfterSavings - allocatedTotal;
    const allocatedFr = autoService
      ? Math.min(requiredFr, Math.max(0, frStillAvailable))
      : finiteOr(loan.allocatedFr, 0);

    const shortfall = Math.max(0, requiredFr - allocatedFr);
    const interestPaid = Math.min(allocatedFr, interestDue);
    const principalPaid = Math.max(0, allocatedFr - interestDue);
    // Interest is paid before principal, and unpaid interest CAPITALISES. That
    // is the mechanism that makes a debt spiral possible with no extra rule.
    const principalNext = Math.max(
      0,
      principal - principalPaid + (interestDue - interestPaid),
    );

    allocatedTotal += allocatedFr;
    requiredTotal += requiredFr;
    shortfallTotal += shortfall;

    loanService.push({
      loanId: loan.id,
      serviced: true,
      requiredFr,
      allocatedFr,
      shortfall,
      interestDue,
      interestPaid,
      principalPaid,
      principalNext,
      turnsRemainingNext: Math.max(0, turnsRemaining - 1),
    });
  }

  // Missing the whole payment costs 10 rating points — a full tier drop.
  // Missing a tenth costs 1. Guard G5 covers the no-loan case.
  const ratingPenalty = requiredTotal <= 0
    ? 0
    : Math.min(
      ECONOMY_CONSTANTS.DEBT_SHORTFALL_RATING_MAX,
      Math.ceil(
        ECONOMY_CONSTANTS.DEBT_SHORTFALL_RATING_MAX
        * safeDivide(shortfallTotal, requiredTotal),
      ),
    );

  if (shortfallTotal > 0) {
    warnings.push(
      "V17: debt payment shortfall of " + shortfallTotal.toFixed(2)
      + " FR, costing " + ratingPenalty + " rating points",
    );
  }

  return {
    loanService,
    requiredTotal,
    allocatedTotal,
    shortfallTotal,
    ratingPenalty,
    statusNext: nextStatusOf(shortfallTotal, state.defaultLastTurn === true),
    defaultLastTurnNext: shortfallTotal > 0,
    warnings,
  };
}

export { deriveBorrowStage, deriveDebtServiceStage, nextStatusOf };
