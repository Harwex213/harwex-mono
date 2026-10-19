// Public surface of `src/actions`. The UI gets every action through the registry.
// Modules inside `src/actions` import each other by path, so no import cycle forms.

// - registry.ts: binds every action to the store and the datasources.
import { createRegistry } from "./registry";
import type { TAppRegistry } from "./registry";

// - map-actions.ts: loads the map assets.
// - view-actions.ts: the camera. Fit, zoom, pan, viewport and cursor.
// - selection-actions.ts: hover and selection of provinces and countries.
// - assign-actions.ts: assign mode and the brush stroke.
// - world-actions.ts: countries, province overrides, hydration and saving.
// - border-actions.ts: the border scan and the debounced country border push.
// - label-actions.ts: shows or hides the country labels.

export {
  // registry
  createRegistry,
  type TAppRegistry,
};
