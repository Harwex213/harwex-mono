import assert from "node:assert/strict";
import test from "node:test";
import { createInitialEconomy } from "./economy-state";
import { deriveEconomy } from "./derive";
import { deriveUpkeepStage } from "./savings";
import { resolveTurn } from "./pipeline";
import type { EconomyState, ResourceKey, SectorKey } from "./types";

// Spec section 19 again — the intermediate columns `fixture.test.ts` leaves
// implicit.
//
// `fixture.test.ts` walks the fifteen steps and pins the headline number of
// each. This file pins the working: the four supply columns behind `supply`,
// every sector share, the base and pre-shortage columns behind `finalPct`, the
// interest/principal split behind `allocatedFr`, the points the budget could
// have maintained, the per-sector GDP change, and the closing turn record.
//
// Every expectation below is the spec's own arithmetic, recomputed by hand from
// section 19.1's opening state. None of it was read off a run.

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

// Aurelia, turn 4. Spec section 19.1, field for field.
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

test("19.3 — the four supply columns behind the fixture's `supply`", () => {
  const derived = deriveEconomy(aurelia());

  // 50 units per deposit per turn, no extraction bonus; imports arrive in full
  // because nothing is blockaded; nothing is exported, so onHand IS supply.
  const rows: [ResourceKey, number, number, number][] = [
    // key, extraction, imports, onHand
    ["coal", 50, 0, 50],
    ["oil", 0, 20, 20],
    ["fibre", 50, 0, 50],
    ["ferrous", 50, 0, 50],
    ["nonferrous", 0, 30, 30],
    ["rubber", 0, 10, 10],
    ["chemical", 50, 20, 70],
    ["precious", 0, 5, 5],
  ];
  for (const [key, extraction, imports, onHand] of rows) {
    const row = resourceOf(derived, key);
    assert.equal(row.extractionUnits, extraction, key + " extraction");
    assert.equal(row.importUnits, imports, key + " imports");
    assert.equal(row.onHandUnits, onHand, key + " on hand");
    assert.equal(row.exportsAppliedUnits, 0, key + " exports");
    assert.equal(row.supplyUnits, onHand, key + " supply is on-hand minus exports");
  }
});

test("19.4 — every sector share, and the six shares sum to exactly 1", () => {
  const derived = deriveEconomy(aurelia());

  const shares: [SectorKey, number][] = [
    ["agriculture", 24 / 106],
    ["lightIndustry", 18 / 106],
    ["heavyIndustry", 30 / 106],
    ["commercial", 20 / 106],
    ["extraction", 8 / 106],
    ["other1", 6 / 106],
  ];
  let total = 0;
  for (const [key, share] of shares) {
    const sector = sectorOf(derived, key);
    close(sector.share, share, key + " share", 1e-9);
    total += sector.share;
  }
  close(total, 1, "the shares sum to 1", 1e-9);

  // (24x3 + 18x3 + 30x3 + 20x2,5 + 8x3 + 6x5) / 106 = 320/106.
  close(derived.plannedGrowthPct, 320 / 106, "plannedGrowthPct", 1e-12);
});

test("19.4 — the emission block at 4,00%: 6,00% inflation and 2 rating points", () => {
  const derived = deriveEconomy(aurelia());

  close(derived.inflationPct, 6.0, "inflationPct");
  close(derived.inflationGrowthPp, 0.6, "inflationGrowthPp");
  assert.equal(derived.emissionRatingPenalty, 2);
  // 53 000 points of tax base x 1,00 x 0,04, added and never multiplied in.
  close(derived.frEmission, 2120.0, "frEmission");
  close(derived.frGenerated - derived.frCore, 2120.0, "emission enters additively", 1e-9);
});

test("19.1 — Aurelia is unmobilized and both actions are off cooldown", () => {
  const derived = deriveEconomy(aurelia());

  close(derived.frRegimeMultiplier, 1, "frRegimeMultiplier");
  close(derived.micRegimeMultiplier, 1, "micRegimeMultiplier");
  close(derived.mobilizationGrowthPp, 0, "mobilizationGrowthPp");
  // 5 and 4 turns since, both at or past the 2-turn cooldown; band index 3 is
  // neither the nationalization lock (0) nor the privatization lock (10).
  assert.equal(derived.nationalizationAvailable, true);
  assert.equal(derived.privatizationAvailable, true);
});

test("19.6 — tier B's rate and term come from the table, not from the loan", () => {
  const derived = deriveEconomy(aurelia());

  assert.equal(derived.newLoanRatePct, 12);
  assert.equal(derived.newLoanTermTurns, 6);
  close(derived.debtOutstanding, 6000, "debtOutstanding is the start-of-turn principal");
  // debtLimit - debtOutstanding, and the request of 0 creates nothing.
  close(
    derived.newLoanAvailable,
    derived.debtLimit - 6000,
    "newLoanAvailable is limit minus outstanding",
    1e-9,
  );
  assert.equal(derived.createdLoan, null);
});

