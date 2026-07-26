import { COLONIST_SPEED } from "../../data/defs";
import { randInt, type Rng } from "../rng";
import { dist2 } from "../math";
import { isDeadLands, isWalkable } from "../grid";
import { findPath } from "../pathfinding/astar";
import { type EntityId, type Job, JobKind, type Position } from "../components";
import { nearestStore } from "../stores";
import type { World } from "../world";

// How many of the nearest loose stacks are worth an A* run before the colonist
// gives up and strolls instead. A pile behind a cliff must not freeze a colonist
// for the rest of the game, and the fourth-nearest stack is already somebody
// else's errand.
const HAUL_CANDIDATES = 3;

// Where an idle colonist's next job comes from: hauling if there is any, a stroll
// otherwise. Hauling comes first because a colony with a store and loot on the
// ground has work to do, and a colonist walking past a stack it could carry reads
// as a broken sim. HarvestTree is still unassigned — see workSystem.
//
// The dead lands are walkable but not somewhere anyone strolls: a colonist who
// wandered through a gorge would spend the game crossing barren stone on the far
// side of a wall, out of reach of its own camp and of everything the player is
// watching. Only the destination is filtered, not the path — both are checks the
// wander target has to pass, and a route that clips a pass on the way from one
// green tile to another is a colonist taking a shortcut, not one emigrating.
function jobAssignSystem(world: World, rng: Rng): void {
  const claimed = claimedStacks(world);
  for (const [id, job] of world.jobs) {
    if (world.paths.has(id)) {
      continue; // already moving
    }
    if (job.kind !== JobKind.Wander) {
      continue; // real jobs handled by workSystem
    }

    const from = world.positions.get(id);
    if (!from) {
      continue;
    }
    if (takeHaul(world, id, job, from, claimed)) {
      continue;
    }
    wander(world, rng, id, from);
  }
}

// Stacks another colonist is already on its way to. Without it every idle colonist
// sets off for the same nearest pile and all but one arrive to bare ground. The ids
// are read off the jobs themselves, so a claim cannot outlive the job holding it.
function claimedStacks(world: World): Set<EntityId> {
  const claimed = new Set<EntityId>();
  for (const job of world.jobs.values()) {
    if (job.kind === JobKind.Haul && job.targetId !== null) {
      claimed.add(job.targetId);
    }
  }
  return claimed;
}

// Takes the nearest reachable stack that some store still accepts. A stack nobody
// has room for is not a job at all: the colonist would carry it to a full warehouse
// and put it straight back down.
function takeHaul(world: World, id: EntityId, job: Job, from: Position, claimed: Set<EntityId>): boolean {
  const candidates: { id: EntityId; tile: Position; distance: number }[] = [];
  for (const [stackId, stack] of world.items) {
    if (claimed.has(stackId)) {
      continue;
    }
    const tile = world.positions.get(stackId);
    if (!tile || nearestStore(world, tile, stack.kind) === null) {
      continue;
    }
    candidates.push({ id: stackId, tile, distance: dist2(tile.x, tile.y, from.x, from.y) });
  }
  candidates.sort((a, b) => a.distance - b.distance);

  for (const candidate of candidates.slice(0, HAUL_CANDIDATES)) {
    const waypoints = findPath(world.grid, from, candidate.tile);
    if (!waypoints) {
      continue;
    }
    job.kind = JobKind.Haul;
    job.targetId = candidate.id;
    job.targetTile = null;
    job.progress = 0;
    claimed.add(candidate.id);
    // Already standing on it: no path to walk, and workSystem picks the stack up on
    // this very tick. A zero-waypoint path would be one that ends before it starts.
    if (waypoints.length > 0) {
      world.paths.set(id, { waypoints, index: 0, speed: COLONIST_SPEED });
    }
    return true;
  }
  return false;
}

// Nothing worth doing: a stroll to a random reachable tile in the lands they live in.
function wander(world: World, rng: Rng, id: EntityId, from: Position): void {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const tx = randInt(rng, 0, world.grid.width);
    const ty = randInt(rng, 0, world.grid.height);
    if (!isWalkable(world.grid, tx, ty) || isDeadLands(world.grid, tx, ty)) {
      continue;
    }
    const waypoints = findPath(world.grid, from, { x: tx, y: ty });
    if (waypoints && waypoints.length > 0) {
      world.paths.set(id, { waypoints, index: 0, speed: COLONIST_SPEED });
      return;
    }
  }
}

export { jobAssignSystem };
