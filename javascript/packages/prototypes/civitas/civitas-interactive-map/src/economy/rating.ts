import { DEBT_TERMS, ECONOMY_CONSTANTS, RATING_TIERS } from "./constants";
import { clamp, finiteOr, roundTo } from "./num";
import type { DebtTerms, RatingDelta, RatingInput, RatingStage, RatingTier } from "./types";

// The credit rating, spec section 6, and the per-tier debt terms of section 2.9.
//
// Five engine deltas subtract and exactly one adds. The one that adds is the
// clean-turn recovery of spec 6.2a, which the user added on review (ruling 1):
// without it the rating was a one-way ratchet, so a country that once ran
// emission could never recover and a well-run economy never earned an upgrade.
// The judge's verdict lever stays authoritative and untouched.

function ratingTierOf(score: number): RatingTier {
  const safe = clamp(finiteOr(score, ECONOMY_CONSTANTS.START_RATING), 0, 100);
  for (const row of RATING_TIERS) {
    if (safe >= row.min && safe <= row.max) {
      return row.tier;
    }
  }
  // Unreachable: the seven tiers are contiguous and cover 0..100.
  return "F";
}

// Range 0,30 at rating 0 to 1,30 at rating 100, and exactly 1,00 at the standard
// start's 70. No clamp is needed because the input is already bounded.
function ratingFactorOf(score: number): number {
  const safe = clamp(finiteOr(score, ECONOMY_CONSTANTS.START_RATING), 0, 100);
  return 1 + ECONOMY_CONSTANTS.RATING_FR_SLOPE * (safe - ECONOMY_CONSTANTS.RATING_FR_PIVOT);
}

function debtTermsOf(tier: RatingTier): DebtTerms {
  return DEBT_TERMS[tier];
}

// Spec 6.2a. All three clauses must hold, and every one reads THIS turn's
// unrounded value:
//   - no emission at all, however small;
//   - no missed debt payment, tested on this turn's shortfall and never on the
//     carried `debtStatus`, so a country sitting in default earns its +1 on the
//     same turn it clears its arrears;
//   - strictly positive realised growth after every modifier and after the
//     shortage factor. Exactly 0 fails. It is NOT `plannedGrowthPct`, which
//     ignores every modifier, and NOT `gdpChangeObor`, which a concession can
//     drive negative in a year the economy genuinely grew.
function isCleanTurn(
  emissionPct: number,
  shortfallTotal: number,
  overallGrowthPct: number,
): boolean {
  if (!(emissionPct === 0)) {
    return false;
  }
  if (!(shortfallTotal === 0)) {
    return false;
  }
  return overallGrowthPct > 0;
}

function deriveRatingStage(input: RatingInput): RatingStage {
  const deltas: RatingDelta[] = [];

  const emissionPenalty = finiteOr(input.emissionRatingPenalty, 0);
  if (emissionPenalty !== 0) {
    deltas.push({ reason: "Emission", points: -emissionPenalty });
  }

  for (const delta of input.actionRatingDeltas) {
    if (delta.points !== 0) {
      deltas.push({ reason: delta.reason, points: delta.points });
    }
  }

  const debtPenalty = finiteOr(input.debtRatingPenalty, 0);
  if (debtPenalty !== 0) {
    deltas.push({ reason: "Debt payment shortfall", points: -debtPenalty });
  }

  if (input.mobilized && !input.mobilizationJustified) {
    deltas.push({
      reason: "Unjustified mobilization",
      points: ECONOMY_CONSTANTS.MOB_UNJUSTIFIED_RATING_PER_TURN,
    });
  }

  const cleanTurn = isCleanTurn(
    finiteOr(input.emissionPct, 0),
    finiteOr(input.shortfallTotal, 0),
    finiteOr(input.overallGrowthPct, 0),
  );
  const recovery = cleanTurn ? ECONOMY_CONSTANTS.RATING_RECOVERY_PER_TURN : 0;
  if (recovery !== 0) {
    deltas.push({ reason: "Clean-turn recovery", points: recovery });
  }

  // The recovery is one more term in the same sum, not a gate on the others.
  // A clean turn that also nationalises is -4 + 1 = -3. The clamp sees the sum,
  // never the terms (guard G10).
  let total = 0;
  for (const delta of deltas) {
    total += delta.points;
  }
  const score = finiteOr(input.ratingScore, ECONOMY_CONSTANTS.START_RATING);
  const ratingNext = clamp(
    Math.round(score + total),
    ECONOMY_CONSTANTS.RATING_MIN,
    ECONOMY_CONSTANTS.RATING_MAX,
  );

  return {
    cleanTurn,
    recovery,
    deltas,
    ratingNext,
    ratingTierNext: ratingTierOf(ratingNext),
  };
}

// Spec 10: -round(EMISSION_RATING_COEFF x emissionPct, 0), a whole number of
// rating points.
function emissionRatingPenaltyOf(emissionPct: number): number {
  return roundTo(ECONOMY_CONSTANTS.EMISSION_RATING_COEFF * finiteOr(emissionPct, 0), 0);
}

export {
  debtTermsOf,
  deriveRatingStage,
  emissionRatingPenaltyOf,
  isCleanTurn,
  ratingFactorOf,
  ratingTierOf,
};
