import assert from "node:assert/strict";
import test from "node:test";
import { createInitialEconomy } from "./economy-state";
import { deriveEconomy } from "./derive";
import { resolveTurn } from "./pipeline";
import type { EconomyState, ResourceKey, SectorKey } from "./types";

// Spec section 19, the worked end-to-end example, asserted table by table.
//
// This file is the primary artefact of T11-B. A run that reproduces it start to
// finish proves the whole pipeline: every formula, every constant and — because
// the FR charges at steps 6, 7, 8 and 9 draw on one running balance — the step
// ORDER as well.
//
// Sector volumes are asserted within 1 obor per section 19.13, never by
// equality: the sum of six independently rounded values can differ from the
// rounded whole by up to half an obor per sector. Everything else is asserted
// against the UNROUNDED value with a 1e-6 tolerance.

const TOL = 1e-6;

function close(actual: number, expected: number, message: string, tolerance = TOL): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    message + ": expected " + expected + ", got " + actual,
  );
}

const SECTORS: [SectorKey, number, number, number][] = [
  ["agriculture", 24000000, 3.0, 0],
  ["lightIndustry", 18000000, 3.0, 0],
  ["heavyIndustry", 30000000, 4.0, -1.0],
  ["commercial", 20000000, 2.5, 0],
  ["extraction", 8000000, 3.0, 0],
  ["other1", 6000000, 5.0, 0],
];

const DEPOSITS: Record<ResourceKey, number> = {
  coal: 1,
  oil: 0,
  fibre: 1,
  ferrous: 1,
  nonferrous: 0,
  rubber: 0,
  chemical: 1,
  precious: 0,
};

const IMPORTS: Record<ResourceKey, number> = {
  coal: 0,
  oil: 20,
  fibre: 0,
  ferrous: 0,
  nonferrous: 30,
  rubber: 10,
  chemical: 20,
  precious: 5,
};

// Aurelia, turn 4. Spec section 19.1.
function aurelia(): EconomyState {
  const state = createInitialEconomy();
  state.turn = 4;
  state.region = "bengo";
  state.ratingScore = 78;
  state.controlPosition = 44;
  state.emissionPct = 4.0;
  state.emissionPctLast = 0;
  state.militaryPct = 12.0;
  state.militaryPctLast = 10.0;
  state.mobilized = false;
  state.reserveFr = 3000;
  state.reserveAdd = 500;
  state.micStock = 40;
  state.micStockAdd = 10;
  state.frExpenseLines = [{ label: "orders", points: 2500 }];
  state.micExpenseLines = [{ label: "orders", points: 100 }];
  state.borrowRequest = 0;
  state.debtAutoService = true;
  state.turnsSinceNationalization = 5;
  state.turnsSincePrivatization = 4;
  state.pendingAction = { kind: "privatization", enterprise: "civilian", roll: 7 };
  state.loans = [
    {
      id: 1,
      principal: 6000,
      ratePct: 12,
      termTurns: 6,
      turnsRemaining: 4,
      createdTurn: 2,
      allocatedFr: 0,
    },
  ];
  state.nextLoanId = 2;

  state.sectors = SECTORS.map(([key, gdpObor, perm, temp]) => {
    return {
      key,
      name: key === "other1" ? "Aerospace" : key,
      grounds: key === "other1" ? "a strategic aerospace programme" : null,
      gdpObor,
      growthPermanentPct: perm,
      growthTemporaryPct: temp,
    };
  });

  state.resources = state.resources.map((resource) => {
    return {
      ...resource,
      deposits: DEPOSITS[resource.key],
      importsRequested: IMPORTS[resource.key],
    };
  });

  return state;
}

function resourceOf(
  derived: ReturnType<typeof deriveEconomy>,
  key: ResourceKey,
): NonNullable<ReturnType<typeof deriveEconomy>["resources"][number]> {
  const found = derived.resources.find((resource) => {
    return resource.key === key;
  });
  assert.ok(found, key + " must be derived");
  return found;
}

function sectorOf(
  derived: ReturnType<typeof deriveEconomy>,
  key: SectorKey,
): NonNullable<ReturnType<typeof deriveEconomy>["sectors"][number]> {
  const found = derived.sectors.find((sector) => {
    return sector.key === key;
  });
  assert.ok(found, key + " must be derived");
  return found;
}

test("19.2 — step 1 derives and validates with no errors", () => {
  const derived = deriveEconomy(aurelia());

  assert.deepEqual(derived.errors, []);
  assert.equal(derived.gdpTotalObor, 106000000);
  // Band index 3: 10 - 1,5 x (3 - 5) = 13,00 on both levers.
  close(derived.emissionStepLimitPp, 13.0, "emission step limit");
  close(derived.militaryStepLimitPp, 13.0, "military step limit");
  close(derived.newLoanAvailable, 28837.195109, "newLoanAvailable", 1e-4);
  // V18 fires for no sector — every finalPct is above 0.
  assert.equal(
    derived.warnings.filter((warning) => {
      return warning.startsWith("V18");
    }).length,
    0,
  );
});

