import { createPerlin, fbm } from "./noise";
import { createRng, hashSeed, pick } from "./rng";
import type { TRng } from "./rng";
import type { TBiomeId } from "./types";

/**
 * The global map is a Goldberg polyhedron: the dual of an icosahedron whose
 * faces are split into `GRID_FREQUENCY`² triangles. That gives
 * 10·f² + 2 cells: 12 pentagons and the rest hexagons. Cells carry
 * unit-length coordinates; the globe component scales them.
 */

/** Frequency 7 yields 492 cells, about ten times the old 42-cell globe. */
const GRID_FREQUENCY = 7;
/** Two triangle corners closer than this are the same vertex. */
const WELD_EPSILON = 1e-6;
/** Rivals start at least this many flights away from each other. */
const MIN_PLAYER_DISTANCE = 6;
/**
 * The share of cells that hold land: islands and settlements. The rest is
 * void, a sea of clouds. Land is clustered by noise into archipelagos.
 */
const LAND_SHARE = 0.34;
/** The share of land cells that hold a neutral settlement instead of wild islands. */
const SETTLEMENT_SHARE = 0.12;
/** How many art variants of each cell kind the globe draws. */
const CELL_VARIANTS = 4;

/**
 * - `void`: clouds over the sea. Passable, nothing in it.
 * - `island`: wild islands with monsters. Flying in activates them, and the
 *   cleanup phase fights them.
 * - `settlement`: a neutral town. Passable, no effect yet.
 */
type TCellKind = "void" | "island" | "settlement";

type TVec3 = readonly [number, number, number];

type TWorldCell = {
  readonly id: string;
  /** The position of the cell in `TWorld.cells`. */
  readonly index: number;
  readonly center: TVec3;
  /** The cell's outline on the unit sphere, wound counter-clockwise. */
  readonly polygon: readonly TVec3[];
  readonly neighbors: readonly string[];
  readonly kind: TCellKind;
  /** Which drawing of its kind the globe shows, and how it is turned. */
  readonly variant: number;
  /** What the wild islands here are made of. Only `island` cells use it. */
  readonly biome: TBiomeId;
  /** Wild enemy islands waiting in an `island` cell. Zero everywhere else. */
  readonly islandCount: number;
  /** True once the player has flown into this island cell: its fight is on. */
  readonly activated: boolean;
  readonly revealed: boolean;
  /** The player whose island sits in this cell, if any. */
  readonly ownerId: string | null;
  /** Toxicity left behind here. It never falls, as the spec insists. */
  readonly toxicTrail: number;
  /** True once the clearing phase has emptied this cell of enemies. */
  readonly cleared: boolean;
};

type TWorld = {
  /** The seed of the planet surface, so the globe can paint the same planet. */
  readonly seed: string;
  readonly cells: readonly TWorldCell[];
};

const normalize = (v: TVec3): TVec3 => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;

  return [v[0] / length, v[1] / length, v[2] / length];
};

const add = (a: TVec3, b: TVec3): TVec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

const scale = (v: TVec3, k: number): TVec3 => [v[0] * k, v[1] * k, v[2] * k];

const sub = (a: TVec3, b: TVec3): TVec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const cross = (a: TVec3, b: TVec3): TVec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const dot = (a: TVec3, b: TVec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The twelve icosahedron corners, already on the unit sphere. */
const icosahedronVertices = (): TVec3[] => {
  const t = (1 + Math.sqrt(5)) / 2;

  const corners: TVec3[] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];

  return corners.map(normalize);
};

const ICOSAHEDRON_FACES: readonly (readonly [number, number, number])[] = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

type TGeodesic = {
  readonly vertices: readonly TVec3[];
  readonly triangles: readonly (readonly [number, number, number])[];
};

/**
 * Splits every icosahedron face into f² triangles on the sphere. Points on a
 * shared edge are computed once per face, so they are welded by distance.
 */
