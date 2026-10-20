// The public surface of `src/store`: signals and computeds, no state changes, no I/O.
// Decisions:
// - Store modules import each other by file path, not through this index, so no cycle can form.
// - The subfolders mirror `src/actions`: the slices in `map/` are mostly changed by `actions/map/`.

// store.ts — builds the store from its slices and hands it to React.
export {
  StoreProvider,
  createStore,
  useStore,
  type TStore,
} from "./store";

// selectors.ts — read-only lookups over the store, such as `provinceAt`.
export {
  countryContainsPoint,
  mapPixelAt,
  provinceAt,
  provinceById,
  provinceDisplayName,
} from "./selectors";

// map/ — map-slice holds the loaded assets and the load progress,
// view-slice the camera, the viewport and the cursor, borders-slice the border tiles.
export {
  type Viewport,
} from "./map/view-slice";

// world/ — world-slice holds the saved document and the status of its storage.

// interaction/ — selection-slice holds the hovered and selected province and the selected country,
// assign-slice holds assign mode and the brush stroke.

// labels/ — labels-slice holds the country label sources and their cached anchors.
