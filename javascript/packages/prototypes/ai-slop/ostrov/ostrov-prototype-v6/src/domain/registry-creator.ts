import {
  armBuildingAction,
  buildOnHexAction,
  cancelDemolishAction,
  confirmDemolishAction,
  disarmAction,
  requestDemolishAction,
  toggleDemolishModeAction,
} from "./build-actions";
import { endPhaseAction, setNicknameAction, startGameAction } from "./game-actions";
import { navigateToIslandAction, navigateToMenuAction } from "./route-actions";
import { setBattleInputAction } from "./battle-actions";
import { researchTechAction } from "./tech-actions";
import { setCameraAction, setHudAnchorsAction, skipTaxAnimationAction } from "./tax-actions";
import { closeTrailEventAction, moveIslandAction, scoutAction, selectWorldCellAction } from "./world-actions";
import {
  closeHexModalAction,
  closeTechModalAction,
  hoverHexAction,
  openTechModalAction,
  selectHexAction,
} from "./ui-actions";
import type { TStore } from "../store/store";
import type { TAppRegistry } from "./registry";

/**
 * Every action is written as `(store, ...args)` and bound to the store once,
 * here. The UI receives a registry of plain callbacks and never sees the store.
 */
const createRegistry = (store: TStore) => {
  const rawRegistry = {
    setNicknameAction,
    startGameAction,
    endPhaseAction,
    navigateToIslandAction,
    navigateToMenuAction,
    armBuildingAction,
    disarmAction,
    toggleDemolishModeAction,
    buildOnHexAction,
    requestDemolishAction,
    confirmDemolishAction,
    cancelDemolishAction,
    hoverHexAction,
    selectHexAction,
    closeHexModalAction,
    openTechModalAction,
    closeTechModalAction,
    setCameraAction,
    setHudAnchorsAction,
    skipTaxAnimationAction,
    researchTechAction,
    selectWorldCellAction,
    scoutAction,
    moveIslandAction,
    closeTrailEventAction,
    setBattleInputAction,
  };

  // The actions differ in arity, so the store is bound through one shared shape.
  const registry = Object.entries(rawRegistry).reduce((newRegistry, [name, func]) => {
    const action = func as (store: TStore, ...args: never[]) => void;
    newRegistry[name] = action.bind(null, store);

    return newRegistry;
  }, {} as Record<string, Function>);

  return registry as TAppRegistry;
};

export { createRegistry };
