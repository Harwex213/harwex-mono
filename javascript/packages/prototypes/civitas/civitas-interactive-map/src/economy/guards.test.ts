import assert from "node:assert/strict";
import test from "node:test";
import { createInitialEconomy } from "./economy-state";
import { deriveEconomy } from "./derive";
import { resolveTurn } from "./pipeline";
import type { EconomyState, ResourceKey } from "./types";

// Spec section 20's guards, exercised through the WHOLE engine rather than
// through one stage function.
//
// A guard that holds inside its own module can still be bypassed by the caller,
// so each one below is reached the way a player would reach it: a real state
// through `deriveEconomy` or `resolveTurn`. Every expectation is hand arithmetic
// on the standard start, whose FR generation is
// 10 000 x ratingFactor x controlFrMultiplier x frGrowthFactor x frDefenceDrag x
// (1 + frLightBonus) = 10 000 x 1 x 1 x 1,06 x 0,90 x 1,05 = 10 017,00.

const TOL = 1e-9;

function close(actual: number, expected: number, message: string, tolerance = TOL): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    message + ": expected " + expected + ", got " + actual,
  );
}

const DEPOSITS: Record<ResourceKey, number> = {
  coal: 2,
  oil: 1,
  fibre: 1,
  ferrous: 1,
  nonferrous: 1,
  rubber: 1,
  chemical: 2,
  precious: 1,
};

function standardStart(): EconomyState {
  const state = createInitialEconomy();
  state.resources = state.resources.map((resource) => {
    return { ...resource, deposits: DEPOSITS[resource.key] };
  });
  return state;
}

// ---------------------------------------------------------------------------
// G9 — a shortage at worst zeroes growth and can never drive it negative.
// ---------------------------------------------------------------------------

test("a total shortage zeroes every growing sector and stops exactly at 0", () => {
  // A fresh country has no geology at all, so every resource is 100% short and
  // every base sector's penalty is exactly 1.
  const derived = deriveEconomy(createInitialEconomy());

  assert.deepEqual(derived.errors, []);
  // Pre-shortage growth is 3,00 + the auto-investment bonus, so it is positive
  // and the multiplicative form has something to zero.
  close(derived.modifierPp, 0.63388, "modifierPp");
  for (const sector of derived.sectors) {
    close(sector.shortagePenalty, 1, sector.key + " is fully short");
    close(sector.preShortagePct, 3.63388, sector.key + " preShortagePct");
    assert.equal(sector.finalPct, 0, sector.key + " is zeroed, never pushed below 0");
    assert.equal(sector.gdpNextObor, 20000000, sector.key + " volume stands still");
  }
  assert.equal(derived.overallGrowthPct, 0);
  assert.equal(derived.gdpNextTotalObor, 100000000);
  assert.equal(derived.gdpChangeObor, 0);
  // Five zeroed sectors, five V18 warnings, and not one error.
  assert.equal(
    derived.warnings.filter((warning) => {
      return warning.startsWith("V18");
    }).length,
    5,
  );
});

test("a total shortage cannot deepen a contraction by even a hundredth", () => {
  const state = createInitialEconomy();
  state.sectors = state.sectors.map((sector) => {
    return { ...sector, growthPermanentPct: -2 };
  });

  // Planned growth -2,00 gives frGrowthFactor 0,96, so frGenerated is
  // 10 000 x 0,96 x 0,90 x 1,05 = 9 072,00 and micGenerated is
  // 2 000 x 0,10 x 0,96 x 1,10 = 211,20. Invested: 9 072 x 2 000 +
  // 211,20 x 50 000 = 28 704 000 obor, which is 0,57408 pp of a 100 000 000 GDP.
  const derived = deriveEconomy(state);
  close(derived.frGenerated, 9072.0, "frGenerated");
  close(derived.micGenerated, 211.2, "micGenerated");
  close(derived.autoInvestGrowthPp, 0.57408, "autoInvestGrowthPp");

  for (const sector of derived.sectors) {
    close(sector.shortagePenalty, 1, sector.key + " is fully short");
    // -2,00 + 0,57408 is already negative, so the shortage factor is not applied
    // at all and the two columns are the same number.
    close(sector.finalPct, -1.42592, sector.key + " finalPct");
    assert.equal(sector.finalPct, sector.preShortagePct, sector.key + " is untouched");
    assert.equal(sector.gdpNextObor, 19714816, sector.key + " volume");
  }
  close(derived.overallGrowthPct, -1.42592, "overallGrowthPct");
});

