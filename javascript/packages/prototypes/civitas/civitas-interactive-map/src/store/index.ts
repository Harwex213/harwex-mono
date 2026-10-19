// Public surface of `src/store`: names used outside the folder.
// Modules inside `src/store` import each other by path, so no import cycle forms.

// - store.ts: builds the store from its slices and hands it to React.
import { StoreProvider, createStore, useStore } from "./store";
import type { TStore } from "./store";

// - map-slice.ts: the loaded map assets and the load progress.
// - view-slice.ts: the camera, the viewport and the cursor.
// - borders-slice.ts: the border tiles from the worker.
// - world-slice.ts: the saved document and the status of its storage.
// - selection-slice.ts: the hovered, selected province and selected country.
// - assign-slice.ts: assign mode and the brush stroke.
// - labels-slice.ts: the country label sources and their cached anchors.
import type { Viewport } from "./view-slice";

// - selectors.ts: read-only lookups over the store, such as `provinceAt`.
import {
  countryContainsPoint,
  mapPixelAt,
  provinceAt,
  provinceById,
  provinceDisplayName,
} from "./selectors";

export {
  // store
  StoreProvider,
  createStore,
  useStore,
  type TStore,
  // slices
  type Viewport,
  // lookups
  countryContainsPoint,
  mapPixelAt,
  provinceAt,
  provinceById,
  provinceDisplayName,
};
