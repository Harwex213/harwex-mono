import { World, generateWorld } from "../../core/exports";
import { createSeedText } from "@hw/ostrov-utils";
import type { TIslandType } from "@hw/ostrov-island-system";
import { centredRange, islandTypeCeiling, scaleIslandTypeCounts } from "../../core/world/config";
import type { TAxisConfigKey, TRangeBound, TRangeConfigKey } from "../../core/exports";
import type { TStore } from "../store/store";

/** Rebuilds the world from whatever the settings currently hold. */
const buildWorld = (store: TStore) => {
  const { worldState } = store;

  worldState.world.value = generateWorld({
    seedText: worldState.seedText.peek(),
    ...worldState.config.peek(),
  });
  worldState.selectedKey.value = null;
  worldState.selectedIslandId.value = null;
};

/** Rebuilds from the seed field, filling in a fresh seed if it was left empty. */
const regenerateWorldAction = (store: TStore) => {
  const { worldState } = store;

  worldState.seedText.value = worldState.seedText.peek().trim() || createSeedText();

  buildWorld(store);
};

/** Rolls a new seed and builds the world it describes. */
const rollWorldAction = (store: TStore) => {
  store.worldState.seedText.value = createSeedText();

  buildWorld(store);
};

const setSeedTextAction = (store: TStore, seedText: string) => {
  store.worldState.seedText.value = seedText;
};

/**
 * Resizes one axis of the world. The slider sets how many cells the axis spans,
 * and the range it stands for stays centred on the origin.
 */
const setAxisSizeAction = (store: TStore, key: TAxisConfigKey, size: number) => {
  const { config } = store.worldState;

  config.value = { ...config.peek(), [key]: centredRange(size) };

  buildWorld(store);
};

/**
 * Moves one end of a range. The two ends are free to cross while the slider is
 * dragged; the generator puts a flipped range back the right way round.
 */
const setRangeBoundAction = (store: TStore, key: TRangeConfigKey, bound: TRangeBound, value: number) => {
  const { config } = store.worldState;
  const current = config.peek();

  config.value = { ...current, [key]: { ...current[key], [bound]: value } };

  buildWorld(store);
};

/**
 * Sets how many islands the world holds in total. The mix the archetype sliders
 * describe is kept: every count is rescaled to the new total.
 */
const setIslandTotalAction = (store: TStore, total: number) => {
  const { config } = store.worldState;
  const current = config.peek();

  config.value = { ...current, islandTypeCounts: scaleIslandTypeCounts(current.islandTypeCounts, total) };

  buildWorld(store);
};

/**
 * Asks for a number of islands of one archetype. The slider is free to ask for
 * more than the world may hold; the ceiling holds it at the slots the other
 * archetypes left free, so raising this one means lowering another one first.
 */
const setIslandTypeCountAction = (store: TStore, type: TIslandType, count: number) => {
  const { config } = store.worldState;
  const current = config.peek();
  const ceiling = islandTypeCeiling(current.islandTypeCounts, type);
  const taken = Math.min(Math.max(0, Math.round(count)), ceiling);

  config.value = { ...current, islandTypeCounts: { ...current.islandTypeCounts, [type]: taken } };

  buildWorld(store);
};

const resetConfigAction = (store: TStore) => {
  store.worldState.config.value = World.DEFAULT_CONFIG;

  buildWorld(store);
};

/** Clicking the selected tile again clears the selection. */
const selectTileAction = (store: TStore, key: string) => {
  const { worldState } = store;
  const repeat = worldState.selectedKey.peek() === key;

  worldState.selectedKey.value = repeat ? null : key;
  worldState.selectedIslandId.value = repeat ? null : (worldState.world.peek().tileByKey(key)?.islandId ?? null);
};

/** Selects a whole island from the list, without picking a tile inside it. */
const selectIslandAction = (store: TStore, id: string) => {
  const { worldState } = store;
  const repeat = worldState.selectedIslandId.peek() === id;

  worldState.selectedIslandId.value = repeat ? null : id;
  worldState.selectedKey.value = null;
};

export {
  regenerateWorldAction,
  resetConfigAction,
  rollWorldAction,
  selectIslandAction,
  selectTileAction,
  setAxisSizeAction,
  setIslandTotalAction,
  setIslandTypeCountAction,
  setRangeBoundAction,
  setSeedTextAction,
};
