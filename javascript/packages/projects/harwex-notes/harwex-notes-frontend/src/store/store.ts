import { createContext, useContext } from "react";
import { createDerivedState } from "./derived-state";
import { createDocumentsState } from "./documents-slice";
import { createFsState } from "./fs-slice";
import { createLayoutState } from "./layout-slice";
import { createTabsState } from "./tabs-slice";

const createStore = () => {
  const fs = createFsState();
  const tabs = createTabsState();
  const documents = createDocumentsState();
  const layout = createLayoutState();

  return {
    fs,
    tabs,
    documents,
    layout,
    derived: createDerivedState(fs, tabs, documents),
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
export type { TDocumentEntry } from "./documents-slice";
export type { TFsDraft } from "./fs-slice";
export { StoreProvider, createStore, useStore };
