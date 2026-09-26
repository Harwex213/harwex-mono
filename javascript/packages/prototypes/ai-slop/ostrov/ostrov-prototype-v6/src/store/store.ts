import { computed } from "@preact/signals-react";
import { createContext, useContext } from "react";
import { createBattleState } from "./battle-state";
import { createGameState } from "./game-state";
import { createRouteState } from "./route-state";
import { createUiState } from "./ui-state";
import { createWorldState } from "./world-state";
import { techEffects } from "../core/techs";
import { getCell } from "../core/world-gen";
import type { THex, TPlayer } from "../core/types";
import type { TGameState } from "./game-state";
import type { TRouteState } from "./route-state";
import type { TUiState } from "./ui-state";
import type { TWorldState } from "./world-state";

const findHex = (player: TPlayer | null, hexId: string | null): THex | null => {
  if (!player || !hexId) {
    return null;
  }

  return player.island.hexes.find((hex) => hex.id === hexId) ?? null;
};

/**
 * Anything a component would otherwise `useMemo` lives here, so the same answer
 * is computed once for every reader.
 */
const createDerived = (route: TRouteState, game: TGameState, ui: TUiState, world: TWorldState) => {
  const humanPlayer = computed(() => {
    return game.players.value.find((player) => player.id === game.humanPlayerId.value) ?? null;
  });

  /** Whose island the island page draws: a rival when the route names one. */
  const viewedPlayer = computed(() => {
    const requestedId = route.islandPlayerId.value;
    if (!requestedId) {
      return humanPlayer.value;
    }

    return game.players.value.find((player) => player.id === requestedId) ?? humanPlayer.value;
  });

  /**
   * A rival's island is look-only: the spec hides the buildings panel, the two
   * tool icons and the resources panel there.
   */
  const isReadonly = computed(() => {
    return viewedPlayer.value?.id !== game.humanPlayerId.value;
  });

  /** The world cell the player's island is flying over right now. */
  const currentCell = computed(() => {
    const map = world.world.value;
    const player = humanPlayer.value;
    if (!map || !player) {
      return null;
    }

    return getCell(map, player.cellId);
  });

  return {
    humanPlayer,
    viewedPlayer,
    isReadonly,
    currentCell,
    selectedCell: computed(() => {
      const map = world.world.value;
      const cellId = world.selectedCellId.value;

      return map && cellId ? getCell(map, cellId) : null;
    }),
    /** Everything the researched technologies change, computed in one place. */
    techEffects: computed(() => techEffects(game.researched.value)),
    hoveredHex: computed(() => findHex(viewedPlayer.value, ui.hoveredHexId.value)),
    selectedHex: computed(() => findHex(viewedPlayer.value, ui.selectedHexId.value)),
    demolishTargetHex: computed(() => findHex(viewedPlayer.value, ui.demolishTargetHexId.value)),
  };
};

/**
 * The store is a plain object of slices, and every slice is a plain object of
 * signals. The UI only reads signals; the domain layer owns every write.
 */
const createStore = () => {
  const route = createRouteState();
  const game = createGameState();
  const ui = createUiState();
  const world = createWorldState();
  const battle = createBattleState();

  return {
    route,
    game,
    ui,
    world,
    battle,
    derived: createDerived(route, game, ui, world),
  };
};

type TStore = ReturnType<typeof createStore>;

const StoreProvider = createContext<TStore>(null!);

const useStore = () => useContext(StoreProvider);

export type { TStore };
export { StoreProvider, createStore, useStore };
