import { createContext, useContext } from "react";
import type { GameEngine } from "../engine";

const EngineContext = createContext<GameEngine | null>(null);

function useEngine(): GameEngine {
  const engine = useContext(EngineContext);
  if (!engine) {
    throw new Error("useEngine must be used within an EngineProvider");
  }
  return engine;
}

const EngineProvider = EngineContext.Provider;

export { EngineProvider, useEngine };
