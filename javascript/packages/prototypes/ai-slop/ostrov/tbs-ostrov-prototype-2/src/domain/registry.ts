import type { TNumericParamKey } from "./generator/params";
import type { TToggleKey } from "./view-state";

type TGenerateMapAction = () => void;
type TSetSeedAction = (seed: string) => void;
type TSetParamAction = (key: TNumericParamKey, value: number) => void;
type TSetMapSizeAction = (size: number) => void;
type TRandomizeSeedAction = () => void;
type TResetParamsAction = () => void;
type THoverHexAction = (index: number) => void;
type TSelectIslandAction = (islandId: number) => void;
type TFocusIslandAction = (islandId: number) => void;
type TSetViewportAction = (width: number, height: number) => void;
type TPanAction = (deltaX: number, deltaY: number) => void;
type TZoomAtAction = (screenX: number, screenY: number, factor: number) => void;
type TSetZoomAction = (zoom: number) => void;
type TFitMapAction = () => void;
type TToggleViewOptionAction = (key: TToggleKey) => void;

type TAppRegistry = {
  generateMapAction: TGenerateMapAction;
  setSeedAction: TSetSeedAction;
  setParamAction: TSetParamAction;
  setMapSizeAction: TSetMapSizeAction;
  randomizeSeedAction: TRandomizeSeedAction;
  resetParamsAction: TResetParamsAction;
  hoverHexAction: THoverHexAction;
  selectIslandAction: TSelectIslandAction;
  focusIslandAction: TFocusIslandAction;
  setViewportAction: TSetViewportAction;
  panAction: TPanAction;
  zoomAtAction: TZoomAtAction;
  setZoomAction: TSetZoomAction;
  fitMapAction: TFitMapAction;
  toggleViewOptionAction: TToggleViewOptionAction;
};

export type {
  TAppRegistry,
  TFitMapAction,
  TFocusIslandAction,
  TGenerateMapAction,
  THoverHexAction,
  TPanAction,
  TRandomizeSeedAction,
  TResetParamsAction,
  TSelectIslandAction,
  TSetMapSizeAction,
  TSetParamAction,
  TSetSeedAction,
  TSetViewportAction,
  TSetZoomAction,
  TToggleViewOptionAction,
  TZoomAtAction,
};
