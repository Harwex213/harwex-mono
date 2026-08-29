import type { TTerrainKind } from "../../domain/world/types";

type TTerrainStyle = {
  label: string;
  fill: string;
};

const TERRAIN_STYLES: Record<TTerrainKind, TTerrainStyle> = {
  water: { label: "Море", fill: "#1d4a6b" },
  meadow: { label: "Луга", fill: "#93b95c" },
  forest: { label: "Лес", fill: "#3f7442" },
  mountains: { label: "Горы", fill: "#8f8a82" },
};

/** Legend order matches the brief: meadows, forest, mountains. */
const LEGEND_ORDER: readonly TTerrainKind[] = ["meadow", "forest", "mountains"];

const OCEAN_BACKDROP = "#0e2438";
const GRID_STROKE = "rgba(10, 24, 38, 0.25)";
const COAST_STROKE = "rgba(9, 22, 34, 0.65)";
const HOVER_OUTLINE = "#ffffff";
const SELECTED_OUTLINE = "#ffd75e";
/** Tiles that could take the armed building. */
const PLACEABLE_OUTLINE = "rgba(255, 236, 170, 0.9)";
const IDLE_BADGE = "#e0603f";
const SITE_STROKE = "#f3e3b8";

export type { TTerrainStyle };
export {
  COAST_STROKE,
  GRID_STROKE,
  HOVER_OUTLINE,
  IDLE_BADGE,
  LEGEND_ORDER,
  OCEAN_BACKDROP,
  PLACEABLE_OUTLINE,
  SELECTED_OUTLINE,
  SITE_STROKE,
  TERRAIN_STYLES,
};
