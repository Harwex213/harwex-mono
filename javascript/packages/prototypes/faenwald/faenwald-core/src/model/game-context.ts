import type { THouse } from "./base/house.js";
import type { TProvince, TProvinceRaw } from "./base/province.js";
import type { TArmy } from "./war/army.js";
import type { TGameTurnPhaseWarEvent } from "./war/war.js";

export type TGameTurnPhaseSystemEvent = {
  type: "system";
  event: {
    type: "TSystemEvent_Snapshot";
    eventId: string;
  }
};

export type TGameTurnPhaseEvent = |
  TGameTurnPhaseSystemEvent |
  TGameTurnPhaseWarEvent;

export type TGameTurnPhaseEventType = TGameTurnPhaseEvent["type"];

export type TGameState = {
  houses: Record<string, THouse>;
  provinces: Record<string, TProvince>;
  armies: Record<string, TArmy>;
};

export type TGameTurn = {
  turn: number;
  phases: [
    TGameTurnPhaseEvent[], // 1 phase
    TGameTurnPhaseEvent[], // 2 phase
    TGameTurnPhaseEvent[], // 3 phase
    TGameTurnPhaseEvent[], // 4 phase
    TGameTurnPhaseEvent[], // 5 phase
    TGameTurnPhaseEvent[], // 6 phase
    TGameTurnPhaseEvent[], // 7 phase
    TGameTurnPhaseEvent[], // 8 phase
    TGameTurnPhaseEvent[], // 9 phase
    TGameTurnPhaseEvent[], // 10 phase
    TGameTurnPhaseEvent[], // 11 phase
    TGameTurnPhaseEvent[], // 12 phase
  ];
};

export type TGameContext = {
  provincesRaw: Record<string, TProvinceRaw>;
  counters: {
    globalEvent: number;
    globalArmy: number;
    globalArmyUnit: number;
  };
  gameState: {
    currentTurn: number;
    currentPhase: number;
  };
  allTurnsValid: boolean;
  turns: TGameTurn[];
};
