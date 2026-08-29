import { isAvailable } from "../tech/empire";
import { ROOT } from "../tech/tech-tree";
import { CAMERA_HOME, panCamera, zoomCamera } from "../../ui/render/snowflake-renderer";
import type { TPoint } from "../tech/types";
import type { TSize, TStore } from "../../store/store";

/** How long one technology takes to learn, in ms. */
const LEARNING_DURATION = 2500;

const startLearningAction = (store: TStore, techId: string): void => {
  const researched = store.techState.researched.peek();
  if (!isAvailable(techId, researched) || store.techState.learning.peek()) {
    return;
  }

  store.techState.learning.value = { techId, startedAt: performance.now() };
};

/** Called every animation frame while something is being learned. */
const advanceLearningAction = (store: TStore, now: number): void => {
  const learning = store.techState.learning.peek();
  if (!learning) {
    return;
  }

  if (now - learning.startedAt < LEARNING_DURATION) {
    return;
  }

  store.techState.learning.value = null;
  const researched = store.techState.researched.peek();
  if (!researched.includes(learning.techId)) {
    store.techState.researched.value = [...researched, learning.techId];
  }
};

const selectTechAction = (store: TStore, techId: string | null): void => {
  store.viewState.selectedId.value = techId;
};

const hoverTechAction = (store: TStore, techId: string | null): void => {
  if (store.viewState.hoveredId.peek() === techId) {
    return;
  }

  store.viewState.hoveredId.value = techId;
  store.viewState.hoveredAt.value = performance.now();
};

const restartAction = (store: TStore): void => {
  store.techState.researched.value = [ROOT.id];
  store.techState.learning.value = null;
  store.viewState.hoveredId.value = null;
  store.viewState.selectedId.value = null;
  store.viewState.camera.value = CAMERA_HOME;
};

const zoomCanvasAction = (store: TStore, factor: number, anchor: TPoint): void => {
  const size = store.viewState.canvasSize.peek();
  store.viewState.camera.value = zoomCamera(store.viewState.camera.peek(), size.width, size.height, factor, anchor);
};

const panCanvasAction = (store: TStore, dx: number, dy: number): void => {
  store.viewState.camera.value = panCamera(store.viewState.camera.peek(), dx, dy);
};

const resizeCanvasAction = (store: TStore, size: TSize): void => {
  store.viewState.canvasSize.value = size;
};

export {
  LEARNING_DURATION,
  advanceLearningAction,
  hoverTechAction,
  panCanvasAction,
  resizeCanvasAction,
  restartAction,
  selectTechAction,
  startLearningAction,
  zoomCanvasAction,
};
