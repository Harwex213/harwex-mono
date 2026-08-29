const TERRAIN_KINDS = [
  "deep-water",
  "shallow-water",
  "beach",
  "marsh",
  "plains",
  "forest",
  "hills",
  "mountains",
  "snow",
] as const;

type TTerrainKind = (typeof TERRAIN_KINDS)[number];

type TGeneratorParams = {
  seed: string;
  width: number;
  height: number;
  islandCount: number;
  islandRadius: number;
  islandRadiusJitter: number;
  lobes: number;
  seaLevel: number;
  noiseScale: number;
  octaves: number;
  persistence: number;
  coastRoughness: number;
  edgeMargin: number;
  minIslandSize: number;
  moistureScale: number;
};

/**
 * The map holds one typed array per property rather than one object per hex. A
 * 400x400 map is 160 000 hexes; as objects that is tens of megabytes and a slow
 * pass for the garbage collector on every regeneration, while these arrays come
 * to about three megabytes and are reused field by field.
 */
type THexField = {
  /** Raw generated height, roughly `0..1.6`. Compared against `seaLevel`. */
  height: Float32Array;
  /** Height above sea level, rescaled to `0..1`. Zero on water. */
  elevation: Float32Array;
  moisture: Float32Array;
  /** Index into `TERRAIN_KINDS`. */
  terrain: Uint8Array;
  isLand: Uint8Array;
  /** Index into `THexMap.islands`, or `-1` for water. */
  islandId: Int32Array;
  /** Steps to the nearest water cell. Zero on water, one on the shoreline. */
  coastDistance: Uint16Array;
};

type TIsland = {
  id: number;
  name: string;
  size: number;
  centreCol: number;
  centreRow: number;
  minCol: number;
  minRow: number;
  maxCol: number;
  maxRow: number;
  peakElevation: number;
  terrainCounts: Record<TTerrainKind, number>;
};

type THexMap = {
  width: number;
  height: number;
  params: TGeneratorParams;
  cells: THexField;
  /** Sorted by size, biggest first. `islands[i].id` is always `i`. */
  islands: TIsland[];
  landCount: number;
  waterCount: number;
  /** Islands thrown away for being smaller than `minIslandSize`. */
  discardedIslands: number;
  generationMs: number;
};

/** One hex read out of the typed arrays, for the parts of the UI that want an object. */
type THexCell = {
  index: number;
  col: number;
  row: number;
  height: number;
  elevation: number;
  moisture: number;
  terrain: TTerrainKind;
  isLand: boolean;
  islandId: number;
  coastDistance: number;
};

const createHexField = (size: number): THexField => ({
  height: new Float32Array(size),
  elevation: new Float32Array(size),
  moisture: new Float32Array(size),
  terrain: new Uint8Array(size),
  isLand: new Uint8Array(size),
  islandId: new Int32Array(size),
  coastDistance: new Uint16Array(size),
});

const readCell = (map: THexMap, index: number): THexCell | null => {
  if (index < 0 || index >= map.cells.height.length) {
    return null;
  }

  const col = index % map.width;

  return {
    index,
    col,
    row: (index - col) / map.width,
    height: map.cells.height[index]!,
    elevation: map.cells.elevation[index]!,
    moisture: map.cells.moisture[index]!,
    terrain: TERRAIN_KINDS[map.cells.terrain[index]!]!,
    isLand: map.cells.isLand[index] === 1,
    islandId: map.cells.islandId[index]!,
    coastDistance: map.cells.coastDistance[index]!,
  };
};

export type { TGeneratorParams, THexCell, THexField, THexMap, TIsland, TTerrainKind };
export { TERRAIN_KINDS, createHexField, readCell };
