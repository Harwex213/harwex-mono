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
import type { LoadStep } from "./map-assets/load-steps";

// This file builds the object that holds every external system the app talks to.
// An external system is anything outside the app's own memory:
// the network, a worker thread and the clock.

// Each worker answer costs one `buildBorderPaths` call on the main thread,
// so the push is debounced.
const BORDER_PUSH_MS = 120;

type LoadMapAssets = (onStep?: (step: LoadStep) => void) => Promise<LoadedMapAssets>;

// Actions receive this object as `sources` and call the external systems only through it.
type TDatasources = {
  // Loads the map PNGs, the province manifest and the countries over HTTP.
  loadMapAssets: LoadMapAssets;
  // Sends work to the border web worker and gets the answers back.
  borders: BordersSource;
  // Delays the push of country ownership to the border worker.
  borderQueue: Debouncer;
};

type DatasourceOptions = {
  timers?: Timers;
  borderDelayMs?: number;
  loadMapAssets?: LoadMapAssets;
  borders?: BordersSource;
};

// The app calls `createDatasources()` with no options and gets the real systems.
// The unit tests pass fakes through `options`: fake timers, a fake border worker.
function createDatasources(options: DatasourceOptions = {}): TDatasources {
  return {
    loadMapAssets: options.loadMapAssets ?? loadMapAssets,
    borders: options.borders ?? createBordersSource(),
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
