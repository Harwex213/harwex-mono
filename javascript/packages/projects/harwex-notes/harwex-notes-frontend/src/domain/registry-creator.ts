import type { TAppRegistry } from "@hw/harwex-notes-protocol";
import {
  excalidrawDocumentChangedAction,
  markdownDocumentChangedAction,
  reloadDocumentAction,
} from "./documents-state";
import { resizeSidebarAction } from "./layout-state";
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
import type { TStore } from "../store/store";
import type { TApiClient } from "../api/api";

const createRegistry = (store: TStore, api: TApiClient) => {
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
    excalidrawDocumentChangedAction,
    markdownDocumentChangedAction,
    resizeSidebarAction,
  };

  const entries = Object.entries(rawRegistry) as readonly [string, Function][];

  const registry = entries.reduce((newRegistry, [name, func]) => {
    newRegistry[name] = func.bind(null, store, api);

    return newRegistry;
  }, {} as Record<string, Function>);

  return registry as TAppRegistry;
};

export { createRegistry };
