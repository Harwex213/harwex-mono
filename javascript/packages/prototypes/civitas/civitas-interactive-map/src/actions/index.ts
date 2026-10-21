// The public surface of `src/actions`: every state change. The UI gets each action through the registry.
// Decisions:
// - Action modules import each other by file path, not through this index, so no cycle can form.
// - The subfolders mirror `src/store`: the actions in `map/` mostly change the slices in `store/map/`.

// registry.ts — binds every action below to the store and the datasources.
export {
  createRegistry,
  type TAppRegistry,
} from "./registry";

// map/ — map-actions loads the assets, view-actions moves the camera,
// border-actions runs the border scan and the debounced country border push.

// world/ — world-actions edits countries and province overrides, hydrates and saves the document.

// interaction/ — selection-actions handles hover and selection,
// assign-actions handles assign mode and the brush stroke.

// labels/ — label-actions shows or hides the country labels.
