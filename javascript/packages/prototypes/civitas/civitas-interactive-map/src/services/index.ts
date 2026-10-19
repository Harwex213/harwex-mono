// Public surface of `src/services`: long-lived objects that own DOM outside React.
// Decisions:
// - A service gets its store and registry slice from its creator and never imports an action.
// - Modules inside `src/services` import each other by path, not through this index, so no import cycle forms.
// - The index lists only names used outside `src/services`.
import { MapCanvasService, createMapCanvasService } from "./map-canvas/map-canvas-service";
import { getLastLabelStats } from "./map-canvas/renderer/layers/label-layer";
import type { TMapCanvasServiceRegistry } from "./map-canvas/map-canvas-registry";

export {
  // map-canvas/
  MapCanvasService,
  createMapCanvasService,
  getLastLabelStats,
  type TMapCanvasServiceRegistry,
};
