// The public surface of `src/actions`: every state change. The UI gets each action through the registry.
// Decisions:
// - Action modules import each other by file path, not through this index, so no cycle can form.
// - The subfolders mirror `src/store`: the actions in `map/` mostly change the slices in `store/map/`.

// registry.ts — binds every action below to the store and the datasources.
export {
  createRegistry,
  type TAppRegistry,
} from "./registry";

// map/ — map-actions opens a map, view-actions moves the camera, layer-actions
// paints, fills, picks and undoes; layer-commit ends a layer edit.

// provinces/ — province-actions edits the registry, import-actions loads an export
// back in, detect-actions runs border detection, export-actions downloads the export.

// countries/ — country-actions edits the countries and runs the strokes that
// put provinces into a country.

// tools/ — tool-actions sets the editor mode, the tool, the brush and the layer display options.

// status/ — status-actions shows and dismisses the error and the notice.

// library/ — library-actions opens, retries and closes the map library dialog and loads a pick.
