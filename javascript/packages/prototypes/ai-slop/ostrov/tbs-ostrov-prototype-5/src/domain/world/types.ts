/**
 * The island has exactly the three land types from the brief plus the water
 * that surrounds them. Terrain never changes during a game: it only decides
 * what the player may build on a tile.
 */
const TERRAIN_KINDS = ["water", "meadow", "forest", "mountains"] as const;

type TTerrainKind = (typeof TERRAIN_KINDS)[number];

type TTile = {
  index: number;
  col: number;
  row: number;
  terrain: TTerrainKind;
  /** Normalised height, `0` at the deepest water and `1` at the highest peak. */
  height: number;
  isLand: boolean;
  /** A land tile with at least one water neighbour. */
  isCoast: boolean;
};

type TWorld = {
  seed: number;
  width: number;
  height: number;
  /** Height that separates sea from land on this map. */
  seaLevel: number;
  tiles: readonly TTile[];
  /** Tile the starting settlement sits on. */
  startIndex: number;
  landCount: number;
};

const TERRAIN_LABELS: Record<TTerrainKind, string> = {
  water: "Море",
  meadow: "Луга",
  forest: "Лес",
  mountains: "Горы",
};

export type { TTerrainKind, TTile, TWorld };
export { TERRAIN_KINDS, TERRAIN_LABELS };
