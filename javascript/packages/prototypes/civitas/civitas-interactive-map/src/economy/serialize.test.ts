import assert from "node:assert/strict";
import test from "node:test";
import { MAX_JSON_DEPTH, sanitizeRecord } from "../state/schema";
import { economyFromJson, economyToJson } from "./serialize";
import { createInitialEconomy } from "./economy-state";
import { resolveTurn } from "./pipeline";
import { ECONOMY_CONSTANTS, RESOURCE_KEYS } from "./constants";
import type { EconomyState } from "./types";

function depthOf(value: unknown, level: number): number {
  if (Array.isArray(value)) {
    let deepest = level;
    for (const entry of value) {
      deepest = Math.max(deepest, depthOf(entry, level + 1));
    }
    return deepest;
  }
  if (typeof value === "object" && value !== null) {
    let deepest = level;
    for (const entry of Object.values(value)) {
      deepest = Math.max(deepest, depthOf(entry, level + 1));
    }
    return deepest;
  }
  return level;
}

test("a fresh economy survives a round trip through sanitizeRecord unchanged", () => {
  const state = createInitialEconomy();
  const stored = sanitizeRecord(economyToJson(state), MAX_JSON_DEPTH);
  const { state: back, repairs } = economyFromJson(stored);

  assert.deepEqual(repairs, []);
  assert.deepEqual(back, state);
});

test("a played economy with history survives the same round trip", () => {
  let state = createInitialEconomy();
  state.resources = state.resources.map((resource) => {
    return { ...resource, deposits: 2 };
  });
  state.region = "bengo";
  for (let turn = 0; turn < 3; turn += 1) {
    const result = resolveTurn(state, { provinceCount: 20 });
    assert.ok(result.ok);
    state = result.next;
  }

  const stored = sanitizeRecord(economyToJson(state), MAX_JSON_DEPTH);
  const { state: back } = economyFromJson(stored);
  assert.deepEqual(back, state);
  assert.equal(back.history.length, 3);
});

test("the document stays inside sanitizeRecord's eight container levels", () => {
  let state = createInitialEconomy();
  const result = resolveTurn(state);
  assert.ok(result.ok);
  state = result.next;

  const json = economyToJson(state);
  // Level 1 is the slot's own `data` object, which is `json` itself.
  const depth = depthOf(json, 1);
  assert.ok(depth <= MAX_JSON_DEPTH, "the document reaches level " + depth);

  // And nothing is silently dropped on the way in.
  assert.deepEqual(sanitizeRecord(json, MAX_JSON_DEPTH), json);
});

test("a NaN never reaches the document", () => {
  const poisoned = {
    ...createInitialEconomy(),
    reserveFr: Number.NaN,
    micStock: Number.POSITIVE_INFINITY,
  };
  const json = economyToJson(poisoned);
  assert.equal(json.reserveFr, 0);
  assert.equal(json.micStock, 0);
  // sanitizeRecord DROPS such a key rather than nulling it, so a survived key
  // proves finiteOr ran first.
  const stored = sanitizeRecord(json, MAX_JSON_DEPTH);
  assert.ok("reserveFr" in stored);
  assert.ok("micStock" in stored);
});

test("absent is null, never undefined", () => {
  const json = economyToJson(createInitialEconomy());
  assert.equal(json.pendingAction, null);
  assert.equal(json.pendingConcession, null);
  const sectors = json.sectors as { grounds: unknown }[];
  assert.equal(sectors[0]?.grounds, null);
});

test("the reader repairs rather than throws on rubbish", () => {
  for (const rubbish of [null, 42, "nope", [], true]) {
    const { state, repairs } = economyFromJson(rubbish);
    assert.ok(repairs.length > 0);
    assert.equal(state.sectors.length, 5);
    assert.equal(state.resources.length, 8);
  }
});

test("a missing base sector is inserted at 0 obor", () => {
  const json = economyToJson(createInitialEconomy());
  json.sectors = (json.sectors as unknown[]).slice(1) as never;
  const { state, repairs } = economyFromJson(json);

  assert.equal(state.sectors.length, 5);
  assert.equal(state.sectors[0]?.key, "agriculture");
  assert.equal(state.sectors[0]?.gdpObor, 0);
  assert.ok(repairs.some((repair) => {
    return repair.includes("agriculture");
  }));
});

