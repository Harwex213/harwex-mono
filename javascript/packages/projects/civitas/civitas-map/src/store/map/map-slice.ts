import { computed, signal } from "@preact/signals-react";
import type { ProvinceLayer } from "../../domain/index";

// The open map: its name and size, the base map bitmap and the province layer.
// The bitmap and the layer sit in signals by identity only. They are large
// mutable objects; a signal compares them by reference, so holding them costs
// nothing, and components react to `layerRevision` when the pixels change.

type MapInfo = {
  name: string;
  width: number;
  height: number;
};

function createMapSlice() {
  const info = signal<MapInfo | null>(null);
  const bitmap = signal<ImageBitmap | null>(null);
  const layer = signal<ProvinceLayer | null>(null);
  // Bumped whenever the layer's pixels change, so the renderer has something to
  // react to. The pixels themselves live outside the signal graph.
  const layerRevision = signal(0);
  // Bumped whenever the undo history changes.
  const historyRevision = signal(0);

  // `historyRevision` is read for the dependency only. The flags themselves sit
  // on the layer, which is outside the signal graph.
  const canUndo = computed(() => {
    void historyRevision.value;

    return layer.value?.canUndo ?? false;
  });

  const canRedo = computed(() => {
    void historyRevision.value;

    return layer.value?.canRedo ?? false;
  });

  return { info, bitmap, layer, layerRevision, historyRevision, canUndo, canRedo };
}

type TMapSlice = ReturnType<typeof createMapSlice>;

export {
  createMapSlice,
  type MapInfo,
  type TMapSlice,
};