test("19.3 — step 2 resources: eight rows and six sector penalties", () => {
  const derived = deriveEconomy(aurelia());

  const rows: [ResourceKey, number, number, number, number][] = [
    // key, need, supply, coverage, free
    ["coal", 56, 50, 0.892857, 0],
    ["oil", 30, 20, 0.666667, 0],
    ["fibre", 44, 50, 1.0, 6],
    ["ferrous", 48, 50, 1.0, 2],
    ["nonferrous", 48, 30, 0.625, 0],
    ["rubber", 30, 10, 0.333333, 0],
    ["chemical", 72, 70, 0.972222, 0],
    ["precious", 20, 5, 0.25, 0],
  ];
  for (const [key, need, supply, coverage, free] of rows) {
    const row = resourceOf(derived, key);
    assert.equal(row.needUnits, need, key + " need");
    assert.equal(row.supplyUnits, supply, key + " supply");
    close(row.coverage, coverage, key + " coverage", 1e-6);
    close(row.shortage, 1 - coverage, key + " shortage", 1e-6);
    assert.equal(row.freeUnits, free, key + " free");
    assert.equal(row.stockNextUnits, free, key + " next stock");
  }

  const penalties: [SectorKey, number][] = [
    ["agriculture", 0.011111],
    ["lightIndustry", 0.139484],
    ["heavyIndustry", 0.336129],
    ["commercial", 0.5],
    ["extraction", 0.107143],
    ["other1", 0.0],
  ];
  for (const [key, penalty] of penalties) {
    close(sectorOf(derived, key).shortagePenalty, penalty, key + " shortage penalty", 1e-6);
  }
});

test("19.4 — step 3 generation", () => {
  const derived = deriveEconomy(aurelia());

  close(sectorOf(derived, "lightIndustry").share, 0.169811, "light share", 1e-6);
  close(sectorOf(derived, "heavyIndustry").share, 0.283019, "heavy share", 1e-6);
  close(derived.plannedGrowthPct, 3.018868, "plannedGrowthPct", 1e-6);
  close(derived.frGrowthFactor, 1.060377, "frGrowthFactor", 1e-6);
  close(derived.ratingFactor, 1.08, "ratingFactor");
  close(derived.controlFrMultiplier, 1.2, "controlFrMultiplier");
  close(derived.controlGrowthPp, -1.0, "controlGrowthPp");
  close(derived.frTaxBase, 10600.0, "frTaxBase");
  close(derived.frDefenceDrag, 0.88, "frDefenceDrag");
  close(derived.frLightBonus, 0.042453, "frLightBonus", 1e-6);
  close(derived.frCore, 13363.197826, "frCore", 1e-5);
  close(derived.frEmission, 2120.0, "frEmission");
  close(derived.frGenerated, 15483.197826, "frGenerated", 1e-5);
  close(derived.micHeavyBonus, 0.141509, "micHeavyBonus", 1e-6);
  close(derived.micGenerated, 307.933585, "micGenerated", 1e-5);
  assert.equal(derived.ratingTier, "B");
  assert.equal(derived.controlBandIndex, 3);
  assert.equal(derived.controlBandName, "Dirigisme");
});

test("19.5 — step 4 actions: privatization succeeds on a roll of 7", () => {
  const derived = deriveEconomy(aurelia());

  assert.equal(derived.action.resolved, true);
  assert.equal(derived.action.success, true);
  assert.ok(derived.action.timedModifier);
  close(derived.action.timedModifier.growthPp, 0.525, "privatization modifier");
  assert.equal(derived.action.timedModifier.turnsRemaining, 2);
  assert.equal(derived.controlNext, 47);
  assert.equal(derived.action.privatizationFrDragTurns, 3);
  // The drag starts NEXT turn — this turn's frCore carries no x0,95.
  close(derived.frCore, 13363.197826, "frCore carries no drag this turn", 1e-5);
  assert.equal(derived.natFrPayout, 0);
  assert.equal(derived.natMicPayout, 0);
  assert.deepEqual(derived.action.ratingDeltas, []);
});

test("19.6 — step 5 borrowing", () => {
  const derived = deriveEconomy(aurelia());

  close(derived.debtLimit, 34837.195109, "debtLimit", 1e-4);
  close(derived.debtOutstanding, 6000, "debtOutstanding");
  close(derived.newLoanAvailable, 28837.195109, "newLoanAvailable", 1e-4);
  assert.equal(derived.createdLoan, null);
  assert.equal(derived.newLoanProceeds, 0);
});

