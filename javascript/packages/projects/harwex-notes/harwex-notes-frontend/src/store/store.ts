import { createContext, useContext } from "react";
import { createDerivedState } from "./derived-state";
import { createDocumentsState } from "./documents-slice";
import { createExcalidrawDerivedState } from "./excalidraw-derived-state";
import { createFsState } from "./fs-slice";
import { createLayoutState } from "./layout-slice";
import { createSearchState } from "./search-slice";
import { createSessionState } from "./session-slice";
import { createSyncDerivedState } from "./sync-derived-state";
import { createSyncState } from "./sync-slice";
import { createTabsState } from "./tabs-slice";

const createStore = () => {
  const fs = createFsState();
  const tabs = createTabsState();
  const documents = createDocumentsState();
  const layout = createLayoutState();
  const search = createSearchState();
  const session = createSessionState();
  const sync = createSyncState();

  return {
    fs,
    tabs,
    documents,
    layout,
    search,
    session,
    sync,
    derived: {
      ...createDerivedState(fs, tabs, documents, search),
      ...createSyncDerivedState(fs, documents),
      ...createExcalidrawDerivedState(fs, session),
    },
  };
};

type TStore = ReturnType<typeof createStore>;

const StoreContext = createContext<TStore | null>(null);

const StoreProvider = StoreContext.Provider;

const useStore = () => {
  const store = useContext(StoreContext);
  if (store === null) {
    throw new Error("useStore was called outside of a StoreProvider");
  }

  return store;
};

export type { TStore };
export type { TDocumentEntry, TDocumentSaveState } from "./documents-slice";
export type { TFsDraft } from "./fs-slice";
export { StoreProvider, createStore, useStore };
