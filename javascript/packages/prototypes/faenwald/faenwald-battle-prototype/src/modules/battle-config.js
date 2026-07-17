import { MAPS, UNIT_TYPES, STAT_META } from "../data/catalog.js";
import { findModifier } from "./modifiers-store.js";

const SIDES = ["attacker", "defender"];
const STATS = STAT_META.map((s) => s.id);

// module-level singleton: the draft survives in-session navigation
const battleConfig = {
  mapId: MAPS[0].id,
  attacker: [],
  defender: [],
};

let nextUnitId = 1;

// modifiers are composite refs { collectionId, modifierId } into the store
const createUnit = () => ({ id: nextUnitId++, typeId: null, modifiers: [] });

const findUnit = (unitId) => {
  for (const side of SIDES) {
    const unit = battleConfig[side].find((u) => u.id === unitId);
    if (unit) return unit;
  }
  return null;
};

const removeUnit = (unitId) => {
  for (const side of SIDES) {
    battleConfig[side] = battleConfig[side].filter((u) => u.id !== unitId);
  }
};

const sumEntries = (entries, stat) =>
  entries.reduce((sum, e) => (e.stat === stat ? sum + e.value : sum), 0);

// flat bonuses first, then summed percentages: order-independent, min 1.
// refs whose collection/modifier was deleted resolve to null and are skipped.
const computeStats = (unit) => {
  const base = UNIT_TYPES.find((t) => t.id === unit.typeId);
  const modifiers = unit.modifiers
    .map((ref) => findModifier(ref.collectionId, ref.modifierId))
    .filter(Boolean);

  const stats = {};
  for (const stat of STATS) {
    const flat = modifiers.reduce((sum, m) => sum + sumEntries(m.flat, stat), 0);
    const percent = modifiers.reduce((sum, m) => sum + sumEntries(m.percent, stat), 0);
    stats[stat] = Math.max(1, Math.round((base[stat] + flat) * (1 + percent)));
  }
  return stats;
};

const isConfigValid = () =>
  Boolean(battleConfig.mapId) &&
  SIDES.every(
    (side) => battleConfig[side].length > 0 && battleConfig[side].every((u) => u.typeId),
  );

export { SIDES, battleConfig, createUnit, findUnit, removeUnit, computeStats, isConfigValid }
