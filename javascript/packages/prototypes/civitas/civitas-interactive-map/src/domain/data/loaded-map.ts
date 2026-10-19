import type { MapManifest } from "./manifest";
import type { ProvinceIndex } from "./province-index";

// The result of a map load and its progress steps. The loader is `src/datasource/map-assets.ts`.

type LoadStep = "manifest" | "province-bitmap" | "province-index" | "map-art" | "done";

const LOAD_STEPS: readonly LoadStep[] = [
  "manifest",
  "province-bitmap",
  "province-index",
  "map-art",
  "done",
];

type LoadedMapAssets = {
  manifest: MapManifest;
  index: ProvinceIndex;
  art: ImageBitmap;
};

export { LOAD_STEPS, type LoadStep, type LoadedMapAssets };
