import { describe, test } from "node:test";
import assert from "node:assert";
import { SIDES, assignUnitType, createBattleConfig, createUnit, isConfigValid, validateConfig } from "./battle-config.js";
import { createMap, createMaps, deleteMap } from "./maps.js";

const buildMaps = () => {
  const maps = createMaps();
  createMap(maps);
  return maps;
};

const buildValidConfig = (maps) => {
  const battleConfig = createBattleConfig(maps);
  for (const side of SIDES) {
    createUnit(battleConfig, side);
    const unit = battleConfig[side][0];
    assignUnitType(battleConfig, unit.id, "infantry");
  }
  return battleConfig;
};

describe("validate", () => {
  test("valid config yields no problems", () => {
    const maps = buildMaps();
    const battleConfig = buildValidConfig(maps);

    assert.deepStrictEqual(validateConfig(battleConfig, maps), []);
  });

  test("empty catalog reports NO_MAP and both empty sides", () => {
    const maps = createMaps();
    const battleConfig = createBattleConfig(maps);

    assert.deepStrictEqual(validateConfig(battleConfig, maps), [
      { code: "NO_MAP" },
      { code: "EMPTY_SIDE", side: "attacker" },
      { code: "EMPTY_SIDE", side: "defender" },
    ]);
  });

  test("mapId pointing at a deleted map reports NO_MAP", () => {
    const maps = buildMaps();
    const battleConfig = buildValidConfig(maps);
    deleteMap(maps, battleConfig.mapId);

    assert.deepStrictEqual(validateConfig(battleConfig, maps), [
      { code: "NO_MAP" },
    ]);
  });

  test("a single untyped unit reports UNTYPED_UNIT once", () => {
    const maps = buildMaps();
    const battleConfig = buildValidConfig(maps);
    createUnit(battleConfig, "attacker");
    createUnit(battleConfig, "defender");

    assert.deepStrictEqual(validateConfig(battleConfig, maps), [
      { code: "UNTYPED_UNIT" },
    ]);
  });

  test("isValid is validate().length === 0", () => {
    const maps = buildMaps();
    const battleConfig = createBattleConfig(maps);

    assert.strictEqual(isConfigValid(battleConfig, maps), false);

    const valid = buildValidConfig(maps);
    assert.strictEqual(isConfigValid(valid, maps), true);
  });
});