const geodesicSphere = (): TGeodesic => {
  const corners = icosahedronVertices();
  const vertices: TVec3[] = [];
  const triangles: [number, number, number][] = [];
  const steps = GRID_FREQUENCY;

  const weld = (point: TVec3) => {
    for (let index = 0; index < vertices.length; index += 1) {
      const other = vertices[index] as TVec3;
      if (Math.abs(other[0] - point[0]) < WELD_EPSILON
        && Math.abs(other[1] - point[1]) < WELD_EPSILON
        && Math.abs(other[2] - point[2]) < WELD_EPSILON) {
        return index;
      }
    }

    vertices.push(point);

    return vertices.length - 1;
  };

  for (const face of ICOSAHEDRON_FACES) {
    const [a, b, c] = [corners[face[0]], corners[face[1]], corners[face[2]]];
    if (!a || !b || !c) {
      continue;
    }

    const grid: number[][] = [];
    for (let row = 0; row <= steps; row += 1) {
      const line: number[] = [];
      for (let column = 0; column <= steps - row; column += 1) {
        const weightA = (steps - row - column) / steps;
        const weightB = column / steps;
        const weightC = row / steps;
        line.push(weld(normalize(add(add(scale(a, weightA), scale(b, weightB)), scale(c, weightC)))));
      }

      grid.push(line);
    }

    for (let row = 0; row < steps; row += 1) {
      const line = grid[row] as number[];
      const nextLine = grid[row + 1] as number[];

      for (let column = 0; column < line.length - 1; column += 1) {
        triangles.push([line[column] as number, line[column + 1] as number, nextLine[column] as number]);

        if (column + 1 < nextLine.length) {
          triangles.push([line[column + 1] as number, nextLine[column + 1] as number, nextLine[column] as number]);
        }
      }
    }
  }

  return { vertices, triangles };
};

/** Sorts a cell's corners around its centre, so the polygon does not self-cross. */
const sortAroundCenter = (center: TVec3, corners: TVec3[]) => {
  const reference = normalize(sub(corners[0] ?? [1, 0, 0], scale(center, dot(corners[0] ?? [1, 0, 0], center))));
  const side = cross(center, reference);

  return [...corners].sort((a, b) => {
    const angleA = Math.atan2(dot(a, side), dot(a, reference));
    const angleB = Math.atan2(dot(b, side), dot(b, reference));

    return angleA - angleB;
  });
};

/** A biome for wild islands: cold near the poles, hot near the equator. */
const islandBiome = (latitude: number, wetness: number, rng: TRng): TBiomeId => {
  if (latitude > 0.86) {
    return wetness > 0.5 ? "tundra" : "polar_desert";
  }

  if (latitude > 0.62) {
    return pick(rng, ["taiga", "tundra", "mountains", "cliffs"] as const);
  }

  if (latitude > 0.3) {
    return wetness > 0.5
      ? pick(rng, ["forrest", "grassland", "hills", "swamp"] as const)
      : pick(rng, ["plains", "grassland", "hills", "crater"] as const);
  }

  return wetness > 0.5
    ? pick(rng, ["rainforest", "swamp", "savanna", "volcano"] as const)
    : pick(rng, ["desert", "savanna", "badlands", "volcano"] as const);
};

/** One to three wild islands, mostly one or two. */
const rollIslandCount = (rng: TRng) => 1 + (rng() < 0.45 ? 1 : 0) + (rng() < 0.15 ? 1 : 0);

/** The dual: one cell per vertex of the geodesic sphere. */
const buildCells = (rng: TRng): TWorldCell[] => {
  const { vertices, triangles } = geodesicSphere();
  const landNoise = createPerlin(rng);
  const wetNoise = createPerlin(rng);
  const corners: TVec3[][] = vertices.map(() => []);
  const neighbors: Set<number>[] = vertices.map(() => new Set<number>());

  for (const triangle of triangles) {
    const [i0, i1, i2] = triangle;
    const centroid = normalize(add(add(vertices[i0] as TVec3, vertices[i1] as TVec3), vertices[i2] as TVec3));

    for (const vertex of triangle) {
      (corners[vertex] as TVec3[]).push(centroid);

      for (const other of triangle) {
        if (other !== vertex) {
          (neighbors[vertex] as Set<number>).add(other);
        }
      }
    }
  }

  // Land is the top LAND_SHARE of a low-frequency noise, so it clusters.
  const landValue = vertices.map((v) => fbm(landNoise, v[0] * 1.9, v[1] * 1.9, v[2] * 1.9, 4) + (rng() - 0.5) * 0.25);
  const sorted = [...landValue].sort((a, b) => b - a);
  const threshold = sorted[Math.floor(LAND_SHARE * sorted.length)] ?? 0;

  return vertices.map((center, index) => {
    const isLand = (landValue[index] as number) > threshold;
    const wetness = 0.5 + fbm(wetNoise, center[0] * 2.3, center[1] * 2.3, center[2] * 2.3, 3) * 0.5;
    const biome = islandBiome(Math.abs(center[1]), wetness, rng);
    const variant = Math.floor(rng() * CELL_VARIANTS * 6);

    return {
      id: `c${index}`,
      index,
      center,
      polygon: sortAroundCenter(center, corners[index] as TVec3[]),
      neighbors: [...(neighbors[index] as Set<number>)].sort((a, b) => a - b).map((other) => `c${other}`),
      kind: isLand ? "island" : "void",
      variant,
      biome,
      islandCount: isLand ? rollIslandCount(rng) : 0,
      activated: false,
      revealed: false,
      ownerId: null,
      toxicTrail: 0,
      cleared: false,
    };
  });
};

