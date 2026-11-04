import {
  fit,
  zoomAround,
  zoomAt,
} from "../../domain/index";
import type { TStore } from "../../store/index";

// A map can finish loading before the canvas has been measured — an upload
// decodes faster than the first `ResizeObserver` callback arrives. Fitting
// against a 1x1 viewport clamps the zoom to the minimum and leaves the map
// invisible, so an unmeasured viewport defers the fit to `measureViewport`.
function fitToViewport(store: TStore): void {
  const info = store.map.info.value;

  if (!info) {
    return;
  }

  const size = store.view.viewport.value;

  if (size.width <= 1 || size.height <= 1) {
    store.view.fitPending.value = true;

    return;
  }

  store.view.fitPending.value = false;
  store.view.view.value = fit(info, size);
}

function measureViewport(store: TStore, width: number, height: number): void {
  store.view.viewport.value = { width: Math.max(1, width), height: Math.max(1, height) };

  if (store.view.fitPending.value) {
    fitToViewport(store);
  }
}

// Keeps the map point under `(sx, sy)` pinned there while the scale changes.
function zoomAtPoint(store: TStore, sx: number, sy: number, factor: number): void {
  store.view.view.value = zoomAt(store.view.view.value, sx, sy, factor);
}

// Zoom from the keyboard: around the middle of the viewport.
function zoomCentre(store: TStore, factor: number): void {
  store.view.view.value = zoomAround(store.view.view.value, store.view.viewport.value, factor);
}

// Moves map pixel (0,0) to `(x, y)` on the canvas, keeping the scale.
function panTo(store: TStore, x: number, y: number): void {
  store.view.view.value = { scale: store.view.view.value.scale, x, y };
}

export {
  fitToViewport,
  measureViewport,
  panTo,
  zoomAtPoint,
  zoomCentre,
};
