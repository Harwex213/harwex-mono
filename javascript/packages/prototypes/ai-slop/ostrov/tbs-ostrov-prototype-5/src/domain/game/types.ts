const RESOURCE_KINDS = ["food", "wood", "stone"] as const;

type TResourceKind = (typeof RESOURCE_KINDS)[number];

type TResources = Record<TResourceKind, number>;

const RESOURCE_LABELS: Record<TResourceKind, string> = {
  food: "Еда",
  wood: "Дерево",
  stone: "Камень",
};

const RESOURCE_GLYPHS: Record<TResourceKind, string> = {
  food: "🌾",
  wood: "🪵",
  stone: "🪨",
};

type TBuildingKind = "farm" | "house" | "warehouse" | "sawmill" | "hut" | "quarry" | "mine";

/**
 * One building standing on one tile. `remaining` counts the turns left before it
 * starts working, so a fresh order is `remaining > 0` and a working building is
 * `remaining === 0`. `order` is the placement order, which is also the order
 * workers are handed out in.
 */
type TPlacedBuilding = {
  kind: TBuildingKind;
  tileIndex: number;
  remaining: number;
  order: number;
};

/** Everything a turn resolves against. Tiles never change, so they stay out. */
type TGameSnapshot = {
  turn: number;
  resources: TResources;
  population: number;
  buildings: readonly (TPlacedBuilding | null)[];
};

type TLogTone = "info" | "good" | "warn";

type TLogEntry = {
  id: number;
  turn: number;
  tone: TLogTone;
  text: string;
};

export type { TBuildingKind, TGameSnapshot, TLogEntry, TLogTone, TPlacedBuilding, TResourceKind, TResources };
export { RESOURCE_GLYPHS, RESOURCE_KINDS, RESOURCE_LABELS };
