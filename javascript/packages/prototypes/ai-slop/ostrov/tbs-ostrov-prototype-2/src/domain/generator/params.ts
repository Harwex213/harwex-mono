import type { TGeneratorParams } from "./types";

/** The map size the prototype is built around. The size control moves off it. */
const DEFAULT_MAP_SIZE = 400;

/**
 * Range of the map size control. The top end is 640 000 hexes, which still
 * generates in a fraction of a second; past that the offscreen overview picture
 * costs more memory than it is worth.
 */
const MIN_MAP_SIZE = 40;
const MAX_MAP_SIZE = 800;
const MAP_SIZE_STEP = 20;

const DEFAULT_PARAMS: TGeneratorParams = {
  seed: "ostrov",
  width: DEFAULT_MAP_SIZE,
  height: DEFAULT_MAP_SIZE,
  islandCount: 400,
  islandRadius: 5,
  islandRadiusJitter: 0.4,
  lobes: 4,
  seaLevel: 0.5,
  noiseScale: 0.14,
  octaves: 5,
  persistence: 0.5,
  coastRoughness: 0.55,
  edgeMargin: 12,
  minIslandSize: 12,
  moistureScale: 0.09,
};

type TNumericParamKey = Exclude<keyof TGeneratorParams, "seed" | "width" | "height">;

type TParamField = {
  key: TNumericParamKey;
  label: string;
  min: number;
  max: number;
  step: number;
  hint: string;
};

/** Drives the control panel, so a new knob only has to be added in one place. */
const PARAM_FIELDS: readonly TParamField[] = [
  {
    key: "islandCount",
    label: "Islands",
    min: 1,
    max: 4000,
    step: 1,
    hint: "How many island cores are dropped on the map before erosion by noise. Changing the map size scales this to match the new area.",
  },
  {
    key: "islandRadius",
    label: "Island radius",
    min: 2,
    max: 40,
    step: 0.5,
    hint: "Mean reach of one core, in hex steps.",
  },
  {
    key: "islandRadiusJitter",
    label: "Radius jitter",
    min: 0,
    max: 0.9,
    step: 0.05,
    hint: "How much the cores differ in size from each other.",
  },
  {
    key: "lobes",
    label: "Lobes per island",
    min: 1,
    max: 6,
    step: 1,
    hint: "Blobs chained into one island. One blob always comes out a circle.",
  },
  {
    key: "seaLevel",
    label: "Sea level",
    min: 0.1,
    max: 0.8,
    step: 0.01,
    hint: "Height below which a hex is water. Raise it to shrink every island.",
  },
  {
    key: "coastRoughness",
    label: "Coast roughness",
    min: 0,
    max: 1,
    step: 0.02,
    hint: "How hard the noise bites into the round core. Zero gives circles.",
  },
  {
    key: "noiseScale",
    label: "Noise scale",
    min: 0.02,
    max: 0.5,
    step: 0.01,
    hint: "Size of the noise features. Larger values give a busier coastline.",
  },
  {
    key: "octaves",
    label: "Octaves",
    min: 1,
    max: 8,
    step: 1,
    hint: "Noise layers. More layers add finer detail to the shore.",
  },
  {
    key: "persistence",
    label: "Persistence",
    min: 0.2,
    max: 0.8,
    step: 0.05,
    hint: "Loudness of each next octave.",
  },
  {
    key: "moistureScale",
    label: "Moisture scale",
    min: 0.02,
    max: 0.4,
    step: 0.01,
    hint: "Size of the biome patches inside an island.",
  },
  {
    key: "edgeMargin",
    label: "Edge margin",
    min: 0,
    max: 40,
    step: 1,
    hint: "Rows of guaranteed water around the map, so no island is cut off.",
  },
  {
    key: "minIslandSize",
    label: "Min island size",
    min: 1,
    max: 200,
    step: 1,
    hint: "Land blobs smaller than this are flooded back to water.",
  },
];

export type { TNumericParamKey, TParamField };
export { DEFAULT_PARAMS, MAP_SIZE_STEP, MAX_MAP_SIZE, MIN_MAP_SIZE, PARAM_FIELDS };
