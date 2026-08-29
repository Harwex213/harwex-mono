import { HEX_DIRECTIONS, fillNeighbours, offsetToAxial } from "../hex/coords";
import { createFbm } from "./noise";
import { createRng, hashSeed } from "./rng";
import { classifyTerrain, islandName } from "./terrain";
import { TERRAIN_KINDS, createHexField } from "./types";
import type { TAxial } from "../hex/coords";
import type { TGeneratorParams, THexField, THexMap, TIsland, TTerrainKind } from "./types";

/** Vertical spacing of pointy-top rows relative to column spacing. */
const ROW_SPACING = 1.5 / Math.sqrt(3);

/** Candidates tried per island anchor when spreading the anchors apart. */
const ANCHOR_CANDIDATES = 16;

/**
 * How many already-placed anchors a candidate is measured against. Comparing
 * with all of them makes placement quadratic, and a map can ask for a thousand
 * islands. The most recent handful is enough to keep neighbours apart, which is
 * all the spreading is for.
 */
const ANCHOR_MEMORY = 64;

/**
 * How much of a core is flat top rather than slope. Above 1 the inner part of a
 * core saturates, so the noise — not the distance to the centre — decides what
 * the inside of an island looks like. At 1 every island is a smooth dome and the
 * terrain comes out in concentric rings.
 */
const CORE_PLATEAU = 1.7;

type TCore = {
  q: number;
  r: number;
  radius: number;
};

