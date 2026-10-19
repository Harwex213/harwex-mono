import { fitView, isFittedScale, resizeView, translateTo, zoomAt } from "../domain/index";
import type { Point, View } from "../domain/index";
import type { TStore, Viewport } from "../store/index";

// The camera actions.
// Decisions:
// - No write without a map size and a non-zero viewport.
// - Unchanged values are not written, so a held wheel or a resize flurry does not repaint forever.
// - Reads use `.peek()`, so a caller never widens its dependency set.
// - Never call one from a tracked effect body: the action reads and writes the same signals.

function sameView(a: View, b: View): boolean {
  return a.scale === b.scale && a.x === b.x && a.y === b.y;
}

function currentContext(
  store: TStore,
): { size: { width: number; height: number }; port: Viewport } | null {
  const size = store.map.mapSize.peek();
  const port = store.view.viewport.peek();
  if (!size || port.width <= 0 || port.height <= 0) {
    return null;
  }
  return { size, port };
}

function writeView(store: TStore, next: View): void {
  const context = currentContext(store);
  // Before the `sameView` return: an unchanged view still needs the flag for the new viewport.
  if (context) {
    const fitted = isFittedScale(next.scale, context.size, context.port);
    if (store.view.viewFitted.peek() !== fitted) {
      store.view.viewFitted.value = fitted;
    }
  }
  const current = store.view.view.peek();
  if (current && sameView(current, next)) {
    return;
  }
  store.view.view.value = next;
}

// The single init point, called by whichever of viewport and map arrives last.
// A resize does not clamp: the fit-scale floor would ratchet and crop the map.
function syncView(store: TStore): void {
  const context = currentContext(store);
  if (!context) {
    return;
  }
  const current = store.view.view.peek();
  // A fresh load starts fitted.
  if (!current) {
    writeView(store, fitView(context.size, context.port));
    return;
  }
  // `viewFitted` still describes the previous viewport on purpose.
  // The question is whether the view was fitted before this resize.
  if (store.view.viewFitted.peek()) {
    writeView(store, fitView(context.size, context.port));
    return;
  }
  writeView(store, resizeView(current, context.size, context.port));
}

function setViewport(store: TStore, width: number, height: number): void {
  const current = store.view.viewport.peek();
  if (current.width === width && current.height === height) {
    return;
  }
  store.view.viewport.value = { width, height };
  syncView(store);
}

function setDpr(store: TStore, next: number): void {
  if (!Number.isFinite(next) || next <= 0) {
    return;
  }
  if (store.view.dpr.peek() === next) {
    return;
  }
  store.view.dpr.value = next;
}

function zoomAtPoint(store: TStore, sx: number, sy: number, factor: number): void {
  const context = currentContext(store);
  const current = store.view.view.peek();
  if (!context || !current) {
    return;
  }
  const next = zoomAt(current, sx, sy, factor, context.size, context.port);
  // Same reference means no change, so a wheel held at the cap does not repaint.
  if (next === current) {
    return;
  }
  writeView(store, next);
}

function panTo(store: TStore, x: number, y: number): void {
  const context = currentContext(store);
  const current = store.view.view.peek();
  if (!context || !current) {
    return;
  }
  writeView(store, translateTo(current, x, y, context.size, context.port));
}

function resetView(store: TStore): void {
  const context = currentContext(store);
  if (!context) {
    return;
  }
  writeView(store, fitView(context.size, context.port));
}

// Writes only on a new integer pixel, so moves inside one magnified pixel skip the HUD.
function setCursor(store: TStore, point: Point | null): void {
  const current = store.view.cursorMap.peek();
  if (point === null) {
    if (current === null) {
      return;
    }
    store.view.cursorMap.value = null;
    return;
  }
  if (current && current.x === point.x && current.y === point.y) {
    return;
  }
  store.view.cursorMap.value = point;
}

function setPanning(store: TStore, on: boolean): void {
  if (store.view.panning.peek() === on) {
    return;
  }
  store.view.panning.value = on;
}

export { panTo, resetView, setCursor, setDpr, setPanning, setViewport, syncView, zoomAtPoint };
