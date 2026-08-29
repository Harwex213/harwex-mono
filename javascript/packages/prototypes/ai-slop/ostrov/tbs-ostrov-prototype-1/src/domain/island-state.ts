import { createSeedText, generateIsland } from "./island/generator";
import type { TStore } from "../store/store";
import type { TTerrain } from "./island/terrain";

/** Rebuilds the island from whatever the settings currently hold. */
const buildIsland = (store: TStore) => {
  const { islandState } = store;

  islandState.island.value = generateIsland({
    seedText: islandState.seedText.peek(),
    landCount: islandState.landCount.peek(),
    terrainWeights: islandState.terrainWeights.peek(),
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
const setLandCountAction = (store: TStore, landCount: number) => {
  store.islandState.landCount.value = landCount;

  buildIsland(store);
};

const setTerrainWeightAction = (store: TStore, terrain: TTerrain, weight: number) => {
  const { terrainWeights } = store.islandState;

  terrainWeights.value = { ...terrainWeights.peek(), [terrain]: weight };

  buildIsland(store);
};

/** Clicking the selected tile again clears the selection. */
const selectTileAction = (store: TStore, key: string) => {
  const { selectedKey } = store.islandState;

  selectedKey.value = selectedKey.peek() === key ? null : key;
};

export {
  regenerateIslandAction,
  rollIslandAction,
  selectTileAction,
  setLandCountAction,
  setSeedTextAction,
  setTerrainWeightAction,
};
