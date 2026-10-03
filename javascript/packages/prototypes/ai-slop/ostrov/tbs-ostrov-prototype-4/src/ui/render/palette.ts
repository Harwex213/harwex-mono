import type { TTerrainKind } from "../../domain/world/terrain";
import type { TFactionId } from "../../domain/world/types";

/** Every colour the board uses, in one place, so the map reads as one picture. */

type TTerrainStyle = {
  fill: string;
  /** Colour of the little trees, ridges and grass ticks drawn on the tile. */
  detail: string;
};

const TERRAIN_STYLE: Record<TTerrainKind, TTerrainStyle> = {
  sea: { fill: "#1b455f", detail: "#2f6d8e" },
  meadow: { fill: "#a3c264", detail: "#87a94d" },
  forest: { fill: "#4f7f4a", detail: "#2f5c30" },
  mountain: { fill: "#9b948b", detail: "#6f6860" },
};

type TFactionStyle = {
  fill: string;
  stroke: string;
  ink: string;
  banner: string;
};

const FACTION_STYLE: Record<TFactionId, TFactionStyle> = {
  player: { fill: "#3d7fd4", stroke: "#dbe9ff", ink: "#f2f7ff", banner: "#6fb0ff" },
  enemy: { fill: "#c04a3c", stroke: "#ffdcd5", ink: "#fff2ee", banner: "#ef7a68" },
};

const OCEAN_BACKDROP = "#0e2b3d";
const SHALLOW_WATER = "#26688a";
const COAST_LINE = "#f0e2b8";
const GRID_STROKE = "rgba(10, 26, 38, 0.22)";
const HOVER_STROKE = "#ffffff";
const SELECTION_STROKE = "#ffd75e";
const REACHABLE_FILL = "rgba(255, 255, 255, 0.22)";
const ATTACK_STROKE = "#ff6b5a";
const PATH_STROKE = "rgba(255, 244, 214, 0.9)";
const FOG_UNSEEN = "#0a1a26";
const FOG_REMEMBERED = "rgba(8, 22, 32, 0.55)";

/** Green while healthy, amber when hurt, red when a unit is nearly gone. */
const healthColour = (fraction: number): string => {
  if (fraction > 0.6) {
    return "#63c76a";
  }
  if (fraction > 0.3) {
    return "#e2b53f";
  }

  return "#e2553f";
};

export type { TFactionStyle, TTerrainStyle };
export {
  ATTACK_STROKE,
  COAST_LINE,
  FACTION_STYLE,
  FOG_REMEMBERED,
  FOG_UNSEEN,
  GRID_STROKE,
  HOVER_STROKE,
  OCEAN_BACKDROP,
  PATH_STROKE,
  REACHABLE_FILL,
  SELECTION_STROKE,
  SHALLOW_WATER,
  TERRAIN_STYLE,
  healthColour,
};
