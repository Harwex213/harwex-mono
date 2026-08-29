import { createGrid, gridCentre } from "../hex/grid";
import { hexDistance, hexKey, neighboursOf } from "@hw/ostrov-utils";
import { TERRAIN_LIST } from "./terrain";
import { createRng, hashSeed } from "@hw/ostrov-utils";
import { resolveIslandConfig } from "./config";
import type { TAxial } from "@hw/ostrov-utils";
import type { TIslandOptions, TTerrainWeights } from "./config";
import { Island } from "./island";
import type { TRng } from "@hw/ostrov-utils";
import type { TTerrain } from "./terrain";

/**
 * Weight of the pull towards the middle of the board when the height field is
 * built. High keeps the island round and compact, low lets the noise win.
 */
const CENTRE_PULL = 0.45;

/** Passes of neighbour averaging. Raw per-cell noise is far too speckled. */
const SMOOTH_PASSES = 2;

/** Extra moisture for a land tile that touches water. */
const SHORE_MOISTURE = 0.15;

/** Share of height in the mountain ranking; the rest is distance from the water. */
const PEAK_HEIGHT_WEIGHT = 0.55;

const NAME_HEADS = ["Ост", "Кар", "Тир", "Мор", "Вел", "Син", "Зол", "Хмур", "Сол", "Бур", "Тих", "Дал"];
const NAME_TAILS = ["ров", "мыс", "тан", "град", "холм", "берг", "фьорд", "дол", "риф", "шхер", "вал", "гар"];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Per-cell random values, averaged with their neighbours and rescaled to 0..1. */
const createNoiseField = (grid: readonly TAxial[], rng: TRng) => {
  let field = new Map<string, number>();

  for (const cell of grid) {
    field.set(hexKey(cell.q, cell.r), rng.next());
  }

  for (let pass = 0; pass < SMOOTH_PASSES; pass += 1) {
    const smoothed = new Map<string, number>();

    for (const cell of grid) {
      const key = hexKey(cell.q, cell.r);
      // The cell itself weighs double, so smoothing blurs the field without
      // flattening every cell into the board average.
      let total = field.get(key)! * 2;
      let weight = 2;

      for (const neighbour of neighboursOf(cell)) {
        const value = field.get(hexKey(neighbour.q, neighbour.r));
        if (value === undefined) {
          continue;
        }

        total += value;
        weight += 1;
      }

      smoothed.set(key, total / weight);
    }

    field = smoothed;
  }

  const values = [...field.values()];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  for (const [key, value] of field) {
    field.set(key, (value - min) / span);
  }

  return field;
};

/** Height above sea, highest in the middle of the board and lowest at its rim. */
const createElevationField = (grid: readonly TAxial[], rng: TRng) => {
  const noise = createNoiseField(grid, rng);
  const centre = gridCentre();
  const maxDistance = Math.max(...grid.map((cell) => hexDistance(cell, centre)));
  const elevation = new Map<string, number>();

  for (const cell of grid) {
    const key = hexKey(cell.q, cell.r);
    // `+ 0.6` keeps the rim above zero, so a lucky rim cell can still be land.
    const pull = 1 - hexDistance(cell, centre) / (maxDistance + 0.6);

    elevation.set(key, noise.get(key)! * (1 - CENTRE_PULL) + pull * CENTRE_PULL);
  }

  return elevation;
};

/** Cells of the largest group of land that is reachable without crossing water. */
const largestCluster = (candidates: Set<string>, byKey: Map<string, TAxial>) => {
  const seen = new Set<string>();
  let best = new Set<string>();

  for (const start of candidates) {
    if (seen.has(start)) {
      continue;
    }

    const cluster = new Set<string>([start]);
    const queue = [start];
    seen.add(start);

    while (queue.length > 0) {
      const key = queue.shift()!;

      for (const neighbour of neighboursOf(byKey.get(key)!)) {
        const neighbourKey = hexKey(neighbour.q, neighbour.r);
        if (!candidates.has(neighbourKey) || cluster.has(neighbourKey)) {
          continue;
        }

        cluster.add(neighbourKey);
        seen.add(neighbourKey);
        queue.push(neighbourKey);
      }
    }

    if (cluster.size > best.size) {
      best = cluster;
    }
  }

  return best;
};

