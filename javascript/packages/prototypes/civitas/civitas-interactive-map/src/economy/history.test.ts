import assert from "node:assert/strict";
import test from "node:test";
import { ECONOMY_CONSTANTS } from "./constants";
import { buildTurnRecord, delta, pushTurnRecord } from "./history";
import { createInitialEconomy } from "./economy-state";
import { deriveEconomy } from "./derive";
import type { TurnRecord } from "./types";

function stubRecord(turn: number): TurnRecord {
  return {
    turn,
    gdpTotalObor: 0,
    gdpNextTotalObor: 0,
    overallGrowthPct: 0,
    frGenerated: 0,
    frRemainder: 0,
    micGenerated: 0,
    micRemainder: 0,
    ratingScore: 0,
    ratingNext: 0,
    controlPosition: 0,
    controlNext: 0,
    steps: [],
    warnings: [],
  };
}

test("a delta is rounded to the stored precision of its own unit", () => {
  assert.equal(delta("x", 1234.5678, "obor").value, 1235);
  assert.equal(delta("x", 1234.5678, "fr").value, 1234.57);
  assert.equal(delta("x", 1.234567, "pp").value, 1.2346);
  assert.equal(delta("x", 1.234567, "pct").value, 1.2346);
  assert.equal(delta("x", 3.7, "rating").value, 4);
  // Never a NaN: sanitizeRecord would drop the key entirely.
  assert.equal(delta("x", Number.NaN, "fr").value, 0);
});

test("a record carries the closing headline numbers and copies its inputs", () => {
  const state = createInitialEconomy();
  const derived = deriveEconomy(state);
  const steps = [{ step: "growth", deltas: [delta("modifierPp", 1, "pp")], notes: ["hi"] }];
  const record = buildTurnRecord(state, derived, steps);

  assert.equal(record.turn, 1);
  assert.equal(record.ratingScore, state.ratingScore);
  assert.equal(record.ratingNext, derived.ratingNext);
  assert.equal(record.controlPosition, state.controlPosition);
  assert.equal(record.controlNext, derived.controlNext);

  // The record must not share arrays with its source, or a later edit would
  // rewrite history.
  steps[0]?.notes.push("later");
  assert.deepEqual(record.steps[0]?.notes, ["hi"]);
});

test("history is newest last and never grows past the cap", () => {
  let history: TurnRecord[] = [];
  for (let turn = 1; turn <= 20; turn += 1) {
    history = pushTurnRecord(history, stubRecord(turn));
  }
  assert.equal(history.length, ECONOMY_CONSTANTS.TURN_HISTORY_MAX);
  assert.equal(history[0]?.turn, 9);
  assert.equal(history[history.length - 1]?.turn, 20);
});

test("pushing does not mutate the list it was given", () => {
  const original: TurnRecord[] = [stubRecord(1)];
  const next = pushTurnRecord(original, stubRecord(2));
  assert.equal(original.length, 1);
  assert.equal(next.length, 2);
});
