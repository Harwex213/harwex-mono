import { tileIndex, isWalkable, type Grid } from "@/sim/grid";
import type { Position } from "@/sim/components";

// 8-directional A*. Diagonals cost √2 and are forbidden when either
// orthogonal neighbour is blocked (no corner cutting).

const SQRT2 = Math.SQRT2;

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

function octileHeuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
}

// Returns tile waypoints from start (exclusive) to goal (inclusive), or null.
function findPath(grid: Grid, start: Position, goal: Position): Position[] | null {
  const sx = Math.round(start.x);
  const sy = Math.round(start.y);
  const gx = Math.round(goal.x);
  const gy = Math.round(goal.y);
  if (!isWalkable(grid, gx, gy)) {
    return null;
  }

  const size = grid.width * grid.height;
  const cameFrom = new Int32Array(size).fill(-1);
  const gScore = new Float64Array(size).fill(Infinity);
  const closed = new Uint8Array(size);

  const startIdx = tileIndex(grid, sx, sy);
  const goalIdx = tileIndex(grid, gx, gy);
  gScore[startIdx] = 0;

  // Small binary-heap open set keyed by fScore.
  const heapIdx: number[] = [];
  const heapF: number[] = [];
  const push = (idx: number, f: number): void => {
    heapIdx.push(idx);
    heapF.push(f);
    let i = heapIdx.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heapF[parent] <= heapF[i]) {
        break;
      }
      [heapF[parent], heapF[i]] = [heapF[i], heapF[parent]];
      [heapIdx[parent], heapIdx[i]] = [heapIdx[i], heapIdx[parent]];
      i = parent;
    }
  };
  const pop = (): number => {
    const top = heapIdx[0];
    const lastIdx = heapIdx.pop() as number;
    const lastF = heapF.pop() as number;
    if (heapIdx.length > 0) {
      heapIdx[0] = lastIdx;
      heapF[0] = lastF;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < heapF.length && heapF[l] < heapF[smallest]) {
          smallest = l;
        }
        if (r < heapF.length && heapF[r] < heapF[smallest]) {
          smallest = r;
        }
        if (smallest === i) {
          break;
        }
        [heapF[smallest], heapF[i]] = [heapF[i], heapF[smallest]];
        [heapIdx[smallest], heapIdx[i]] = [heapIdx[i], heapIdx[smallest]];
        i = smallest;
      }
    }
    return top;
  };

  push(startIdx, octileHeuristic(sx, sy, gx, gy));

  while (heapIdx.length > 0) {
    const current = pop();
    if (current === goalIdx) {
      return reconstruct(grid, cameFrom, goalIdx);
    }
    if (closed[current]) {
      continue;
    }
    closed[current] = 1;
    const cx = current % grid.width;
    const cy = Math.floor(current / grid.width);

    for (const [dx, dy, cost] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkable(grid, nx, ny)) {
        continue;
      }
      if (dx !== 0 && dy !== 0) {
        if (!isWalkable(grid, cx + dx, cy) || !isWalkable(grid, cx, cy + dy)) {
          continue; // no corner cutting
        }
      }
      const nIdx = tileIndex(grid, nx, ny);
      const tentative = gScore[current] + cost;
      if (tentative < gScore[nIdx]) {
        gScore[nIdx] = tentative;
        cameFrom[nIdx] = current;
        push(nIdx, tentative + octileHeuristic(nx, ny, gx, gy));
      }
    }
  }
  return null;
}

function reconstruct(grid: Grid, cameFrom: Int32Array, goalIdx: number): Position[] {
  const path: Position[] = [];
  let node = goalIdx;
  while (node !== -1) {
    path.push({ x: node % grid.width, y: Math.floor(node / grid.width) });
    node = cameFrom[node];
  }
  path.reverse();
  path.shift(); // drop the start tile itself
  return path;
}

export { findPath };
