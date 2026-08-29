import { TERRAIN_KINDS } from "./types";
import type { TTerrainKind } from "./types";

const indexOfTerrain = (kind: TTerrainKind): number => TERRAIN_KINDS.indexOf(kind);

/** Terrain indices, so the generator can write straight into a `Uint8Array`. */
const TERRAIN_DEEP_WATER = indexOfTerrain("deep-water");
const TERRAIN_SHALLOW_WATER = indexOfTerrain("shallow-water");
const TERRAIN_BEACH = indexOfTerrain("beach");
const TERRAIN_MARSH = indexOfTerrain("marsh");
const TERRAIN_PLAINS = indexOfTerrain("plains");
const TERRAIN_FOREST = indexOfTerrain("forest");
const TERRAIN_HILLS = indexOfTerrain("hills");
const TERRAIN_MOUNTAINS = indexOfTerrain("mountains");
const TERRAIN_SNOW = indexOfTerrain("snow");

type TClassifyInput = {
  height: number;
  seaLevel: number;
  elevation: number;
  moisture: number;
  coastDistance: number;
  isLand: boolean;
};

/**
 * Picks the terrain of a single hex. Water splits by depth, land splits by
 * height first and by moisture second, so a wet lowland becomes forest while a
 * dry one stays plains.
 */
const classifyTerrain = (input: TClassifyInput): number => {
  if (!input.isLand) {
    if (input.height < input.seaLevel * 0.62) {
      return TERRAIN_DEEP_WATER;
    }

    return TERRAIN_SHALLOW_WATER;
  }

  if (input.coastDistance <= 1 && input.elevation < 0.24) {
    return TERRAIN_BEACH;
  }

  // High ground still needs room behind it. Without the coast checks a lone
  // six-hex island can come out capped in snow, which reads as a mistake.
  if (input.elevation > 0.9 && input.coastDistance >= 3) {
    return TERRAIN_SNOW;
  }

  if (input.elevation > 0.76 && input.coastDistance >= 2) {
    return TERRAIN_MOUNTAINS;
  }

  if (input.elevation > 0.56) {
    return TERRAIN_HILLS;
  }

  if (input.moisture > 0.72 && input.elevation < 0.28) {
    return TERRAIN_MARSH;
  }

  if (input.moisture > 0.5) {
    return TERRAIN_FOREST;
  }

  return TERRAIN_PLAINS;
};

const NAME_HEADS = ["Ost", "Kar", "Vel", "Mor", "Sal", "Ter", "Bran", "Hal", "Dun", "Sever", "Zar", "Ilm"];
const NAME_MIDS = ["", "a", "o", "en", "is", "ur"];
const NAME_TAILS = ["rov", "sey", "holm", "mar", "vik", "ness", "aya", "dal", "strand", "oy"];

/**
 * Stable per-island label. Three syllables give 720 combinations, so a map with
 * a few hundred islands reads as a list of names rather than a list of numbers.
 */
const islandName = (id: number): string => {
  const head = NAME_HEADS[id % NAME_HEADS.length]!;
  const mid = NAME_MIDS[Math.floor(id / NAME_HEADS.length) % NAME_MIDS.length]!;
  const tail = NAME_TAILS[Math.floor(id / (NAME_HEADS.length * NAME_MIDS.length)) % NAME_TAILS.length]!;

  return `${head}${mid}${tail}`;
};

export { classifyTerrain, islandName };
