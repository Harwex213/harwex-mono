import { signal } from "@preact/signals-react";
import { HUMAN_PLAYER_ID } from "../core/island-gen";
import type { TTaxPlan } from "../core/tax-plan";
import type { TSlotSpin } from "../core/toxic-slot";
import type { TTechId } from "../core/techs";
import type { TGameStage, TPhase, TPlayer } from "../core/types";

/**
 * The tax phase in progress. `rolled`: the dice are thrown and the player may
 * spend power on them. `collecting`: the phase is ending, the payouts are in
 * flight, and the plans can no longer change. `collected`: everything is paid,
 * and a second skip or press cannot pay it again.
 */
type TTaxState = {
  readonly turn: number;
  readonly status: "rolled" | "collecting" | "collected";
  /** One plan per player, the bots included. */
  readonly plans: readonly TTaxPlan[];
  /**
   * The rivals already paid this phase. A rival is paid by its own timer,
   * while the player still plays, and this list keeps it to one payout.
   */
  readonly paidRivalIds: readonly string[];
};

/**
 * The toxicity slot modal of the player. The spin is rolled and applied when
 * the tax phase ends. `spinning`: the modal is open and `stopped` reels have
 * stopped. `done`: every reel has stopped and the event shows. `closed`: no
 * modal. `spin` keeps the last result.
 */
type TSlotStatus = "closed" | "spinning" | "done";

type TSlotState = {
  readonly turn: number;
  readonly status: TSlotStatus;
  readonly stopped: number;
  readonly spin: TSlotSpin | null;
};

const INITIAL_SLOT: TSlotState = { turn: 0, status: "closed", stopped: 0, spin: null };

/**
 * Game truth: who plays, what their islands look like and where in the core
 * loop the turn is. Only the build phase writes here so far.
 */
const createGameState = () => ({
  /** A session opens in `setup`: the players place their strongholds first. */
  stage: signal<TGameStage>("setup"),
  /** The world seed. The same name always grows the same islands and globe. */
  nickname: signal<string>("Mom010"),
  turn: signal<number>(1),
  phase: signal<TPhase>("build"),
  players: signal<readonly TPlayer[]>([]),
  humanPlayerId: signal<string>(HUMAN_PLAYER_ID),
  /** What the player has researched. Order is the order they took them in. */
  researched: signal<readonly TTechId[]>([]),
  /** Set for the length of the tax phase, `null` in every other phase. */
  tax: signal<TTaxState | null>(null),
  /**
   * The players who have pressed "Готов" in the current phase. The phase moves
   * on once every player is here, and the list is emptied for the next phase.
   */
  ready: signal<readonly string[]>([]),
  /** The player's toxicity slot. The bots spin silently and keep no state. */
  slot: signal<TSlotState>(INITIAL_SLOT),
});

type TGameState = ReturnType<typeof createGameState>;

export type { TGameState, TSlotState, TSlotStatus, TTaxState };
export { createGameState, INITIAL_SLOT };
