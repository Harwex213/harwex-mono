import {
  battleAutoToggleAction,
  battleFinishAction,
  battleSetSlotAction,
  battleSkillAction,
  battleStepAction,
  clickTileAction,
  curtainAdvanceAction,
  curtainCloseAction,
  endTurnAction,
  formArmyAction,
  foundPowerAction,
  investEngineAction,
  moveIslandAction,
  newGameAction,
  reinforceArmyAction,
  selectUnitAction,
  setActivePlayerAction,
  setPanelTabAction,
  setResearchAction,
  setSeedTextAction,
  startBuildingAction,
  trainCivilianAction,
} from "./actions";
import type { TAppRegistry } from "./registry";
import type { TStore } from "../store/store";

const createRegistry = (store: TStore) => {
  const rawRegistry = {
    battleAutoToggleAction,
    battleFinishAction,
    battleSetSlotAction,
    battleSkillAction,
    battleStepAction,
    clickTileAction,
    curtainAdvanceAction,
    curtainCloseAction,
    endTurnAction,
    formArmyAction,
    foundPowerAction,
    investEngineAction,
    moveIslandAction,
    newGameAction,
    reinforceArmyAction,
    selectUnitAction,
    setActivePlayerAction,
    setPanelTabAction,
    setResearchAction,
    setSeedTextAction,
    startBuildingAction,
    trainCivilianAction,
  };

  const registry = Object.entries(rawRegistry).reduce((newRegistry, [name, func]) => {
    newRegistry[name] = (func as (store: TStore, ...args: unknown[]) => unknown).bind(null, store);

    return newRegistry;
  }, {} as Record<string, Function>);

  return registry as TAppRegistry;
};

export { createRegistry };