test("a duplicate or unknown sector key is dropped, and Other sectors are kept", () => {
  const base = economyToJson(createInitialEconomy());
  const sectors = base.sectors as unknown[];
  base.sectors = [
    ...sectors,
    sectors[0],
    { key: "nonsense", gdpObor: 1 },
    { key: "other1", name: "Aerospace", grounds: "reasons", gdpObor: 5, growthPermanentPct: 1, growthTemporaryPct: 0 },
  ] as never;

  const { state, repairs } = economyFromJson(base);
  assert.equal(state.sectors.length, 6);
  assert.equal(state.sectors[5]?.key, "other1");
  assert.ok(repairs.some((repair) => {
    return repair.includes("duplicate");
  }));
  assert.ok(repairs.some((repair) => {
    return repair.includes("unknown key");
  }));
});

test("a missing resource row is inserted in the spec's order", () => {
  const json = economyToJson(createInitialEconomy());
  json.resources = (json.resources as unknown[]).slice(2) as never;
  const { state, repairs } = economyFromJson(json);

  assert.deepEqual(
    state.resources.map((resource) => {
      return resource.key;
    }),
    [...RESOURCE_KEYS],
  );
  assert.equal(repairs.length, 2);
});

test("the ledger lists are truncated to 24 lines", () => {
  const json = economyToJson(createInitialEconomy());
  json.frExpenseLines = Array.from({ length: 40 }, (_unused, index) => {
    return { label: "line " + index, points: 1 };
  }) as never;
  const { state, repairs } = economyFromJson(json);

  assert.equal(state.frExpenseLines.length, ECONOMY_CONSTANTS.LEDGER_LINE_MAX);
  assert.ok(repairs.some((repair) => {
    return repair.includes("frExpenseLines");
  }));
});

test("a wrong-typed or non-finite number falls back to its default", () => {
  const json = economyToJson(createInitialEconomy());
  json.reserveFr = "lots" as never;
  json.emissionPct = -5 as never;
  json.turn = 0 as never;
  const { state } = economyFromJson(json);

  assert.equal(state.reserveFr, 0);
  assert.equal(state.emissionPct, 0);
  assert.equal(state.turn, 1);
});

test("the rating and the control position are clamped into 0..100", () => {
  const json = economyToJson(createInitialEconomy());
  json.ratingScore = 500 as never;
  json.controlPosition = -20 as never;
  const { state, repairs } = economyFromJson(json);

  assert.equal(state.ratingScore, 100);
  assert.equal(state.controlPosition, 0);
  assert.equal(repairs.length, 2);
});

test("malformed loans, concessions and modifiers are dropped, and the ids stay ahead", () => {
  const json = economyToJson(createInitialEconomy());
  json.loans = [{ id: 9, principal: 100 }, { principal: 5 }, "junk"] as never;
  json.concessions = [
    { id: 4, sectorKey: "commercial", gdpTransferredObor: 1, grantedTurn: 1, active: true },
    { id: 5, sectorKey: "nope" },
  ] as never;
  json.timedModifiers = [{ id: 3, reason: "x", growthPp: 1, turnsRemaining: 2 }, 7] as never;

  const { state, repairs } = economyFromJson(json);
  assert.equal(state.loans.length, 1);
  assert.equal(state.nextLoanId, 10);
  assert.equal(state.concessions.length, 1);
  assert.equal(state.nextConcessionId, 5);
  assert.equal(state.timedModifiers.length, 1);
  assert.equal(state.nextModifierId, 4);
  assert.equal(repairs.length, 4);
});

test("an over-long history is trimmed to the newest twelve", () => {
  const json = economyToJson(createInitialEconomy());
  json.history = Array.from({ length: 30 }, (_unused, index) => {
    return { turn: index + 1, steps: [], warnings: [] };
  }) as never;
  const { state } = economyFromJson(json);

  assert.equal(state.history.length, ECONOMY_CONSTANTS.TURN_HISTORY_MAX);
  assert.equal(state.history[0]?.turn, 19);
  assert.equal(state.history[11]?.turn, 30);
});

test("a repaired state still resolves a turn", () => {
  const { state } = economyFromJson({ sectors: "broken" });
  const result = resolveTurn(state as EconomyState);
  assert.ok(result.ok, "a repaired document must never be unplayable");
});
