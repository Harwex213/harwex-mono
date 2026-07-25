import type { ResourceKind } from "@hw/colony-sim-v1-core";

// One glyph per resource, for every place in the HUD that names one: the stock
// readout and the build menu have to show the same 🪵 for wood, and two tables of
// emoji is how they stop matching.
const RESOURCE_ICONS: Record<ResourceKind, string> = {
  wood: "🪵",
  stone: "🪨",
  food: "🍗",
};

export { RESOURCE_ICONS };
