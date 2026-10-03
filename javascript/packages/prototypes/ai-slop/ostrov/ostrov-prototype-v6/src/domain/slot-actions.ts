import { rollSlot } from "../core/toxic-slot";
import { replacePlayer } from "./player-updates";
import { INITIAL_SLOT } from "../store/game-state";
import type { TStore } from "../store/store";

/**
 * The player's toxicity slot. It spins once per turn, when the tax phase
 * ends, if the meter is at "Малые" or above:
 *
 *   closed --tax phase ends--> spinning --reels stop--> done --button--> closed
 *
 * The spin is rolled and applied in one step, before the phase turns to
 * scout, so its result is applied exactly once. The modal then plays the
 * reels left to right and shows the event. The game is already in the scout
 * phase, but the player stays on the island page until the modal's button
 * takes them to the world map.
 */

const WORLD_HASH = "#/world";
/** When each reel stops, counted from the moment the modal opens. */
const REEL_STOP_MS: readonly number[] = [900, 1300, 1700];
/** The pause after the last reel before the event shows. */
const REVEAL_PAUSE_MS = 250;
/** The same steps, short, for a player who asked for less motion. */
const REDUCED_REEL_STOP_MS: readonly number[] = [120, 240, 360];
const REDUCED_REVEAL_PAUSE_MS = 80;

let timers: ReturnType<typeof setTimeout>[] = [];

const clearSlotTimers = () => {
  for (const timer of timers) {
    clearTimeout(timer);
  }

  timers = [];
};

const prefersReducedMotion = () => {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
};

/** A new session forgets the last spin and closes the modal. */
const resetSlot = (store: TStore) => {
  clearSlotTimers();
  store.game.slot.value = INITIAL_SLOT;
};

/**
 * The tax phase ends: the player's slot spins and its event is applied at
 * once. Returns `true` when the modal opened, `false` when the meter is below
 * "Малые" and the slot stays off.
 */
const spinSlotAtTaxEnd = (store: TStore) => {
  const player = store.derived.humanPlayer.peek();
  const turn = store.game.turn.peek();
  const rolled = player ? rollSlot(player, turn, store.game.nickname.peek()) : null;
  if (!rolled) {
    return false;
  }

  clearSlotTimers();
  replacePlayer(store, rolled.player);
  store.game.slot.value = { turn, status: "spinning", stopped: 0, spin: rolled.spin };

  const reduced = prefersReducedMotion();
  const stops = reduced ? REDUCED_REEL_STOP_MS : REEL_STOP_MS;
  const pause = reduced ? REDUCED_REVEAL_PAUSE_MS : REVEAL_PAUSE_MS;

  stops.forEach((delayMs, index) => {
    timers.push(
      setTimeout(() => {
        const current = store.game.slot.peek();
        if (current.status === "spinning") {
          store.game.slot.value = { ...current, stopped: index + 1 };
        }
      }, delayMs),
    );
  });

  const lastStop = stops[stops.length - 1] ?? 0;
  timers.push(
    setTimeout(() => {
      const current = store.game.slot.peek();
      if (current.status === "spinning") {
        store.game.slot.value = { ...current, status: "done", stopped: rolled.spin.reels.length };
      }
    }, lastStop + pause),
  );

  return true;
};

/**
 * "Перейти к фазе разведки". The game is already in the scout phase; the
 * button closes the modal and takes the player to the world map.
 */
const closeSlotModalAction = (store: TStore) => {
  const slot = store.game.slot.peek();
  if (slot.status !== "done") {
    return;
  }

  clearSlotTimers();
  store.game.slot.value = { ...slot, status: "closed" };

  if (store.game.phase.peek() === "scout" && window.location.hash !== WORLD_HASH) {
    window.location.hash = WORLD_HASH;
  }
};

export { closeSlotModalAction, resetSlot, spinSlotAtTaxEnd };
