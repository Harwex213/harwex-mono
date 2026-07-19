import { STAT_META, UNIT_TYPES } from "../data/unit.js";
import { findModifier } from "./modifiers-store.js";
import { getMap, getMaps } from "./maps-store.js";

const SIDES = ["attacker", "defender"];
const STAT_IDS = STAT_META.map((s) => s.id);

/**
 * @returns {BattleConfig}
 */
const createBattleConfig = () => ({
  mapId: getMaps()[0]?.id ?? null,
  attacker: [],
  defender: [],
  nextUnitId: 1,
});

/**
 * @param {BattleConfig} battleConfig
 * @param {BattleConfigSide} side
 */
const createUnit = (battleConfig, side) => {
  if (!SIDES.includes(side)) {
    return;
  }

  const createdUnit = ({ id: battleConfig.nextUnitId++, typeId: null, modifiers: [] });

  battleConfig[side].push(createdUnit);
};

/**
 * @param {BattleConfig} battleConfig
 * @param {string} mapId
 */
const changeMap = (battleConfig, mapId) => {
  battleConfig.mapId = mapId;
};

/**
 * @param {BattleConfig} battleConfig
 * @param {number} unitId
 * @returns {BattleConfigUnit | null}
 */
const findUnit = (battleConfig, unitId) => {
  for (const side of SIDES) {
    const unit = battleConfig[side].find((u) => u.id === unitId);
    if (unit) return unit;
  }
  return null;
};

/**
 * @param {BattleConfig} battleConfig
 * @param {number} unitId
 * @param {string} typeId a UNIT_TYPES id
 */
const assignUnitType = (battleConfig, unitId, typeId) => {
  const unit = findUnit(battleConfig, unitId);
  if (!unit) {
    return;
  }
  unit.typeId = typeId;
};

/**
 * @param {BattleConfig} battleConfig
 * @param {number} unitId
 * @param {string} collectionId
 * @param {string} modifierId
 */
const createUnitModifier = (battleConfig, unitId, collectionId, modifierId) => {
  const unit = findUnit(battleConfig, unitId);
  if (!unit) {
    return;
  }
  unit.modifiers.push({ collectionId, modifierId });
};

/**
 * @param {BattleConfig} battleConfig
 * @param {number} unitId
 * @param {string} collectionId
 * @param {string} modifierId
 */
const removeUnitModifier = (battleConfig, unitId, collectionId, modifierId) => {
  const unit = findUnit(battleConfig, unitId);
  if (!unit) {
    return;
  }
  unit.modifiers = unit.modifiers.filter((modifierReference) => !(
      String(modifierReference.collectionId) === String(collectionId) &&
      String(modifierReference.modifierId) === String(modifierId)
    ),
  );
};

/**
 * @param {BattleConfig} battleConfig
 * @param {number} unitId
 */
const removeUnit = (battleConfig, unitId) => {
  for (const side of SIDES) {
    battleConfig[side] = battleConfig[side].filter((u) => u.id !== unitId);
  }
};

/**
 * @param {ModifierEntry[]} entries
 * @param {StatId} stat
 * @returns {number}
 */
const sumEntries = (entries, stat) =>
  entries.reduce((sum, e) => (e.stat === stat ? sum + e.value : sum), 0);

/**
 * Flat bonuses first, then summed percentages: order-independent, min 1.
 * Refs whose collection/modifier was deleted resolve to null and are skipped.
 * Caller must ensure unit.typeId is set (isConfigValid gates it) — a null
 * typeId crashes the base-stat lookup.
 *
 * @param {BattleConfigUnit} unit
 * @returns {UnitStats}
 */
const computeUnitStats = (unit) => {
  const base = UNIT_TYPES.find((t) => t.id === unit.typeId);
  const modifiers = unit.modifiers
    .map((ref) => findModifier(ref.collectionId, ref.modifierId))
    .filter(Boolean);

  const stats = {};
  for (const stat of STAT_IDS) {
    const flat = modifiers.reduce((sum, m) => sum + sumEntries(m.flat, stat), 0);
    const percent = modifiers.reduce((sum, m) => sum + sumEntries(m.percent, stat), 0);
    stats[stat] = Math.max(1, Math.round((base[stat] + flat) * (1 + percent)));
  }
  return stats;
};

/**
 * The map is resolved through the store so a mapId pointing at a deleted map
 * (or an empty store) invalidates the config instead of crashing the battle page.
 *
 * @param {BattleConfig} battleConfig
 * @returns {boolean}
 */
const isConfigValid = (battleConfig) =>
  Boolean(getMap(battleConfig.mapId)) &&
  SIDES.every(
    (side) => battleConfig[side].length > 0 && battleConfig[side].every((u) => u.typeId),
  );

const BATTLE_CONFIG_MODULE = {
  create: createBattleConfig,
  changeMap: changeMap,
  createUnit: createUnit,
  findUnit: findUnit,
  assignUnitType: assignUnitType,
  createUnitModifier: createUnitModifier,
  removeUnitModifier: removeUnitModifier,
  removeUnit: removeUnit,
  isValid: isConfigValid,
  computeUnitStats: computeUnitStats,
};

export {
  SIDES,
  BATTLE_CONFIG_MODULE,
}
