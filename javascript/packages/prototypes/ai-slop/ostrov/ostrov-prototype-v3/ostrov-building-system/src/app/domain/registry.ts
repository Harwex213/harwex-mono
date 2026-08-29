import type { TBuildingKind } from "../../core/exports";

type TStartIslandAction = (seedText?: string) => void;
type TRollIslandAction = () => void;
type TSetSeedTextAction = (seedText: string) => void;
type TPickBuildingAction = (kind: TBuildingKind | null) => void;
type TClickTileAction = (tileKey: string) => void;
type TClearSelectionAction = () => void;
type TUpgradeBuildingAction = (tileKey: string) => void;
type TDemolishBuildingAction = (tileKey: string) => void;
type TEndTurnAction = () => void;

type TAppRegistry = {
  startIslandAction: TStartIslandAction;
  rollIslandAction: TRollIslandAction;
  setSeedTextAction: TSetSeedTextAction;
  pickBuildingAction: TPickBuildingAction;
  clickTileAction: TClickTileAction;
  clearSelectionAction: TClearSelectionAction;
  upgradeBuildingAction: TUpgradeBuildingAction;
  demolishBuildingAction: TDemolishBuildingAction;
  endTurnAction: TEndTurnAction;
};

export type {
  TAppRegistry,
  TClearSelectionAction,
  TClickTileAction,
  TDemolishBuildingAction,
  TEndTurnAction,
  TPickBuildingAction,
  TRollIslandAction,
  TSetSeedTextAction,
  TStartIslandAction,
  TUpgradeBuildingAction,
};
