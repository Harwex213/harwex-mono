import { signal } from "@preact/signals-react";
import { HUMAN_PLAYER_ID } from "../core/island-gen";
import type { TTechId } from "../core/techs";
import type { TPhase, TPlayer } from "../core/types";

/**
 * Game truth: who plays, what their islands look like and where in the core
 * loop the turn is. Only the build phase writes here so far.
 */
const createGameState = () => ({
  started: signal<boolean>(false),
  nickname: signal<string>("Mom010"),
  turn: signal<number>(1),
  phase: signal<TPhase>("build"),
  players: signal<readonly TPlayer[]>([]),
  humanPlayerId: signal<string>(HUMAN_PLAYER_ID),
  /** What the player has researched. Order is the order they took them in. */
  researched: signal<readonly TTechId[]>([]),
});

type TGameState = ReturnType<typeof createGameState>;

export type { TGameState };
export { createGameState };
