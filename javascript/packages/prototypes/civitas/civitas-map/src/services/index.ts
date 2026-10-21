// The public surface of `src/services`: long-lived objects that own a piece of the
// DOM outside React. A service gets the store and its registry slice from its creator.
// Decisions:
// - Service modules import each other by file path, not through this index, so no cycle can form.

// map-canvas/ — the map canvas: input, resize, the space key, the redraw effects
// and the renderer. `renderer/layer-canvas.ts` keeps the canvas copy of the layer.
export {
  createMapCanvasService,
  type MapCanvasService,
} from "./map-canvas/map-canvas-service";
export {
  type TMapCanvasServiceRegistry,
} from "./map-canvas/map-canvas-registry";
