import { buildAction, demolishAction } from "./actions/build-actions";
import { endTurnAction, restartAction } from "./actions/turn-actions";
import {
  hoverTileAction,
  pickBuildingAction,
  selectTileAction,
  setHexSizeAction,
  toggleYieldsAction,
} from "./actions/view-actions";
import type { TStore } from "../store/store";
import type { TAppRegistry } from "./registry";

const createRegistry = (store: TStore) => {
  const rawRegistry = {
    buildAction,
    demolishAction,
    endTurnAction,
    hoverTileAction,
    pickBuildingAction,
    restartAction,
    selectTileAction,
    setHexSizeAction,
    toggleYieldsAction,
  };

  /**
   * `Object.entries` collapses the actions into one union type, and `bind` then
   * refuses the union. The entries are cast to a single loose signature, since
   * `TAppRegistry` is what actually types the result.
   */
  type TBoundable = (store: TStore, ...args: never[]) => unknown;

  const entries = Object.entries(rawRegistry) as [string, TBoundable][];

  const registry = entries.reduce((newRegistry, [name, func]) => {
    newRegistry[name] = func.bind(null, store);

    return newRegistry;
  }, {} as Record<string, Function>);

  return registry as TAppRegistry;
};

export { createRegistry };
