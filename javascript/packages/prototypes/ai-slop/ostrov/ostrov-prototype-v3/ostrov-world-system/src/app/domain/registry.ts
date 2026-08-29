import type { TIslandType } from "@hw/ostrov-island-system";
import type { TAxisConfigKey, TRangeBound, TRangeConfigKey } from "../../core/exports";

type TRegenerateWorldAction = () => void;
type TRollWorldAction = () => void;
type TSetSeedTextAction = (seedText: string) => void;
type TSetRangeBoundAction = (key: TRangeConfigKey, bound: TRangeBound, value: number) => void;
type TSetAxisSizeAction = (key: TAxisConfigKey, size: number) => void;
type TSetIslandTotalAction = (total: number) => void;
type TSetIslandTypeCountAction = (type: TIslandType, count: number) => void;
type TResetConfigAction = () => void;
type TSelectTileAction = (key: string) => void;
type TSelectIslandAction = (id: string) => void;

type TAppRegistry = {
  regenerateWorldAction: TRegenerateWorldAction;
  rollWorldAction: TRollWorldAction;
  setSeedTextAction: TSetSeedTextAction;
  setRangeBoundAction: TSetRangeBoundAction;
  setAxisSizeAction: TSetAxisSizeAction;
  setIslandTotalAction: TSetIslandTotalAction;
  setIslandTypeCountAction: TSetIslandTypeCountAction;
  resetConfigAction: TResetConfigAction;
  selectTileAction: TSelectTileAction;
  selectIslandAction: TSelectIslandAction;
};

export type {
  TAppRegistry,
  TRegenerateWorldAction,
  TResetConfigAction,
  TRollWorldAction,
  TSelectIslandAction,
  TSelectTileAction,
  TSetAxisSizeAction,
  TSetIslandTotalAction,
  TSetIslandTypeCountAction,
  TSetRangeBoundAction,
  TSetSeedTextAction,
};