/** Turns a share of the land into settlements, never two side by side. */
const placeSettlements = (cells: TWorldCell[], reserved: ReadonlySet<string>, rng: TRng) => {
  const land = cells.filter((cell) => cell.kind === "island" && !reserved.has(cell.id));
  const target = Math.round(land.length * SETTLEMENT_SHARE);
  const chosen = new Set<string>();
  const pool = [...land];

  while (chosen.size < target && pool.length > 0) {
    const cell = pool.splice(Math.floor(rng() * pool.length), 1)[0] as TWorldCell;
    if (!cell.neighbors.some((id) => chosen.has(id))) {
      chosen.add(cell.id);
    }
  }

  return cells.map((cell) => {
    return chosen.has(cell.id) ? { ...cell, kind: "settlement" as const, islandCount: 0 } : cell;
  });
};

/** Flight counts from one cell to every other one. */
const distancesFrom = (cells: readonly TWorldCell[], startIndex: number) => {
  const distances = new Int32Array(cells.length).fill(-1);
  const queue = [startIndex];
  distances[startIndex] = 0;

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head] as number;
    const cell = cells[current] as TWorldCell;

    for (const neighborId of cell.neighbors) {
      const next = Number(neighborId.slice(1));
      if (distances[next] === -1) {
        distances[next] = (distances[current] as number) + 1;
        queue.push(next);
      }
    }
  }

  return distances;
};

/** Puts the players on cells far enough apart to be worth flying between. */
const placePlayers = (cells: TWorldCell[], playerIds: readonly string[], rng: TRng) => {
  const placed = new Map<string, string>();
  const taken: Int32Array[] = [];

  for (const playerId of playerIds) {
    let cell: TWorldCell | null = null;

    // The spacing relaxes if a crowded sphere cannot honour it.
    for (let spacing = MIN_PLAYER_DISTANCE; spacing >= 1 && !cell; spacing -= 1) {
      const free = cells.filter((candidate) => {
        return candidate.kind === "island" && taken.every((distances) => (distances[candidate.index] as number) >= spacing);
      });

      if (free.length > 0) {
        cell = pick(rng, free);
      }
    }

    const chosen = cell ?? pick(rng, cells);
    taken.push(distancesFrom(cells, chosen.index));
    placed.set(playerId, chosen.id);
  }

  return placed;
};

const createWorld = (seed: string, playerIds: readonly string[]) => {
  const rng = createRng(hashSeed(`${seed}:world`));
  const land = buildCells(rng);
  const placement = placePlayers(land, playerIds, rng);
  const cells = placeSettlements(land, new Set(placement.values()), rng);
  const ownerByCell = new Map([...placement].map(([playerId, cellId]) => [cellId, playerId]));
  const humanCellId = placement.get(playerIds[0] ?? "") ?? cells[0]?.id ?? "c0";
  const humanCell = cells.find((cell) => cell.id === humanCellId);
  const homeRing = new Set([humanCellId, ...(humanCell?.neighbors ?? [])]);

  const world: TWorld = {
    seed,
    cells: cells.map((cell) => {
      const ownerId = ownerByCell.get(cell.id) ?? null;
      // A player knows the cell they sit in and the ring around it. The rest
      // of the sphere waits for scouting.
      const revealed = homeRing.has(cell.id);

      // Every player starts on an island cell that is already theirs: it is
      // home, with no wild islands left to fight.
      if (ownerId) {
        return { ...cell, kind: "island" as const, ownerId, revealed, islandCount: 0, activated: true, cleared: true };
      }

      return { ...cell, ownerId, revealed };
    }),
  };

  return { world, placement };
};

/** Cell ids are `c<index>`, so a lookup is an array read, not a search. */
const getCell = (world: TWorld, cellId: string) => {
  const cell = world.cells[Number(cellId.slice(1))];

  return cell && cell.id === cellId ? cell : world.cells.find((candidate) => candidate.id === cellId) ?? null;
};

export type { TCellKind, TVec3, TWorld, TWorldCell };
export { CELL_VARIANTS, createWorld, distancesFrom, getCell, GRID_FREQUENCY };
