import { createPlayers } from "../core/island-gen";
import { PHASES } from "../core/phases";
import { createWorld } from "../core/world-gen";
import { enterClearingAction, finishBattleAction, stopLoop } from "./battle-actions";
import { startTaxPhaseAction } from "./tax-actions";
import { enterExplorationAction, settleExplorationAction } from "./world-actions";
import type { TStore } from "../store/store";
import type { TPage } from "../store/route-state";

const HASH_BY_PAGE: Readonly<Record<TPage, string>> = {
  menu: "#/",
  island: "#/island",
  world: "#/world",
  battle: "#/battle",
};

const goToPage = (store: TStore, page: TPage) => {
  store.route.page.value = page;
  store.route.islandPlayerId.value = null;
  window.location.hash = HASH_BY_PAGE[page];
};

const setNicknameAction = (store: TStore, nickname: string) => {
  store.game.nickname.value = nickname;
};

/**
 * Starts a session. The nickname is the world seed, so the same name always
 * grows the same island and the same globe.
 */
const startGameAction = (store: TStore) => {
  const nickname = store.game.nickname.peek().trim() || "Mom010";
  const players = createPlayers(nickname);
  const { world, placement } = createWorld(
    nickname,
    players.map((player) => player.id),
  );

  store.game.nickname.value = nickname;
  store.game.players.value = players.map((player) => ({
    ...player,
    cellId: placement.get(player.id) ?? "",
  }));
  store.world.world.value = world;
  store.game.researched.value = [];
  store.game.turn.value = 1;
  store.game.phase.value = "build";
  store.game.started.value = true;

  goToPage(store, "island");
};

/**
 * The end-turn wheel. Each phase hands over to the next one and takes the
 * player to the page that phase happens on.
 */
const endPhaseAction = (store: TStore) => {
  // An animation owns the turn until it finishes.
  if (store.ui.busy.peek()) {
    return;
  }

  const current = store.game.phase.peek();

  store.ui.armedBuilding.value = null;
  store.ui.demolishMode.value = false;
  store.ui.selectedHexId.value = null;

  if (current === "build") {
    store.game.phase.value = "tax";
    goToPage(store, "island");
    startTaxPhaseAction(store);

    return;
  }

  if (current === "tax") {
    store.game.phase.value = "scout";
    goToPage(store, "world");
    enterExplorationAction(store);

    return;
  }

  if (current === "scout") {
    // An island that did not fly leaves its toxicity in the cell it sat in.
    settleExplorationAction(store);
    store.game.phase.value = "clear";
    goToPage(store, "battle");
    enterClearingAction(store);

    return;
  }

  finishBattleAction(store);
  stopLoop();
  store.game.turn.value = store.game.turn.peek() + 1;
  store.game.phase.value = PHASES[0]?.id ?? "build";
  goToPage(store, "island");
};

export { endPhaseAction, setNicknameAction, startGameAction };
