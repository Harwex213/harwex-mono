import { COLONIST_SPEED } from "../../data/defs";
import type { EntityId, Inventory, Job, Position } from "../components";
import { JobKind } from "../components";
import { dist } from "../math";
import { findPathNear } from "../pathfinding/astar";
import { deposit, nearestStore, storeRoom } from "../stores";
import { despawn, spawnItem, type World } from "../world";

// How close counts as "arrived". A hauler walks up to the tile beside its target —
// a store fills its own tile — so a diagonal neighbour, √2 away, is there.
const REACH = 1.6;

// The haul loop: fetch a loose stack, carry it to a store that takes it, put it
// down. Which of the two legs a colonist is on is read off its hands rather than
// stored on the job — empty means it is still going for the stack — so there is no
// second copy of that fact to disagree with the inventory.
//
// A job that cannot continue ends: the stack was taken by someone closer, the store
// filled up, the route is gone. Ending it means dropping whatever is carried back on
// the ground and going idle, never holding a load forever — loot the player cannot
// see is loot that looks lost.
//
// TODO: HarvestTree — on arrival at targetId accumulate progress up to the def's
// harvestTicks, then destroyObject(world, targetId) and haul the stack it leaves.
function workSystem(world: World): void {
  for (const [id, job] of world.jobs) {
    if (job.kind !== JobKind.Haul) {
      continue;
    }
    if (world.paths.has(id)) {
      continue; // still walking; pathFollow ran before this system
    }
    const pos = world.positions.get(id);
    const carried = world.inventories.get(id);
    if (!pos || !carried) {
      idle(job);
      continue;
    }
    if (carried.kind === null || carried.amount <= 0) {
      fetch(world, id, job, pos, carried);
      continue;
    }
    deliver(world, id, job, pos, carried, carried.kind);
  }
}

// Leg one: reach the stack and take all of it. The stack may be gone — another
// hauler got there first — and then there is simply nothing to do.
function fetch(world: World, id: EntityId, job: Job, pos: Position, carried: Inventory): void {
  const target = job.targetId;
  if (target === null) {
    idle(job);
    return;
  }
  const stack = world.items.get(target);
  const stackPos = world.positions.get(target);
  if (!stack || !stackPos) {
    idle(job);
    return;
  }
  if (!within(pos, stackPos)) {
    // Not there and not walking: one more attempt at a route, then give up rather
    // than stand beside an unreachable pile forever.
    if (!walkTo(world, id, pos, stackPos)) {
      idle(job);
    }
    return;
  }
  carried.kind = stack.kind;
  carried.amount = stack.amount;
  despawn(world, target);

  // The store is chosen now rather than when the job was taken: the walk to the
  // stack takes ticks, and the warehouse that had room then may be full by now.
  const store = nearestStore(world, pos, carried.kind);
  if (store === null) {
    dropLoad(world, pos, carried);
    idle(job);
    return;
  }
  job.targetId = store;
  const storePos = world.positions.get(store);
  if (!storePos || !walkTo(world, id, pos, storePos)) {
    dropLoad(world, pos, carried);
    idle(job);
  }
}

// Leg two: reach the store and put the load down. The destination is re-checked on
// arrival — it may have filled or been torn down mid-walk — and the load is
// re-routed to another store instead of being pushed into nothing.
function deliver(
  world: World,
  id: EntityId,
  job: Job,
  pos: Position,
  carried: Inventory,
  kind: NonNullable<Inventory["kind"]>,
): void {
  let target = job.targetId;
  if (target === null || storeRoom(world, target, kind) <= 0) {
    target = nearestStore(world, pos, kind);
    job.targetId = target;
  }
  const storePos = target === null ? null : world.positions.get(target);
  if (target === null || !storePos) {
    dropLoad(world, pos, carried);
    idle(job);
    return;
  }
  if (!within(pos, storePos)) {
    if (!walkTo(world, id, pos, storePos)) {
      dropLoad(world, pos, carried);
      idle(job);
    }
    return;
  }
  carried.amount -= deposit(world, target, kind, carried.amount);
  // Whatever did not fit goes back on the ground — the next hauler will find it
  // once some store has room again.
  dropLoad(world, pos, carried);
  carried.kind = null;
  carried.amount = 0;
  idle(job);
}

// Sends the colonist at its target, up to the tile beside it. False when there is
// no route at all, so the caller abandons the job instead of retrying every tick.
function walkTo(world: World, id: EntityId, from: Position, to: Position): boolean {
  const waypoints = findPathNear(world.grid, from, to);
  if (!waypoints) {
    return false;
  }
  if (waypoints.length > 0) {
    world.paths.set(id, { waypoints, index: 0, speed: COLONIST_SPEED });
  }
  return true;
}

// A load with nowhere to go goes back on the ground, on the tile its carrier stands
// on: destroying it would be a resource leak with nothing on screen to show for it.
function dropLoad(world: World, pos: Position, carried: Inventory): void {
  if (carried.kind === null || carried.amount <= 0) {
    return;
  }
  spawnItem(world, { x: Math.floor(pos.x), y: Math.floor(pos.y) }, carried.kind, carried.amount);
  carried.kind = null;
  carried.amount = 0;
}

function within(a: Position, b: Position): boolean {
  return dist(a.x, a.y, b.x, b.y) <= REACH;
}

// Back to idle, and back to jobAssign's hands next tick.
function idle(job: Job): void {
  job.kind = JobKind.Wander;
  job.targetId = null;
  job.targetTile = null;
  job.progress = 0;
}

export { workSystem };
