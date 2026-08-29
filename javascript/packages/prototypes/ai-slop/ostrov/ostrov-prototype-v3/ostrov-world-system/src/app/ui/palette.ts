import type { TIslandType, TTerrain } from "@hw/ostrov-island-system";

/** Flat colour of a land hex, and of the swatch beside a slider. */
const TERRAIN_COLORS: Record<TTerrain, string> = {
  plains: "#cfd07a",
  meadow: "#8fc351",
  forest: "#478c4f",
  hills: "#ab9659",
  mountain: "#9ea8af",
};

/** Colour that stands for an archetype in the panel and in the island list. */
const ISLAND_TYPE_COLORS: Record<TIslandType, string> = {
  meadow: "#8fc351",
  forest: "#478c4f",
  hills: "#ab9659",
  mountain: "#9ea8af",
  mixed: "#d8a75a",
};

const COLORS = {
  oceanTop: "#12475f",
  oceanBottom: "#0a2c3f",
  seaHex: "#14536e",
  seaHexEdge: "#1d6b8b",
  seaGrid: "rgba(120, 190, 220, 0.10)",
  coast: "#e8d5a4",
  coastLine: "rgba(16, 36, 48, 0.65)",
  selection: "#ffd479",
  label: "#dceaf2",
} as const;

export { COLORS, ISLAND_TYPE_COLORS, TERRAIN_COLORS };
