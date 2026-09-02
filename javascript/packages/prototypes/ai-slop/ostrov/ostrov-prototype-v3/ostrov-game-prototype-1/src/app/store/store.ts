import { createContext, useContext } from "react";
import { createGame } from "../../core/exports";
import { createRng, hashSeed } from "@hw/ostrov-utils";
import { signal } from "@preact/signals-react";
import type { TBattle, TGame, TPlayerId } from "../../core/exports";

type TPanelTab = "tile" | "island" | "tech" | "factions" | "log";

const DEFAULT_SEED = "OSTROV";

const createUiState = (seedText: string) => ({
  /** The seat whose units the mouse controls. Both seats share the screen. */
  activePlayer: signal<TPlayerId>("p1"),
  selectedTileId: signal<string | null>(null),
  selectedUnitId: signal<string | null>(null),
  panelTab: signal<TPanelTab>("tile"),
  /** How many curtain lines have appeared so far. */
  curtainShown: signal(0),
  battle: signal<TBattle | null>(null),
  /** Rounds play on a timer unless the player pauses to pick a skill. */
  battleAuto: signal(true),
  seedText: signal(seedText),
  /** A one-line explanation of why the last click did nothing. */
  hint: signal<string | null>(null),
});

const createStore = (seedText: string = DEFAULT_SEED) => ({
  game: signal<TGame>(createGame(seedText)),
  rng: createRng(hashSeed(seedText) ^ 0xb47),
  ui: createUiState(seedText),
});

type TStore = ReturnType<typeof createStore>;

const StoreProvider = createContext<TStore>(null!);

const useStore = () => useContext(StoreProvider);

export type { TPanelTab, TStore };
export { DEFAULT_SEED, StoreProvider, createStore, useStore };
