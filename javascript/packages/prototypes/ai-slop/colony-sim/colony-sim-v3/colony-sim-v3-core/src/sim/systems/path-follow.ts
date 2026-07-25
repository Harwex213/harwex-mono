import type { World } from "../world";

// Advance each entity along its resolved path. prevPositions is snapshotted by
// the engine before systems run, so the renderer can lerp prev→current.
function pathFollowSystem(world: World): void {
  for (const [id, path] of world.paths) {
    const pos = world.positions.get(id);
    if (!pos) {
      world.paths.delete(id);
      continue;
    }
    const target = path.waypoints[path.index];
    if (!target) {
      world.paths.delete(id);
      continue;
    }

    const dx = target.x - pos.x;
    const dy = target.y - pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= path.speed) {
      pos.x = target.x;
      pos.y = target.y;
      path.index += 1;
      if (path.index >= path.waypoints.length) {
        world.paths.delete(id);
      }
    } else {
      pos.x += (dx / dist) * path.speed;
      pos.y += (dy / dist) * path.speed;
    }
  }
}

export { pathFollowSystem };
