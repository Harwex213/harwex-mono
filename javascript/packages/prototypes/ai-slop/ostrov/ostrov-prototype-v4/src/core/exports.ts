/**
 * The single public surface of the core. Everything above `src/core/` imports
 * from this file and from nowhere else inside the core.
 *
 * The file is a pure re-export barrel; every implementation lives in the
 * per-topic module named beside it.
 */

export type {
  TBattleInput,
  TBattleIsland,
  TBattleState,
  TBiomeId,
  TBiomeInfo,
  TBuildingCost,
  TBuildingId,
  TBuildingInfo,
  TBuildingYield,
  THex,
  TIsland,
  TPhase,
  TPlayer,
  TResourceId,
  TResources,
  TRng,
  TTechId,
  TTechInfo,
  TTrailEvent,
  TTrailEventId,
  TUnit,
  TWorldCell,
  TYieldEntry,
} from "./types";

export type { TAxialCoord, TPixelPoint } from "./hex";

export type { TUnitStats } from "./battle-sim";

export { createRng, hashString, hashUnit } from "./rng";

export {
  HEX_SIZE_PX,
  hexCorners,
  hexDistance,
  hexId,
  hexNeighbours,
  hexToPixel,
  parseHexId,
  pixelToHex,
} from "./hex";

export { BIOMES, BIOME_ORDER } from "./biomes";

export {
  BUILDINGS,
  BUILDING_ORDER,
  DEAD_HEX_TOXICITY,
  biomesForBuilding,
  canAfford,
  legalHexesFor,
} from "./buildings";

export { TECHS, TECH_ORDER, isTechAvailable } from "./techs";

export {
  FARM_DEAD_TOXICITY_PERCENT,
  INITIAL_RESOURCES,
  TOXICITY_FULL_PERCENT,
  applyInsaneConversion,
  applyUpkeep,
  applyYields,
  computeTaxYields,
  hexYield,
  insaneMultiplier,
  islandToxicityPercent,
  islandToxicityPoints,
  manaIncome,
  riotChancePercent,
  rollRiot,
} from "./toxicity";

export {
  MAX_ISLAND_HEX_COUNT,
  MAX_START_HEX_COUNT,
  MIN_ISLAND_HEX_COUNT,
  MIN_START_HEX_COUNT,
  addHexesToIsland,
  addToxicity,
  builtHexIds,
  createIsland,
  removeHex,
  setBuilding,
} from "./island-gen";

export {
  PENTAGON_CELL_COUNT,
  WORLD_CELL_COUNT,
  WORLD_START_CELL_ID,
  addTrail,
  createWorld,
  moveOccupant,
  revealCell,
} from "./world-gen";

export {
  BANDIT_LOSS_PERCENT,
  BANDIT_MIN_LOSS,
  EMPTY_TRAIL_RELIEF,
  GARBAGE_WORM_DESTROY_TOXICITY,
  GARBAGE_WORM_TOXICITY,
  INSANE_GROWTH_COUNT,
  MAX_EVENT_CHANCE_PERCENT,
  UNDEAD_EXTRA_ENEMIES,
  rollTrailEvent,
  trailEventChancePercent,
} from "./events";

export {
  BATTLE_HEX_SIZE_PX,
  BATTLE_TICK_MS,
  BATTLE_WORLD_H,
  BATTLE_WORLD_W,
  PLAYER_ISLAND_ID,
  PLAYER_ISLAND_SPEED_PX_S,
  UNIT_STATS,
  createBattleLevel,
  islandHexCentres,
  islandsOverlap,
  stepBattle,
} from "./battle-sim";
