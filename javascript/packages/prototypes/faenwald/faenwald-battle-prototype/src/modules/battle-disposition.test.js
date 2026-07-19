import { describe, test } from "node:test";
import assert from "node:assert";
import { BATTLE_DISPOSITION_MODULE } from "./battle-disposition.js";
import { ACTIVE_BATTLE_MODULE } from "./active-battle.js";

const buildMap = (cells) => ({
  id: 1,
  name: "m",
  width: cells[0].length,
  height: cells.length,
  cells,
});

const buildUnit = (overrides = {}) => ({
  id: 1,
  side: "attacker",
  type: "light-infantry",
  name: "x",
  hp: 10,
  attack: 3,
  morale: 20,
  speed: 5,
  position: null,
  facing: 4,
  isRulerUnit: false,
  ...overrides,
});

describe("placementCandidates", () => {
  test("excludes impassable terrains and includes passable ones", () => {
    const activeBattle = ACTIVE_BATTLE_MODULE.create();
    const map = buildMap([
      ["mountain", "plain", "plain"],
      ["plain", "water", "plain"],
      ["plain", "plain", "road"],
    ]);
    const unit = buildUnit();

    const candidates = BATTLE_DISPOSITION_MODULE.placementCandidates(activeBattle, unit, map);

    assert.deepStrictEqual(
      candidates,
      [
        { row: 0, col: 1 },
        { row: 0, col: 2 },
        { row: 1, col: 0 },
        { row: 1, col: 2 },
        { row: 2, col: 0 },
        { row: 2, col: 1 },
        { row: 2, col: 2 },
      ],
    );
  });
});

describe("setUnitFacing", () => {
  test("sets a valid facing", () => {
    const activeBattle = ACTIVE_BATTLE_MODULE.create();
    activeBattle.units = [buildUnit({ facing: 4 })];

    BATTLE_DISPOSITION_MODULE.setUnitFacing(activeBattle, 1, 2);

    assert.strictEqual(activeBattle.units[0].facing, 2);
  });

  test("rejects out-of-range or non-integer facings", () => {
    const activeBattle = ACTIVE_BATTLE_MODULE.create();
    activeBattle.units = [buildUnit({ facing: 4 })];

    BATTLE_DISPOSITION_MODULE.setUnitFacing(activeBattle, 1, 6);
    BATTLE_DISPOSITION_MODULE.setUnitFacing(activeBattle, 1, -1);
    BATTLE_DISPOSITION_MODULE.setUnitFacing(activeBattle, 1, 1.5);

    assert.strictEqual(activeBattle.units[0].facing, 4);
  });

  test("is a no-op for an unknown unit id", () => {
    const activeBattle = ACTIVE_BATTLE_MODULE.create();
    activeBattle.units = [buildUnit({ facing: 4 })];

    BATTLE_DISPOSITION_MODULE.setUnitFacing(activeBattle, 999, 2);

    assert.strictEqual(activeBattle.units[0].facing, 4);
  });
});

describe("setRuler", () => {
  test("assigns the ruler crown", () => {
    const activeBattle = ACTIVE_BATTLE_MODULE.create();
    activeBattle.units = [buildUnit({ id: 1, isRulerUnit: false })];

    BATTLE_DISPOSITION_MODULE.setRuler(activeBattle, 1);

    assert.strictEqual(activeBattle.units[0].isRulerUnit, true);
  });

  test("toggles the crown off on a second call", () => {
    const activeBattle = ACTIVE_BATTLE_MODULE.create();
    activeBattle.units = [buildUnit({ id: 1, isRulerUnit: false })];

    BATTLE_DISPOSITION_MODULE.setRuler(activeBattle, 1);
    BATTLE_DISPOSITION_MODULE.setRuler(activeBattle, 1);

    assert.strictEqual(activeBattle.units[0].isRulerUnit, false);
  });

  test("clears a prior ruler on the same side when a new unit is crowned", () => {
    const activeBattle = ACTIVE_BATTLE_MODULE.create();
    activeBattle.units = [
      buildUnit({ id: 1, side: "attacker", isRulerUnit: true }),
      buildUnit({ id: 2, side: "attacker", isRulerUnit: false }),
    ];

    BATTLE_DISPOSITION_MODULE.setRuler(activeBattle, 2);

    assert.strictEqual(activeBattle.units.find((u) => u.id === 1).isRulerUnit, false);
    assert.strictEqual(activeBattle.units.find((u) => u.id === 2).isRulerUnit, true);
  });

  test("leaves the other side's ruler untouched", () => {
    const activeBattle = ACTIVE_BATTLE_MODULE.create();
    activeBattle.units = [
      buildUnit({ id: 1, side: "attacker", isRulerUnit: true }),
      buildUnit({ id: 2, side: "defender", isRulerUnit: true }),
    ];

    BATTLE_DISPOSITION_MODULE.setRuler(activeBattle, 1);

    assert.strictEqual(activeBattle.units.find((u) => u.id === 1).isRulerUnit, false);
    assert.strictEqual(activeBattle.units.find((u) => u.id === 2).isRulerUnit, true);
  });
});
