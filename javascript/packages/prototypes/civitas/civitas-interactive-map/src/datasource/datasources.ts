import { createBordersSource } from "./borders-source";
import { createDebouncer } from "./debouncer";
import { loadMapAssets } from "./map-assets";
import { createStorageSource } from "./state-storage";
import type { BordersSource } from "./borders-source";
import type { Debouncer, Timers } from "./debouncer";
import type { LoadStep, LoadedMapAssets } from "./map-assets";
import type { StateStorage, StorageSource } from "./state-storage";

// The outside world that the actions call: network, storage, border worker, clock.
// `main.tsx` builds one set. A test builds its own set with fakes.

// Bounds how much typing a crash can lose.
const SAVE_DELAY_MS = 400;
// Shorter than the save delay, so borders stay live during a drag.
// Each answer costs a main-thread `buildBorderPaths`; 120 ms caps a 1 s drag at ~8.
const BORDER_PUSH_MS = 120;

type MapAssetsSource = {
  load(onStep?: (step: LoadStep) => void): Promise<LoadedMapAssets>;
};

type TDatasources = {
  mapAssets: MapAssetsSource;
  storage: StorageSource;
  borders: BordersSource;
  // Defers the write of the world document.
  saveQueue: Debouncer;
  // Defers the push of the province -> country assignment to the border worker.
  borderQueue: Debouncer;
};

type DatasourceOptions = {
  storage?: StateStorage;
  timers?: Timers;
  saveDelayMs?: number;
  borderDelayMs?: number;
  mapAssets?: MapAssetsSource;
  borders?: BordersSource;
};

function createDatasources(options: DatasourceOptions = {}): TDatasources {
  return {
    mapAssets: options.mapAssets ?? { load: loadMapAssets },
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
  BORDER_PUSH_MS,
  SAVE_DELAY_MS,
  createDatasources,
  type DatasourceOptions,
  type MapAssetsSource,
  type TDatasources,
};
