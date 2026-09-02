export type * from "./state";
export type { TBattle, TBattleEvent, TBattleSide, TBattleSquad, TSkill, TSkillId } from "./battle";
export type { TBuildingDef, TSquadDef, TUnitDef } from "./catalog";
export type { TIncome } from "./economy";
export type { TPoint } from "./hex";
export type { TBuildOption, TMoveOutcome, TReach } from "./rules";
export type { TTechDef } from "./tech";

export { SKILL_DEFS, createBattle, finishBattle, queueSkill, runRound, setSquadSlot } from "./battle";
export {
  BUILDABLE_TYPES,
  BUILDING_DEFS,
  ENGINE_HALF_COST,
  MAX_SQUADS_PER_SIDE,
  PASSIVE_DEFENCE_ARMOR,
  PLAYER_SQUAD_LADDER,
  SQUAD_DEFS,
  UNIT_DEFS,
} from "./catalog";
export { forecastIncome } from "./economy";
export { buildingOn, buildingsOf, factionById, isBuilt, islandById, tileAt, tileOf, unitsOf, unitsOnTile } from "./entities";
export { HITECH_FACTION_ID, NATIVES_FACTION_ID, PLAYERS_FACTION_ID, factionLabel } from "./factions";
export { DIRECTION_LABELS, HEX_SIZE, coastlinePath, hexPolygonPoints, hexToPoint, keyOf, offsetToAxial } from "./hex";
export {
  bestSquadType,
  buildOptions,
  canAfford,
  canFoundPower,
  engineOf,
  engineReady,
  engineSteps,
  formArmy,
  foundPower,
  homeIsland,
  investEngine,
  islandMoveBlocker,
  moveIsland,
  moveUnit,
  ownBarracksOn,
  reachableTiles,
  reinforceArmy,
  setResearch,
  startBuilding,
  touchingIslands,
  trainCivilian,
} from "./rules";
export { TECH_BY_ID, TECH_DEFS, isBuildingUnlocked, isKnown, isResearchable, isSquadUnlocked } from "./tech";
export { resolveTurn } from "./turn";
export { createGame } from "./world-gen";
