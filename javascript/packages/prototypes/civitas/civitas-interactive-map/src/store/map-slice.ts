import { computed, signal } from "@preact/signals-react";
import { LOAD_STEPS, indexProvincesById } from "../domain/index";
import type { LoadStep, LoadedMapAssets } from "../domain/index";

// The loaded map and the load progress. The assets sit in a signal so that
// manifest readers re-run on load. A signal compares by identity, so the 42 MB
// pixel array costs nothing.

type LoadPhase = "idle" | "loading" | "ready" | "failed";

function createMapSlice() {
  const phase = signal<LoadPhase>("idle");
  const step = signal<LoadStep>("manifest");
  const error = signal<string | null>(null);
  const assets = signal<LoadedMapAssets | null>(null);

  // Ids are not contiguous (1318 and 1458 are missing), so never `provinces[id - 1]`.
  const provincesById = computed(() => {
    const loaded = assets.value;
    return loaded ? indexProvincesById(loaded.manifest.provinces) : null;
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

  const progress = computed(() => {
    if (phase.value === "ready") {
      return 1;
    }
    if (phase.value !== "loading") {
      return 0;
    }
    const at = LOAD_STEPS.indexOf(step.value);
    return at < 0 ? 0 : at / (LOAD_STEPS.length - 1);
  });

  return { phase, step, error, assets, provincesById, mapSize, maxProvinceId, progress };
}

type TMapSlice = ReturnType<typeof createMapSlice>;

export { createMapSlice, type LoadPhase, type TMapSlice };
