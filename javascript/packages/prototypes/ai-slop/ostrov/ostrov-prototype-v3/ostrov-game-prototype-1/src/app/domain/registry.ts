import type { TBuildingType, TPlayerId, TSkillId } from "../../core/exports";
import type { TPanelTab } from "../store/store";

type TSetActivePlayerAction = (player: TPlayerId) => void;
type TSetPanelTabAction = (tab: TPanelTab) => void;
type TClickTileAction = (tileId: string) => void;
type TSelectUnitAction = (unitId: string | null) => void;
type TFoundPowerAction = (unitId: string) => void;
type TStartBuildingAction = (unitId: string, type: TBuildingType) => void;
type TTrainCivilianAction = (type: "settler" | "builders") => void;
type TFormArmyAction = (barracksId: string) => void;
type TReinforceArmyAction = (unitId: string) => void;
type TInvestEngineAction = (amount: number) => void;
type TMoveIslandAction = (direction: number) => void;
type TSetResearchAction = (techId: string) => void;
type TEndTurnAction = () => void;
type TCurtainAdvanceAction = () => void;
type TCurtainCloseAction = () => void;
type TBattleSetSlotAction = (squadId: string, slot: number) => void;
type TBattleStepAction = () => void;
type TBattleSkillAction = (skillId: TSkillId) => void;
type TBattleAutoToggleAction = () => void;
type TBattleFinishAction = () => void;
type TSetSeedTextAction = (text: string) => void;
type TNewGameAction = () => void;

type TAppRegistry = {
  setActivePlayerAction: TSetActivePlayerAction;
  setPanelTabAction: TSetPanelTabAction;
  clickTileAction: TClickTileAction;
  selectUnitAction: TSelectUnitAction;
  foundPowerAction: TFoundPowerAction;
  startBuildingAction: TStartBuildingAction;
  trainCivilianAction: TTrainCivilianAction;
  formArmyAction: TFormArmyAction;
  reinforceArmyAction: TReinforceArmyAction;
  investEngineAction: TInvestEngineAction;
  moveIslandAction: TMoveIslandAction;
  setResearchAction: TSetResearchAction;
  endTurnAction: TEndTurnAction;
  curtainAdvanceAction: TCurtainAdvanceAction;
  curtainCloseAction: TCurtainCloseAction;
  battleSetSlotAction: TBattleSetSlotAction;
  battleStepAction: TBattleStepAction;
  battleSkillAction: TBattleSkillAction;
  battleAutoToggleAction: TBattleAutoToggleAction;
  battleFinishAction: TBattleFinishAction;
  setSeedTextAction: TSetSeedTextAction;
  newGameAction: TNewGameAction;
};

export type {
  TAppRegistry,
  TBattleAutoToggleAction,
  TBattleFinishAction,
  TBattleSetSlotAction,
  TBattleSkillAction,
  TBattleStepAction,
  TClickTileAction,
  TCurtainAdvanceAction,
  TCurtainCloseAction,
  TEndTurnAction,
  TFormArmyAction,
  TFoundPowerAction,
  TInvestEngineAction,
  TMoveIslandAction,
  TNewGameAction,
  TReinforceArmyAction,
  TSelectUnitAction,
  TSetActivePlayerAction,
  TSetPanelTabAction,
  TSetResearchAction,
  TSetSeedTextAction,
  TStartBuildingAction,
  TTrainCivilianAction,
};
