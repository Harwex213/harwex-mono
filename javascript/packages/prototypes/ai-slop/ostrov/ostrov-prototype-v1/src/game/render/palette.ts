import type { TerrainKind } from "../types";

const PALETTE = {
  oceanDeep: "#071726",
  oceanMid: "#0d2c42",
  oceanShallow: "#17506b",
  foam: "rgba(178, 232, 255, 0.35)",
  sand: "#cdb181",
  sandDark: "#a68a5d",
  fog: "rgba(6, 18, 30, 0.66)",
  grid: "rgba(255, 255, 255, 0.07)",
  island: "#8fd8ff",
  islandDark: "#2f6f96",
  sea: "#ff6f7d",
  seaDark: "#7a2436",
  gold: "#ffd479",
  bad: "#ff6b57",
  good: "#7ce0a8",
  ink: "#08131e",
};

const TERRAIN_COLORS: Record<TerrainKind, { base: string; shade: string; decor: string }> = {
  barren: { base: "#7f7a61", shade: "#67624d", decor: "#9a937a" },
  forest: { base: "#4d7a4a", shade: "#3b6039", decor: "#2f5230" },
  crystal: { base: "#5d7793", shade: "#485d75", decor: "#9fd8ff" },
  ruins: { base: "#8b8069", shade: "#6d6453", decor: "#cbbfa2" },
  boss: { base: "#4b3554", shade: "#372641", decor: "#a06bd0" },
};

export { PALETTE, TERRAIN_COLORS };