/** Per-blob tallies kept while flood filling, before small blobs are dropped. */
type TRawIsland = {
  rawId: number;
  size: number;
  sumCol: number;
  sumRow: number;
  minCol: number;
  minRow: number;
  maxCol: number;
  maxRow: number;
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

const cubeDistance = (aQ: number, aR: number, bQ: number, bR: number): number => {
  const dq = aQ - bQ;
  const dr = aR - bR;
  const ds = -dq - dr;

  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
};

const emptyTerrainCounts = (): Record<TTerrainKind, number> => {
  const counts = {} as Record<TTerrainKind, number>;

  for (const kind of TERRAIN_KINDS) {
    counts[kind] = 0;
  }

  return counts;
};

/**
 * A step of length `distance` in a random direction, in axial coordinates. The
 * six unit directions are blended pairwise, so the step can point anywhere on
 * the ring rather than only at the six corners.
 */
const randomStep = (rng: () => number, distance: number): TAxial => {
  const index = Math.floor(rng() * 6) % 6;
  const from = HEX_DIRECTIONS[index]!;
  const to = HEX_DIRECTIONS[(index + 1) % 6]!;
  const blend = rng();

  return {
    q: Math.round(distance * (from.q * (1 - blend) + to.q * blend)),
    r: Math.round(distance * (from.r * (1 - blend) + to.r * blend)),
  };
};

/**
 * Grows one island out of `lobes` overlapping blobs: the first sits on the
 * anchor, each next one steps a short way off the previous. A single blob always
 * comes out as a circle no matter how the noise is tuned; a chain of them gives
 * the bays and peninsulas that make a shape read as an island.
 */
const growLobes = (
  anchor: TAxial,
  radius: number,
  params: TGeneratorParams,
  rng: () => number,
  cores: TCore[]
): void => {
  let current = { q: anchor.q, r: anchor.r };
  cores.push({ q: current.q, r: current.r, radius });

  for (let lobe = 1; lobe < params.lobes; lobe += 1) {
    const step = randomStep(rng, radius * (0.45 + 0.35 * rng()));
    current = { q: current.q + step.q, r: current.r + step.r };
    cores.push({ q: current.q, r: current.r, radius: radius * (0.5 + 0.4 * rng()) });
  }
};

/**
 * Drops `islandCount` island anchors inside the map, keeping them apart: each
 * anchor is the best of several random candidates, "best" meaning farthest from
 * the anchors already placed. Without this two anchors land on top of each other
 * and the map ends up with one blob instead of an archipelago.
 */
const placeCores = (params: TGeneratorParams, rng: () => number): TCore[] => {
  const margin = params.edgeMargin + 1;
  const minCol = margin;
  const maxCol = Math.max(margin, params.width - 1 - margin);
  const minRow = margin;
  const maxRow = Math.max(margin, params.height - 1 - margin);
  const anchors: TAxial[] = [];
  const cores: TCore[] = [];

  for (let placed = 0; placed < params.islandCount; placed += 1) {
    let bestAxial = offsetToAxial(minCol, minRow);
    let bestScore = -1;
    const recallFrom = Math.max(0, anchors.length - ANCHOR_MEMORY);

    for (let candidate = 0; candidate < ANCHOR_CANDIDATES; candidate += 1) {
      const col = Math.round(minCol + rng() * (maxCol - minCol));
      const row = Math.round(minRow + rng() * (maxRow - minRow));
      const axial = offsetToAxial(col, row);

      let score = Number.POSITIVE_INFINITY;
      for (let other = recallFrom; other < anchors.length; other += 1) {
        const anchor = anchors[other]!;
        score = Math.min(score, cubeDistance(axial.q, axial.r, anchor.q, anchor.r));
      }

      if (score > bestScore) {
        bestScore = score;
        bestAxial = axial;
      }
    }

    anchors.push(bestAxial);
    const jitter = 1 + params.islandRadiusJitter * (rng() * 2 - 1);
    growLobes(bestAxial, Math.max(1, params.islandRadius * jitter), params, rng, cores);
  }

  return cores;
};

/** Scales height down near the map border, so no island is cut off by the edge. */
const edgeFactor = (col: number, row: number, params: TGeneratorParams): number => {
  if (params.edgeMargin <= 0) {
    return 1;
  }

  const distance = Math.min(col, row, params.width - 1 - col, params.height - 1 - row);
  if (distance >= params.edgeMargin) {
    return 1;
  }

  return smoothstep(clamp01(distance / params.edgeMargin));
};

/**
 * Cores are looked up per hex, and a 400x400 map with a thousand islands would
 * otherwise test every hex against every core. Each core is registered in the
 * square buckets it can reach, so a hex only tests the handful that are near it.
 */
type TCoreGrid = {
  bucketSize: number;
  columns: number;
  rows: number;
  buckets: number[][];
};

const buildCoreGrid = (cores: TCore[], params: TGeneratorParams): TCoreGrid => {
  const bucketSize = 16;
  const columns = Math.ceil(params.width / bucketSize);
  const rows = Math.ceil(params.height / bucketSize);
  const buckets: number[][] = Array.from({ length: columns * rows }, () => []);

  for (let index = 0; index < cores.length; index += 1) {
    const core = cores[index]!;
    // Axial back to offset, so the core can be measured in map columns and rows.
    const centreRow = core.r;
    const centreCol = core.q + (core.r - (core.r & 1)) / 2;
    const reach = Math.ceil(core.radius) + 1;
    const fromColumn = Math.max(0, Math.floor((centreCol - reach) / bucketSize));
    const toColumn = Math.min(columns - 1, Math.floor((centreCol + reach) / bucketSize));
    const fromRow = Math.max(0, Math.floor((centreRow - reach) / bucketSize));
    const toRow = Math.min(rows - 1, Math.floor((centreRow + reach) / bucketSize));

    for (let row = fromRow; row <= toRow; row += 1) {
      for (let column = fromColumn; column <= toColumn; column += 1) {
        buckets[row * columns + column]!.push(index);
      }
    }
  }

  return { bucketSize, columns, rows, buckets };
};

const generateHexMap = (params: TGeneratorParams): THexMap => {
  const startedAt = performance.now();
  const { width, height } = params;
  const total = width * height;
  const cells = createHexField(total);
  const rng = createRng(hashSeed(params.seed));
  const elevationNoise = createFbm(rng, Math.round(params.octaves), params.persistence);
  const moistureNoise = createFbm(rng, 3, 0.5);
  const cores = placeCores(params, rng);
  const grid = buildCoreGrid(cores, params);

  let maxHeight = 0;

  for (let row = 0; row < height; row += 1) {
    const bucketRow = Math.floor(row / grid.bucketSize) * grid.columns;
    const rowOffset = 0.5 * (row & 1);
    const noiseY = row * ROW_SPACING * params.noiseScale;
    const moistureY = row * ROW_SPACING * params.moistureScale;

    for (let col = 0; col < width; col += 1) {
      const index = row * width + col;
      const axialQ = col - (row - (row & 1)) / 2;
      const bucket = grid.buckets[bucketRow + Math.floor(col / grid.bucketSize)]!;

      let mask = 0;
      for (let entry = 0; entry < bucket.length; entry += 1) {
        const core = cores[bucket[entry]!]!;
        const reach = 1 - cubeDistance(axialQ, row, core.q, core.r) / core.radius;
        if (reach <= 0) {
          continue;
        }
        const falloff = smoothstep(Math.min(1, reach * CORE_PLATEAU));
        if (falloff > mask) {
          mask = falloff;
        }
      }

      let cellHeight = 0;
      if (mask > 0) {
        const roughness =
          1 - params.coastRoughness + 2 * params.coastRoughness * elevationNoise((col + rowOffset) * params.noiseScale, noiseY);
        cellHeight = mask * roughness * edgeFactor(col, row, params);
        if (cellHeight > maxHeight) {
          maxHeight = cellHeight;
        }
      }

      cells.height[index] = cellHeight;
      cells.moisture[index] = moistureNoise((col + rowOffset) * params.moistureScale, moistureY);
      cells.isLand[index] = cellHeight > params.seaLevel ? 1 : 0;
      cells.islandId[index] = -1;
    }
  }

  const raw = labelIslands(cells, params);
  const islands = keepLargeIslands(cells, params, raw);
  measureCoastDistance(cells, params);

  const elevationSpan = Math.max(0.0001, maxHeight - params.seaLevel);
  let landCount = 0;

  for (let index = 0; index < total; index += 1) {
    const isLand = cells.isLand[index] === 1;
    const cellHeight = cells.height[index]!;
    const elevation = isLand ? clamp01((cellHeight - params.seaLevel) / elevationSpan) : 0;
    const coastDistance = cells.coastDistance[index]!;
    const terrain = classifyTerrain({
      height: cellHeight,
      seaLevel: params.seaLevel,
      elevation,
      moisture: cells.moisture[index]!,
      coastDistance,
      isLand,
    });

    cells.elevation[index] = elevation;
    cells.terrain[index] = terrain;

    if (!isLand) {
      continue;
    }

    landCount += 1;
    const island = islands[cells.islandId[index]!];
    if (!island) {
      continue;
    }
    island.terrainCounts[TERRAIN_KINDS[terrain]!] += 1;
    island.peakElevation = Math.max(island.peakElevation, elevation);
  }

  return {
    width,
    height,
    params,
    cells,
    islands,
    landCount,
    waterCount: total - landCount,
    discardedIslands: raw.length - islands.length,
    generationMs: performance.now() - startedAt,
  };
};

/**
 * Labels every connected land blob with a raw id and tallies its extent. Nothing
 * is dropped yet: `keepLargeIslands` decides which blobs survive.
 */
const labelIslands = (cells: THexField, params: TGeneratorParams): TRawIsland[] => {
  const { width, height } = params;
  const total = width * height;
  const raw: TRawIsland[] = [];
  const stack = new Int32Array(total);
  const neighbours = new Int32Array(6);

  for (let start = 0; start < total; start += 1) {
    if (cells.isLand[start] !== 1 || cells.islandId[start] !== -1) {
      continue;
    }

    const rawId = raw.length;
    const startCol = start % width;
    const startRow = (start - startCol) / width;
    const blob: TRawIsland = {
      rawId,
      size: 0,
      sumCol: 0,
      sumRow: 0,
      minCol: startCol,
      minRow: startRow,
      maxCol: startCol,
      maxRow: startRow,
    };

    let top = 0;
    stack[top] = start;
    top += 1;
    cells.islandId[start] = rawId;

    while (top > 0) {
      top -= 1;
      const index = stack[top]!;
      const col = index % width;
      const row = (index - col) / width;

      blob.size += 1;
      blob.sumCol += col;
      blob.sumRow += row;
      if (col < blob.minCol) {
        blob.minCol = col;
      }
      if (col > blob.maxCol) {
        blob.maxCol = col;
      }
      if (row < blob.minRow) {
        blob.minRow = row;
      }
      if (row > blob.maxRow) {
        blob.maxRow = row;
      }

      const found = fillNeighbours(index, width, height, neighbours);
      for (let entry = 0; entry < found; entry += 1) {
        const neighbour = neighbours[entry]!;
        if (cells.isLand[neighbour] !== 1 || cells.islandId[neighbour] !== -1) {
          continue;
        }
        cells.islandId[neighbour] = rawId;
        stack[top] = neighbour;
        top += 1;
      }
    }

    raw.push(blob);
  }

  return raw;
};

/**
 * Floods blobs under `minIslandSize` back to water, sorts the survivors biggest
 * first and renumbers the map to match. A lone hex left over by the noise is not
 * an island, and the list on screen reads top-down.
 */
const keepLargeIslands = (
  cells: THexField,
  params: TGeneratorParams,
  raw: TRawIsland[]
): TIsland[] => {
  const survivors = raw.filter((blob) => blob.size >= params.minIslandSize).sort((a, b) => b.size - a.size);
  const remap = new Int32Array(raw.length).fill(-1);
  const islands: TIsland[] = survivors.map((blob, id) => {
    remap[blob.rawId] = id;

    return {
      id,
      name: islandName(id),
      size: blob.size,
      centreCol: Math.round(blob.sumCol / blob.size),
      centreRow: Math.round(blob.sumRow / blob.size),
      minCol: blob.minCol,
      minRow: blob.minRow,
      maxCol: blob.maxCol,
      maxRow: blob.maxRow,
      peakElevation: 0,
      terrainCounts: emptyTerrainCounts(),
    };
  });

  for (let index = 0; index < cells.islandId.length; index += 1) {
    const rawId = cells.islandId[index]!;
    if (rawId === -1) {
      continue;
    }

    const id = remap[rawId]!;
    cells.islandId[index] = id;
    if (id === -1) {
      cells.isLand[index] = 0;
    }
  }

  return islands;
};

/** Multi-source breadth-first search out of the water, one step per land ring. */
const measureCoastDistance = (cells: THexField, params: TGeneratorParams): void => {
  const { width, height } = params;
  const total = width * height;
  const queue = new Int32Array(total);
  const neighbours = new Int32Array(6);
  let tail = 0;

  for (let index = 0; index < total; index += 1) {
    if (cells.isLand[index] === 1) {
      // Zero doubles as "not visited yet", so land starts at the sentinel.
      cells.coastDistance[index] = 65535;

      continue;
    }
    cells.coastDistance[index] = 0;
    queue[tail] = index;
    tail += 1;
  }

  for (let head = 0; head < tail; head += 1) {
    const index = queue[head]!;
    const next = cells.coastDistance[index]! + 1;
    const found = fillNeighbours(index, width, height, neighbours);

    for (let entry = 0; entry < found; entry += 1) {
      const neighbour = neighbours[entry]!;
      if (cells.coastDistance[neighbour] !== 65535) {
        continue;
      }
      cells.coastDistance[neighbour] = next;
      queue[tail] = neighbour;
      tail += 1;
    }
  }

  // A map with no water at all leaves every land hex unvisited.
  for (let index = 0; index < total; index += 1) {
    if (cells.coastDistance[index] === 65535) {
      cells.coastDistance[index] = 1;
    }
  }
};

export { generateHexMap };
