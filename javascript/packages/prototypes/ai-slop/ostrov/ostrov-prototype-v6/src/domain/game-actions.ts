import { createPlayers } from "../core/island-gen";
import { PHASES } from "../core/phases";
import { createWorld } from "../core/world-gen";
import { pendingIslands } from "../core/world-rules";
import { enterClearingAction, finishClearingAction } from "./cleanup-actions";
import { scheduleRivalStrongholds, startGameAction as startSetupGame } from "./setup-actions";
import { resetSlot, spinSlotAtTaxEnd } from "./slot-actions";
import { clearTaxState, collectRivalTaxAction, collectTaxAction, startTaxPhaseAction } from "./tax-actions";
import { isEveryoneReady, resetReadiness, scheduleRivalReadiness, setPlayerReady, WAITING_NOTICE } from "./ready-actions";
import { showNotice } from "./ui-actions";
import { enterExplorationAction, settleExplorationAction } from "./world-actions";
import type { TStore } from "../store/store";
import type { TPage } from "../store/route-state";

const HASH_BY_PAGE: Readonly<Record<TPage, string>> = {
  island: "#/island",
  world: "#/world",
  battle: "#/battle",
};

const goToPage = (store: TStore, page: TPage) => {
  store.route.page.value = page;
  store.route.islandPlayerId.value = null;
  window.location.hash = HASH_BY_PAGE[page];
};

/**
 * Opens a session on boot. The nickname is the world seed, so the same name
 * always grows the same island and the same globe. The session starts in the
 * `setup` stage on the player's island: the core loop begins once the
 * stronghold stands and the player presses "Начать".
 */
const createSession = (store: TStore) => {
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
  clearTaxState(store);
  resetSlot(store);
  resetReadiness(store);
  store.game.turn.value = 1;
  store.game.phase.value = "build";
  store.game.stage.value = "setup";

  goToPage(store, "island");
  scheduleRivalStrongholds(store);
};

/**
 * The hand-over from the tax phase to the scout phase. The player's toxicity
 * slot spins here and its event is applied at once. When it spins, the player
 * stays on the island page under the slot modal, and the modal's button takes
 * them to the world map. Otherwise the world map opens at once.
 */
const enterScoutPhase = (store: TStore) => {
  if (store.game.phase.peek() !== "tax") {
    return;
  }

  clearTaxState(store);
  const isSpun = spinSlotAtTaxEnd(store);
  store.game.phase.value = "scout";

  if (!isSpun) {
    goToPage(store, "world");
  }

  enterExplorationAction(store);
};

/**
 * Moves the turn on by one phase and takes the player to the page that phase
 * happens on. Only `advanceIfEveryoneReady` calls it. The readiness is reset
 * first, so a late timer or a second press cannot advance the same phase twice.
 */
const advancePhase = (store: TStore) => {
  const current = store.game.phase.peek();

  resetReadiness(store);

  if (current === "build") {
    store.game.phase.value = "tax";
    goToPage(store, "island");
    startTaxPhaseAction(store);
    beginRivalPhase(store);

    return;
  }

  if (current === "tax") {
    enterScoutPhase(store);
    beginRivalPhase(store);

    return;
  }

  if (current === "scout") {
    // An island that did not fly leaves its toxicity in the cell it sat in.
    settleExplorationAction(store);
    store.game.phase.value = "clear";
    beginRivalPhase(store);

    // A cell with no wild islands has nothing to clear. The player stays on
    // the world map, is ready at once and waits for the rivals' cleanup.
    if (pendingIslands(store.derived.currentCell.peek()) === 0) {
      store.battle.sim.value = null;
      store.battle.result.value = null;
      markHumanReady(store);

      return;
    }

    goToPage(store, "battle");
    enterClearingAction(store);

    return;
  }

  finishClearingAction(store);
  store.game.turn.value = store.game.turn.peek() + 1;
  store.game.phase.value = PHASES[0]?.id ?? "build";
  goToPage(store, "island");
  beginRivalPhase(store);
};

const advanceIfEveryoneReady = (store: TStore) => {
  if (store.game.stage.peek() !== "play" || !isEveryoneReady(store)) {
    return;
  }

  advancePhase(store);
};

/**
 * One rival plays the current phase and turns ready. The bots do not build,
 * scout or fight yet, so only the tax phase has work for them: their dice are
 * paid and their slot spins, once.
 */
const finishRivalPhase = (store: TStore, rivalId: string) => {
  if (store.game.phase.peek() === "tax") {
    collectRivalTaxAction(store, rivalId);
  }

  setPlayerReady(store, rivalId, true);
  advanceIfEveryoneReady(store);
};

/**
 * Starts the rivals' side of the phase that has just opened. Every phase
 * start calls it; a second call in the same phase keeps the running timers.
 */
const beginRivalPhase = (store: TStore) => {
  scheduleRivalReadiness(store, (rivalId) => finishRivalPhase(store, rivalId));
};

/** The player is done with the phase. The phase moves on if the rivals are done too. */
const markHumanReady = (store: TStore) => {
  setPlayerReady(store, store.game.humanPlayerId.peek(), true);
  advanceIfEveryoneReady(store);
};

/**
 * "Начать". The setup flow plays the start animation, and the rivals start
 * their first build phase at the same moment.
 */
const startGameAction = (store: TStore) => {
  startSetupGame(store);

  if (store.game.stage.peek() === "starting") {
    beginRivalPhase(store);
  }
};

/**
 * The end-turn wheel. A press marks the player ready, and the phase moves on
 * once every player is ready. A second press takes the readiness back while
 * the others still play, except where `isReadyLocked` says it is final. In the
 * tax phase the press collects the dice first, and the player turns ready once
 * the payouts have landed.
 */
const endPhaseAction = (store: TStore) => {
  // An animation owns the turn until it finishes, and the turn does not run
  // before the game has started.
  if (store.ui.busy.peek() || store.game.stage.peek() !== "play") {
    return;
  }

  const humanId = store.game.humanPlayerId.peek();

  if (store.derived.isHumanReady.peek()) {
    if (store.derived.isReadyLocked.peek()) {
      showNotice(store, WAITING_NOTICE);

      return;
    }

    setPlayerReady(store, humanId, false);

    return;
  }

  const current = store.game.phase.peek();

  // The level has to end before the player can be ready: the wheel asks for
  // the results first, and the results modal hands the turn on.
  if (current === "clear" && store.battle.sim.peek() && !store.battle.result.peek()) {
    return;
  }

  store.ui.armedBuilding.value = null;
  store.ui.demolishMode.value = false;
  store.ui.selectedHexId.value = null;
  store.ui.demolishTargetHexId.value = null;
  store.ui.taxPickHexId.value = null;

  if (current === "tax") {
    // Pressing "Собрать" pays the player's dice once. The player is ready
    // once the payouts have landed. The rivals are paid by their own timers.
    const tax = store.game.tax.peek();
    if (tax?.status === "collecting") {
      return;
    }

    if (tax?.status === "rolled" && collectTaxAction(store, () => markHumanReady(store))) {
      return;
    }
  }

  markHumanReady(store);
};

export { createSession, endPhaseAction, startGameAction };
