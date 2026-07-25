// Static content definitions — the read-only half of the IndexedDB story.
// Loaded into the `defs` store on first boot; referenced by id from sim data.
// For the prototype they live in code; migrate to seeded IDB rows as they grow.

import { BuildingKind, type PlayerId, type ResourceKind } from "../sim/components";

interface TerrainDef {
  id: string;
  walkable: boolean;
  moveCost: number;
}

// The destructible objects standing on the map. Named apart from `ResourceKind`
// on purpose: a tree is not wood, it is the thing that drops wood.
type MapObjectKind = "tree" | "rock";

// The drop table, and the one place that says what an object is worth: the sim
// reads it when the object is destroyed, the HUD reads it to say what a standing
// object would yield. Two copies of these numbers is how the panel starts lying
// about the yield.
interface ResourceDef {
  id: MapObjectKind;
  yields: ResourceKind;
  amount: number;
  harvestTicks: number;
}

// What a building of this kind can do. A building has at most two mechanics —
// holding one resource, and turning ticks into one — and a kind that lacks either
// leaves those fields at zero: the systems then read one table instead of asking
// which kind they are looking at, and adding a producer is a row, not a system.
interface BuildingDef {
  id: BuildingKind;
  label: string;
  capacity: number; // store: how much of its one resource it holds
  produces: ResourceKind | null; // farm: what a crop is made of
  produceTicks: number; // ticks between crops
  produceAmount: number; // stack size a crop lands as
}

// How fast a colonist walks, in tiles per tick. Content rather than a constant
// inside one system: wandering and hauling have to move at the same pace, or a
// colonist visibly changes gear the moment it is given something to do.
const COLONIST_SPEED = 0.12;

// The players a match is made of. Their colour is a definition and not a render
// detail: the worker sheet, the roster dot and the headcount chip have to name the
// same red, and three layers each holding their own hex is how they stop matching.
interface PlayerDef {
  id: PlayerId;
  label: string;
  color: string; // the team colour worn by this player's worker sprites
}

// Turn order / spawn order, and the only iteration order for anything per-player.
const PLAYER_IDS: readonly PlayerId[] = ["red", "lime"];

// Who an entity belongs to when nobody said: a spawn command without an owner, a
// save written before ownership existed. Unowned is not an option for anything the
// renderer has to pick a sheet for.
const DEFAULT_PLAYER: PlayerId = "red";

const PLAYER_DEFS: Record<PlayerId, PlayerDef> = {
  red: { id: "red", label: "red", color: "#bc4e4e" },
  lime: { id: "lime", label: "lime", color: "#87a947" },
};

const TERRAIN_DEFS: Record<string, TerrainDef> = {
  grass: { id: "grass", walkable: true, moveCost: 1 },
  water: { id: "water", walkable: false, moveCost: Infinity },
  rock: { id: "rock", walkable: true, moveCost: 2 },
  mountain: { id: "mountain", walkable: false, moveCost: Infinity },
};

const RESOURCE_DEFS: Record<MapObjectKind, ResourceDef> = {
  tree: { id: "tree", yields: "wood", amount: 5, harvestTicks: 30 },
  rock: { id: "rock", yields: "stone", amount: 4, harvestTicks: 45 },
};

const BUILDING_DEFS: Record<BuildingKind, BuildingDef> = {
  [BuildingKind.Warehouse]: {
    id: BuildingKind.Warehouse,
    label: "warehouse",
    capacity: 50,
    produces: null,
    produceTicks: 0,
    produceAmount: 0,
  },
  [BuildingKind.Farm]: {
    id: BuildingKind.Farm,
    label: "farm",
    capacity: 0,
    produces: "food",
    produceTicks: 60, // 6 s at 1× — long enough to watch a hauler fetch the last one
    produceAmount: 2,
  },
};

export type { BuildingDef, MapObjectKind, PlayerDef, TerrainDef, ResourceDef };
export {
  BUILDING_DEFS,
  COLONIST_SPEED,
  DEFAULT_PLAYER,
  PLAYER_DEFS,
  PLAYER_IDS,
  TERRAIN_DEFS,
  RESOURCE_DEFS,
};
