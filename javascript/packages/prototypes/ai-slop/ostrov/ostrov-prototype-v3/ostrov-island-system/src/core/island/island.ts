import { DEFAULT_ISLAND_CONFIG, ISLAND_CONFIG_RANGES } from "./config";
import { TERRAIN_LIST } from "./terrain";
import type { TTerrain } from "./terrain";

type TTile = {
  key: string;
  q: number;
  r: number;
  land: boolean;
  /** `null` at sea. */
  terrain: TTerrain | null;
  elevation: number;
  moisture: number;
  /** A land tile that touches water, or the edge of the board. */
  coastal: boolean;
};

type TIslandData = {
  seedText: string;
  seed: number;
  name: string;
  boardRadius: number;
  tiles: TTile[];
  counts: Record<TTerrain, number>;
  landCount: number;
  boardSize: number;
};

/** A generated island: the tile data plus lookups over it. */
class Island {
  static readonly DEFAULT_CONFIG = DEFAULT_ISLAND_CONFIG;
  static readonly CONFIG_RANGES = ISLAND_CONFIG_RANGES;
  static readonly TERRAINS = TERRAIN_LIST;

  readonly seedText: string;
  readonly seed: number;
  readonly name: string;
  readonly boardRadius: number;
  readonly tiles: readonly TTile[];
  readonly counts: Readonly<Record<TTerrain, number>>;
  readonly landCount: number;
  readonly boardSize: number;

  private readonly byKey: Map<string, TTile>;

  constructor(data: TIslandData) {
    this.seedText = data.seedText;
    this.seed = data.seed;
    this.name = data.name;
    this.boardRadius = data.boardRadius;
    this.tiles = data.tiles;
    this.counts = data.counts;
    this.landCount = data.landCount;
    this.boardSize = data.boardSize;
    this.byKey = new Map(data.tiles.map((tile) => [tile.key, tile]));
  }

  landTiles() {
    return this.tiles.filter((tile) => tile.land);
  }

  waterTiles() {
    return this.tiles.filter((tile) => !tile.land);
  }

  tileByKey(key: string | null) {
    if (key === null) {
      return null;
    }

    return this.byKey.get(key) ?? null;
  }

  isLand(key: string) {
    return this.byKey.get(key)?.land ?? false;
  }
}

export type { TIslandData, TTile };
export { Island };
