import { BIOME_ORDER } from "./biomes";
import { createRng } from "./rng";

import type { TWorldCell } from "./types";

/**
 * The global map: the Goldberg dual of an icosahedron subdivided at frequency 3.
 * The geodesic sphere has 10 * 3^2 + 2 = 92 vertices, so the dual has exactly
 * 92 cells — 12 pentagons on the icosahedron corners and 80 hexagons (plan §3.7).
 */

type TVector3 = readonly [number, number, number];

/** Subdivisions per icosahedron edge. Three gives the 92 cells the plan asks for. */
const SUBDIVISION_FREQUENCY = 3;

const WORLD_CELL_COUNT = 92;
const PENTAGON_CELL_COUNT = 12;

/** The island starts here; this cell and its neighbours begin revealed. */
const WORLD_START_CELL_ID = 0;

const WORLD_START_OCCUPANT_ID = "p1";

/** Coordinates are deduplicated at this many decimals; the nearest two vertices are 0.3 apart. */
const VERTEX_KEY_DECIMALS = 6;

const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;

const ICOSAHEDRON_VERTICES: readonly TVector3[] = [
  [-1, GOLDEN_RATIO, 0],
  [1, GOLDEN_RATIO, 0],
  [-1, -GOLDEN_RATIO, 0],
  [1, -GOLDEN_RATIO, 0],
  [0, -1, GOLDEN_RATIO],
  [0, 1, GOLDEN_RATIO],
  [0, -1, -GOLDEN_RATIO],
  [0, 1, -GOLDEN_RATIO],
  [GOLDEN_RATIO, 0, -1],
  [GOLDEN_RATIO, 0, 1],
  [-GOLDEN_RATIO, 0, -1],
  [-GOLDEN_RATIO, 0, 1],
];

/** Every face wound counter-clockwise seen from outside. */
const ICOSAHEDRON_FACES: readonly (readonly [number, number, number])[] = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

const normalise = (vector: TVector3): TVector3 => {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length === 0) {
    return [0, 0, 0];
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
};

const vertexKey = (vector: TVector3): string => {
  const x = vector[0].toFixed(VERTEX_KEY_DECIMALS);
  const y = vector[1].toFixed(VERTEX_KEY_DECIMALS);
  const z = vector[2].toFixed(VERTEX_KEY_DECIMALS);
  return `${x},${y},${z}`;
};

const cross = (a: TVector3, b: TVector3): TVector3 => {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
};

const dot = (a: TVector3, b: TVector3): number => {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
};

type TGeodesicSphere = {
  readonly vertices: readonly TVector3[];
  readonly triangles: readonly (readonly [number, number, number])[];
};

/** The icosahedron with every face cut into `frequency^2` triangles, projected onto the unit sphere. */
const buildGeodesicSphere = (frequency: number): TGeodesicSphere => {
  const vertices: TVector3[] = [];
  const indexByKey = new Map<string, number>();
  const triangles: (readonly [number, number, number])[] = [];
  const indexOf = (vector: TVector3): number => {
    const unit = normalise(vector);
    const key = vertexKey(unit);
    const known = indexByKey.get(key);
    if (known !== undefined) {
      return known;
    }
    const index = vertices.length;
    vertices.push(unit);
    indexByKey.set(key, index);
    return index;
  };
  for (const face of ICOSAHEDRON_FACES) {
    const cornerA = ICOSAHEDRON_VERTICES[face[0]];
    const cornerB = ICOSAHEDRON_VERTICES[face[1]];
    const cornerC = ICOSAHEDRON_VERTICES[face[2]];
    if (cornerA === undefined || cornerB === undefined || cornerC === undefined) {
      continue;
    }
    const latticePoint = (i: number, j: number): TVector3 => {
      const k = frequency - i - j;
      return [
        (cornerA[0] * k + cornerB[0] * i + cornerC[0] * j) / frequency,
        (cornerA[1] * k + cornerB[1] * i + cornerC[1] * j) / frequency,
        (cornerA[2] * k + cornerB[2] * i + cornerC[2] * j) / frequency,
      ];
    };
    for (let i = 0; i < frequency; i += 1) {
      for (let j = 0; j < frequency - i; j += 1) {
        const bottomLeft = indexOf(latticePoint(i, j));
        const bottomRight = indexOf(latticePoint(i + 1, j));
        const topLeft = indexOf(latticePoint(i, j + 1));
        triangles.push([bottomLeft, bottomRight, topLeft]);
        if (i + j < frequency - 1) {
          const topRight = indexOf(latticePoint(i + 1, j + 1));
          triangles.push([bottomRight, topRight, topLeft]);
        }
      }
    }
  }
  return { vertices, triangles };
};

