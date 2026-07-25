import { BUILDING_DEFS } from "../data/defs";
import { BuildingKind, type EntityId, type Position, type ResourceKind } from "./components";
import type { World } from "./world";

// Where the colony's resources are kept, as queries over the buildings. A store
// holds one resource, so "does this go here" is a question about kind and room —
// and the job that picks a load up and the one that puts it down have to answer it
// identically, hence one module instead of a copy inside each system.

// Free space for `kind` in a building: 0 for anything that is not a store, or is a
// store of something else. Capacity comes from the def, so no store can promise
// room the content tables do not give it.
function storeRoom(world: World, id: EntityId, kind: ResourceKind): number {
  const building = world.buildings.get(id);
  if (!building || building.kind !== BuildingKind.Warehouse || building.stores !== kind) {
    return 0;
  }
  return Math.max(0, BUILDING_DEFS[building.kind].capacity - building.amount);
}

// The nearest store that still takes `kind`, by straight-line distance — the hauler
// paths to it afterwards, and a store walled off behind a cliff is rare enough not
// to be worth an A* run per candidate.
function nearestStore(world: World, from: Position, kind: ResourceKind): EntityId | null {
  let best: EntityId | null = null;
  let bestDistance = Infinity;
  for (const id of world.buildings.keys()) {
    if (storeRoom(world, id, kind) <= 0) {
      continue;
    }
    const pos = world.positions.get(id);
    if (!pos) {
      continue;
    }
    const distance = (pos.x - from.x) ** 2 + (pos.y - from.y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = id;
    }
  }
  return best;
}

// Moves as much of a carried stack into a store as fits and reports what went in.
// The leftover stays the caller's problem — it goes back on the ground — because a
// store that quietly swallowed the remainder would be resources vanishing at the
// exact moment the player can least see it.
function deposit(world: World, id: EntityId, kind: ResourceKind, amount: number): number {
  const building = world.buildings.get(id);
  const moved = Math.min(storeRoom(world, id, kind), amount);
  if (!building || moved <= 0) {
    return 0;
  }
  building.amount += moved;
  return moved;
}

export { deposit, nearestStore, storeRoom };