test("19.8 — interest is paid before principal out of the 2 220 allocated", () => {
  const derived = deriveEconomy(aurelia());
  const service = derived.loanService[0];
  assert.ok(service);

  close(service.interestPaid, 720, "interestPaid");
  close(service.principalPaid, 1500, "principalPaid");
  close(service.interestPaid + service.principalPaid, 2220, "the two halves are the whole", 1e-9);
  close(derived.debtRequiredTotal, 2220, "debtRequiredTotal");
  close(derived.debtAllocatedTotal, 2220, "debtAllocatedTotal");
  close(derived.debtShortfallTotal, 0, "debtShortfallTotal");
  assert.equal(derived.defaultLastTurnNext, false);
});

test("19.9 — the balance could have maintained 6 381 points and holds 50", () => {
  // Spec 19.9's own arithmetic: floor(12 763,197826 / 2) = 6 381, which is far
  // above the 50 points held, so nothing is lost and upkeep is paid in full.
  const stage = deriveUpkeepStage(50, 12763.197826);

  assert.equal(stage.micPointsPaidFor, 6381);
  assert.equal(stage.micStockLost, 0);
  close(stage.micStockEnd, 50, "micStockEnd");
  close(stage.micUpkeepPaid, 100, "micUpkeepPaid");
  assert.deepEqual(stage.warnings, []);
});

test("19.12 — the base and pre-shortage columns behind every finalPct", () => {
  const derived = deriveEconomy(aurelia());

  // modifierPp is one number for every sector: -1,0000 + 0,5250 + 0,5702466962
  // - 0,1981132075 - 0,6000 - 0,2000.
  const modifier = -0.9028665114;
  const bases: [SectorKey, number][] = [
    ["agriculture", 3.0],
    ["lightIndustry", 3.0],
    // 4,00 permanent and -1,00 temporary add to 3,00.
    ["heavyIndustry", 3.0],
    ["commercial", 2.5],
    ["extraction", 3.0],
    ["other1", 5.0],
  ];
  for (const [key, base] of bases) {
    const sector = sectorOf(derived, key);
    close(sector.basePct, base, key + " basePct", 1e-9);
    close(sector.preShortagePct, base + modifier, key + " preShortagePct", 1e-9);
    // The shortage scales the pre-shortage rate; it never subtracts from it.
    close(
      sector.finalPct,
      sector.preShortagePct * (1 - sector.shortagePenalty),
      key + " finalPct is the scaled pre-shortage rate",
      1e-12,
    );
  }
});

test("19.13 — the per-sector change column, and the change is their sum", () => {
  const derived = deriveEconomy(aurelia());

  const changes: [SectorKey, number][] = [
    ["agriculture", 497720],
    ["lightIndustry", 324831],
    ["heavyIndustry", 417668],
    ["commercial", 159713],
    ["extraction", 149795],
    ["other1", 245828],
  ];
  let total = 0;
  for (const [key, change] of changes) {
    const sector = sectorOf(derived, key);
    const actual = sector.gdpNextObor - sector.gdpObor;
    assert.ok(
      Math.abs(actual - change) <= 1,
      key + " change: expected " + change + ", got " + actual,
    );
    total += actual;
  }
  assert.equal(total, derived.gdpChangeObor);
  assert.equal(derived.gdpChangeObor, 1795555);
});

test("19.16 — the turn record carries the closing headline numbers", () => {
  const result = resolveTurn(aurelia());
  assert.ok(result.ok);
  const record = result.record;

  assert.equal(record.turn, 4);
  assert.equal(record.gdpTotalObor, 106000000);
  assert.equal(record.gdpNextTotalObor, 107795555);
  // Percentages are stored at 4 decimals, points at 2.
  assert.equal(record.overallGrowthPct, 1.6939);
  assert.equal(record.frGenerated, 15483.2);
  assert.equal(record.frRemainder, 10163.2);
  assert.equal(record.micGenerated, 307.93);
  assert.equal(record.micRemainder, 197.93);
  assert.equal(record.ratingScore, 78);
  assert.equal(record.ratingNext, 76);
  assert.equal(record.controlPosition, 44);
  assert.equal(record.controlNext, 47);
  assert.deepEqual(record.warnings, []);

  // And the record is what the history keeps.
  assert.equal(result.next.history.length, 1);
  assert.deepEqual(result.next.history[0], record);
});
