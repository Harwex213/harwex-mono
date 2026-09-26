import type { TBattleInput } from "../core/battle-sim";
import type { TTechId } from "../core/techs";
import type { TBuildingId, TResourceId } from "../core/types";
import type { TCamera, TPointerAnchor } from "../store/ui-state";

/**
 * The public contract of the domain layer. It is hand-written, never inferred:
 * the phases after the build phase add their own action types here.
 */

type TSetNicknameAction = (nickname: string) => void;
type TStartGameAction = () => void;
type TEndPhaseAction = () => void;

type TNavigateToIslandAction = (playerId: string | null) => void;
type TNavigateToMenuAction = () => void;

type TArmBuildingAction = (buildingId: TBuildingId) => void;
type TDisarmAction = () => void;
type TToggleDemolishModeAction = () => void;
type TBuildOnHexAction = (hexId: string) => void;
type TRequestDemolishAction = (hexId: string) => void;
type TConfirmDemolishAction = (skipNextTime: boolean) => void;
type TCancelDemolishAction = () => void;

type THoverHexAction = (hexId: string | null, anchor: TPointerAnchor | null) => void;
type TSelectHexAction = (hexId: string) => void;
type TCloseHexModalAction = () => void;
type TOpenTechModalAction = () => void;
type TSetCameraAction = (camera: TCamera) => void;
type TSetHudAnchorsAction = (anchors: Readonly<Partial<Record<TResourceId, TPointerAnchor>>>) => void;
type TSkipTaxAnimationAction = () => void;

type TResearchTechAction = (techId: TTechId) => void;
type TSelectWorldCellAction = (cellId: string) => void;
type TScoutAction = () => void;
type TMoveIslandAction = (cellId: string) => void;
type TCloseTrailEventAction = () => void;
type TSetBattleInputAction = (input: Partial<TBattleInput>) => void;
type TCloseTechModalAction = () => void;

type TAppRegistry = {
  setNicknameAction: TSetNicknameAction;
  startGameAction: TStartGameAction;
  endPhaseAction: TEndPhaseAction;
  navigateToIslandAction: TNavigateToIslandAction;
  navigateToMenuAction: TNavigateToMenuAction;
  armBuildingAction: TArmBuildingAction;
  disarmAction: TDisarmAction;
  toggleDemolishModeAction: TToggleDemolishModeAction;
  buildOnHexAction: TBuildOnHexAction;
  requestDemolishAction: TRequestDemolishAction;
  confirmDemolishAction: TConfirmDemolishAction;
  cancelDemolishAction: TCancelDemolishAction;
  hoverHexAction: THoverHexAction;
  selectHexAction: TSelectHexAction;
  closeHexModalAction: TCloseHexModalAction;
  openTechModalAction: TOpenTechModalAction;
  closeTechModalAction: TCloseTechModalAction;
  setCameraAction: TSetCameraAction;
  setHudAnchorsAction: TSetHudAnchorsAction;
  skipTaxAnimationAction: TSkipTaxAnimationAction;
  researchTechAction: TResearchTechAction;
  selectWorldCellAction: TSelectWorldCellAction;
  scoutAction: TScoutAction;
  moveIslandAction: TMoveIslandAction;
  closeTrailEventAction: TCloseTrailEventAction;
  setBattleInputAction: TSetBattleInputAction;
};

export type {
  TAppRegistry,
  TCloseTrailEventAction,
  TMoveIslandAction,
  TResearchTechAction,
  TScoutAction,
  TSelectWorldCellAction,
  TSetBattleInputAction,
  TArmBuildingAction,
  TBuildOnHexAction,
  TCancelDemolishAction,
  TCloseHexModalAction,
  TCloseTechModalAction,
  TConfirmDemolishAction,
  TDisarmAction,
  TEndPhaseAction,
  THoverHexAction,
  TNavigateToIslandAction,
  TNavigateToMenuAction,
  TOpenTechModalAction,
  TRequestDemolishAction,
  TSelectHexAction,
  TSetCameraAction,
  TSetHudAnchorsAction,
  TSetNicknameAction,
  TSkipTaxAnimationAction,
  TStartGameAction,
  TToggleDemolishModeAction,
};
