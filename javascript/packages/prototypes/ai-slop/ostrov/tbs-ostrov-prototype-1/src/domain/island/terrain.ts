/** The five land tile types, ordered from the lowest ground to the highest. */
type TTerrain = "plains" | "meadow" | "forest" | "hills" | "mountain";

const TERRAIN_LIST: readonly TTerrain[] = ["plains", "meadow", "forest", "hills", "mountain"];

const TERRAIN_LABELS: Record<TTerrain, string> = {
  plains: "Равнина",
  meadow: "Луга",
  forest: "Лес",
  hills: "Холмы",
  mountain: "Горы",
};

export type { TTerrain };
export { TERRAIN_LABELS, TERRAIN_LIST };
