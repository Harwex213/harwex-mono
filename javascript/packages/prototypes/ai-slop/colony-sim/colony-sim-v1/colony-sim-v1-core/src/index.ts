// The package's public surface. Everything the renderer, the HUD and the apps are
// allowed to know about core comes through here — reaching into `src/...` from
// another package is how the layer boundaries rot.

// Simulation: the world and the pure data it is made of.
export type { Grid } from "./sim/grid";
export {
  createGrid,
  GRID_H,
  GRID_W,
  inBounds,
  isDeadLands,
  isWalkable,
  Region,
  Terrain,
  TILE_SIZE,
  tileIndex,
  tileToPx,
} from "./sim/grid";
export type {
  Animal,
  Building,
  BuildOrder,
  EntityId,
  Inventory,
  ItemStack,
  Job,
  Needs,
  PathFollow,
  PlayerId,
  Position,
  ResourceKind,
} from "./sim/components";
export { AnimalKind, BuildingKind, JobKind } from "./sim/components";
export type { World } from "./sim/world";
export {
  allocId,
  buildAt,
  canBuildAt,
  despawn,
  destroyObject,
  newGame,
  objectKindOf,
  randomFreeTile,
  SCHEMA_VERSION,
  spawnChicken,
  spawnColonist,
  spawnItem,
  spawnRock,
  spawnTree,
} from "./sim/world";
// Map generation: which map a new game gets is the caller's choice, by id.
export type { MapGenerator, MapGenId, MapGenResult } from "./sim/mapgen";
export { DEFAULT_MAP_GEN, getMapGenerator, listMapGenerators, MAP_GENERATORS } from "./sim/mapgen";
export type { Rng, RngHolder } from "./sim/rng";
export { createRng, randInt, stateRng } from "./sim/rng";
export { dist, dist2 } from "./sim/math";
// The desync detector: lockstep's only honest way to know it is still lockstep.
export { hashWorld } from "./sim/hash";
export { pickEntity } from "./sim/picking";
export { findPath } from "./sim/pathfinding/astar";
export type { SimContext } from "./sim/systems";
export { runSystems } from "./sim/systems";

// Static content definitions.
export type { BuildingDef, MapObjectKind, PlayerDef, ResourceDef, TerrainDef } from "./data/defs";
export {
  BUILDING_DEFS,
  DEFAULT_PLAYER,
  PLAYER_DEFS,
  PLAYER_IDS,
  RESOURCE_DEFS,
  RESOURCE_KINDS,
  TERRAIN_DEFS,
} from "./data/defs";

// UI state: the reactivity boundary, plus the read models projected onto it.
export type { Selection } from "./state/signals";
export {
  buildOrder,
  clockOwned,
  colonistCount,
  colonistRoster,
  colonistsOpen,
  paused,
  resources,
  selection,
  selectionDetails,
  speed,
} from "./state/signals";
export type { ColonistRow, SelectionDetails, Stock } from "./state/inspect";
export { countColonists, countStock, describeSelection, listColonists } from "./state/inspect";

// The one write path into that state.
export type { ClockCommand, Command, CommandSink, Dispatcher, SpawnKind, UiCommand, WorldCommand } from "./commands";
export { CommandDispatcher, SPAWN_KINDS } from "./commands";

// The seam a renderer plugs into.
export type { CreateView, GameView, HoverKind, PointerHandlers, ViewDeps } from "./view";

// The seam a network plugs into: who decides when a tick happens.
export type { TurnSource, TurnStep } from "./turns";
export { LocalTurnSource, MAX_STEPS_PER_FRAME, TICK_MS } from "./turns";

// The loop.
export type { GameEngineOptions } from "./engine";
export { GameEngine } from "./engine";

// Persistence.
export type { ColonyDb, ColonyDbSchema } from "./persistence/db";
export { DEFS_STORE, openColonyDb, SAVES_STORE } from "./persistence/db";
export type { Snapshot } from "./persistence/snapshot";
export { AUTOSAVE_KEY, loadSnapshot, saveSnapshot } from "./persistence/snapshot";
