import { reloadDocumentAction } from "./documents-state";
import {
  cancelDraftAction,
  deleteNodeAction,
  loadTreeAction,
  moveNodeAction,
  selectNodeAction,
  startCreateAction,
  startRenameAction,
  submitDraftAction,
  toggleFolderAction,
} from "./fs-state";
import { activateTabAction, closeTabAction, openNodeAction } from "./tabs-state";
import type { TApi } from "../api/types";
import type { TStore } from "../store/store";
import type { TAppRegistry } from "./registry";

const createRegistry = (store: TStore, api: TApi) => {
  const rawRegistry = {
    loadTreeAction,
    toggleFolderAction,
    openNodeAction,
    selectNodeAction,
    startCreateAction,
    startRenameAction,
    cancelDraftAction,
    submitDraftAction,
    moveNodeAction,
    deleteNodeAction,
    activateTabAction,
    closeTabAction,
    reloadDocumentAction,
  };

  const entries = Object.entries(rawRegistry) as readonly [string, Function][];

  const registry = entries.reduce((newRegistry, [name, func]) => {
    newRegistry[name] = func.bind(null, store, api);

    return newRegistry;
  }, {} as Record<string, Function>);

  return registry as TAppRegistry;
};

export { createRegistry };
