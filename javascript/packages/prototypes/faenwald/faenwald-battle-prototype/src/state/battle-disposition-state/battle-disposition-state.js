import { TERRAINS } from "../../data/terrains.js";
import { findUnit, unitAt } from "../active-battle-state/active-battle-state.js";

/** Each side deploys on its edge of the map: attacker the top rows, defender the bottom. */
const PLACEMENT_ROWS = 3;

const impassableTerrainIds = new Set(
  TERRAINS.filter((t) => t.impassable === true).map((t) => t.id),
);


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
  const unit = findUnit(activeBattle, unitId);
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
 * @param {number} unitId
 * @param {number} facing 0-5 vertex orientation
 */
const setUnitFacing = (activeBattle, unitId, facing) => {
  const u = findUnit(activeBattle, unitId);
  if (!u) {
    return;
  }
  if (!Number.isInteger(facing) || facing < 0 || facing > 5) {
    return;
  }
  u.facing = facing;
};

/**
 * Toggles the unit's ruler crown; at most one per side.
 * @param {ActiveBattle} activeBattle
 * @param {number} unitId
 */
const setRuler = (activeBattle, unitId) => {
  const u = findUnit(activeBattle, unitId);
  if (!u) {
    return;
  }
  const was = u.isRulerUnit;
  for (const other of activeBattle.units) {
    if (other.side === u.side) {
      other.isRulerUnit = false;
    }
  }
  u.isRulerUnit = !was;
};

export {
  placementCandidates,
  placeUnit,
  isDispositionComplete,
  setUnitFacing,
  setRuler,
};