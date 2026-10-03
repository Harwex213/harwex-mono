import { createRng, hashSeed } from "../core/rng";
import type { TStore } from "../store/store";

/**
 * Readiness at the end of a phase. A phase moves on once every player has
 * pressed "Готов". The rivals are bots. Their phase starts together with the
 * player's: each one plays its phase and becomes ready after a short seeded
 * delay, counted from the start of the phase. A rival that finishes first
 * shows its check mark while the player still plays. The timers follow the
 * pattern of the setup strongholds in `setup-actions.ts`.
 */

/** The fastest rival finishes its phase this long after the phase starts. */
const RIVAL_READY_MIN_MS = 1200;
/** The seeded part of each rival's delay is up to this long. */
const RIVAL_READY_SPREAD_MS = 4800;

/** The hint over the waiting vignette, and the notice for a refused click. */
const WAITING_NOTICE = "Ожидание игроков…";

let rivalTimeoutIds: ReturnType<typeof setTimeout>[] = [];
/** The phase whose rivals are already scheduled. A second call keeps their timers. */
let scheduledPhaseKey: string | null = null;

const phaseKey = (store: TStore) => `${store.game.turn.peek()}:${store.game.phase.peek()}`;

const clearReadyTimers = () => {
  for (const timeoutId of rivalTimeoutIds) {
    clearTimeout(timeoutId);
  }

  rivalTimeoutIds = [];
  scheduledPhaseKey = null;
};

/** Empties the list and drops the pending rival timers. Every phase change calls it. */
const resetReadiness = (store: TStore) => {
  clearReadyTimers();
  store.game.ready.value = [];
};

const setPlayerReady = (store: TStore, playerId: string, isReady: boolean) => {
  const ready = store.game.ready.peek();
  if (ready.includes(playerId) === isReady) {
    return;
  }

  store.game.ready.value = isReady ? [...ready, playerId] : ready.filter((id) => id !== playerId);
};

const isEveryoneReady = (store: TStore) => {
  const players = store.game.players.peek();
  const ready = store.game.ready.peek();

  return players.length > 0 && players.every((player) => ready.includes(player.id));
};

/**
 * Starts the rival timers of the current phase, once per phase. When a
 * rival's timer fires, `onRivalDone` plays that rival's phase and marks it
 * ready. A timer from a phase that has already moved on does nothing.
 */
const scheduleRivalReadiness = (store: TStore, onRivalDone: (rivalId: string) => void) => {
  const key = phaseKey(store);
  if (scheduledPhaseKey === key) {
    return;
  }

  clearReadyTimers();
  scheduledPhaseKey = key;

  const seed = store.game.nickname.peek();
  const ready = store.game.ready.peek();
  const rivals = store.game.players.peek().filter((player) => !player.isHuman && !ready.includes(player.id));

  for (const rival of rivals) {
    const rng = createRng(hashSeed(`${seed}:ready:${key}:${rival.id}`));
    const delayMs = RIVAL_READY_MIN_MS + Math.floor(rng() * RIVAL_READY_SPREAD_MS);
    const timeoutId = setTimeout(() => {
      if (phaseKey(store) !== key) {
        return;
      }

      onRivalDone(rival.id);
    }, delayMs);

    rivalTimeoutIds.push(timeoutId);
  }
};

export { isEveryoneReady, resetReadiness, scheduleRivalReadiness, setPlayerReady, WAITING_NOTICE };
