import { DEFAULT_WORLD_CONFIG, WORLD_CONFIG_RANGES } from "./config";
import { ISLAND_TYPE_LIST } from "@hw/ostrov-island-system";
import { offsetKey, rangeSize, rectCells } from "../hex/offset";
import type { TIslandType, TTerrain } from "@hw/ostrov-island-system";
import type { TOffset, TRange } from "../hex/offset";
import type { TWorldConfig } from "./config";

/** One land tile of the world. Empty sea cells are not materialised. */
type TWorldTile = {
  /** Offset key, `x:y`. */
  key: string;
  /** Offset coordinates in the world. */
  x: number;
  y: number;
  /** The same cell in axial coordinates, for hex maths and for drawing. */
  q: number;
  r: number;
  islandId: string;
  terrain: TTerrain;
  elevation: number;
  moisture: number;
  /** A tile on the shore of its own island. */
  coastal: boolean;
};

type TIslandBounds = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

/** An island the generator found room for. */
type TPlacedIsland = {
  id: string;
  /** Position in the requested list, before the placement order was sorted. */
  index: number;
  type: TIslandType;
  name: string;
  seedText: string;
  tileCount: number;
  boardRadius: number;
  /** Where the island's own centre landed in world offset coordinates. */
  origin: TOffset;
  bounds: TIslandBounds;
  tiles: readonly TWorldTile[];
  counts: Readonly<Record<TTerrain, number>>;
};

/** An island the generator could not fit anywhere. */
type TUnplacedIsland = {
  index: number;
  type: TIslandType;
  tileCount: number;
  reason: string;
};

type TWorldData = {
  seedText: string;
  seed: number;
  config: TWorldConfig;
  xRange: TRange;
  yRange: TRange;
  islands: TPlacedIsland[];
  unplaced: TUnplacedIsland[];
  tiles: TWorldTile[];
  counts: Record<TTerrain, number>;
  requestedCount: number;
};

/** A generated world: the islands, the land tiles, and lookups over them. */
class World {
  static readonly DEFAULT_CONFIG = DEFAULT_WORLD_CONFIG;
  static readonly CONFIG_RANGES = WORLD_CONFIG_RANGES;
  static readonly ISLAND_TYPES = ISLAND_TYPE_LIST;

  readonly seedText: string;
  readonly seed: number;
  readonly config: TWorldConfig;
  readonly xRange: TRange;
  readonly yRange: TRange;
  readonly islands: readonly TPlacedIsland[];
  readonly unplaced: readonly TUnplacedIsland[];
  /** Land tiles only. Every other cell of the rectangle is open sea. */
  readonly tiles: readonly TWorldTile[];
  readonly counts: Readonly<Record<TTerrain, number>>;
  readonly width: number;
  readonly height: number;
  readonly cellCount: number;
  readonly landCount: number;
  /** How many islands the config asked for: the archetype counts added up. */
  readonly requestedCount: number;

  private readonly byKey: Map<string, TWorldTile>;
  private readonly byId: Map<string, TPlacedIsland>;
  /** The full rectangle is only built when something asks to draw it. */
  private allCells: readonly TOffset[] | null = null;

  constructor(data: TWorldData) {
    this.seedText = data.seedText;
    this.seed = data.seed;
    this.config = data.config;
    this.xRange = data.xRange;
    this.yRange = data.yRange;
    this.islands = data.islands;
    this.unplaced = data.unplaced;
    this.tiles = data.tiles;
    this.counts = data.counts;
    this.width = rangeSize(data.xRange);
    this.height = rangeSize(data.yRange);
    this.cellCount = this.width * this.height;
    this.landCount = data.tiles.length;
    this.requestedCount = data.requestedCount;
    this.byKey = new Map(data.tiles.map((tile) => [tile.key, tile]));
    this.byId = new Map(data.islands.map((island) => [island.id, island]));
  }

  /** Every cell of the world rectangle, sea included. Built once, then reused. */
  cells(): readonly TOffset[] {
    if (this.allCells === null) {
      this.allCells = rectCells(this.xRange, this.yRange);
    }

    return this.allCells;
  }

  tileAt(x: number, y: number) {
    return this.byKey.get(offsetKey(x, y)) ?? null;
  }

  tileByKey(key: string | null) {
    if (key === null) {
      return null;
    }

    return this.byKey.get(key) ?? null;
  }

  isLand(x: number, y: number) {
    return this.byKey.has(offsetKey(x, y));
  }

  islandById(id: string | null) {
    if (id === null) {
      return null;
    }

    return this.byId.get(id) ?? null;
  }

  islandAt(x: number, y: number) {
    const tile = this.tileAt(x, y);

    if (tile === null) {
      return null;
    }

    return this.islandById(tile.islandId);
  }
}

export type { TIslandBounds, TPlacedIsland, TUnplacedIsland, TWorldData, TWorldTile };
export { World };
