import type { TAppRegistry } from "../../actions/index";

// The registry slice the map canvas service calls.
type TMapCanvasServiceRegistry = Pick<
  TAppRegistry,
  | "beginStroke"
  | "endStroke"
  | "extendStroke"
  | "fillAt"
  | "measureViewport"
  | "panTo"
  | "pickAt"
  | "setHover"
  | "zoomAtPoint"
>;

export { type TMapCanvasServiceRegistry };
