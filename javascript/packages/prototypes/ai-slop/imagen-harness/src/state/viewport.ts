import { signal } from "@preact/signals-react";

interface Viewport {
  x: number;
  y: number;
  scale: number;
}

interface Size {
  width: number;
  height: number;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 3;

const viewport = signal<Viewport>({ x: 0, y: 0, scale: 1 });
/** What each node measures on screen. Edges need it to find the sockets. */
const nodeSizes = signal<Record<string, Size>>({});
/** The canvas element's own size, so framing can be worked out without the DOM. */
const canvasSize = signal<Size>({ width: 0, height: 0 });

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Where a screen point lands on the canvas, given the canvas element's box. */
function toWorld(clientX: number, clientY: number, box: DOMRect): { x: number; y: number } {
  const view = viewport.value;
  return {
    x: (clientX - box.left - view.x) / view.scale,
    y: (clientY - box.top - view.y) / view.scale,
  };
}

function panBy(dx: number, dy: number): void {
  const view = viewport.value;
  viewport.value = { ...view, x: view.x + dx, y: view.y + dy };
}

/** Zooms around a screen point, so whatever sits under the cursor stays put. */
function zoomAt(clientX: number, clientY: number, factor: number, box: DOMRect): void {
  const view = viewport.value;
  const scale = clampScale(view.scale * factor);
  if (scale === view.scale) {
    return;
  }
  const px = clientX - box.left;
  const py = clientY - box.top;
  const ratio = scale / view.scale;
  viewport.value = {
    scale,
    x: px - (px - view.x) * ratio,
    y: py - (py - view.y) * ratio,
  };
}

function setScale(scale: number, box: DOMRect): void {
  zoomAt(box.left + box.width / 2, box.top + box.height / 2, scale / viewport.value.scale, box);
}

/** Puts a point of the canvas in the middle of the window, at the current zoom. */
function centreOnWorld(x: number, y: number): void {
  const box = canvasSize.value;
  const view = viewport.value;
  viewport.value = {
    ...view,
    x: box.width / 2 - x * view.scale,
    y: box.height / 2 - y * view.scale,
  };
}

function setCanvasSize(size: Size): void {
  const current = canvasSize.value;
  if (current.width === size.width && current.height === size.height) {
    return;
  }
  canvasSize.value = size;
}

function measureNode(id: string, size: Size): void {
  const current = nodeSizes.value[id];
  if (current && current.width === size.width && current.height === size.height) {
    return;
  }
  nodeSizes.value = { ...nodeSizes.value, [id]: size };
}

function sizeOf(id: string): Size {
  return nodeSizes.value[id] ?? { width: 260, height: 120 };
}

export type { Viewport };
export {
  canvasSize,
  centreOnWorld,
  measureNode,
  MAX_SCALE,
  MIN_SCALE,
  nodeSizes,
  panBy,
  setCanvasSize,
  setScale,
  sizeOf,
  toWorld,
  viewport,
  zoomAt,
};
