import { World, generateWorld } from "../../core/exports";
import { signal } from "@preact/signals-react";
import { createContext, useContext } from "react";
import type { TWorldConfig } from "../../core/exports";

const INITIAL_SEED = "МИР";

const createWorldState = () => ({
  /** What the seed field holds. The world is only rebuilt on demand. */
  seedText: signal(INITIAL_SEED),
  /** Every generator knob. A change rebuilds the world at once. */
  config: signal<TWorldConfig>(World.DEFAULT_CONFIG),
  world: signal<World>(generateWorld({ seedText: INITIAL_SEED, ...World.DEFAULT_CONFIG })),
  /** Offset key of the tile under the cursor of the inspector. */
  selectedKey: signal<string | null>(null),
  selectedIslandId: signal<string | null>(null),
});

const createStore = () => ({
  worldState: createWorldState(),
});

type TStore = ReturnType<typeof createStore>;

const StoreProvider = createContext<TStore>(null!);

const useStore = () => useContext(StoreProvider);

export type { TStore };
export { INITIAL_SEED, StoreProvider, createStore, useStore };
