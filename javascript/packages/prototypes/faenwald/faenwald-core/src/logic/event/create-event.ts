import type { TGameContext, TGameTurnPhaseEvent } from "../../model/game-context.js";
import { mutableSwap } from "../../utils.js";
import { FaenwaldCoreError } from "../../model/core-error.js";
import type { TGameTurnPhaseWarEvent } from "../../model/war/war.js";

export const getWarEvent = <Type extends TGameTurnPhaseWarEvent["event"]>(
  ctx: TGameContext,
  params: {
    eventId: string;
    type: Type["type"];
  },
): Type => {
  const currentTurn = ctx.turns[ctx.gameState.currentTurn]!;
  const currentPhase = currentTurn.phases[ctx.gameState.currentPhase]!;

  const event = currentPhase.find((e) => e.event.eventId === params.eventId);
  if (!event) {
    throw new FaenwaldCoreError(`Unable to resolve Event by id ${params.eventId}`);
  }

  if (event.event.type !== params.type) {
    throw new FaenwaldCoreError(`Event was found (${event.event.type}). But it type not equal to requested ${params.type}`);
  }

  return event.event as Type;
};

export const createEvent = (
  ctx: TGameContext,
  params: {
    event: TGameTurnPhaseEvent;
    afterIndex?: number;
  },
) => {
  const currentTurn = ctx.turns[ctx.gameState.currentTurn]!;
  const currentPhase = currentTurn.phases[ctx.gameState.currentPhase]!;

  if (params.afterIndex !== undefined) {
    currentTurn.phases[ctx.gameState.currentPhase] = currentPhase.toSpliced(params.afterIndex + 1, 0, params.event);

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
