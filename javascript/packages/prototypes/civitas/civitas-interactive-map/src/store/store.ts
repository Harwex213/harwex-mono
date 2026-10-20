import { createContext, useContext } from "react";
import { createAssignSlice } from "./interaction/assign-slice";
import { createBordersSlice } from "./map/borders-slice";
import { createLabelsSlice } from "./labels/labels-slice";
import { createMapSlice } from "./map/map-slice";
import { createSelectionSlice } from "./interaction/selection-slice";
import { createViewSlice } from "./map/view-slice";
import { createWorldSlice } from "./world/world-slice";

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
