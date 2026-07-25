import { neighbors } from "./hex-facing.js";

/**
 * Shortest path (fewest hexes) from `start` to any hex satisfying `isGoal`,
 * over hexes passing `isPassable`. BFS over the odd-r grid.
 * @param {{row: number, col: number}} start
 * @param {(row: number, col: number) => boolean} isGoal deployment-edge test
 * @param {(row: number, col: number) => boolean} isPassable in-bounds && terrain passable && free of other units
 * @returns {{row: number, col: number}[]} path from the first step to the goal, excluding `start`; `[]` if start already satisfies isGoal or no goal is reachable
 */
const fleePath = (start, isGoal, isPassable) => {
  if (isGoal(start.row, start.col)) {
    return [];
  }

  const key = (row, col) => `${row}:${col}`;
  const visited = new Set([key(start.row, start.col)]);
  const parent = new Map();
  const queue = [start];

  while (queue.length) {
    const cur = queue.shift();
    for (const nb of neighbors(cur)) {
      const k = key(nb.row, nb.col);
      if (visited.has(k)) {
        continue;
      }
      if (!isPassable(nb.row, nb.col)) {
        continue;
      }
      visited.add(k);
      parent.set(k, cur);
      if (isGoal(nb.row, nb.col)) {
        const path = [nb];
        let p = cur;
        while (!(p.row === start.row && p.col === start.col)) {
          path.unshift(p);
          p = parent.get(key(p.row, p.col));
        }
        return path;
      }
      queue.push(nb);
    }
  }

  return [];
};

export { fleePath };
