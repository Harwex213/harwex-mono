import { signal } from "@preact/signals-react";
import { createContext, useContext } from "react";
import { createWorld } from "../domain/world/create-world";
import { emptyResources } from "../domain/world/resources";
import type { TAxial } from "../domain/hex/coords";
import type { TResources } from "../domain/world/resources";
import { MOVE_RANGE } from "../domain/world/world";
import type { TMoveRange, TWorld } from "../domain/world/world";

const INITIAL_SEED = "НЕБО";

/** `idle` is the normal view. `move` is the card mode: the sky shows the targets. */
type TMode = "idle" | "move";

const createGameState = (seedText: string) => ({
  seedText: signal(seedText),
  world: signal<TWorld>(createWorld(seedText)),
  turn: signal(1),
  /** Moves the player still has this turn. */
  movesLeft: signal(1),
  /** How far the player island flies in one move. Adjustable from the move card. */
  moveRange: signal<TMoveRange>(MOVE_RANGE),
  mode: signal<TMode>("idle"),
  /** Target anchor under the pointer while in move mode. */
  hoveredTarget: signal<TAxial | null>(null),
  selectedIslandId: signal<string | null>("player"),
  resources: signal<TResources>(emptyResources()),
  /** Newest line first. */
  log: signal<string[]>(["Ваш остров поднялся в небо. Найдите соседей и наладьте связи."]),
});

const createStore = (seedText = INITIAL_SEED) => ({
  gameState: createGameState(seedText),
});

type TStore = ReturnType<typeof createStore>;

const StoreProvider = createContext<TStore>(null!);

const useStore = () => useContext(StoreProvider);

export type { TMode, TStore };
export { INITIAL_SEED, StoreProvider, createStore, useStore };
