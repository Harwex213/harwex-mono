import {
  createRegistry,
  type TAppRegistry,
} from "./actions/index";
import {
  createDatasources,
  type CivitasApi,
  type DatasourceOptions,
  type DetectOutcome,
  type Downloads,
  type ImageCodec,
  type MapImage,
  type MapLibrary,
  type ServerMap,
  type ServerMapLayer,
  type TDatasources,
} from "./datasource/index";
import type {
  SaveLayout,
  ServerLayout,
} from "./domain/index";
import {
  createStore,
  type TStore,
} from "./store/index";

// Test helpers. Each test builds its own app, so no state leaks between tests.
// Every datasource is a fake: no network, no canvas, no worker.

type FakeMapLibrary = MapLibrary & {
  images: MapImage[];
  // Blobs by url, as `fetchImage`, `fetchManifest` and `fetchCountries` return them.
  files: Map<string, Blob>;
  // When set, `listImages` rejects with it.
  failure: Error | null;
};

function fakeMapLibrary(images: MapImage[] = []): FakeMapLibrary {
  const library: FakeMapLibrary = {
    images,
    files: new Map(),
    failure: null,
    async listImages(): Promise<MapImage[]> {
      if (library.failure) {
        throw library.failure;
      }
      return library.images;
    },
    async fetchImage(image: MapImage): Promise<Blob> {
      const blob = library.files.get(image.url);
      if (!blob) {
        throw new Error(image.url + " responded 404");
      }
      return blob;
    },
    async fetchManifest(image: MapImage): Promise<string | null> {
      if (image.manifestUrl === null) {
        return null;
      }
      const blob = library.files.get(image.manifestUrl);
      if (!blob) {
        throw new Error(image.manifestUrl + " responded 404");
      }
      return blob.text();
    },
    async fetchCountries(image: MapImage): Promise<string | null> {
      if (image.countriesUrl === null) {
        return null;
      }
      const blob = library.files.get(image.countriesUrl);
      if (!blob) {
        throw new Error(image.countriesUrl + " responded 404");
      }
      return blob.text();
    },
  };
  return library;
}

type FakeCivitasApi = CivitasApi & {
  maps: ServerMap[];
  // The stored layout by map id. `saveLayout` replaces it.
  layouts: Map<string, ServerLayout>;
  // The stored layer images by `<map id>/<layer>`.
  layerImages: Map<string, Blob>;
  // When set, every call rejects with it.
  failure: Error | null;
};

function fakeCivitasApi(): FakeCivitasApi {
  let nextId = 1;
  const freshId = (): string => {
    nextId += 1;
    return "id-" + nextId;
  };
  const check = (): void => {
    if (api.failure) {
      throw api.failure;
    }
  };
  const api: FakeCivitasApi = {
    maps: [],
    layouts: new Map(),
    layerImages: new Map(),
    failure: null,
    async listMaps(): Promise<ServerMap[]> {
      check();
      return api.maps;
    },
    async createMap(name: string): Promise<ServerMap> {
      check();
      const map = serverMap(name, freshId());
      api.maps = [...api.maps, map];
      return map;
    },
    async fetchMapImage(): Promise<Blob> {
      check();
      return new Blob(["png"]);
    },
    async fetchLayerImage(map: ServerMap, layer: ServerMapLayer): Promise<Blob | null> {
      check();
      return api.layerImages.get(map.id + "/" + layer) ?? null;
    },
    async saveLayerImage(mapId: string, layer: ServerMapLayer, image: Blob): Promise<ServerMap> {
      check();
      api.layerImages.set(mapId + "/" + layer, image);
      const map = api.maps.find((entry) => entry.id === mapId) ?? serverMap(mapId, mapId);
      return {
        ...map,
        provincesImageUrl: api.layerImages.has(mapId + "/provinces") ? "backend/static/" + mapId + "/provinces.png" : null,
        countriesImageUrl: api.layerImages.has(mapId + "/countries") ? "backend/static/" + mapId + "/countries.png" : null,
      };
    },
    async fetchLayout(mapId: string): Promise<ServerLayout> {
      check();
      return structuredClone(api.layouts.get(mapId) ?? { countries: [] });
    },
    async saveLayout(mapId: string, layout: SaveLayout): Promise<ServerLayout> {
      check();
      const stored: ServerLayout = {
        countries: layout.countries.map((country) => ({
          id: freshId(),
          name: country.name,
          hex: country.hex,
          provinces: country.provinces.map((province) => ({ id: freshId(), ...province })),
        })),
      };
      api.layouts.set(mapId, stored);
      return structuredClone(stored);
    },
  };
  return api;
}

