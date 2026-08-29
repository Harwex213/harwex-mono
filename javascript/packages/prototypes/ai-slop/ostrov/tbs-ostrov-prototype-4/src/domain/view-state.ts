import type { TStore } from "../store/store";

/** The switches that change how the board is drawn and nothing else. */
type TViewToggleKey = "showGrid" | "showFog" | "showCoords";

const toggleViewOptionAction = (store: TStore, key: TViewToggleKey) => {
  const flag = store.viewState[key];
  flag.value = !flag.peek();
};

const setHexSizeAction = (store: TStore, size: number) => {
  store.viewState.hexSize.value = size;
};

/**
 * A hex size that keeps the whole board on screen. An 11x11 island at the size
 * a 5x5 island wants is twice as wide as the stage, and the player scrolls to
 * find their own city.
 */
const fitHexSizeToBoard = (store: TStore, boardSize: number) => {
  store.viewState.hexSize.value = Math.max(18, Math.min(48, Math.round(240 / boardSize)));
};

export type { TViewToggleKey };
export { fitHexSizeToBoard, setHexSizeAction, toggleViewOptionAction };
