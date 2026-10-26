import {
  createRegistry,
  type TAppRegistry,
} from "./actions/index";
import {
  createDatasources,
  type DatasourceOptions,
  type DetectOutcome,
  type Downloads,
  type ImageCodec,
  type MapImage,
  type MapLibrary,
  type TDatasources,
} from "./datasource/index";
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

// A bitmap stand-in: the actions only read its size and close it.
function fakeBitmap(width: number, height: number): ImageBitmap {
  return { width, height, close: () => {} } as unknown as ImageBitmap;
}

type FakeImageCodec = ImageCodec & {
  // The size `decodeMap` reports for any blob.
  mapSize: { width: number; height: number };
  // What `decodeProvinces` returns, copied per call.
  provincePixels: Uint32Array | null;
};

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
    async decodeProvinces(_image: Blob, mapWidth: number, mapHeight: number): Promise<Uint32Array> {
      if (!codec.provincePixels || codec.provincePixels.length !== mapWidth * mapHeight) {
        throw new Error("the province image does not fit the map");
      }
      return codec.provincePixels.slice();
    },
    readMapPixels(bitmap: ImageBitmap): Uint8ClampedArray {
      return new Uint8ClampedArray(bitmap.width * bitmap.height * 4);
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
  images: FakeImageCodec;
  downloads: FakeDownloads;
};

function createTestApp(options: DatasourceOptions & { detect?: () => Promise<DetectOutcome> } = {}): TestApp {
  const library = fakeMapLibrary();
  const images = fakeImageCodec();
  const downloads = fakeDownloads();
  const store = createStore();
  const sources = createDatasources({
    mapLibrary: library,
    images,
    downloads,
    detector: {
      detect: options.detect ?? (() => {
        return Promise.reject(new Error("no fake detector"));
      }),
    },
    ...options,
  });
  return { store, sources, registry: createRegistry(store, sources), library, images, downloads };
}

function mapImage(name: string, manifestUrl: string | null = null, countriesUrl: string | null = null): MapImage {
  return { name, url: "assets/maps/" + name, bytes: 100, manifestUrl, countriesUrl };
}

export {
  createTestApp,
  fakeBitmap,
  mapImage,
  type FakeImageCodec,
  type FakeMapLibrary,
  type TestApp,
};
