import { MAX_ZOOM, MIN_ZOOM, cellCentre, clampCamera, fitZoom, mapCentre, screenToWorld } from "./hex/camera";
import type { TCamera, TViewport } from "./hex/camera";
import type { TStore } from "../store/store";

type TToggleKey = "showGrid" | "showIslandOutlines" | "showElevationShading";

const readCamera = (store: TStore): TCamera => ({
  x: store.viewState.cameraX.peek(),
  y: store.viewState.cameraY.peek(),
  zoom: store.viewState.zoom.peek(),
});

const readViewport = (store: TStore): TViewport => ({
  width: store.viewState.viewportWidth.peek(),
  height: store.viewState.viewportHeight.peek(),
});

const writeCamera = (store: TStore, camera: TCamera) => {
  const { width, height } = store.generatorState.params.peek();
  const clamped = clampCamera(camera, width, height);

  store.viewState.cameraX.value = clamped.x;
  store.viewState.cameraY.value = clamped.y;
  store.viewState.zoom.value = clamped.zoom;
};

/** Puts the whole map in view, centred. */
const fitMapAction = (store: TStore) => {
  const { width, height } = store.generatorState.params.peek();
  const centre = mapCentre(width, height);

  writeCamera(store, { ...centre, zoom: fitZoom(width, height, readViewport(store)) });
};

/**
 * The canvas reports its own size, since it stretches to fill the stage. The
 * first measurement is also the first moment a fit can be computed, so that is
 * when the camera is placed.
 */
const setViewportAction = (store: TStore, width: number, height: number) => {
  const wasUnmeasured = store.viewState.viewportWidth.peek() === 0;

  store.viewState.viewportWidth.value = width;
  store.viewState.viewportHeight.value = height;

  if (wasUnmeasured && width > 0 && height > 0) {
    fitMapAction(store);
  }
};

const panAction = (store: TStore, deltaX: number, deltaY: number) => {
  const camera = readCamera(store);

  writeCamera(store, {
    ...camera,
    x: camera.x - deltaX / camera.zoom,
    y: camera.y - deltaY / camera.zoom,
  });
};

/** Zooms by `factor`, keeping whatever sits under the given screen point still. */
const zoomAtAction = (store: TStore, screenX: number, screenY: number, factor: number) => {
  const camera = readCamera(store);
  const viewport = readViewport(store);
  const world = screenToWorld(screenX, screenY, camera, viewport);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor));

  writeCamera(store, {
    zoom,
    x: world.x - (screenX - viewport.width / 2) / zoom,
    y: world.y - (screenY - viewport.height / 2) / zoom,
  });
};

/** Zoom from the slider, which has no cursor to anchor to, so it holds the centre. */
const setZoomAction = (store: TStore, zoom: number) => {
  writeCamera(store, { ...readCamera(store), zoom });
};

const hoverHexAction = (store: TStore, index: number) => {
  if (store.viewState.hoveredIndex.peek() === index) {
    return;
  }

  store.viewState.hoveredIndex.value = index;
};

/** Clicking the island already selected clears the selection. */
const selectIslandAction = (store: TStore, islandId: number) => {
  const current = store.viewState.selectedIslandId.peek();
  store.viewState.selectedIslandId.value = current === islandId ? -1 : islandId;
};

/** Selecting from the list also flies the camera to the island, which may be far off screen. */
const focusIslandAction = (store: TStore, islandId: number) => {
  selectIslandAction(store, islandId);

  const map = store.generatorState.map.peek();
  const island = map?.islands[islandId];
  if (!island || store.viewState.selectedIslandId.peek() === -1) {
    return;
  }

  const centre = cellCentre(island.centreCol, island.centreRow);

  writeCamera(store, { ...readCamera(store), x: centre.x, y: centre.y });
};

const toggleViewOptionAction = (store: TStore, key: TToggleKey) => {
  const flag = store.viewState[key];
  flag.value = !flag.peek();
};

export type { TToggleKey };
export {
  fitMapAction,
  focusIslandAction,
  hoverHexAction,
  panAction,
  selectIslandAction,
  setViewportAction,
  setZoomAction,
  toggleViewOptionAction,
  zoomAtAction,
};
