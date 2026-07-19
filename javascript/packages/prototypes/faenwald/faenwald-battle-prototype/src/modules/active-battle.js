import { UNIT_TYPES } from "../data/catalog.js";
import { TERRAINS } from "../data/terrains.js";
import { SIDES, battleConfig, computeStats } from "./battle-config.js";

// Runtime state of the one battle in progress. Like battleConfig this is an
// in-memory module singleton mutated only through the exported helpers — it
// survives in-session navigation and resets on reload ("/battle" then
// redirects back to setup).

const BATTLE_PHASE = {
  DISPOSITION: "disposition",
  ACTIVE: "active",
  FINISHED: "finished",
};

// each side deploys on its edge of the map: attacker the top rows,
// defender the bottom ones
const PLACEMENT_ROWS = 3;

const impassableTerrainIds = new Set(
  TERRAINS.filter((t) => t.passable === false).map((t) => t.id),
);

const activeBattle = {
  /** `BATTLE_PHASE`, or null while no battle has been started */
  phase: null,
  mapId: null,
  units: [],
};

let nextUnitId = 1;

// snapshot of the draft config: modifiers are baked into the stats here, so
// later edits to the draft or the modifier stores don't touch this battle.
// `type` matches the unit shape active-unit-group.js consumes.
const startBattle = () => {
  activeBattle.phase = BATTLE_PHASE.DISPOSITION;
  activeBattle.mapId = battleConfig.mapId;
  activeBattle.units = SIDES.flatMap((side) =>
    battleConfig[side].map((unit) => {
      const type = UNIT_TYPES.find((t) => t.id === unit.typeId);
      const stats = computeStats(unit);
      return {
        id: nextUnitId++,
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

const findBattleUnit = (unitId) => activeBattle.units.find((u) => u.id === unitId) ?? null;

const unitAt = (row, col) =>
  activeBattle.units.find((u) => u.position?.row === row && u.position?.col === col) ?? null;

const placementRows = (side, map) => {
  const count = Math.min(PLACEMENT_ROWS, map.height);
  return Array.from({ length: count }, (_, i) => (side === "attacker" ? i : map.height - 1 - i));
};

// hexes the unit may be dropped on: its side's zone minus impassable terrain.
// Hexes held by another unit qualify only when relocating an already-placed
// unit (the drop swaps the two); placing from the list needs a free hex.
const placementCandidates = (unit, map) => {
  const candidates = [];
  for (const row of placementRows(unit.side, map)) {
    for (let col = 0; col < map.width; col++) {
      if (impassableTerrainIds.has(map.cells[row][col])) continue;
      const occupant = unitAt(row, col);
      if (occupant === unit) continue;
      if (occupant && unit.position === null) continue;
      candidates.push({ row, col });
    }
  }
  return candidates;
};

// zone/passability validation is the caller's job (clicks only land on
// placementCandidates); this guards just the occupancy invariant
const placeUnit = (unitId, row, col) => {
  const unit = findBattleUnit(unitId);
  if (!unit) return;
  const occupant = unitAt(row, col);
  if (occupant && unit.position === null) return;
  if (occupant) occupant.position = unit.position;
  unit.position = { row, col };
};

const isDispositionComplete = () =>
  activeBattle.units.length > 0 && activeBattle.units.every((u) => u.position !== null);

const beginBattle = () => {
  activeBattle.phase = BATTLE_PHASE.ACTIVE;
};

export {
  BATTLE_PHASE,
  activeBattle,
  startBattle,
  findBattleUnit,
  unitAt,
  placementCandidates,
  placeUnit,
  isDispositionComplete,
  beginBattle,
};
