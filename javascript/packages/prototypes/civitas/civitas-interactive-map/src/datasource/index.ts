// `src/datasource` holds all code that talks to systems outside the app's memory: network, worker, clock.
// Each subfolder covers one system. This file lists what the rest of the app may import from the folder.
// Decisions:
// - Datasource modules import each other by file path, not through this index, so no cycle can form.
// - Only names used outside `src/datasource` are listed. Tests import their module directly.

// datasources.ts — `createDatasources()`: builds the one object that holds every source; actions receive it as `sources`.
// The app passes no options and gets the real sources. Tests and the e2e entry pass fakes.
export {
  createDatasources,
  type DatasourceOptions,
  type TDatasources,
} from "./datasources";

// borders/ — the border web worker and its promise wrapper.
export {
  type BordersSource,
  type CountryResult,
} from "./borders/borders-source";
export {
  type BorderStats,
} from "./borders/borders-worker";

// timers/ — the debouncer over `setTimeout`.
export {
  type TimerHandle,
  type Timers,
} from "./timers/debouncer";

// map-assets/ — the `fetch` of the map PNGs, the manifest and the countries, and the steps of that load.
// Only `datasources.ts` calls the loader. The store and the actions use its result type and its steps.
export {
  loadProgress,
  type LoadStep,
} from "./map-assets/load-steps";
export {
  type LoadedMapAssets,
} from "./map-assets/map-assets";