test("19.7 — step 6 savings, and the reserve charged before debt service", () => {
  const derived = deriveEconomy(aurelia());

  assert.equal(derived.micStockWithdrawApplied, 0);
  close(derived.micStockEndPreUpkeep, 50, "micStockEnd");
  close(derived.micUpkeepDue, 100, "micUpkeepDue");
  close(derived.reserveCap, 30966.395652, "reserveCap", 1e-4);
  close(derived.reserveAddApplied, 500, "reserveAddApplied");
  close(derived.reserveWithdrawApplied, 0, "reserveWithdrawApplied");
  close(derived.reserveEnd, 3500, "reserveEnd");
  close(derived.frBalanceAfterSavings, 14983.197826, "frBalance6", 1e-5);
  // No clip, so V14 does not fire.
  assert.equal(
    derived.warnings.some((warning) => {
      return warning.startsWith("V14");
    }),
    false,
  );
});

test("19.8 — step 7 debt service against frBalance6, not gross income", () => {
  const derived = deriveEconomy(aurelia());
  const service = derived.loanService[0];
  assert.ok(service);

  assert.equal(service.serviced, true);
  close(service.interestDue, 720, "interestDue");
  close(service.requiredFr, 2220, "requiredFr");
  close(service.allocatedFr, 2220, "allocatedFr");
  close(service.shortfall, 0, "shortfall");
  close(service.principalNext, 4500, "principalNext");
  assert.equal(service.turnsRemainingNext, 3);
  assert.equal(derived.debtStatusNext, "normal");
  assert.equal(derived.debtRatingPenalty, 0);
  close(derived.frBalanceAfterDebt, 12763.197826, "frBalance7", 1e-5);
});

test("19.9 — step 8 upkeep is paid in full", () => {
  const derived = deriveEconomy(aurelia());

  assert.equal(derived.micStockLost, 0);
  close(derived.micUpkeepPaid, 100, "micUpkeepPaid");
  close(derived.micStockEnd, 50, "micStockEnd after upkeep");
  close(derived.frBalanceAfterUpkeep, 12663.197826, "frBalance8", 1e-5);
});

test("19.10 — step 9 spending, and the running-balance identity", () => {
  const derived = deriveEconomy(aurelia());

  close(derived.frAvailable, 15483.197826, "frAvailable", 1e-5);
  close(derived.frSpent, 5320, "frSpent");
  close(derived.frRemainder, 10163.197826, "frRemainder", 1e-5);
  close(derived.micAvailable, 307.933585, "micAvailable", 1e-5);
  close(derived.micSpent, 110, "micSpent");
  close(derived.micRemainder, 197.933585, "micRemainder", 1e-5);

  // Spec 8.4a asks T11-B to assert the identity: frBalance9 is the same set of
  // terms as frAvailable - frSpent, in a different order.
  const frBalance9 = derived.frBalanceAfterUpkeep + derived.frOtherIncome - 2500;
  close(frBalance9, derived.frRemainder, "frBalance9 equals frRemainder", 1e-9);
});

test("19.11 — step 10 auto-investment", () => {
  const derived = deriveEconomy(aurelia());

  close(derived.investedObor, 30223074.9, "investedObor", 0.01);
  close(derived.autoInvestGrowthPp, 0.5702466962, "autoInvestGrowthPp", 1e-9);
});

test("19.12 — step 11 growth", () => {
  const derived = deriveEconomy(aurelia());

  close(derived.controlGrowthPp, -1.0, "controlGrowthPp");
  close(derived.mobilizationGrowthPp, 0, "mobilizationGrowthPp");
  close(derived.concessionGrowthPp, 0, "concessionGrowthPp");
  close(derived.timedModifierPp, 0.525, "timedModifierPp");
  close(derived.reservePenaltyPp, 0.1981132075, "reservePenaltyPp", 1e-9);
  close(derived.inflationGrowthPp, 0.6, "inflationGrowthPp");
  close(derived.defenceGrowthPp, 0.2, "defenceGrowthPp");
  close(derived.modifierPp, -0.9028665114, "modifierPp", 1e-9);

  const finals: [SectorKey, number][] = [
    ["agriculture", 2.0738],
    ["lightIndustry", 1.8046],
    ["heavyIndustry", 1.3922],
    ["commercial", 0.7986],
    ["extraction", 1.8724],
    ["other1", 4.0971],
  ];
  for (const [key, expected] of finals) {
    close(sectorOf(derived, key).finalPct, expected, key + " finalPct", 5e-5);
  }
  close(derived.overallGrowthPct, 1.6939, "overallGrowthPct", 5e-5);
});

