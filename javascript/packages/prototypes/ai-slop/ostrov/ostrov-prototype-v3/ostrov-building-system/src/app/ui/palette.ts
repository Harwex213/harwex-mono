import type { TTerrain } from "@hw/ostrov-island-system";
import type { TBuildingKind, TResourceKind } from "../../core/exports";

/** Top face of a land hex, from the far edge down to the near edge. */
const TERRAIN_GRADIENTS: Record<TTerrain, [string, string]> = {
  plains: ["#dcdd8e", "#c2c46b"],
  meadow: ["#a8d768", "#7fb544"],
  forest: ["#5aa25c", "#3b7c44"],
  hills: ["#c0ab6d", "#9b874c"],
  mountain: ["#b3bcc2", "#8d989f"],
};

const TERRAIN_COLORS: Record<TTerrain, string> = {
  plains: "#cfd07a",
  meadow: "#8fc351",
  forest: "#478c4f",
  hills: "#ab9659",
  mountain: "#9ea8af",
};

const RESOURCE_COLORS: Record<TResourceKind, string> = {
  food: "#8fd15a",
  materials: "#c98a4b",
  metal: "#a9b3bb",
};

const RESOURCE_ICONS: Record<TResourceKind, string> = {
  food: "🌾",
  materials: "🧱",
  metal: "⚙️",
};

const SCIENCE_COLOR = "#7cc7ff";
const POPULATION_COLOR = "#ffd479";

const BUILDING_ICONS: Record<TBuildingKind, string> = {
  townhall: "🏛️",
  lumber_camp: "🪓",
  farm: "🌾",
  fishing_hut: "🎣",
  quarry: "⛏️",
  mine: "⚒️",
  house: "🏠",
  library: "📚",
};

const COLORS = {
  oceanTop: "#12475f",
  oceanBottom: "#0a2c3f",
  seaHex: "#1a6382",
  seaHexEdge: "#2a86a8",
  coast: "#e8d5a4",
  cliffDark: "#5b4b39",
  roof: "#a7503a",
  roofDark: "#7d3a2a",
  wall: "#e9dcc2",
  wallShade: "#c9b997",
  scaffold: "#8b6a44",
  okGlow: "#7fe08a",
  badGlow: "#ff7b6b",
  selection: "#ffd479",
} as const;

export {
  BUILDING_ICONS,
  COLORS,
  POPULATION_COLOR,
  RESOURCE_COLORS,
  RESOURCE_ICONS,
  SCIENCE_COLOR,
  TERRAIN_COLORS,
  TERRAIN_GRADIENTS,
};
