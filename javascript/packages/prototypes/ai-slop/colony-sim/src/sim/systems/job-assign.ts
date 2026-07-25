import { randInt, type Rng } from "@/sim/rng";
import { isWalkable } from "@/sim/grid";
import { findPath } from "@/sim/pathfinding/astar";
import { JobKind } from "@/sim/components";
import type { World } from "@/sim/world";

// MVP placeholder: idle colonists wander to a random reachable tile. This is the
// seam where the real job-queue (HarvestTree / Haul) plugs in — pick the nearest
// open job instead of a random tile, set targetTile/targetId, then path to it.
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
      if (!isWalkable(world.grid, tx, ty)) {
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
