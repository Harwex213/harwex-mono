import {
  advanceLearningAction,
  hoverTechAction,
  panCanvasAction,
  resizeCanvasAction,
  restartAction,
  selectTechAction,
  startLearningAction,
  zoomCanvasAction,
} from "./actions/research-actions";
import type { TAppRegistry } from "./registry";
import type { TStore } from "../store/store";

const createRegistry = (store: TStore) => {
  const rawRegistry = {
    startLearningAction,
    advanceLearningAction,
    selectTechAction,
    hoverTechAction,
    restartAction,
    zoomCanvasAction,
    panCanvasAction,
    resizeCanvasAction,
  };

  // The actions differ in arity, so the store is bound through one shared shape.
  const registry = Object.entries(rawRegistry).reduce((newRegistry, [name, func]) => {
    const action = func as (store: TStore, ...args: never[]) => void;
    newRegistry[name] = action.bind(null, store);

    return newRegistry;
  }, {} as Record<string, Function>);

  return registry as TAppRegistry;
};

export { createRegistry };
