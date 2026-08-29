import type { TTerrain } from "../domain/island/terrain";

/** Top face of a land hex, from the far edge down to the near edge. */
const TERRAIN_GRADIENTS: Record<TTerrain, [string, string]> = {
  plains: ["#dcdd8e", "#c2c46b"],
  meadow: ["#a8d768", "#7fb544"],
  forest: ["#5aa25c", "#3b7c44"],
  hills: ["#c0ab6d", "#9b874c"],
  mountain: ["#b3bcc2", "#8d989f"],
};

/** Flat colour for the slider swatches and the inspector. */
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
  seaHex: "#1a6382",
  seaHexEdge: "#2a86a8",
  coast: "#e8d5a4",
  cliff: "#7a6650",
  cliffDark: "#5b4b39",
  trunk: "#68472d",
  canopy: "#3f8a4a",
  canopyDark: "#2c6438",
  rock: "#96a0a7",
  rockDark: "#6f7a82",
  snow: "#f1f6f8",
  tuft: "#5e9433",
  mound: "#93803f",
  moundTop: "#c8b578",
  dryGrass: "#a3a44c",
  stone: "#cdcda2",
  flower: ["#f6e05e", "#f6a5c0", "#f7f3e8"],
} as const;

export { COLORS, TERRAIN_COLORS, TERRAIN_GRADIENTS };
