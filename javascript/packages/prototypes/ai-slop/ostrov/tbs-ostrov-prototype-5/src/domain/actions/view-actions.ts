import { BUILDING_DEFS } from "../game/buildings";
import { buildAction } from "./build-actions";
import type { TBuildingKind } from "../game/types";
import type { TStore } from "../../store/store";

const hoverTileAction = (store: TStore, index: number): void => {
  if (store.viewState.hoveredIndex.peek() === index) {
    return;
  }
  store.viewState.hoveredIndex.value = index;
};

/**
 * A click always selects the tile. When a building is armed in the menu and the
 * tile can take it, the same click also places it, so a player can lay down a
 * row of farms without going back to the menu each time.
 */
const selectTileAction = (store: TStore, index: number): void => {
  store.viewState.selectedIndex.value = index;

  const pending = store.viewState.pendingKind.peek();
  if (pending === null || index === -1) {
    return;
  }

  const tile = store.worldState.world.peek().tiles[index];
  if (!tile || tile.terrain !== BUILDING_DEFS[pending].terrain) {
    return;
  }

  buildAction(store, index, pending);
};

const pickBuildingAction = (store: TStore, kind: TBuildingKind | null): void => {
  store.viewState.pendingKind.value = store.viewState.pendingKind.peek() === kind ? null : kind;
};

const setHexSizeAction = (store: TStore, size: number): void => {
  store.viewState.hexSize.value = Math.max(14, Math.min(40, Math.round(size)));
};

const toggleYieldsAction = (store: TStore): void => {
  store.viewState.showYields.value = !store.viewState.showYields.peek();
};

export { hoverTileAction, pickBuildingAction, selectTileAction, setHexSizeAction, toggleYieldsAction };
