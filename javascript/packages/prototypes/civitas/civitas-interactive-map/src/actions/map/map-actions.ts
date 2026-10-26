import { batch } from "@preact/signals-react";
import {
  loadProgress,
  type TDatasources,
} from "../../datasource/index";
import type { TStore } from "../../store/index";

// Loads the map and its countries. Idempotent. Never rejects: a failure lands in `map.error`, so a caller may ignore the promise.
async function loadMap(store: TStore, sources: TDatasources): Promise<void> {
  const phase = store.map.phase.peek();
  if (phase === "loading" || phase === "ready") {
    return;
  }

  batch(() => {
    store.map.phase.value = "loading";
    store.map.step.value = "manifest";
    store.map.progress.value = loadProgress("manifest");
    store.map.error.value = null;
  });

  try {
    const loaded = await sources.loadMapAssets((step) => {
      batch(() => {
        store.map.step.value = step;
        store.map.progress.value = loadProgress(step);
      });
    });
    const repairs = loaded.countries.repairs;
    batch(() => {
      store.map.assets.value = loaded;
      store.world.countries.value = loaded.countries.countries;
      store.world.notice.value = repairs.length === 0 ? null : "countries.json: " + repairs.join("; ");
      store.map.phase.value = "ready";
      store.map.progress.value = 1;
    });
  } catch (error) {
    batch(() => {
      store.map.error.value = error instanceof Error ? error.message : String(error);
      store.map.phase.value = "failed";
      store.map.progress.value = 0;
    });
  }
}

export { loadMap };
