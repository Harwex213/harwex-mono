import { ISLAND_TYPE_LIST } from "@hw/ostrov-island-system";
import type { TIslandType } from "@hw/ostrov-island-system";
import type { TRange } from "../hex/offset";

/** How many islands of each archetype the world is asked for. */
type TIslandTypeCounts = Record<TIslandType, number>;

/** Every knob of the world generator. The seed decides the layout; the rest shapes it. */
type TWorldConfig = {
  /** Columns the world spans, both ends included. */
  xRange: TRange;
  /** Rows the world spans, both ends included. */
  yRange: TRange;
  /** How many land tiles one island holds. Each island rolls its own count in this range. */
  islandTiles: TRange;
  /**
   * The islands themselves, counted per archetype. Their sum is how many islands
   * the generator is asked for; there is no separate total to keep in step.
   */
  islandTypeCounts: TIslandTypeCounts;
};

/** What the generator was asked for: the config plus the seed. */
type TWorldOptions = TWorldConfig & {
  seedText: string;
};

/** The most islands one world may hold. The type sliders share out this many. */
const ISLAND_TOTAL_MAX = 40;

const DEFAULT_ISLAND_TYPE_COUNTS: TIslandTypeCounts = {
  meadow: 2,
  forest: 2,
  hills: 1,
  mountain: 1,
  mixed: 2,
};

const DEFAULT_WORLD_CONFIG: TWorldConfig = {
  xRange: { min: -20, max: 20 },
  yRange: { min: -14, max: 14 },
  islandTiles: { min: 12, max: 34 },
  islandTypeCounts: DEFAULT_ISLAND_TYPE_COUNTS,
};

/** Allowed range of one knob. The app builds its sliders from this. */
type TConfigRange = {
  min: number;
  max: number;
  step: number;
};

/** Knobs that are a pair of bounds. Each bound gets its own slider. */
type TRangeConfigKey = "islandTiles";

/** The two world axes. The app sets how many cells each one spans. */
type TAxisConfigKey = "xRange" | "yRange";

type TRangeBound = "min" | "max";

/**
 * Allowed values of each knob. The two axis rows are a count of cells, not a
 * coordinate: the config holds a range, and the app sets how long that range is.
 */
const WORLD_CONFIG_RANGES: Record<TAxisConfigKey | TRangeConfigKey, TConfigRange> = {
  xRange: { min: 5, max: 101, step: 1 },
  yRange: { min: 5, max: 71, step: 1 },
  islandTiles: { min: 3, max: 120, step: 1 },
};

/** How far the slider for the island total may travel. */
const ISLAND_TOTAL_RANGE: TConfigRange = { min: 0, max: ISLAND_TOTAL_MAX, step: 1 };

/**
 * A range of `size` cells centred on zero. An odd size lands exactly on the
 * origin; an even one puts the extra cell on the positive side.
 */
const centredRange = (size: number): TRange => {
  const span = Math.max(1, Math.round(size));
  const min = -Math.floor((span - 1) / 2);

  return { min, max: min + span - 1 };
};

/** How many islands the counts add up to. */
const totalIslandCount = (counts: TIslandTypeCounts) => {
  return ISLAND_TYPE_LIST.reduce((sum, type) => sum + Math.max(0, Math.round(counts[type])), 0);
};

/** Island slots nobody has claimed yet. Never below zero. */
const freeIslandSlots = (counts: TIslandTypeCounts) => {
  return Math.max(0, ISLAND_TOTAL_MAX - totalIslandCount(counts));
};

/**
 * The most islands one archetype may take: what it already holds plus every slot
 * the other archetypes left free.
 */
const islandTypeCeiling = (counts: TIslandTypeCounts, type: TIslandType) => {
  return Math.max(0, Math.round(counts[type])) + freeIslandSlots(counts);
};

/**
 * Rewrites the counts so they add up to `total`, keeping the mix they already
 * describe. The shares rarely land on whole islands, so the leftovers are handed
 * out largest remainder first and the result adds up to exactly `total`.
 * Counts that are all zero have no mix to keep, so the islands are split evenly.
 */
const scaleIslandTypeCounts = (counts: TIslandTypeCounts, total: number): TIslandTypeCounts => {
  const target = Math.min(Math.max(0, Math.round(total)), ISLAND_TOTAL_MAX);
  const current = totalIslandCount(counts);
  const shares = ISLAND_TYPE_LIST.map((type) => {
    const weight = current > 0 ? Math.max(0, Math.round(counts[type])) / current : 1 / ISLAND_TYPE_LIST.length;
    const exact = weight * target;

    return { type, count: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });

  let left = target - shares.reduce((sum, share) => sum + share.count, 0);

  for (const share of [...shares].sort((a, b) => b.remainder - a.remainder)) {
    if (left <= 0) {
      break;
    }

    share.count += 1;
    left -= 1;
  }

  return shares.reduce((next, share) => {
    next[share.type] = share.count;

    return next;
  }, {} as TIslandTypeCounts);
};

/** Fills the gaps of a partial config with the defaults. */
const resolveWorldConfig = (partial: Partial<TWorldConfig> = {}): TWorldConfig => ({
  ...DEFAULT_WORLD_CONFIG,
  ...partial,
  xRange: { ...DEFAULT_WORLD_CONFIG.xRange, ...partial.xRange },
  yRange: { ...DEFAULT_WORLD_CONFIG.yRange, ...partial.yRange },
  islandTiles: { ...DEFAULT_WORLD_CONFIG.islandTiles, ...partial.islandTiles },
  islandTypeCounts: { ...DEFAULT_ISLAND_TYPE_COUNTS, ...partial.islandTypeCounts },
});

/**
 * Puts a range the right way round and rounds it to whole cells. A slider can
 * push `min` past `max`, and a flipped range would leave the world empty.
 */
const normaliseRange = (range: TRange): TRange => {
  const from = Math.round(range.min);
  const to = Math.round(range.max);

  return { min: Math.min(from, to), max: Math.max(from, to) };
};

export type {
  TAxisConfigKey,
  TConfigRange,
  TIslandTypeCounts,
  TRangeBound,
  TRangeConfigKey,
  TWorldConfig,
  TWorldOptions,
};
export {
  DEFAULT_ISLAND_TYPE_COUNTS,
  DEFAULT_WORLD_CONFIG,
  ISLAND_TOTAL_MAX,
  ISLAND_TOTAL_RANGE,
  WORLD_CONFIG_RANGES,
  centredRange,
  freeIslandSlots,
  islandTypeCeiling,
  normaliseRange,
  resolveWorldConfig,
  scaleIslandTypeCounts,
  totalIslandCount,
};
