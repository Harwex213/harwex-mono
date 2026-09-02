import type { TTerrain } from "@hw/ostrov-island-system";

/** Flat colour of a land hex. */
const TERRAIN_COLORS: Record<TTerrain, string> = {
  plains: "#cfd07a",
  meadow: "#8fc351",
  forest: "#478c4f",
  hills: "#ab9659",
  mountain: "#9ea8af",
};

const COLORS = {
  oceanTop: "#12475f",
  oceanBottom: "#0a2c3f",
  seaHex: "#14536e",
  seaGrid: "rgba(120, 190, 220, 0.10)",
  coast: "#e8d5a4",
  coastLine: "rgba(16, 36, 48, 0.65)",
  citadelGround: "#3a3550",
  citadelGrid: "#8e7cff",
  selection: "#ffd479",
  reach: "rgba(255, 255, 255, 0.35)",
  reachHostile: "rgba(255, 96, 96, 0.55)",
  label: "#dceaf2",
  deposit: "#5a3d1e",
  depositEmpty: "rgba(0, 0, 0, 0.18)",
} as const;

export { COLORS, TERRAIN_COLORS };
