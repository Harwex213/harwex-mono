import { clickTileAction, hoverTileAction, selectArmyAction, selectNextArmyAction } from "./army-actions";
import {
  endTurnAction,
  hireArmyAction,
  newGameAction,
  randomizeSeedAction,
  setBoardSizeAction,
  setSeedAction,
} from "./game-state";
import { setHexSizeAction, toggleViewOptionAction } from "./view-state";
import type { TStore } from "../store/store";
import type { TAppRegistry } from "./registry";

const createRegistry = (store: TStore) => {
  const rawRegistry = {
    newGameAction,
    setSeedAction,
    randomizeSeedAction,
    setBoardSizeAction,
    hireArmyAction,
    endTurnAction,
    clickTileAction,
    hoverTileAction,
    selectArmyAction,
    selectNextArmyAction,
    toggleViewOptionAction,
    setHexSizeAction,
  };

  // `Object.entries` collapses the actions into one union type, and `bind` will
  // not accept a union of different arities. The cast erases the tail argument;
  // `TAppRegistry` is what keeps every call site honest.
  type TBoundAction = (store: TStore, ...args: never[]) => unknown;

  const registry = Object.entries(rawRegistry).reduce((newRegistry, [name, func]) => {
    newRegistry[name] = (func as TBoundAction).bind(null, store);

    return newRegistry;
  }, {} as Record<string, Function>);

  return registry as TAppRegistry;
};

export { createRegistry };
