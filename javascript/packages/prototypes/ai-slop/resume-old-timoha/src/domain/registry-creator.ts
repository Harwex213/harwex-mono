import { hireAction, setSalaryAction } from "./offer";
import type { TStore } from "../store/store";
import type { TAppRegistry } from "./registry";

const createRegistry = (store: TStore) => {
  const rawRegistry = {
    hireAction,
    setSalaryAction,
  };

  const registry = Object.entries(rawRegistry).reduce((newRegistry, [name, func]) => {
    newRegistry[name] = (func as Function).bind(null, store);

    return newRegistry;
  }, {} as Record<string, Function>);

  return registry as TAppRegistry;
};

export { createRegistry };
