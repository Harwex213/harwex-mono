import { createRng, hashSeed } from "../core/rng";
import { canPlaceStronghold, hasStronghold, pickStrongholdHex, withStronghold } from "../core/stronghold";
import { replacePlayer } from "./player-updates";
import { showNotice } from "./ui-actions";
import type { TStore } from "../store/store";

/**
 * The start of the game. The session opens on the player's island in the
 * `setup` stage: the player clicks a hex to put the stronghold there and
 * presses "Начать". The rivals are bots, and they place their strongholds on
 * their own after a short delay each, so the players list fills up live.
 */

/** When each rival places its stronghold, counted from the session start. */
const RIVAL_PLACE_DELAYS_MS: readonly number[] = [900, 1900, 3100];
/** The vignette comes in and the start button leaves. */
const STARTING_MS = 650;
/** The build phase HUD slides in. */
const ENTERING_MS = 650;

let rivalTimeoutIds: ReturnType<typeof setTimeout>[] = [];

const clearRivalTimers = () => {
  for (const timeoutId of rivalTimeoutIds) {
    clearTimeout(timeoutId);
  }

  rivalTimeoutIds = [];
};

/** Places one rival's stronghold, unless it already has one. */
const placeRivalStronghold = (store: TStore, playerId: string) => {
  const player = store.game.players.peek().find((candidate) => candidate.id === playerId);
  if (!player || player.isHuman || hasStronghold(player)) {
    return;
  }

  const rng = createRng(hashSeed(`${store.game.nickname.peek()}:stronghold:${player.id}`));
  const hexId = pickStrongholdHex(player.island, rng);
  if (!hexId) {
    return;
  }

  replacePlayer(store, withStronghold(player, hexId));
};

/** Called once per session: the rivals place their strongholds one by one. */
const scheduleRivalStrongholds = (store: TStore) => {
  clearRivalTimers();

  const rivals = store.game.players.peek().filter((player) => !player.isHuman);

  rivals.forEach((rival, index) => {
    const delayMs = RIVAL_PLACE_DELAYS_MS[index] ?? RIVAL_PLACE_DELAYS_MS[RIVAL_PLACE_DELAYS_MS.length - 1] ?? 0;
    const timeoutId = setTimeout(() => {
      placeRivalStronghold(store, rival.id);
    }, delayMs);

    rivalTimeoutIds.push(timeoutId);
  });
};

/**
 * A click on a hex during setup. The first click places the stronghold, and a
 * later click moves it. The choice is final once "Начать" is pressed.
 */
const placeStrongholdAction = (store: TStore, hexId: string) => {
  if (store.game.stage.peek() !== "setup") {
    return;
  }

  const player = store.derived.humanPlayer.peek();
  if (!player) {
    return;
  }

  if (!canPlaceStronghold(player.island, hexId)) {
    showNotice(store, "Твердыню можно поставить только на свободный гекс своего острова");

    return;
  }

  replacePlayer(store, withStronghold(player, hexId));
};

/**
 * The "Начать" button. It is refused until the player's stronghold stands.
 * The bots that have not placed theirs yet do it now, and the page plays the
 * start animation before the build phase opens.
 */
const startGameAction = (store: TStore) => {
  if (store.game.stage.peek() !== "setup") {
    return;
  }

  const player = store.derived.humanPlayer.peek();
  if (!player || !hasStronghold(player)) {
    showNotice(store, "Сначала поставьте твердыню");

    return;
  }

  clearRivalTimers();

  for (const rival of store.game.players.peek()) {
    placeRivalStronghold(store, rival.id);
  }

  store.ui.hoveredHexId.value = null;
  store.ui.hoverAnchor.value = null;
  store.ui.selectedHexId.value = null;
  store.game.stage.value = "starting";

  setTimeout(() => {
    store.game.stage.value = "entering";

    setTimeout(() => {
      store.game.stage.value = "play";
    }, ENTERING_MS);
  }, STARTING_MS);
};

export { placeStrongholdAction, scheduleRivalStrongholds, startGameAction };
