import { computed } from "@preact/signals-react";
import { createContext, useContext } from "react";
import { createAnimState } from "./anim-state";
import { createGameState } from "./game-state";
import { createRouteState } from "./route-state";
import { createUiState } from "./ui-state";
import {
  BUILDING_ORDER,
  canAfford,
  islandToxicityPercent,
  islandToxicityPoints,
  legalHexesFor,
} from "../core/exports";
import type { ReadonlySignal } from "@preact/signals-react";
import type { TAnimState } from "./anim-state";
import type { TGameState } from "./game-state";
import type { TRouteState } from "./route-state";
import type { TUiState } from "./ui-state";
import type { TBuildingId, TIsland, TPlayer } from "../core/exports";

/**
 * The store is a plain object of signal slices, created once in `main.tsx` and
 * handed to React through `StoreProvider` / `useStore()`. It holds state only.
 *
 * S5 adds anim.
 *
 * `TStore` is written by hand so a slice that does not exist yet cannot be read
 * by accident.
 */

/** The id of the one human player. Every other player is a row in the list and nothing more. */
const HUMAN_PLAYER_ID = "p1";

const NO_TOXICITY = 0;

/** One shared empty array, so `legalHexIds` keeps its identity while disarmed. */
const NO_LEGAL_HEXES: readonly string[] = [];

/**
 * Read-only views over the slices. A `computed` is lazy, so a derived value
 * nobody renders costs nothing.
 */
type TDerivedState = {
  /** The player whose island the island page shows: the route's player, or the human. */
  readonly viewedPlayerId: ReadonlySignal<string>;
  /** True while a foreign island is on screen. The build controls disappear then. */
  readonly isReadonly: ReadonlySignal<boolean>;
  readonly viewedIsland: ReadonlySignal<TIsland | null>;
  readonly toxicityPercent: ReadonlySignal<number>;
  readonly toxicityPoints: ReadonlySignal<number>;
  readonly humanPlayer: ReadonlySignal<TPlayer | null>;
  /** The hexes the armed building may go on. Empty while nothing is armed. */
  readonly legalHexIds: ReadonlySignal<readonly string[]>;
  /** One flag per building: can the player pay for it right now. */
  readonly affordable: ReadonlySignal<Readonly<Record<TBuildingId, boolean>>>;
};

type TStore = {
  readonly route: TRouteState;
  readonly game: TGameState;
  readonly ui: TUiState;
  /** The tax-phase animation queue (S5). */
  readonly anim: TAnimState;
  readonly derived: TDerivedState;
};

const createDerivedState = (
  route: TRouteState,
  game: TGameState,
  ui: TUiState,
): TDerivedState => {
  const viewedPlayerId = computed<string>(() => {
    return route.viewedPlayerId.value ?? HUMAN_PLAYER_ID;
  });

  const isReadonly = computed<boolean>(() => {
    return viewedPlayerId.value !== HUMAN_PLAYER_ID;
  });

  const viewedIsland = computed<TIsland | null>(() => {
    return game.islands.value[viewedPlayerId.value] ?? null;
  });

  const toxicityPercent = computed<number>(() => {
    const island = viewedIsland.value;
    if (island === null) {
      return NO_TOXICITY;
    }

    return islandToxicityPercent(island);
  });

  const toxicityPoints = computed<number>(() => {
    const island = viewedIsland.value;
    if (island === null) {
      return NO_TOXICITY;
    }

    return islandToxicityPoints(island);
  });

  const humanPlayer = computed<TPlayer | null>(() => {
    return game.players.value.find((player) => player.id === HUMAN_PLAYER_ID) ?? null;
  });

  const legalHexIds = computed<readonly string[]>(() => {
    const building = ui.armedBuilding.value;
    const island = viewedIsland.value;
    if (building === null || island === null) {
      return NO_LEGAL_HEXES;
    }

    return legalHexesFor(island, building);
  });

  const affordable = computed<Readonly<Record<TBuildingId, boolean>>>(() => {
    const resources = game.resources.value;

    return BUILDING_ORDER.reduce((flags, building) => {
      flags[building] = canAfford(resources, building);

      return flags;
    }, {} as Record<TBuildingId, boolean>);
  });

  return {
    viewedPlayerId,
    isReadonly,
    viewedIsland,
    toxicityPercent,
    toxicityPoints,
    humanPlayer,
    legalHexIds,
    affordable,
  };
};

const createStore = (): TStore => {
  const route = createRouteState();
  const game = createGameState();
  const ui = createUiState();
  const anim = createAnimState();

  return {
    route,
    game,
    ui,
    anim,
    derived: createDerivedState(route, game, ui),
  };
};

const StoreProvider = createContext<TStore>(null!);

const useStore = () => useContext(StoreProvider);

export type { TDerivedState, TStore };
export { HUMAN_PLAYER_ID, StoreProvider, createStore, useStore };
