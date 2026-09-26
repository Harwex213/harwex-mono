import {
  armBuildingAction,
  demolishAction,
  hoverHexAction,
  placeBuildingAction,
  selectHexAction,
  setCameraAction,
  toggleDemolishAction,
} from "./build-actions";
import {
  battleTickAction,
  finishBattleAction,
  killAllEnemiesAction,
  retreatAction,
  startBattleAction,
  stepBattleTicksAction,
} from "./battle-actions";
import {
  calmAction,
  dismissEventModalAction,
  endTurnAction,
  setSeedAction,
  showToastAction,
  startGameAction,
} from "./game-actions";
import { navigateAction } from "./route-actions";
import {
  fastForwardTaxAction,
  finishTaxAction,
  skipFlightsAction,
  startTaxPhaseAction,
  tickTaxAction,
} from "./tax-actions";
import {
  addResearchAction,
  closeTechModalAction,
  openTechModalAction,
  purgeHexAction,
  setResearchTargetAction,
  togglePurgeAction,
} from "./tech-actions";
import { moveIslandAction, revealCellAction, selectCellAction } from "./world-actions";
import type { TAppRegistry } from "./registry";
import type { TStore } from "../store/store";

const createRegistry = (store: TStore): TAppRegistry => {
  const rawRegistry = {
    navigate: navigateAction,
    startGame: startGameAction,
    endTurn: endTurnAction,
    calm: calmAction,
    showToast: showToastAction,
    dismissEventModal: dismissEventModalAction,
    setSeed: setSeedAction,
    armBuilding: armBuildingAction,
    toggleDemolish: toggleDemolishAction,
    selectHex: selectHexAction,
    hoverHex: hoverHexAction,
    setCamera: setCameraAction,
    placeBuilding: placeBuildingAction,
    demolish: demolishAction,
    selectCell: selectCellAction,
    revealCell: revealCellAction,
    moveIsland: moveIslandAction,
    startTaxPhase: startTaxPhaseAction,
    tickTax: tickTaxAction,
    finishTax: finishTaxAction,
    skipFlights: skipFlightsAction,
    fastForwardTax: fastForwardTaxAction,
    startBattle: startBattleAction,
    battleTick: battleTickAction,
    stepBattleTicks: stepBattleTicksAction,
    killAllEnemies: killAllEnemiesAction,
    retreat: retreatAction,
    finishBattle: finishBattleAction,
    openTechModal: openTechModalAction,
    closeTechModal: closeTechModalAction,
    setResearchTarget: setResearchTargetAction,
    addResearch: addResearchAction,
    togglePurge: togglePurgeAction,
    purgeHex: purgeHexAction,
  };

  // The actions differ in arity, so the store is bound through one shared shape.
  const registry = Object.entries(rawRegistry).reduce((newRegistry, [name, func]) => {
    const action = func as (store: TStore, ...args: never[]) => void;
    newRegistry[name] = action.bind(null, store);

    return newRegistry;
  }, {} as Record<string, Function>);

  return registry as unknown as TAppRegistry;
};

export { createRegistry };
