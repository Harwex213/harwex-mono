// Helpers shared by generators. Nothing here knows about a particular map style.

import { type Grid, isWalkable, tileIndex, Terrain } from "../grid";
import type { Position } from "../components";

// The walkable tile closest to a wish position, searched in growing square
// rings. Generators pick the colony spot from the shape they drew (the middle
// of a region, a clearing they cut); this turns that wish into a tile that is
// actually standable, so no map can hand the world builder a stockpile inside a
// cliff or a lake.
function nearestWalkable(grid: Grid, wish: Position): Position {
  const x0 = Math.min(grid.width - 1, Math.max(0, Math.round(wish.x)));
  const y0 = Math.min(grid.height - 1, Math.max(0, Math.round(wish.y)));
  if (isWalkable(grid, x0, y0)) {
    return { x: x0, y: y0 };
  }
  const maxRadius = Math.max(grid.width, grid.height);
  for (let radius = 1; radius < maxRadius; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        // Only the ring itself: the inside was covered by smaller radii.
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) {
          continue;
        }
        const x = x0 + dx;
        const y = y0 + dy;
        if (isWalkable(grid, x, y)) {
          return { x, y };
        }
      }
    }
  }
  // Every tile blocked: a generator bug, but the world still needs an origin.
  grid.terrain[tileIndex(grid, x0, y0)] = Terrain.Grass;
  return { x: x0, y: y0 };
}

// The rows the starting camps sit on: spread along the map's height, the outermost
// two a margin in from the edges. Camps go as far from each other as the map
// allows — rival crews sharing a clearing is a fight on tick one — and they spread
// along the height, not the width, because a map is free to run a wall down the
// vertical axis (see divided-lands) and every camp has to end up on the same side
// of it. The column is the generator's business; only the rows are shared.
function campRows(grid: Grid, count: number, margin: number): number[] {
  if (count <= 0) {
    return [];
  }
  // A margin wider than half the map would put the first camp below the last.
  const top = Math.min(margin, (grid.height - 1) / 2);
  const bottom = grid.height - 1 - top;
  if (count === 1) {
    return [Math.round((top + bottom) / 2)];
  }
  const step = (bottom - top) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(top + i * step));
}

export { campRows, nearestWalkable };
