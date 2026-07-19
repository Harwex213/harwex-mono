import { UNIT_TYPES } from "../data/unit.js";
import { TERRAINS } from "../data/terrains.js";
import { BATTLE_CONFIG_MODULE, SIDES } from "./battle-config.js";

const BATTLE_PHASE = {
  DISPOSITION: "disposition",
  ACTIVE: "active",
  FINISHED: "finished",
};

/** Each side deploys on its edge of the map: attacker the top rows, defender the bottom. */
const PLACEMENT_ROWS = 3;

const impassableTerrainIds = new Set(
  TERRAINS.filter((t) => t.passable === false).map((t) => t.id),
);

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
const startBattle = (activeBattle, battleConfig, modifiers) => {
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
const findBattleUnit = (activeBattle, unitId) => activeBattle.units.find((u) => u.id === unitId) ?? null;

/**
 * @param {ActiveBattle} activeBattle
 * @param {number} row
 * @param {number} col
 * @returns {ActiveBattleUnit | null}
 */
const unitAt = (activeBattle, row, col) => activeBattle.units.find(
  (u) => u.position?.row === row && u.position?.col === col
) ?? null;

const placementRows = (side, map) => {
  const count = Math.min(PLACEMENT_ROWS, map.height);
  return Array.from({ length: count }, (_, i) => (side === "attacker" ? i : map.height - 1 - i));
};

/**
 * Hexes the unit may be dropped on: its side's zone minus impassable terrain.
 *
 * Hexes held by another unit qualify only when relocating an already-placed
 * unit (the drop swaps the two); placing from the list needs a free hex.
 *
 * @param {ActiveBattle} activeBattle
 * @param {ActiveBattleUnit} unit
 * @param {HexMap} map
 * @returns {{row: number, col: number}[]}
 */
const placementCandidates = (activeBattle, unit, map) => {
  const candidates = [];
  for (const row of placementRows(unit.side, map)) {
    for (let col = 0; col < map.width; col++) {
      if (impassableTerrainIds.has(map.cells[row][col])) {
        continue;
      }
      const occupant = unitAt(activeBattle, row, col);
      if (occupant === unit) {
        continue;
      }
      if (occupant && unit.position === null) {
        continue;
      }
      candidates.push({ row, col });
    }
  }
  return candidates;
};

/**
 * Zone/passability validation is the caller's job (clicks only land on
 * placementCandidates); this guards just the occupancy invariant.
 *
 * @param {ActiveBattle} activeBattle
 * @param {number} unitId
 * @param {number} row
 * @param {number} col
 */
const placeUnit = (activeBattle, unitId, row, col) => {
  const unit = findBattleUnit(activeBattle, unitId);
  if (!unit) {
    return;
  }
  const occupant = unitAt(activeBattle, row, col);
  if (occupant && unit.position === null) {
    return;
  }
  if (occupant) {
    occupant.position = unit.position;
  }
  unit.position = { row, col };
};

/**
 * @param {ActiveBattle} activeBattle
 * @returns {boolean}
 */
const isDispositionComplete = (activeBattle) =>
  activeBattle.units.length > 0 && activeBattle.units.every((u) => u.position !== null);

/**
 * @param {ActiveBattle} activeBattle
 */
const beginBattle = (activeBattle) => {
  activeBattle.phase = BATTLE_PHASE.ACTIVE;
};

const ACTIVE_BATTLE_MODULE = {
  create: createActiveBattle,
  startBattle: startBattle,
  findBattleUnit: findBattleUnit,
  unitAt: unitAt,
  placementCandidates: placementCandidates,
  placeUnit: placeUnit,
  isDispositionComplete: isDispositionComplete,
  beginBattle: beginBattle,
};

export {
  BATTLE_PHASE,
  ACTIVE_BATTLE_MODULE,
}
