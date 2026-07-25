import { randInt, type Rng } from "../rng";
import { isDeadLands, isWalkable } from "../grid";
import { findPath } from "../pathfinding/astar";
import { JobKind } from "../components";
import type { World } from "../world";

// MVP placeholder: idle colonists wander to a random reachable tile inside the
// lands they live in. This is the seam where the real job-queue (HarvestTree /
// Haul) plugs in — pick the nearest open job instead of a random tile, set
// targetTile/targetId, then path to it.
//
// The dead lands are walkable but not somewhere anyone strolls: a colonist who
// wandered through a gorge would spend the game crossing barren stone on the far
// side of a wall, out of reach of its own camp and of everything the player is
// watching. Only the destination is filtered, not the path — both are checks the
// wander target has to pass, and a route that clips a pass on the way from one
// green tile to another is a colonist taking a shortcut, not one emigrating.
function jobAssignSystem(world: World, rng: Rng): void {
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
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const tx = randInt(rng, 0, world.grid.width);
      const ty = randInt(rng, 0, world.grid.height);
      if (!isWalkable(world.grid, tx, ty) || isDeadLands(world.grid, tx, ty)) {
        continue;
      }
      const waypoints = findPath(world.grid, from, { x: tx, y: ty });
      if (waypoints && waypoints.length > 0) {
        world.paths.set(id, { waypoints, index: 0, speed: 0.12 });
        break;
      }
    }
  }
}

export { jobAssignSystem };
