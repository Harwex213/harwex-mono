import type { TAppRegistry } from "../../actions/index";

// The registry slice the map canvas service calls.
type TMapCanvasServiceRegistry = Pick<
  TAppRegistry,
  | "beginCountryStroke"
  | "beginStroke"
  | "endCountryStroke"
  | "endStroke"
  | "extendCountryStroke"
  | "extendStroke"
  | "fillAt"
  | "measureViewport"
  | "panTo"
  | "pickAt"
  | "setHover"
  | "zoomAtPoint"
>;

export { type TMapCanvasServiceRegistry };
