// The package's public surface. Everything the renderer, the HUD and the apps are
// allowed to know about core comes through here — reaching into `src/...` from
// another package is how the layer boundaries rot.

// Simulation: the world and the pure data it is made of.
export type { Grid } from "./sim/grid";
export { createGrid, GRID_H, GRID_W, inBounds, isWalkable, Terrain, TILE_SIZE, tileIndex, tileToPx } from "./sim/grid";
export type {
  Animal,
  EntityId,
  Inventory,
  Job,
  Needs,
  PathFollow,
  Position,
  ResourceKind,
  Stock,
} from "./sim/components";
export { AnimalKind, JobKind } from "./sim/components";
export type { World } from "./sim/world";
export { allocId, newGame, SCHEMA_VERSION, spawnChicken, spawnColonist, spawnRock, spawnTree } from "./sim/world";
export type { Rng } from "./sim/rng";
export { createRng, randInt } from "./sim/rng";
export { pickEntity } from "./sim/picking";
export { findPath } from "./sim/pathfinding/astar";
export type { SimContext } from "./sim/systems";
export { runSystems } from "./sim/systems";

// Static content definitions.
export type { ResourceDef, TerrainDef } from "./data/defs";
export { RESOURCE_DEFS, TERRAIN_DEFS } from "./data/defs";

// UI state: the reactivity boundary, plus the read models projected onto it.
export type { Selection } from "./state/signals";
export {
  colonistCount,
  colonistRoster,
  colonistsOpen,
  paused,
  resources,
  selection,
  selectionDetails,
  speed,
} from "./state/signals";
export type { ColonistRow, SelectionDetails } from "./state/inspect";
export { describeSelection, listColonists } from "./state/inspect";

// The one write path into that state.
export type { Command, Dispatcher } from "./commands";
export { CommandDispatcher } from "./commands";

// The seam a renderer plugs into.
export type { CreateView, GameView, HoverKind, PointerHandlers, ViewDeps } from "./view";

// The loop.
export type { GameEngineOptions } from "./engine";
export { GameEngine, TICK_MS } from "./engine";

// Persistence.
export type { ColonyDb, ColonyDbSchema } from "./persistence/db";
export { DEFS_STORE, openColonyDb, SAVES_STORE } from "./persistence/db";
export type { Snapshot } from "./persistence/snapshot";
export { AUTOSAVE_KEY, loadSnapshot, saveSnapshot } from "./persistence/snapshot";