const centroidOf = (sphere: TGeodesicSphere, triangle: readonly [number, number, number]): TVector3 => {
  const a = sphere.vertices[triangle[0]];
  const b = sphere.vertices[triangle[1]];
  const c = sphere.vertices[triangle[2]];
  if (a === undefined || b === undefined || c === undefined) {
    return [0, 0, 0];
  }
  return normalise([
    (a[0] + b[0] + c[0]) / 3,
    (a[1] + b[1] + c[1]) / 3,
    (a[2] + b[2] + c[2]) / 3,
  ]);
};

/** Sorts points around `centre` counter-clockwise as seen from outside the sphere. */
const sortAroundCentre = <T,>(
  centre: TVector3,
  items: readonly T[],
  positionOf: (item: T) => TVector3,
): readonly T[] => {
  const reference = Math.abs(centre[0]) < 0.5 ? ([1, 0, 0] as TVector3) : ([0, 1, 0] as TVector3);
  const tangentX = normalise(cross(centre, reference));
  const tangentY = cross(centre, tangentX);
  const withAngle = items.map((item) => {
    const position = positionOf(item);
    const offset: TVector3 = [
      position[0] - centre[0],
      position[1] - centre[1],
      position[2] - centre[2],
    ];
    return { item, angle: Math.atan2(dot(offset, tangentY), dot(offset, tangentX)) };
  });
  withAngle.sort((left, right) => {
    return left.angle - right.angle;
  });
  return withAngle.map((entry) => {
    return entry.item;
  });
};

const createWorld = (seed: number): readonly TWorldCell[] => {
  const rng = createRng(seed);
  const sphere = buildGeodesicSphere(SUBDIVISION_FREQUENCY);
  const incidentTriangles: number[][] = sphere.vertices.map(() => {
    return [];
  });
  const neighbourSets: Set<number>[] = sphere.vertices.map(() => {
    return new Set<number>();
  });
  sphere.triangles.forEach((triangle, triangleIndex) => {
    for (const vertexIndex of triangle) {
      incidentTriangles[vertexIndex]?.push(triangleIndex);
      for (const other of triangle) {
        if (other !== vertexIndex) {
          neighbourSets[vertexIndex]?.add(other);
        }
      }
    }
  });
  const startNeighbours = neighbourSets[WORLD_START_CELL_ID];
  return sphere.vertices.map((centre, index) => {
    const triangleIndices = incidentTriangles[index] ?? [];
    const corners = sortAroundCentre(centre, triangleIndices, (triangleIndex) => {
      const triangle = sphere.triangles[triangleIndex];
      if (triangle === undefined) {
        return centre;
      }
      return centroidOf(sphere, triangle);
    }).map((triangleIndex) => {
      const triangle = sphere.triangles[triangleIndex];
      if (triangle === undefined) {
        return centre;
      }
      return centroidOf(sphere, triangle);
    });
    const neighbours = sortAroundCentre(
      centre,
      [...(neighbourSets[index] ?? new Set<number>())],
      (neighbourIndex) => {
        return sphere.vertices[neighbourIndex] ?? centre;
      },
    );
    const isStart = index === WORLD_START_CELL_ID;
    const revealed = isStart === true || startNeighbours?.has(index) === true;
    return {
      id: index,
      centre,
      corners,
      neighbours,
      revealed,
      biomeHint: rng.pick(BIOME_ORDER),
      trail: 0,
      occupantId: isStart === true ? WORLD_START_OCCUPANT_ID : null,
    };
  });
};

const replaceCell = (
  cells: readonly TWorldCell[],
  cellId: number,
  patch: Partial<TWorldCell>,
): readonly TWorldCell[] => {
  return cells.map((cell) => {
    if (cell.id !== cellId) {
      return cell;
    }
    return { ...cell, ...patch };
  });
};

const revealCell = (cells: readonly TWorldCell[], cellId: number): readonly TWorldCell[] => {
  return replaceCell(cells, cellId, { revealed: true });
};

const moveOccupant = (
  cells: readonly TWorldCell[],
  fromId: number,
  toId: number,
  occupantId: string,
): readonly TWorldCell[] => {
  return cells.map((cell) => {
    if (cell.id === fromId && cell.occupantId === occupantId) {
      return { ...cell, occupantId: null };
    }
    if (cell.id === toId) {
      return { ...cell, occupantId };
    }
    return cell;
  });
};

const addTrail = (cells: readonly TWorldCell[], cellId: number, delta: number): readonly TWorldCell[] => {
  const cell = cells.find((candidate) => {
    return candidate.id === cellId;
  });
  if (cell === undefined) {
    return cells;
  }
  return replaceCell(cells, cellId, { trail: Math.max(0, cell.trail + delta) });
};

export {
  PENTAGON_CELL_COUNT,
  WORLD_CELL_COUNT,
  WORLD_START_CELL_ID,
  addTrail,
  createWorld,
  moveOccupant,
  revealCell,
};
