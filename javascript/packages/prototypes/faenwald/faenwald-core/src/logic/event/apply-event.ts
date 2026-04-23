import type { TGameState, TGameTurnPhaseEvent } from "../../model/game-context.js";
import { applyWarEvent } from "./apply-war-event.js";

export const applyEvent = (gameState: TGameState, event: TGameTurnPhaseEvent) => {
  if (event.type === "war") {
    applyWarEvent(gameState, event);
    return;
  }
};
