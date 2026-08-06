import assert from "node:assert/strict";
import test from "node:test";
import { createInitialEconomy } from "./economy-state";
import { deriveEconomy } from "./derive";
import { resolveTurn } from "./pipeline";
import type { EconomyState, ResourceKey, SectorKey } from "./types";

// Spec section 16.3: "Pure, deterministic, side-effect free. Same input, same
// output, always."
//
// The engine has no clock, no random source and no store — `purity.test.ts`
// proves it holds none of those. This file proves the consequence: the same
// state produces the same numbers on every call, and the input state is never
// touched. Both halves matter to T12, which calls `deriveEconomy` on every
// keystroke against the state it is still editing.

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

const SECTORS: [SectorKey, number, number, number][] = [
  ["agriculture", 24000000, 3.0, 0],
  ["lightIndustry", 18000000, 3.0, 0],
  ["heavyIndustry", 30000000, 4.0, -1.0],
  ["commercial", 20000000, 2.5, 0],
  ["extraction", 8000000, 3.0, 0],
  ["other1", 6000000, 5.0, 0],
];

// The section 19 fixture: the richest state the engine has, exercising loans, an
// action, a reserve movement, a stockpile movement, emission, ledger lines and a
// resource shortage all at once.
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
  state.reserveFr = 3000;
  state.reserveAdd = 500;
  state.micStock = 40;
  state.micStockAdd = 10;
  state.frExpenseLines = [{ label: "orders", points: 2500 }];
  state.micExpenseLines = [{ label: "orders", points: 100 }];
  state.turnsSinceNationalization = 5;
  state.turnsSincePrivatization = 4;
  state.pendingAction = { kind: "privatization", enterprise: "civilian", roll: 7 };
  state.loans = [{
    id: 1,
    principal: 6000,
    ratePct: 12,
    termTurns: 6,
    turnsRemaining: 4,
    createdTurn: 2,
    allocatedFr: 0,
  }];
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

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object") {
    return;
  }
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
}

test("deriveEconomy returns the same numbers every time it is called", () => {
  const state = aurelia();
  const first = deriveEconomy(state, { provinceCount: 20 });
  const second = deriveEconomy(state, { provinceCount: 20 });
  assert.deepEqual(first, second);

  // And on a separate but equal state, so nothing is cached across calls either.
  const third = deriveEconomy(aurelia(), { provinceCount: 20 });
  assert.deepEqual(first, third);
});

test("deriveEconomy does not mutate the state it is handed", () => {
  const state = aurelia();
  const snapshot = JSON.parse(JSON.stringify(state)) as unknown;

  deriveEconomy(state, { provinceCount: 20 });
  deriveEconomy(state, { provinceCount: 20 });

  assert.deepEqual(JSON.parse(JSON.stringify(state)) as unknown, snapshot);
});

test("a deep-frozen state derives and resolves without a write anywhere", () => {
  // The strongest form of the no-mutation claim: a frozen object throws on any
  // assignment in a module, so a single write to the input graph fails here.
  const state = aurelia();
  deepFreeze(state);

  const derived = deriveEconomy(state, { provinceCount: 20 });
  assert.deepEqual(derived.errors, []);

  const result = resolveTurn(state, { provinceCount: 20 });
  assert.ok(result.ok);
  assert.equal(result.next.turn, 5);
});

test("resolveTurn produces byte-identical output from byte-identical input", () => {
  const first = resolveTurn(aurelia(), { provinceCount: 20 });
  const second = resolveTurn(aurelia(), { provinceCount: 20 });
  assert.ok(first.ok && second.ok);
  assert.deepEqual(first.next, second.next);
  assert.deepEqual(first.record, second.record);
});

test("a whole trajectory repeats: five turns run twice land on the same state", () => {
  function play(turns: number): EconomyState {
    let state = aurelia();
    for (let index = 0; index < turns; index += 1) {
      const result = resolveTurn(state, { provinceCount: 20 });
      assert.ok(result.ok, "turn " + index + " must resolve");
      state = result.next;
    }
    return state;
  }

  assert.deepEqual(play(5), play(5));
});

test("the next state shares no object with the state it came from", () => {
  const state = aurelia();
  const result = resolveTurn(state, { provinceCount: 20 });
  assert.ok(result.ok);
  const next = result.next;

  assert.notEqual(next, state);
  assert.notEqual(next.sectors, state.sectors);
  assert.notEqual(next.resources, state.resources);
  assert.notEqual(next.loans, state.loans);
  assert.notEqual(next.frExpenseLines, state.frExpenseLines);
  assert.notEqual(next.history, state.history);
  for (const sector of next.sectors) {
    for (const original of state.sectors) {
      assert.notEqual(sector, original, sector.key + " must be a fresh object");
    }
  }
  for (const resource of next.resources) {
    for (const original of state.resources) {
      assert.notEqual(resource, original, resource.key + " must be a fresh object");
    }
  }

  // So editing the next state cannot reach back into the old one.
  const firstSector = next.sectors[0];
  assert.ok(firstSector);
  firstSector.gdpObor = 1;
  firstSector.growthPermanentPct = 99;
  assert.equal(state.sectors[0]?.gdpObor, 24000000);
  assert.equal(state.sectors[0]?.growthPermanentPct, 3);
});

test("an aborted turn is deterministic too, and reports the same errors twice", () => {
  const broken = createInitialEconomy();
  broken.emissionPct = 40;
  broken.emissionPctLast = 0;
  broken.militaryPct = 90;

  const first = resolveTurn(broken);
  const second = resolveTurn(broken);
  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  assert.ok(!first.ok && !second.ok);
  assert.deepEqual(first.errors, second.errors);
  assert.deepEqual(
    first.errors.map((error) => {
      return error.code;
    }),
    ["V2", "V3", "V4"],
  );
});
