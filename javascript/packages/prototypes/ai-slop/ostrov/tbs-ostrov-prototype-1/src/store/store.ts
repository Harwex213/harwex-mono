import { signal } from "@preact/signals-react";
import { createContext, useContext } from "react";
import { generateIsland } from "../domain/island/generator";
import type { TIsland, TTerrainWeights } from "../domain/island/generator";

const INITIAL_SEED = "ОСТРОВ";
const INITIAL_LAND_COUNT = 36;

/** Only the ratios between these matter, so the numbers are plain slider values. */
const INITIAL_TERRAIN_WEIGHTS: TTerrainWeights = {
  plains: 25,
  meadow: 30,
  forest: 35,
  hills: 20,
  mountain: 14,
};

const createIslandState = () => ({
  /** What the seed field holds. The island is only rebuilt on demand. */
  seedText: signal(INITIAL_SEED),
  landCount: signal(INITIAL_LAND_COUNT),
  terrainWeights: signal<TTerrainWeights>(INITIAL_TERRAIN_WEIGHTS),
  island: signal<TIsland>(
    generateIsland({
      seedText: INITIAL_SEED,
      landCount: INITIAL_LAND_COUNT,
      terrainWeights: INITIAL_TERRAIN_WEIGHTS,
    })
  ),
  selectedKey: signal<string | null>(null),
});

const createStore = () => ({
  islandState: createIslandState(),
});

type TStore = ReturnType<typeof createStore>;

const StoreProvider = createContext<TStore>(null!);

const useStore = () => useContext(StoreProvider);

export type { TStore };
export { INITIAL_SEED, StoreProvider, createStore, useStore };
