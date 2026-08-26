import { reloadDocumentAction } from "./documents-state";
import { loadTreeAction, toggleFolderAction } from "./fs-state";
import { activateTabAction, closeTabAction, openNodeAction } from "./tabs-state";
import type { TApi } from "../api/types";
import type { TStore } from "../store/store";
import type { TAppRegistry } from "./registry";

const createRegistry = (store: TStore, api: TApi) => {
  const rawRegistry = {
    loadTreeAction,
    toggleFolderAction,
    openNodeAction,
    activateTabAction,
    closeTabAction,
    reloadDocumentAction,
  };

  const registry = Object.entries(rawRegistry).reduce((newRegistry, [name, func]) => {
    newRegistry[name] = func.bind(null, store, api);

    return newRegistry;
  }, {} as Record<string, Function>);

  return registry as TAppRegistry;
};

export { createRegistry };
