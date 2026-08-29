import type { TTerrain } from "./terrain";

/**
 * Archetype of an island. The type does not change how the land is shaped: it
 * only decides the mix of tile types on that land, by naming a set of terrain
 * weights. `mixed` asks for a little of everything.
 */
type TIslandType = "meadow" | "forest" | "hills" | "mountain" | "mixed";

const ISLAND_TYPE_LIST: readonly TIslandType[] = ["meadow", "forest", "hills", "mountain", "mixed"];

const ISLAND_TYPE_LABELS: Record<TIslandType, string> = {
  meadow: "Луговой",
  forest: "Лесной",
  hills: "Холмистый",
  mountain: "Горный",
  mixed: "Смешанный",
};

/**
 * Terrain weights of each archetype. Only the ratios matter, so the rows do not
 * have to add up to the same total. Every row keeps a small share of the other
 * terrains, which stops an island from turning into one flat colour.
 */
const ISLAND_TYPE_WEIGHTS: Record<TIslandType, Record<TTerrain, number>> = {
  meadow: { plains: 30, meadow: 50, forest: 12, hills: 6, mountain: 2 },
  forest: { plains: 10, meadow: 22, forest: 55, hills: 10, mountain: 3 },
  hills: { plains: 14, meadow: 20, forest: 18, hills: 40, mountain: 8 },
  mountain: { plains: 8, meadow: 10, forest: 14, hills: 30, mountain: 38 },
  mixed: { plains: 25, meadow: 30, forest: 35, hills: 20, mountain: 14 },
};

export type { TIslandType };
export { ISLAND_TYPE_LABELS, ISLAND_TYPE_LIST, ISLAND_TYPE_WEIGHTS };
