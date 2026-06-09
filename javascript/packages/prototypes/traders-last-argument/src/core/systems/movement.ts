import { PAWN_CONFIG } from "@/config/map";
import { TileType } from "@/core/types";
import type { GameMap, Pawn } from "@/core/types";

const DIRECTIONS = [
  { dc: 0, dr: -1 }, // up
  { dc: 0, dr: 1 },  // down
  { dc: -1, dr: 0 }, // left
  { dc: 1, dr: 0 },  // right
];

function getWalkableNeighbors(
  col: number,
  row: number,
  map: GameMap,
): { col: number; row: number }[] {
  const neighbors: { col: number; row: number }[] = [];
  const height = map.length;
  const width = map[0].length;

  for (const { dc, dr } of DIRECTIONS) {
    const nc = col + dc;
    const nr = row + dr;
    if (nc < 0 || nc >= width || nr < 0 || nr >= height) continue;
    if (map[nr][nc].type === TileType.Mountain) continue;
    neighbors.push({ col: nc, row: nr });
  }

  return neighbors;
}

function updateMovement(pawns: Pawn[], map: GameMap, dt: number): void {
  const { speed, idleDuration } = PAWN_CONFIG;

  for (const pawn of pawns) {
    if (pawn.idleTimer > 0) {
      pawn.idleTimer -= dt;
      continue;
    }

    const dx = pawn.targetCol - pawn.x;
    const dy = pawn.targetRow - pawn.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 0.01) {
      // Snap to target
      pawn.x = pawn.targetCol;
      pawn.y = pawn.targetRow;

      // Pick a new random walkable neighbor
      const neighbors = getWalkableNeighbors(pawn.targetCol, pawn.targetRow, map);
      if (neighbors.length > 0) {
        const next = neighbors[Math.floor(Math.random() * neighbors.length)];
        pawn.targetCol = next.col;
        pawn.targetRow = next.row;
      } else {
        pawn.idleTimer = idleDuration;
      }
    } else {
      // Move toward target
      const step = speed * dt;
      if (step >= dist) {
        pawn.x = pawn.targetCol;
        pawn.y = pawn.targetRow;
      } else {
        pawn.x += (dx / dist) * step;
        pawn.y += (dy / dist) * step;
      }
    }
  }
}

export { updateMovement };
