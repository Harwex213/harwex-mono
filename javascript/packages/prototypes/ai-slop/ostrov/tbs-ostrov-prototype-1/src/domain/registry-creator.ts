import {
  regenerateIslandAction,
  rollIslandAction,
  selectTileAction,
  setLandCountAction,
  setSeedTextAction,
  setTerrainWeightAction,
} from "./island-state";
import type { TStore } from "../store/store";
import type { TAppRegistry } from "./registry";

/** Every action takes the store first; the registry binds that argument away. */
type TAction = (store: TStore, ...args: never[]) => unknown;

const createRegistry = (store: TStore) => {
  const rawRegistry: Record<string, TAction> = {
    regenerateIslandAction,
    rollIslandAction,
    selectTileAction,
    setLandCountAction,
    setSeedTextAction,
    setTerrainWeightAction,
  };

  const registry = Object.entries(rawRegistry).reduce((newRegistry, [name, func]) => {
    newRegistry[name] = func.bind(null, store);

    return newRegistry;
  }, {} as Record<string, Function>);

  return registry as unknown as TAppRegistry;
};

export { createRegistry };
