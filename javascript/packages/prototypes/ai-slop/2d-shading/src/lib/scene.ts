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

// A wall face in world pixels. Both endpoints matter: the caster shoots a ray at
// each one, so the segment count drives both loops of the visibility pass.
type Segment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
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

// Lights are placed by tile and the map is generated, so a requested tile may hold
// a pillar. A light inside an occluder sees nothing at all, which reads as a bug
// rather than as a demo — so snap to the nearest free tile and return its centre.
function freeTile(grid: Uint8Array, tx: number, ty: number): { x: number; y: number } {
  for (let r = 0; r < 10; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        const x = tx + dx;
        const y = ty + dy;
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) {
          continue;
        }
        if (grid[y * MAP_W + x] === 0) {
          return { x: (x + 0.5) * TILE, y: (y + 0.5) * TILE };
        }
      }
    }
  }
  return { x: (MAP_W / 2) * TILE, y: (MAP_H / 2) * TILE };
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


// A wall face is an edge of the shadow-casting world only when the tile behind it
// is empty: interior faces between two solid tiles can never be hit by a ray, and
// feeding them to the caster doubles n for nothing. Collinear faces are then merged
// into runs — the same reason as greedy meshing, but it matters far more here,
// because visibility costs O(rays x segments) and every segment also adds two rays.
function occluderSegments(grid: Uint8Array): Segment[] {
  const segs: Segment[] = [];
  const solid = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) {
      return false;
    }
    return grid[y * MAP_W + x] !== 0;
  };

  // Horizontal faces: north (dy = -1) and south (dy = +1), merged along x.
  for (const dy of [-1, 1]) {
    for (let y = 0; y < MAP_H; y += 1) {
      let run = -1;
      for (let x = 0; x <= MAP_W; x += 1) {
        const exposed = x < MAP_W && solid(x, y) && !solid(x, y + dy);
        if (exposed && run < 0) {
          run = x;
        }
        if (!exposed && run >= 0) {
          const edgeY = (dy < 0 ? y : y + 1) * TILE;
          segs.push({ x1: run * TILE, y1: edgeY, x2: x * TILE, y2: edgeY });
          run = -1;
        }
      }
    }
  }

  // Vertical faces: west (dx = -1) and east (dx = +1), merged along y.
  for (const dx of [-1, 1]) {
    for (let x = 0; x < MAP_W; x += 1) {
      let run = -1;
      for (let y = 0; y <= MAP_H; y += 1) {
        const exposed = y < MAP_H && solid(x, y) && !solid(x + dx, y);
        if (exposed && run < 0) {
          run = y;
        }
        if (!exposed && run >= 0) {
          const edgeX = (dx < 0 ? x : x + 1) * TILE;
          segs.push({ x1: edgeX, y1: run * TILE, x2: edgeX, y2: y * TILE });
          run = -1;
        }
      }
    }
  }

  return segs;
}

// The unmerged baseline: four edges per solid tile, interior faces included. Kept
// so the demo can show what the caster costs without the pass above.
function tileSegments(grid: Uint8Array): Segment[] {
  const segs: Segment[] = [];
  for (let y = 0; y < MAP_H; y += 1) {
    for (let x = 0; x < MAP_W; x += 1) {
      if (grid[y * MAP_W + x] === 0) {
        continue;
      }
      const x0 = x * TILE;
      const y0 = y * TILE;
      const x1 = x0 + TILE;
      const y1 = y0 + TILE;
      segs.push(
        { x1: x0, y1: y0, x2: x1, y2: y0 },
        { x1: x1, y1: y0, x2: x1, y2: y1 },
        { x1: x1, y1: y1, x2: x0, y2: y1 },
        { x1: x0, y1: y1, x2: x0, y2: y0 },
      );
    }
  }
  return segs;
}

export {
  buildGrid,
  freeTile,
  mergeOccluders,
  occluderSegments,
  tileOccluders,
  tileSegments,
  MAP_H,
  MAP_W,
  TILE,
};
export type { Occluder, Segment };
