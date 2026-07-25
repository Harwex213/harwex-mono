import { describe, test } from "node:test";
import assert from "node:assert";
import { computeLosses } from "./losses.js";

const unit = (overrides) => ({
  id: 1,
  name: "Unit",
  side: "attacker",
  type: "light-spearman",
  hp: 100,
  maxHp: 100,
  destroyed: false,
  routed: false,
  position: null,
  ...overrides,
});

describe("computeLosses", () => {
  test("survivor casualties = round(50% of HP lost)", () => {
    const units = [unit({ maxHp: 100, hp: 60, destroyed: false, routed: false })];

    const losses = computeLosses(units);
    const row = losses.attacker.survivors[0];

    assert.strictEqual(row.casualties, 20);
    assert.strictEqual(row.prisoners, 0);
    assert.strictEqual(row.status, "survivor");
    assert.strictEqual(losses.attacker.survivors.length, 1);
  });

  test("full-HP survivor has zero casualties", () => {
    const units = [unit({ maxHp: 100, hp: 100 })];

    const losses = computeLosses(units);

    assert.strictEqual(losses.attacker.survivors[0].casualties, 0);
  });

  test("routed unit off field: 50% formula, status routed", () => {
    const units = [unit({ routed: true, destroyed: false, position: null, maxHp: 80, hp: 30 })];

    const losses = computeLosses(units);
    const row = losses.attacker.routed[0];

    assert.strictEqual(row.casualties, 25);
    assert.strictEqual(row.status, "routed");
    assert.strictEqual(losses.attacker.routed.length, 1);
  });

  test("routed unit still on field: still routed, 50% formula", () => {
    const units = [unit({ routed: true, destroyed: false, position: { row: 1, col: 1 }, maxHp: 80, hp: 30 })];

    const losses = computeLosses(units);
    const row = losses.attacker.routed[0];

    assert.strictEqual(row.status, "routed");
    assert.strictEqual(row.casualties, 25);
  });

  test("destroyed unit: full casualties, half prisoners", () => {
    const units = [unit({ destroyed: true, maxHp: 100, hp: 0 })];

    const losses = computeLosses(units);
    const row = losses.attacker.destroyed[0];

    assert.strictEqual(row.casualties, 100);
    assert.strictEqual(row.prisoners, 50);
    assert.strictEqual(row.status, "destroyed");
    assert.strictEqual(losses.attacker.destroyed.length, 1);
  });

  test("arithmetic rounding rounds .5 up", () => {
    const units = [unit({ maxHp: 100, hp: 55 })];

    const losses = computeLosses(units);

    assert.strictEqual(losses.attacker.survivors[0].casualties, 23);
  });

  test("prisoners are credited to the enemy side", () => {
    const units = [unit({ side: "attacker", destroyed: true, maxHp: 120, hp: 0 })];

    const losses = computeLosses(units);

    assert.strictEqual(losses.attacker.casualties, 120);
    assert.strictEqual(losses.defender.prisonersTaken, 60);
    assert.strictEqual(losses.attacker.prisonersTaken, 0);
  });

  test("per-side totals sum across survivor/routed/destroyed groups", () => {
    const units = [
      unit({ id: 1, side: "attacker", maxHp: 80, hp: 40 }),
      unit({ id: 2, side: "attacker", destroyed: true, maxHp: 60, hp: 0 }),
    ];

    const losses = computeLosses(units);

    assert.strictEqual(losses.attacker.casualties, 80);
  });

  test("draw / no destroyed units: prisonersTaken 0 both sides, destroyed[] empty both", () => {
    const units = [
      unit({ id: 1, side: "attacker", maxHp: 100, hp: 80 }),
      unit({ id: 2, side: "defender", maxHp: 100, hp: 70 }),
    ];

    const losses = computeLosses(units);

    assert.strictEqual(losses.attacker.prisonersTaken, 0);
    assert.strictEqual(losses.defender.prisonersTaken, 0);
    assert.strictEqual(losses.attacker.destroyed.length, 0);
    assert.strictEqual(losses.defender.destroyed.length, 0);
  });

  test("empty input: both sides empty groups, 0 totals", () => {
    const losses = computeLosses([]);

    assert.deepStrictEqual(losses.attacker, {
      survivors: [],
      routed: [],
      destroyed: [],
      casualties: 0,
      prisonersTaken: 0,
    });
    assert.deepStrictEqual(losses.defender, {
      survivors: [],
      routed: [],
      destroyed: [],
      casualties: 0,
      prisonersTaken: 0,
    });
  });
});