test("19.13 — step 12 GDP, per-sector within 1 obor and a summed total", () => {
  const derived = deriveEconomy(aurelia());

  const expected: [SectorKey, number][] = [
    ["agriculture", 24497720],
    ["lightIndustry", 18324831],
    ["heavyIndustry", 30417668],
    ["commercial", 20159713],
    ["extraction", 8149795],
    ["other1", 6245828],
  ];
  for (const [key, next] of expected) {
    const sector = sectorOf(derived, key);
    assert.ok(
      Math.abs(sector.gdpNextObor - next) <= 1,
      key + " next volume: expected " + next + ", got " + sector.gdpNextObor,
    );
  }
  assert.equal(derived.gdpNextTotalObor, 107795555);
  assert.equal(derived.gdpChangeObor, 1795555);
  assert.equal(derived.concessionCostObor, 0);

  // The total is the sum of the rounded parts, and it agrees with the whole
  // grown at the overall rate to the nearest obor.
  const whole = 106000000 * (1 + derived.overallGrowthPct / 100);
  assert.ok(Math.abs(whole - derived.gdpNextTotalObor) <= derived.sectors.length / 2 + 1);
});

test("19.14 — step 13 rating, and the clean-turn predicate's negative branch", () => {
  const derived = deriveEconomy(aurelia());

  assert.equal(derived.emissionRatingPenalty, 2);
  assert.equal(derived.ratingCleanTurn, false);
  assert.equal(derived.ratingRecovery, 0);
  assert.deepEqual(derived.ratingDeltas, [{ reason: "Emission", points: -2 }]);
  assert.equal(derived.ratingNext, 76);

  // Exactly one clause fails, which is what pins the negative branch.
  assert.equal(derived.debtShortfallTotal, 0);
  assert.ok(derived.overallGrowthPct > 0);
});

test("19.15 and 19.16 — flags and commit", () => {
  const before = aurelia();
  const result = resolveTurn(before);
  assert.ok(result.ok, "the turn must resolve");
  const next = result.next;

  assert.equal(next.turn, 5);
  assert.equal(next.ratingScore, 76);
  assert.equal(next.controlPosition, 47);
  close(next.reserveFr, 3500, "reserveFr");
  close(next.micStock, 50, "micStock");

  // The privatization modifier: created at step 4 with 2 turns, decremented to 1
  // at step 14, so it covers this turn and the next.
  assert.equal(next.timedModifiers.length, 1);
  close(next.timedModifiers[0]?.growthPp ?? 0, 0.525, "modifier growthPp");
  assert.equal(next.timedModifiers[0]?.turnsRemaining, 1);

  assert.equal(next.privatizationFrDragTurns, 2);
  assert.equal(next.turnsSincePrivatization, 0);
  assert.equal(next.turnsSinceNationalization, 6);

  for (const sector of next.sectors) {
    assert.equal(sector.growthTemporaryPct, 0, sector.key + " temporary growth cleared");
  }

  assert.equal(next.pendingAction, null);
  assert.equal(next.pendingConcession, null);
  assert.equal(next.borrowRequest, 0);
  assert.equal(next.reserveAdd, 0);
  assert.equal(next.reserveWithdraw, 0);
  assert.equal(next.micStockAdd, 0);
  assert.equal(next.micStockWithdraw, 0);

  // The ledger lists are the year's record and are NOT cleared.
  assert.equal(next.frExpenseLines.length, 1);
  assert.equal(next.micExpenseLines.length, 1);

  const stock = new Map(next.resources.map((resource) => {
    return [resource.key, resource.stockUnits];
  }));
  assert.equal(stock.get("fibre"), 6);
  assert.equal(stock.get("ferrous"), 2);
  assert.equal(stock.get("coal"), 0);
  for (const resource of next.resources) {
    assert.equal(resource.importsRequested, 0);
    assert.equal(resource.exports, 0);
  }

  close(next.emissionPctLast, 4.0, "emissionPctLast");
  close(next.militaryPctLast, 12.0, "militaryPctLast");

  assert.equal(next.loans.length, 1);
  close(next.loans[0]?.principal ?? 0, 4500, "loan principal");
  assert.equal(next.loans[0]?.turnsRemaining, 3);
  close(next.loans[0]?.ratePct ?? 0, 12, "loan rate");

  const total = next.sectors.reduce((sum, sector) => {
    return sum + sector.gdpObor;
  }, 0);
  assert.equal(total, 107795555);
});

test("the fifteen step records are produced in the spec's order", () => {
  const result = resolveTurn(aurelia());
  assert.ok(result.ok);
  assert.deepEqual(
    result.record.steps.map((step) => {
      return step.step;
    }),
    [
      "derive-and-validate",
      "resources",
      "generation",
      "actions",
      "borrowing",
      "savings",
      "debt-service",
      "upkeep",
      "spending",
      "auto-invest",
      "growth",
      "gdp",
      "rating",
      "flags",
      "commit",
    ],
  );
  assert.equal(result.record.turn, 4);
  assert.equal(result.record.ratingScore, 78);
  assert.equal(result.record.ratingNext, 76);
});