function serverMap(name: string, id = "map-" + name): ServerMap {
  return { id, name, imageUrl: "backend/static/" + id + "/map.png", provincesImageUrl: null, countriesImageUrl: null };
}

// A bitmap stand-in: the actions only read its size and close it.
function fakeBitmap(width: number, height: number): ImageBitmap {
  return { width, height, close: () => {} } as unknown as ImageBitmap;
}

type FakeImageCodec = ImageCodec & {
  // The size `decodeMap` reports for any blob.
  mapSize: { width: number; height: number };
  // What `decodeProvinces` returns, copied per call. A blob that `encodePng`
  // produced decodes back to the pixels it was made from instead.
  provincePixels: Uint32Array | null;
};

// A PNG stand-in that carries its pixels, so a saved layer decodes back.
type FakePng = Blob & { pixels?: Uint32Array };

function fakeImageCodec(width = 8, height = 6): FakeImageCodec {
  const codec: FakeImageCodec = {
    mapSize: { width, height },
    provincePixels: null,
    async decodeMap(_image: Blob, name: string) {
      return {
        bitmap: fakeBitmap(codec.mapSize.width, codec.mapSize.height),
        name,
        width: codec.mapSize.width,
        height: codec.mapSize.height,
      };
    },
    async decodeProvinces(image: Blob, mapWidth: number, mapHeight: number): Promise<Uint32Array> {
      const carried = (image as FakePng).pixels;
      if (carried) {
        if (carried.length !== mapWidth * mapHeight) {
          throw new Error("the province image does not fit the map");
        }
        return carried.slice();
      }
      if (!codec.provincePixels || codec.provincePixels.length !== mapWidth * mapHeight) {
        throw new Error("the province image does not fit the map");
      }
      return codec.provincePixels.slice();
    },
    readMapPixels(bitmap: ImageBitmap): Uint8ClampedArray {
      return new Uint8ClampedArray(bitmap.width * bitmap.height * 4);
    },
    async encodePng(pixels: Readonly<Uint32Array>): Promise<Blob> {
      const png: FakePng = new Blob(["png"], { type: "image/png" });
      png.pixels = pixels.slice();
      return png;
    },
  };
  return codec;
}

type FakeDownloads = Downloads & {
  files: Array<{ filename: string; value: unknown }>;
};

function fakeDownloads(): FakeDownloads {
  const downloads: FakeDownloads = {
    files: [],
    async downloadPixelsPng(pixels, width, height, filename): Promise<void> {
      downloads.files.push({ filename, value: { pixels: pixels.slice(), width, height } });
    },
    downloadJson(value, filename): void {
      downloads.files.push({ filename, value });
    },
  };
  return downloads;
}

type TestApp = {
  store: TStore;
  sources: TDatasources;
  registry: TAppRegistry;
  library: FakeMapLibrary;
  api: FakeCivitasApi;
  images: FakeImageCodec;
  downloads: FakeDownloads;
};

function createTestApp(options: DatasourceOptions & { detect?: () => Promise<DetectOutcome> } = {}): TestApp {
  const library = fakeMapLibrary();
  const api = fakeCivitasApi();
  const images = fakeImageCodec();
  const downloads = fakeDownloads();
  const store = createStore();
  const sources = createDatasources({
    mapLibrary: library,
    api,
    images,
    downloads,
    detector: {
      detect: options.detect ?? (() => {
        return Promise.reject(new Error("no fake detector"));
      }),
    },
    ...options,
  });
  return { store, sources, registry: createRegistry(store, sources), library, api, images, downloads };
}

function mapImage(name: string, manifestUrl: string | null = null, countriesUrl: string | null = null): MapImage {
  return { name, url: "assets/maps/" + name, bytes: 100, manifestUrl, countriesUrl };
}

export {
  createTestApp,
  fakeBitmap,
  mapImage,
  serverMap,
  type FakeCivitasApi,
  type FakeImageCodec,
  type FakeMapLibrary,
  type TestApp,
};
