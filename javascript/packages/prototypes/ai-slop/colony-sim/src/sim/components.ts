// ECS components — pure data, keyed by entityId in the World's Maps.

type EntityId = number;

// Continuous position in tile coordinates.
interface Position {
  x: number;
  y: number;
}

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

interface Inventory {
  wood: number;
}

// Colony-wide stock. One record rather than loose counters on the World: the HUD
// reads the pools as a set, and a new resource should not mean a new field in
// three layers.
type ResourceKind = "wood" | "stone" | "food";

type Stock = Record<ResourceKind, number>;

const enum AnimalKind {
  Chicken = 0,
}

// Livestock/wildlife. No needs and no job: those Maps define "is a colonist"
// for the HUD count and the job-assign system.
interface Animal {
  kind: AnimalKind;
  idleTicks: number; // ticks left standing still before the next stroll
}

export type { EntityId, Position, Needs, PathFollow, Job, Inventory, Animal, ResourceKind, Stock };
export { JobKind, AnimalKind };
