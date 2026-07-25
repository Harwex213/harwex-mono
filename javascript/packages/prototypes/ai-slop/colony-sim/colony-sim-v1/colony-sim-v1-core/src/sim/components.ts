// ECS components — pure data, keyed by entityId in the World's Maps.

type EntityId = number;

// Continuous position in tile coordinates.
interface Position {
  x: number;
  y: number;
}

// Which player an entity belongs to. Ownership is a component rather than a set
// of entities per player: a colonist that changes hands stays in every collection
// it was already in, and the systems keep iterating one Map instead of asking
// which player's list to walk. The ids themselves are content — see PLAYER_DEFS.
type PlayerId = "red" | "lime";

interface Needs {
  hunger: number; // 0 = full, 1 = starving
  fatigue: number; // 0 = rested, 1 = exhausted
}

// A resolved path as a queue of tile waypoints (target-first at the end).
interface PathFollow {
  waypoints: Position[];
  index: number;
  speed: number; // tiles per tick
}

const enum JobKind {
  Wander = 0,
  HarvestTree = 1,
  Haul = 2,
}

interface Job {
  kind: JobKind;
  targetId: EntityId | null;
  targetTile: Position | null;
  progress: number; // work ticks accumulated
}

// The resources a colony deals in. A closed union rather than free-form ids: a
// store holds exactly one of them, and everything that shows a resource (the
// readout, the pile art, the build menu) is a table keyed by this — a new resource
// should not mean a new field in three layers.
type ResourceKind = "wood" | "stone" | "food";

// A stack of resources lying on the map — what a felled tree or a broken boulder
// leaves behind, and what a hauler picks up on the way to a store. Not the same
// thing as what a warehouse holds: that is what the colony already owns, this is
// loose loot with a tile of its own, so it is an entity and not a counter.
interface ItemStack {
  kind: ResourceKind;
  amount: number;
}

// What a colonist carries: one stack, not a bag. Empty hands are `kind: null`
// rather than a zero amount of something — and that emptiness is also what tells
// the haul job which of its two legs it is on, so the two cannot drift apart.
interface Inventory {
  kind: ResourceKind | null;
  amount: number;
}

const enum BuildingKind {
  Warehouse = 0,
  Farm = 1,
}

// A placed building. One component for every kind, with the fields a kind has no
// use for left at zero — the shape `Job` already has, and for the same reason:
// "is there a building here" must be one lookup, not a question asked of a Map
// per kind. What each kind does with which field is in BUILDING_DEFS.
interface Building {
  kind: BuildingKind;
  // Warehouse: the one resource it accepts, and how much of it is inside. The
  // stores are where the colony's resources are, so this is the only copy of that
  // number — the HUD's readout is summed back out of them.
  stores: ResourceKind | null;
  amount: number;
  // Farm: ticks accumulated toward the next crop.
  growth: number;
}

// What the player asked for, before there is a tile to put it on: the order waits
// in a signal while the cursor looks for a spot, and a click spends it. A store
// names its resource here — it holds one kind, and nothing later decides which.
type BuildOrder =
  | { kind: BuildingKind.Warehouse; stores: ResourceKind }
  | { kind: BuildingKind.Farm };

const enum AnimalKind {
  Chicken = 0,
}

// Livestock/wildlife. No needs and no job: those Maps define "is a colonist"
// for the HUD count and the job-assign system.
interface Animal {
  kind: AnimalKind;
  idleTicks: number; // ticks left standing still before the next stroll
}

export type {
  EntityId,
  Position,
  PlayerId,
  Needs,
  PathFollow,
  Job,
  Inventory,
  Animal,
  Building,
  BuildOrder,
  ItemStack,
  ResourceKind,
};
export { JobKind, AnimalKind, BuildingKind };
