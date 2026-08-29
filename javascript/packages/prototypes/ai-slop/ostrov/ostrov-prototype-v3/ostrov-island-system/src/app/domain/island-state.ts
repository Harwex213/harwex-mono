import { Island, generateIsland } from "../../core/exports";
import { createSeedText } from "@hw/ostrov-utils";
import type { TNumericConfigKey, TTerrain } from "../../core/exports";
import type { TStore } from "../store/store";

/** Rebuilds the island from whatever the settings currently hold. */
const buildIsland = (store: TStore) => {
  const { islandState } = store;

  islandState.island.value = generateIsland({
    seedText: islandState.seedText.peek(),
    ...islandState.config.peek(),
  });
  islandState.selectedKey.value = null;
};

/** Rebuilds from the seed field, filling in a fresh seed if it was left empty. */
const regenerateIslandAction = (store: TStore) => {
  const { islandState } = store;

  islandState.seedText.value = islandState.seedText.peek().trim() || createSeedText();

  buildIsland(store);
};

/** Rolls a new seed and builds the island it describes. */
const rollIslandAction = (store: TStore) => {
  store.islandState.seedText.value = createSeedText();

  buildIsland(store);
};

const setSeedTextAction = (store: TStore, seedText: string) => {
  store.islandState.seedText.value = seedText;
};

/** The sliders take effect at once: there is nothing to confirm. */
const setConfigValueAction = (store: TStore, key: TNumericConfigKey, value: number) => {
  const { config } = store.islandState;

  config.value = { ...config.peek(), [key]: value };

  buildIsland(store);
};

const setTerrainWeightAction = (store: TStore, terrain: TTerrain, weight: number) => {
  const { config } = store.islandState;
  const current = config.peek();

  config.value = { ...current, terrainWeights: { ...current.terrainWeights, [terrain]: weight } };

  buildIsland(store);
};

const resetConfigAction = (store: TStore) => {
  store.islandState.config.value = Island.DEFAULT_CONFIG;

  buildIsland(store);
};

/** Clicking the selected tile again clears the selection. */
const selectTileAction = (store: TStore, key: string) => {
  const { selectedKey } = store.islandState;

  selectedKey.value = selectedKey.peek() === key ? null : key;
};

export {
  regenerateIslandAction,
  resetConfigAction,
  rollIslandAction,
  selectTileAction,
  setConfigValueAction,
  setSeedTextAction,
  setTerrainWeightAction,
};
