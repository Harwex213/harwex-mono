import { axialDistance, axialKey, axialNeighbours, offsetToAxial } from "../hex/coords";
import { axialToPixel } from "../hex/layout";
import { fbm } from "./noise";
import { createRng, hashSeed } from "./rng";
import { TERRAIN } from "./terrain";
import type { TAxial } from "../hex/coords";
import type { TTerrainKind } from "./terrain";
import type { TTile, TWorld } from "./types";

/**
 * The island grows one tile at a time out of the best-scoring tile, always
 * taking a coastal tile the noise field likes. Growth beats thresholding on a
 * board this small: a threshold happily produces three specks and no island,
 * while growth always returns one connected landmass of the size asked for.
 */

type TIslandParams = {
  seed: string;
  width: number;
  height: number;
};

type TGeneratedWorld = {
  world: TWorld;
  cityKey: string;
  campKey: string;
};

/** Share of the board that ends up above water. */
const LAND_SHARE = 0.62;

/** Shares of the landmass given to the two terrains that are not meadow. */
const MOUNTAIN_SHARE = 0.16;
const FOREST_SHARE = 0.32;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Priority of a coastal candidate. Mostly the best one, sometimes not. */
const pickFrontierRank = (roll: number): number => {
  if (roll < 0.68) {
    return 0;
  }
  if (roll < 0.9) {
    return 1;
  }

  return 2;
};

const generateIsland = (params: TIslandParams): TGeneratedWorld => {
  const seedNumber = hashSeed(params.seed);
  const rng = createRng(seedNumber);

  const cells: TAxial[] = [];
  for (let row = 0; row < params.height; row += 1) {
    for (let col = 0; col < params.width; col += 1) {
      cells.push(offsetToAxial(col, row));
    }
  }

  const centres = cells.map((cell) => axialToPixel(cell, 1));
  const xs = centres.map((point) => point.x);
  const ys = centres.map((point) => point.y);
  const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const spanX = Math.max(Math.max(...xs) - midX, 0.001);
  const spanY = Math.max(Math.max(...ys) - midY, 0.001);

  // Two and a half noise cells across the board, whatever its size: small
  // boards get one bay, large boards get a coastline.
  const frequency = 2.5 / Math.max(spanX, spanY) / 2;

  const scores = new Map<string, number>();
  const moisture = new Map<string, number>();

  cells.forEach((cell, index) => {
    const key = axialKey(cell.q, cell.r);
    const point = centres[index]!;
    const shape = fbm(point.x * frequency + 13.7, point.y * frequency + 4.2, seedNumber, 4);
    const dx = (point.x - midX) / spanX;
    const dy = (point.y - midY) / spanY;
    const falloff = Math.pow(clamp01(Math.sqrt(dx * dx + dy * dy)), 1.7);

    scores.set(key, shape * 0.8 + (1 - falloff) * 0.6 + rng() * 0.05);
    moisture.set(key, fbm(point.x * frequency * 1.8 - 21.1, point.y * frequency * 1.8 + 9.4, seedNumber ^ 0x5bf03635, 3));
  });

  const inBoard = new Set(cells.map((cell) => axialKey(cell.q, cell.r)));
  const targetLand = Math.max(8, Math.min(cells.length - 3, Math.round(cells.length * LAND_SHARE)));

  const land = new Set<string>();
  const frontier = new Map<string, TAxial>();

  const pushNeighbours = (cell: TAxial) => {
    for (const neighbour of axialNeighbours(cell)) {
      const key = axialKey(neighbour.q, neighbour.r);
      if (!inBoard.has(key) || land.has(key)) {
        continue;
      }
      frontier.set(key, neighbour);
    }
  };

  let startKey = "";
  let startScore = Number.NEGATIVE_INFINITY;
  for (const cell of cells) {
    const key = axialKey(cell.q, cell.r);
    const score = scores.get(key)!;
    if (score > startScore) {
      startScore = score;
      startKey = key;
    }
  }

  const startCell = cells.find((cell) => axialKey(cell.q, cell.r) === startKey)!;
  land.add(startKey);
  pushNeighbours(startCell);

  while (land.size < targetLand && frontier.size > 0) {
    const ranked = [...frontier.entries()].sort((a, b) => scores.get(b[0])! - scores.get(a[0])!);
    const rank = Math.min(pickFrontierRank(rng()), ranked.length - 1);
    const [key, cell] = ranked[rank]!;

    frontier.delete(key);
    land.add(key);
    pushNeighbours(cell);
  }

  // A tile ringed by land can be dropped without cutting the island: anything
  // that crossed it can walk around the ring instead. That buys a lake.
  const lakeBudget = land.size >= 20 ? 2 : 1;
  const interior = [...land]
    .map((key) => ({ key, cell: cells.find((candidate) => axialKey(candidate.q, candidate.r) === key)! }))
    .filter(({ cell }) => axialNeighbours(cell).every((neighbour) => land.has(axialKey(neighbour.q, neighbour.r))))
    .sort((a, b) => scores.get(a.key)! - scores.get(b.key)!);

  for (let index = 0; index < Math.min(lakeBudget, interior.length); index += 1) {
    if (rng() > 0.55) {
      continue;
    }
    land.delete(interior[index]!.key);
  }

  const landCells = cells.filter((cell) => land.has(axialKey(cell.q, cell.r)));
  const landScores = landCells.map((cell) => scores.get(axialKey(cell.q, cell.r))!);
  const minScore = Math.min(...landScores);
  const maxScore = Math.max(...landScores);
  const scoreSpan = Math.max(maxScore - minScore, 0.0001);

  const isLand = (cell: TAxial): boolean => land.has(axialKey(cell.q, cell.r));
  const isCoastal = (cell: TAxial): boolean => axialNeighbours(cell).some((neighbour) => !isLand(neighbour));

  // Ranks, not thresholds: on fifteen tiles a threshold that misses by 0.02
  // hands back an island with no mountains at all.
  const inland = landCells.filter((cell) => !isCoastal(cell));
  const mountainPool = inland.length > 0 ? inland : landCells;
  const mountainCount = Math.max(1, Math.min(mountainPool.length - 1, Math.round(landCells.length * MOUNTAIN_SHARE)));
  const mountains = new Set(
    [...mountainPool]
      .sort((a, b) => scores.get(axialKey(b.q, b.r))! - scores.get(axialKey(a.q, a.r))!)
      .slice(0, mountainCount)
      .map((cell) => axialKey(cell.q, cell.r))
  );

  const forestPool = landCells.filter((cell) => !mountains.has(axialKey(cell.q, cell.r)));
  const forestCount = Math.max(1, Math.min(forestPool.length - 1, Math.round(landCells.length * FOREST_SHARE)));
  const forests = new Set(
    [...forestPool]
      .sort((a, b) => moisture.get(axialKey(b.q, b.r))! - moisture.get(axialKey(a.q, a.r))!)
      .slice(0, forestCount)
      .map((cell) => axialKey(cell.q, cell.r))
  );

  const terrainOf = (cell: TAxial): TTerrainKind => {
    const key = axialKey(cell.q, cell.r);
    if (!land.has(key)) {
      return "sea";
    }
    if (mountains.has(key)) {
      return "mountain";
    }
    if (forests.has(key)) {
      return "forest";
    }

    return "meadow";
  };

  const order: TTile[] = cells.map((cell) => {
    const key = axialKey(cell.q, cell.r);
    const terrain = terrainOf(cell);
    const elevation = land.has(key) ? (scores.get(key)! - minScore) / scoreSpan : 0;
    const coastal = land.has(key)
      ? isCoastal(cell)
      : axialNeighbours(cell).some((neighbour) => isLand(neighbour));

    return { key, cell, terrain, elevation, coastal };
  });

  const tiles = new Map(order.map((tile) => [tile.key, tile]));
  const landKeys = order.filter((tile) => tile.terrain !== "sea").map((tile) => tile.key);

  const world: TWorld = {
    seed: params.seed,
    width: params.width,
    height: params.height,
    tiles,
    order,
    landKeys,
  };

  return { world, ...placeSettlements(world) };
};

