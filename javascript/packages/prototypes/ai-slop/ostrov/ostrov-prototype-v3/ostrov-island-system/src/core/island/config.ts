import { DEFAULT_BOARD_RADIUS } from "../hex/grid";
import type { TTerrain } from "./terrain";

/** How much of the land each tile type asks for. Only the ratios matter. */
type TTerrainWeights = Record<TTerrain, number>;

/** Every knob of the generator. The seed decides the layout; the rest shapes the mix. */
type TIslandConfig = {
  /** Steps from the centre to the rim of the board. */
  boardRadius: number;
  /** How many tiles of the board become land. Clamped to the size of the board. */
  landCount: number;
  terrainWeights: TTerrainWeights;
};

/** What the generator was asked for: the config plus the seed. */
type TIslandOptions = TIslandConfig & {
  seedText: string;
};

const DEFAULT_TERRAIN_WEIGHTS: TTerrainWeights = {
  plains: 25,
  meadow: 30,
  forest: 35,
  hills: 20,
  mountain: 14,
};

const DEFAULT_ISLAND_CONFIG: TIslandConfig = {
  boardRadius: DEFAULT_BOARD_RADIUS,
  landCount: 36,
  terrainWeights: DEFAULT_TERRAIN_WEIGHTS,
};

/** Allowed range of each numeric knob. The app builds its sliders from this. */
type TConfigRange = {
  min: number;
  max: number;
  step: number;
};

type TNumericConfigKey = Exclude<keyof TIslandConfig, "terrainWeights">;

const ISLAND_CONFIG_RANGES: Record<TNumericConfigKey, TConfigRange> = {
  boardRadius: { min: 2, max: 9, step: 1 },
  landCount: { min: 1, max: 271, step: 1 },
};

/** Fills the gaps of a partial config with the defaults. */
const resolveIslandConfig = (partial: Partial<TIslandConfig> = {}): TIslandConfig => ({
  ...DEFAULT_ISLAND_CONFIG,
  ...partial,
  terrainWeights: { ...DEFAULT_TERRAIN_WEIGHTS, ...partial.terrainWeights },
});

export type { TConfigRange, TIslandConfig, TIslandOptions, TNumericConfigKey, TTerrainWeights };
export { DEFAULT_ISLAND_CONFIG, DEFAULT_TERRAIN_WEIGHTS, ISLAND_CONFIG_RANGES, resolveIslandConfig };
