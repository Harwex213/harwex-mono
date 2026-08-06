import assert from "node:assert/strict";
import test from "node:test";
import { createInitialEconomy } from "./economy-state";
import { deriveEconomy } from "./derive";
import { resolveTurn } from "./pipeline";
import type { EconomyState, ResourceKey } from "./types";

// The POSITIVE branch of the clean-turn recovery, spec 6.2a and user ruling 1.
//
// Spec 19.14 is explicit that this fixture cannot be made by setting section
// 19's `emissionPct` to 0: dropping emission removes frEmission from
// frGenerated, which moves reserveCap, debtLimit, frRemainder, investedObor,
// autoInvestGrowthPp, every finalPct, overallGrowthPct and all six next-turn
// volumes. So it is computed from scratch — the standard start, turn 1.

const TOL = 1e-6;

function close(actual: number, expected: number, message: string, tolerance = TOL): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    message + ": expected " + expected + ", got " + actual,
  );
}

// Deposits chosen so every requirement is covered and no shortage fires: coal
// needs 60 units and chemical 60, the other six need 40 or less against a
// 50-unit deposit.
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

test("the standard start reproduces spec 21.1's own figures", () => {
  const derived = deriveEconomy(standardStart());

  assert.deepEqual(derived.errors, []);
  assert.equal(derived.gdpTotalObor, 100000000);
  close(derived.plannedGrowthPct, 3.0, "plannedGrowthPct");
  close(derived.frGenerated, 10017.0, "frGenerated", 1e-9);
  close(derived.micGenerated, 233.2, "micGenerated", 1e-9);
  close(derived.reserveCap, 20034.0, "reserveCap", 1e-9);
  // The sourced 22 500 FR at tier B falls out of the 2,25 multiple to within
  // 0,2% at the standard start, and only there — the multiple scales with income.
  close(derived.debtLimit, 22538.25, "debtLimit", 1e-9);
  assert.equal(derived.ratingTier, "B");
});

test("no resource is short at the standard start", () => {
  const derived = deriveEconomy(standardStart());

  for (const resource of derived.resources) {
    assert.equal(resource.shortage, 0, resource.key + " must be fully covered");
  }
  for (const sector of derived.sectors) {
    assert.equal(sector.shortagePenalty, 0, sector.key + " must carry no penalty");
  }
});

test("a clean turn earns +1 rating: no emission, no shortfall, positive growth", () => {
  const derived = deriveEconomy(standardStart());

  close(derived.frRemainder, 10017.0, "frRemainder", 1e-9);
  close(derived.micRemainder, 233.2, "micRemainder", 1e-9);
  close(derived.investedObor, 31694000, "investedObor", 1e-6);
  close(derived.autoInvestGrowthPp, 0.63388, "autoInvestGrowthPp", 1e-9);
  close(derived.modifierPp, 0.63388, "modifierPp", 1e-9);

  for (const sector of derived.sectors) {
    close(sector.finalPct, 3.63388, sector.key + " finalPct", 1e-9);
    assert.equal(sector.gdpNextObor, 20726776, sector.key + " next volume");
  }
  close(derived.overallGrowthPct, 3.63388, "overallGrowthPct", 1e-9);
  assert.equal(derived.gdpNextTotalObor, 103633880);

  assert.equal(derived.ratingCleanTurn, true);
  assert.equal(derived.ratingRecovery, 1);
  assert.deepEqual(derived.ratingDeltas, [{ reason: "Clean-turn recovery", points: 1 }]);
  assert.equal(derived.ratingNext, 71);
  assert.equal(derived.debtShortfallTotal, 0);
});

test("the recovery survives a full End Turn and the tier stays B", () => {
  const result = resolveTurn(standardStart());
  assert.ok(result.ok);

  assert.equal(result.next.ratingScore, 71);
  assert.equal(result.next.turn, 2);
  assert.equal(result.record.ratingNext, 71);
  const total = result.next.sectors.reduce((sum, sector) => {
    return sum + sector.gdpObor;
  }, 0);
  assert.equal(total, 103633880);
  assert.equal(deriveEconomy(result.next).ratingTier, "B");
});

test("each clause of the predicate fails on its own", () => {
  const emitting = standardStart();
  emitting.emissionPct = 4;
  assert.equal(deriveEconomy(emitting).ratingCleanTurn, false);

  // Zero growth fails: the clause is STRICTLY positive.
  const flat = standardStart();
  flat.sectors = flat.sectors.map((sector) => {
    return { ...sector, growthPermanentPct: 0 };
  });
  // Cancel the auto-investment bonus by spending the whole budget.
  const derivedFlat = deriveEconomy(flat);
  flat.frExpenseLines = [{ label: "orders", points: derivedFlat.frGenerated }];
  flat.micExpenseLines = [{ label: "orders", points: derivedFlat.micGenerated }];
  const zero = deriveEconomy(flat);
  close(zero.overallGrowthPct, 0, "overallGrowthPct must be exactly 0", 1e-9);
  assert.equal(zero.ratingCleanTurn, false);
});

test("recovery at rating 100 adds nothing — the clamp is the only bound", () => {
  const state = standardStart();
  state.ratingScore = 100;
  const derived = deriveEconomy(state);

  assert.equal(derived.ratingCleanTurn, true);
  assert.equal(derived.ratingRecovery, 1);
  assert.equal(derived.ratingNext, 100);
});
