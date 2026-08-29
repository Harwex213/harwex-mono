import { neighbourIndices } from "../hex/coords";
import { mapPixelSize, offsetToPixel } from "../hex/layout";
import { createValueNoise, fractalNoise } from "./noise";
import type { TNoiseField } from "./noise";
import type { TTerrainKind, TTile, TWorld } from "./types";

/**
 * One island, always ringed by water. Height is fractal noise cut down by a
 * radial falloff whose radius is itself warped by noise, so the coast comes out
 * lobed instead of elliptical.
 *
 * Both the coastline and the three land types are placed by rank, not by fixed
 * height thresholds: a fixed threshold makes the island's size and its mix of
 * terrain swing wildly with the seed, and a rank keeps every map playable.
 */
type TIslandParams = {
  width: number;
  height: number;
  seed: number;
};

/** Share of the whole rectangle that ends up above water. */
const LAND_FRACTION = 0.36;
/** Share of the island that becomes mountains, then forest. The rest is meadow. */
const MOUNTAIN_FRACTION = 0.2;
const FOREST_FRACTION = 0.36;

/** Noise cells across the map. Higher means smaller bays and patchier woods. */
const HEIGHT_SCALE = 7.5;
const WARP_SCALE = 2.2;
const FOREST_SCALE = 5.5;

/** Stretches a field to the full `0..1` range, whatever spread the noise had. */
const normalise = (values: Float32Array): void => {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  const span = max - min;
  if (span <= 0) {
    return;
  }

  for (let index = 0; index < values.length; index += 1) {
    values[index] = (values[index]! - min) / span;
  }
};

/** The value that `fraction` of the sorted sample sits below. */
const quantile = (values: readonly number[], fraction: number): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((first, second) => first - second);
  const position = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));

  return sorted[position]!;
};

type TFields = {
  heights: Float32Array;
  forest: Float32Array;
  ridge: Float32Array;
};

const buildFields = (width: number, height: number, noise: TNoiseField): TFields => {
  const total = width * height;
  const heights = new Float32Array(total);
  const forest = new Float32Array(total);
  const ridge = new Float32Array(total);
  /** Full pixel extent, so the falloff sits on the middle of the rectangle. */
  const span = mapPixelSize(width, height, 1);

  for (let index = 0; index < total; index += 1) {
    const position = offsetToPixel(index % width, Math.floor(index / width), 1);
    const x = position.x / span.x - 0.5;
    const y = position.y / span.y - 0.5;

    heights[index] = fractalNoise(noise, x * HEIGHT_SCALE + 11, y * HEIGHT_SCALE + 7, 4);
    forest[index] = fractalNoise(noise, x * FOREST_SCALE + 61, y * FOREST_SCALE + 43, 3);
    ridge[index] = fractalNoise(noise, x * WARP_SCALE + 91, y * WARP_SCALE + 23, 2);
  }

  normalise(heights);
  normalise(forest);
  normalise(ridge);

  for (let index = 0; index < total; index += 1) {
    const col = index % width;
    const row = Math.floor(index / width);
    const position = offsetToPixel(col, row, 1);
    const x = position.x / span.x - 0.5;
    const y = position.y / span.y - 0.5;
    /** The warp pulls the shore in and out, which is what breaks up the ellipse. */
    const radius = Math.sqrt(x * x + y * y) * 2 * (1.22 - 0.32 * ridge[index]!);
    const falloff = Math.max(0, 1 - Math.pow(Math.min(1, radius), 2.4));
    /** The outer ring is always sea, so the island never runs off the map. */
    const onBorder = col === 0 || col === width - 1 || row === 0 || row === height - 1;

    heights[index] = onBorder ? 0 : falloff * (0.18 + 0.82 * heights[index]!);
  }

  return { heights, forest, ridge };
};

/**
 * Keeps only the largest connected patch of land. Noise likes to throw a few
 * one-tile rocks into the sea, and a single island is what the brief asks for.
 */
const keepLargestLandmass = (isLand: Uint8Array, width: number, height: number): void => {
  const total = width * height;
  const patch = new Int32Array(total).fill(-1);
  let bestPatch = -1;
  let bestSize = 0;
  let nextPatch = 0;

  for (let start = 0; start < total; start += 1) {
    if (patch[start] !== -1 || isLand[start] === 0) {
      continue;
    }

    const queue = [start];
    patch[start] = nextPatch;
    let size = 0;

    while (queue.length > 0) {
      const current = queue.pop()!;
      size += 1;
      for (const neighbour of neighbourIndices(current, width, height)) {
        if (patch[neighbour] !== -1 || isLand[neighbour] === 0) {
          continue;
        }
        patch[neighbour] = nextPatch;
        queue.push(neighbour);
      }
    }

    if (size > bestSize) {
      bestSize = size;
      bestPatch = nextPatch;
    }
    nextPatch += 1;
  }

  for (let index = 0; index < total; index += 1) {
    if (isLand[index] === 1 && patch[index] !== bestPatch) {
      isLand[index] = 0;
    }
  }
};

