import { randInt, type Rng } from "../rng";
import { isWalkable } from "../grid";
import { findPath } from "../pathfinding/astar";
import type { World } from "../world";

const CHICKEN_SPEED = 0.05; // tiles per tick (colonists walk at 0.12)
const WANDER_RADIUS = 3;
const IDLE_MIN = 10;
const IDLE_MAX = 40;
const PICK_ATTEMPTS = 8;

// Animals peck around: a short hop inside a small radius, then a pause. Reuses
// the shared path component, so pathFollowSystem moves them for free.
function animalWanderSystem(world: World, rng: Rng): void {
  for (const [id, animal] of world.animals) {
    if (world.paths.has(id)) {
      continue; // already strolling
    }
    if (animal.idleTicks > 0) {
      animal.idleTicks -= 1;
      continue;
    }
    const from = world.positions.get(id);
    if (!from) {
      continue;
    }
    for (let attempt = 0; attempt < PICK_ATTEMPTS; attempt += 1) {
      const tx = Math.round(from.x) + randInt(rng, -WANDER_RADIUS, WANDER_RADIUS + 1);
      const ty = Math.round(from.y) + randInt(rng, -WANDER_RADIUS, WANDER_RADIUS + 1);
      if (!isWalkable(world.grid, tx, ty)) {
        continue;
      }
      const waypoints = findPath(world.grid, from, { x: tx, y: ty });
      if (waypoints && waypoints.length > 0) {
        world.paths.set(id, { waypoints, index: 0, speed: CHICKEN_SPEED });
        animal.idleTicks = randInt(rng, IDLE_MIN, IDLE_MAX);
        break;
      }
    }
  }
}

export { animalWanderSystem };
