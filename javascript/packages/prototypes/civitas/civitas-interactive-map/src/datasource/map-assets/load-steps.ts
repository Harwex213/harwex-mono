// The stages of a map load. They describe how the loader works, not the map, so they live beside the loader.

type LoadStep = "manifest" | "countries" | "province-bitmap" | "province-index" | "map-art" | "done";

// Why: this list is the one ordered source of truth for the load sequence.
// - `loadMapAssets(onStep)` in `map-assets.ts` calls `onStep(step)` at each load stage. `onStep` is its progress callback.
// - The array order must match the order of those `onStep` calls.
// - `loadProgress(step)` turns the index of a step into progress, so no step stores a percentage.
// - The `loadMap` action writes that progress into `store.map.progress` on each `onStep` call.
// - A new step goes here in its place and gets one `onStep` call in `loadMapAssets`.
// - "done" stays last, so progress reaches 1.
const LOAD_STEPS: readonly LoadStep[] = [
  "manifest",
  "countries",
  "province-bitmap",
  "province-index",
  "map-art",
  "done",
];

// A fraction from 0 to 1.
function loadProgress(step: LoadStep): number {
  const at = LOAD_STEPS.indexOf(step);
  return at < 0 ? 0 : at / (LOAD_STEPS.length - 1);
}

export { LOAD_STEPS, loadProgress, type LoadStep };
