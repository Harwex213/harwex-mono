import type { TAppRegistry } from "@hw/harwex-notes-protocol";
import {
  excalidrawDocumentChangedAction,
  flushDocumentsAction,
  markdownDocumentChangedAction,
  reloadDocumentAction,
  textDocumentChangedAction,
} from "./documents-state";
import { excalidrawViewportChangedAction } from "./excalidraw-state";
import { resizeSidebarAction } from "./layout-state";
import { pageHiddenAction } from "./page-state";
import { changeSearchAction, clearSearchAction } from "./search-state";
import { resolveVaultImageAction } from "./vault-images";
import { setSettingAction } from "./session-state";
import { discardConflictAction, overwriteConflictAction, restoreDocumentAction } from "./sync-state";
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
import {
  activateTabAction,
  closeTabAction,
  dismissLinkErrorAction,
  openNodeAction,
  openVaultLinkAction,
} from "./tabs-state";
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
    textDocumentChangedAction,
    resolveVaultImageAction,
    flushDocumentsAction,
    resizeSidebarAction,
    changeSearchAction,
    clearSearchAction,
    setSettingAction,
    excalidrawViewportChangedAction,
    openVaultLinkAction,
    dismissLinkErrorAction,
    pageHiddenAction,
    overwriteConflictAction,
    discardConflictAction,
    restoreDocumentAction,
  };

  const entries = Object.entries(rawRegistry) as readonly [string, Function][];

  const registry = entries.reduce((newRegistry, [name, func]) => {
    newRegistry[name] = func.bind(null, store, api);

    return newRegistry;
  }, {} as Record<string, Function>);

  return registry as TAppRegistry;
};

export { createRegistry };
