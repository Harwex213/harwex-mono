import { BIOMES } from "./biomes";
import { createRng, hashSeed, pick, randomInt } from "./rng";
import type { TRng } from "./rng";
import type { TBiomeId } from "./types";

/**
 * The global map is a sphere of hexes: the dual of a subdivided icosahedron,
 * which gives 30 hexagons and the 12 pentagons a sphere cannot avoid. Cells
 * carry unit-length coordinates; the globe component scales them.
 */

/** One subdivision of the icosahedron, which yields 42 cells. */
const SUBDIVISIONS = 1;
/** Coordinates are rounded to this many places before deduplication. */
const WELD_PRECISION = 5;
const MAX_ISLANDS_PER_CELL = 4;

type TVec3 = readonly [number, number, number];

type TWorldCell = {
  readonly id: string;
  readonly center: TVec3;
  /** The cell's outline on the unit sphere, wound counter-clockwise. */
  readonly polygon: readonly TVec3[];
  readonly neighbors: readonly string[];
  /** Roughly what the islands here are made of: the scouting hint. */
  readonly biome: TBiomeId;
  readonly islandCount: number;
  readonly revealed: boolean;
  /** The player whose island sits in this cell, if any. */
  readonly ownerId: string | null;
  /** Toxicity left behind here. It never falls, as the spec insists. */
  readonly toxicTrail: number;
  /** True once the clearing phase has emptied this cell of enemies. */
  readonly cleared: boolean;
};

type TWorld = {
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

const keyOf = (v: TVec3) => v.map((n) => n.toFixed(WELD_PRECISION)).join(",");

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

/** Splits every icosahedron face into 4^n triangles on the sphere. */
const subdividedTriangles = (): TVec3[][] => {
  const corners = icosahedronVertices();
  const triangles: TVec3[][] = [];
  const steps = Math.pow(2, SUBDIVISIONS);

  for (const face of ICOSAHEDRON_FACES) {
    const [a, b, c] = [corners[face[0]], corners[face[1]], corners[face[2]]];
    if (!a || !b || !c) {
      continue;
    }

    const grid: TVec3[][] = [];
    for (let row = 0; row <= steps; row += 1) {
      const line: TVec3[] = [];
      for (let column = 0; column <= steps - row; column += 1) {
        const weightA = (steps - row - column) / steps;
        const weightB = column / steps;
        const weightC = row / steps;
        line.push(normalize(add(add(scale(a, weightA), scale(b, weightB)), scale(c, weightC))));
      }

      grid.push(line);
    }

    for (let row = 0; row < steps; row += 1) {
      const line = grid[row];
      const nextLine = grid[row + 1];
      if (!line || !nextLine) {
        continue;
      }

      for (let column = 0; column < line.length - 1; column += 1) {
        const p0 = line[column];
        const p1 = line[column + 1];
        const p2 = nextLine[column];
        if (p0 && p1 && p2) {
          triangles.push([p0, p1, p2]);
        }

        const p3 = nextLine[column + 1];
        if (p1 && p3 && p2) {
          triangles.push([p1, p3, p2]);
        }
      }
    }
  }

  return triangles;
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

/** The dual: one cell per vertex of the subdivided sphere. */
const buildCells = (rng: TRng): TWorldCell[] => {
  const triangles = subdividedTriangles();
  const cornersByVertex = new Map<string, TVec3[]>();
  const centerByVertex = new Map<string, TVec3>();
  const neighborsByVertex = new Map<string, Set<string>>();

  for (const triangle of triangles) {
    const centroid = normalize(add(add(triangle[0] as TVec3, triangle[1] as TVec3), triangle[2] as TVec3));

    for (const vertex of triangle) {
      const key = keyOf(vertex);
      centerByVertex.set(key, vertex);

      const corners = cornersByVertex.get(key) ?? [];
      corners.push(centroid);
      cornersByVertex.set(key, corners);

      const neighbors = neighborsByVertex.get(key) ?? new Set<string>();
      for (const other of triangle) {
        const otherKey = keyOf(other);
        if (otherKey !== key) {
          neighbors.add(otherKey);
        }
      }

      neighborsByVertex.set(key, neighbors);
    }
  }

  const keys = [...centerByVertex.keys()].sort();
  const idByKey = new Map(keys.map((key, index) => [key, `c${index}`]));

  return keys.map((key) => {
    const center = centerByVertex.get(key) as TVec3;
    const corners = cornersByVertex.get(key) ?? [];
    const biome = pick(rng, BIOMES);

    return {
      id: idByKey.get(key) as string,
      center,
      polygon: sortAroundCenter(center, corners),
      neighbors: [...(neighborsByVertex.get(key) ?? [])].map((other) => idByKey.get(other) as string),
      biome: biome.id,
      islandCount: randomInt(rng, 1, MAX_ISLANDS_PER_CELL),
      revealed: false,
      ownerId: null,
      toxicTrail: 0,
      cleared: false,
    };
  });
};

/** Puts the players on cells far enough apart to be worth flying between. */
const placePlayers = (cells: TWorldCell[], playerIds: readonly string[], rng: TRng) => {
  const taken = new Set<string>();
  const placed = new Map<string, string>();

  for (const playerId of playerIds) {
    const free = cells.filter((cell) => {
      return !taken.has(cell.id) && cell.neighbors.every((neighbor) => !taken.has(neighbor));
    });

    const cell = free.length > 0 ? pick(rng, free) : pick(rng, cells.filter((c) => !taken.has(c.id)));
    taken.add(cell.id);
    placed.set(playerId, cell.id);
  }

  return placed;
};

const createWorld = (seed: string, playerIds: readonly string[]) => {
  const rng = createRng(hashSeed(`${seed}:world`));
  const cells = buildCells(rng);
  const placement = placePlayers(cells, playerIds, rng);
  const ownerByCell = new Map([...placement].map(([playerId, cellId]) => [cellId, playerId]));
  const humanCellId = placement.get(playerIds[0] ?? "") ?? cells[0]?.id ?? "c0";

  const world: TWorld = {
    cells: cells.map((cell) => {
      const ownerId = ownerByCell.get(cell.id) ?? null;
      // A player sees the cell they sit in, and nothing else until they scout.
      const revealed = cell.id === humanCellId;

      // A cell keeps its islands even with a player over it: those islands are
      // what the clearing phase is for.
      return { ...cell, ownerId, revealed };
    }),
  };

  return { world, placement };
};

const getCell = (world: TWorld, cellId: string) => {
  return world.cells.find((cell) => cell.id === cellId) ?? null;
};

export type { TVec3, TWorld, TWorldCell };
export { createWorld, getCell };
