import { batch } from "@preact/signals-react";
import type { TStore } from "../../store/index";

// The two steps every layer edit ends with. A module of its own, because both
// the layer actions and the province actions edit the layer.

// The layer's pixels changed: the renderer uploads the dirty rectangle.
function markLayerChanged(store: TStore): void {
  store.map.layerRevision.value += 1;
}

// Ends the layer's open stroke. A stroke that changed pixels is one undo step.
function commitStroke(store: TStore): void {
  batch(() => {
    if (store.map.layer.value?.endStroke()) {
      store.map.historyRevision.value += 1;
    }

    markLayerChanged(store);
  });
}

export {
  commitStroke,
  markLayerChanged,
};
