import { TERRAIN_KINDS } from "../../domain/generator/types";
import type { TTerrainKind } from "../../domain/generator/types";

type TTerrainStyle = {
  label: string;
  fill: string;
};

const TERRAIN_STYLES: Record<TTerrainKind, TTerrainStyle> = {
  "deep-water": { label: "Deep water", fill: "#12314f" },
  "shallow-water": { label: "Shallow water", fill: "#1f5b80" },
  beach: { label: "Beach", fill: "#d9c48c" },
  marsh: { label: "Marsh", fill: "#5d7a4a" },
  plains: { label: "Plains", fill: "#8bab5a" },
  forest: { label: "Forest", fill: "#3f6b3a" },
  hills: { label: "Hills", fill: "#7d7a4a" },
  mountains: { label: "Mountains", fill: "#8a8279" },
  snow: { label: "Snow", fill: "#e6e9ec" },
};

/** Legend order: water first, then land from low to high. */
const LEGEND_ORDER: readonly TTerrainKind[] = TERRAIN_KINDS;

const GRID_STROKE = "rgba(8, 20, 32, 0.28)";
/** Dark ink, so the shoreline reads over pale beach as well as over water. */
const ISLAND_OUTLINE = "rgba(9, 22, 34, 0.8)";
const SELECTED_OUTLINE = "#ffd75e";
const HOVER_OUTLINE = "#ffffff";
const OCEAN_BACKDROP = "#0b1f33";

/** Wash laid over the map while one island is isolated. */
const DIM_WASH = "rgba(9, 20, 32, 0.66)";

/**
 * Steps of elevation shading per terrain. Shading every hex by its own exact
 * elevation would mean building a colour string per hex, 160 000 times per
 * redraw. Quantising into a few steps turns that into a lookup, and six steps is
 * fine enough that the banding is invisible.
 */
const SHADE_STEPS = 6;

/** One extra slot per terrain holds the unshaded base colour. */
const SHADES_PER_TERRAIN = SHADE_STEPS + 1;

const parseChannels = (colour: string): [number, number, number] => {
  const value = Number.parseInt(colour.slice(1), 16);

  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

const shade = (colour: string, factor: number): string => {
  const [red, green, blue] = parseChannels(colour);
  const channel = (value: number) => Math.min(255, Math.max(0, Math.round(value * factor)));

  return `rgb(${channel(red)}, ${channel(green)}, ${channel(blue)})`;
};

/**
 * Flat lookup of every colour the map can use, indexed by
 * `terrainIndex * SHADES_PER_TERRAIN + step`. Land gets lighter as it rises,
 * water gets darker as it deepens.
 */
const TERRAIN_SHADES: string[] = TERRAIN_KINDS.flatMap((kind, terrainIndex) => {
  const base = TERRAIN_STYLES[kind].fill;
  const isWater = terrainIndex <= 1;
  const steps = Array.from({ length: SHADE_STEPS }, (_, step) => {
    const position = (step + 0.5) / SHADE_STEPS;

    return shade(base, isWater ? 1.08 - 0.4 * position : 0.82 + 0.36 * position);
  });

  return [...steps, base];
});

export type { TTerrainStyle };
export {
  DIM_WASH,
  GRID_STROKE,
  HOVER_OUTLINE,
  ISLAND_OUTLINE,
  LEGEND_ORDER,
  OCEAN_BACKDROP,
  SELECTED_OUTLINE,
  SHADES_PER_TERRAIN,
  SHADE_STEPS,
  TERRAIN_SHADES,
  TERRAIN_STYLES,
};
