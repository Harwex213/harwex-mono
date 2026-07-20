import { STAT_META, UNIT_TYPES } from "./constants/unit.js";

const STAT_IDS = STAT_META.map((s) => s.id);

/**
 * @param {ModifierEntry[]} entries
 * @param {StatId} stat
 * @returns {number}
 */
const sumEntries = (entries, stat) => entries.reduce(
  (sum, e) => (e.stat === stat ? sum + e.value : sum),
  0
);

/**
 * Flat bonuses first, then summed percentages: order-independent, min 1.
 * Refs whose collection/modifier was deleted resolve to null and are skipped.
 * Caller must ensure unit.typeId is set (isConfigValid gates it) — a null
 * typeId crashes the base-stat lookup.
 *
 * @param {BattleConfigUnit} unit
 * @param {ModifiersState} modifiers
 * @returns {UnitStats}
 */
const computeUnitStats = (unit, modifiers) => {
  const base = UNIT_TYPES.find((t) => t.id === unit.typeId);
  const applied = unit.modifiers
    .map((ref) => MODIFIERS_MODULE.findModifier(modifiers, ref.collectionId, ref.modifierId))
    .filter(Boolean);

  const stats = {};
  for (const stat of STAT_IDS) {
    const flat = applied.reduce((sum, m) => sum + sumEntries(m.flat, stat), 0);
    const percent = applied.reduce((sum, m) => sum + sumEntries(m.percent, stat), 0);
    stats[stat] = Math.max(1, Math.round((base[stat] + flat) * (1 + percent)));
  }
  return stats;
};
