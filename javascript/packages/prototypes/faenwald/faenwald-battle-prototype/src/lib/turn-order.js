import { getUnitGroupType } from "./active-unit-group.js";

/**
 * Units of `group` that take a slot this cycle (routed units included — they
 * flee uncontrollably), fastest first (ties by id).
 * @param {ActiveBattleUnit[]} units
 * @param {ActiveUnitGroup} group
 * @returns {ActiveBattleUnit[]}
 */
const unitActivationOrder = (units, group) => units
  .filter((u) => (
    u.side === group.side &&
    getUnitGroupType(u.type) === group.type &&
    u.position !== null &&
    u.hp > 0
  ))
  .slice()
  .sort((a, b) => b.speed - a.speed || a.id - b.id);

export { unitActivationOrder };
