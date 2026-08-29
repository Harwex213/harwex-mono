import type { TTerrain } from "./island/terrain";

type TRegenerateIslandAction = () => void;
type TRollIslandAction = () => void;
type TSetSeedTextAction = (seedText: string) => void;
type TSetLandCountAction = (landCount: number) => void;
type TSetTerrainWeightAction = (terrain: TTerrain, weight: number) => void;
type TSelectTileAction = (key: string) => void;

type TAppRegistry = {
  regenerateIslandAction: TRegenerateIslandAction;
  rollIslandAction: TRollIslandAction;
  setSeedTextAction: TSetSeedTextAction;
  setLandCountAction: TSetLandCountAction;
  setTerrainWeightAction: TSetTerrainWeightAction;
  selectTileAction: TSelectTileAction;
};

export type {
  TAppRegistry,
  TRegenerateIslandAction,
  TRollIslandAction,
  TSelectTileAction,
  TSetLandCountAction,
  TSetSeedTextAction,
  TSetTerrainWeightAction,
};