/** Income the tiles around `tile` hand to a city standing on it. */
const surroundingIncome = (world: TWorld, tile: TTile): number =>
  axialNeighbours(tile.cell).reduce((total, neighbour) => {
    const found = world.tiles.get(axialKey(neighbour.q, neighbour.r));

    return found ? total + TERRAIN[found.terrain].income : total;
  }, 0);

/**
 * The city takes the friendliest meadow, the camp takes the tile furthest from
 * it. Distance dominates the score, so the two never share a corner of the map.
 */
const placeSettlements = (world: TWorld): { cityKey: string; campKey: string } => {
  const landTiles = world.landKeys.map((key) => world.tiles.get(key)!);
  const cityCandidates = landTiles.filter((tile) => tile.terrain === "meadow");
  const cityPool = cityCandidates.length > 0 ? cityCandidates : landTiles;

  let best = { cityKey: cityPool[0]!.key, campKey: landTiles[landTiles.length - 1]!.key, score: -Infinity };

  for (const city of cityPool) {
    const cityBonus = surroundingIncome(world, city) * 0.12;
    for (const camp of landTiles) {
      if (camp.key === city.key) {
        continue;
      }

      const steps = axialDistance(city.cell, camp.cell);
      // A camp on a peak is both hard to read and hard to crack, so it takes a
      // penalty worth two steps of distance.
      const campPenalty = camp.terrain === "mountain" ? 2 : 0;
      const score = steps + cityBonus - campPenalty;

      if (score > best.score) {
        best = { cityKey: city.key, campKey: camp.key, score };
      }
    }
  }

  return { cityKey: best.cityKey, campKey: best.campKey };
};

export type { TGeneratedWorld, TIslandParams };
export { generateIsland };
