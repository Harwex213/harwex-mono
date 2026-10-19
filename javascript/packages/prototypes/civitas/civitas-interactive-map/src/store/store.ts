import { createContext, useContext } from "react";
import { createAssignSlice } from "./assign-slice";
import { createBordersSlice } from "./borders-slice";
import { createLabelsSlice } from "./labels-slice";
import { createMapSlice } from "./map-slice";
import { createSelectionSlice } from "./selection-slice";
import { createViewSlice } from "./view-slice";
import { createWorldSlice } from "./world-slice";

// The app state as signals and computeds. No setters and no I/O: the UI reads
// through `useStore`, and only actions write.
// Slice layers: map, view, borders, world <- selection, assign, labels.

function createStore() {
  const map = createMapSlice();
  const world = createWorldSlice();
  return {
    map,
    view: createViewSlice(),
    borders: createBordersSlice(),
    world,
    selection: createSelectionSlice(map, world),
    assign: createAssignSlice(world),
    labels: createLabelsSlice(map, world),
  };
}

type TStore = ReturnType<typeof createStore>;

const StoreProvider = createContext<TStore>(null!);

const useStore = () => {
  return useContext(StoreProvider);
};

export { StoreProvider, createStore, useStore, type TStore };