// ---------------------------------------------------------------------------
// G10 — the rating clamps at both ends, and the clamp sees the sum.
// ---------------------------------------------------------------------------

test("the rating clamps at 0 and at 100, on the sum and never on the terms", () => {
  // Bottom: a 50% emission costs round(0,40 x 50) = 20 rating points against a
  // score of 5. The sum is -15 and the clamp reads 0, not -15.
  const collapsing = standardStart();
  collapsing.ratingScore = 5;
  collapsing.emissionPct = 50;
  collapsing.emissionPctLast = 50;
  const bottom = deriveEconomy(collapsing);
  assert.deepEqual(bottom.errors, []);
  assert.equal(bottom.ratingTier, "F");
  assert.equal(bottom.emissionRatingPenalty, 20);
  assert.deepEqual(bottom.ratingDeltas, [{ reason: "Emission", points: -20 }]);
  assert.equal(bottom.ratingNext, 0);

  // Top: a clean turn at 99 reaches exactly 100, and at 100 it adds nothing.
  const almost = deriveEconomy({ ...standardStart(), ratingScore: 99 });
  assert.equal(almost.ratingCleanTurn, true);
  assert.equal(almost.ratingRecovery, 1);
  assert.equal(almost.ratingNext, 100);

  const full = deriveEconomy({ ...standardStart(), ratingScore: 100 });
  assert.equal(full.ratingRecovery, 1, "the recovery is still earned");
  assert.equal(full.ratingNext, 100, "and the clamp absorbs it");
});

// ---------------------------------------------------------------------------
// G1..G6 — every divisor the engine can be handed as a zero.
// ---------------------------------------------------------------------------

test("a country with no economy at all divides by nothing and yields no NaN", () => {
  const state = standardStart();
  state.sectors = state.sectors.map((sector) => {
    return { ...sector, gdpObor: 0 };
  });

  const derived = deriveEconomy(state);
  assert.deepEqual(derived.errors, []);

  // G1: every quantity that divides by gdpTotal.
  assert.equal(derived.gdpTotalObor, 0);
  assert.equal(derived.plannedGrowthPct, 0);
  assert.equal(derived.overallGrowthPct, 0);
  assert.equal(derived.autoInvestGrowthPp, 0);
  assert.equal(derived.reservePenaltyPp, 0);
  assert.equal(derived.gdpNextTotalObor, 0);
  assert.equal(derived.gdpChangeObor, 0);
  for (const sector of derived.sectors) {
    assert.equal(sector.share, 0, sector.key + " share");
  }

  // The FR and MIC blocks fall out at 0 with them, so the reserve cap and the
  // debt limit are 0 and no borrowing is possible.
  assert.equal(derived.frGenerated, 0);
  assert.equal(derived.micGenerated, 0);
  assert.equal(derived.reserveCap, 0);
  assert.equal(derived.debtLimit, 0);
  assert.equal(derived.newLoanAvailable, 0);

  // G2: no sector needs anything, so coverage is 1 and nothing is short.
  for (const resource of derived.resources) {
    assert.equal(resource.needUnits, 0, resource.key + " need");
    assert.equal(resource.coverage, 1, resource.key + " coverage");
    assert.equal(resource.shortage, 0, resource.key + " shortage");
  }

  // G5: no loan, so requiredTotal is 0 and the penalty is 0 rather than NaN.
  assert.equal(derived.debtRequiredTotal, 0);
  assert.equal(derived.debtRatingPenalty, 0);
  assert.equal(derived.debtStatusNext, "normal");

  // And nothing anywhere in the derived block is non-finite.
  for (const [key, value] of Object.entries(derived)) {
    if (typeof value === "number") {
      assert.ok(Number.isFinite(value), key + " is non-finite: " + value);
    }
  }

  // The turn still resolves, because none of this is an invalid sheet.
  const result = resolveTurn(state);
  assert.ok(result.ok, "a dead economy is a legitimate state, not an error");
});

test("G6 — a country with no provinces grants a concession for nothing", () => {
  const state = standardStart();
  state.region = "bengo";
  state.pendingConcession = { sectorKey: "commercial" };

  // No context, so provinceCount defaults to 0 — the guard's own case.
  const derived = deriveEconomy(state);
  assert.deepEqual(derived.errors, []);
  assert.equal(derived.concessionCostObor, 0);
  // The +1,50 pp is in force from the grant turn regardless of the cost.
  assert.equal(derived.concessionGrowthPp, 1.5);

  const result = resolveTurn(state);
  assert.ok(result.ok);
  assert.equal(result.next.concessions[0]?.gdpTransferredObor, 0);
});

