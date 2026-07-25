const TILE = 24;
const MAP_W = 40;
const MAP_H = 26;

// Height codes stored in the grid. The shadow offset is proportional to the
// occluder height, so a pillar throws a longer shadow than a wall under the same
// sun. 0 means "no occluder".
const H_WALL = 1;
const H_PILLAR = 2;

const ELEV_OF: Record<number, number> = {
  [H_WALL]: 1,
  [H_PILLAR]: 1.9,
};

// Pixel-space occluder box plus its height multiplier. Merging only ever joins
// boxes of equal height, so one number per box is enough.
type Occluder = {
  x: number;
  y: number;
  w: number;
  h: number;
  // Elevation multiplier, not a pixel size: the shadow offset scales with it.
  elev: number;
};

// Deterministic PRNG: the layout must be identical across reloads, otherwise
// comparing "merge on" against "merge off" compares two different scenes.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function room(grid: Uint8Array, x0: number, y0: number, w: number, h: number, doorAt: number): void {
  for (let x = x0; x < x0 + w; x += 1) {
    grid[y0 * MAP_W + x] = H_WALL;
    grid[(y0 + h - 1) * MAP_W + x] = H_WALL;
  }
  for (let y = y0; y < y0 + h; y += 1) {
    grid[y * MAP_W + x0] = H_WALL;
    grid[y * MAP_W + (x0 + w - 1)] = H_WALL;
  }
  // A gap in the south wall: long runs with a hole in them are exactly where a
  // naive per-tile shadow pass and a merged one visibly differ.
  grid[(y0 + h - 1) * MAP_W + (x0 + doorAt)] = 0;
  grid[(y0 + h - 1) * MAP_W + (x0 + doorAt + 1)] = 0;
}

function buildGrid(): Uint8Array {
  const grid = new Uint8Array(MAP_W * MAP_H);

  room(grid, 3, 3, 11, 8, 4);
  room(grid, 22, 2, 14, 7, 6);
  room(grid, 8, 15, 9, 8, 3);

  // A free-standing wall, so not every shadow comes from a closed outline.
  for (let x = 24; x < 33; x += 1) {
    grid[16 * MAP_W + x] = H_WALL;
  }

  const rng = mulberry32(0x5eed);
  let placed = 0;
  while (placed < 26) {
    const x = 1 + Math.floor(rng() * (MAP_W - 2));
    const y = 1 + Math.floor(rng() * (MAP_H - 2));
    if (grid[y * MAP_W + x] !== 0) {
      continue;
    }
    // Keep pillars off the tiles next to a wall: touching boxes merge into odd
    // L-shapes that the box-hull shadow cannot represent exactly.
    if (grid[y * MAP_W + x - 1] !== 0 || grid[y * MAP_W + x + 1] !== 0) {
      continue;
    }
    if (grid[(y - 1) * MAP_W + x] !== 0 || grid[(y + 1) * MAP_W + x] !== 0) {
      continue;
    }
    grid[y * MAP_W + x] = H_PILLAR;
    placed += 1;
  }

  return grid;
}

// One box per occupied tile. This is the honest baseline: correct, and the reason
// merging exists — the wall outlines alone are ~120 boxes, each one a hull, a
// polygon and a triangulation every time the sun moves.
function tileOccluders(grid: Uint8Array): Occluder[] {
  const out: Occluder[] = [];
  for (let y = 0; y < MAP_H; y += 1) {
    for (let x = 0; x < MAP_W; x += 1) {
      const code = grid[y * MAP_W + x];
      if (code === 0) {
        continue;
      }
      out.push({ x: x * TILE, y: y * TILE, w: TILE, h: TILE, elev: ELEV_OF[code] });
    }
  }
  return out;
}

// Greedy meshing: horizontal runs of equal height first, then vertical merges of
// runs that share both x-range and height in adjacent rows. Fewer, larger boxes
// mean fewer hulls per frame and — more importantly — no shared edges between
// neighbouring shadows, which is where seams show up on a translucent pass.
function mergeOccluders(grid: Uint8Array): Occluder[] {
  const runs: Occluder[] = [];
  const openByKey = new Map<string, Occluder>();

  for (let y = 0; y < MAP_H; y += 1) {
    const rowOpen = new Map<string, Occluder>();
    let x = 0;
    while (x < MAP_W) {
      const code = grid[y * MAP_W + x];
      if (code === 0) {
        x += 1;
        continue;
      }
      let end = x;
      while (end < MAP_W && grid[y * MAP_W + end] === code) {
        end += 1;
      }

      const key = `${x}:${end}:${code}`;
      const above = openByKey.get(key);
      if (above !== undefined && above.y + above.h === y * TILE) {
        above.h += TILE;
        rowOpen.set(key, above);
      } else {
        const box: Occluder = {
          x: x * TILE,
          y: y * TILE,
          w: (end - x) * TILE,
          h: TILE,
          elev: ELEV_OF[code],
        };
        runs.push(box);
        rowOpen.set(key, box);
      }

      x = end;
    }

    openByKey.clear();
    for (const [key, box] of rowOpen) {
      openByKey.set(key, box);
    }
  }

  return runs;
}

export { buildGrid, mergeOccluders, tileOccluders, MAP_H, MAP_W, TILE };
export type { Occluder };
