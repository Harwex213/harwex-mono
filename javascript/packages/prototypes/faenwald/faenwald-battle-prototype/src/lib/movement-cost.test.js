import { describe, test } from "node:test";
import assert from "node:assert";
import { advanceCost, effectiveSpeed } from "./movement-cost.js";

const PLAIN = {};
const ROAD = { occupantMoveCostMult: 0.5 };
const THICKET = { entryCost: { base: 1, cavalry: 2 } };
const HILLS = { elevation: 2 };
const SWAMP = { occupantMoveCostMult: 3 };
const FOOTHILLS = { elevation: 1 };
const FOREST = { speedCap: { cavalry: 1 } };
const SETTLEMENT = { speedDelta: { cavalry: -2 } };

const INFANTRY = { terrainClass: "infantry" };
const CAVALRY = { terrainClass: "cavalry" };

describe("advanceCost", () => {
  test("plain to plain, infantry", () => {
    assert.strictEqual(advanceCost(PLAIN, PLAIN, INFANTRY), 1);
  });

  test("road (exit mult .5) to plain", () => {
    assert.strictEqual(advanceCost(ROAD, PLAIN, INFANTRY), 0.5);
  });

  test("plain to thicket, per terrainClass entry cost", () => {
    assert.strictEqual(advanceCost(PLAIN, THICKET, CAVALRY), 2);
    assert.strictEqual(advanceCost(PLAIN, THICKET, INFANTRY), 1);
  });

  test("plain to hills, climbing doubles cost", () => {
    assert.strictEqual(advanceCost(PLAIN, HILLS, INFANTRY), 2);
  });

  test("swamp (exit mult 3) to plain", () => {
    assert.strictEqual(advanceCost(SWAMP, PLAIN, INFANTRY), 3);
  });

  test("road (exit mult .5) to foothills, climbing", () => {
    assert.strictEqual(advanceCost(ROAD, FOOTHILLS, INFANTRY), 1);
  });
});

describe("effectiveSpeed", () => {
  test("forest caps cavalry speed", () => {
    assert.strictEqual(effectiveSpeed(5, FOREST, CAVALRY), 1);
  });

  test("forest cap does not affect infantry", () => {
    assert.strictEqual(effectiveSpeed(3, FOREST, INFANTRY), 3);
  });

  test("settlement penalizes cavalry speed", () => {
    assert.strictEqual(effectiveSpeed(5, SETTLEMENT, CAVALRY), 3);
  });

  test("speed floors at 0", () => {
    assert.strictEqual(effectiveSpeed(1, SETTLEMENT, CAVALRY), 0);
  });

  test("plain leaves speed unchanged", () => {
    assert.strictEqual(effectiveSpeed(3, PLAIN, INFANTRY), 3);
  });
});
