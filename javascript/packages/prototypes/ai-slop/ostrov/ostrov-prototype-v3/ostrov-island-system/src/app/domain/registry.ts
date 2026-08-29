import type { TNumericConfigKey, TTerrain } from "../../core/exports";

type TRegenerateIslandAction = () => void;
type TRollIslandAction = () => void;
type TSetSeedTextAction = (seedText: string) => void;
type TSetConfigValueAction = (key: TNumericConfigKey, value: number) => void;
type TSetTerrainWeightAction = (terrain: TTerrain, weight: number) => void;
type TResetConfigAction = () => void;
type TSelectTileAction = (key: string) => void;

type TAppRegistry = {
  regenerateIslandAction: TRegenerateIslandAction;
  rollIslandAction: TRollIslandAction;
  setSeedTextAction: TSetSeedTextAction;
  setConfigValueAction: TSetConfigValueAction;
  setTerrainWeightAction: TSetTerrainWeightAction;
  resetConfigAction: TResetConfigAction;
  selectTileAction: TSelectTileAction;
};

export type {
  TAppRegistry,
  TRegenerateIslandAction,
  TResetConfigAction,
  TRollIslandAction,
  TSelectTileAction,
  TSetConfigValueAction,
  TSetSeedTextAction,
  TSetTerrainWeightAction,
};
