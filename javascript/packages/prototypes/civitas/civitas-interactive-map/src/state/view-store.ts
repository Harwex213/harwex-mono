import { signal } from "@preact/signals-react";
import { clampView, fitView, screenToMap, translateTo, zoomAt } from "../map/view";
import { mapSize } from "./map-store";
import type { Point, View } from "../map/view";

// The view lives here rather than in component state because T04 (border
// overlay), T07 (labels) and T08 (picking) all need it. Mirrors the reference
// package's `../civitas-map/src/state/editor-state.ts`.
//
// RULES (`.plan/T03/DESIGN.md` section 4.1):
// - Every action returns without writing when the map size is null or either
//   viewport dimension is <= 0.
// - Every action skips the signal write when nothing actually changed. A write
//   always notifies, because a fresh object is never `Object.is`-equal, so
//   without the guard a ResizeObserver flurry or a wheel held at the zoom cap
//   repaints forever.
// - No action may be called from inside a `useSignalEffect`. They write signals
//   they also read; that is a loop. Call them from DOM event handlers and plain
//   `useEffect`s only.

type Viewport = { width: number; height: number };

// `null` until BOTH the map size and a non-zero viewport are known. Those
// arrive from two independent async sources; a fake default would render one
// wrong frame.
const view = signal<View | null>(null);
const viewport = signal<Viewport>({ width: 0, height: 0 });
const dpr = signal(1);
const cursorMap = signal<Point | null>(null);
const panning = signal(false);

function sameView(a: View, b: View): boolean {
  return a.scale === b.scale && a.x === b.x && a.y === b.y;
}

function writeView(next: View): void {
  const current = view.value;
  if (current && sameView(current, next)) {
    return;
  }
  view.value = next;
}

// The single initialisation point. Called from `setViewport` and from an effect
// keyed on the load phase, because either source can be the second to arrive.
// Re-clamping on resize is required: shrinking the window raises the fit scale,
// and the old scale may now sit below the new minimum.
function syncView(): void {
  const size = mapSize.value;
  const port = viewport.value;
  if (!size || port.width <= 0 || port.height <= 0) {
    return;
  }
  const current = view.value;
  if (!current) {
    view.value = fitView(size, port);
    return;
  }
  writeView(clampView(current, size, port));
}

function setViewport(width: number, height: number): void {
  const current = viewport.value;
  if (current.width === width && current.height === height) {
    return;
  }
  viewport.value = { width, height };
  syncView();
}

function setDpr(next: number): void {
  if (!Number.isFinite(next) || next <= 0) {
    return;
  }
  if (dpr.value === next) {
    return;
  }
  dpr.value = next;
}

function currentContext(): { size: { width: number; height: number }; port: Viewport } | null {
  const size = mapSize.value;
  const port = viewport.value;
  if (!size || port.width <= 0 || port.height <= 0) {
    return null;
  }
  return { size, port };
}

function zoomAtPoint(sx: number, sy: number, factor: number): void {
  const context = currentContext();
  const current = view.value;
  if (!context || !current) {
    return;
  }
  const next = zoomAt(current, sx, sy, factor, context.size, context.port);
  // `zoomAt` returns the same reference when nothing changed; this is the guard
  // that stops a wheel held at the cap from repainting every frame forever.
  if (next === current) {
    return;
  }
  writeView(next);
}

function panTo(x: number, y: number): void {
  const context = currentContext();
  const current = view.value;
  if (!context || !current) {
    return;
  }
  writeView(translateTo(current, x, y, context.size, context.port));
}

function resetView(): void {
  const context = currentContext();
  if (!context) {
    return;
  }
  writeView(fitView(context.size, context.port));
}

// Writes only when the integer pixel changed, so a pointermove inside one
// magnified map pixel does not re-render the HUD.
function setCursor(point: Point | null): void {
  const current = cursorMap.value;
  if (point === null) {
    if (current === null) {
      return;
    }
    cursorMap.value = null;
    return;
  }
  if (current && current.x === point.x && current.y === point.y) {
    return;
  }
  cursorMap.value = point;
}

// Screen point -> the integer map pixel under it, or `null` when the point
// falls outside the authoritative map bounds. Returns `null` before the view
// exists so callers do not have to guard.
function mapPixelAt(sx: number, sy: number): Point | null {
  const context = currentContext();
  const current = view.value;
  if (!context || !current) {
    return null;
  }
  const point = screenToMap(current, sx, sy);
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  if (x < 0 || y < 0 || x >= context.size.width || y >= context.size.height) {
    return null;
  }
  return { x, y };
}

export {
  cursorMap,
  dpr,
  mapPixelAt,
  panTo,
  panning,
  resetView,
  setCursor,
  setDpr,
  setViewport,
  syncView,
  view,
  viewport,
  zoomAtPoint,
  type Viewport,
};
