import { createContext, useContext } from "react";
import { createCountriesSlice } from "./countries/countries-slice";
import { createHoverSlice } from "./provinces/hover-slice";
import { createLibrarySlice } from "./library/library-slice";
import { createMapSlice } from "./map/map-slice";
import { createProvincesSlice } from "./provinces/provinces-slice";
import { createStatusSlice } from "./status/status-slice";
import { createToolsSlice } from "./tools/tools-slice";
import { createViewSlice } from "./map/view-slice";

// The app state as signals and computeds. No setters and no I/O: the UI reads
// through `useStore`, and only actions write.
// Slice layers: map, view, provinces, countries, tools, status, library <- hover.

function createStore() {
  const provinces = createProvincesSlice();

  return {
    map: createMapSlice(),
    view: createViewSlice(),
    provinces,
    hover: createHoverSlice(provinces),
    countries: createCountriesSlice(),
    tools: createToolsSlice(),
    status: createStatusSlice(),
    library: createLibrarySlice(),
  };
}

type TStore = ReturnType<typeof createStore>;

const StoreProvider = createContext<TStore>(null!);

const useStore = () => {
  return useContext(StoreProvider);
};

export {
  StoreProvider,
  createStore,
  useStore,
  type TStore,
};
