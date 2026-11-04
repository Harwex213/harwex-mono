import { batch } from "@preact/signals-react";
import type { TStore } from "../../store/index";
import { selectProvinceByColor } from "../provinces/province-actions";
import {
  commitStroke,
  markLayerChanged,
} from "./layer-commit";

// Edits of the province layer: brush strokes, fill, pick, undo, and the hover
// lookup. Coordinates are map pixels. The map canvas service turns pointer
// events into these calls.

// The value a paint writes: the active province's colour, or 0 when erasing.
// `null` when there is nothing to paint with; the error says why.
function paintValue(store: TStore, erasing: boolean): number | null {
  if (erasing) {
    return 0;
  }

  const province = store.provinces.active.value;

  if (!province) {
    store.status.error.value = "Add a province before painting";

    return null;
  }

  return province.color;
}

// Opens a brush stroke with one stamp at `(x, y)`. False when nothing was
// started: no layer, a press outside the map, or no province to paint with.
function beginStroke(store: TStore, x: number, y: number, erasing: boolean): boolean {
  const layer = store.map.layer.value;

  if (!layer || !layer.contains(x, y)) {
    return false;
  }

  const value = paintValue(store, erasing);

  if (value === null) {
    return false;
  }

  layer.beginStroke();
  layer.stamp(x, y, store.tools.brushMask.value, value);
  markLayerChanged(store);

  return true;
}

// Pointer samples skip pixels on a fast drag, so the segment between the last
// sample and this one is filled rather than the sample alone.
function extendStroke(store: TStore, from: { x: number; y: number }, to: { x: number; y: number }, erasing: boolean): void {
  const layer = store.map.layer.value;

  if (!layer) {
    return;
  }

  const value = erasing ? 0 : (store.provinces.active.value?.color ?? 0);

  layer.strokeSegment(from.x, from.y, to.x, to.y, store.tools.brushMask.value, value);
  markLayerChanged(store);
}

function endStroke(store: TStore): void {
  commitStroke(store);
}

// Fills the connected run under `(x, y)`. One fill is one undo step.
function fillAt(store: TStore, x: number, y: number, erasing: boolean): void {
  const layer = store.map.layer.value;

  if (!layer || !layer.contains(x, y)) {
    return;
  }

  const value = paintValue(store, erasing);

  if (value === null) {
    return;
  }

  layer.beginStroke();
  layer.floodFill(x, y, value);
  commitStroke(store);
}

// Makes the province painted at `(x, y)` active.
function pickAt(store: TStore, x: number, y: number): void {
  const layer = store.map.layer.value;

  if (!layer || !layer.contains(x, y)) {
    return;
  }

  if (!selectProvinceByColor(store, layer.pixelAt(x, y))) {
    store.status.error.value = "No province is painted at that pixel";
  }
}

// `null` when the cursor left the map canvas.
function setHover(store: TStore, pixel: { x: number; y: number } | null): void {
  const layer = store.map.layer.value;

  batch(() => {
    if (!layer || !pixel) {
      store.hover.pixel.value = null;
      store.hover.color.value = 0;

      return;
    }

    const inside = layer.contains(pixel.x, pixel.y);
    const current = store.hover.pixel.value;

    if (!inside) {
      store.hover.pixel.value = null;
    } else if (!current || current.x !== pixel.x || current.y !== pixel.y) {
      store.hover.pixel.value = pixel;
    }

    store.hover.color.value = layer.pixelAt(pixel.x, pixel.y);
  });
}

function undo(store: TStore): void {
  if (store.map.layer.value?.undo()) {
    batch(() => {
      store.map.historyRevision.value += 1;
      markLayerChanged(store);
    });
  }
}

function redo(store: TStore): void {
  if (store.map.layer.value?.redo()) {
    batch(() => {
      store.map.historyRevision.value += 1;
      markLayerChanged(store);
    });
  }
}

function clearLayer(store: TStore): void {
  store.map.layer.value?.clear();
  batch(() => {
    store.map.historyRevision.value += 1;
    markLayerChanged(store);
  });
}

export {
  beginStroke,
  clearLayer,
  endStroke,
  extendStroke,
  fillAt,
  pickAt,
  redo,
  setHover,
  undo,
};