/**
 * Peaks become mountains, and of what is left the wettest tiles become forest.
 * Mixing a ridge field into the peak score keeps the mountains from collapsing
 * into one round blob in the middle of the island.
 */
const assignTerrain = (landIndices: readonly number[], fields: TFields): Map<number, TTerrainKind> => {
  const result = new Map<number, TTerrainKind>();
  const peakScores: number[] = [];

  for (const index of landIndices) {
    peakScores.push(fields.heights[index]! * 0.72 + fields.ridge[index]! * 0.28);
  }

  const mountainCut = quantile(peakScores, 1 - MOUNTAIN_FRACTION);
  const lower: number[] = [];

  for (let position = 0; position < landIndices.length; position += 1) {
    const index = landIndices[position]!;
    if (peakScores[position]! >= mountainCut) {
      result.set(index, "mountains");

      continue;
    }
    lower.push(index);
  }

  const forestShare = lower.length === 0 ? 0 : (FOREST_FRACTION * landIndices.length) / lower.length;
  const forestCut = quantile(
    lower.map((index) => fields.forest[index]!),
    1 - Math.min(1, forestShare)
  );

  for (const index of lower) {
    result.set(index, fields.forest[index]! >= forestCut ? "forest" : "meadow");
  }

  return result;
};

/**
 * The settlement starts on the meadow tile closest to the island's centre of
 * mass, so the player always opens with room to farm and to build houses.
 */
const pickStartIndex = (tiles: readonly TTile[], width: number): number => {
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (const tile of tiles) {
    if (!tile.isLand) {
      continue;
    }
    const position = offsetToPixel(tile.col, tile.row, 1);
    sumX += position.x;
    sumY += position.y;
    count += 1;
  }

  if (count === 0) {
    return 0;
  }

  const centreX = sumX / count;
  const centreY = sumY / count;
  let best = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const tile of tiles) {
    if (tile.terrain !== "meadow") {
      continue;
    }

    const position = offsetToPixel(tile.col, tile.row, 1);
    const dx = position.x - centreX;
    const dy = position.y - centreY;
    const score = dx * dx + dy * dy;
    if (score < bestScore) {
      bestScore = score;
      best = tile.index;
    }
  }

  if (best !== -1) {
    return best;
  }

  return tiles.find((tile) => tile.isLand)?.index ?? width;
};

const generateIsland = (params: TIslandParams): TWorld => {
  const { width, height, seed } = params;
  const total = width * height;
  const noise = createValueNoise(seed);
  const fields = buildFields(width, height, noise);

  const seaLevel = quantile(Array.from(fields.heights), 1 - LAND_FRACTION);
  const isLand = new Uint8Array(total);
  for (let index = 0; index < total; index += 1) {
    isLand[index] = fields.heights[index]! >= seaLevel ? 1 : 0;
  }
  keepLargestLandmass(isLand, width, height);

  const landIndices: number[] = [];
  for (let index = 0; index < total; index += 1) {
    if (isLand[index] === 1) {
      landIndices.push(index);
    }
  }

  const terrainByIndex = assignTerrain(landIndices, fields);
  const tiles: TTile[] = [];

  for (let index = 0; index < total; index += 1) {
    const terrain: TTerrainKind = terrainByIndex.get(index) ?? "water";
    tiles.push({
      index,
      col: index % width,
      row: Math.floor(index / width),
      terrain,
      height: fields.heights[index]!,
      isLand: terrain !== "water",
      isCoast: false,
    });
  }

  for (const tile of tiles) {
    if (!tile.isLand) {
      continue;
    }
    tile.isCoast = neighbourIndices(tile.index, width, height).some((neighbour) => !tiles[neighbour]!.isLand);
  }

  return {
    seed,
    width,
    height,
    seaLevel,
    tiles,
    startIndex: pickStartIndex(tiles, width),
    landCount: landIndices.length,
  };
};

export type { TIslandParams };
export { FOREST_FRACTION, LAND_FRACTION, MOUNTAIN_FRACTION, generateIsland };
