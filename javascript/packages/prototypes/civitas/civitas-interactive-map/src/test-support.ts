import {
  createRegistry,
  type TAppRegistry,
} from "./actions/index";
import {
  createDatasources,
  type BordersSource,
  type CountryResult,
  type DatasourceOptions,
  type LoadedMapAssets,
  type TDatasources,
  type TimerHandle,
  type Timers,
} from "./datasource/index";
import {
  createStore,
  type TStore,
} from "./store/index";
import type { Country, MapManifest, Province, ProvinceIndex } from "./domain/index";

// Test helpers. Each test builds its own app, so no state leaks between tests.

type FakeTimers = Timers & {
  // How many times a timer was armed.
  sets: number;
  // Runs every armed timer once.
  run(): void;
  // How many timers are armed now.
  armed(): number;
};

function fakeTimers(): FakeTimers {
  let nextHandle = 1;
  const armed = new Map<number, () => void>();
  const timers: FakeTimers = {
    sets: 0,
    set(fn: () => void): TimerHandle {
      timers.sets += 1;
      const handle = nextHandle;
      nextHandle += 1;
      armed.set(handle, fn);
      return handle as unknown as TimerHandle;
    },
    clear(handle: TimerHandle): void {
      armed.delete(handle as unknown as number);
    },
    run(): void {
      const due = [...armed.values()];
      armed.clear();
      for (const fn of due) {
        fn();
      }
    },
    armed(): number {
      return armed.size;
    },
  };
  return timers;
}

type FakeBorders = BordersSource & {
  // Every assignment pushed to the worker, in order.
  pushed: (Uint16Array | null)[];
};

// A border source with no worker. `started` is true, so pushes need no scan.
function fakeBorders(): FakeBorders {
  const pushed: (Uint16Array | null)[] = [];
  let alive = true;
  return {
    pushed,
    started(): boolean {
      return alive;
    },
    scan(): Promise<null> {
      return Promise.resolve(null);
    },
    assignCountries(countryOf: Uint16Array | null): Promise<CountryResult | null> {
      pushed.push(countryOf);
      return Promise.resolve(null);
    },
    dispose(): void {
      alive = false;
    },
  };
}

type TestApp = {
  store: TStore;
  sources: TDatasources;
  registry: TAppRegistry;
  timers: FakeTimers;
};

// Defaults: fake timers and a fake border worker.
function createTestApp(options: DatasourceOptions = {}): TestApp {
  const timers = (options.timers as FakeTimers | undefined) ?? fakeTimers();
  const store = createStore();
  const sources = createDatasources({
    borders: fakeBorders(),
    ...options,
    timers,
  });
  return { store, sources, registry: createRegistry(store, sources), timers };
}

// A loaded map without the PNGs. The default index is `null` everywhere.
function fakeMapAssets(options: {
  width: number;
  height: number;
  provinces?: Province[];
  index?: ProvinceIndex;
}): LoadedMapAssets {
  const manifest = {
    format: "civitas.province-map",
    version: 1,
    map: { source: "test", width: options.width, height: options.height },
    provinces: options.provinces ?? [],
    painted: { pixelCount: 0, coverage: 0, unregisteredColors: [] },
  } as unknown as MapManifest;
  const index =
    options.index ??
    ({
      width: options.width,
      height: options.height,
      provinceAt(): number | null {
        return null;
      },
    } as unknown as ProvinceIndex);
  return {
    manifest,
    countries: { countries: [], repairs: [] },
    countryInfo: { info: [], repairs: [] },
    index,
    art: {} as ImageBitmap,
  };
}

// A country as `assets/countries.json` describes it.
function country(id: number, provinceIds: number[], fields: Partial<Country> = {}): Country {
  return {
    id,
    name: "Country " + id,
    slogan: "",
    flagDataUrl: null,
    colorHex: "#c0563f",
    ...fields,
    provinceIds,
  };
}

// Puts the countries into the store, as a finished `loadMap` would.
function setCountries(store: TStore, countries: Country[]): void {
  store.world.countries.value = countries;
}

// Puts a loaded map into the store, as a finished `loadMap` would.
function markMapReady(store: TStore, assets: LoadedMapAssets): void {
  store.map.assets.value = assets;
  store.map.phase.value = "ready";
  store.map.progress.value = 1;
}

export {
  country,
  createTestApp,
  fakeMapAssets,
  fakeTimers,
  markMapReady,
  setCountries,
  type FakeBorders,
  type FakeTimers,
  type TestApp,
};
