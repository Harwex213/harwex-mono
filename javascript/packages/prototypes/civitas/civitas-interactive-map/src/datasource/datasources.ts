import {
  createBordersSource,
  type BordersSource,
} from "./borders/borders-source";
import {
  createDebouncer,
  type Debouncer,
  type Timers,
} from "./timers/debouncer";
import {
  loadMapAssets,
  type LoadedMapAssets,
} from "./map-assets/map-assets";
import {
  createStorageSource,
  type StateStorage,
  type StorageSource,
} from "./storage/state-storage";
import type { LoadStep } from "./map-assets/load-steps";

// This file builds the object that holds every external system the app talks to.
// An external system is anything outside the app's own memory:
// the network, browser storage, a worker thread and the clock.

// A crash loses at most the edits of the last 400 ms.
const SAVE_DELAY_MS = 400;
// Shorter than the save delay, so borders stay live during a drag.
// Each worker answer costs one `buildBorderPaths` call on the main thread.
// At 120 ms, a 1 s drag costs about 8 calls.
const BORDER_PUSH_MS = 120;

type LoadMapAssets = (onStep?: (step: LoadStep) => void) => Promise<LoadedMapAssets>;

// Actions receive this object as `sources` and call the external systems only through it.
type TDatasources = {
  // Loads the map PNGs and the province manifest over HTTP.
  loadMapAssets: LoadMapAssets;
  // Reads and writes the saved world in browser `localStorage`.
  storage: StorageSource;
  // Sends work to the border web worker and gets the answers back.
  borders: BordersSource;
  // Delays the save of the world, so quick edits collapse into one write.
  saveQueue: Debouncer;
  // Delays the push of country assignments to the border worker.
  borderQueue: Debouncer;
};

type DatasourceOptions = {
  storage?: StateStorage;
  timers?: Timers;
  saveDelayMs?: number;
  borderDelayMs?: number;
  loadMapAssets?: LoadMapAssets;
  borders?: BordersSource;
};

// The app calls `createDatasources()` with no options and gets the real systems.
// The e2e entry and the unit tests pass fakes through `options`.
// Examples of fakes: a memory storage instead of `localStorage`, fake timers, a fake border worker.
function createDatasources(options: DatasourceOptions = {}): TDatasources {
  return {
    loadMapAssets: options.loadMapAssets ?? loadMapAssets,
    storage: createStorageSource(options.storage),
    borders: options.borders ?? createBordersSource(),
    saveQueue: createDebouncer({
      delayMs: options.saveDelayMs ?? SAVE_DELAY_MS,
      timers: options.timers,
    }),
    borderQueue: createDebouncer({
      delayMs: options.borderDelayMs ?? BORDER_PUSH_MS,
      timers: options.timers,
    }),
  };
}

export {
  createDatasources,
  type DatasourceOptions,
  type TDatasources,
};
