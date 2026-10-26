// The public surface of `src/actions`: every state change. The UI gets each action through the registry.
// Decisions:
// - Action modules import each other by file path, not through this index, so no cycle can form.
// - The subfolders mirror `src/store`: the actions in `map/` mostly change the slices in `store/map/`.

// registry.ts — binds every action below to the store and the datasources.
export {
  createRegistry,
  type TAppRegistry,
} from "./registry";

// map/ — map-actions loads the assets and the countries, view-actions moves the camera,
// border-actions runs the border scan and the debounced country border push.

// world/ — world-actions hides the countries repair notice.

// interaction/ — selection-actions handles hover and selection.

// labels/ — label-actions shows or hides the country labels.
