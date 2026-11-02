import { createPick, forgetPick, joinPick, navigate } from "./app-actions";
import { confirmMap, selectMap } from "./pick-actions";
import type { TStore } from "../store/store";
import type { TAppRegistry } from "./registry";

const createRegistry = (store: TStore) => {
  const rawRegistry = {
    navigate,
    createPick,
    joinPick,
    forgetPick,
    selectMap,
    confirmMap,
  };

  const registry = Object.entries(rawRegistry).reduce((newRegistry, [name, func]) => {
    newRegistry[name] = (func as Function).bind(null, store);

    return newRegistry;
  }, {} as Record<string, Function>);

  return registry as TAppRegistry;
};

export { createRegistry };