test("G4 — a matured loan divides by 1 and keeps demanding the whole principal", () => {
  const state = standardStart();
  state.turn = 4;
  state.loans = [{
    id: 1,
    principal: 1000,
    ratePct: 12,
    termTurns: 6,
    turnsRemaining: 0,
    createdTurn: 1,
    allocatedFr: 0,
  }];

  const derived = deriveEconomy(state);
  const service = derived.loanService[0];
  assert.ok(service);
  // interest 120 plus the whole 1 000, because principal / max(1, 0) is the
  // principal itself.
  close(service.interestDue, 120, "interestDue");
  close(service.requiredFr, 1120, "requiredFr");
  assert.equal(service.turnsRemainingNext, 0, "it cannot tick below 0 either");
  assert.ok(Number.isFinite(service.requiredFr));
});

// ---------------------------------------------------------------------------
// G27 — the step limit is a validation error, never a clamp.
// ---------------------------------------------------------------------------

test("an over-large emission step aborts the turn instead of being clamped", () => {
  // Band 5, so the limit is 10,00 pp on both levers.
  const overStep = standardStart();
  overStep.emissionPct = 10.01;
  overStep.emissionPctLast = 0;
  const snapshot = JSON.parse(JSON.stringify(overStep)) as unknown;

  const derived = deriveEconomy(overStep);
  const codes = derived.errors.map((error) => {
    return error.code;
  });
  assert.deepEqual(codes, ["V3"], "the step is the only thing wrong with this sheet");

  const result = resolveTurn(overStep);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.errors.some((error) => {
    return error.code === "V3";
  }));
  // Nothing was clamped and nothing was written: what the player typed is still
  // what the state holds, and no turn was resolved around a value they did not
  // intend.
  assert.deepEqual(JSON.parse(JSON.stringify(overStep)) as unknown, snapshot);
  assert.equal(overStep.emissionPct, 10.01);

  // Exactly at the limit it resolves.
  const atLimit = standardStart();
  atLimit.emissionPct = 10;
  atLimit.emissionPctLast = 0;
  assert.deepEqual(deriveEconomy(atLimit).errors, []);
  assert.ok(resolveTurn(atLimit).ok);
});

test("the step limit follows the band, and mobilization widens only the military one", () => {
  // Band 3 (position 44) raises the limit to 10 - 1,5 x (3 - 5) = 13,00.
  const dirigiste = standardStart();
  dirigiste.controlPosition = 44;
  dirigiste.emissionPct = 13;
  dirigiste.emissionPctLast = 0;
  assert.deepEqual(deriveEconomy(dirigiste).errors, [], "13,00 is exactly the band's step");

  const overBand = { ...dirigiste, emissionPct: 13.5 };
  assert.deepEqual(
    deriveEconomy(overBand).errors.map((error) => {
      return error.code;
    }),
    ["V3"],
  );

  // A 21-point military move needs the mobilization bonus at band 5.
  const marching = standardStart();
  marching.militaryPct = 21;
  marching.militaryPctLast = 10;
  assert.ok(deriveEconomy(marching).errors.some((error) => {
    return error.code === "V4";
  }));
  const mobilized = { ...marching, mobilized: true };
  const derivedMobilized = deriveEconomy(mobilized);
  assert.deepEqual(derivedMobilized.errors, []);
  close(derivedMobilized.militaryStepLimitPp, 20, "the military step gains +10,00");
  close(derivedMobilized.emissionStepLimitPp, 10, "the emission step does not");
  assert.ok(resolveTurn(mobilized).ok);
});

// ---------------------------------------------------------------------------
// Section 6.2a — the recovery predicate's three exclusions, end to end.
// ---------------------------------------------------------------------------

test("exclusion 1 — any emission at all forfeits the recovery", () => {
  const emitting = standardStart();
  emitting.emissionPct = 4;

  const derived = deriveEconomy(emitting);
  assert.deepEqual(derived.errors, []);
  // The other two clauses hold, so emission is the only thing costing it.
  assert.equal(derived.debtShortfallTotal, 0);
  assert.ok(derived.overallGrowthPct > 0);

  assert.equal(derived.ratingCleanTurn, false);
  assert.equal(derived.ratingRecovery, 0);
  assert.deepEqual(derived.ratingDeltas, [{ reason: "Emission", points: -2 }]);
  assert.equal(derived.ratingNext, 68, "70 - 2, with no +1 to soften it");
});

