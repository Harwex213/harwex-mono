import { batch } from "@preact/signals-react";
import type { TDatasources } from "../datasource/index";
import type { TStore } from "../store/index";

// Idempotent. Never rejects: a failure lands in `map.error`, so a caller may ignore the promise.
async function loadMap(store: TStore, sources: TDatasources): Promise<void> {
  const phase = store.map.phase.peek();
  if (phase === "loading" || phase === "ready") {
    return;
  }

  batch(() => {
    store.map.phase.value = "loading";
    store.map.step.value = "manifest";
    store.map.error.value = null;
  });

  try {
    const loaded = await sources.mapAssets.load((step) => {
      store.map.step.value = step;
    });
    batch(() => {
      store.map.assets.value = loaded;
      store.map.phase.value = "ready";
    });
  } catch (error) {
    batch(() => {
      store.map.error.value = error instanceof Error ? error.message : String(error);
      store.map.phase.value = "failed";
    });
  }
}

export { loadMap };
