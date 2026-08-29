import { generateHexMap } from "./generator/map-generator";
import { DEFAULT_PARAMS, MAX_MAP_SIZE, MIN_MAP_SIZE, PARAM_FIELDS } from "./generator/params";
import { randomSeed } from "./generator/rng";
import { fitMapAction } from "./view-state";
import type { TNumericParamKey } from "./generator/params";
import type { TStore } from "../store/store";

/** Regenerates the map from whatever is in `params` right now. */
const generateMapAction = (store: TStore) => {
  const { generatorState, viewState } = store;

  generatorState.map.value = generateHexMap(generatorState.params.peek());

  // The old selection points at an island that no longer exists.
  viewState.selectedIslandId.value = -1;
  viewState.hoveredIndex.value = -1;
};

const setSeedAction = (store: TStore, seed: string) => {
  store.generatorState.params.value = { ...store.generatorState.params.peek(), seed };
};

/**
 * Knobs regenerate on the spot: a full 40x40 map takes a few milliseconds, so
 * dragging a slider shows its effect while the pointer is still down.
 */
const setParamAction = (store: TStore, key: TNumericParamKey, value: number) => {
  store.generatorState.params.value = { ...store.generatorState.params.peek(), [key]: value };
  generateMapAction(store);
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * Resizes the map, keeping it square.
 *
 * The island count is scaled with the area at the same time. It counts cores,
 * not density, so leaving it alone would turn a map twice as wide into mostly
 * open sea. The slider moves with it rather than the scaling being hidden.
 * The camera is refitted afterwards, since the world it was framing is gone.
 */
const setMapSizeAction = (store: TStore, size: number) => {
  const params = store.generatorState.params.peek();
  const next = clamp(Math.round(size), MIN_MAP_SIZE, MAX_MAP_SIZE);
  if (next === params.width && next === params.height) {
    return;
  }

  const islandField = PARAM_FIELDS.find((field) => field.key === "islandCount")!;
  const areaRatio = (next * next) / (params.width * params.height);

  store.generatorState.params.value = {
    ...params,
    width: next,
    height: next,
    islandCount: clamp(Math.round(params.islandCount * areaRatio), islandField.min, islandField.max),
  };

  generateMapAction(store);
  fitMapAction(store);
};

const randomizeSeedAction = (store: TStore) => {
  setSeedAction(store, randomSeed());
  generateMapAction(store);
};

const resetParamsAction = (store: TStore) => {
  store.generatorState.params.value = DEFAULT_PARAMS;
  generateMapAction(store);
  fitMapAction(store);
};

export {
  generateMapAction,
  randomizeSeedAction,
  resetParamsAction,
  setMapSizeAction,
  setParamAction,
  setSeedAction,
};
