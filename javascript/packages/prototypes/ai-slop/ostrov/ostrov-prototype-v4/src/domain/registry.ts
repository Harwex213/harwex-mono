import type { TBattleInput, TBuildingId, TTechId } from "../core/exports";
import type { TPage } from "../store/route-state";
import type { TCamera, TScreenPoint } from "../store/ui-state";

/**
 * The public contract of the domain layer. It is written by hand on purpose and
 * never inferred. S1 owns `navigate`, S3 the turn loop and the two resource
 * actions, S4 the build phase; later subtasks append their own.
 */

type TNavigateAction = (page: TPage, playerId?: string | null) => void;

/** Seeds the players, the four islands and the world, then opens the island page. */
type TStartGameAction = (nickname: string) => void;

/** Advances one phase, or one turn when the clearing phase ends. Refused while `game.busy`. */
type TEndTurnAction = () => void;

/** "Успокоить": turns 🤖 back into 🧍 for mana and food. */
type TCalmAction = () => void;

type TShowToastAction = (text: string) => void;

type TDismissEventModalAction = () => void;

/** Pins the seed before `startGame` runs, so the probe sees the same board twice. */
type TSetSeedAction = (seed: number) => void;

/** Arms a building card, or disarms when the armed card is passed again. */
type TArmBuildingAction = (building: TBuildingId | null) => void;

type TToggleDemolishAction = () => void;

/** Opens the biome modal for a hex, or closes it with `null`. */
type TSelectHexAction = (hexId: string | null) => void;

type THoverHexAction = (hexId: string | null, screen: TScreenPoint | null) => void;

/** The island canvas is the only writer; the value lives in `ui.camera`. */
type TSetCameraAction = (camera: TCamera) => void;

type TPlaceBuildingAction = (hexId: string, building: TBuildingId) => void;

/** Removes a building, or the hex itself when the hex is empty. */
type TDemolishAction = (hexId: string) => void;

/** S6, exploration: opens the cell panel for a world cell, or closes it with `null`. */
type TSelectCellAction = (cellId: number | null) => void;

/** S6, exploration: spends 🔭 to reveal a neighbouring world cell. */
type TRevealCellAction = (cellId: number) => void;

/** S6, exploration: flies the island to a reachable world cell, once per turn. */
type TMoveIslandAction = (cellId: number) => void;

/** S5, tax: measures the HUD and sends every payout flying to its chip. */
type TStartTaxPhaseAction = () => void;

/** S5, tax: one animation frame. The flight layer is the only caller. */
type TTickTaxAction = (nowMs: number) => void;

/** S5, tax: mana, the insane conversion, upkeep, research and the riot roll. */
type TFinishTaxAction = (nowMs: number) => void;

/** S5, tax: lands every glyph at once. The 350 ms pause still runs after it. */
type TSkipFlightsAction = () => void;

/** S5, tax: ends the whole sequence synchronously, for the dev hook and the probe. */
type TFastForwardTaxAction = () => void;

/** S7, clearing: builds the level for this turn and holds `busy` until it ends. */
type TStartBattleAction = () => void;

/** S7, clearing: one animation frame of the level. The battle canvas is the only caller. */
type TBattleTickAction = (dtMs: number, input: TBattleInput) => void;

/**
 * S7, clearing: runs whole 100 ms ticks synchronously, for the dev hook and the
 * probe. Without `input` the level replays the last input the canvas sent.
 */
type TStepBattleTicksAction = (ticks: number, input?: TBattleInput) => void;

/** S7, clearing: a debug cheat that drops every enemy to zero hp. */
type TKillAllEnemiesAction = () => void;

/** S7, clearing: ends the level on the spot and keeps whatever was absorbed. */
type TRetreatAction = () => void;

/** S7, clearing: appends the absorbed hexes and the surviving army, then clears the level. */
type TFinishBattleAction = () => void;

/** S8, technologies: opens the full-screen tech modal. */
type TOpenTechModalAction = () => void;

type TCloseTechModalAction = () => void;

/** S8, technologies: puts a tech in research, or cancels it when it is passed again. */
type TSetResearchTargetAction = (tech: TTechId | null) => void;

/** S8, technologies: adds 📖 to the tech in research; the dev hook and the probe use it. */
type TAddResearchAction = (science: number) => void;

/** S8, technologies: arms the purge cursor. Refused until `purge_ritual` is researched. */
type TTogglePurgeAction = () => void;

/** S8, technologies: spends 5 💠 to take 20 ☣️ off one hex, clamped at zero. */
type TPurgeHexAction = (hexId: string) => void;

type TAppRegistry = {
  navigate: TNavigateAction;
  startGame: TStartGameAction;
  endTurn: TEndTurnAction;
  calm: TCalmAction;
  showToast: TShowToastAction;
  dismissEventModal: TDismissEventModalAction;
  setSeed: TSetSeedAction;
  armBuilding: TArmBuildingAction;
  toggleDemolish: TToggleDemolishAction;
  selectHex: TSelectHexAction;
  hoverHex: THoverHexAction;
  setCamera: TSetCameraAction;
  placeBuilding: TPlaceBuildingAction;
  demolish: TDemolishAction;
  selectCell: TSelectCellAction;
  revealCell: TRevealCellAction;
  moveIsland: TMoveIslandAction;
  startTaxPhase: TStartTaxPhaseAction;
  tickTax: TTickTaxAction;
  finishTax: TFinishTaxAction;
  skipFlights: TSkipFlightsAction;
  fastForwardTax: TFastForwardTaxAction;
  startBattle: TStartBattleAction;
  battleTick: TBattleTickAction;
  stepBattleTicks: TStepBattleTicksAction;
  killAllEnemies: TKillAllEnemiesAction;
  retreat: TRetreatAction;
  finishBattle: TFinishBattleAction;
  openTechModal: TOpenTechModalAction;
  closeTechModal: TCloseTechModalAction;
  setResearchTarget: TSetResearchTargetAction;
  addResearch: TAddResearchAction;
  togglePurge: TTogglePurgeAction;
  purgeHex: TPurgeHexAction;
};

export type {
  TAddResearchAction,
  TAppRegistry,
  TArmBuildingAction,
  TBattleTickAction,
  TCalmAction,
  TCloseTechModalAction,
  TDemolishAction,
  TDismissEventModalAction,
  TEndTurnAction,
  TFastForwardTaxAction,
  TFinishBattleAction,
  TFinishTaxAction,
  THoverHexAction,
  TKillAllEnemiesAction,
  TMoveIslandAction,
  TNavigateAction,
  TOpenTechModalAction,
  TPlaceBuildingAction,
  TPurgeHexAction,
  TRetreatAction,
  TRevealCellAction,
  TSelectCellAction,
  TSelectHexAction,
  TSetCameraAction,
  TSetResearchTargetAction,
  TSetSeedAction,
  TShowToastAction,
  TSkipFlightsAction,
  TStartBattleAction,
  TStartGameAction,
  TStartTaxPhaseAction,
  TStepBattleTicksAction,
  TTickTaxAction,
  TToggleDemolishAction,
  TTogglePurgeAction,
};