/**
 * Picks the land. The tallest cells win, but only one landmass survives: the
 * rest of the board goes back to the sea, and the winner grows back to size by
 * swallowing the tallest cell next to it.
 */
const pickLand = (byKey: Map<string, TAxial>, elevation: Map<string, number>, landCount: number) => {
  const ranked = [...byKey.keys()].sort((a, b) => elevation.get(b)! - elevation.get(a)!);
  const targetSize = clamp(Math.round(landCount), 1, byKey.size);
  const candidates = new Set(ranked.slice(0, targetSize));
  const land = largestCluster(candidates, byKey);

  while (land.size < targetSize) {
    let bestKey: string | null = null;

    for (const key of land) {
      for (const neighbour of neighboursOf(byKey.get(key)!)) {
        const neighbourKey = hexKey(neighbour.q, neighbour.r);
        if (!byKey.has(neighbourKey) || land.has(neighbourKey)) {
          continue;
        }

        if (bestKey === null || elevation.get(neighbourKey)! > elevation.get(bestKey)!) {
          bestKey = neighbourKey;
        }
      }
    }

    if (bestKey === null) {
      break;
    }

    land.add(bestKey);
  }

  return land;
};

/**
 * Steps from the nearest water: 1 on the shore, and one more for every ring
 * further in. Mountains are placed by this rather than by height alone, so a
 * tall cliff on the beach stays a beach.
 */
const inlandDepth = (byKey: Map<string, TAxial>, land: Set<string>) => {
  const depth = new Map<string, number>();
  const queue: string[] = [];

  for (const key of land) {
    const onShore = neighboursOf(byKey.get(key)!).some((neighbour) => !land.has(hexKey(neighbour.q, neighbour.r)));
    if (onShore) {
      depth.set(key, 1);
      queue.push(key);
    }
  }

  while (queue.length > 0) {
    const key = queue.shift()!;

    for (const neighbour of neighboursOf(byKey.get(key)!)) {
      const neighbourKey = hexKey(neighbour.q, neighbour.r);
      if (!land.has(neighbourKey) || depth.has(neighbourKey)) {
        continue;
      }

      depth.set(neighbourKey, depth.get(key)! + 1);
      queue.push(neighbourKey);
    }
  }

  return depth;
};

/**
 * Turns the weights into a tile count each. The parts are handed out largest
 * remainder first, so they add up to exactly `total` however the sliders stand.
 * All-zero weights would divide by zero, so they are read as an even split.
 */
