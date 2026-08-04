import { computed, signal } from "@preact/signals-react";
import { LOAD_STEPS, loadMapAssets } from "../map/map-assets";
import { indexProvincesById } from "../map/manifest";
import type { LoadStep, LoadedMapAssets } from "../map/map-assets";
import type { Province } from "../map/manifest";

// Same rule the reference package follows (`../civitas-map/src/state/editor-state.ts`,
// the comment above `let bitmap`): large mutable objects are plain module
// variables, not signals. A signal carries identity and status; a 42 MB
// Uint32Array in a signal would be diffed and re-read by every subscriber for
// nothing.

type LoadPhase = "idle" | "loading" | "ready" | "failed";

const loadPhase = signal<LoadPhase>("idle");
const loadStep = signal<LoadStep>("manifest");
const loadError = signal<string | null>(null);
const mapSize = signal<{ width: number; height: number } | null>(null);
const provinceCount = signal(0);

const loadProgress = computed(() => {
  if (loadPhase.value === "ready") {
    return 1;
  }
  if (loadPhase.value !== "loading") {
    return 0;
  }
  const at = LOAD_STEPS.indexOf(loadStep.value);
  return at < 0 ? 0 : at / (LOAD_STEPS.length - 1);
});

let assets: LoadedMapAssets | null = null;
let byId: Map<number, Province> | null = null;
let inFlight: Promise<void> | null = null;

// Idempotent: two components may both ask, and the second gets the first's
// promise. It NEVER rejects — a failure lands in `loadError` and `loadPhase`, so
// an effect that ignores the returned promise cannot raise an unhandled
// rejection.
async function ensureMapLoaded(): Promise<void> {
  if (assets) {
    return;
  }
  if (inFlight) {
    return inFlight;
  }

  loadPhase.value = "loading";
  loadStep.value = "manifest";
  loadError.value = null;

  inFlight = (async () => {
    try {
      const loaded = await loadMapAssets((step) => {
        loadStep.value = step;
      });
      assets = loaded;
      byId = indexProvincesById(loaded.manifest.provinces);
      mapSize.value = { width: loaded.manifest.map.width, height: loaded.manifest.map.height };
      provinceCount.value = loaded.manifest.provinces.length;
      loadPhase.value = "ready";
    } catch (error) {
      loadError.value = error instanceof Error ? error.message : String(error);
      loadPhase.value = "failed";
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

function getMapAssets(): LoadedMapAssets | null {
  return assets;
}

// Returns `null` before the load finishes. Callers run during loading and must
// not have to guard.
function provinceAt(x: number, y: number): number | null {
  if (!assets) {
    return null;
  }
  return assets.index.provinceAt(x, y);
}

// Reads the id-keyed map, never `provinces[id - 1]`. Ids run 1..1650 for 1648
// provinces; 1318 and 1458 do not exist.
function provinceById(id: number): Province | null {
  if (!byId) {
    return null;
  }
  return byId.get(id) ?? null;
}

export {
  ensureMapLoaded,
  getMapAssets,
  loadError,
  loadPhase,
  loadProgress,
  loadStep,
  mapSize,
  provinceAt,
  provinceById,
  provinceCount,
  type LoadPhase,
};
