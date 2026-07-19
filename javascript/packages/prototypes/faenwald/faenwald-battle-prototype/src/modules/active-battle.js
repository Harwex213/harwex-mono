import { UNIT_TYPES } from "../data/unit.js";
import { BATTLE_CONFIG_MODULE, SIDES } from "./battle-config.js";

const BATTLE_PHASE = {
  DISPOSITION: "disposition",
  ACTIVE: "active",
  FINISHED: "finished",
};

/**
 * @returns {ActiveBattle}
 */
const createActiveBattle = () => ({
  /** `BATTLE_PHASE`, or null while no battle has been started */
  phase: null,
  mapId: null,
  units: [],
  nextUnitId: 1,
});

/**
 * @param {ActiveBattle} activeBattle
 * @param {BattleConfig} battleConfig
 * @param {ModifiersState} modifiers
 */
const startBattleDisposition = (activeBattle, battleConfig, modifiers) => {
  if (activeBattle.phase !== null) {
    return;
  }

  activeBattle.phase = BATTLE_PHASE.DISPOSITION;
  activeBattle.mapId = battleConfig.mapId;
  activeBattle.units = SIDES.flatMap((side) =>
    battleConfig[side].map((unit) => {
      const type = UNIT_TYPES.find((t) => t.id === unit.typeId);
      const stats = BATTLE_CONFIG_MODULE.computeUnitStats(unit, modifiers);
      return {
        id: activeBattle.nextUnitId++,
        side,
        type: type.type,
        name: type.name,
        hp: stats.hp,
        attack: stats.attack,
        morale: stats.morale,
        speed: type.speed,
        /** {row, col} once placed on the map */
        position: null,
      };
    }),
  );
};

/**
 * @param {ActiveBattle} activeBattle
 * @param {number} unitId
 * @returns {ActiveBattleUnit | null}
 */
const findUnit = (activeBattle, unitId) => activeBattle.units.find((u) => u.id === unitId) ?? null;

/**
 * @param {ActiveBattle} activeBattle
 * @param {number} row
 * @param {number} col
 * @returns {ActiveBattleUnit | null}
 */
const unitAt = (activeBattle, row, col) => activeBattle.units.find(
  (u) => u.position?.row === row && u.position?.col === col
) ?? null;

/**
 * @param {ActiveBattle} activeBattle
 */
const startBattle = (activeBattle) => {
  if (activeBattle.phase === BATTLE_PHASE.DISPOSITION) {
    activeBattle.phase = BATTLE_PHASE.ACTIVE;
  }
};

const ACTIVE_BATTLE_MODULE = {
  create: createActiveBattle,
  startBattleDisposition: startBattleDisposition,
  startBattle: startBattle,
  findUnit: findUnit,
  unitAt: unitAt,
};

export {
  BATTLE_PHASE,
  ACTIVE_BATTLE_MODULE,
}
