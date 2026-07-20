import { describe, test } from "node:test";
import assert from "node:assert";
import { BATTLE_CONFIG_MODULE, SIDES } from "./battle-config.js";
import { MAPS_MODULE } from "./maps.js";

const fakeStorage = () => {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
};

const buildMaps = () => {
  const maps = MAPS_MODULE.create({ storage: fakeStorage() });
  MAPS_MODULE.createMap(maps);
  return maps;
};

const buildValidConfig = (maps) => {
  const battleConfig = BATTLE_CONFIG_MODULE.create(maps);
  for (const side of SIDES) {
    BATTLE_CONFIG_MODULE.createUnit(battleConfig, side);
    const unit = battleConfig[side][0];
    BATTLE_CONFIG_MODULE.assignUnitType(battleConfig, unit.id, "infantry");
  }
  return battleConfig;
};

describe("validate", () => {
  test("valid config yields no problems", () => {
    const maps = buildMaps();
    const battleConfig = buildValidConfig(maps);

    assert.deepStrictEqual(BATTLE_CONFIG_MODULE.validate(battleConfig, maps), []);
  });

  test("empty catalog reports NO_MAP and both empty sides", () => {
    const maps = MAPS_MODULE.create({ storage: fakeStorage() });
    const battleConfig = BATTLE_CONFIG_MODULE.create(maps);

    assert.deepStrictEqual(BATTLE_CONFIG_MODULE.validate(battleConfig, maps), [
      { code: "NO_MAP" },
      { code: "EMPTY_SIDE", side: "attacker" },
      { code: "EMPTY_SIDE", side: "defender" },
    ]);
  });

  test("mapId pointing at a deleted map reports NO_MAP", () => {
    const maps = buildMaps();
    const battleConfig = buildValidConfig(maps);
    MAPS_MODULE.deleteMap(maps, battleConfig.mapId);

    assert.deepStrictEqual(BATTLE_CONFIG_MODULE.validate(battleConfig, maps), [
      { code: "NO_MAP" },
    ]);
  });

  test("a single untyped unit reports UNTYPED_UNIT once", () => {
    const maps = buildMaps();
    const battleConfig = buildValidConfig(maps);
    BATTLE_CONFIG_MODULE.createUnit(battleConfig, "attacker");
    BATTLE_CONFIG_MODULE.createUnit(battleConfig, "defender");

    assert.deepStrictEqual(BATTLE_CONFIG_MODULE.validate(battleConfig, maps), [
      { code: "UNTYPED_UNIT" },
    ]);
  });

  test("isValid is validate().length === 0", () => {
    const maps = buildMaps();
    const battleConfig = BATTLE_CONFIG_MODULE.create(maps);

    assert.strictEqual(BATTLE_CONFIG_MODULE.isValid(battleConfig, maps), false);

    const valid = buildValidConfig(maps);
    assert.strictEqual(BATTLE_CONFIG_MODULE.isValid(valid, maps), true);
  });
});
