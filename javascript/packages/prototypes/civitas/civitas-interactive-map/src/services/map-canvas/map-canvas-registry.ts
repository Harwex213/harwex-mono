import type { TAppRegistry } from "../../actions/index";

// The registry slice `MapCanvasService` calls. The creator passes it in, so the service imports no action.
type TMapCanvasServiceRegistry = Pick<
  TAppRegistry,
  | "disposeBorders"
  | "panTo"
  | "resetView"
  | "scanBorders"
  | "selectCountryOfProvince"
  | "selectProvince"
  | "setCursor"
  | "setDpr"
  | "setHoveredProvince"
  | "setPanning"
  | "setViewport"
  | "syncView"
  | "toggleLabels"
  | "zoomAtPoint"
>;

export { type TMapCanvasServiceRegistry };
