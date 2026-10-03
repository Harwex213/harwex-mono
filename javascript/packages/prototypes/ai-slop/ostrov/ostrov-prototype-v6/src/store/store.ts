import { computed } from "@preact/signals-react";
import { createContext, useContext } from "react";
import { createBattleState } from "./battle-state";
import { createGameState } from "./game-state";
import { createRouteState } from "./route-state";
import { createUiState } from "./ui-state";
import { createWorldState } from "./world-state";
import { findRoll, powerLeft, planPowerSpent } from "../core/tax-plan";
import { techEffects } from "../core/techs";
import { getCell } from "../core/world-gen";
import type { THex, TPlayer } from "../core/types";
import type { TBattleState } from "./battle-state";
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
const createDerived = (
  route: TRouteState,
  game: TGameState,
  ui: TUiState,
  world: TWorldState,
  battle: TBattleState,
) => {
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

  /** The player's own tax plan, while the tax phase lasts. */
  const humanTaxPlan = computed(() => {
    const tax = game.tax.value;
    if (!tax) {
      return null;
    }

    return tax.plans.find((plan) => plan.playerId === game.humanPlayerId.value) ?? null;
  });

  /**
   * The player has pressed "Готов" and waits for the rest. The phase's own
   * input is refused until the phase moves on or the player takes it back.
   */
  const isHumanReady = computed(() => {
    return game.ready.value.includes(game.humanPlayerId.value);
  });

  /**
   * The cleanup phase was skipped: the island sits over a cell with no wild
   * islands, so no level was built and the player only waits.
   */
  const isCleanupSkipped = computed(() => {
    return game.phase.value === "clear" && battle.sim.value === null;
  });

  /**
   * The player cannot take "Готов" back. The tax phase has already paid out,
   * and a skipped cleanup has nothing to go back to.
   */
  const isReadyLocked = computed(() => {
    return game.phase.value === "tax" || isCleanupSkipped.value;
  });

  return {
    humanPlayer,
    isHumanReady,
    isCleanupSkipped,
    isReadyLocked,
    viewedPlayer,
    humanTaxPlan,
    /** Power the player can still spend in this tax phase. */
    powerLeft: computed(() => {
      const player = humanPlayer.value;

      return player ? powerLeft(player, humanTaxPlan.value) : 0;
    }),
    /** Power the choices in the plan will take when the phase ends. */
    powerPlanned: computed(() => planPowerSpent(humanTaxPlan.value)),
    /** The hex whose face popup is open, with its roll. */
    taxPick: computed(() => {
      const hexId = ui.taxPickHexId.value;
      const hex = findHex(humanPlayer.value, hexId);
      const roll = hexId ? findRoll(humanTaxPlan.value, hexId) : null;

      return hex && roll ? { hex, roll } : null;
    }),
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
    derived: createDerived(route, game, ui, world, battle),
  };
};

type TStore = ReturnType<typeof createStore>;

const StoreProvider = createContext<TStore>(null!);

const useStore = () => useContext(StoreProvider);

export type { TStore };
export { StoreProvider, createStore, useStore };