const allocate = (weights: TTerrainWeights, total: number): TTerrainWeights => {
  const asked = TERRAIN_LIST.map((terrain) => ({ terrain, weight: Math.max(0, weights[terrain]) }));
  const sum = asked.reduce((accumulator, entry) => accumulator + entry.weight, 0);
  const shares = sum > 0 ? asked : asked.map((entry) => ({ ...entry, weight: 1 }));
  const divisor = sum > 0 ? sum : shares.length;

  const parts = shares.map((entry) => {
    const exact = (entry.weight / divisor) * total;

    return { terrain: entry.terrain, count: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });

  let left = total - parts.reduce((accumulator, part) => accumulator + part.count, 0);

  for (const part of [...parts].sort((a, b) => b.remainder - a.remainder)) {
    if (left <= 0) {
      break;
    }

    part.count += 1;
    left -= 1;
  }

  return parts.reduce((counts, part) => {
    counts[part.terrain] = part.count;

    return counts;
  }, {} as TTerrainWeights);
};

/**
 * Ranks the land twice. Height and distance from the water pick the mountains,
 * and the tiles just below them in that ranking become the hills, which puts the
 * hills in a ring around the peaks. Whatever is left is lowland, and it is split
 * by moisture: wettest to forest, then meadows, and the driest to plains.
 */
const assignTerrain = (
  land: readonly string[],
  elevation: Map<string, number>,
  moisture: Map<string, number>,
  depth: Map<string, number>,
  weights: TTerrainWeights
) => {
  const terrain = new Map<string, TTerrain>();
  const counts = allocate(weights, land.length);
  const deepest = Math.max(...land.map((key) => depth.get(key)!));
  const peakScore = (key: string) => {
    const inland = deepest > 1 ? (depth.get(key)! - 1) / (deepest - 1) : 0;

    return elevation.get(key)! * PEAK_HEIGHT_WEIGHT + inland * (1 - PEAK_HEIGHT_WEIGHT);
  };

  const byPeak = [...land].sort((a, b) => peakScore(b) - peakScore(a));
  const highland = counts.mountain + counts.hills;

  byPeak.slice(0, counts.mountain).forEach((key) => terrain.set(key, "mountain"));
  byPeak.slice(counts.mountain, highland).forEach((key) => terrain.set(key, "hills"));

  const lowland = byPeak.slice(highland).sort((a, b) => moisture.get(b)! - moisture.get(a)!);

  lowland.forEach((key, index) => {
    if (index < counts.forest) {
      terrain.set(key, "forest");

      return;
    }

    terrain.set(key, index < counts.forest + counts.meadow ? "meadow" : "plains");
  });

  return terrain;
};

const createName = (rng: TRng) => {
  const head = NAME_HEADS[rng.int(0, NAME_HEADS.length - 1)]!;
  const tail = NAME_TAILS[rng.int(0, NAME_TAILS.length - 1)]!;

  return head + tail;
};

/**
 * Builds an island. Missing options fall back to `DEFAULT_ISLAND_CONFIG`; the
 * same seed and the same config always give the same island.
 */
const generateIsland = (options: Partial<TIslandOptions> & { seedText: string }): Island => {
  const { seedText } = options;
  const config = resolveIslandConfig(options);
  const boardRadius = Math.max(0, Math.round(config.boardRadius));
  const seed = hashSeed(seedText);
  const rng = createRng(seed);
  const grid = createGrid(boardRadius);
  const elevation = createElevationField(grid, rng);
  const byKey = new Map(grid.map((cell) => [hexKey(cell.q, cell.r), cell]));
  const land = pickLand(byKey, elevation, config.landCount);

  const depth = inlandDepth(byKey, land);

  const coastal = new Set<string>();
  for (const cell of grid) {
    const key = hexKey(cell.q, cell.r);
    if (!land.has(key)) {
      continue;
    }

    const touchesWater = neighboursOf(cell).some((neighbour) => !land.has(hexKey(neighbour.q, neighbour.r)));
    if (touchesWater) {
      coastal.add(key);
    }
  }

  const noise = createNoiseField(grid, rng);
  const moisture = new Map<string, number>();
  for (const cell of grid) {
    const key = hexKey(cell.q, cell.r);
    // Water on the doorstep grows trees, so the shore is a little wetter.
    const bonus = coastal.has(key) ? SHORE_MOISTURE : 0;

    moisture.set(key, clamp(noise.get(key)! * (1 - SHORE_MOISTURE) + bonus, 0, 1));
  }

  const terrain = assignTerrain([...land], elevation, moisture, depth, config.terrainWeights);
  const name = createName(rng);

  const counts: Record<TTerrain, number> = { plains: 0, meadow: 0, forest: 0, hills: 0, mountain: 0 };
  const tiles = grid.map((cell) => {
    const key = hexKey(cell.q, cell.r);
    const isLand = land.has(key);
    const tileTerrain = terrain.get(key) ?? null;

    if (tileTerrain) {
      counts[tileTerrain] += 1;
    }

    return {
      key,
      q: cell.q,
      r: cell.r,
      land: isLand,
      terrain: tileTerrain,
      elevation: elevation.get(key)!,
      moisture: moisture.get(key)!,
      coastal: coastal.has(key),
    };
  });

  return new Island({
    seedText,
    seed,
    name,
    boardRadius,
    tiles,
    counts,
    landCount: land.size,
    boardSize: grid.length,
  });
};

export { generateIsland };
