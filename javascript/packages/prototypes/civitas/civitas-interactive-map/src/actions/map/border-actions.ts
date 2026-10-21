import { batch, effect } from "@preact/signals-react";
import { buildCountryOf } from "../../domain/index";
import type { TDatasources } from "../../datasource/index";
import type { TStore } from "../../store/index";

// The border worker. One scan per session, then a debounced push on each ownership change.

// Idempotent and safe before the map loads. Never rejects, so the app still works without borders.
async function scanBorders(store: TStore, sources: TDatasources): Promise<void> {
  if (sources.borders.started()) {
    return;
  }
  if (store.map.phase.peek() !== "ready") {
    return;
  }
  const loaded = store.map.assets.peek();
  if (!loaded) {
    return;
  }

  batch(() => {
    store.borders.phase.value = "scanning";
    store.borders.error.value = null;
  });

  try {
    const result = await sources.borders.scan(loaded.index);
    // `null` means the borders were disposed while the scan ran.
    if (result === null) {
      return;
    }
    batch(() => {
      store.borders.provinceTiles.value = result.tiles;
      store.borders.stats.value = result.stats;
      store.borders.phase.value = "ready";
    });
  } catch (error) {
    batch(() => {
      store.borders.phase.value = "failed";
      store.borders.error.value = error instanceof Error ? error.message : String(error);
    });
  }
}

async function pushCountryBorders(store: TStore, sources: TDatasources): Promise<void> {
  const max = store.map.maxProvinceId.peek();
  if (max <= 0) {
    return;
  }
  const countryOf = buildCountryOf(store.world.countryOfProvince.peek(), max);
  const result = await sources.borders.assignCountries(countryOf);
  // `null` means a newer assignment replaced this one, or the worker is gone.
  if (result === null) {
    return;
  }
  batch(() => {
    store.borders.countryTiles.value = result.tiles;
    store.borders.countryStats.value = result.stats;
  });
}

// Returns a stop function.
// The source already coalesces requests. The debounce also caps the `Path2D`
// rebuilds on the main thread at a few per second.
function startCountryBorderSync(store: TStore, sources: TDatasources): () => void {
  // Write-free: the push runs later from a timer, outside tracking.
  // `borders.phase` is a dependency because a push during the scan is dropped.
  const stop = effect(() => {
    void store.world.countryOfProvince.value;
    void store.borders.phase.value;
    void store.map.maxProvinceId.value;
    sources.borderQueue.schedule(() => {
      void pushCountryBorders(store, sources);
    });
  });

  return () => {
    stop();
    sources.borderQueue.cancel();
  };
}

// Lets a released stroke update the border without waiting for the debounce.
function flushCountryBorders(_store: TStore, sources: TDatasources): void {
  sources.borderQueue.flush();
}

function disposeBorders(store: TStore, sources: TDatasources): void {
  sources.borders.dispose();
  batch(() => {
    store.borders.provinceTiles.value = null;
    store.borders.countryTiles.value = null;
    store.borders.phase.value = "idle";
    store.borders.stats.value = null;
    store.borders.countryStats.value = null;
  });
}

export { disposeBorders, flushCountryBorders, scanBorders, startCountryBorderSync };
