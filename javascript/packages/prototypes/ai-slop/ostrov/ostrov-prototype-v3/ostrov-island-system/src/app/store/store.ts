import { signal } from "@preact/signals-react";
import { createContext, useContext } from "react";
import { Island, generateIsland } from "../../core/exports";
import type { TIslandConfig } from "../../core/exports";

const INITIAL_SEED = "ОСТРОВ";

const createIslandState = () => ({
  /** What the seed field holds. The island is only rebuilt on demand. */
  seedText: signal(INITIAL_SEED),
  /** Every generator knob. A change rebuilds the island at once. */
  config: signal<TIslandConfig>(Island.DEFAULT_CONFIG),
  island: signal<Island>(generateIsland({ seedText: INITIAL_SEED, ...Island.DEFAULT_CONFIG })),
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
