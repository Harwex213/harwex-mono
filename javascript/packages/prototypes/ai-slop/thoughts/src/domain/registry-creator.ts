import {
  addThoughtAction,
  deleteThoughtAction,
  dismissDeletedAction,
  moveThoughtAction,
  reorderThoughtAction,
  restoreDeletedAction,
  setActiveCategoryAction,
  updateThoughtTextAction,
} from "./actions";
import type { TStore } from "../store/store";
import type { TAppRegistry } from "./registry";

const createRegistry = (store: TStore) => {
  const rawRegistry = {
    addThoughtAction,
    deleteThoughtAction,
    updateThoughtTextAction,
    moveThoughtAction,
    reorderThoughtAction,
    restoreDeletedAction,
    dismissDeletedAction,
    setActiveCategoryAction,
  };

  const registry = Object.entries(rawRegistry).reduce((newRegistry, [name, func]) => {
    newRegistry[name] = (func as Function).bind(null, store);

    return newRegistry;
  }, {} as Record<string, Function>);

  return registry as TAppRegistry;
};

export { createRegistry };
