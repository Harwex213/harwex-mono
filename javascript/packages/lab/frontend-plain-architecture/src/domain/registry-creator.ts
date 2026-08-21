import { clickButtonAction } from "./button-state";
import type { TStore } from "../store/store";
import type { TAppRegistry } from "./registry";

const createRegistry = (store: TStore) => {
  const rawRegistry = {
    clickButtonAction,
  };

  const registry = Object.entries(rawRegistry).reduce((newRegistry, [name, func]) => {
    newRegistry[name] = func.bind(null, store);

    return newRegistry;
  }, {} as Record<string, Function>);

  return registry as TAppRegistry;
}

export { createRegistry };
