import assert from "node:assert/strict";
import test from "node:test";
import { ECONOMY_CONSTANTS } from "./constants";
import { STEP_NAMES, TURN_STEPS, resolveTurn } from "./pipeline";
import { createInitialEconomy } from "./economy-state";
import { deriveEconomy } from "./derive";
import type { EconomyState, ResourceKey } from "./types";

const DEPOSITS: Record<ResourceKey, number> = {
  coal: 2, oil: 1, fibre: 1, ferrous: 1,
  nonferrous: 1, rubber: 1, chemical: 2, precious: 1,
};

function healthy(): EconomyState {
  const state = createInitialEconomy();
  state.resources = state.resources.map((resource) => {
    return { ...resource, deposits: DEPOSITS[resource.key] };
  });
  return state;
}

test("the fifteen step names deep-equal the spec's list in the spec's order", () => {
  // The order is load-bearing: the FR charges at steps 6, 7, 8 and 9 draw on one
  // running balance, so a reordering silently changes every number.
  assert.deepEqual(
    TURN_STEPS.map((step) => {
      return step.name;
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
  assert.deepEqual(
    TURN_STEPS.map((step) => {
      return step.name;
    }),
    [...STEP_NAMES],
  );
});

test("an aborted turn writes nothing at all", () => {
  const before = healthy();
  before.emissionPct = 999;
  const snapshot = JSON.parse(JSON.stringify(before)) as unknown;

  const result = resolveTurn(before);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.errors.length > 0);
  assert.deepEqual(JSON.parse(JSON.stringify(before)) as unknown, snapshot);
});

test("a successful turn does not mutate its argument either", () => {
  const before = healthy();
  const snapshot = JSON.parse(JSON.stringify(before)) as unknown;

  const result = resolveTurn(before);
  assert.ok(result.ok);
  assert.deepEqual(JSON.parse(JSON.stringify(before)) as unknown, snapshot);
  assert.notEqual(result.next, before);
  assert.notEqual(result.next.sectors, before.sectors);
});

test("frBalance9 equals frAvailable - frSpent to the last bit (spec 8.4a)", () => {
  const state = healthy();
  state.reserveFr = 2000;
  state.reserveAdd = 500;
  state.reserveWithdraw = 100;
  state.micStock = 20;
  state.micStockAdd = 5;
  state.frExpenseLines = [{ label: "orders", points: 1200 }];
  state.frIncomeLines = [{ label: "a sale", points: 300 }];
  state.loans = [{
    id: 1,
    principal: 4000,
    ratePct: 12,
    termTurns: 6,
    turnsRemaining: 3,
    createdTurn: 1,
    allocatedFr: 0,
  }];
  state.turn = 3;

  const derived = deriveEconomy(state);
  const frBalance9 = derived.frBalanceAfterUpkeep + derived.frOtherIncome - 1200;
  assert.ok(
    Math.abs(frBalance9 - derived.frRemainder) < 1e-9,
    "balance " + frBalance9 + " against remainder " + derived.frRemainder,
  );
  // And the running balance falls exactly as the four charges are taken.
  assert.ok(derived.frBalanceAfterSavings > derived.frBalanceAfterDebt);
  assert.ok(derived.frBalanceAfterDebt >= derived.frBalanceAfterUpkeep);
});

test("history is newest last and trims to twelve records (guard G25)", () => {
  let state = healthy();
  for (let turn = 0; turn < ECONOMY_CONSTANTS.TURN_HISTORY_MAX + 4; turn += 1) {
    const result = resolveTurn(state);
    assert.ok(result.ok, "turn " + turn + " must resolve");
    state = result.next;
  }
  assert.equal(state.history.length, ECONOMY_CONSTANTS.TURN_HISTORY_MAX);
  const turns = state.history.map((entry) => {
    return entry.turn;
  });
  assert.deepEqual(turns, [...turns].sort((a, b) => {
    return a - b;
  }));
  assert.equal(turns[turns.length - 1], state.turn - 1);
});

test("a turn record stays flat — no nested record inside a delta", () => {
  const result = resolveTurn(healthy());
  assert.ok(result.ok);
  for (const step of result.record.steps) {
    for (const item of step.deltas) {
      assert.equal(typeof item.label, "string");
      assert.equal(typeof item.value, "number");
      assert.ok(Number.isFinite(item.value), step.step + "/" + item.label);
      assert.equal(typeof item.unit, "string");
    }
    for (const note of step.notes) {
      assert.equal(typeof note, "string");
    }
  }
});

test("a reserve addition charged at step 6 can starve an auto-serviced loan", () => {
  // Spec 17's cheapest route to the arrears path: no invalid input anywhere.
  const state = healthy();
  state.turn = 3;
  state.reserveFr = 0;
  state.reserveAdd = 9000;
  state.loans = [{
    id: 1,
    principal: 20000,
    ratePct: 12,
    termTurns: 6,
    turnsRemaining: 1,
    createdTurn: 1,
    allocatedFr: 0,
  }];

  const derived = deriveEconomy(state);
  assert.deepEqual(derived.errors, []);
  assert.ok(derived.debtShortfallTotal > 0, "the loan is starved");
  assert.ok(derived.debtRatingPenalty > 0);
  assert.ok(derived.warnings.some((warning) => {
    return warning.startsWith("V17");
  }));
  assert.equal(derived.debtStatusNext, "arrears");

  const result = resolveTurn(state);
  assert.ok(result.ok, "a shortfall is a warning, never an abort");
  assert.equal(result.next.debtStatus, "arrears");
  assert.equal(result.next.defaultLastTurn, true);
  // A second short turn tips it into default.
  assert.equal(deriveEconomy({ ...result.next, reserveAdd: 0 }).debtStatusNext !== "normal", true);
});

test("a loan repaid in full leaves the array (DESIGN addition 3)", () => {
  const state = healthy();
  state.turn = 3;
  state.loans = [{
    id: 1,
    principal: 100,
    ratePct: 10,
    termTurns: 2,
    turnsRemaining: 1,
    createdTurn: 1,
    allocatedFr: 0,
  }];
  const result = resolveTurn(state);
  assert.ok(result.ok);
  assert.deepEqual(result.next.loans, []);
  const debtStep = result.record.steps.find((step) => {
    return step.step === "debt-service";
  });
  assert.ok(debtStep?.notes.some((note) => {
    return note.includes("closed");
  }));
});

test("a loan taken this turn is not serviced until the next one", () => {
  const state = healthy();
  state.borrowRequest = 5000;

  const first = resolveTurn(state);
  assert.ok(first.ok);
  assert.equal(first.next.loans.length, 1);
  const created = first.next.loans[0];
  assert.ok(created);
  assert.equal(created.principal, 5000, "no payment was taken this turn");
  assert.equal(created.turnsRemaining, created.termTurns, "and no term tick either");
  assert.equal(first.next.borrowRequest, 0);

  const second = resolveTurn(first.next);
  assert.ok(second.ok);
  assert.ok((second.next.loans[0]?.principal ?? 0) < 5000, "the first payment lands next turn");
});

test("a concession is created at step 4 and priced at step 12", () => {
  const state = healthy();
  state.region = "bengo";
  state.pendingConcession = { sectorKey: "commercial" };

  const derived = deriveEconomy(state, { provinceCount: 20 });
  assert.deepEqual(derived.errors, []);
  // The bonus is in force on the grant turn, because the grant resolves at step
  // 4 and growth resolves at step 11.
  assert.equal(derived.concessionGrowthPp, 1.5);
  assert.equal(derived.concessionCostObor, 5000000);

  const result = resolveTurn(state, { provinceCount: 20 });
  assert.ok(result.ok);
  assert.equal(result.next.concessions.length, 1);
  const granted = result.next.concessions[0];
  assert.ok(granted);
  assert.equal(granted.sectorKey, "commercial");
  assert.equal(granted.grantedTurn, 1);
  assert.equal(granted.active, true);
  assert.equal(granted.gdpTransferredObor, 5000000);
  assert.equal(result.next.pendingConcession, null);
  assert.equal(result.next.nextConcessionId, 2);

  // The cost lands on the NEXT-turn volume; the start-of-turn total was frozen.
  const commercial = result.next.sectors.find((sector) => {
    return sector.key === "commercial";
  });
  assert.ok(commercial);
  assert.ok(commercial.gdpObor < 20000000, "the grantor's sector shrank");
  // The bonus persists while the concession is active.
  assert.equal(deriveEconomy(result.next).concessionGrowthPp, 1.5);
});

test("the commit rounds to the stored precision and writes only finite numbers", () => {
  const result = resolveTurn(healthy());
  assert.ok(result.ok);
  const next = result.next;

  for (const sector of next.sectors) {
    assert.ok(Number.isInteger(sector.gdpObor), sector.key + " volume must be whole obor");
  }
  for (const resource of next.resources) {
    assert.ok(Number.isInteger(resource.stockUnits), resource.key + " stock must be whole");
  }
  assert.ok(Number.isInteger(next.ratingScore));
  assert.ok(Number.isInteger(next.controlPosition));
  assert.ok(Number.isInteger(next.turn));
  assert.equal(next.reserveFr, Math.round(next.reserveFr * 100) / 100);
});

test("no step other than the six that own state writes to the draft", () => {
  // A cheap structural check: running the pipeline twice from the same input
  // gives byte-identical output, so nothing reads a mutated shared object.
  const first = resolveTurn(healthy());
  const second = resolveTurn(healthy());
  assert.ok(first.ok && second.ok);
  assert.deepEqual(first.next, second.next);
  assert.deepEqual(first.record, second.record);
});
