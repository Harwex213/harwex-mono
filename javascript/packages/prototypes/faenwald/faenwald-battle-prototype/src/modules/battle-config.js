import { MAPS, UNIT_TYPES, MODIFIERS } from "../data/catalog.js";

const SIDES = ["attacker", "defender"];
const STATS = ["hp", "attack", "morale"];

// module-level singleton: the draft survives in-session navigation
const battleConfig = {
  mapId: MAPS[0].id,
  attacker: [],
  defender: [],
};

let nextUnitId = 1;

const createUnit = () => ({ id: nextUnitId++, typeId: null, modifierIds: [] });

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

// flat bonuses first, then summed percentages: order-independent, min 1
const computeStats = (unit) => {
  const base = UNIT_TYPES.find((t) => t.id === unit.typeId);
  const modifiers = unit.modifierIds.map((id) => MODIFIERS.find((m) => m.id === id));

  const stats = {};
  for (const stat of STATS) {
    const flat = modifiers.reduce((sum, m) => sum + (m.flat[stat] ?? 0), 0);
    const percent = modifiers.reduce((sum, m) => sum + (m.percent[stat] ?? 0), 0);
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
