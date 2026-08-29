import type { TBuildingKind } from "./game/types";

export type TBuildAction = (tileIndex: number, kind: TBuildingKind) => void;
export type TDemolishAction = (tileIndex: number) => void;
export type TEndTurnAction = () => void;
export type THoverTileAction = (index: number) => void;
export type TPickBuildingAction = (kind: TBuildingKind | null) => void;
export type TRestartAction = () => void;
export type TSelectTileAction = (index: number) => void;
export type TSetHexSizeAction = (size: number) => void;
export type TToggleYieldsAction = () => void;

export type TAppRegistry = {
  buildAction: TBuildAction;
  demolishAction: TDemolishAction;
  endTurnAction: TEndTurnAction;
  hoverTileAction: THoverTileAction;
  pickBuildingAction: TPickBuildingAction;
  restartAction: TRestartAction;
  selectTileAction: TSelectTileAction;
  setHexSizeAction: TSetHexSizeAction;
  toggleYieldsAction: TToggleYieldsAction;
};
