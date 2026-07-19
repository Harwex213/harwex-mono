import { describe, test } from "node:test";
import assert from "node:assert";
import { ACTIVE_UNIT_GROUP_SIDE, ACTIVE_UNIT_GROUP_TYPE, createActiveUnitGroup } from "./active-unit-group.js";
import {
  UNIT_TYPE_ARCHER,
  UNIT_TYPE_CROSSBOWMAN,
  UNIT_TYPE_HEAVY_CAVALRY,
  UNIT_TYPE_HEAVY_INFANTRY,
  UNIT_TYPE_HEAVY_SPEARMAN,
  UNIT_TYPE_HORSE_ARCHER,
  UNIT_TYPE_LIGHT_CAVALRY,
  UNIT_TYPE_LIGHT_INFANTRY,
  UNIT_TYPE_LIGHT_SPEARMAN,
  UNIT_TYPE_LONGBOWMAN,
  UNIT_TYPE_MEDIUM_CAVALRY,
  UNIT_TYPE_MEDIUM_INFANTRY,
  UNIT_TYPE_MEDIUM_SPEARMAN,
} from "../data/catalog.js";

describe("createActiveUnitGroup", () => {
  test("should create default state if units not passed", () => {
    const expected = {
      side: ACTIVE_UNIT_GROUP_SIDE.DEFENDER,
      type: ACTIVE_UNIT_GROUP_TYPE.CAVALRY,
    };

    const actual = createActiveUnitGroup();

    assert.deepStrictEqual(actual, expected);
  });

  test("should create default state if units are empty", () => {
    const expected = {
      side: ACTIVE_UNIT_GROUP_SIDE.DEFENDER,
      type: ACTIVE_UNIT_GROUP_TYPE.CAVALRY,
    };

    const actual = createActiveUnitGroup([]);

    assert.deepStrictEqual(actual, expected);
  });

  test("should create cavalry state if units have light cavalry", () => {
    const expected = {
      side: ACTIVE_UNIT_GROUP_SIDE.DEFENDER,
      type: ACTIVE_UNIT_GROUP_TYPE.CAVALRY,
    };

    const actual = createActiveUnitGroup([{ type: UNIT_TYPE_LIGHT_CAVALRY }]);

    assert.deepStrictEqual(actual, expected);
  });

  test("should create cavalry state if units have medium cavalry", () => {
    const expected = {
      side: ACTIVE_UNIT_GROUP_SIDE.DEFENDER,
      type: ACTIVE_UNIT_GROUP_TYPE.CAVALRY,
    };

    const actual = createActiveUnitGroup([{ type: UNIT_TYPE_MEDIUM_CAVALRY }]);

    assert.deepStrictEqual(actual, expected);
  });

  test("should create cavalry state if units have heavy cavalry", () => {
    const expected = {
      side: ACTIVE_UNIT_GROUP_SIDE.DEFENDER,
      type: ACTIVE_UNIT_GROUP_TYPE.CAVALRY,
    };

    const actual = createActiveUnitGroup([{ type: UNIT_TYPE_HEAVY_CAVALRY }]);

    assert.deepStrictEqual(actual, expected);
  });

  test("should create cavalry state if units have horse archer", () => {
    const expected = {
      side: ACTIVE_UNIT_GROUP_SIDE.DEFENDER,
      type: ACTIVE_UNIT_GROUP_TYPE.CAVALRY,
    };

    const actual = createActiveUnitGroup([{ type: UNIT_TYPE_HORSE_ARCHER }]);

    assert.deepStrictEqual(actual, expected);
  });

  test("should create archers state if units have archer", () => {
    const expected = {
      side: ACTIVE_UNIT_GROUP_SIDE.DEFENDER,
      type: ACTIVE_UNIT_GROUP_TYPE.ARCHERS,
    };

    const actual = createActiveUnitGroup([{ type: UNIT_TYPE_ARCHER }]);

    assert.deepStrictEqual(actual, expected);
  });

  test("should create archers state if units have longbowman", () => {
    const expected = {
      side: ACTIVE_UNIT_GROUP_SIDE.DEFENDER,
      type: ACTIVE_UNIT_GROUP_TYPE.ARCHERS,
    };

    const actual = createActiveUnitGroup([{ type: UNIT_TYPE_LONGBOWMAN }]);

    assert.deepStrictEqual(actual, expected);
  });

  test("should create archers state if units have crossbowman", () => {
    const expected = {
      side: ACTIVE_UNIT_GROUP_SIDE.DEFENDER,
      type: ACTIVE_UNIT_GROUP_TYPE.ARCHERS,
    };

    const actual = createActiveUnitGroup([{ type: UNIT_TYPE_CROSSBOWMAN }]);

    assert.deepStrictEqual(actual, expected);
  });

  test("should create shock infantry state if units have light infantry", () => {
    const expected = {
      side: ACTIVE_UNIT_GROUP_SIDE.DEFENDER,
      type: ACTIVE_UNIT_GROUP_TYPE.SHOCK_INFANTRY,
    };

    const actual = createActiveUnitGroup([{ type: UNIT_TYPE_LIGHT_INFANTRY }]);

    assert.deepStrictEqual(actual, expected);
  });

  test("should create shock infantry state if units have medium infantry", () => {
    const expected = {
      side: ACTIVE_UNIT_GROUP_SIDE.DEFENDER,
      type: ACTIVE_UNIT_GROUP_TYPE.SHOCK_INFANTRY,
    };

    const actual = createActiveUnitGroup([{ type: UNIT_TYPE_MEDIUM_INFANTRY }]);

    assert.deepStrictEqual(actual, expected);
  });

  test("should create shock infantry state if units have heavy infantry", () => {
    const expected = {
      side: ACTIVE_UNIT_GROUP_SIDE.DEFENDER,
      type: ACTIVE_UNIT_GROUP_TYPE.SHOCK_INFANTRY,
    };

    const actual = createActiveUnitGroup([{ type: UNIT_TYPE_HEAVY_INFANTRY }]);

    assert.deepStrictEqual(actual, expected);
  });

  test("should create spearmen state if units have light spearman", () => {
    const expected = {
      side: ACTIVE_UNIT_GROUP_SIDE.DEFENDER,
      type: ACTIVE_UNIT_GROUP_TYPE.SPEARMEN,
    };

    const actual = createActiveUnitGroup([{ type: UNIT_TYPE_LIGHT_SPEARMAN }]);

    assert.deepStrictEqual(actual, expected);
  });

  test("should create spearmen state if units have medium spearman", () => {
    const expected = {
      side: ACTIVE_UNIT_GROUP_SIDE.DEFENDER,
      type: ACTIVE_UNIT_GROUP_TYPE.SPEARMEN,
    };

    const actual = createActiveUnitGroup([{ type: UNIT_TYPE_MEDIUM_SPEARMAN }]);

    assert.deepStrictEqual(actual, expected);
  });

  test("should create spearmen state if units have heavy spearman", () => {
    const expected = {
      side: ACTIVE_UNIT_GROUP_SIDE.DEFENDER,
      type: ACTIVE_UNIT_GROUP_TYPE.SPEARMEN,
    };

    const actual = createActiveUnitGroup([{ type: UNIT_TYPE_HEAVY_SPEARMAN }]);

    assert.deepStrictEqual(actual, expected);
  });
});

describe("nextActiveUnitGroup", () => {
  test("should don't change state if units are not passed");
  test("should don't change state if units are empty");
  test("should change state to attacker + cavalry if current state defender + cavalry");
  test("should change state to attacker + archers if current state defender + archers");
  test("should change state to attacker + shock-infantry if current state defender + shock-infantry");
  test("should change state to attacker + spearmen if current state defender + spearmen");
  test("should change state to defender + cavalry if current state attacker + spearmen");
  test("should change state to defender + archers if current state attacker + cavalry");
  test("should change state to defender + shock-infantry if current state attacker + archers");
  test("should change state to defender + spearmen if current state attacker + shock-infantry");
});
