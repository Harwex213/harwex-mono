import { PAWN_CONFIG } from "@/config/map";
import { TileType } from "@/core/types";
import type { GameMap, Pawn } from "@/core/types";

const PREFIXES = ["Ар", "Бар", "Гор", "Дан", "Зар", "Кор", "Лан", "Мор", "Рон", "Тор"];
const SUFFIXES = ["ак", "ен", "ик", "ин", "ис", "ок", "ор", "ус", "эль", "ан"];

function generateName(): string {
  const prefix = PREFIXES[Math.floor(Math.random() * PREFIXES.length)];
  const suffix = SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];
  return prefix + suffix;
}

function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function findLargestRegion(map: GameMap): Set<string> {
  const height = map.length;
  const width = map[0].length;
  const visited = new Set<string>();
  let largest: Set<string> = new Set();

  const key = (col: number, row: number) => `${col},${row}`;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const k = key(col, row);
      if (visited.has(k)) continue;
      if (map[row][col].type !== TileType.FertileLand) continue;

      // BFS flood fill
      const region = new Set<string>();
      const queue = [{ col, row }];
      region.add(k);
      visited.add(k);

      while (queue.length > 0) {
        const { col: c, row: r } = queue.shift()!;
        for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nc >= width || nr < 0 || nr >= height) continue;
          const nk = key(nc, nr);
          if (visited.has(nk)) continue;
          if (map[nr][nc].type !== TileType.FertileLand) continue;
          visited.add(nk);
          region.add(nk);
          queue.push({ col: nc, row: nr });
        }
      }

      if (region.size > largest.size) {
        largest = region;
      }
    }
  }

  return largest;
}

function spawnPawns(map: GameMap): Pawn[] {
  const { initialCount, maxHealth, spawnRadius } = PAWN_CONFIG;
  const height = map.length;
  const width = map[0].length;
  const centerCol = Math.floor(width / 2);
  const centerRow = Math.floor(height / 2);

  const largestRegion = findLargestRegion(map);

  const candidates: { col: number; row: number }[] = [];

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (!largestRegion.has(`${col},${row}`)) continue;
      if (map[row][col].object !== null) continue;

      const dist = Math.sqrt((col - centerCol) ** 2 + (row - centerRow) ** 2);
      if (dist > spawnRadius) continue;

      candidates.push({ col, row });
    }
  }

  // If no candidates near center, fall back to entire largest region
  const pool = candidates.length >= initialCount
    ? candidates
    : [...largestRegion]
        .filter(k => {
          const [c, r] = k.split(",").map(Number);
          return map[r][c].object === null;
        })
        .map(k => {
          const [col, row] = k.split(",").map(Number);
          return { col, row };
        });

  const shuffled = shuffleArray(pool);
  const selected = shuffled.slice(0, initialCount);

  return selected.map((pos, i) => ({
    id: i + 1,
    name: generateName(),
    health: maxHealth,
    maxHealth,
    x: pos.col,
    y: pos.row,
    targetCol: pos.col,
    targetRow: pos.row,
    idleTimer: 0,
  }));
}

export { spawnPawns };
