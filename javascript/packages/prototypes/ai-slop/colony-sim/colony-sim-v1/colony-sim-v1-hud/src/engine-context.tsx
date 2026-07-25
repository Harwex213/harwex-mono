import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { Dispatcher } from "@hw/colony-sim-v1-core";

// The HUD holds a command sink, not the engine class: sending commands is the
// whole of what it may do, and typing the context this way makes reaching for the
// world a compile error instead of a habit.
const EngineContext = createContext<Dispatcher | null>(null);

function useEngine(): Dispatcher {
  const engine = useContext(EngineContext);
  if (!engine) {
    throw new Error("useEngine must be used within an EngineProvider");
  }
  return engine;
}

const EngineProvider = EngineContext.Provider;

export { EngineProvider, useEngine };
