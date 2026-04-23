import type { TGameContext, TGameTurnPhaseEvent } from "../../model/game-context.js";
import { mutableSwap } from "../../utils.js";

export const createEvent = (
  ctx: TGameContext,
  params: {
    event: TGameTurnPhaseEvent;
    afterIndex?: number;
    turn: number;
    phase: number;
  },
) => {
  const currentTurn = ctx.turns[params.turn - 1]!;
  const currentPhase = currentTurn.phases[params.phase - 1]!;

  if (params.afterIndex !== undefined) {
    currentTurn.phases[params.turn - 1] = currentPhase.toSpliced(params.afterIndex + 1, 0, params.event);

    return;
  }

  currentPhase.push(params.event);
};

export const swapEvents = (
  ctx: TGameContext,
  params: {
    firstEventIndex: number;
    secondEventIndex: number;
  }
) => {
  const currentTurn = ctx.turns[ctx.gameState.currentTurn]!;
  const currentPhase = currentTurn.phases[ctx.gameState.currentPhase]!;

  mutableSwap(currentPhase, params.firstEventIndex, params.secondEventIndex);
};
