import type { TAxial } from "./hex/coords";

type TToggleMoveModeAction = () => void;
type TCancelMoveAction = () => void;
type THoverTargetAction = (target: TAxial | null) => void;
type TMoveToTargetAction = (target: TAxial) => void;
type TEndTurnAction = () => void;
type TSelectIslandAction = (id: string) => void;
type TNewWorldAction = (seedText: string) => void;

type TAppRegistry = {
  toggleMoveModeAction: TToggleMoveModeAction;
  cancelMoveAction: TCancelMoveAction;
  hoverTargetAction: THoverTargetAction;
  moveToTargetAction: TMoveToTargetAction;
  endTurnAction: TEndTurnAction;
  selectIslandAction: TSelectIslandAction;
  newWorldAction: TNewWorldAction;
};

export type {
  TAppRegistry,
  TCancelMoveAction,
  TEndTurnAction,
  THoverTargetAction,
  TMoveToTargetAction,
  TNewWorldAction,
  TSelectIslandAction,
  TToggleMoveModeAction,
};
