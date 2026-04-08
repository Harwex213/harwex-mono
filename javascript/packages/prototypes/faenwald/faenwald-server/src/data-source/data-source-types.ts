export type TGameContextSerialized = {
  counters: {
    globalEvent: number;
    globalArmy: number;
    globalArmyUnit: number;
  };
  gameState: {
    currentTurn: number;
    currentPhase: number;
  };
};
