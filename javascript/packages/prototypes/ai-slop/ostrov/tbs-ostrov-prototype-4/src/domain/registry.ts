import type { TViewToggleKey } from "./view-state";
import type { TArmyKind } from "./world/types";

type TNewGameAction = () => void;
type TSetSeedAction = (seed: string) => void;
type TRandomizeSeedAction = () => void;
type TSetBoardSizeAction = (size: number) => void;
type THireArmyAction = (kind: TArmyKind) => void;
type TEndTurnAction = () => void;
type TClickTileAction = (key: string) => void;
type THoverTileAction = (key: string) => void;
type TSelectArmyAction = (id: number) => void;
type TSelectNextArmyAction = () => void;
type TToggleViewOptionAction = (key: TViewToggleKey) => void;
type TSetHexSizeAction = (size: number) => void;

type TAppRegistry = {
  newGameAction: TNewGameAction;
  setSeedAction: TSetSeedAction;
  randomizeSeedAction: TRandomizeSeedAction;
  setBoardSizeAction: TSetBoardSizeAction;
  hireArmyAction: THireArmyAction;
  endTurnAction: TEndTurnAction;
  clickTileAction: TClickTileAction;
  hoverTileAction: THoverTileAction;
  selectArmyAction: TSelectArmyAction;
  selectNextArmyAction: TSelectNextArmyAction;
  toggleViewOptionAction: TToggleViewOptionAction;
  setHexSizeAction: TSetHexSizeAction;
};

export type {
  TAppRegistry,
  TClickTileAction,
  TEndTurnAction,
  THireArmyAction,
  THoverTileAction,
  TNewGameAction,
  TRandomizeSeedAction,
  TSelectArmyAction,
  TSelectNextArmyAction,
  TSetBoardSizeAction,
  TSetHexSizeAction,
  TSetSeedAction,
  TToggleViewOptionAction,
};