test("exclusion 2 — a missed debt payment forfeits the recovery", () => {
  // Spec 17's cheapest route to a shortfall with no invalid input: a reserve
  // addition is charged at step 6, before debt service at step 7.
  const starved = standardStart();
  starved.turn = 3;
  starved.reserveAdd = 9000;
  starved.loans = [{
    id: 1,
    principal: 20000,
    ratePct: 12,
    termTurns: 6,
    turnsRemaining: 1,
    createdTurn: 1,
    allocatedFr: 0,
  }];

  const derived = deriveEconomy(starved);
  assert.deepEqual(derived.errors, []);

  // Required: 20 000 x 0,12 interest plus the whole 20 000 principal, against a
  // balance of 10 017,00 - 9 000,00 = 1 017,00.
  close(derived.frBalanceAfterSavings, 1017, "frBalance6");
  close(derived.debtRequiredTotal, 22400, "requiredTotal");
  close(derived.debtAllocatedTotal, 1017, "allocatedTotal");
  close(derived.debtShortfallTotal, 21383, "shortfallTotal");
  // ceil(10 x 21 383 / 22 400) = ceil(9,546) = 10, the whole cap.
  assert.equal(derived.debtRatingPenalty, 10);
  assert.equal(derived.debtStatusNext, "arrears");

  // The other two clauses hold: no emission, and growth is still positive.
  close(derived.frRemainder, 0, "the whole budget went to the reserve and the loan");
  close(derived.autoInvestGrowthPp, 0.2332, "autoInvestGrowthPp");
  // 3,00 x (9 000 x 2 000 / 100 000 000) = 0,54 pp of reserve penalty.
  close(derived.reservePenaltyPp, 0.54, "reservePenaltyPp");
  close(derived.modifierPp, -0.3068, "modifierPp");
  close(derived.overallGrowthPct, 2.6932, "overallGrowthPct");
  assert.equal(derived.gdpNextTotalObor, 102693200);

  assert.equal(derived.ratingCleanTurn, false, "the shortfall is the only failing clause");
  assert.equal(derived.ratingRecovery, 0);
  assert.equal(derived.ratingNext, 60, "70 - 10, with no +1");
});

test("exclusion 3 — growth of exactly 0, and growth below 0, both forfeit it", () => {
  // Below 0: every sector shrinking by 1,00 pp against a 0,58604 pp bonus.
  const shrinking = standardStart();
  shrinking.sectors = shrinking.sectors.map((sector) => {
    return { ...sector, growthPermanentPct: -1 };
  });
  const falling = deriveEconomy(shrinking);
  assert.deepEqual(falling.errors, []);
  // Planned growth -1,00 gives frGrowthFactor 0,98: 10 000 x 0,98 x 0,90 x 1,05.
  close(falling.frGenerated, 9261.0, "frGenerated");
  close(falling.micGenerated, 215.6, "micGenerated");
  close(falling.autoInvestGrowthPp, 0.58604, "autoInvestGrowthPp");
  close(falling.overallGrowthPct, -0.41396, "overallGrowthPct");
  assert.equal(falling.ratingCleanTurn, false);
  assert.equal(falling.ratingRecovery, 0);
  assert.deepEqual(falling.ratingDeltas, []);
  assert.equal(falling.ratingNext, 70, "no penalty either — it simply earns nothing");

  // Exactly 0 fails too: the clause is strictly positive. A fresh country's
  // total shortage zeroes every sector.
  const flat = deriveEconomy(createInitialEconomy());
  assert.equal(flat.overallGrowthPct, 0);
  assert.equal(flat.ratingCleanTurn, false);
  assert.equal(flat.ratingRecovery, 0);
});

test("the recovery is one term in the sum, not a gate on the other deltas", () => {
  // A clean turn that also nationalises: -4 + 1 = -3, and both lines are kept.
  const nationalising = standardStart();
  nationalising.pendingAction = { kind: "nationalization", enterprise: "civilian", roll: 10 };

  const derived = deriveEconomy(nationalising);
  assert.deepEqual(derived.errors, []);
  assert.equal(derived.ratingCleanTurn, true);
  assert.equal(derived.ratingRecovery, 1);
  assert.equal(derived.ratingNext, 67, "70 - 4 + 1");
  const reasons = derived.ratingDeltas.map((entry) => {
    return entry.reason;
  });
  assert.ok(reasons.includes("Nationalization"));
  assert.ok(reasons.includes("Clean-turn recovery"));
});
