import { BlockedCells, placeFootprint } from "./placement";
import { ISLAND_TYPE_LIST, ISLAND_TYPE_WEIGHTS, Island, generateIsland } from "@hw/ostrov-island-system";
import { axialToOffset, offsetKey, rectCells } from "../hex/offset";
import { createRng, hashSeed, shuffled } from "@hw/ostrov-utils";
import { normaliseRange, resolveWorldConfig, totalIslandCount } from "./config";
import { World } from "./world";
import type { TAxial } from "@hw/ostrov-utils";
import type { TIslandType, TTerrain, TTile } from "@hw/ostrov-island-system";
import type { TPlacedIsland, TUnplacedIsland, TWorldTile } from "./world";
import type { TWorldOptions } from "./config";

/**
 * Share of its board an island is allowed to fill. An island that covers its
 * whole board comes out as a hexagon, so the board is sized well above the
 * tile count and the coast keeps a shape.
 */
const LAND_FILL = 0.45;

/** Cells on a hexagonal board of the given radius. */
const boardCellCount = (radius: number) => 3 * radius * (radius + 1) + 1;

/** The smallest board that holds `tileCount` tiles without being filled up. */
const boardRadiusFor = (tileCount: number) => {
  const { min, max } = Island.CONFIG_RANGES.boardRadius;
  const wanted = tileCount / LAND_FILL;

  for (let radius = min; radius < max; radius += 1) {
    if (boardCellCount(radius) >= wanted) {
      return radius;
    }
  }

  return max;
};

const emptyCounts = (): Record<TTerrain, number> => {
  return Island.TERRAINS.reduce((counts, terrain) => {
    counts[terrain] = 0;

    return counts;
  }, {} as Record<TTerrain, number>);
};

/** What one island was rolled to be, before anything tried to place it. */
type TRolledIsland = {
  index: number;
  type: TIslandType;
  tileCount: number;
  seedText: string;
  name: string;
  boardRadius: number;
  /** Land tiles in the island's own axial coordinates, centred on its origin. */
  footprint: TTile[];
};

const rollIsland = (index: number, worldSeedText: string, type: TIslandType, tileCount: number): TRolledIsland => {
  const boardRadius = boardRadiusFor(tileCount);
  const seedText = `${worldSeedText}#${index}`;
  const island = generateIsland({
    seedText,
    boardRadius,
    landCount: tileCount,
    terrainWeights: ISLAND_TYPE_WEIGHTS[type],
  });

  return { index, type, tileCount, seedText, name: island.name, boardRadius, footprint: island.landTiles() };
};

/** Turns a placed footprint into world tiles, in the order the island listed them. */
const toWorldTiles = (rolled: TRolledIsland, placed: readonly TAxial[], id: string): TWorldTile[] => {
  return rolled.footprint.map((tile, order) => {
    const hex = placed[order]!;
    const cell = axialToOffset(hex);

    return {
      key: offsetKey(cell.x, cell.y),
      x: cell.x,
      y: cell.y,
      q: hex.q,
      r: hex.r,
      islandId: id,
      terrain: tile.terrain!,
      elevation: tile.elevation,
      moisture: tile.moisture,
      coastal: tile.coastal,
    };
  });
};

const boundsOf = (tiles: readonly TWorldTile[]) => ({
  xMin: Math.min(...tiles.map((tile) => tile.x)),
  xMax: Math.max(...tiles.map((tile) => tile.x)),
  yMin: Math.min(...tiles.map((tile) => tile.y)),
  yMax: Math.max(...tiles.map((tile) => tile.y)),
});

/**
 * Builds a world. Missing options fall back to `DEFAULT_WORLD_CONFIG`; the same
 * seed and the same config always give the same world.
 *
 * Islands are placed largest first, because a large island needs a large gap and
 * a crowded world runs out of those. An island that finds no spot is reported in
 * `world.unplaced` rather than dropped in silence.
 */
const generateWorld = (options: Partial<TWorldOptions> & { seedText: string }): World => {
  const { seedText } = options;
  const config = resolveWorldConfig(options);
  const xRange = normaliseRange(config.xRange);
  const yRange = normaliseRange(config.yRange);
  const seed = hashSeed(seedText);
  const rng = createRng(seed);
  const tileRange = normaliseRange(config.islandTiles);
  const cells = rectCells(xRange, yRange);

  // The config names the islands one archetype at a time, so the list is built
  // by walking the archetypes rather than by rolling a type per island.
  const rolled: TRolledIsland[] = [];
  let index = 0;
  for (const type of ISLAND_TYPE_LIST) {
    const wanted = Math.max(0, Math.round(config.islandTypeCounts[type]));

    for (let made = 0; made < wanted; made += 1) {
      rolled.push(rollIsland(index, seedText, type, rng.int(tileRange.min, tileRange.max)));
      index += 1;
    }
  }

  const order = [...rolled].sort((a, b) => b.footprint.length - a.footprint.length);
  const blocked = new BlockedCells();
  const islands: TPlacedIsland[] = [];
  const unplaced: TUnplacedIsland[] = [];

  for (const entry of order) {
    if (entry.footprint.length === 0) {
      unplaced.push({ index: entry.index, type: entry.type, tileCount: entry.tileCount, reason: "Остров пуст" });

      continue;
    }

    // A fresh shuffle per island, so two islands of the same size do not walk
    // the rectangle in the same order.
    const anchors = shuffled(cells, rng);
    const placement = placeFootprint(entry.footprint, anchors, xRange, yRange, blocked);

    if (placement === null) {
      unplaced.push({ index: entry.index, type: entry.type, tileCount: entry.tileCount, reason: "Нет места" });

      continue;
    }

    blocked.block(placement.tiles);

    const id = `island-${entry.index}`;
    const tiles = toWorldTiles(entry, placement.tiles, id);
    const counts = emptyCounts();
    for (const tile of tiles) {
      counts[tile.terrain] += 1;
    }

    islands.push({
      id,
      index: entry.index,
      type: entry.type,
      name: entry.name,
      seedText: entry.seedText,
      tileCount: tiles.length,
      boardRadius: entry.boardRadius,
      origin: axialToOffset(placement.delta),
      bounds: boundsOf(tiles),
      tiles,
      counts,
    });
  }

  islands.sort((a, b) => a.index - b.index);
  unplaced.sort((a, b) => a.index - b.index);

  const tiles = islands.flatMap((island) => island.tiles as TWorldTile[]);
  const counts = emptyCounts();
  for (const island of islands) {
    for (const terrain of Island.TERRAINS) {
      counts[terrain] += island.counts[terrain];
    }
  }

  const requestedCount = totalIslandCount(config.islandTypeCounts);

  return new World({ seedText, seed, config, xRange, yRange, islands, unplaced, tiles, counts, requestedCount });
};

export { generateWorld };
