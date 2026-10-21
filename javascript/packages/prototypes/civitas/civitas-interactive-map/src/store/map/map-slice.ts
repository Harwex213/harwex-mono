import { computed, signal } from "@preact/signals-react";
import type { LoadStep, LoadedMapAssets } from "../../datasource/index";

// The loaded map and the load progress. The assets sit in a signal so that
// manifest readers re-run on load. A signal compares by identity, so the 42 MB
// pixel array costs nothing.

type LoadPhase = "idle" | "loading" | "ready" | "failed";

function createMapSlice() {
  const phase = signal<LoadPhase>("idle");
  const step = signal<LoadStep>("manifest");
  const error = signal<string | null>(null);
  const assets = signal<LoadedMapAssets | null>(null);
  // A fraction from 0 to 1. The `loadMap` action writes it together with `step` and `phase`.
  const progress = signal(0);

  // A Map, not the array: ids are not contiguous (1318 and 1458 are missing),
  // so `provinces[id - 1]` returns the wrong province.
  const provincesById = computed(() => {
    const loaded = assets.value;
    if (!loaded) {
      return null;
    }
    return new Map(loaded.manifest.provinces.map((province) => {
      return [province.id, province];
    }));
  });

  const mapSize = computed(() => {
    const loaded = assets.value;
    if (!loaded) {
      return null;
    }
    return { width: loaded.manifest.map.width, height: loaded.manifest.map.height };
  });

  const maxProvinceId = computed(() => {
    const loaded = assets.value;
    if (!loaded) {
      return 0;
    }
    let max = 0;
    for (const province of loaded.manifest.provinces) {
      if (province.id > max) {
        max = province.id;
      }
    }
    return max;
  });

  return { phase, step, error, assets, provincesById, mapSize, maxProvinceId, progress };
}

type TMapSlice = ReturnType<typeof createMapSlice>;

export { createMapSlice, type TMapSlice };
