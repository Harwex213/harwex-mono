import type { TCleanupSpeed } from "../store/battle-state";
import type { TTechId } from "../core/techs";
import type { TBuildingId } from "../core/types";
import type { TCamera, THudAnchorId, TPointerAnchor } from "../store/ui-state";

/**
 * The public contract of the domain layer. It is hand-written, never inferred:
 * the phases after the build phase add their own action types here.
 */

type TPlaceStrongholdAction = (hexId: string) => void;
type TStartGameAction = () => void;
type TEndPhaseAction = () => void;

type TNavigateToIslandAction = (playerId: string | null) => void;

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
type TSetHudAnchorsAction = (anchors: Readonly<Partial<Record<THudAnchorId, TPointerAnchor>>>) => void;
type TSkipTaxAnimationAction = () => void;
type TOpenTaxPickAction = (hexId: string) => void;
type TCloseTaxPickAction = () => void;
type TPickTaxFaceAction = (hexId: string, faceIndex: number) => void;
type TCloseSlotModalAction = () => void;

type TResearchTechAction = (techId: TTechId) => void;
type TSelectWorldCellAction = (cellId: string) => void;
type TScoutAction = (cellId: string) => void;
type TMoveIslandAction = (cellId: string) => void;
type TCloseTrailEventAction = () => void;
type TSetCleanupInputAction = (x: number, y: number) => void;
type TStepCleanupAction = (ticks: number) => void;
type TSetCleanupSpeedAction = (speed: TCleanupSpeed) => void;
type TToggleCleanupPauseAction = () => void;
type TCloseTechModalAction = () => void;

type TAppRegistry = {
  placeStrongholdAction: TPlaceStrongholdAction;
  startGameAction: TStartGameAction;
  endPhaseAction: TEndPhaseAction;
  navigateToIslandAction: TNavigateToIslandAction;
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
  openTaxPickAction: TOpenTaxPickAction;
  closeTaxPickAction: TCloseTaxPickAction;
  pickTaxFaceAction: TPickTaxFaceAction;
  closeSlotModalAction: TCloseSlotModalAction;
  researchTechAction: TResearchTechAction;
  selectWorldCellAction: TSelectWorldCellAction;
  scoutAction: TScoutAction;
  moveIslandAction: TMoveIslandAction;
  closeTrailEventAction: TCloseTrailEventAction;
  setCleanupInputAction: TSetCleanupInputAction;
  stepCleanupAction: TStepCleanupAction;
  setCleanupSpeedAction: TSetCleanupSpeedAction;
  toggleCleanupPauseAction: TToggleCleanupPauseAction;
};

export type {
  TAppRegistry,
  TCloseTrailEventAction,
  TMoveIslandAction,
  TResearchTechAction,
  TScoutAction,
  TSelectWorldCellAction,
  TSetCleanupInputAction,
  TSetCleanupSpeedAction,
  TStepCleanupAction,
  TToggleCleanupPauseAction,
  TArmBuildingAction,
  TBuildOnHexAction,
  TCancelDemolishAction,
  TCloseHexModalAction,
  TCloseSlotModalAction,
  TCloseTaxPickAction,
  TCloseTechModalAction,
  TConfirmDemolishAction,
  TDisarmAction,
  TEndPhaseAction,
  THoverHexAction,
  TNavigateToIslandAction,
  TOpenTaxPickAction,
  TOpenTechModalAction,
  TPickTaxFaceAction,
  TPlaceStrongholdAction,
  TRequestDemolishAction,
  TSelectHexAction,
  TSetCameraAction,
  TSetHudAnchorsAction,
  TSkipTaxAnimationAction,
  TStartGameAction,
  TToggleDemolishModeAction,
};
