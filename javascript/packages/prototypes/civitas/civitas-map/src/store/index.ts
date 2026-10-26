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

// selectors.ts — read-only questions over the store, such as `hasWork`.
export {
  hasWork,
} from "./selectors";

// map/ — map-slice holds the open map, its bitmap, the province layer and the
// undo flags; view-slice the camera and the viewport.

// provinces/ — provinces-slice holds the registry and the active province;
// hover-slice the pixel and the province under the cursor.

// countries/ — countries-slice holds the countries, the active country and the open stroke.

// tools/ — tools-slice holds the editor mode, the tool, the brush and the layer display options.

// status/ — status-slice holds the busy flags, the error and the notice.

// library/ — library-slice holds the map library dialog.
export {
  type LibraryMode,
} from "./library/library-slice";
