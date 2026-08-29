import {
  advanceBattleAction,
  nextRoundAction,
  restartGameAction,
  setSpeedAction,
  startBattleAction,
  togglePauseAction,
} from "./actions/battle-actions";
import {
  autoArrangeAction,
  beginDragAction,
  dragToAction,
  endDragAction,
  hoverUnitAction,
  selectUnitAction,
} from "./actions/board-actions";
import { buyUnitAction, rerollShopAction, sellUnitAction } from "./actions/shop-actions";
import type { TAppRegistry } from "./registry";
import type { TStore } from "../store/store";

const createRegistry = (store: TStore) => {
  const rawRegistry = {
    rerollShopAction,
    buyUnitAction,
    sellUnitAction,
    selectUnitAction,
    hoverUnitAction,
    beginDragAction,
    dragToAction,
    endDragAction,
    autoArrangeAction,
    startBattleAction,
    advanceBattleAction,
    setSpeedAction,
    togglePauseAction,
    nextRoundAction,
    restartGameAction,
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
