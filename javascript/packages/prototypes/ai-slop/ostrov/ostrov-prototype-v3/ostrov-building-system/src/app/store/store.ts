import { signal } from "@preact/signals-react";
import { createContext, useContext } from "react";
import { Island, generateIsland } from "@hw/ostrov-island-system";
import { Settlement } from "../../core/exports";
import type { TBuildingKind } from "../../core/exports";

const INITIAL_SEED = "ОСТРОВ";

type TLogEntry = {
  id: number;
  turn: number;
  text: string;
  tone: "info" | "good" | "bad";
};

const createGameState = () => {
  const island = generateIsland({ seedText: INITIAL_SEED, ...Island.DEFAULT_CONFIG });

  return {
    seedText: signal(INITIAL_SEED),
    island: signal<Island>(island),
    settlement: signal<Settlement>(Settlement.found(island)),
    selectedKey: signal<string | null>(null),
    /** The catalog card that is armed. Clicking a tile then places it. */
    pickedKind: signal<TBuildingKind | null>(null),
    log: signal<TLogEntry[]>([]),
    /** The line of the end-turn curtain being shown, or `null` when no turn is ending. */
    turnMessage: signal<string | null>(null),
  };
};

const createStore = () => ({
  gameState: createGameState(),
});

type TStore = ReturnType<typeof createStore>;

const StoreProvider = createContext<TStore>(null!);

const useStore = () => useContext(StoreProvider);

export type { TLogEntry, TStore };
export { INITIAL_SEED, StoreProvider, createStore, useStore };
